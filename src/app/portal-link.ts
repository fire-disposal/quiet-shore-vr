import type { SceneSnapshot } from '../core/scene/snapshot';
import type { ViewAnimState, ViewPresetCode } from '../core/xr/view-motion';

export type RemoteCommandHandler = (command: string) => void;
export type ControlModeHandler = (active: boolean) => void;
export type LinkStatusHandler = (status: 'open' | 'closed') => void;

export interface PoseSnapshot {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
}

/**
 * `/state` payload: the documented wire fields only, built from the collected
 * scene snapshot. `viewPitch` is the CURRENT applied up-gaze in signed degrees
 * (positive = 上仰), `posturePitch`/`postureRoll` are the measured world tilt
 * of the base layer, and `viewAnim` is the playback state. The wire keys are
 * frozen; the removed translation fields (`viewX`/`viewZ`) must never reappear.
 */
export interface StateSnapshot {
  scene: string;
  session: boolean;
  calibrating: boolean;
  audio: boolean;
  eyeHeight: number;
  /** Applied world rotation, Euler XYZ degrees; the mirror's inverse offset. */
  worldYaw: number;
  worldPitch: number;
  worldRoll: number;
  posturePitch: number;
  postureRoll: number;
  postureRise: number;
  postureProgress: number;
  viewPitch: number;
  viewYaw: number;
  viewAnim: ViewAnimState;
  viewPreset: ViewPresetCode;
  cueEnabled: boolean;
  cueIntensity: number;
  calibrationConfidence: number;
}

/** One page command as delivered on the control socket. */
export interface PortalCommand {
  seq: number;
  command: string;
  continuous?: boolean;
  /** Explicitly marked by the server as replayed history. */
  replay?: boolean;
}

export interface PlannedCommand {
  seq: number;
  command: string;
  /** Discrete commands are acked; continuous samples are not. */
  discrete: boolean;
}

export interface DispatchPlan {
  /** Highest seq consumed; feed this back as `since` on the next connect. */
  nextSeq: number;
  /** Commands to deliver, in order, already deduped and coalesced. */
  commands: PlannedCommand[];
}

/**
 * Same-origin derived URL: the headset serves the page and the socket from
 * 127.0.0.1:8130, while the dev server (8125) can host a mock socket without a
 * separate hard-coded port. Never cross origins.
 */
function wsUrl(): string {
  const location = window.location;
  if (!location || !location.host) {
    // Non-browser/test fallback: production always has a same-origin host.
    return 'ws://127.0.0.1:8130/ws';
  }
  const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${scheme}://${location.host}/ws`;
}
const VIEW_ORIENT_PREFIX = 'view:orient:';
const VIEW_ANIM_PREFIX = 'view:anim:';

const POSE_MS = 200;
const STATE_MS = 1000;
/** Denser readback while a view animation or a sit-up transition is moving. */
const STATE_MOVING_MS = 200;
const RECONNECT_BASE_MS = 300;
const RECONNECT_MAX_MS = 5000;

/** Map the collected snapshot onto the widget state payload. */
export function stateFromSnapshot(snapshot: SceneSnapshot): StateSnapshot {
  return {
    scene: snapshot.sceneId,
    session: snapshot.session,
    calibrating: snapshot.calibrating,
    audio: snapshot.audioMuted,
    eyeHeight: snapshot.eyeHeight,
    worldYaw: snapshot.appliedWorldYawDeg,
    worldPitch: snapshot.appliedWorldPitchDeg,
    worldRoll: snapshot.appliedWorldRollDeg,
    posturePitch: snapshot.worldPitchDeg,
    postureRoll: snapshot.worldRollDeg,
    postureRise: snapshot.postureRiseM,
    postureProgress: snapshot.postureProgress,
    viewPitch: snapshot.upGazeDeg,
    viewYaw: snapshot.lookYawDeg,
    viewAnim: snapshot.viewAnim,
    viewPreset: snapshot.viewPreset,
    cueEnabled: snapshot.cueEnabled,
    cueIntensity: snapshot.cueIntensity,
    calibrationConfidence: snapshot.calibrationConfidence
  };
}

