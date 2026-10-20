import * as THREE from 'three';
import type { PoseLike } from './types';

const DEG_PER_RAD = 180 / Math.PI;
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
  defaultDurationMs: 10000,
  /** A stop command brakes for this long instead of freezing instantly. */
  stopDecelMs: 320
} as const;

/**
 * Posture easing: quintic smootherstep, f(t) = 6t^5 - 15t^4 + 10t^3.
 *
 * Smoothstep only matches velocity at the endpoints; this curve matches
 * velocity *and* acceleration, so a transition starts and stops without a
 * jerk. The takeoff is also slower: at t = 0.1 smoothstep is already at 2.8 %
 * of the travel while this curve is at 0.86 %, so the first frames of an
 * operator command read as a drift rather than a push. Peak speed is 1.875x
 * the average (smoothstep: 1.5x), but the speed *change* is spread over the
 * whole transition instead of being concentrated at the ends.
 *
 * Input outside 0..1 (and NaN) is clamped, so callers cannot extrapolate.
 */
export function postureEase(t: number): number {
  const x = t > 0 ? (t < 1 ? t : 1) : 0;
  return x * x * x * (x * (6 * x - 15) + 10);
}

/** d/dt of `postureEase` per unit of normalised time: 30 t^2 (1 - t)^2. */
export function postureEaseRate(t: number): number {
  const x = t > 0 ? (t < 1 ? t : 1) : 0;
  const s = x * (1 - x);
  return 30 * s * s;
}

/**
 * Peak speed of a posture transition relative to its average, i.e.
 * `postureEaseRate(0.5)`. To honour the documented POSTURE_RATE envelope
 * (docs/control-interaction-spec.md §5: rise <= 0.05 m/s, pitch/roll <=
 * 2 deg/s) a requested duration must satisfy
 * `durationMs >= travel * POSTURE_EASE_PEAK / rate * 1000`; presets must be
 * tuned against this factor, not against the average. comfort.ts does not
 * stretch the requested duration itself: the 1 s neutral return used while
 * the scene is hidden (and the 1.2 m / 30 s corner) would be moved far off
 * the intended timing.
 */
export const POSTURE_EASE_PEAK = postureEaseRate(0.5);

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
    appliedWeight: number;
  } | null;
  /** 0..1 progress of the eased two-pose remap; 1 once settled. */
  remapProgress: number;
  posture: PostureState;
}

export interface ComfortApi {
  group: THREE.Group;
  calibrate(pose: PoseLike): boolean;
  /**
   * Two-pose remap. The new frame is eased in by `updatePosture(dt)`
   * (`remapDurationMs`), never applied as an instantaneous jump.
   * A rejected capture leaves the current calibration untouched.
   */
  calibrateTwo(poseC: PoseLike, poseT: PoseLike, opts?: RemapOptions): RemapResult;
  reset(): void;
  isCalibrated(): boolean;
  getState(): ComfortState;
  /**
   * Eased interpolation to the target posture. No-op until calibrated.
   * A new target while a transition runs starts from the current values with
   * zero speed, superseding any deceleration in progress.
   */
  setPosture(target: VirtualPosture, durationMs: number): void;
  /** Advance the posture, deceleration and remap transitions; `dt` is seconds. */
  updatePosture(dt: number): void;
  /**
   * Stop heading for the target: the remaining motion decelerates to rest
   * over `stopDecelMs` from the exact current speed. It never passes the
   * target. A later `setPosture` retargets from the braked pose.
   */
  stopPosture(): void;
  getPostureState(): PostureState;
  /**
   * Monotonic progress toward the current posture target, 0..1, no
   * allocation. A stopped transition keeps reporting the fraction it reached
   * while the brake runs out, so a head-locked cue never jumps to 1.
   */
  getPostureProgress(): number;
  /**
   * True while the world is still moving for the posture: an active
   * transition or the stop brake. Allocation-free, so a per-frame cue can
   * gate its flow on real motion instead of inferring it from progress (a
   * stopped transition freezes progress short of 1).
   */
  isPostureMoving(): boolean;
}

/**
 * Two-pose remap:
 *   toes direction  -> patient's body-down
 *   ceiling direction -> patient's front
 * Maps body-up to +Y and front to -Z. The measured angle is rarely 90
 * degrees, so the blend is weighted by the capture confidence (sin of the
 * angle) on top of the requested strength, and both the blend and the raw
 * rotation are capped: a noisy capture is corrected, never flipped.
 */
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
  const angleDeg = angle * DEG_PER_RAD;
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
  const maxRotationRad = THREE.MathUtils.degToRad(REMAP_LIMITS.maxRotationDeg);
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
    rawAngleDeg: rawAngle * DEG_PER_RAD
  };
}

