import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PortalLink,
  createOutageClock,
  noteOutageContinued,
  noteOutageRecovered,
  noteOutageStart,
  planControlDispatch,
  shouldSelfHeal,
  type PoseSnapshot,
  type StateSnapshot
} from '../src/app/portal-link';
import { degrees, metres, mix01 } from '../src/core/units';

const POSE: PoseSnapshot = { x: 0, y: 1.6, z: 0, yaw: 0.1, pitch: -0.2, roll: 0.05 };

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length(): number { return this.values.size; }
  clear(): void { this.values.clear(); }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  key(index: number): string | null { return Array.from(this.values.keys())[index] ?? null; }
  removeItem(key: string): void { this.values.delete(key); }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

const storage = new MemoryStorage();

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

  /**
   * A refused connection still fires `close` (with no `open` first) — that is
   * what drives the next backoff step. Tests that want a dead endpoint call
   * this on each attempt, exactly as the browser would.
   */
  failConnect(): void {
    this.emitClose();
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
    if (this.readyState === FakeSocket.CLOSED) {
      // A socket fires `close` once: a second emit would be a teardown the
      // page never schedules, and the link would look stuck on a stale timer.
      return;
    }
    this.readyState = FakeSocket.CLOSED;
    this.onclose?.({ target: this });
  }

  close(): void {
    this.emitClose();
  }
}

describe('planControlDispatch', () => {
  it('delivers a batch in seq order, dropping what was already consumed', () => {
    const plan = planControlDispatch(
      [
        { seq: 41, command: 'scene:ward' },
        { seq: 42, command: 'posture:rise' }
      ],
      -1
    );
    expect(plan.commands).toEqual([
      { seq: 41, command: 'scene:ward', replay: false },
      { seq: 42, command: 'posture:rise', replay: false }
    ]);
    expect(plan.nextSeq).toBe(42);

    const again = planControlDispatch(
      [
        { seq: 41, command: 'scene:ward' },
        { seq: 42, command: 'posture:rise' }
      ],
      plan.nextSeq
    );
    expect(again.commands).toEqual([]);
    expect(again.nextSeq).toBe(42);
  });

  it('sorts a reordered batch so no seq is stranded behind the cursor', () => {
    const plan = planControlDispatch(
      [
        { seq: 9, command: 'posture:stop' },
        { seq: 7, command: 'scene:shore' }
      ],
      5
    );
    expect(plan.commands.map((item) => item.seq)).toEqual([7, 9]);
    expect(plan.nextSeq).toBe(9);
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
    expect(live.commands).toEqual([{ seq: 13, command: 'view:anim:up', replay: false }]);
  });

  it('ignores malformed entries', () => {
    const plan = planControlDispatch(
      [
        // @ts-expect-error malformed wire data must not crash the link
        { seq: 3, command: 42 },
        { seq: 4, command: 'view:stop' }
      ],
      -1
    );
    expect(plan.commands).toEqual([{ seq: 4, command: 'view:stop', replay: false }]);
    expect(plan.nextSeq).toBe(4);
  });
});

describe('outage clock', () => {
  it('times the outage from its own start, not from page load', () => {
    const clock = createOutageClock();
    // The socket worked, then dropped 1 s before this attempt is made.
    noteOutageRecovered(clock);
    noteOutageStart(clock, 1000);
    expect(shouldSelfHeal(clock, 1100, 15000)).toBe(false);
    // Same page, far later: still the same outage, still inside the window.
    expect(shouldSelfHeal(clock, 15900, 15000)).toBe(false);
    expect(shouldSelfHeal(clock, 16100, 15000)).toBe(true);
  });

  it('never reloads a link that has not worked since the page loaded', () => {
    const clock = createOutageClock();
    // The very first attempt fails at t=0 and the page keeps retrying: this is
    // the case that used to reload after 15 s of uptime.
    for (const now of [0, 300, 5000, 30000, 120000]) {
      noteOutageContinued(clock, now);
      expect(shouldSelfHeal(clock, now, 15000)).toBe(false);
    }
  });

  it('restarts the outage on every recovery', () => {
    const clock = createOutageClock();
    noteOutageRecovered(clock);
    noteOutageStart(clock, 0);
    expect(shouldSelfHeal(clock, 20000, 15000)).toBe(true);

    noteOutageRecovered(clock);
    expect(shouldSelfHeal(clock, 21000, 15000)).toBe(false);
    // A later drop has to earn its own window from its own start.
    noteOutageStart(clock, 30000);
    expect(shouldSelfHeal(clock, 35000, 15000)).toBe(false);
    expect(shouldSelfHeal(clock, 46000, 15000)).toBe(true);
  });

  it('arms the reload once per outage', () => {
    const clock = createOutageClock();
    noteOutageRecovered(clock);
    noteOutageStart(clock, 0);
    expect(shouldSelfHeal(clock, 20000, 15000)).toBe(true);
    clock.reloadScheduled = true;
    expect(shouldSelfHeal(clock, 60000, 15000)).toBe(false);
  });
});

