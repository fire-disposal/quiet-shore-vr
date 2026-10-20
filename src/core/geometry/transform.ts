import * as THREE from 'three';
import type { TransformSpec } from './types';

/**
 * Transform application and frame-rate independent damping.
 *
 * Every helper writes into caller-owned objects; module-level scratch objects
 * keep the per-frame path allocation-free.
 */

const DEG2RAD = Math.PI / 180;

const _euler = new THREE.Euler(0, 0, 0, 'YXZ');
const _quat = new THREE.Quaternion();
const _position = new THREE.Vector3();
const _scale = new THREE.Vector3();

/**
 * Apply a declarative transform to an object.
 *
 * `rotationDeg` rotates in YXZ Euler order. When both `rotationDeg` and
 * `quaternion` are present the quaternion wins (it is applied last).
 * `scale` accepts a uniform number or a per-axis vector.
 * `order` is not applied here: it only orders sibling transforms at build time.
 */
export function applyTransform(object: THREE.Object3D, spec: TransformSpec): THREE.Object3D {
  if (spec.position) {
    object.position.set(spec.position[0], spec.position[1], spec.position[2]);
  }
  if (spec.rotationDeg) {
    object.rotation.set(
      spec.rotationDeg[0] * DEG2RAD,
      spec.rotationDeg[1] * DEG2RAD,
      spec.rotationDeg[2] * DEG2RAD,
      'YXZ'
    );
  }
  if (spec.quaternion) {
    object.quaternion.set(spec.quaternion[0], spec.quaternion[1], spec.quaternion[2], spec.quaternion[3]);
  }
  if (spec.scale !== undefined) {
    if (typeof spec.scale === 'number') {
      object.scale.setScalar(spec.scale);
    } else {
      object.scale.set(spec.scale[0], spec.scale[1], spec.scale[2]);
    }
  }
  return object;
}

/**
 * Optional matrix composition for callers that need a one-shot matrix
 * (instancing, placement math). Pass a scratch `out` in hot paths.
 */
export function composeMatrix(spec: TransformSpec, out?: THREE.Matrix4): THREE.Matrix4 {
  if (spec.position) {
    _position.set(spec.position[0], spec.position[1], spec.position[2]);
  } else {
    _position.set(0, 0, 0);
  }
  if (spec.quaternion) {
    _quat.set(spec.quaternion[0], spec.quaternion[1], spec.quaternion[2], spec.quaternion[3]);
  } else if (spec.rotationDeg) {
    _euler.set(
      spec.rotationDeg[0] * DEG2RAD,
      spec.rotationDeg[1] * DEG2RAD,
      spec.rotationDeg[2] * DEG2RAD,
      'YXZ'
    );
    _quat.setFromEuler(_euler);
  } else {
    _quat.identity();
  }
  if (spec.scale !== undefined) {
    if (typeof spec.scale === 'number') {
      _scale.setScalar(spec.scale);
    } else {
      _scale.set(spec.scale[0], spec.scale[1], spec.scale[2]);
    }
  } else {
    _scale.set(1, 1, 1);
  }
  const matrix = out ?? new THREE.Matrix4();
  return matrix.compose(_position, _quat, _scale);
}

/**
 * Frame-rate independent damping factor for a given rate (1 / seconds).
 * alpha = 1 - e^(-rate * dt) gives the same trajectory at 30, 60 or 90 Hz.
 * A non-positive rate means "snap" (settle instantly); a non-positive dt
 * means "hold".
 */
export function dampingAlpha(rate: number, dt: number): number {
  if (rate <= 0) return 1;
  if (dt <= 0) return 0;
  return 1 - Math.exp(-rate * dt);
}

/** Damp `current` toward `target`; returns `current`. */
export function dampVector3(
  current: THREE.Vector3,
  target: THREE.Vector3,
  rate: number,
  dt: number
): THREE.Vector3 {
  const alpha = dampingAlpha(rate, dt);
  if (alpha <= 0) return current;
  if (alpha >= 1) return current.copy(target);
  return current.lerp(target, alpha);
}

/** Damp `current` toward `target` along the shortest arc; returns `current`. */
export function dampQuaternion(
  current: THREE.Quaternion,
  target: THREE.Quaternion,
  rate: number,
  dt: number
): THREE.Quaternion {
  const alpha = dampingAlpha(rate, dt);
  if (alpha <= 0) return current;
  if (alpha >= 1) return current.copy(target);
  return current.slerp(target, alpha);
}

