/**
 * One body, one set of eye heights.
 *
 * The app used to carry four unrelated eye numbers: a config value, a `1.7`
 * constant inside the world runtime, a per-scene `eyeY`, and the old sit-up
 * path's standing height. They disagreed, and the one that actually placed the
 * world was the constant.
 *
 * This module is the single source for the two heights the system needs:
 *
 * - **supine** — where the patient's eyes are while they lie in bed (or float
 *   on water). This is the start of the rise, and the rest state of a session.
 * - **standing** — where the scene's art was authored from. Scenes keep their
 *   authored number (1.70 m); we do not re-draw every room for a 1.589 m eye.
 *
 * Reference body: adult male, 1.70 m. Eye-height ratios follow GB/T 10000-88
 * (male P50: eye 1568 mm / stature 1678 mm = 0.935; the seating rule of thumb
 * 11H/12 agrees within 2 cm).
 */

/** Stature the table is written for, metres. */
export const REFERENCE_STATURE_M = 1.7;

/** Standing eye height of that body, metres (0.935 × stature ≈ 1.59). */
export const STANDING_EYE_M = 1.59;

/**
 * Supine head: the eye sits at about half the head's height above whatever the
 * back of the head rests on (head height 0.23 m).
 */
export const SUPINE_EYE_ABOVE_SUPPORT_M = 0.11;

/** Hospital mattress top; the ward art draws its own bed at this height. */
export const MATTRESS_TOP_M = 0.55;

/** A pillow under the head lifts the eye a little further. */
export const PILLOW_LIFT_M = 0.05;

/** Floating on one's back: only the face clears the water. */
export const WATER_EYE_M = 0.08;

/** What the patient's back is resting on. */
export type SupineSupport = 'mattress' | 'water';

/**
 * The body the art was drawn around.
 *
 * `supine` scenes look up at their sky and are drawn from a lying eye, so they
 * rest with the world alive as gravity says (`mix` 0). `standing` scenes are
 * drawn from a 1.7 m eye, and their first frame must already be the corrected
 * one (`mix` 1) — a standing room shown uncorrected is a room rotated onto the
 * ceiling until the operator happens to press 起身.
 */
export type SceneViewer = 'supine' | 'standing';

/**
 * A scene's posture statement: the height its art was drawn from, and what the
 * patient lies on while the scene is up. The lying height is derived, never
 * hand-written, so two scenes can never disagree about a mattress again.
 */
export interface ScenePosture {
  /** Height the art was authored from; the end of the rise. */
  readonly standingEyeY: number;
  /** What the body rests on; decides the start of the rise. */
  readonly supine: SupineSupport;
  /** Head on a pillow (adds [PILLOW_LIFT_M]). */
  readonly pillow?: boolean;
  /** Which body the art assumes; decides the correction the world rests in. */
  readonly viewer: SceneViewer;
}

/** Derived eye height for a posture, metres above the scene's floor line. */
export function lyingEyeY(posture: ScenePosture): number {
  if (posture.supine === 'water') {
    return WATER_EYE_M;
  }
  const lift = posture.pillow ? PILLOW_LIFT_M : 0;
  return MATTRESS_TOP_M + SUPINE_EYE_ABOVE_SUPPORT_M + lift;
}

/** Eye height that follows the correction: `mix` 0 = lying, 1 = standing. */
export function eyeYAt(posture: ScenePosture, mix: number): number {
  const t = Number.isFinite(mix) ? Math.min(1, Math.max(0, mix)) : 0;
  const lying = lyingEyeY(posture);
  return lying + (posture.standingEyeY - lying) * t;
}

/**
 * The correction a scene rests in, and therefore the first frame the patient
 * sees once calibration lands. Only the scene knows this: the calibration
 * measures where the head is, not which way the art was drawn.
 */
export function restMixOf(posture: ScenePosture): 0 | 1 {
  return posture.viewer === 'standing' ? 1 : 0;
}
