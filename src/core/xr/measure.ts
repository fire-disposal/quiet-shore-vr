import * as THREE from 'three';
import { radToDeg } from './angle';

/**
 * The single readout path for angles.
 *
 * A reported angle is always a measurement of a transform that was actually
 * applied — never a parallel formula over business progress. Callers pass a
 * scratch `out` on hot paths; without one a fresh object is allocated, which
 * is only acceptable in diagnostics.
 */
export interface EulerDeg {
  yawDeg: number;
  pitchDeg: number;
  rollDeg: number;
}

const _euler = new THREE.Euler(0, 0, 0, 'YXZ');
const _relative = new THREE.Quaternion();

/** Room-frame YXZ decomposition: yaw about +Y, pitch about +X (+ = up). */
export function measureEuler(
  q: THREE.Quaternion,
  out: EulerDeg = { yawDeg: 0, pitchDeg: 0, rollDeg: 0 }
): EulerDeg {
  _euler.setFromQuaternion(q, 'YXZ');
  out.yawDeg = radToDeg(_euler.y);
  out.pitchDeg = radToDeg(_euler.x);
  out.rollDeg = radToDeg(_euler.z);
  return out;
}

/**
 * Euler of `q` relative to `reference`, i.e. the rotation that `q` adds on top
 * of the frame `reference` established. Used for "how far has the world moved
 * since the posture started" without re-deriving it from progress.
 */
export function measureRelativeEuler(
  q: THREE.Quaternion,
  reference: THREE.Quaternion,
  out: EulerDeg = { yawDeg: 0, pitchDeg: 0, rollDeg: 0 }
): EulerDeg {
  _relative.copy(reference).invert().premultiply(q);
  return measureEuler(_relative, out);
}

/** Pitch of a room/world frame rotation in degrees; allocation-free. */
export function measurePitchDeg(q: THREE.Quaternion): number {
  _euler.setFromQuaternion(q, 'YXZ');
  return radToDeg(_euler.x);
}
