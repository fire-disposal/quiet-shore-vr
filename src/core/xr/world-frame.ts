import * as THREE from 'three';
import type { ScenePosture } from '../scene/contract';

/**
 * Where the art sits, given which world frame the session is running in.
 *
 * The frame is data, not a code path: a scene says which eye its art was
 * authored for (`posture`, `eyeY`), the session says which mode it is in, and
 * this planner returns the two things the render loop needs — which transform
 * writes the base layer, and how far the art has to move for that frame's eye
 * to land on the authored one.
 *
 * ```text
 * calibrated frame   base = q0 (pitch-corrected), eye at the content origin
 *                    offset = -eyeY
 * sit-up frame       base = inverse of the sit-up camera path, eye at the
 *                    path's camera position
 *                    offset = (eye the path stands/ lies at) - eyeY
 * ```
 *
 * No global `-eyeHeight`: that number only ever meant "the washroom is drawn
 * for a 1.7 m standing eye", and one scene's constant does not place the rest.
 */

export type FrameBase = 'calibrated' | 'situp';

export interface FramePlanInput {
  /** Which eye the scene's art was authored for. */
  posture: ScenePosture;
  /** The session mode; fixed for the session. */
  mode: 'float' | 'posture';
  /** Authored eye height in content space. */
  eyeY: number;
  /** Operator's standing eye height setting. */
  standEyeHeight: number;
  /** Height of the supine eye in the sit-up path (hip height). */
  lyingEyeHeight: number;
}

export interface FramePlan {
  base: FrameBase;
  /** Content Y for the art; the buoyancy delta is added on top of it. */
  offsetY: number;
}

/** `-0` and `+0` render differently in state readbacks; keep it canonical. */
function clean(value: number): number {
  return value === 0 ? 0 : value;
}

export function planFrame(input: FramePlanInput): FramePlan {
  const eyeY = finiteOr(input.eyeY, 0);
  const lying = finiteOr(input.lyingEyeHeight, 0);
  const stand = finiteOr(input.standEyeHeight, eyeY);
  if (input.posture === 'supine') {
    // Art drawn for a body on its back: the sit-up path is the only frame with
    // a lying eye, and the rise then simply lifts the camera inside the art.
    return { base: 'situp', offsetY: clean(lying - eyeY) };
  }
  if (input.mode === 'posture') {
    // Standing art, rise performance: the path's standing eye must land on the
    // authored one, so the art shifts by however far the setting moved it.
    return { base: 'situp', offsetY: clean(stand - eyeY) };
  }
  return { base: 'calibrated', offsetY: clean(-eyeY) };
}

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

/** Scratch for the per-frame axis; the render loop is single-threaded. */
const AXIS_QUATERNION = new THREE.Quaternion();

/**
 * The patient's visual up, expressed in content space.
 *
 * The buoyancy axis: a heave written along the scene's +Y only reads as up and
 * down while the calibrated frame poses the world. Undo the base rotation and
 * the same head direction works in every frame, including the supine one where
 * it points along the scene's depth.
 */
export function visualUpInContent(
  head: THREE.Quaternion,
  base: THREE.Quaternion,
  out: THREE.Vector3
): THREE.Vector3 {
  AXIS_QUATERNION.copy(base).invert().multiply(head);
  return out.set(0, 1, 0).applyQuaternion(AXIS_QUATERNION);
}
