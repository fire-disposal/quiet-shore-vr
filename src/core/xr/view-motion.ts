/**
 * System-level owner of the operator's view orientation.
 *
 * Two independent channels, both in signed degrees and both patient-centric:
 * - `lookYawDeg`: + = the patient's view turns left;
 * - `upGazeDeg`: + = the patient sees more sky.
 *
 * The world layer rotates the opposite way on both axes, so `viewToWorld` is
 * the only place a sign flips. The controller knows nothing about scenes,
 * comfort, sit-up or XR: it advances two scalars and reports them through a
 * sink. That is why the same controller survives scene switches and only needs
 * the sink rebound under it.
 *
 * ```text
 * idle    --play / setTarget-->  playing --reached--> idle
 * playing --stop / lease loss--> held    (freeze; no easing, no recenter)
 * held    --play / setTarget-->  playing (from the current angle, never a snap)
 * any     --reset-->             idle at 0°, 0° (session end, calibration start)
 * ```
 *
 * Precedence is enforced by the caller (session supervisor), not here:
 * patient stop > lease loss > session end / calibration reset > explicit view
 * command > completion. The controller only guarantees that `stop()` is
 * immediate and never eases.
 */

import { clampSigned } from './angle';
import { cycle, smootherstep } from './drivers/curve';
import { stepTrack, type TrackState } from './drivers/track';
import type { WorldRotation } from './frame';

export type ViewAnimState = 'idle' | 'playing' | 'held';

/** Playable presets; `none` is the state encoding for "no preset". */
export type ViewPresetId = 'up' | 'down' | 'recenter' | 'breathe';
export type ViewPresetCode = 'none' | ViewPresetId;

/** Absolute envelopes in degrees; identical to the wire contract. */
export const LOOK_YAW_LIMIT_DEG = 180;
export const UP_GAZE_LIMIT_DEG = 90;

/** Curve evaluators: both are 0 at t=0 and land on their end value at t=1. */
export type ViewPresetCurve = 'smootherstep' | 'cycle';

/** How a preset resolves its excursion from the current angle. */
export type ViewPresetMotion = 'relative' | 'absolute' | 'round-trip';

export interface ViewPreset {
  readonly id: ViewPresetId;
  readonly label: { readonly zh: string; readonly en: string };
  readonly durationMs: number;
  readonly curve: ViewPresetCurve;
  readonly motion: ViewPresetMotion;
  /**
   * `relative`: signed delta added to the current up-gaze.
   * `absolute`: the landing up-gaze itself.
   * `round-trip`: signed amplitude of the excursion; the preset returns to
   * the angle it started from.
   */
  readonly excursionDeg: number;
  readonly curveLabel: string;
}

/**
 * The whole preset catalog. Presets drive the **up-gaze** channel only;
 * `recenter` also returns the yaw channel to 0. Adding a preset means adding
 * one entry here: the controller only branches on `motion` and `curve`, never
 * on the id.
 *
 * - `up` / `down` are relative so pressing them at the clamp is a no-op rather
 *   than a contradictory "move up while already above the target".
 * - `recenter` is absolute: it is the only command that returns to level.
 * - `breathe` is a single out-and-back cycle that ends where it started; it is
 *   the only preset that changes direction inside one playback.
 */
export const VIEW_PRESETS: Readonly<Record<ViewPresetId, ViewPreset>> = {
  up: {
    id: 'up',
    label: { zh: '上仰', en: 'Up' },
    durationMs: 3000,
    curve: 'smootherstep',
    motion: 'relative',
    excursionDeg: 10,
    curveLabel: 'smootherstep，零初末速'
  },
  down: {
    id: 'down',
    label: { zh: '下俯', en: 'Down' },
    durationMs: 3000,
    curve: 'smootherstep',
    motion: 'relative',
    excursionDeg: -10,
    curveLabel: 'smootherstep，零初末速'
  },
  recenter: {
    id: 'recenter',
    label: { zh: '回正', en: 'Recenter' },
    durationMs: 2400,
    curve: 'smootherstep',
    motion: 'absolute',
    excursionDeg: 0,
    curveLabel: 'smootherstep，零初末速；偏航同时归零'
  },
  breathe: {
    id: 'breathe',
    label: { zh: '呼吸', en: 'Breathe' },
    durationMs: 6000,
    curve: 'cycle',
    motion: 'round-trip',
    excursionDeg: 6,
    curveLabel: 'smootherstep 去、镜像 smootherstep 回，单周期，末态=初态'
  }
};

