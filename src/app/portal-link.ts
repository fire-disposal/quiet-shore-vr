import type { SceneSnapshot } from '../core/scene/snapshot';
import type { ViewAnimState } from '../core/xr/view-motion';
import type { Degrees, Metres, Mix01, QuatXyz, Vec3 } from '../core/units';
import {
  createReliableRecordOutbox,
  type ReliableRecord,
  type ReliableRecordMessage
} from './reliable-records';

export type RemoteCommandHandler = (command: string) => void;
export type ControlModeHandler = (active: boolean) => void;
export type LinkStatusHandler = (status: 'open' | 'closed') => void;

export interface PoseSnapshot {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  /** Head roll; without it the mirror cannot show a tilted head. */
  roll: number;
}

/**
 * `/state` payload: the documented QS2 wire fields only, built from the
 * collected scene snapshot. Units are branded, so a centimetre/degree slip is
 * a compile error. `mix` is the one posture scalar (rotation and eye height),
 * `worldQ`/`worldT` are the applied world transform the mirror inverts, and the
 * retired fields (`posturePitch`, `postureRise`, `postureProgress`, `swayDeg`,
 * `viewPreset`, `worldYaw/Pitch/Roll`) must never reappear.
 */
export interface StateSnapshot {
  readonly scene: string;
  /** Product face the headset is actually running. */
  readonly app: string;
  readonly session: boolean;
  readonly calibrating: boolean;
  readonly audio: boolean;
  /** A posture ramp or a view animation is running right now. */
  readonly moving: boolean;
  /** Applied eye height, metres (lying..standing by mix). */
  readonly eyeHeight: Metres;
  /** The one posture scalar: 0 lying, 1 standing. */
  readonly mix: Mix01;
  /** The heave as a fraction of the envelope, 0–1. */
  readonly floatAmount: number;
  /** The breathing switch as a boolean: off means a plain sine. */
  readonly breath: boolean;
  /** Applied buoyancy offset, millimetres. */
  readonly floatMm: number;
  /** Currently applied view angles, degrees. */
  readonly viewPitch: Degrees;
  readonly viewYaw: Degrees;
  readonly viewAnim: ViewAnimState;
  readonly voiceId: number;
  readonly elapsedSec: number;
  /** Ramp length the page will use next, milliseconds. */
  readonly rampMs: number;
  /** True once the orientation phase is over; the capture key opens then. */
  readonly adaptationDone: boolean;
  readonly calibrationConfidence: number;
  /** Applied world rotation, xyz only: `w` is derived by the reader. */
  readonly worldQ: QuatXyz;
  /** Applied world translation, metres, device frame. */
  readonly worldT: Vec3<Metres>;
  /** Motion-plan capabilities: the tablet enables controls from these. */
  readonly caps: Readonly<{
    rise: boolean;
    lie: boolean;
    stop: boolean;
    float: boolean;
    view: boolean;
    blocked: string;
    /** Highest buoyancy level this scene allows (1..3), so a stepper can clamp. */
    /** The loaded scene's own ceiling, 0–1. */
    floatCap: number;
  }>;
}

export interface PortalCommand {
  seq: number;
  command: string;
  /** Explicitly marked by the server as replayed history. */
  replay?: boolean;
}

export interface PlannedCommand {
  seq: number;
  command: string;
  /** Replayed history: `view:anim:*` is one-shot and is skipped. */
  replay?: boolean;
}

export interface DispatchPlan {
  /** Highest seq consumed; feed this back as `since` on the next connect. */
  nextSeq: number;
  /** Commands to deliver, in order, already deduped. */
  commands: PlannedCommand[];
}

function wsUrl(): string {
  const location = window.location;
  if (!location || !location.host) {
    // Non-browser/test fallback: production always has a same-origin host.
    return 'ws://127.0.0.1:8130/ws';
  }
  const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${scheme}://${location.host}/ws`;
}

const VIEW_ANIM_PREFIX = 'view:anim:';

const POSE_MS = 200;
const STATE_MS = 1000;
/** Denser readback while a posture ramp or a view animation is moving. */
const STATE_MOVING_MS = 200;
const RECONNECT_BASE_MS = 300;
/** After this long without a socket the page reloads itself once. */
const SELF_HEAL_MS = 15000;
const RECONNECT_MAX_MS = 5000;
/** The reload is deferred briefly so the close handler returns first. */
const RELOAD_DELAY_MS = 200;
/** A reload that did not help must not repeat immediately (per page session). */
const RELOAD_MIN_GAP_MS = 30000;

