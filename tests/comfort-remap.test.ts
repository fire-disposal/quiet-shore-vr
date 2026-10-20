import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  createComfort,
  POSTURE_LIMITS,
  REMAP_LIMITS,
  REMAP_TRANSITION_MS,
  remapFromPoses,
  type ComfortApi,
  type RemapResult
} from '../src/core/xr/comfort';
import type { PoseLike } from '../src/core/xr/types';

const DEG = Math.PI / 180;
const IDENTITY = new THREE.Quaternion();
const FORWARD = new THREE.Vector3(0, 0, -1);

/**
 * Pose whose gaze axis points along `direction`, captured at `position`.
 * The remap reads the -Z axis of the orientation, so this fixes the
 * measured "ceiling" / "toes" directions exactly.
 */
function poseLooking(direction: THREE.Vector3, position: THREE.Vector3): PoseLike {
  const q = new THREE.Quaternion().setFromUnitVectors(
    FORWARD,
    direction.clone().normalize()
  );
  return {
    transform: {
      position: { x: position.x, y: position.y, z: position.z },
      orientation: { x: q.x, y: q.y, z: q.z, w: q.w }
    }
  };
}

/** Rotate the forward axis by `angleDeg` in the Y/Z plane. */
function tiltedForward(angleDeg: number): THREE.Vector3 {
  const a = angleDeg * DEG;
  return new THREE.Vector3(0, -Math.sin(a), -Math.cos(a));
}

const EYE = new THREE.Vector3(0, 1.6, 0);
const TOES = new THREE.Vector3(0.6, 0.9, -0.8);

/** 60 degrees apart: confidence sin(60) = 0.866, raw basis is 30 deg. */
function sixtyDegreeCapture(): { c: PoseLike; t: PoseLike } {
  return {
    c: poseLooking(FORWARD, EYE),
    t: poseLooking(tiltedForward(60), TOES)
  };
}

/** 90 degrees apart but a raw basis that would invert the world (180 deg). */
function invertingCapture(): { c: PoseLike; t: PoseLike } {
  return {
    c: poseLooking(new THREE.Vector3(0, 1, 0), EYE),
    t: poseLooking(new THREE.Vector3(0, 0, 1), TOES)
  };
}

function makeComfort(remapDurationMs?: number): ComfortApi {
  const scene = new THREE.Scene();
  const world = new THREE.Group();
  scene.add(world);
  return createComfort({ scene, world, remapDurationMs });
}

function singleCalibratedComfort(): ComfortApi {
  const comfort = makeComfort();
  comfort.calibrate(poseLooking(FORWARD, EYE));
  return comfort;
}

function expectOk(result: RemapResult): void {
  expect(result.ok).toBe(true);
  expect(result.reason).toBeUndefined();
  expect(result.quaternion).toBeInstanceOf(THREE.Quaternion);
  expect(result.rawQuaternion).toBeInstanceOf(THREE.Quaternion);
  expect(result.pivot).toBeInstanceOf(THREE.Vector3);
  expect(result.up).toBeInstanceOf(THREE.Vector3);
  expect(result.forward).toBeInstanceOf(THREE.Vector3);
}

