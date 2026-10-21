/**
 * System-level owner of the operator's view motion.
 *
 * It holds the single source of truth for view pitch: current angle, target,
 * playback state, preset, easing, hold and reset. It knows nothing about
 * scenes, comfort, sit-up or XR: it advances a scalar and reports it through a
 * sink (`setPitch`), and `WorldShell` turns that scalar into a transform. That
 * is why the same controller survives scene switches and only needs the shell
 * rebound under it.
 *
 * ```text
 * idle    --play / setTarget-->  playing --reached--> idle
 * playing --stop / lease loss--> held    (freeze; no easing, no recenter)
 * held    --play / setTarget-->  playing (from the current angle, never a snap)
 * any     --reset-->             idle at 0° (session end, calibration start)
 * ```
 *
 * Precedence is enforced by the caller (session supervisor), not here:
 * patient stop > lease loss > session end / calibration reset > explicit view
 * command > completion. The controller only guarantees that `stop()` is
 * immediate and never eases.
 */

export type ViewAnimState = 'idle' | 'playing' | 'held';

/** Playable presets; `none` is the state encoding for "no preset". */
export type ViewPresetId = 'up' | 'down' | 'recenter' | 'breathe';
export type ViewPresetCode = 'none' | ViewPresetId;

/** Absolute pitch envelope; identical to the wire contract (z × 20°). */
export const VIEW_PITCH_LIMIT_DEG = 20;

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
   * `relative`: signed delta added to the current angle.
   * `absolute`: the landing angle itself.
   * `round-trip`: signed amplitude of the excursion; the preset returns to
   * the angle it started from.
   */
  readonly degrees: number;
  readonly curveLabel: string;
}

/**
 * The whole preset catalog. Adding a preset means adding one entry here: the
 * controller only branches on `motion` and `curve`, never on the id.
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
    degrees: 10,
    curveLabel: 'smootherstep，零初末速'
  },
  down: {
    id: 'down',
    label: { zh: '下俯', en: 'Down' },
    durationMs: 3000,
    curve: 'smootherstep',
    motion: 'relative',
    degrees: -10,
    curveLabel: 'smootherstep，零初末速'
  },
  recenter: {
    id: 'recenter',
    label: { zh: '回正', en: 'Recenter' },
    durationMs: 2400,
    curve: 'smootherstep',
    motion: 'absolute',
    degrees: 0,
    curveLabel: 'smootherstep，零初末速'
  },
  breathe: {
    id: 'breathe',
    label: { zh: '呼吸', en: 'Breathe' },
    durationMs: 6000,
    curve: 'cycle',
    motion: 'round-trip',
    degrees: 6,
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
 * fixed-duration ease per sample would stall. The angle follows with a 0.35 s
 * time constant (≈95 % of a small nudge in 1 s) under a hard 6 °/s rate cap,
 * so a tap on the end of the slider cannot whip the world around.
 */
export const VIEW_TRACK_TAU_S = 0.35;
export const VIEW_TRACK_MAX_DEG_PER_S = 6;
/** Below this the remaining gap is invisible; settle so state can go idle. */
const SNAP_DEG = 0.05;

export interface ViewPitchSink {
  /** Applied pitch in signed degrees, positive = 上仰. */
  setPitch(deg: number): void;
}