/**
 * One continuous outage of the link, as a clock of its own.
 *
 * The self-heal window is measured from the moment this outage began, never
 * from page load and never from the last good connection: a page that has been
 * open for half a minute is not evidence that the socket is unreachable. Only
 * a run of failed attempts that started *after* a proved connection counts,
 * and a single recovered connection disarms the reload for the rest of the
 * page's life (the reload is a last resort, not a loop).
 */
export interface OutageClock {
  /** `performance.now()` of the first failed attempt, or null when idle. */
  since: number | null;
  /** A connection has been proved: the primary endpoint is not wrong. */
  proved: boolean;
  /** The reload has already been handed to the browser. */
  reloadScheduled: boolean;
}

export function createOutageClock(): OutageClock {
  return { since: null, proved: false, reloadScheduled: false };
}

/** A dropped socket: start the outage after a proved link, keep it otherwise. */
export function noteOutageStart(clock: OutageClock, now: number): void {
  if (clock.proved && clock.since === null) {
    clock.since = now;
  }
}

/** A failed attempt that followed a `close`: the outage is continuous. */
export function noteOutageContinued(clock: OutageClock, now: number): void {
  noteOutageStart(clock, now);
}

/** The socket opened: this outage is over, and a reload is no longer useful. */
export function noteOutageRecovered(clock: OutageClock): void {
  clock.since = null;
  clock.proved = true;
}

/**
 * Whether this failed attempt should reload the page: a continuous outage past
 * the threshold, on a link that had already worked, and not yet reloaded.
 */
export function shouldSelfHeal(
  clock: OutageClock,
  now: number,
  thresholdMs: number = SELF_HEAL_MS
): boolean {
  if (!clock.proved || clock.reloadScheduled) {
    return false;
  }
  if (clock.since === null) {
    return false;
  }
  return now - clock.since > thresholdMs;
}

/** Map the collected snapshot onto the widget state payload. */
export function stateFromSnapshot(snapshot: SceneSnapshot): StateSnapshot {
  return {
    scene: snapshot.sceneId,
    app: snapshot.app,
    session: snapshot.session,
    calibrating: snapshot.calibrating,
    audio: snapshot.audioMuted,
    moving: snapshot.correctionMoving || snapshot.viewAnim !== 'idle',
    eyeHeight: snapshot.eyeHeight,
    mix: snapshot.mix,
    floatAmount: snapshot.floatAmount,
    breath: snapshot.floatBreath >= 0.5,
    floatMm: snapshot.floatMm,
    viewPitch: snapshot.upGazeDeg,
    viewYaw: snapshot.lookYawDeg,
    viewAnim: snapshot.viewAnim,
    voiceId: snapshot.voiceId,
    elapsedSec: snapshot.sessionSec,
    rampMs: snapshot.rampMs,
    adaptationDone: snapshot.adaptationDone,
    calibrationConfidence: snapshot.calibrationConfidence,
    worldQ: {
      x: snapshot.worldQuat.x,
      y: snapshot.worldQuat.y,
      z: snapshot.worldQuat.z
    },
    worldT: snapshot.worldT as Vec3<Metres>,
    // `satisfies` keeps the payload shape and the plan's type in lockstep.
    caps: {
      rise: snapshot.caps.rise,
      lie: snapshot.caps.lie,
      stop: snapshot.caps.stop,
      float: snapshot.caps.float,
      view: snapshot.caps.view,
      blocked: snapshot.caps.blocked,
      floatCap: snapshot.caps.floatCap
    } satisfies StateSnapshot['caps']
  };
}

/**
 * Pure dispatch planning for one batch of socket commands: drops everything at
 * or below `lastSeq`, never replays a history `view:anim:*` (a one-shot preset),
 * and keeps the arrival order. There is no continuous lane any more — every
 * command the tablet sends is discrete.
 */
