/**
 * Second-order trackers for operator-driven angles.
 *
 * A first-order (exponential) approach under a rate cap starts at full speed:
 * the very first frame jumps from rest to the cap, which reads as a tug on the
 * patient's view. This one carries velocity, is critically damped and limits
 * acceleration, so the onset ramps in and the landing keeps zero speed.
 *
 * The caller owns the state; every function here is allocation-free.
 */

export interface TrackState {
  value: number;
  /** Degrees per second. */
  velocity: number;
}

export interface TrackLimits {
  /** Time constant: the spring is tuned so a step settles in roughly 3× this. */
  tauS: number;
  /** Absolute speed cap, degrees per second. */
  maxDegPerS: number;
  /** Absolute acceleration cap, degrees per second squared. */
  maxDegPerS2: number;
  /** Below this gap and speed the channel is considered landed. */
  snapDeg?: number;
  snapDegPerS?: number;
}

const SUBSTEP_S = 0.02;
const MAX_SUBSTEPS = 6;

export function createTrackState(value = 0): TrackState {
  return { value, velocity: 0 };
}

/**
 * Advance one frame toward [target] and return the new value.
 *
 * Critically damped spring (ω = 3/tau) with hard acceleration and speed limits;
 * long frames are split into ≤20 ms substeps so a hitch cannot overshoot.
 */
export function stepTrack(
  state: TrackState,
  target: number,
  dt: number,
  limits: TrackLimits
): number {
  if (!(dt > 0) || !Number.isFinite(target) || !Number.isFinite(state.value)) {
    return state.value;
  }
  const omega = 3 / Math.max(0.05, limits.tauS);
  const steps = Math.min(MAX_SUBSTEPS, Math.max(1, Math.ceil(dt / SUBSTEP_S)));
  const h = dt / steps;
  const snap = limits.snapDeg ?? 0.05;
  const snapV = limits.snapDegPerS ?? 0.5;

  for (let i = 0; i < steps; i += 1) {
    const gap = target - state.value;
    if (Math.abs(gap) < snap && Math.abs(state.velocity) < snapV) {
      state.value = target;
      state.velocity = 0;
      return state.value;
    }
    let accel = omega * omega * gap - 2 * omega * state.velocity;
    const aMax = limits.maxDegPerS2;
    if (accel > aMax) {
      accel = aMax;
    } else if (accel < -aMax) {
      accel = -aMax;
    }
    state.velocity += accel * h;
    const vMax = limits.maxDegPerS;
    if (state.velocity > vMax) {
      state.velocity = vMax;
    } else if (state.velocity < -vMax) {
      state.velocity = -vMax;
    }
    const next = state.value + state.velocity * h;
    // Crossing the target with speed left over would overshoot; land instead.
    if (gap !== 0 && (target - next) * gap <= 0) {
      state.value = target;
      state.velocity = 0;
      return state.value;
    }
    state.value = next;
  }
  return state.value;
}