describe('PortalLink', () => {
  let viewAnim: StateSnapshot['viewAnim'] = 'idle';
  let sitUpMoving = false;

  function state(): StateSnapshot {
    return {
      scene: 'washroom',
      app: 'training',
      session: false,
      calibrating: false,
      audio: false,
      moving: false,
      eyeHeight: metres(1.6),
      mix: mix01(0),
      floatAmount: 1,
      breath: true,
      floatMm: 0,
      viewPitch: degrees(0),
      viewYaw: degrees(0),
      viewAnim,
      voiceId: -1,
      elapsedSec: 0,
      rampMs: 10000,
      calibrationConfidence: 0,
      worldQ: { x: 0, y: 0, z: 0 },
      worldT: { x: metres(0), y: metres(0), z: metres(0) },
      caps: {
        rise: false,
        lie: false,
        stop: false,
        float: true,
        view: true,
        blocked: '',
        floatCap: 1
      }
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
    vi.useFakeTimers({
      toFake: [
        'setTimeout',
        'clearTimeout',
        'setInterval',
        'clearInterval',
        // The self-heal window is measured on `performance.now()`; without
        // faking it the outage clock would read real time and never advance.
        'performance'
      ]
    });
    // The page reads `window.performance.now()`; `globalThis` is not the
    // faked clock, so the window object has to carry the faked one explicitly.
    // `WebSocket` is looked up the same way, so it rides on the same object.
    vi.stubGlobal('window', { ...globalThis, performance, WebSocket: FakeSocket, localStorage: storage });
    vi.stubGlobal('WebSocket', FakeSocket);
    storage.clear();
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

  it('acks every command and refreshes state after each batch', async () => {
    harness = createLink();
    harness.link.start();
    const socket = harness.socket();
    socket.emitOpen();
    socket.sent.length = 0;

    socket.deliver({ type: 'cmd', seq: 4, command: 'view:anim:up' });
    socket.deliver({ type: 'cmd', seq: 5, command: 'posture:rise' });
    await harness.flush();
    expect(harness.commands).toEqual(['view:anim:up', 'posture:rise']);
    expect(socket.sent.map((message) => message.type)).toEqual(['ack', 'ack', 'state']);
    expect(socket.sent[0]).toEqual({ type: 'ack', seq: 4 });
    expect(socket.sent[1]).toEqual({ type: 'ack', seq: 5 });
  });

  it('dispatches a burst in arrival order', async () => {
    harness = createLink();
    harness.link.start();
    const socket = harness.socket();
    socket.emitOpen();

    socket.deliver({ type: 'cmd', seq: 1, command: 'view:anim:up' });
    socket.deliver({ type: 'cmd', seq: 2, command: 'scene:shore' });
    socket.deliver({ type: 'cmd', seq: 3, command: 'posture:stop' });
    await harness.flush();

    expect(harness.commands).toEqual(['view:anim:up', 'scene:shore', 'posture:stop']);
  });

  it('resumes after a drop without replaying consumed commands', async () => {
    harness = createLink();
    harness.link.start();
    const first = harness.socket();
    first.emitOpen();
    first.deliver({ type: 'cmd', seq: 9, command: 'view:anim:recenter' });
    await harness.flush();
    first.deliver({ type: 'cmd', seq: 10, command: 'scene:ward' });
    await harness.flush();

    first.emitClose();
    expect(harness.statuses).toEqual(['open', 'closed']);
    vi.advanceTimersByTime(300);

    const second = harness.socket();
    expect(second).not.toBe(first);
    expect(second.url).toBe('ws://127.0.0.1:8130/ws?since=10');
    second.emitOpen();

    // Redelivered history is dropped; the gap is filled from `since`.
    second.deliver({ type: 'cmd', seq: 10, command: 'scene:ward' });
    second.deliver({ type: 'cmd', seq: 11, command: 'posture:lower' });
    await harness.flush();

    expect(harness.commands).toEqual(['view:anim:recenter', 'scene:ward', 'posture:lower']);
    expect(second.sent.filter((message) => message.type === 'ack')).toEqual([
      { type: 'ack', seq: 11 }
    ]);
  });

  it('retains a session across a drop until the portal acknowledges it', () => {
    harness = createLink();
    harness.link.start();
    const first = harness.socket();
    first.emitOpen();
    harness.link.sendSession({ at: 123, stop: 'link-lost' });

    const sent = first.sent.find((message) => message.type === 'session');
    expect(sent).toBeDefined();
    const id = sent?.id;
    expect(typeof id).toBe('string');

    // The socket closes before any acknowledgement. The record is still local
    // and goes out again on the next connection.
    first.emitClose();
    vi.advanceTimersByTime(300);
    const second = harness.socket();
    second.emitOpen();
    expect(second.sent.find((message) => message.type === 'session' && message.id === id)).toBeDefined();

    second.deliver({ type: 'recordAck', id });
    second.emitClose();
    vi.advanceTimersByTime(300);
    const third = harness.socket();
    third.emitOpen();
    expect(third.sent.find((message) => message.type === 'session')).toBeUndefined();
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

    viewAnim = 'playing';
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
    socket.deliver({ type: 'cmd', seq: 1, command: 'home', continuous: false });
    await harness.flush();
    expect(harness.commands).toEqual(['home']);
    expect(socket.sent).toEqual([]);
  });

  it('reloads only after one continuous outage, never on the page\'s uptime', () => {
    const reload = vi.fn();
    vi.stubGlobal('location', { ...window.location, reload });
    vi.stubGlobal('sessionStorage', {
      getItem: () => null,
      setItem: () => void 0
    });

    // The reported order: the page runs for 30 s, then the socket drops once.
    harness = createLink();
    harness.link.start();
    harness.socket().emitOpen();
    vi.advanceTimersByTime(30000);
    harness.socket().emitClose();

    // The first retry comes back almost immediately; a loopback glitch that is
    // over by then must not reload the page the patient is using, however long
    // the page itself has been open.
    vi.advanceTimersByTime(300);
    expect(FakeSocket.instances.at(-1)).not.toBe(undefined);
    expect(reload).not.toHaveBeenCalled();
  });

  /** Point every retry at a dead endpoint and step the page clock. */
  function runOutage(ms: number): void {
    for (let elapsed = 0; elapsed < ms; elapsed += 500) {
      vi.advanceTimersByTime(500);
      const socket = harness.socket();
      // The retry timer creates the attempt; failing it schedules the next.
      if (socket.readyState === FakeSocket.CONNECTING) {
        socket.failConnect();
      }
    }
  }

  it('reloads a proved link that stays down past the threshold', () => {
    const reload = vi.fn();
    const location = { ...globalThis.location, reload };
    vi.stubGlobal('location', location);
    vi.stubGlobal('window', { ...window, location });
    vi.stubGlobal('sessionStorage', {
      getItem: () => null,
      setItem: () => void 0
    });

    harness = createLink();
    harness.link.start();
    harness.socket().emitOpen();
    harness.socket().emitClose();
    // Backoff tops out at 5 s, so 14 s of refused retries is still one outage
    // short of the window.
    runOutage(14000);
    expect(reload).not.toHaveBeenCalled();

    // Cross the threshold; the reload itself is deferred one tick.
    runOutage(4000);
    vi.advanceTimersByTime(200);
    expect(reload).toHaveBeenCalledTimes(1);

    // A further refusal in the same outage does not arm a second reload.
    runOutage(6000);
    vi.advanceTimersByTime(200);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('restarts the outage window when the link comes back', () => {
    const reload = vi.fn();
    const location = { ...globalThis.location, reload };
    vi.stubGlobal('location', location);
    vi.stubGlobal('window', { ...window, location });
    vi.stubGlobal('sessionStorage', {
      getItem: () => null,
      setItem: () => void 0
    });

    harness = createLink();
    harness.link.start();
    harness.socket().emitOpen();
    harness.socket().emitClose();
    // 14 s of refusals: inside the window, no reload yet.
    runOutage(14000);
    expect(reload).not.toHaveBeenCalled();

    // The tablet answers, so this outage is over and the clock resets: the
    // next drop has to earn its own 15 s from its own start.
    harness.socket().emitOpen();
    harness.socket().emitClose();
    runOutage(14000);
    expect(reload).not.toHaveBeenCalled();
    runOutage(4000);
    vi.advanceTimersByTime(200);
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
