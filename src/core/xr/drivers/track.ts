/**
 * One frame of a first-order tracker under a hard rate cap.
 *
 * Rate-capped exponential approach: smooth landing, bounded speed. The caller
 * owns the state; this only computes the delta for one step.
 */
export function approachGap(
  gap: number,
  dt: number,
  tauS: number,
  maxDegPerS: number
): number {
  if (!(dt > 0)) {
    return 0;
  }
  const cap = maxDegPerS * dt;
  let delta = gap * (1 - Math.exp(-dt / tauS));
  if (delta > cap) {
    delta = cap;
  } else if (delta < -cap) {
    delta = -cap;
  }
  return delta;
}
