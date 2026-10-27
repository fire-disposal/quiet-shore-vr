import * as THREE from 'three';

/**
 * Camera transform for the tablet mirror.
 *
 * The mirror renders the same content tree the headset renders, but without the
 * headset's two-layer rig: the page has a camera at the origin and a head pose,
 * while the mirror has one camera and the content already moved.
 *
 * The contract is the **centre ray**, not the field of view: the direction the
 * patient's gaze points must be the direction the panel's centre points. FOV
 * and aspect are deliberately not matched — the panel is 16:10 and the headset
 * 84°×76°, and cropping to fit would spend panel area on nothing.
 *
 * For the centre rays to coincide, the mirror camera must satisfy
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

/**
 * The applied world transform, as the page reports it: a unit quaternion and a
 * translation in metres. It is used verbatim — no Euler round-trip, no
 * re-derivation from a posture scalar.
 */
export interface MirrorWorld {
  readonly q: THREE.Quaternion;
  readonly t: THREE.Vector3;
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

const headEuler = new THREE.Euler(0, 0, 0, 'YXZ');
const headQuat = new THREE.Quaternion();
const worldInverse = new THREE.Quaternion();
/**
 * Writes the camera transform; no allocation. `target` is a camera-like object
 * (position + quaternion), so the caller keeps ownership of the camera.
 */
export function mirrorCameraTransform(
  target: { position: THREE.Vector3; quaternion: THREE.Quaternion },
  world: MirrorWorld,
  head: MirrorHeadRad,
  pose: MirrorPoseM
): void {
  headEuler.set(head.pitch, head.yaw, head.roll, 'YXZ');
  headQuat.setFromEuler(headEuler);

  // Full rigid inverse: the head position is inverse-rotated only after the
  // world's own translation is taken out; both live in the device frame.
  worldInverse.copy(world.q).invert();
  target.position.set(pose.x - world.t.x, pose.y - world.t.y, pose.z - world.t.z);
  target.position.applyQuaternion(worldInverse);
  // World first, then head: see the derivation above.
  target.quaternion.copy(worldInverse).multiply(headQuat);
}
