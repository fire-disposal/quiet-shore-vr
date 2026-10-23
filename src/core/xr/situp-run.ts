/**
 * Playhead for the virtual sit-up performance.
 *
 * The mapping from "sitting up" to a world transform lives in `situp-path.ts`;
 * this unit owns only the normalised progress and its policy: a linear ramp
 * over a fixed duration, and a stop that freezes in place. It is the L2 owner
 * of the sit-up timeline, so `App` never advances business time itself.
 */
export interface SitUpMotionApi {
  /** Normalised progress: 0 = supine, 1 = standing. */
  readonly t: number;
  /** Where the ramp is heading, 0 or 1. */
  readonly target: number;
  /** False once the ramp has landed or was stopped. */
  readonly moving: boolean;
  /** Sit up (1) or lie back (0). Resumes from the current progress. */
  setTarget(target: number): void;
  /**
   * Jump to a progress without animating (arm mid-session at "standing" so the
   * world does not snap), and hold there.
   */
  seek(t: number): void;
  /** Changes the ramp length for the next move; the current one is untouched. */
  setDuration(durationMs: number): void;
  /** Freeze at the current progress; a later `setTarget` resumes from there. */
  stop(): void;
  /** Advance one frame; true when the applied progress changed. */
  update(dt: number): boolean;
  reset(): void;
}

const DEFAULT_DURATION_MS = 12000;
/** Below this the remaining travel is invisible; land instead of creeping. */
const SNAP_T = 1e-4;

export function createSitUpMotion(options: { durationMs?: number } = {}): SitUpMotionApi {
  const requested = options.durationMs ?? DEFAULT_DURATION_MS;
  let durationMs = Number.isFinite(requested) && requested > 0 ? requested : DEFAULT_DURATION_MS;

  let t = 0;
  let target = 0;
  let moving = false;

  function setTarget(next: number): void {
    target = !Number.isFinite(next) ? 0 : next < 0 ? 0 : next > 1 ? 1 : next;
    moving = true;
  }

  function stop(): void {
    target = t;
    moving = false;
  }

  function update(dt: number): boolean {
    if (!Number.isFinite(dt) || dt <= 0) {
      return false;
    }
    const delta = target - t;
    if (Math.abs(delta) < SNAP_T) {
      const landed = t !== target || moving;
      t = target;
      moving = false;
      return landed;
    }
    const step = (dt * 1000) / durationMs;
    const next = Math.min(1, Math.max(0, t + Math.sign(delta) * step));
    const changed = next !== t;
    t = next;
    moving = true;
    return changed;
  }

  function setDuration(next: number): void {
    if (Number.isFinite(next) && next > 0) {
      durationMs = next;
    }
  }

  function seek(next: number): void {
    t = !Number.isFinite(next) ? 0 : next < 0 ? 0 : next > 1 ? 1 : next;
    target = t;
    moving = false;
  }

  function reset(): void {
    t = 0;
    target = 0;
    moving = false;
  }

  return {
    get t() {
      return t;
    },
    get target() {
      return target;
    },
    get moving() {
      return moving;
    },
    setTarget,
    setDuration,
    seek,
    stop,
    update,
    reset
  };
}
