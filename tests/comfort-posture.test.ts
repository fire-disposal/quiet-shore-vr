import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  createComfort,
  POSTURE_LIMITS,
  type ComfortApi,
  type PostureState
} from '../src/core/xr/comfort';
import type { PoseLike } from '../src/core/xr/types';

const DEG = Math.PI / 180;

const NEUTRAL: PostureState = {
  phase: 'neutral',
  pitchDeg: 0,
  rollDeg: 0,
  riseM: 0,
  progress: 0
};

function poseAt(position: THREE.Vector3, quaternion: THREE.Quaternion): PoseLike {
  return {
    transform: {
      position: { x: position.x, y: position.y, z: position.z },
      orientation: { x: quaternion.x, y: quaternion.y, z: quaternion.z, w: quaternion.w }
    }
  };
}

function makeComfort(
  position = new THREE.Vector3(0, 1.6, 0),
  quaternion = new THREE.Quaternion()
): ComfortApi {
  const scene = new THREE.Scene();
  const world = new THREE.Group();
  scene.add(world);
  const comfort = createComfort({ scene, world });
  comfort.calibrate(poseAt(position, quaternion));
  return comfort;
}

function expectQuatClose(actual: THREE.Quaternion, expected: THREE.Quaternion): void {
  expect(actual.angleTo(expected)).toBeLessThan(1e-6);
}

function expectVecClose(actual: THREE.Vector3, expected: THREE.Vector3): void {
  expect(actual.x).toBeCloseTo(expected.x, 6);
  expect(actual.y).toBeCloseTo(expected.y, 6);
  expect(actual.z).toBeCloseTo(expected.z, 6);
}

function expectedTransform(
  qCal: THREE.Quaternion,
  pivot: THREE.Vector3,
  posture: Pick<PostureState, 'pitchDeg' | 'rollDeg' | 'riseM'>
): { quaternion: THREE.Quaternion; position: THREE.Vector3 } {
  const qPosture = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(posture.pitchDeg * DEG, 0, posture.rollDeg * DEG, 'XYZ')
  );
  // q_total = q_posture * q_calibration.
  const quaternion = qPosture.clone().multiply(qCal);
  const position = pivot.clone().sub(pivot.clone().applyQuaternion(quaternion));
  position.y -= posture.riseM;
  return { quaternion, position };
}

