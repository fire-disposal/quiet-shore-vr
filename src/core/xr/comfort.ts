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

/**
 * Remote virtual posture. The world is tilted and lowered around the
 * calibration pivot; the XR camera is never touched.
 */
export interface VirtualPosture {
  /** Pitch about the comfort-frame X axis, positive tilts the world up. */
  pitchDeg: number;
  /** Optional roll about the comfort-frame Z axis. */
  rollDeg?: number;
  /** World is lowered by this many metres, which reads as the patient rising. */
  riseM: number;
}

export interface PostureState {
  phase: 'neutral' | 'rising' | 'standing' | 'lowering';
  pitchDeg: number;
  rollDeg: number;
  riseM: number;
  /** 0..1 progress of the active or last transition; 0 while neutral. */
  progress: number;
}

/** Clamp ranges for operator-driven posture. Slow, bounded motion only. */
export const POSTURE_LIMITS = {
  maxPitchDeg: 20,
  maxRollDeg: 10,
  maxRiseM: 1.2,
  minDurationMs: 1000,
  maxDurationMs: 30000,
  defaultDurationMs: 10000
} as const;

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
  posture: PostureState;
}

export interface ComfortApi {
  group: THREE.Group;
  calibrate(pose: PoseLike): boolean;
  calibrateTwo(poseC: PoseLike, poseT: PoseLike, opts?: RemapOptions): RemapResult;
  reset(): void;
  isCalibrated(): boolean;
  getState(): ComfortState;
  /**
   * Eased interpolation to the target posture. No-op until calibrated.
   * A new target while a transition runs starts from the current values.
   */
  setPosture(target: VirtualPosture, durationMs: number): void;
  /** Advance the posture transition; `dt` is in seconds. */
  updatePosture(dt: number): void;
  /** Freeze the posture where it currently is. */
  stopPosture(): void;
  getPostureState(): PostureState;
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

  // Posture layer. All scratch objects are allocated once: updatePosture runs
  // every frame and must not allocate.
  const posture = { pitchDeg: 0, rollDeg: 0, riseM: 0 };
  const postureStart = { pitchDeg: 0, rollDeg: 0, riseM: 0 };
  const postureTarget = { pitchDeg: 0, rollDeg: 0, riseM: 0 };
  const qPosture = new THREE.Quaternion();
  const qTotal = new THREE.Quaternion();
  const postureEuler = new THREE.Euler(0, 0, 0, 'XYZ');
  let postureActive = false;
  let postureElapsedMs = 0;
  let postureDurationMs = 0;
  let postureDirection: 'rising' | 'lowering' = 'rising';

  function applyTransform(): void {
    if (!calibrated) {
      return;
    }
    postureEuler.set(
      THREE.MathUtils.degToRad(posture.pitchDeg),
      0,
      THREE.MathUtils.degToRad(posture.rollDeg),
      'XYZ'
    );
    qPosture.setFromEuler(postureEuler);
    // Posture is expressed in the calibrated comfort frame, so it multiplies
    // on the left: q_total = q_posture * q_calibration.
    qTotal.multiplyQuaternions(qPosture, q0);
    // Rotate the world around the calibration pivot, then lower it by riseM.
    rotatedPivot.copy(p0).applyQuaternion(qTotal);
    group.quaternion.copy(qTotal);
    group.position.copy(p0).sub(rotatedPivot);
    group.position.y -= posture.riseM;
  }

  function clampNumber(value: number | undefined, fallback: number, min: number, max: number): number {
    if (value === undefined || !Number.isFinite(value)) {
      return fallback;
    }
    return value < min ? min : value > max ? max : value;
  }

  function easeInOut(t: number): number {
    const c = t < 0 ? 0 : t > 1 ? 1 : t;
    return c * c * (3 - 2 * c);
  }

  /** How engaged a posture is; rise dominates because it drives the phase. */
  function postureEngagement(p: { pitchDeg: number; rollDeg: number; riseM: number }): number {
    return p.riseM + (Math.abs(p.pitchDeg) + Math.abs(p.rollDeg)) * 0.01;
  }

  function clearPosture(): void {
    posture.pitchDeg = 0;
    posture.rollDeg = 0;
    posture.riseM = 0;
    postureStart.pitchDeg = 0;
    postureStart.rollDeg = 0;
    postureStart.riseM = 0;
    postureTarget.pitchDeg = 0;
    postureTarget.rollDeg = 0;
    postureTarget.riseM = 0;
    postureActive = false;
    postureElapsedMs = 0;
    postureDurationMs = 0;
    postureDirection = 'rising';
  }