export interface ViewMotionState {
  state: ViewAnimState;
  /** Current applied pitch; this is what the wire reports. */
  pitchDeg: number;
  /** Landing angle the controller is heading for. */
  targetDeg: number;
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
   * the active preset. Non-finite or out-of-envelope values are rejected
   * whole, never clamped.
   */
  setTarget(deg: number): boolean;
  /** Immediate hold: freeze the applied pitch. Never recenters. */
  stop(): void;
  /** Back to 0° and idle without easing (session end, calibration start). */
  reset(): void;
  /** Ease one frame and push the applied pitch to the sink. Allocation-free. */
  update(dt: number): void;
  getState(out?: ViewMotionState): ViewMotionState;
  getStateName(): ViewAnimState;
  getPitchDeg(): number;
  getTargetDeg(): number;
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

/** Quintic smootherstep: zero velocity and acceleration at both ends. */
function smootherstep(t: number): number {
  const x = t < 0 ? 0 : t > 1 ? 1 : t;
  return x * x * x * (x * (x * 6 - 15) + 10);
}

/** Single excursion: 0 -> 1 -> 0 with zero velocity at both ends. */
function cycle(t: number): number {
  const x = t < 0 ? 0 : t > 1 ? 1 : t;
  return x < 0.5 ? smootherstep(2 * x) : smootherstep(2 - 2 * x);
}

function evaluateCurve(curve: ViewPresetCurve, t: number): number {
  return curve === 'cycle' ? cycle(t) : smootherstep(t);
}

export function createViewMotionController(options: {
  sink: ViewPitchSink;
}): ViewMotionControllerApi {
  const { sink } = options;

  let state: ViewAnimState = 'idle';
  let pitchDeg = 0;
  let targetDeg = 0;
  let presetId: ViewPresetId | null = null;

  // Timed preset segment (fixed duration, evaluated curve).
  let timed = false;
  let timedElapsedMs = 0;
  let timedDurationMs = 0;
  let timedStartDeg = 0;
  /** Excursion extreme; equals `timedEndDeg` for monotone curves. */
  let timedPeakDeg = 0;
  /** Landing angle at t = 1 (the start angle for a round trip). */
  let timedEndDeg = 0;
  let timedCurve: ViewPresetCurve = 'smootherstep';

  function clampToLimit(deg: number): number {
    return deg < -VIEW_PITCH_LIMIT_DEG
      ? -VIEW_PITCH_LIMIT_DEG
      : deg > VIEW_PITCH_LIMIT_DEG
        ? VIEW_PITCH_LIMIT_DEG
        : deg;
  }

  function beginPreset(preset: ViewPreset): void {
    const start = pitchDeg;
    let peak: number;
    let end: number;
    switch (preset.motion) {
      case 'relative':
        peak = clampToLimit(start + preset.degrees);
        end = peak;
        break;
      case 'absolute':
        peak = clampToLimit(preset.degrees);
        end = peak;
        break;
      case 'round-trip':
        peak = clampToLimit(start + preset.degrees);
        end = start;
        break;
    }
    targetDeg = end;
    if (peak === start && end === start) {
      // No possible motion (already at the clamp): do not report a playback.
      timed = false;
      presetId = null;
      state = 'idle';
      return;
    }
    timed = true;
    timedElapsedMs = 0;
    timedDurationMs = preset.durationMs;
    timedStartDeg = start;
    timedPeakDeg = peak;
    timedEndDeg = end;
    timedCurve = preset.curve;
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

  function setTarget(deg: number): boolean {
    if (!Number.isFinite(deg)) {
      return false;
    }
    if (deg < -VIEW_PITCH_LIMIT_DEG || deg > VIEW_PITCH_LIMIT_DEG) {
      return false;
    }
    // Streaming retarget: resume from the applied angle, never from the old
    // target, never snap, and drop any preset playback.
    timed = false;
    presetId = null;
    targetDeg = deg;
    state = Math.abs(targetDeg - pitchDeg) < SNAP_DEG ? 'idle' : 'playing';
    return true;
  }

  function stop(): void {
    // Only a running animation can be stopped; freezing an idle controller
    // would report "held" for a motion that never happened.
    if (state !== 'playing') {
      return;
    }
    timed = false;
    state = 'held';
  }

  function reset(): void {
    timed = false;
    presetId = null;
    state = 'idle';
    pitchDeg = 0;
    targetDeg = 0;
    sink.setPitch(0);
  }

  function update(dt: number): void {
    const step = Number.isFinite(dt) && dt > 0 ? dt : 0;
    if (state === 'playing' && step > 0) {
      if (timed) {
        timedElapsedMs = Math.min(timedDurationMs, timedElapsedMs + step * 1000);
        const t = timedDurationMs > 0 ? timedElapsedMs / timedDurationMs : 1;
        pitchDeg =
          timedStartDeg + (timedPeakDeg - timedStartDeg) * evaluateCurve(timedCurve, t);
        if (timedElapsedMs >= timedDurationMs) {
          pitchDeg = timedEndDeg;
          timed = false;
          presetId = null;
          state = 'idle';
        }
      } else {
        const gap = targetDeg - pitchDeg;
        const cap = VIEW_TRACK_MAX_DEG_PER_S * step;
        // Rate-capped exponential approach: smooth landing, bounded speed.
        let delta = gap * (1 - Math.exp(-step / VIEW_TRACK_TAU_S));
        if (delta > cap) {
          delta = cap;
        } else if (delta < -cap) {
          delta = -cap;
        }
        pitchDeg += delta;
        if (Math.abs(targetDeg - pitchDeg) < SNAP_DEG) {
          pitchDeg = targetDeg;
          state = 'idle';
        }
      }
    }
    sink.setPitch(pitchDeg);
  }

  function getState(out?: ViewMotionState): ViewMotionState {
    if (out) {
      out.state = state;
      out.pitchDeg = pitchDeg;
      out.targetDeg = targetDeg;
      out.preset = presetId;
      return out;
    }
    return { state, pitchDeg, targetDeg, preset: presetId };
  }

  return {
    play,
    setTarget,
    stop,
    reset,
    update,
    getState,
    getStateName: () => state,
    getPitchDeg: () => pitchDeg,
    getTargetDeg: () => targetDeg,
    getPresetId: () => presetId
  };
}