describe('comfort posture layer', () => {
  it('starts neutral and refuses to move before calibration', () => {
    const scene = new THREE.Scene();
    const world = new THREE.Group();
    scene.add(world);
    const comfort = createComfort({ scene, world });

    expect(comfort.isCalibrated()).toBe(false);
    expect(comfort.getPostureState()).toEqual(NEUTRAL);
    expect(comfort.getState().posture).toEqual(NEUTRAL);

    comfort.setPosture({ pitchDeg: 10, riseM: 0.5 }, 5000);
    comfort.updatePosture(1);
    expect(comfort.getPostureState()).toEqual(NEUTRAL);
    expect(comfort.group.quaternion.equals(new THREE.Quaternion())).toBe(true);
    expectVecClose(comfort.group.position, new THREE.Vector3());
  });

  it('keeps the single-pose calibration transform unchanged', () => {
    const qCal = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.15, 0.4, 0, 'YXZ'));
    const pivot = new THREE.Vector3(0.6, 1.55, -1.2);
    const comfort = makeComfort(pivot, qCal);

    expect(comfort.isCalibrated()).toBe(true);
    expect(comfort.getState().mode).toBe('single');
    expect(comfort.getState().posture).toEqual(NEUTRAL);
    expectQuatClose(comfort.group.quaternion, qCal);
    expectVecClose(
      comfort.group.position,
      pivot.clone().sub(pivot.clone().applyQuaternion(qCal))
    );
  });

  it('eases from neutral to standing and reports progress', () => {
    const pivot = new THREE.Vector3(0, 1.6, 0);
    const comfort = makeComfort(pivot, new THREE.Quaternion());

    comfort.setPosture({ pitchDeg: 12, riseM: 0.4 }, 2000);
    let state = comfort.getPostureState();
    expect(state.phase).toBe('rising');
    expect(state.progress).toBe(0);
    expect(state.pitchDeg).toBe(0);
    expect(state.riseM).toBe(0);

    // Halfway through a 2 s transition: smoothstep(0.5) === 0.5.
    comfort.updatePosture(1);
    state = comfort.getPostureState();
    expect(state.phase).toBe('rising');
    expect(state.progress).toBeCloseTo(0.5, 10);
    expect(state.pitchDeg).toBeCloseTo(6, 10);
    expect(state.riseM).toBeCloseTo(0.2, 10);

    comfort.updatePosture(1);
    state = comfort.getPostureState();
    expect(state.phase).toBe('standing');
    expect(state.progress).toBe(1);
    expect(state.pitchDeg).toBeCloseTo(12, 10);
    expect(state.riseM).toBeCloseTo(0.4, 10);

    const expected = expectedTransform(new THREE.Quaternion(), pivot, state);
    expectQuatClose(comfort.group.quaternion, expected.quaternion);
    expectVecClose(comfort.group.position, expected.position);
  });

  it('lowers the world by riseM while leaving x/z alone', () => {
    const comfort = makeComfort();
    const before = comfort.group.position.clone();

    comfort.setPosture({ pitchDeg: 0, riseM: 0.3 }, 1000);
    comfort.updatePosture(1);

    expect(comfort.group.position.x).toBeCloseTo(before.x, 10);
    expect(comfort.group.position.z).toBeCloseTo(before.z, 10);
    expect(comfort.group.position.y).toBeCloseTo(before.y - 0.3, 10);
    expect(comfort.getPostureState().phase).toBe('standing');
  });

  it('clamps posture ranges and the minimum duration', () => {
    const comfort = makeComfort();
    comfort.setPosture({ pitchDeg: 90, rollDeg: -80, riseM: 9 }, 10);
    comfort.updatePosture(0.5); // clamped to 1000 ms, ease-in-out midpoint

    const state = comfort.getPostureState();
    expect(state.pitchDeg).toBeCloseTo(POSTURE_LIMITS.maxPitchDeg / 2, 10);
    expect(state.rollDeg).toBeCloseTo(-POSTURE_LIMITS.maxRollDeg / 2, 10);
    expect(state.riseM).toBeCloseTo(POSTURE_LIMITS.maxRiseM / 2, 10);
  });

  it('clamps long durations and defaults non-finite ones', () => {
    const long = makeComfort();
    long.setPosture({ pitchDeg: 0, riseM: 1 }, 1_000_000);
    long.updatePosture(1);
    expect(long.getPostureState().progress).toBeCloseTo(
      1000 / POSTURE_LIMITS.maxDurationMs,
      10
    );

    const fallback = makeComfort();
    fallback.setPosture({ pitchDeg: 0, riseM: 1 }, Number.NaN);
    fallback.updatePosture(5);
    expect(fallback.getPostureState().progress).toBeCloseTo(0.5, 10);
    expect(fallback.getPostureState().riseM).toBeCloseTo(0.5, 10);
  });

  it('restarts from current values when retargeted mid-transition', () => {
    const comfort = makeComfort();
    comfort.setPosture({ pitchDeg: 0, riseM: 1 }, 2000);
    comfort.updatePosture(1);
    expect(comfort.getPostureState().riseM).toBeCloseTo(0.5, 10);

    comfort.setPosture({ pitchDeg: 0, riseM: 0 }, 2000);
    let state = comfort.getPostureState();
    expect(state.phase).toBe('lowering');
    expect(state.progress).toBe(0);
    expect(state.riseM).toBeCloseTo(0.5, 10);

    comfort.updatePosture(1);
    state = comfort.getPostureState();
    expect(state.phase).toBe('lowering');
    expect(state.progress).toBeCloseTo(0.5, 10);
    expect(state.riseM).toBeCloseTo(0.25, 10);
  });

  it('freezes the posture when stopped', () => {
    const comfort = makeComfort();
    comfort.setPosture({ pitchDeg: 10, riseM: 1 }, 2000);
    comfort.updatePosture(1);
    comfort.stopPosture();

    const frozen = comfort.getPostureState();
    expect(frozen.phase).toBe('standing');
    expect(frozen.progress).toBeCloseTo(0.5, 10);
    expect(frozen.riseM).toBeCloseTo(0.5, 10);

    comfort.updatePosture(10);
    expect(comfort.getPostureState()).toEqual(frozen);
  });

  it('composes q_posture * q_calibration around the calibration pivot', () => {
    const qCal = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.25, 0.5, -0.1, 'YXZ'));
    const pivot = new THREE.Vector3(0.6, 1.55, -1.2);
    const comfort = makeComfort(pivot, qCal);

    comfort.setPosture({ pitchDeg: 14, rollDeg: 6, riseM: 0.55 }, 1000);
    comfort.updatePosture(1);
    const state = comfort.getPostureState();
    expect(state.phase).toBe('standing');

    const expected = expectedTransform(qCal, pivot, state);
    expectQuatClose(comfort.group.quaternion, expected.quaternion);
    expectVecClose(comfort.group.position, expected.position);

    const qPosture = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(state.pitchDeg * DEG, 0, state.rollDeg * DEG, 'XYZ')
    );
    expect(
      comfort.group.quaternion.angleTo(qPosture.clone().multiply(qCal))
    ).toBeLessThan(1e-6);
    expect(
      comfort.group.quaternion.angleTo(qCal.clone().multiply(qPosture))
    ).toBeGreaterThan(0.01);
  });

  it('clears calibration and posture on reset', () => {
    const comfort = makeComfort();
    comfort.setPosture({ pitchDeg: 12, riseM: 0.4 }, 1000);
    comfort.updatePosture(1);
    expect(comfort.isCalibrated()).toBe(true);

    comfort.reset();
    expect(comfort.isCalibrated()).toBe(false);
    expect(comfort.getPostureState()).toEqual(NEUTRAL);
    expect(comfort.getState().posture).toEqual(NEUTRAL);
    expect(comfort.group.quaternion.equals(new THREE.Quaternion())).toBe(true);
    expectVecClose(comfort.group.position, new THREE.Vector3());

    comfort.updatePosture(1);
    expect(comfort.getPostureState().riseM).toBe(0);
    comfort.setPosture({ pitchDeg: 5, riseM: 0.2 }, 1000);
    expect(comfort.getPostureState()).toEqual(NEUTRAL);
  });
});