  function setPosture(target: VirtualPosture, durationMs: number): void {
    // Without calibration there is no pivot to move around: stay neutral.
    if (!calibrated) {
      return;
    }
    postureStart.pitchDeg = posture.pitchDeg;
    postureStart.rollDeg = posture.rollDeg;
    postureStart.riseM = posture.riseM;

    postureTarget.pitchDeg = clampNumber(
      target?.pitchDeg,
      0,
      -POSTURE_LIMITS.maxPitchDeg,
      POSTURE_LIMITS.maxPitchDeg
    );
    postureTarget.rollDeg = clampNumber(
      target?.rollDeg,
      0,
      -POSTURE_LIMITS.maxRollDeg,
      POSTURE_LIMITS.maxRollDeg
    );
    postureTarget.riseM = clampNumber(target?.riseM, 0, 0, POSTURE_LIMITS.maxRiseM);

    postureDurationMs = clampNumber(
      durationMs,
      POSTURE_LIMITS.defaultDurationMs,
      POSTURE_LIMITS.minDurationMs,
      POSTURE_LIMITS.maxDurationMs
    );
    postureElapsedMs = 0;
    postureDirection =
      postureEngagement(postureTarget) >= postureEngagement(postureStart) ? 'rising' : 'lowering';

    const unchanged =
      postureTarget.pitchDeg === posture.pitchDeg &&
      postureTarget.rollDeg === posture.rollDeg &&
      postureTarget.riseM === posture.riseM;
    postureActive = !unchanged;
    if (unchanged) {
      // Nothing to animate; report the transition as already settled.
      postureElapsedMs = postureDurationMs;
    }
  }

  function updatePosture(dt: number): void {
    if (!postureActive || !calibrated) {
      return;
    }
    if (!Number.isFinite(dt) || dt <= 0) {
      return;
    }
    postureElapsedMs = Math.min(postureDurationMs, postureElapsedMs + dt * 1000);
    const t = postureDurationMs > 0 ? postureElapsedMs / postureDurationMs : 1;
    const eased = easeInOut(t);
    posture.pitchDeg = postureStart.pitchDeg + (postureTarget.pitchDeg - postureStart.pitchDeg) * eased;
    posture.rollDeg = postureStart.rollDeg + (postureTarget.rollDeg - postureStart.rollDeg) * eased;
    posture.riseM = postureStart.riseM + (postureTarget.riseM - postureStart.riseM) * eased;
    if (postureElapsedMs >= postureDurationMs) {
      postureActive = false;
      posture.pitchDeg = postureTarget.pitchDeg;
      posture.rollDeg = postureTarget.rollDeg;
      posture.riseM = postureTarget.riseM;
    }
    applyTransform();
  }

  function stopPosture(): void {
    // Keep the current values; only the interpolation stops.
    postureActive = false;
  }

  function getPostureState(): PostureState {
    const engaged = postureEngagement(posture) > 1e-6;
    const progress = !engaged
      ? 0
      : postureDurationMs > 0
        ? Math.min(1, postureElapsedMs / postureDurationMs)
        : 1;
    return {
      phase: postureActive ? postureDirection : engaged ? 'standing' : 'neutral',
      pitchDeg: posture.pitchDeg,
      rollDeg: posture.rollDeg,
      riseM: posture.riseM,
      progress
    };
  }

  function calibrate(pose: PoseLike): boolean {
    if (!pose.transform) {
      return false;
    }
    const p = pose.transform.position;
    const q = pose.transform.orientation;
    p0.set(p.x, p.y, p.z);
    q0.set(q.x, q.y, q.z, q.w);
    calibrated = true;
    applyTransform();
    mode = 'single';
    lastRemap = null;
    return true;
  }

  function calibrateTwo(poseC: PoseLike, poseT: PoseLike, opts?: RemapOptions): RemapResult {
    const result = remapFromPoses(poseC, poseT, opts);
    if (!result.ok || !result.quaternion || !result.pivot) {
      return result;
    }
    q0.copy(result.quaternion);
    p0.copy(result.pivot);
    calibrated = true;
    applyTransform();
    mode = 'two-pose';
    lastRemap = result;
    return result;
  }

  function reset(): void {
    clearPosture();
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
        : null,
      posture: getPostureState()
    };
  }

  return {
    group,
    calibrate,
    calibrateTwo,
    reset,
    isCalibrated: () => calibrated,
    getState,
    setPosture,
    updatePosture,
    stopPosture,
    getPostureState
  };
}
