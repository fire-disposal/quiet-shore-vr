import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PortalLink,
  planControlDispatch,
  type PoseSnapshot,
  type StateSnapshot
} from '../src/app/portal-link';

const POSE: PoseSnapshot = { x: 0, y: 1.6, z: 0, yaw: 0.1, pitch: -0.2 };

class FakeSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 3;
  static instances: FakeSocket[] = [];

  readyState = FakeSocket.CONNECTING;
  readonly sent: Record<string, unknown>[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: ((event: { target: FakeSocket }) => void) | null = null;

  constructor(readonly url: string) {
    FakeSocket.instances.push(this);
  }

  send(data: string): void {
    this.sent.push(JSON.parse(data) as Record<string, unknown>);
  }

  emitOpen(): void {
    this.readyState = FakeSocket.OPEN;
    this.onopen?.();
  }

  deliver(message: unknown): void {
    this.onmessage?.({ data: JSON.stringify(message) });
  }

  emitClose(): void {
    this.readyState = FakeSocket.CLOSED;
    this.onclose?.({ target: this });
  }

  close(): void {
    this.emitClose();
  }
}

describe('planControlDispatch', () => {
  it('coalesces interspersed view:orient samples without reordering discrete commands', () => {
    const plan = planControlDispatch(
      [
        { seq: 40, command: 'view:orient:0,0.1', continuous: true },
        { seq: 41, command: 'scene:ward' },
        { seq: 42, command: 'view:orient:0,0.35', continuous: true }
      ],
      -1
    );
    expect(plan.commands).toEqual([
      { seq: 41, command: 'scene:ward', discrete: true },
      { seq: 42, command: 'view:orient:0,0.35', discrete: false }
    ]);
    expect(plan.nextSeq).toBe(42);
  });

  it('delivers a discrete command behind a stream exactly once', () => {
    const first = planControlDispatch(
      [{ seq: 7, command: 'view:orient:0,0.2', continuous: true }],
      -1
    );
    expect(first.commands.map((item) => item.command)).toEqual(['view:orient:0,0.2']);

    const second = planControlDispatch([{ seq: 8, command: 'posture:rise' }], first.nextSeq);
    expect(second.commands).toEqual([{ seq: 8, command: 'posture:rise', discrete: true }]);
    expect(second.nextSeq).toBe(8);

    // A redelivered/replayed batch is a no-op.
    const replay = planControlDispatch(
      [
        { seq: 7, command: 'view:orient:0,0.2', continuous: true },
        { seq: 8, command: 'posture:rise' }
      ],
      second.nextSeq
    );
    expect(replay.commands).toEqual([]);
    expect(replay.nextSeq).toBe(8);
  });

  it('never replays a view:anim marked as history but accepts a live one', () => {
    const history = planControlDispatch(
      [
        { seq: 10, command: 'view:anim:up', replay: true },
        { seq: 11, command: 'scene:ward', replay: true },
        { seq: 12, command: 'view:stop', replay: true }
      ],
      -1
    );
    expect(history.commands.map((item) => item.command)).toEqual(['scene:ward', 'view:stop']);
    expect(history.nextSeq).toBe(12);

    const live = planControlDispatch([{ seq: 13, command: 'view:anim:up' }], history.nextSeq);
    expect(live.commands).toEqual([{ seq: 13, command: 'view:anim:up', discrete: true }]);
  });

  it('classifies movement as continuous even without the flag', () => {
    const plan = planControlDispatch([{ seq: 2, command: 'view:orient:0,0.5' }], -1);
    expect(plan.commands[0].discrete).toBe(false);
  });

  it('keeps view:stop discrete and ignores malformed entries', () => {
    const plan = planControlDispatch(
      [
        // @ts-expect-error malformed wire data must not crash the link
        { seq: Number.NaN, command: 'scene:ward' },
        // @ts-expect-error malformed wire data must not crash the link
        { seq: 3, command: 42 },
        { seq: 4, command: 'view:stop' }
      ],
      -1
    );
    expect(plan.commands).toEqual([{ seq: 4, command: 'view:stop', discrete: true }]);
    expect(plan.nextSeq).toBe(4);
  });
});