describe('two-pose remap safety', () => {
  it('weights the blend by strength * confidence and exposes diagnostics', () => {
    const { c, t } = sixtyDegreeCapture();

    const half = remapFromPoses(c, t, { strength: 0.5 });
    expectOk(half);
    expect(half.angleDeg).toBeCloseTo(60, 6);
    expect(half.confidence).toBeCloseTo(Math.sin(60 * DEG), 9);
    // weight = clamp(strength * confidence, 0, maxWeight).
    expect(half.weight).toBeCloseTo(0.5 * Math.sin(60 * DEG), 9);
    expect(half.appliedWeight).toBeCloseTo(half.weight!, 12);
    expect(half.rawAngleDeg).toBeCloseTo(30, 6);
    // 30 deg raw basis blended at 0.433 of its angle.
    expect(half.quaternion!.angleTo(IDENTITY)).toBeCloseTo(
      half.weight! * 30 * DEG,
      9
    );

    // Diagnostics are the measured frame, not the blended one.
    expect(half.up!.x).toBeCloseTo(0, 9);
    expect(half.up!.y).toBeCloseTo(Math.cos(30 * DEG), 6);
    expect(half.up!.z).toBeCloseTo(0.5, 6);
    expect(half.forward!.y).toBeCloseTo(0.5, 6);
    expect(half.forward!.z).toBeCloseTo(-Math.cos(30 * DEG), 6);
    expect(half.pivot!.x).toBeCloseTo((EYE.x + TOES.x) / 2, 12);
    expect(half.pivot!.y).toBeCloseTo((EYE.y + TOES.y) / 2, 12);
    expect(half.pivot!.z).toBeCloseTo((EYE.z + TOES.z) / 2, 12);
  });

  it('caps the blend at maxWeight and the rotation at maxRotationDeg', () => {
    const { c, t } = sixtyDegreeCapture();
    const full = remapFromPoses(c, t, { strength: 1 });
    expectOk(full);
    // confidence 0.866 exceeds maxWeight 0.85, so the blend is capped.
    expect(full.weight).toBeCloseTo(REMAP_LIMITS.maxWeight, 12);
    expect(full.appliedWeight).toBeCloseTo(REMAP_LIMITS.maxWeight, 12);

    const capture = invertingCapture();
    const flip = remapFromPoses(capture.c, capture.t);
    expectOk(flip);
    expect(flip.angleDeg).toBeCloseTo(90, 6);
    expect(flip.confidence).toBeCloseTo(1, 9);
    expect(flip.rawAngleDeg).toBeCloseTo(180, 6);
    expect(flip.weight).toBeCloseTo(REMAP_LIMITS.maxWeight, 12);
    // The raw basis would invert the world; only 120 deg of it is applied.
    expect(flip.appliedWeight!).toBeLessThan(flip.weight!);
    expect(flip.appliedWeight!).toBeCloseTo(
      REMAP_LIMITS.maxRotationDeg / 180,
      9
    );
    expect(flip.quaternion!.angleTo(IDENTITY)).toBeCloseTo(
      REMAP_LIMITS.maxRotationDeg * DEG,
      9
    );
  });

  it('honours zero strength without rotating at all', () => {
    const { c, t } = sixtyDegreeCapture();
    const none = remapFromPoses(c, t, { strength: 0 });
    expectOk(none);
    expect(none.weight).toBe(0);
    expect(none.appliedWeight).toBe(0);
    expect(none.quaternion!.angleTo(IDENTITY)).toBeLessThan(1e-12);
    expect(none.rawAngleDeg).toBeCloseTo(30, 6);
  });

  it('treats non-finite strength as a full-strength request', () => {
    const { c, t } = sixtyDegreeCapture();
    const fallback = remapFromPoses(c, t, { strength: Number.NaN });
    expectOk(fallback);
    expect(fallback.weight).toBeCloseTo(
      Math.min(Math.sin(60 * DEG), REMAP_LIMITS.maxWeight),
      12
    );
  });

  it('rejects ill-conditioned captures with a reason and keeps the measurements', () => {
    const nearlyParallel = remapFromPoses(
      poseLooking(FORWARD, EYE),
      poseLooking(tiltedForward(5), TOES)
    );
    expect(nearlyParallel.ok).toBe(false);
    expect(nearlyParallel.reason).toBe('poses-too-similar');
    expect(nearlyParallel.quaternion).toBeUndefined();
    expect(nearlyParallel.rawQuaternion).toBeInstanceOf(THREE.Quaternion);

    const nearlyOpposed = remapFromPoses(
      poseLooking(FORWARD, EYE),
      poseLooking(new THREE.Vector3(0, Math.sin(5 * DEG), Math.cos(5 * DEG)), TOES)
    );
    expect(nearlyOpposed.ok).toBe(false);
    expect(nearlyOpposed.reason).toBe('poses-too-similar');

    // 16 deg clears the angle gate but sin(16 deg) is below minConfidence.
    const weak = remapFromPoses(
      poseLooking(FORWARD, EYE),
      poseLooking(tiltedForward(16), TOES)
    );
    expect(weak.ok).toBe(false);
    expect(weak.reason).toBe('low-confidence');
    expect(weak.confidence).toBeCloseTo(Math.sin(16 * DEG), 9);
    expect(weak.confidence!).toBeLessThan(REMAP_LIMITS.minConfidence);

    // Ceiling and toes sampled from the same head position: one bad sample.
    const sameSpot = remapFromPoses(
      poseLooking(FORWARD, EYE),
      poseLooking(tiltedForward(60), EYE.clone())
    );
    expect(sameSpot.ok).toBe(false);
    expect(sameSpot.reason).toBe('degenerate-pivot');

    const parallel = remapFromPoses(
      poseLooking(FORWARD, EYE),
      poseLooking(new THREE.Vector3(0, 0, 1), TOES)
    );
    expect(parallel.ok).toBe(false);
    expect(parallel.reason).toBe('poses-parallel');

    const missing = remapFromPoses({} as PoseLike, poseLooking(FORWARD, TOES));
    expect(missing.ok).toBe(false);
    expect(missing.reason).toBe('missing-pose');

    const broken: PoseLike = {
      transform: {
        position: { x: 0, y: 1.6, z: 0 },
        orientation: { x: Number.NaN, y: 0, z: 0, w: 1 }
      }
    };
    const invalid = remapFromPoses(broken, poseLooking(FORWARD, TOES));
    expect(invalid.ok).toBe(false);
    expect(invalid.reason).toBe('invalid-pose');
  });

  it('never returns NaN or an unnormalised quaternion for a valid capture', () => {
    const { c, t } = invertingCapture();
    const result = remapFromPoses(c, t, { strength: 1 });
    expectOk(result);
    expect(result.quaternion!.length()).toBeCloseTo(1, 12);
    for (const component of result.quaternion!.toArray()) {
      expect(Number.isFinite(component)).toBe(true);
    }
  });
});