/**
 * Wire codes for the state frame. Android does the byte encoding; keeping the
 * table here lets the page and the tests agree on the numbering.
 */
export const VIEW_PRESET_CODES: Readonly<Record<ViewPresetCode, number>> = {
  none: 0,
  up: 1,
  down: 2,
  recenter: 3,
  breathe: 4
};

/**
 * Slider tracking: the tablet streams absolute targets at up to 10 Hz, so a
 * fixed-duration ease per sample would stall. Pitch follows with a 0.25 s
 * time constant under a 15 °/s cap; yaw is a lateral turn and tolerates a
 * faster 30 °/s.
 */
export const VIEW_TRACK_TAU_S = 0.25;
export const VIEW_PITCH_MAX_DEG_PER_S = 15;
export const VIEW_YAW_MAX_DEG_PER_S = 30;
/**
 * Onset ramp. A 0→15 °/s step at a frame boundary is felt as a tug on the view;
 * 60 °/s² spreads it over 0.25 s without changing the steady-state speed.
 */
export const VIEW_ACCEL_MAX_DEG_PER_S2 = 60;
/** Below this the remaining gap is invisible; settle so state can go idle. */
const SNAP_DEG = 0.05;
/** Average yaw speed when `recenter` unwinds a large turn. */
const RECENTER_YAW_DEG_PER_S = 40;

/**
 * The view channel names a patient-centric orientation; the world rotates the
 * other way on both axes. This is the only mapping between the two, and the
 * only place a sign flips.
 */
export function viewToWorld(lookYawDeg: number, upGazeDeg: number): WorldRotation {
  return { pitchDeg: -upGazeDeg, rollDeg: 0, yawDeg: -lookYawDeg };
}

export interface ViewGazeSink {
  /** Applied orientation in signed degrees: yaw + = view turns left, pitch + = up. */
  setOrientation(lookYawDeg: number, upGazeDeg: number): void;
}

export interface ViewMotionState {
  state: ViewAnimState;
  /** Current applied yaw; + = the patient's view is turned left. */
  lookYawDeg: number;
  /** Current applied up-gaze; + = the patient sees more sky. */
  upGazeDeg: number;
  /** Landing angles the controller is heading for. */
  targetLookYawDeg: number;
  targetUpGazeDeg: number;
  /** Active preset id while playing/held; null when idle or slider-driven. */
  preset: string | null;
}

export interface ViewMotionControllerApi {
  /**
   * Play a catalog preset. Returns false for an unknown id (the caller rejects
   * the command); a preset with no possible motion settles to idle at once.
   */
  play(name: string): boolean;
  /**
   * Absolute slider target in degrees, animated from the current angle. Clears
   * the active preset. A non-finite or out-of-envelope value rejects the whole
   * command, never clamps.
   */
  setTarget(lookYawDeg: number, upGazeDeg: number): boolean;
  /** Immediate hold: freeze both channels. Never recenters. */
  stop(): void;
  /** Back to 0°, 0° and idle without easing (session end, calibration start). */
  reset(): void;
  /** Ease one frame and push the applied angles to the sink. Allocation-free. */
  update(dt: number): void;
  getState(out?: ViewMotionState): ViewMotionState;
  getStateName(): ViewAnimState;
  getLookYawDeg(): number;
  getUpGazeDeg(): number;
  getTargetLookYawDeg(): number;
  getTargetUpGazeDeg(): number;
  /** Active preset id, or null when idle / slider-driven. */
  getPresetId(): ViewPresetId | null;
}