describe('PortalLink', () => {
  let viewAnim: StateSnapshot['viewAnim'] = 'idle';
  let sitUpMoving = false;

  function state(): StateSnapshot {
    return {
      scene: 'washroom',
      session: false,
      calibrating: false,
      audio: false,
      eyeHeight: 1.6,
      posturePitch: 0,
      postureRoll: 0,
      postureRise: 0,
      postureProgress: 0,
      viewPitch: 0,
      viewAnim,
      viewPreset: 'none',
      cueEnabled: false,
      cueIntensity: 0,
      calibrationConfidence: 0
    };
  }

  interface Harness {
    link: PortalLink;
    commands: string[];
    modes: boolean[];
    statuses: string[];
    socket(): FakeSocket;
    flush(): Promise<void>;
  }

  function createLink(): Harness {
    const commands: string[] = [];
    const modes: boolean[] = [];
    const statuses: string[] = [];
    const link = new PortalLink(
      (command) => commands.push(command),
      (active) => modes.push(active),
      () => POSE,
      state,
      () => sitUpMoving,
      (status) => statuses.push(status)
    );
    return {
      link,
      commands,
      modes,
      statuses,
      socket: () => FakeSocket.instances[FakeSocket.instances.length - 1],
      // The batch flush is a microtask; awaiting yields to it.
      flush: async () => { await Promise.resolve(); }
    };
  }

  let harness: Harness;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    vi.stubGlobal('window', globalThis);
    vi.stubGlobal('WebSocket', FakeSocket);
    FakeSocket.instances = [];
    viewAnim = 'idle';
    sitUpMoving = false;
  });

  afterEach(() => {
    harness?.link.stop();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('connects with since=-1 and sends state/telemetry frames', () => {
    harness = createLink();
    harness.link.start();
    const socket = harness.socket();
    expect(socket.url).toBe('ws://127.0.0.1:8130/ws?since=-1');

    socket.emitOpen();
    expect(harness.statuses).toEqual(['open']);
    expect(socket.sent.at(-1)).toEqual({ type: 'state', data: state() });

    socket.sent.length = 0;
    vi.advanceTimersByTime(200);
    expect(socket.sent).toEqual([{ type: 'telemetry', data: POSE }]);
  });

  it('acks a discrete command, refreshes state and never acks movement', async () => {
    harness = createLink();
    harness.link.start();
    const socket = harness.socket();
    socket.emitOpen();
    socket.sent.length = 0;

    socket.deliver({ type: 'cmd', seq: 4, command: 'view:orient:0,0.3', continuous: true });
    await harness.flush();
    expect(harness.commands).toEqual(['view:orient:0,0.3']);
    expect(socket.sent).toEqual([]);

    socket.deliver({ type: 'cmd', seq: 5, command: 'posture:rise', continuous: false });
    await harness.flush();
    expect(harness.commands).toEqual(['view:orient:0,0.3', 'posture:rise']);
    expect(socket.sent.map((message) => message.type)).toEqual(['ack', 'state']);
    expect(socket.sent[0]).toEqual({ type: 'ack', seq: 5 });
  });

  it('dispatches a burst in order with one coalesced movement sample', async () => {
    harness = createLink();
    harness.link.start();
    const socket = harness.socket();
    socket.emitOpen();

    socket.deliver({ type: 'cmd', seq: 1, command: 'view:orient:0,0.1', continuous: true });
    socket.deliver({ type: 'cmd', seq: 2, command: 'scene:beach', continuous: false });
    socket.deliver({ type: 'cmd', seq: 3, command: 'view:orient:0,0.4', continuous: true });
    socket.deliver({ type: 'cmd', seq: 4, command: 'view:orient:0,0.6', continuous: true });
    await harness.flush();

    expect(harness.commands).toEqual(['scene:beach', 'view:orient:0,0.6']);
  });

  it('resumes after a drop without replaying consumed commands', async () => {
    harness = createLink();
    harness.link.start();
    const first = harness.socket();
    first.emitOpen();
    first.deliver({ type: 'cmd', seq: 9, command: 'view:orient:0,0.2', continuous: true });
    await harness.flush();
    first.deliver({ type: 'cmd', seq: 10, command: 'scene:ward', continuous: false });
    await harness.flush();

    first.emitClose();
    expect(harness.statuses).toEqual(['open', 'closed']);
    vi.advanceTimersByTime(300);

    const second = harness.socket();
    expect(second).not.toBe(first);
    expect(second.url).toBe('ws://127.0.0.1:8130/ws?since=10');
    second.emitOpen();

    // Redelivered history is dropped; the gap is filled from `since`.
    second.deliver({ type: 'cmd', seq: 10, command: 'scene:ward', continuous: false });
    second.deliver({ type: 'cmd', seq: 11, command: 'posture:lower', continuous: false });
    await harness.flush();

    expect(harness.commands).toEqual(['view:orient:0,0.2', 'scene:ward', 'posture:lower']);
    expect(second.sent.filter((message) => message.type === 'ack')).toEqual([
      { type: 'ack', seq: 11 }
    ]);
  });

  it('backs off further on repeated failures', () => {
    harness = createLink();
    harness.link.start();
    harness.socket().emitClose();

    vi.advanceTimersByTime(300);
    const second = harness.socket();
    second.emitClose();
    vi.advanceTimersByTime(599);
    expect(harness.socket()).toBe(second);
    vi.advanceTimersByTime(1);
    expect(harness.socket()).not.toBe(second);
  });

  it('applies ready/control frames and clears control mode on a drop', () => {
    harness = createLink();
    harness.link.start();
    const socket = harness.socket();
    socket.emitOpen();
    socket.deliver({ type: 'ready', seq: 3, control: true, controller: 'AA:BB' });
    expect(harness.modes).toEqual([true]);

    socket.deliver({ type: 'control', control: false, controller: null });
    expect(harness.modes).toEqual([true, false]);

    socket.deliver({ type: 'ready', seq: 4, control: true, controller: 'AA:BB' });
    socket.emitClose();
    expect(harness.modes).toEqual([true, false, true, false]);
  });

  it('sends state at 1 Hz at rest and 5 Hz while the view animates', async () => {
    harness = createLink();
    harness.link.start();
    const socket = harness.socket();
    socket.emitOpen();
    socket.sent.length = 0;

    vi.advanceTimersByTime(3000);
    expect(socket.sent.filter((message) => message.type === 'state').length).toBe(3);

    viewAnim = 'pitch';
    // The next tick sees the animation and re-arms the cadence at 200 ms.
    vi.advanceTimersByTime(1000);
    socket.sent.length = 0;
    vi.advanceTimersByTime(1000);
    expect(socket.sent.filter((message) => message.type === 'state').length).toBe(5);
  });

  it('sends state at 5 Hz while the sit-up performance moves', () => {
    sitUpMoving = true;
    harness = createLink();
    harness.link.start();
    const socket = harness.socket();
    socket.emitOpen();
    socket.sent.length = 0;

    vi.advanceTimersByTime(1000);
    expect(socket.sent.filter((message) => message.type === 'state').length).toBe(5);
  });

  it('stays silent on the wire while the socket is not open', async () => {
    harness = createLink();
    harness.link.start();
    const socket = harness.socket();
    socket.deliver({ type: 'cmd', seq: 1, command: 'cue:on', continuous: false });
    await harness.flush();
    expect(harness.commands).toEqual(['cue:on']);
    expect(socket.sent).toEqual([]);
  });
});
