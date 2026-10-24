import * as THREE from 'three';

/**
 * Camera transform for the tablet mirror.
 *
 * The mirror renders the same content tree the headset renders, but without the
 * headset's two-layer rig: the page has a camera at the origin and a head pose,
 * while the mirror has one camera and the content already moved. For the two to
 * show the same thing, the mirror camera must satisfy
 *
 * ```text
 * camera⁻¹ · content = head⁻¹ · world · content      ⇒   camera = world⁻¹ · head
 * ```
 *
 * i.e. the world rotation is inverted *first*, then the head rotation is
 * applied. Composing them the other way round (`head · world⁻¹`) applies each
 * rotation about the other's axes and only coincides when one of them is
 * identity — which is exactly why a lying patient's view came out wrong.
 *
 * Units are the ones on the wire: the state frame carries the world rotation in
 * **degrees**, the telemetry pose carries yaw/pitch in **radians**.
 */

export interface MirrorWorldDeg {
  readonly yaw: number;
  readonly pitch: number;
  readonly roll: number;
}

export interface MirrorHeadRad {
  readonly yaw: number;
  readonly pitch: number;
  readonly roll: number;
}

export interface MirrorPoseM {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

const DEG = Math.PI / 180;

const worldEuler = new THREE.Euler(0, 0, 0, 'XYZ');
const headEuler = new THREE.Euler(0, 0, 0, 'YXZ');
const worldQuat = new THREE.Quaternion();
const headQuat = new THREE.Quaternion();

/**
 * Writes the camera transform; no allocation. `target` is a camera-like object
 * (position + quaternion), so the caller keeps ownership of the camera.
 */
export function mirrorCameraTransform(
  target: { position: THREE.Vector3; quaternion: THREE.Quaternion },
  world: MirrorWorldDeg,
  head: MirrorHeadRad,
  pose: MirrorPoseM
): void {
  worldEuler.set(world.pitch * DEG, world.yaw * DEG, world.roll * DEG, 'XYZ');
  worldQuat.setFromEuler(worldEuler);
  headEuler.set(head.pitch, head.yaw, head.roll, 'YXZ');
  headQuat.setFromEuler(headEuler);

  // The head position is a device-frame vector: inverse-rotate it into the
  // content space the mirror camera lives in. Unrotated, a supine session put
  // the eye 1.7 m above the water instead of at the patient's head.
  target.position.copy(pose as THREE.Vector3);
  target.position.applyQuaternion(worldQuat.clone().invert());
  // World first, then head: see the derivation above.
  target.quaternion.copy(worldQuat.invert()).multiply(headQuat);
}
