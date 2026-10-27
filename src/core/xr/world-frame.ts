import * as THREE from 'three';

/**
 * The patient's visual up, in content space.
 *
 * This is the only function left from the old frame planner: the frame itself
 * is one formula in `app/world-runtime` (`eyeY(mix)` → `content.y = -eyeY`),
 * and the mode/two-frame selection it used to describe is gone.
 *
 * A heave written along the scene's +Y only reads as up and down while that
 * frame poses the world; undoing the parent rotation once gives the same head
 * direction in every frame.
 */

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
