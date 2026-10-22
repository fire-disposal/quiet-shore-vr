/**
 * Time curves and their rates. No transforms, no state, no business names:
 * a caller decides what a curve moves and for how long.
 */

/** Clamp normalised time; NaN collapses to 0 so a bad `dt` cannot leak out. */
function unit(t: number): number {
  return t > 0 ? (t < 1 ? t : 1) : 0;
}

/** 3t² − 2t³: matches velocity at both ends, not acceleration. */
export function smoothstep(t: number): number {
  const x = unit(t);
  return x * x * (3 - 2 * x);
}

/** 6t⁵ − 15t⁴ + 10t³: zero velocity *and* acceleration at both ends. */
export function smootherstep(t: number): number {
  const x = unit(t);
  return x * x * x * (x * (x * 6 - 15) + 10);
}

/** d/dt of `smootherstep` per unit of normalised time: 30 t² (1 − t)². */
export function smootherstepRate(t: number): number {
  const x = unit(t);
  const s = x * (1 - x);
  return 30 * s * s;
}

/**
 * Peak speed of a smootherstep transition relative to its average. A caller
 * that has a rate envelope must size its duration against this factor, not
 * against the average.
 */
export const SMOOTHERSTEP_PEAK = smootherstepRate(0.5);

/** Single excursion: 0 → 1 → 0 with zero velocity at both ends. */
export function cycle(t: number): number {
  const x = unit(t);
  return x < 0.5 ? smootherstep(2 * x) : smootherstep(2 - 2 * x);
}

/**
 * Travel of a brake whose velocity decays as (1 − u)², at an initial speed of
 * one unit per second. `durationS` is the length of the ramp.
 */
export function brakeTravel(u: number, durationS: number): number {
  const x = unit(u);
  return (x - x * x + (x * x * x) / 3) * durationS;
}
