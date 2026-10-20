import * as THREE from 'three';
import type { PoseLike } from './types';

export interface RemapOptions {
  /** 0..1; 0.9 by default. The remap is a correction, not a hard flip. */
  strength?: number;
}

export interface RemapResult {
  ok: boolean;
  reason?: string;
  quaternion?: THREE.Quaternion;
  rawQuaternion?: THREE.Quaternion;
  pivot?: THREE.Vector3;
  up?: THREE.Vector3;
  forward?: THREE.Vector3;
  angleDeg?: number;
  confidence?: number;
  weight?: number;
}

export interface ComfortState {
  calibrated: boolean;
  mode: 'none' | 'single' | 'two-pose';
  quaternion: [number, number, number, number];
  position: [number, number, number];
  remap: {
    up: [number, number, number];
    forward: [number, number, number];
    pivot: [number, number, number];
    angleDeg: number;
    confidence: number;
    weight: number;
  } | null;
}

export interface ComfortApi {
  group: THREE.Group;
  calibrate(pose: PoseLike): boolean;
  calibrateTwo(poseC: PoseLike, poseT: PoseLike, opts?: RemapOptions): RemapResult;
  reset(): void;
  isCalibrated(): boolean;
  getState(): ComfortState;
}

/**
 * Two-pose remap:
 *   toes direction  -> patient's body-down
 *   ceiling direction -> patient's front
 * Maps body-up to +Y and front to -Z. The measured angle is rarely 90
 * degrees, so the result is confidence-weighted (sin of the angle) and
 * blended with identity instead of being applied as a hard flip.
 */
export function remapFromPoses(
  poseC: PoseLike,
  poseT: PoseLike,
  opts: RemapOptions = {}
): RemapResult {
  const qC = poseC.transform.orientation;
  const qT = poseT.transform.orientation;
  const fC = new THREE.Vector3(0, 0, -1).applyQuaternion(
    new THREE.Quaternion(qC.x, qC.y, qC.z, qC.w)
  );
  const fT = new THREE.Vector3(0, 0, -1).applyQuaternion(
    new THREE.Quaternion(qT.x, qT.y, qT.z, qT.w)
  );

  const up = fT.clone().negate();
  if (up.lengthSq() < 1e-8) {
    return { ok: false, reason: 'toes-zero' };
  }
  up.normalize();

  const forward = fC.clone().addScaledVector(up, -fC.dot(up));
  if (forward.lengthSq() < 1e-6) {
    return { ok: false, reason: 'poses-parallel' };
  }
  forward.normalize();

  const zs = forward.clone().negate();
  const xs = new THREE.Vector3().crossVectors(up, zs);
  if (xs.lengthSq() < 1e-8) {
    return { ok: false, reason: 'degenerate' };
  }
  xs.normalize();

  const basis = new THREE.Matrix4().makeBasis(xs, up, zs);
  const raw = new THREE.Quaternion().setFromRotationMatrix(basis);

  const angle = fC.angleTo(fT);
  // The raw basis is exact for any non-degenerate pair; confidence is a
  // validity gate, not an attenuation of an exact rotation. Reject near-
  // parallel/anti-parallel captures where the basis is ill-conditioned.
  const minAngle = Math.PI / 6;
  if (angle < minAngle || Math.PI - angle < minAngle) {
    return { ok: false, reason: 'poses-too-similar' };
  }
  const confidence = Math.sin(angle);
  const requestedStrength = typeof opts.strength === 'number' ? opts.strength : 1;
  const strength = Math.max(0, Math.min(1, requestedStrength));
  const weight = strength;
  const quaternion = new THREE.Quaternion().slerp(raw, weight);

  const posC = poseC.transform.position;
  const posT = poseT.transform.position;
  const pivot = new THREE.Vector3(
    (posC.x + posT.x) / 2,
    (posC.y + posT.y) / 2,
    (posC.z + posT.z) / 2
  );

  return {
    ok: true,
    quaternion,
    rawQuaternion: raw,
    pivot,
    up,
    forward,
    angleDeg: (angle * 180) / Math.PI,
    confidence,
    weight
  };
}

export function createComfort(options: {
  scene: THREE.Scene;
  world: THREE.Object3D;
}): ComfortApi {
  const { scene, world } = options;

  const group = new THREE.Group();
  group.name = 'comfort';
  scene.add(group);
  scene.remove(world);
  group.add(world);

  let calibrated = false;
  let mode: ComfortState['mode'] = 'none';
  const q0 = new THREE.Quaternion();
  const p0 = new THREE.Vector3();
  const rotatedPivot = new THREE.Vector3();
  let lastRemap: RemapResult | null = null;

  function applyRotation(q: THREE.Quaternion, pivot: THREE.Vector3): void {
    group.quaternion.copy(q);
    rotatedPivot.copy(pivot).applyQuaternion(q);
    group.position.copy(pivot).sub(rotatedPivot);
    calibrated = true;
  }

  function calibrate(pose: PoseLike): boolean {
    if (!pose.transform) {
      return false;
    }
    const p = pose.transform.position;
    const q = pose.transform.orientation;
    p0.set(p.x, p.y, p.z);
    q0.set(q.x, q.y, q.z, q.w);
    applyRotation(q0, p0);
    mode = 'single';
    lastRemap = null;
    return true;
  }

  function calibrateTwo(poseC: PoseLike, poseT: PoseLike, opts?: RemapOptions): RemapResult {
    const result = remapFromPoses(poseC, poseT, opts);
    if (!result.ok || !result.quaternion || !result.pivot) {
      return result;
    }
    applyRotation(result.quaternion, result.pivot);
    mode = 'two-pose';
    lastRemap = result;
    return result;
  }

  function reset(): void {
    group.quaternion.identity();
    group.position.set(0, 0, 0);
    calibrated = false;
    mode = 'none';
    lastRemap = null;
  }

  function getState(): ComfortState {
    const r = lastRemap;
    return {
      calibrated,
      mode,
      quaternion: [group.quaternion.x, group.quaternion.y, group.quaternion.z, group.quaternion.w],
      position: [group.position.x, group.position.y, group.position.z],
      remap: r && r.up && r.forward && r.pivot
        ? {
            up: [r.up.x, r.up.y, r.up.z],
            forward: [r.forward.x, r.forward.y, r.forward.z],
            pivot: [r.pivot.x, r.pivot.y, r.pivot.z],
            angleDeg: r.angleDeg ?? 0,
            confidence: r.confidence ?? 0,
            weight: r.weight ?? 0
          }
        : null
    };
  }

  return {
    group,
    calibrate,
    calibrateTwo,
    reset,
    isCalibrated: () => calibrated,
    getState
  };
}
