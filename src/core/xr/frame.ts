import * as THREE from 'three';
import { degToRad } from './angle';

/**
 * World-frame rotation, signed degrees.
 *
 * +pitchDeg rotates content **up** about +X: a point straight ahead climbs, so
 * the patient sees more floor. +rollDeg rotates about +Z, +yawDeg about +Y.
 * Axis order is XYZ, so a rotation with no yaw is exactly `Rx(pitch) · Rz(roll)`
 * — the same composition the comfort frame has always applied.
 *
 * The patient's *perceived* pitch is the opposite sign: a parent rotation R
 * moves content by R, so the view direction relative to the head is R⁻¹. That
 * projection lives where it is displayed (see `docs/rotation-contract.md` §4).
 */
export interface WorldRotation {
  pitchDeg: number;
  rollDeg: number;
  yawDeg: number;
}

const _euler = new THREE.Euler(0, 0, 0, 'XYZ');
const _rotatedPivot = new THREE.Vector3();

export function copyWorldRotation(source: WorldRotation, out: WorldRotation): WorldRotation {
  out.pitchDeg = source.pitchDeg;
  out.rollDeg = source.rollDeg;
  out.yawDeg = source.yawDeg;
  return out;
}

/** True when the rotation leaves every axis alone; write identity then. */
export function isIdentityRotation(rotation: WorldRotation): boolean {
  return rotation.pitchDeg === 0 && rotation.rollDeg === 0 && rotation.yawDeg === 0;
}

/**
 * Quaternion for a world rotation. This is the only place degrees become a
 * three.js rotation for the world layers.
 */
export function worldQuaternion(out: THREE.Quaternion, rotation: WorldRotation): THREE.Quaternion {
  _euler.set(
    degToRad(rotation.pitchDeg),
    degToRad(rotation.yawDeg),
    degToRad(rotation.rollDeg),
    'XYZ'
  );
  return out.setFromEuler(_euler);
}

/**
 * Offset that keeps `pivot` a fixed point of `q`: p = pivot − q·pivot.
 * Allocation-free; `out` may alias nothing else.
 */
export function aroundPivot(
  out: THREE.Vector3,
  q: THREE.Quaternion,
  pivot: THREE.Vector3
): THREE.Vector3 {
  return out.copy(pivot).sub(_rotatedPivot.copy(pivot).applyQuaternion(q));
}

/**
 * Write the outermost world layer: rotate content about `pivot`, leaving the
 * eye point where it is. The caller decides *when*; this only applies.
 */
export function writeWorld(
  target: THREE.Object3D,
  q: THREE.Quaternion,
  pivot: THREE.Vector3
): void {
  target.quaternion.copy(q);
  aroundPivot(target.position, q, pivot);
}

/** Reset a world/base layer to the identity transform. */
export function clearTransform(target: THREE.Object3D): void {
  target.quaternion.identity();
  target.position.set(0, 0, 0);
}

/** Write the base layer (calibration/posture/sit-up frame) verbatim. */
export function writeBase(
  target: THREE.Object3D,
  q: THREE.Quaternion,
  position: THREE.Vector3
): void {
  target.quaternion.copy(q);
  target.position.copy(position);
}