describe('two-pose calibration transition', () => {
  it('eases the new frame in through updatePosture instead of snapping', () => {
    const comfort = makeComfort(1000);
    const { c, t } = invertingCapture();
    const result = comfort.calibrateTwo(c, t);
    expectOk(result);

    // Fresh comfort starts at identity and must stay there at progress 0.
    let state = comfort.getState();
    expect(state.calibrated).toBe(true);
    expect(state.mode).toBe('two-pose');
    expect(state.remapProgress).toBe(0);
    expect(state.remap).not.toBeNull();
    expect(state.remap!.weight).toBeCloseTo(result.weight!, 12);
    expect(state.remap!.appliedWeight).toBeCloseTo(result.appliedWeight!, 12);
    expect(comfort.group.quaternion.angleTo(IDENTITY)).toBeLessThan(1e-12);

    const target = result.quaternion!;
    const pivot = result.pivot!;

    comfort.updatePosture(0.5);
    state = comfort.getState();
    expect(state.remapProgress).toBeCloseTo(0.5, 12);
    // smoothstep(0.5) === 0.5, so the live frame is the half-way slerp.
    const halfFrame = new THREE.Quaternion().slerpQuaternions(IDENTITY, target, 0.5);
    expect(comfort.group.quaternion.angleTo(halfFrame)).toBeLessThan(1e-6);
    const halfPivot = pivot.clone().multiplyScalar(0.5);
    const halfPosition = halfPivot
      .clone()
      .sub(halfPivot.clone().applyQuaternion(halfFrame));
    expect(comfort.group.position.x).toBeCloseTo(halfPosition.x, 9);
    expect(comfort.group.position.y).toBeCloseTo(halfPosition.y, 9);
    expect(comfort.group.position.z).toBeCloseTo(halfPosition.z, 9);

    comfort.updatePosture(0.5);
    state = comfort.getState();
    expect(state.remapProgress).toBe(1);
    expect(comfort.group.quaternion.angleTo(target)).toBeLessThan(1e-9);
    const settledPosition = pivot.clone().sub(pivot.clone().applyQuaternion(target));
    expect(comfort.group.position.x).toBeCloseTo(settledPosition.x, 9);
    expect(comfort.group.position.y).toBeCloseTo(settledPosition.y, 9);
    expect(comfort.group.position.z).toBeCloseTo(settledPosition.z, 9);

    const settled = comfort.group.quaternion.clone();
    comfort.updatePosture(1);
    expect(comfort.group.quaternion.angleTo(settled)).toBeLessThan(1e-12);
  });

  it('starts a new remap from the frame currently applied', () => {
    const comfort = makeComfort(1000);
    const first = invertingCapture();
    expectOk(comfort.calibrateTwo(first.c, first.t));
    comfort.updatePosture(0.5);

    const live = comfort.group.quaternion.clone();
    const second = comfort.calibrateTwo(
      poseLooking(FORWARD, EYE),
      poseLooking(tiltedForward(60), TOES)
    );
    expectOk(second);

    expect(comfort.getState().remapProgress).toBe(0);
    expect(comfort.group.quaternion.angleTo(live)).toBeLessThan(1e-6);

    comfort.updatePosture(1);
    expect(comfort.getState().remapProgress).toBe(1);
    expect(comfort.group.quaternion.angleTo(second.quaternion!)).toBeLessThan(1e-9);
  });

  it('clamps the configured remap duration', () => {
    const comfort = makeComfort(1);
    const result = comfort.calibrateTwo(
      poseLooking(FORWARD, EYE),
      poseLooking(tiltedForward(60), TOES)
    );
    expectOk(result);
    comfort.updatePosture(REMAP_TRANSITION_MS.min / 1000);
    expect(comfort.getState().remapProgress).toBe(1);
  });

  it('leaves the current calibration untouched when the capture is rejected', () => {
    const comfort = singleCalibratedComfort();
    const before = comfort.group.quaternion.clone();
    const beforePosition = comfort.group.position.clone();

    const rejected = comfort.calibrateTwo(
      poseLooking(FORWARD, EYE),
      poseLooking(tiltedForward(5), TOES)
    );
    expect(rejected.ok).toBe(false);
    expect(rejected.reason).toBe('poses-too-similar');

    const state = comfort.getState();
    expect(state.mode).toBe('single');
    expect(state.calibrated).toBe(true);
    expect(state.remap).toBeNull();
    expect(state.remapProgress).toBe(1);
    expect(comfort.group.quaternion.angleTo(before)).toBeLessThan(1e-12);
    expect(comfort.group.position.distanceTo(beforePosition)).toBeLessThan(1e-12);
  });
});

