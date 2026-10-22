import * as THREE from 'three';
import { degToRad, radToDeg } from './angle';
import type { PoseLike } from './types';

/**
 * Two-pose calibration geometry.
 *
 *   toes direction    -> patient's body-down
 *   ceiling direction -> patient's front
 *
 * Maps body-up to +Y and front to -Z. The measured angle is rarely 90 degrees,
 * so the blend is weighted by the capture confidence (sin of the angle) on top
 * of the requested strength, and both the blend and the raw rotation are
 * capped: a noisy capture is corrected, never flipped.
 *
 * Pure geometry: no scene, no timers, no comfort state.
 */

/** Read-only identity, used to measure how far a raw basis rotates. */
const IDENTITY_QUATERNION = new THREE.Quaternion();

/** Unit orientation of a captured pose, or null when the sample is unusable. */
function poseQuaternion(pose: PoseLike | undefined): THREE.Quaternion | null {
  const o = pose?.transform?.orientation;
  if (!o) {
    return null;
  }
  if (
    !Number.isFinite(o.x) ||
    !Number.isFinite(o.y) ||
    !Number.isFinite(o.z) ||
    !Number.isFinite(o.w)
  ) {
    return null;
  }
  const q = new THREE.Quaternion(o.x, o.y, o.z, o.w);
  if (q.lengthSq() < 1e-12) {
    return null;
  }
  return q.normalize();
}

export interface RemapOptions {
  /** 0..1; 1 by default. Scales the confidence-weighted blend. */
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
  /** Requested blend: clamp(strength * confidence, 0, maxWeight). */
  weight?: number;
  /** Blend actually applied after the rotation-angle cap. Never exceeds weight. */
  appliedWeight?: number;
  /** Rotation angle of the raw basis, before any cap. */
  rawAngleDeg?: number;
}

/**
 * Safety envelope for two-pose captures. A noisy capture is either rejected
 * or attenuated: it can never rotate the world far enough to invert it.
 */
export const REMAP_LIMITS = {
  /** Below this sin(angle) the capture pair is too noisy to trust. */
  minConfidence: 0.35,
  /** Captures closer than this angle (or its supplement) are ill-conditioned. */
  minAngleDeg: 15,
  /** Hard cap on the blend; the raw basis is never applied at full strength. */
  maxWeight: 0.85,
  /** Hard cap on the applied rotation, whatever the raw basis says. */
  maxRotationDeg: 120,
  /** Pivots closer than this are treated as one duplicated sample. */
  minPivotSeparationM: 0.005
} as const;

/** Easing applied when a two-pose remap replaces the current frame. */
export const REMAP_TRANSITION_MS = {
  min: 200,
  max: 4000,
  default: 900
} as const;

export function remapFromPoses(
  poseC: PoseLike,
  poseT: PoseLike,
  opts: RemapOptions = {}
): RemapResult {
  if (!poseC?.transform || !poseT?.transform) {
    return { ok: false, reason: 'missing-pose' };
  }
  const qC = poseQuaternion(poseC);
  const qT = poseQuaternion(poseT);
  if (!qC || !qT) {
    return { ok: false, reason: 'invalid-pose' };
  }

  const posC = poseC.transform.position;
  const posT = poseT.transform.position;
  const pivot = new THREE.Vector3(
    (posC.x + posT.x) / 2,
    (posC.y + posT.y) / 2,
    (posC.z + posT.z) / 2
  );
  if (!Number.isFinite(pivot.x) || !Number.isFinite(pivot.y) || !Number.isFinite(pivot.z)) {
    return { ok: false, reason: 'invalid-pivot' };
  }
  // Poses captured without the headset moving at all are one duplicated
  // sample, not a two-pose calibration; their midpoint is an arbitrary spot.
  const separation = Math.hypot(posT.x - posC.x, posT.y - posC.y, posT.z - posC.z);
  if (!(separation >= REMAP_LIMITS.minPivotSeparationM)) {
    return { ok: false, reason: 'degenerate-pivot', pivot };
  }

  const fC = new THREE.Vector3(0, 0, -1).applyQuaternion(qC);
  const fT = new THREE.Vector3(0, 0, -1).applyQuaternion(qT);

  const up = fT.clone().negate();
  if (up.lengthSq() < 1e-8) {
    return { ok: false, reason: 'toes-zero', pivot };
  }
  up.normalize();

  const forward = fC.clone().addScaledVector(up, -fC.dot(up));
  if (forward.lengthSq() < 1e-6) {
    return { ok: false, reason: 'poses-parallel', pivot, up };
  }
  forward.normalize();

  const zs = forward.clone().negate();
  const xs = new THREE.Vector3().crossVectors(up, zs);
  if (xs.lengthSq() < 1e-8) {
    return { ok: false, reason: 'degenerate', pivot, up, forward };
  }
  xs.normalize();

  const basis = new THREE.Matrix4().makeBasis(xs, up, zs);
  const raw = new THREE.Quaternion().setFromRotationMatrix(basis);

  const angle = fC.angleTo(fT);
  const angleDeg = radToDeg(angle);
  const confidence = Math.sin(angle);
  // Keep the measurements on the failure result: an operator diagnosing a
  // bad capture needs them, and they are exactly what the success path used.
  const measurements = { pivot, up, forward, angleDeg, confidence, rawQuaternion: raw };

  // Near-parallel or near-anti-parallel captures leave the basis
  // ill-conditioned, so the derived frame is dominated by sensor noise.
  if (
    angleDeg < REMAP_LIMITS.minAngleDeg ||
    angleDeg > 180 - REMAP_LIMITS.minAngleDeg
  ) {
    return { ok: false, reason: 'poses-too-similar', ...measurements };
  }
  // sin(angle) is the geometric margin of the capture. Below the threshold
  // the operator most likely sampled the same body axis twice.
  if (!(confidence >= REMAP_LIMITS.minConfidence)) {
    return { ok: false, reason: 'low-confidence', ...measurements };
  }
  // Non-finite strength falls back to full correction instead of poisoning
  // the frame with NaN.
  const requestedStrength =
    typeof opts?.strength === 'number' && Number.isFinite(opts.strength) ? opts.strength : 1;
  const strength =
    requestedStrength < 0 ? 0 : requestedStrength > 1 ? 1 : requestedStrength;
  const weight = Math.min(strength * confidence, REMAP_LIMITS.maxWeight);

  // The raw basis may describe an almost complete inversion. Cap what is
  // actually blended into identity so the world can never turn over.
  const rawAngle = raw.angleTo(IDENTITY_QUATERNION);
  const maxRotationRad = degToRad(REMAP_LIMITS.maxRotationDeg);
  const appliedWeight =
    rawAngle > 1e-6 ? Math.min(weight, maxRotationRad / rawAngle) : 0;
  const quaternion = new THREE.Quaternion().slerp(raw, appliedWeight);

  return {
    ok: true,
    quaternion,
    rawQuaternion: raw,
    pivot,
    up,
    forward,
    angleDeg,
    confidence,
    weight,
    appliedWeight,
    rawAngleDeg: radToDeg(rawAngle)
  };
}