export function planControlDispatch(
  batch: readonly PortalCommand[],
  lastSeq: number
): DispatchPlan {
  const frames: PlannedCommand[] = [];
  for (const entry of batch) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }
    const { seq, command } = entry;
    if (typeof seq !== 'number' || !Number.isFinite(seq)) {
      continue;
    }
    if (typeof command !== 'string' || command.length === 0) {
      continue;
    }
    frames.push({ seq, command, replay: entry.replay === true });
  }
  // Commands arrive ordered; sorting keeps a reordered batch from stranding a
  // lower seq behind `lastSeq` forever.
  frames.sort((a, b) => a.seq - b.seq);

  const commands: PlannedCommand[] = [];
  let nextSeq = lastSeq;
  for (const frame of frames) {
    if (frame.seq <= nextSeq) {
      continue;
    }
    nextSeq = frame.seq;
    if (frame.replay && frame.command.startsWith(VIEW_ANIM_PREFIX)) {
      continue;
    }
    commands.push(frame);
  }
  return { nextSeq, commands };
}

/**
 * Single control link to the portal: one WebSocket carries commands down and
 * state/telemetry up.
 *
 * Commands arrive as ordered `cmd` messages; each batch is deduped by seq
 * before dispatch, every command is acked and followed by an immediate state
 * frame, and a replayed `view:anim:*` is skipped (it is one-shot).
 * The socket reconnects with exponential backoff using `since=lastSeq`, so a
 * drop resumes the stream without replaying what this page already ran. There
 * is no fallback transport: a closed socket halts operator motion until the
 * link is back.
 */
/** Headset battery, 0–100 plus whether it is charging. */
export type BatteryHandler = (level: number, charging: boolean) => void;

let fallbackRecordSequence = 0;

