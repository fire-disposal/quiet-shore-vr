import * as THREE from 'three';
import type { PoseLike } from './types';
import { aroundPivot, clearTransform, writeBase } from './frame';

/**
 * The one world frame the patient lives in.
 *
 * Calibration records the head orientation the patient is holding and splits it
 * into two parts:
 *
 * ```text
 * q0          = qYaw · qCorrection          (XR convention, YXZ)
 * qYaw        heading only: the room's front is put on the patient's heading
 * qCorrection pitch/roll: what makes a supine patient see the front wall
 * ```
 *
 * The frame applies `qYaw · slerp(identity, qCorrection, mix)`, so one scalar
 * carries the whole story:
 *
 * - `mix = 0` — the world as the head physically sees it: a real ceiling
 *   overhead, the room turned to the patient's heading. This is where a session
 *   starts.
 * - `mix = 1` — fully corrected: the patient's comfortable posture faces the
 *   front wall, i.e. the view a standing person would have.
 *
 * The rise animation is a ramp of that scalar; nothing else rotates the world.
 * Easing lives in the caller (`world-runtime`), this module only applies a mix.
 */
export interface ComfortState {
  calibrated: boolean;
  /** 0 = uncorrected (real ceiling), 1 = fully corrected. */
  mix: number;
  quaternion: [number, number, number, number];
  position: [number, number, number];
}

export interface ComfortApi {
  group: THREE.Group;
  /** Adopt the pose as the frame; starts uncorrected (mix 0). */
  calibrate(pose: PoseLike): boolean;
  reset(): void;
  isCalibrated(): boolean;
  /** `q0` as captured; readers compare against it rather than re-deriving. */
  getCalibrationQuaternion(out?: THREE.Quaternion): THREE.Quaternion;
  setCorrectionMix(mix: number): void;
  getCorrectionMix(): number;
  getState(): ComfortState;
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
  const p0 = new THREE.Vector3();
  const q0 = new THREE.Quaternion();
  const qYaw = new THREE.Quaternion();
  const qCorrection = new THREE.Quaternion();
  const qMix = new THREE.Quaternion();
  const qTotal = new THREE.Quaternion();
  const identity = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const euler = new THREE.Euler(0, 0, 0, 'YXZ');
  const basePosition = new THREE.Vector3();
  let mix = 0;

  function apply(): void {
    if (!calibrated) {
      return;
    }
    qMix.slerpQuaternions(identity, qCorrection, mix);
    qTotal.multiplyQuaternions(qYaw, qMix);
    // The frame rotates about the eye the patient held at calibration, so the
    // eye stays put and only the world turns around it.
    aroundPivot(basePosition, qTotal, p0);
    writeBase(group, qTotal, basePosition);
  }

  function calibrate(pose: PoseLike): boolean {
    if (!pose.transform) {
      return false;
    }
    const p = pose.transform.position;
    const q = pose.transform.orientation;
    p0.set(p.x, p.y, p.z);
    q0.set(q.x, q.y, q.z, q.w).normalize();
    // YXZ decomposition: its y is the heading, the rest is the correction.
    euler.setFromQuaternion(q0, 'YXZ');
    qYaw.setFromAxisAngle(up, euler.y);
    qCorrection.copy(qYaw).invert().multiply(q0);
    calibrated = true;
    mix = 0;
    apply();
    return true;
  }

  function reset(): void {
    calibrated = false;
    mix = 0;
    q0.identity();
    qYaw.identity();
    qCorrection.identity();
    p0.set(0, 0, 0);
    clearTransform(group);
  }

  return {
    group,
    calibrate,
    reset,
    isCalibrated: () => calibrated,
    getCalibrationQuaternion: (out = new THREE.Quaternion()) => out.copy(q0),
    setCorrectionMix: (next) => {
      mix = Number.isFinite(next) ? Math.min(1, Math.max(0, next)) : 0;
      apply();
    },
    getCorrectionMix: () => mix,
    getState: () => ({
      calibrated,
      mix,
      quaternion: [group.quaternion.x, group.quaternion.y, group.quaternion.z, group.quaternion.w],
      position: [group.position.x, group.position.y, group.position.z]
    })
  };
}
