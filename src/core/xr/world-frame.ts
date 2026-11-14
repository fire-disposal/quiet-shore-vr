import * as THREE from 'three';

/**
 * The world's vertical axis, expressed in content space.
 *
 * The content sits under the view shell and the calibrated comfort frame, so a
 * translation written in content coordinates is rotated by both parents. Undo
 * those rotations once to get the vector that comes out as world Y after the
 * frame is applied. The patient's head is deliberately not part of this
 * calculation: buoyancy is a heave of the world, not a translation along the
 * gaze, so looking up or turning away must not steer it.
 */

/** Scratch for the per-frame axis; the render loop is single-threaded. */
const AXIS_QUATERNION = new THREE.Quaternion();

/**
 * World up, expressed in the content's parent coordinates.
 *
 * `parent` is the full rotation above the content (view shell × comfort
 * frame). The returned vector is a unit vector in content space; applying the
 * parent's rotation to it recovers `(0, 1, 0)` in world space.
 */
export function worldUpInContent(
  parent: THREE.Quaternion,
  out: THREE.Vector3
): THREE.Vector3 {
  AXIS_QUATERNION.copy(parent).invert();
  return out.set(0, 1, 0).applyQuaternion(AXIS_QUATERNION);
}
