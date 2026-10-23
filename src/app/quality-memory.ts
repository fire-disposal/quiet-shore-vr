/**
 * Remembers a lower XR framebuffer scale after a session that could not hold
 * its frame budget.
 *
 * The scale can only be set before a session starts, so adaptation happens
 * between sessions: a slow run lowers the stored value, the next launch picks
 * it up. It never raises the value on its own — oscillating quality is worse
 * for a patient than a slightly softer image, and an explicit `?scale=` always
 * wins over the stored value.
 */

const KEY = 'quietshore.xrScale.v1';

/** Steps from sharp to safe; the last value is the floor. */
export const SCALE_STEPS: readonly number[] = [1.25, 1.1, 1.0, 0.9, 0.8, 0.75];

export function readStoredScale(): number | null {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw === null) {
      return null;
    }
    const value = Number(raw);
    return Number.isFinite(value) && value >= 0.6 && value <= 1.5 ? value : null;
  } catch {
    return null;
  }
}

export function storeScale(scale: number): void {
  try {
    window.localStorage.setItem(KEY, String(scale));
  } catch {
    // Storage can be unavailable in private/embedded contexts.
  }
}

/** One notch lower than [current], or [current] when already at the floor. */
export function lowerScaleStep(current: number): number {
  for (const step of SCALE_STEPS) {
    if (step < current - 1e-3) {
      return step;
    }
  }
  return current;
}