export function createComfort(options: {
  scene: THREE.Scene;
  world: THREE.Object3D;
  /** Ease duration when a two-pose remap replaces the current frame. */
  remapDurationMs?: number;
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

  // Two-pose remap transition. The new frame is eased in from the currently
  // applied one by updatePosture, so a calibration never jumps the world.
  const q0Start = new THREE.Quaternion();
  const q0Target = new THREE.Quaternion();
  const p0Start = new THREE.Vector3();
  const p0Target = new THREE.Vector3();
  let remapActive = false;
  let remapElapsedMs = 0;
  const remapDurationMs = clampNumber(
    options.remapDurationMs,
    REMAP_TRANSITION_MS.default,
    REMAP_TRANSITION_MS.min,
    REMAP_TRANSITION_MS.max
  );

  // Posture layer. All scratch objects are allocated once: updatePosture runs
  // every frame and must not allocate.
  const posture = { pitchDeg: 0, rollDeg: 0, riseM: 0 };
  const postureStart = { pitchDeg: 0, rollDeg: 0, riseM: 0 };
  const postureTarget = { pitchDeg: 0, rollDeg: 0, riseM: 0 };
  const brakeStart = { pitchDeg: 0, rollDeg: 0, riseM: 0 };
  const brakeVelocity = { pitchDeg: 0, rollDeg: 0, riseM: 0 };
  const qPosture = new THREE.Quaternion();
  const qTotal = new THREE.Quaternion();
  const postureEuler = new THREE.Euler(0, 0, 0, 'XYZ');
  let postureActive = false;
  let postureElapsedMs = 0;
  let postureDurationMs = 0;
  let postureDirection: 'rising' | 'lowering' = 'rising';
  let braking = false;
  let brakeElapsedMs = 0;

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

  /** Smoothstep for the two-pose remap frame; posture uses `postureEase`. */
  function easeInOut(t: number): number {
    const c = t < 0 ? 0 : t > 1 ? 1 : t;
    return c * c * (3 - 2 * c);
  }

  /** Keep a decelerating value inside the segment it was travelling along. */
  function clampToSegment(value: number, from: number, to: number): number {
    const low = from < to ? from : to;
    const high = from < to ? to : from;
    return value < low ? low : value > high ? high : value;
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
    braking = false;
    brakeElapsedMs = 0;
    brakeStart.pitchDeg = 0;
    brakeStart.rollDeg = 0;
    brakeStart.riseM = 0;
    brakeVelocity.pitchDeg = 0;
    brakeVelocity.rollDeg = 0;
    brakeVelocity.riseM = 0;
  }

  function setPosture(target: VirtualPosture, durationMs: number): void {
    // Without calibration there is no pivot to move around: stay neutral.
    if (!calibrated) {
      return;
    }
    // A fresh target supersedes any deceleration in progress.
    braking = false;
    brakeElapsedMs = 0;
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

  /**
   * Decelerate a stopped transition to rest. Velocity decays as (1-u)^2 over
   * `stopDecelMs`, so the pose creeps forward smoothly instead of snapping to
   * a halt, and the travel is clamped to the segment it was following.
   * The initial velocity is the exact derivative of `postureEase` at the stop
   * instant, so stopping never introduces a speed jump.
   */
  function advanceBrake(dt: number): void {
    const durationMs = POSTURE_LIMITS.stopDecelMs;
    brakeElapsedMs = Math.min(durationMs, brakeElapsedMs + dt * 1000);
    const u = durationMs > 0 ? brakeElapsedMs / durationMs : 1;
    // Displacement of a (1-s)^2 velocity ramp: integral of u - u^2 + u^3/3.
    const distance = (u - u * u + (u * u * u) / 3) * (durationMs / 1000);
    posture.pitchDeg = clampToSegment(
      brakeStart.pitchDeg + brakeVelocity.pitchDeg * distance,
      brakeStart.pitchDeg,
      postureTarget.pitchDeg
    );
    posture.rollDeg = clampToSegment(
      brakeStart.rollDeg + brakeVelocity.rollDeg * distance,
      brakeStart.rollDeg,
      postureTarget.rollDeg
    );
    posture.riseM = clampToSegment(
      brakeStart.riseM + brakeVelocity.riseM * distance,
      brakeStart.riseM,
      postureTarget.riseM
    );
    if (brakeElapsedMs >= durationMs) {
      braking = false;
    }
  }

  function updatePosture(dt: number): void {
    if (!calibrated) {
      return;
    }
    if (!Number.isFinite(dt) || dt <= 0) {
      return;
    }
    if (!remapActive && !postureActive && !braking) {
      return;
    }

    if (remapActive) {
      remapElapsedMs = Math.min(remapDurationMs, remapElapsedMs + dt * 1000);
      const remapT = remapDurationMs > 0 ? remapElapsedMs / remapDurationMs : 1;
      const remapEased = easeInOut(remapT);
      q0.slerpQuaternions(q0Start, q0Target, remapEased);
      p0.lerpVectors(p0Start, p0Target, remapEased);
      if (remapElapsedMs >= remapDurationMs) {
        remapActive = false;
        q0.copy(q0Target);
        p0.copy(p0Target);
      }
    }

    if (postureActive) {
      postureElapsedMs = Math.min(postureDurationMs, postureElapsedMs + dt * 1000);
      const t = postureDurationMs > 0 ? postureElapsedMs / postureDurationMs : 1;
      const eased = postureEase(t);
      posture.pitchDeg = postureStart.pitchDeg + (postureTarget.pitchDeg - postureStart.pitchDeg) * eased;
      posture.rollDeg = postureStart.rollDeg + (postureTarget.rollDeg - postureStart.rollDeg) * eased;
      posture.riseM = postureStart.riseM + (postureTarget.riseM - postureStart.riseM) * eased;
      if (postureElapsedMs >= postureDurationMs) {
        postureActive = false;
        posture.pitchDeg = postureTarget.pitchDeg;
        posture.rollDeg = postureTarget.rollDeg;
        posture.riseM = postureTarget.riseM;
      }
    } else if (braking) {
      advanceBrake(dt);
    }

    applyTransform();
  }

  function stopPosture(): void {
    // The stop command always wins; only the motion is smoothed out.
    if (!postureActive) {
      return;
    }
    const t = postureDurationMs > 0 ? Math.min(1, postureElapsedMs / postureDurationMs) : 1;
    // d/dt of postureEase at the stop moment, i.e. pose units per second.
    // Zero at both ends of a transition, so a stop there coasts not at all.
    const rate = postureDurationMs > 0 ? (postureEaseRate(t) * 1000) / postureDurationMs : 0;
    brakeStart.pitchDeg = posture.pitchDeg;
    brakeStart.rollDeg = posture.rollDeg;
    brakeStart.riseM = posture.riseM;
    brakeVelocity.pitchDeg = (postureTarget.pitchDeg - postureStart.pitchDeg) * rate;
    brakeVelocity.rollDeg = (postureTarget.rollDeg - postureStart.rollDeg) * rate;
    brakeVelocity.riseM = (postureTarget.riseM - postureStart.riseM) * rate;
    postureActive = false;
    brakeElapsedMs = 0;
    // A stop within a hair of the end leaves nothing to coast out: treat it
    // as at rest instead of reporting 320 ms of invisible motion.
    const coast =
      Math.max(
        Math.abs(brakeVelocity.pitchDeg),
        Math.abs(brakeVelocity.rollDeg),
        Math.abs(brakeVelocity.riseM)
      ) *
      (POSTURE_LIMITS.stopDecelMs / 3000);
    braking = coast > 1e-4;
  }

  function getPostureState(): PostureState {
    const engaged = postureEngagement(posture) > 1e-6;
    // Progress tracks the target transition. A stopped transition keeps the
    // fraction it reached while the brake runs out, so the value is stable.
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

  function getPostureProgress(): number {
    // A stopped transition keeps the fraction it reached while the brake runs
    // out, so a head-locked cue driven by this value never jumps to 1 while
    // the world is still creeping to rest.
    if (postureEngagement(posture) <= 1e-6) {
      return 0;
    }
    return postureDurationMs > 0
      ? Math.min(1, postureElapsedMs / postureDurationMs)
      : 1;
  }

  /** A cue must gate on this, not on `progress`, which freezes at a stop. */
  function isPostureMoving(): boolean {
    return postureActive || braking;
  }

  function calibrate(pose: PoseLike): boolean {
    if (!pose.transform) {
      return false;
    }
    const p = pose.transform.position;
    const q = pose.transform.orientation;
    p0.set(p.x, p.y, p.z);
    q0.set(q.x, q.y, q.z, q.w);
    remapActive = false;
    remapElapsedMs = 0;
    calibrated = true;
    applyTransform();
    mode = 'single';
    lastRemap = null;
    return true;
  }

  function calibrateTwo(poseC: PoseLike, poseT: PoseLike, opts?: RemapOptions): RemapResult {
    const result = remapFromPoses(poseC, poseT, opts);
    if (!result.ok || !result.quaternion || !result.pivot) {
      // A rejected capture must not disturb the frame already in use.
      return result;
    }
    // Ease from whatever frame is applied right now into the new one;
    // updatePosture advances it, so the world never snaps to the new basis.
    q0Start.copy(q0);
    p0Start.copy(p0);
    q0Target.copy(result.quaternion);
    p0Target.copy(result.pivot);
    remapElapsedMs = 0;
    remapActive = true;
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
    remapActive = false;
    remapElapsedMs = 0;
    q0.identity();
    p0.set(0, 0, 0);
    q0Start.identity();
    q0Target.identity();
    p0Start.set(0, 0, 0);
    p0Target.set(0, 0, 0);
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
            weight: r.weight ?? 0,
            appliedWeight: r.appliedWeight ?? r.weight ?? 0
          }
        : null,
      remapProgress: remapActive ? Math.min(1, remapElapsedMs / remapDurationMs) : 1,
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
    getPostureState,
    getPostureProgress,
    isPostureMoving
  };
}
