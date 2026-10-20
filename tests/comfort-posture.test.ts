import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  createComfort,
  POSTURE_EASE_PEAK,
  POSTURE_LIMITS,
  postureEase,
  postureEaseRate,
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

    // Halfway through a 2 s transition: the quintic ease is exactly 0.5.
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
    comfort.updatePosture(0.5); // clamped to 1000 ms, quintic midpoint

    const state = comfort.getPostureState();
    expect(state.pitchDeg).toBeCloseTo(POSTURE_LIMITS.maxPitchDeg / 2, 10);
    expect(state.rollDeg).toBeCloseTo(-POSTURE_LIMITS.maxRollDeg / 2, 10);
    expect(state.riseM).toBeCloseTo(POSTURE_LIMITS.maxRiseM / 2, 10);
  });

  it('allows an explicit near-90 degree rise while the default clamp stays 20', () => {
    const comfort = makeComfort();
    comfort.setPosture({ pitchDeg: -90, riseM: 0.45 }, 2000, 90);
    comfort.updatePosture(2);
    const state = comfort.getPostureState();
    expect(state.pitchDeg).toBeCloseTo(-90, 6);
    expect(state.riseM).toBeCloseTo(0.45, 6);

    comfort.setPosture({ pitchDeg: -90, riseM: 0 }, 2000);
    comfort.updatePosture(2);
    expect(comfort.getPostureState().pitchDeg).toBeCloseTo(-20, 6);
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

  it('decelerates the posture when stopped, then holds it', () => {
    const comfort = makeComfort();
    comfort.setPosture({ pitchDeg: 10, riseM: 1 }, 2000);
    comfort.updatePosture(1);
    comfort.stopPosture();

    // The stop lands immediately, but the remaining velocity is braked out.
    const stopped = comfort.getPostureState();
    expect(stopped.phase).toBe('standing');
    expect(stopped.progress).toBeCloseTo(0.5, 10);
    expect(stopped.pitchDeg).toBeCloseTo(5, 10);
    expect(stopped.riseM).toBeCloseTo(0.5, 10);
    // The pose is no longer on a transition, but the brake still moves it.
    expect(comfort.isPostureMoving()).toBe(true);

    // Stop speed is 30*t^2*(1-t)^2/duration = 0.9375 per second of travel at
    // the midpoint, i.e. 0.9375 m/s and 9.375 deg/s.
    comfort.updatePosture(POSTURE_LIMITS.stopDecelMs / 2000); // half the ramp
    // Brake displacement factor at u = 0.5: u - u^2 + u^3/3 = 7/24 of the ramp.
    const halfTravel = (0.5 - 0.25 + 1 / 24) * (POSTURE_LIMITS.stopDecelMs / 1000);
    const braking = comfort.getPostureState();
    expect(braking.riseM).toBeCloseTo(0.5 + 0.9375 * halfTravel, 10);
    expect(braking.pitchDeg).toBeCloseTo(5 + 9.375 * halfTravel, 10);
    expect(braking.phase).toBe('standing');

    comfort.updatePosture(1);
    const settled = comfort.getPostureState();
    // Full ramp travel is v0 * stopDecelMs / 3: 0.1 m and 1 deg.
    expect(settled.riseM).toBeCloseTo(0.6, 10);
    expect(settled.pitchDeg).toBeCloseTo(6, 10);
    expect(settled.progress).toBeCloseTo(0.5, 10);
    // The head-locked cue reads progress, so it must not jump to 1 while the
    // world is still creeping to rest.
    expect(comfort.getPostureProgress()).toBeCloseTo(0.5, 10);
    expect(comfort.isPostureMoving()).toBe(false);

    comfort.updatePosture(10);
    expect(comfort.getPostureState()).toEqual(settled);
    expect(comfort.getPostureProgress()).toBeCloseTo(0.5, 10);
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

describe('posture easing curve', () => {
  it('is a quintic smootherstep with a matching derivative', () => {
    expect(postureEase(0)).toBe(0);
    expect(postureEase(1)).toBe(1);
    expect(postureEase(0.5)).toBe(0.5);
    // 6t^5 - 15t^4 + 10t^3 at t = 0.25 and t = 0.75.
    expect(postureEase(0.25)).toBeCloseTo(0.103515625, 12);
    expect(postureEase(0.75)).toBeCloseTo(0.896484375, 12);

    // Derivative 30 t^2 (1 - t)^2 agrees with central differences.
    const h = 1e-4;
    for (let i = 1; i < 100; i++) {
      const t = i / 100;
      const slope = (postureEase(t + h) - postureEase(t - h)) / (2 * h);
      expect(slope).toBeCloseTo(postureEaseRate(t), 5);
    }
    expect(postureEaseRate(0)).toBe(0);
    expect(postureEaseRate(1)).toBe(0);
    expect(postureEaseRate(0.5)).toBeCloseTo(1.875, 12);
    // The exported peak is exactly the curve's midpoint speed, so preset
    // durations can be checked against the documented rate envelope.
    expect(POSTURE_EASE_PEAK).toBe(postureEaseRate(0.5));
    expect(POSTURE_EASE_PEAK).toBeCloseTo(1.875, 12);
    // Velocity is continuous at both ends: a transition starts and finishes
    // at rest, so neither the start nor a stop at the end can jerk.
    expect(postureEaseRate(1e-6)).toBeLessThan(1e-10);
    expect(postureEaseRate(1 - 1e-6)).toBeLessThan(1e-10);
  });

  it('starts and ends gentler than smoothstep without reversing', () => {
    // Smoothstep is 3t^2 - 2t^3: 0.028 at t = 0.1, 0.15625 at t = 0.25.
    expect(postureEase(0.1)).toBeCloseTo(0.00856, 12);
    expect(postureEase(0.1)).toBeLessThan(0.028);
    expect(postureEase(0.25)).toBeLessThan(0.15625);

    let previous = 0;
    for (let i = 1; i <= 1000; i++) {
      const value = postureEase(i / 1000);
      expect(value).toBeGreaterThan(previous);
      previous = value;
    }

    // Symmetric about the midpoint: ease(1 - t) === 1 - ease(t).
    for (let i = 0; i <= 100; i++) {
      const t = i / 100;
      expect(postureEase(1 - t)).toBeCloseTo(1 - postureEase(t), 12);
    }
  });

  it('clamps normalised time outside 0..1', () => {
    expect(postureEase(-1)).toBe(0);
    expect(postureEase(2)).toBe(1);
    expect(postureEase(Number.NaN)).toBe(0);
    expect(postureEaseRate(-1)).toBe(0);
    expect(postureEaseRate(2)).toBe(0);
    expect(postureEaseRate(Number.NaN)).toBe(0);
  });
});

describe('posture stop continuity', () => {
  it('keeps the speed continuous when a transition is stopped', () => {
    const running = makeComfort();
    const stopped = makeComfort();
    running.setPosture({ riseM: 1 }, 2000);
    stopped.setPosture({ riseM: 1 }, 2000);
    running.updatePosture(0.6); // t = 0.3
    stopped.updatePosture(0.6);
    stopped.stopPosture();

    // One frame later the braked pose has advanced almost exactly as far as
    // the untouched transition: the stop is a speed change, not a jump.
    running.updatePosture(0.001);
    stopped.updatePosture(0.001);
    expect(stopped.getPostureState().riseM).toBeCloseTo(
      running.getPostureState().riseM,
      4
    );
  });

  it('never brakes past the target', () => {
    const comfort = makeComfort();
    comfort.setPosture({ riseM: 1 }, 1000);
    comfort.updatePosture(0.99);
    comfort.stopPosture();

    let previous = comfort.getPostureState().riseM;
    expect(previous).toBeLessThan(1);
    for (let i = 0; i < 40; i++) {
      comfort.updatePosture(0.01);
      const current = comfort.getPostureState().riseM;
      expect(current).toBeGreaterThanOrEqual(previous - 1e-12);
      expect(current).toBeLessThanOrEqual(1);
      previous = current;
    }
    // The brake wanted 0.0003 m more but only 0.00001 m remained.
    expect(previous).toBe(1);
    expect(comfort.getPostureState().phase).toBe('standing');
  });

  it('reports motion until the stop brake has run out', () => {
    const comfort = makeComfort();
    expect(comfort.isPostureMoving()).toBe(false);

    comfort.setPosture({ riseM: 0.6 }, 2000);
    expect(comfort.isPostureMoving()).toBe(true);
    comfort.updatePosture(1);
    expect(comfort.getPostureProgress()).toBeCloseTo(0.5, 12);
    comfort.stopPosture();
    // A stopped transition still moves the world while the brake runs out.
    expect(comfort.isPostureMoving()).toBe(true);
    expect(comfort.getPostureProgress()).toBeCloseTo(0.5, 12);

    comfort.updatePosture(POSTURE_LIMITS.stopDecelMs / 2000);
    expect(comfort.isPostureMoving()).toBe(true);
    comfort.updatePosture(1);
    expect(comfort.isPostureMoving()).toBe(false);
    expect(comfort.getPostureProgress()).toBeCloseTo(0.5, 12);

    // A retarget resumes motion from the braked pose.
    comfort.setPosture({ riseM: 0.2 }, 1000);
    expect(comfort.isPostureMoving()).toBe(true);
    comfort.updatePosture(1);
    expect(comfort.isPostureMoving()).toBe(false);
  });

  it('treats a stop one hair before the end as already at rest', () => {
    const comfort = makeComfort();
    comfort.setPosture({ riseM: 1 }, 2000);
    comfort.updatePosture(1.999); // t = 0.9995
    comfort.stopPosture();
    expect(comfort.isPostureMoving()).toBe(false);
    expect(comfort.getPostureState().riseM).toBeLessThan(1);
    comfort.updatePosture(1);
    expect(comfort.getPostureState().riseM).toBeLessThan(1);
  });

  it('retargets from the braked pose without jumping or overshooting', () => {
    const comfort = makeComfort();
    comfort.setPosture({ riseM: 1 }, 2000);
    comfort.updatePosture(1);
    comfort.stopPosture();
    comfort.updatePosture(POSTURE_LIMITS.stopDecelMs / 2000);
    const braked = comfort.getPostureState().riseM;
    expect(braked).toBeGreaterThan(0.5);
    expect(braked).toBeLessThan(1);

    comfort.setPosture({ riseM: 0.2 }, 1000);
    let state = comfort.getPostureState();
    expect(state.riseM).toBeCloseTo(braked, 12);
    expect(state.phase).toBe('lowering');
    expect(state.progress).toBe(0);

    for (let i = 0; i < 20; i++) {
      comfort.updatePosture(0.05);
      state = comfort.getPostureState();
      expect(state.riseM).toBeLessThanOrEqual(braked + 1e-12);
      expect(state.riseM).toBeGreaterThanOrEqual(0.2 - 1e-12);
    }
    expect(state.riseM).toBeCloseTo(0.2, 10);
    expect(state.phase).toBe('standing');
  });

  it('clamps the duration to the documented envelope', () => {
    const short = makeComfort();
    short.setPosture({ riseM: 1 }, 1);
    short.updatePosture(POSTURE_LIMITS.minDurationMs / 2000);
    expect(short.getPostureState().progress).toBeCloseTo(0.5, 12);
    short.updatePosture(POSTURE_LIMITS.minDurationMs / 2000);
    expect(short.getPostureState().progress).toBe(1);
    expect(short.getPostureState().riseM).toBeCloseTo(1, 12);

    const long = makeComfort();
    long.setPosture({ riseM: 1 }, 10 * POSTURE_LIMITS.maxDurationMs);
    long.updatePosture(POSTURE_LIMITS.maxDurationMs / 2000);
    expect(long.getPostureState().progress).toBeCloseTo(0.5, 12);
    long.updatePosture(POSTURE_LIMITS.maxDurationMs / 1000);
    expect(long.getPostureState().progress).toBe(1);
    expect(long.getPostureState().riseM).toBeCloseTo(1, 12);
    expect(long.getPostureState().phase).toBe('standing');
  });
});
