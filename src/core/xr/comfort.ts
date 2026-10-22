import * as THREE from 'three';
import type { PoseLike } from './types';
import {
  aroundPivot,
  clearTransform,
  worldQuaternion,
  writeBase,
  type WorldRotation
} from './frame';
import {
  brakeTravel,
  smoothstep,
  smootherstep,
  smootherstepRate
} from './drivers/curve';
import {
  remapFromPoses,
  REMAP_TRANSITION_MS,
  type RemapOptions,
  type RemapResult
} from './remap';

/**
 * Remote virtual posture. The world is tilted and lowered around the
 * calibration pivot; the XR camera is never touched.
 *
 * `worldPitchDeg` / `worldRollDeg` are world-frame degrees: +pitch rotates
 * content up about +X, so the patient perceives a downward tilt.
 */
export interface VirtualPosture {
  /** Pitch about the world X axis, positive tilts the world up. */
  worldPitchDeg: number;
  /** Optional roll about the world Z axis. */
  worldRollDeg?: number;
  /** World is lowered by this many metres, which reads as the patient rising. */
  riseM: number;
}

export type PosturePhase = 'neutral' | 'rising' | 'standing' | 'lowering';

export interface PostureState {
  phase: PosturePhase;
  worldPitchDeg: number;
  worldRollDeg: number;
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
  /**
   * The calibration frame currently applied (`q0`). Readers measure against
   * it instead of re-deriving posture angles from progress.
   */
  getCalibrationQuaternion(out?: THREE.Quaternion): THREE.Quaternion;
  getState(): ComfortState;
  /**
   * Eased interpolation to the target posture. No-op until calibrated.
   * A new target while a transition runs starts from the current values with
   * zero speed, superseding any deceleration in progress.
   */
  setPosture(target: VirtualPosture, durationMs: number, maxPitchDeg?: number): void;
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
   * Phase alone, without building a `PostureState`. Per-frame callers (the
   * particle flow gate) use this so a 60 Hz loop stays allocation-free.
   */
  getPosturePhase(): PostureState['phase'];
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
  const posture = { worldPitchDeg: 0, worldRollDeg: 0, riseM: 0 };
  const postureStart = { worldPitchDeg: 0, worldRollDeg: 0, riseM: 0 };
  const postureTarget = { worldPitchDeg: 0, worldRollDeg: 0, riseM: 0 };
  const brakeStart = { worldPitchDeg: 0, worldRollDeg: 0, riseM: 0 };
  const brakeVelocity = { worldPitchDeg: 0, worldRollDeg: 0, riseM: 0 };
  const postureRotation: WorldRotation = { pitchDeg: 0, rollDeg: 0, yawDeg: 0 };
  const qPosture = new THREE.Quaternion();
  const qTotal = new THREE.Quaternion();
  const basePosition = new THREE.Vector3();
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
    postureRotation.pitchDeg = posture.worldPitchDeg;
    postureRotation.rollDeg = posture.worldRollDeg;
    worldQuaternion(qPosture, postureRotation);
    // Posture is expressed in the calibrated comfort frame, so it multiplies
    // on the left: q_total = q_posture * q_calibration.
    qTotal.multiplyQuaternions(qPosture, q0);
    // Rotate the world around the calibration pivot, then lower it by riseM.
    aroundPivot(basePosition, qTotal, p0);
    basePosition.y -= posture.riseM;
    writeBase(group, qTotal, basePosition);
  }

  function clampNumber(value: number | undefined, fallback: number, min: number, max: number): number {
    if (value === undefined || !Number.isFinite(value)) {
      return fallback;
    }
    return value < min ? min : value > max ? max : value;
  }

  /** Keep a decelerating value inside the segment it was travelling along. */
  function clampToSegment(value: number, from: number, to: number): number {
    const low = from < to ? from : to;
    const high = from < to ? to : from;
    return value < low ? low : value > high ? high : value;
  }

  /** How engaged a posture is; rise dominates because it drives the phase. */
  function postureEngagement(p: { worldPitchDeg: number; worldRollDeg: number; riseM: number }): number {
    return p.riseM + (Math.abs(p.worldPitchDeg) + Math.abs(p.worldRollDeg)) * 0.01;
  }

  function clearPosture(): void {
    posture.worldPitchDeg = 0;
    posture.worldRollDeg = 0;
    posture.riseM = 0;
    postureStart.worldPitchDeg = 0;
    postureStart.worldRollDeg = 0;
    postureStart.riseM = 0;
    postureTarget.worldPitchDeg = 0;
    postureTarget.worldRollDeg = 0;
    postureTarget.riseM = 0;
    postureActive = false;
    postureElapsedMs = 0;
    postureDurationMs = 0;
    postureDirection = 'rising';
    braking = false;
    brakeElapsedMs = 0;
    brakeStart.worldPitchDeg = 0;
    brakeStart.worldRollDeg = 0;
    brakeStart.riseM = 0;
    brakeVelocity.worldPitchDeg = 0;
    brakeVelocity.worldRollDeg = 0;
    brakeVelocity.riseM = 0;
  }

  function setPosture(
    target: VirtualPosture,
    durationMs: number,
    maxPitchDeg: number = POSTURE_LIMITS.maxPitchDeg
  ): void {
    // Without calibration there is no pivot to move around: stay neutral.
    if (!calibrated) {
      return;
    }
    const pitchLimit = clampNumber(
      maxPitchDeg,
      POSTURE_LIMITS.maxPitchDeg,
      0,
      90
    );
    // A fresh target supersedes any deceleration in progress.
    braking = false;
    brakeElapsedMs = 0;
    postureStart.worldPitchDeg = posture.worldPitchDeg;
    postureStart.worldRollDeg = posture.worldRollDeg;
    postureStart.riseM = posture.riseM;

    postureTarget.worldPitchDeg = clampNumber(
      target?.worldPitchDeg,
      0,
      -pitchLimit,
      pitchLimit
    );
    postureTarget.worldRollDeg = clampNumber(
      target?.worldRollDeg,
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
      postureTarget.worldPitchDeg === posture.worldPitchDeg &&
      postureTarget.worldRollDeg === posture.worldRollDeg &&
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
   * The initial velocity is the exact derivative of `smootherstep` at the stop
   * instant, so stopping never introduces a speed jump.
   */
  function advanceBrake(dt: number): void {
    const durationMs = POSTURE_LIMITS.stopDecelMs;
    brakeElapsedMs = Math.min(durationMs, brakeElapsedMs + dt * 1000);
    const u = durationMs > 0 ? brakeElapsedMs / durationMs : 1;
    const distance = brakeTravel(u, durationMs / 1000);
    posture.worldPitchDeg = clampToSegment(
      brakeStart.worldPitchDeg + brakeVelocity.worldPitchDeg * distance,
      brakeStart.worldPitchDeg,
      postureTarget.worldPitchDeg
    );
    posture.worldRollDeg = clampToSegment(
      brakeStart.worldRollDeg + brakeVelocity.worldRollDeg * distance,
      brakeStart.worldRollDeg,
      postureTarget.worldRollDeg
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
      const remapEased = smoothstep(remapT);
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
      const eased = smootherstep(t);
      posture.worldPitchDeg =
        postureStart.worldPitchDeg +
        (postureTarget.worldPitchDeg - postureStart.worldPitchDeg) * eased;
      posture.worldRollDeg =
        postureStart.worldRollDeg +
        (postureTarget.worldRollDeg - postureStart.worldRollDeg) * eased;
      posture.riseM =
        postureStart.riseM + (postureTarget.riseM - postureStart.riseM) * eased;
      if (postureElapsedMs >= postureDurationMs) {
        postureActive = false;
        posture.worldPitchDeg = postureTarget.worldPitchDeg;
        posture.worldRollDeg = postureTarget.worldRollDeg;
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
    // d/dt of smootherstep at the stop moment, i.e. pose units per second.
    // Zero at both ends of a transition, so a stop there coasts not at all.
    const rate = postureDurationMs > 0 ? (smootherstepRate(t) * 1000) / postureDurationMs : 0;
    brakeStart.worldPitchDeg = posture.worldPitchDeg;
    brakeStart.worldRollDeg = posture.worldRollDeg;
    brakeStart.riseM = posture.riseM;
    brakeVelocity.worldPitchDeg =
      (postureTarget.worldPitchDeg - postureStart.worldPitchDeg) * rate;
    brakeVelocity.worldRollDeg =
      (postureTarget.worldRollDeg - postureStart.worldRollDeg) * rate;
    brakeVelocity.riseM = (postureTarget.riseM - postureStart.riseM) * rate;
    postureActive = false;
    brakeElapsedMs = 0;
    // A stop within a hair of the end leaves nothing to coast out: treat it
    // as at rest instead of reporting 320 ms of invisible motion.
    const coast =
      Math.max(
        Math.abs(brakeVelocity.worldPitchDeg),
        Math.abs(brakeVelocity.worldRollDeg),
        Math.abs(brakeVelocity.riseM)
      ) *
      (POSTURE_LIMITS.stopDecelMs / 3000);
    braking = coast > 1e-4;
  }

  /** Allocation-free; `getPostureState` shares the same rule. */
  function getPosturePhase(): PostureState['phase'] {
    if (postureActive) {
      return postureDirection;
    }
    return postureEngagement(posture) > 1e-6 ? 'standing' : 'neutral';
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
      phase: getPosturePhase(),
      worldPitchDeg: posture.worldPitchDeg,
      worldRollDeg: posture.worldRollDeg,
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
    clearTransform(group);
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
    getCalibrationQuaternion: (out = new THREE.Quaternion()) => out.copy(q0),
    getState,
    setPosture,
    updatePosture,
    stopPosture,
    getPostureState,
    getPosturePhase,
    getPostureProgress,
    isPostureMoving
  };
}