function nextRecordId(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return uuid;
  fallbackRecordSequence += 1;
  return `${Date.now().toString(36)}-${fallbackRecordSequence.toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function recordStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export class PortalLink {
  private socket: WebSocket | null = null;
  private retryTimer: number | null = null;
  private poseTimer: number | null = null;
  private stateTimer: number | null = null;
  private retries = 0;
  /** The current outage, measured on its own clock (see `OutageClock`). */
  private readonly outage = createOutageClock();
  private running = false;
  private flushScheduled = false;
  private pending: PortalCommand[] = [];
  private lastSeq = -1;
  private controlMode = false;
  private readonly records = createReliableRecordOutbox(recordStorage(), nextRecordId);

  constructor(
    private readonly onCommand: RemoteCommandHandler,
    private readonly onControlMode: ControlModeHandler,
    private readonly getPose: () => PoseSnapshot,
    private readonly getState: () => StateSnapshot,
    /** True while motion outside the state payload (sit-up) is running. */
    private readonly isMotionActive: () => boolean,
    /** Connection faults are surfaced so the page can tell the operator. */
    private readonly onLinkStatus: LinkStatusHandler = () => void 0,
    /** The headset's own battery, pushed by the portal on every change. */
    private readonly onBattery: BatteryHandler = () => void 0
  ) {}

  start(): void {
    if (this.running) {
      return;
    }
    this.running = true;
    this.connect();
    this.poseTimer = window.setInterval(() => this.sendPose(), POSE_MS);
    this.scheduleState(this.sendState() ? STATE_MOVING_MS : STATE_MS);
  }

  stop(): void {
    this.running = false;
    this.pending = [];
    if (this.poseTimer != null) {
      window.clearInterval(this.poseTimer);
      this.poseTimer = null;
    }
    if (this.stateTimer != null) {
      window.clearTimeout(this.stateTimer);
      this.stateTimer = null;
    }
    if (this.retryTimer != null) {
      window.clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    const socket = this.socket;
    this.socket = null;
    socket?.close();
  }

  /** One-off payload towards the tablet through the headset's JSON channel. */
  /**
   * The scene catalogue, pushed once per connection.
   *
   * The page owns it because the page is what actually builds scenes; the
   * tablet and the headset app only render what they are told. Adding a scene
   * is therefore one entry here, not a new id in three Kotlin maps.
   */
  sendCatalog(scenes: readonly unknown[]): void {
    this.send({ type: 'catalog', data: { scenes } });
  }

  sendSus(data: unknown): void {
    this.sendReliable({ type: 'sus', data });
  }

  /**
   * One behaviour event the tablet's own log cannot infer.
   *
   * Commands travel tablet → page, so the tablet knows what it asked for; only
   * the page knows what actually happened — a capture that landed, a scene
   * that swapped, a session that the patient ended with the confirm key. Those
   * go up as `log` and join the same ledger as the presses.
   */
  sendLog(app: string, kind: string, detail?: Record<string, unknown>): void {
    this.sendReliable({ type: 'log', app, data: { kind, d: detail ?? {} } });
  }


  /**
   * The questionnaire catalogue, pushed once per connection like the scenes.
   * One registry on the page feeds the headset card and the tablet's list.
   */
  sendQuestionnaire(questionnaires: readonly unknown[]): void {
    this.send({ type: 'questionnaire', data: { questionnaires } });
  }

  /**
   * One finished training session for the tablet's shared record store. The
   * page already keeps it locally; this is the copy the control side exports.
   */
  sendSession(summary: unknown): void {
    this.sendReliable({ type: 'session', data: summary });
  }

  private sendReliable(message: ReliableRecordMessage): void {
    const record = this.records.add(message);
    this.sendRecord(record);
  }

  private sendRecord(record: ReliableRecord): void {
    this.send({ ...record.message, id: record.id });
  }

  /**
   * One-off report for the operator: a refusal, or a fact the state frame has
   * no room for. The headset relays it to the tablet over BLE; the page is the
   * only place that knows *why* a command did not take effect.
   */
  sendNotice(text: string, tone: 'ok' | 'error' = 'ok'): void {
    this.send({ type: 'notice', text, tone });
  }

  sendStateNow(): void {
    const moving = this.sendState();
    if (this.stateTimer == null) {
      return;
    }
    // Restart the cadence from now so a command that starts motion is
    // followed at 5 Hz instead of waiting out the rest interval.
    window.clearTimeout(this.stateTimer);
    this.scheduleState(moving ? STATE_MOVING_MS : STATE_MS);
  }

  private connect(): void {
    if (!this.running) {
      return;
    }
    if (typeof WebSocket === 'undefined') {
      // No fallback transport: the page cannot talk to the portal here.
      this.onLinkStatus('closed');
      return;
    }
    let socket: WebSocket;
    try {
      socket = new WebSocket(`${wsUrl()}?since=${this.lastSeq}`);
    } catch {
      this.onLinkStatus('closed');
      this.noteAttemptFailed();
      return;
    }
    this.socket = socket;
    socket.onopen = this.handleOpen;
    socket.onmessage = this.handleMessage;
    socket.onclose = this.handleClose;
  }

  /** A socket could not be created at all: one failed attempt, then back off. */
  private noteAttemptFailed(): void {
    this.noteFailedAttempt();
    this.scheduleReconnect();
  }

  private noteFailedAttempt(): void {
    noteOutageContinued(this.outage, performance.now());
  }

  private scheduleReconnect(): void {
    if (!this.running || this.retryTimer != null) {
      return;
    }
    // A page whose socket never comes back is unreachable forever: the loopback
    // server can restart while the tab stays open. Reloading the tab is the only
    // recovery the page can do by itself — but only once *this* outage, timed
    // from its own start, has outlasted the threshold. Measuring from page load
    // (or from a connection that never happened) turned any short glitch on an
    // idle page into a reload that interrupts the session.
    const now = performance.now();
    if (shouldSelfHeal(this.outage, now, SELF_HEAL_MS)) {
      // The reload is armed once per outage: if storage refuses the own-record
      // write below, the second attempt is still the same outage.
      this.outage.reloadScheduled = true;
      try {
        const KEY = 'qs:lastReload';
        // "No record" is not "reloaded at page start": reading a missing
        // session value as 0 put a 30 s uptime gate in front of the reload and
        // stalled a page that had only just loaded from ever healing itself.
        const stored = window.sessionStorage?.getItem(KEY) ?? null;
        const last = stored === null ? Number.NaN : Number(stored);
        if (!Number.isFinite(last) || now - last > RELOAD_MIN_GAP_MS) {
          window.sessionStorage?.setItem(KEY, String(now));
          window.setTimeout(() => window.location.reload(), RELOAD_DELAY_MS);
          return;
        }
      } catch {
        // Storage can be unavailable (private mode, tests): retry normally.
      }
    }
    this.retries += 1;
    const delay = Math.min(
      RECONNECT_BASE_MS * 2 ** (this.retries - 1),
      RECONNECT_MAX_MS
    );
    this.retryTimer = window.setTimeout(() => {
      this.retryTimer = null;
      this.connect();
    }, delay);
  }

  private readonly handleOpen = (): void => {
    // A delivered connection proves the endpoint; forget past failures.
    this.retries = 0;
    noteOutageRecovered(this.outage);
    this.onLinkStatus('open');
    // Refresh the readback the moment the link is usable again.
    this.sendStateNow();
    // Records remain persisted until the portal acknowledges their forwarding.
    for (const record of this.records.pending()) {
      this.sendRecord(record);
    }
  };

  private readonly handleClose = (event: CloseEvent): void => {
    const socket = this.socket;
    if (!socket || event.target !== socket) {
      return;
    }
    this.socket = null;
    this.noteFailedAttempt();
    if (!this.running) {
      return;
    }
    // A closed link cannot prove the lease holder still controls or that
    // latched motion is still wanted.
    this.applyControl(false);
    this.onLinkStatus('closed');
    this.scheduleReconnect();
  };

  private readonly handleMessage = (event: MessageEvent): void => {
    if (!this.running) {
      return;
    }
    const data = event.data;
    if (typeof data !== 'string') {
      return;
    }
    let message: unknown;
    try {
      message = JSON.parse(data);
    } catch {
      return;
    }
    if (!message || typeof message !== 'object' || !('type' in message)) {
      return;
    }
    const type = message.type;
    if (type === 'cmd') {
      if (!('seq' in message) || !('command' in message)) {
        return;
      }
      const seq = message.seq;
      const command = message.command;
      if (typeof seq !== 'number' || !Number.isFinite(seq)) {
        return;
      }
      if (typeof command !== 'string' || command.length === 0) {
        return;
      }
      this.pending.push({
        seq,
        command,
        replay: 'replay' in message && message.replay === true
      });
      this.scheduleFlush();
      return;
    }
    if (type === 'recordAck') {
      const id = 'id' in message ? message.id : undefined;
      if (typeof id === 'string') {
        this.records.acknowledge(id);
      }
      return;
    }
    if (type === 'battery') {
      const data = 'data' in message ? message.data : undefined;
      const level = data && typeof data === 'object' && 'level' in data ? data.level : undefined;
      const charging =
        data && typeof data === 'object' && 'charging' in data ? data.charging === true : false;
      if (typeof level === 'number' && Number.isFinite(level)) {
        this.onBattery(Math.round(level), charging);
      }
      return;
    }
    if (type === 'ready' || type === 'control') {
      // `ready.seq` is the server's newest seq, but history is replayed as
      // `cmd` frames above our `since`; moving the cursor here would drop them.
      this.applyControl('control' in message ? message.control : undefined);
    }
  };

  /**
   * Commands are drained together so a burst (reconnect replay, several queued
   * frames) yields one dispatch: the latest continuous sample survives, no
   * discrete command is dropped and the arrival order is kept.
   */
  private scheduleFlush(): void {
    if (this.flushScheduled) {
      return;
    }
    this.flushScheduled = true;
    queueMicrotask(this.flush);
  }

  private readonly flush = (): void => {
    this.flushScheduled = false;
    const batch = this.pending;
    this.pending = [];
    if (!this.running || batch.length === 0) {
      return;
    }
    const plan = planControlDispatch(batch, this.lastSeq);
    this.lastSeq = plan.nextSeq;
    for (const item of plan.commands) {
      this.onCommand(item.command);
      this.send({ type: 'ack', seq: item.seq });
    }
    if (plan.commands.length > 0) {
      this.sendStateNow();
    }
  };

  private applyControl(control: unknown): void {
    if (typeof control !== 'boolean' || control === this.controlMode) {
      return;
    }
    this.controlMode = control;
    this.onControlMode(control);
  }

  private scheduleState(delayMs: number): void {
    this.stateTimer = window.setTimeout(this.onStateTick, delayMs);
  }

  private readonly onStateTick = (): void => {
    this.stateTimer = null;
    this.scheduleState(this.sendState() ? STATE_MOVING_MS : STATE_MS);
  };

  /** Posts one state frame and reports whether motion keeps the fast cadence. */
  private sendState(): boolean {
    const state = this.getState();
    this.send({ type: 'state', data: state });
    return state.viewAnim !== 'idle' || this.isMotionActive();
  }

  private sendPose(): void {
    const pose = this.getPose();
    if (![pose.x, pose.y, pose.z, pose.yaw, pose.pitch, pose.roll].every(Number.isFinite)) {
      return;
    }
    this.send({ type: 'telemetry', data: pose });
  }

  private send(message: unknown): void {
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return;
    }
    socket.send(JSON.stringify(message));
  }
}