export function isViewPresetId(value: string): value is ViewPresetId {
  return Object.prototype.hasOwnProperty.call(VIEW_PRESETS, value);
}

/** State string for `/state.viewPreset`; `none` when no preset is active. */
export function presetCode(id: ViewPresetId | null): ViewPresetCode {
  return id ?? 'none';
}

interface TimedSegment {
  start: number;
  peak: number;
  end: number;
  elapsedMs: number;
  durationMs: number;
  curve: ViewPresetCurve;
}

interface Channel extends TrackState {
  target: number;
  /** Non-null while a fixed-duration curve owns the channel. */
  timed: TimedSegment | null;
  readonly maxDegPerS: number;
}

/** Advance one channel; true when the applied value changed. */
function advance(channel: Channel, dt: number): boolean {
  const segment = channel.timed;
  if (segment) {
    segment.elapsedMs = Math.min(segment.durationMs, segment.elapsedMs + dt * 1000);
    const t = segment.durationMs > 0 ? segment.elapsedMs / segment.durationMs : 1;
    const eased = segment.curve === 'cycle' ? cycle(t) : smootherstep(t);
    const next = segment.start + (segment.peak - segment.start) * eased;
    const changed = next !== channel.value;
    channel.value = next;
    if (segment.elapsedMs >= segment.durationMs) {
      channel.value = segment.end;
      channel.target = segment.end;
      channel.velocity = 0;
      channel.timed = null;
      return true;
    }
    return changed;
  }

  const gap = channel.target - channel.value;
  if (Math.abs(gap) < SNAP_DEG) {
    const landed = channel.value !== channel.target;
    channel.value = channel.target;
    return landed;
  }
  const before = channel.value;
  stepTrack(channel, channel.target, dt, {
    tauS: VIEW_TRACK_TAU_S,
    maxDegPerS: channel.maxDegPerS,
    maxDegPerS2: VIEW_ACCEL_MAX_DEG_PER_S2,
    snapDeg: SNAP_DEG
  });
  return channel.value !== before;
}