describe('posture stop deceleration', () => {
  it('brakes the remaining motion instead of freezing instantly', () => {
    const comfort = singleCalibratedComfort();
    comfort.setPosture({ pitchDeg: 10, riseM: 1 }, 2000);
    comfort.updatePosture(1);
    expect(comfort.getPostureState().riseM).toBeCloseTo(0.5, 10);

    comfort.stopPosture();
    const stopped = comfort.getPostureState();
    expect(stopped.phase).toBe('standing');
    expect(stopped.progress).toBeCloseTo(0.5, 10);
    expect(stopped.pitchDeg).toBeCloseTo(5, 10);
    expect(stopped.riseM).toBeCloseTo(0.5, 10);

    // Velocity at the stop: 30*t^2*(1-t)^2/duration = 0.9375 per second of
    // travel, so 9.375 deg/s and 0.9375 m/s at the midpoint.
    comfort.updatePosture(POSTURE_LIMITS.stopDecelMs / 2000);
    const midway = comfort.getPostureState();
    expect(midway.pitchDeg).toBeGreaterThan(5);
    expect(midway.pitchDeg).toBeLessThanOrEqual(5.875 + 1e-9);
    expect(midway.riseM).toBeGreaterThan(0.5);
    expect(midway.riseM).toBeLessThanOrEqual(0.5875 + 1e-9);
    expect(midway.phase).toBe('standing');

    comfort.updatePosture(1);
    const settled = comfort.getPostureState();
    // Full ramp travel is v0 * stopDecelMs / 3 = 1 deg and 0.1 m.
    expect(settled.pitchDeg).toBeCloseTo(6, 10);
    expect(settled.riseM).toBeCloseTo(0.6, 10);
    expect(settled.phase).toBe('standing');

    comfort.updatePosture(10);
    expect(comfort.getPostureState()).toEqual(settled);
  });

  it('clamps deceleration at the target and accepts a retarget afterwards', () => {
    const comfort = singleCalibratedComfort();
    comfort.setPosture({ riseM: 1 }, 1000);
    comfort.updatePosture(0.99);
    comfort.stopPosture();
    comfort.updatePosture(1);

    const stopped = comfort.getPostureState();
    expect(stopped.riseM).toBeLessThanOrEqual(1);
    expect(stopped.riseM).toBeCloseTo(1, 10);

    comfort.setPosture({ riseM: 0 }, 1000);
    expect(comfort.getPostureState().phase).toBe('lowering');
    comfort.updatePosture(1);
    expect(comfort.getPostureState().riseM).toBeCloseTo(0, 10);
    expect(comfort.getPostureState().phase).toBe('neutral');
  });

  it('is a no-op when nothing is moving', () => {
    const comfort = singleCalibratedComfort();
    const before = comfort.getPostureState();
    comfort.stopPosture();
    expect(comfort.getPostureState()).toEqual(before);
    comfort.updatePosture(1);
    expect(comfort.getPostureState()).toEqual(before);
  });
});