/**
 * Pure dispatch planning for one batch of socket commands: drops everything at
 * or below `lastSeq`, never replays a history `view:anim:*` (one-shot presets),
 * and coalesces every continuous `view:orient` in the batch to its latest sample
 * while the discrete commands keep their arrival order.
 */
export function planControlDispatch(
  batch: readonly PortalCommand[],
  lastSeq: number
): DispatchPlan {
  const frames: (PlannedCommand & { replay: boolean })[] = [];
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
    frames.push({
      seq,
      command,
      // A `view:orient` sample is continuous even if the flag is missing.
      discrete: entry.continuous !== true && !command.startsWith(VIEW_ORIENT_PREFIX),
      replay: entry.replay === true
    });
  }
  // Commands arrive ordered; sorting keeps a reordered batch from stranding a
  // lower seq behind `lastSeq` forever.
  frames.sort((a, b) => a.seq - b.seq);

  let latestMoveSeq = Number.NaN;
  for (const frame of frames) {
    if (frame.seq > lastSeq && !frame.discrete) {
      latestMoveSeq = frame.seq;
    }
  }

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
    if (!frame.discrete && frame.seq !== latestMoveSeq) {
      continue;
    }
    commands.push({ seq: frame.seq, command: frame.command, discrete: frame.discrete });
  }
  return { nextSeq, commands };
}

/**
 * Single control link to the portal: one WebSocket carries commands down and
 * state/telemetry up.
 *
 * Commands arrive as ordered `cmd` messages; each batch is deduped by seq and
 * coalesced before dispatch, a discrete command is acked and followed by an
 * immediate state frame, and continuous `view:orient` samples are never acked.
 * The socket reconnects with exponential backoff using `since=lastSeq`, so a
 * drop resumes the stream without replaying what this page already ran. There
 * is no fallback transport: a closed socket halts operator motion until the
 * link is back.
 */
export class PortalLink {
  private socket: WebSocket | null = null;
  private retryTimer: number | null = null;
  private poseTimer: number | null = null;
  private stateTimer: number | null = null;
  private retries = 0;
  private running = false;
  private flushScheduled = false;
  private pending: PortalCommand[] = [];
  private lastSeq = -1;
  private controlMode = false;

  constructor(
    private readonly onCommand: RemoteCommandHandler,
    private readonly onControlMode: ControlModeHandler,
    private readonly getPose: () => PoseSnapshot,
    private readonly getState: () => StateSnapshot,
    /** True while motion outside the state payload (sit-up) is running. */
    private readonly isMotionActive: () => boolean,
    /** Connection faults are surfaced so the page can tell the operator. */
    private readonly onLinkStatus: LinkStatusHandler = () => void 0
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

  /** Immediate readback after an accepted discrete command. */
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
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;
    socket.onopen = this.handleOpen;
    socket.onmessage = this.handleMessage;
    socket.onclose = this.handleClose;
  }

  private scheduleReconnect(): void {
    if (!this.running || this.retryTimer != null) {
      return;
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
    this.onLinkStatus('open');
    // Refresh the readback the moment the link is usable again.
    this.sendStateNow();
  };

  private readonly handleClose = (event: CloseEvent): void => {
    const socket = this.socket;
    if (!socket || event.target !== socket) {
      return;
    }
    this.socket = null;
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
        continuous: 'continuous' in message && message.continuous === true,
        replay: 'replay' in message && message.replay === true
      });
      this.scheduleFlush();
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
    let discrete = false;
    for (const item of plan.commands) {
      this.onCommand(item.command);
      if (!item.discrete) {
        continue;
      }
      discrete = true;
      this.send({ type: 'ack', seq: item.seq });
    }
    if (discrete) {
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
    if (![pose.x, pose.y, pose.z, pose.yaw, pose.pitch].every(Number.isFinite)) {
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