export function createViewMotionController(options: {
  sink: ViewGazeSink;
}): ViewMotionControllerApi {
  const { sink } = options;

  let state: ViewAnimState = 'idle';
  let presetId: ViewPresetId | null = null;

  const yaw: Channel = {
    value: 0,
    velocity: 0,
    target: 0,
    timed: null,
    maxDegPerS: VIEW_YAW_MAX_DEG_PER_S
  };
  const pitch: Channel = {
    value: 0,
    velocity: 0,
    target: 0,
    timed: null,
    maxDegPerS: VIEW_PITCH_MAX_DEG_PER_S
  };

  function startSegment(
    channel: Channel,
    start: number,
    peak: number,
    end: number,
    durationMs: number,
    curve: ViewPresetCurve
  ): void {
    channel.target = end;
    // A fixed-duration curve owns position; any tracker velocity would fight it.
    channel.velocity = 0;
    channel.timed = { start, peak, end, elapsedMs: 0, durationMs, curve };
  }

  function beginPreset(preset: ViewPreset): void {
    const start = pitch.value;
    let peak: number;
    let end: number;
    switch (preset.motion) {
      case 'relative':
        peak = clampSigned(start + preset.excursionDeg, UP_GAZE_LIMIT_DEG);
        end = peak;
        break;
      case 'absolute':
        peak = clampSigned(preset.excursionDeg, UP_GAZE_LIMIT_DEG);
        end = peak;
        break;
      case 'round-trip':
        peak = clampSigned(start + preset.excursionDeg, UP_GAZE_LIMIT_DEG);
        end = start;
        break;
    }

    const yawMoves = preset.id === 'recenter' && yaw.value !== 0;
    if (preset.id === 'recenter' && yawMoves) {
      // Unwind a large turn at a bounded average speed instead of squeezing it
      // into the pitch duration.
      const durationMs = Math.min(
        5000,
        Math.max(700, (Math.abs(yaw.value) / RECENTER_YAW_DEG_PER_S) * 1000)
      );
      startSegment(yaw, yaw.value, 0, 0, durationMs, preset.curve);
    }

    if (peak === start && end === start) {
      // No possible pitch motion (already at the clamp): do not report a fake
      // playback, but keep a running yaw unwind honest.
      presetId = yawMoves ? preset.id : null;
      state = yawMoves ? 'playing' : 'idle';
      return;
    }
    startSegment(pitch, start, peak, end, preset.durationMs, preset.curve);
    presetId = preset.id;
    state = 'playing';
  }

  function play(name: string): boolean {
    if (!isViewPresetId(name)) {
      return false;
    }
    beginPreset(VIEW_PRESETS[name]);
    return true;
  }

  function setTarget(lookYawDeg: number, upGazeDeg: number): boolean {
    if (
      !Number.isFinite(lookYawDeg) ||
      !Number.isFinite(upGazeDeg) ||
      lookYawDeg < -LOOK_YAW_LIMIT_DEG ||
      lookYawDeg > LOOK_YAW_LIMIT_DEG ||
      upGazeDeg < -UP_GAZE_LIMIT_DEG ||
      upGazeDeg > UP_GAZE_LIMIT_DEG
    ) {
      return false;
    }
    // Streaming retarget: resume from the applied angles, never from the old
    // targets, never snap, and drop any preset playback.
    yaw.timed = null;
    pitch.timed = null;
    yaw.velocity = 0;
    pitch.velocity = 0;
    presetId = null;
    yaw.target = lookYawDeg;
    pitch.target = upGazeDeg;
    const settled =
      Math.abs(yaw.target - yaw.value) < SNAP_DEG &&
      Math.abs(pitch.target - pitch.value) < SNAP_DEG;
    state = settled ? 'idle' : 'playing';
    return true;
  }

  function stop(): void {
    // Only a running animation can be stopped; freezing an idle controller
    // would report "held" for a motion that never happened.
    if (state !== 'playing') {
      return;
    }
    yaw.timed = null;
    pitch.timed = null;
    yaw.velocity = 0;
    pitch.velocity = 0;
    yaw.target = yaw.value;
    pitch.target = pitch.value;
    state = 'held';
  }

  function reset(): void {
    yaw.timed = null;
    pitch.timed = null;
    yaw.velocity = 0;
    pitch.velocity = 0;
    presetId = null;
    state = 'idle';
    yaw.value = 0;
    pitch.value = 0;
    yaw.target = 0;
    pitch.target = 0;
    sink.setOrientation(0, 0);
  }

  function update(dt: number): void {
    const step = Number.isFinite(dt) && dt > 0 ? dt : 0;
    if (state === 'playing' && step > 0) {
      const yawMoved = advance(yaw, step);
      const pitchMoved = advance(pitch, step);
      if (!yawMoved && !pitchMoved) {
        presetId = null;
        state = 'idle';
      }
    }
    sink.setOrientation(yaw.value, pitch.value);
  }

  function getState(out?: ViewMotionState): ViewMotionState {
    if (out) {
      out.state = state;
      out.lookYawDeg = yaw.value;
      out.upGazeDeg = pitch.value;
      out.targetLookYawDeg = yaw.target;
      out.targetUpGazeDeg = pitch.target;
      out.preset = presetId;
      return out;
    }
    return {
      state,
      lookYawDeg: yaw.value,
      upGazeDeg: pitch.value,
      targetLookYawDeg: yaw.target,
      targetUpGazeDeg: pitch.target,
      preset: presetId
    };
  }

  return {
    play,
    setTarget,
    stop,
    reset,
    update,
    getState,
    getStateName: () => state,
    getLookYawDeg: () => yaw.value,
    getUpGazeDeg: () => pitch.value,
    getTargetLookYawDeg: () => yaw.target,
    getTargetUpGazeDeg: () => pitch.target,
    getPresetId: () => presetId
  };
}
