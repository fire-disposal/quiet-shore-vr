import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { SceneSnapshot, type SceneSnapshotInput } from '../src/core/scene/snapshot';
import { SitUpPath } from '../src/core/xr/situp-path';
import { POSTURE_LIMITS, type PostureState } from '../src/core/xr/comfort';
import { worldQuaternion, type WorldRotation } from '../src/core/xr/frame';
import { stateFromSnapshot } from '../src/app/portal-link';

const IDENTITY = new THREE.Quaternion();

function rotationQuaternion(r: WorldRotation): THREE.Quaternion {
  return worldQuaternion(new THREE.Quaternion(), r);
}

function neutralInput(): SceneSnapshotInput {
  return {
    sceneId: 'landscape',
    loaded: true,
    session: true,
    calibrating: false,
    calibrated: true,
    audioMuted: false,
    eyeHeight: 1.7,
    worldYawDeg: -12,
    worldPitchDeg: 8,
    worldRollDeg: -3,
    confidence: 0.62,
    sitUp: null,
    sitUpT: 0,
    sitUpTarget: 0,
    sitUpMoving: false,
    posture: null,
    baseQuaternion: IDENTITY.clone(),
    baseReferenceQuaternion: IDENTITY.clone(),
    lookYawDeg: 0,
    lookYawTargetDeg: 0,
    upGazeDeg: 0,
    upGazeTargetDeg: 0,
    viewAnim: 'idle',
    viewPreset: 'none',
    floorOffset: -1.7,
    cueFlow: 0,
    cueEnabled: true,
    cueIntensity: 1
  };
}

function posture(overrides: Partial<PostureState> = {}): PostureState {
  return {
    phase: 'neutral',
    worldPitchDeg: 0,
    worldRollDeg: 0,
    riseM: 0,
    progress: 0,
    ...overrides
  };
}

describe('scene snapshot', () => {
  it('measures the applied base against the calibration frame', () => {
    const snapshot = new SceneSnapshot();
    const input = neutralInput();
    const qCal = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.5, -0.8, 0.2, 'YXZ'));
    const qPosture = rotationQuaternion({ pitchDeg: 12, rollDeg: 0, yawDeg: 0 });

    // The posture numbers are deliberately wrong: only the transform counts.
    input.posture = posture({
      phase: 'rising',
      worldPitchDeg: 999,
      worldRollDeg: -999,
      riseM: 0.4,
      progress: 0.3
    });
    input.baseQuaternion = qPosture.clone().multiply(qCal);
    input.baseReferenceQuaternion = qCal;
    snapshot.capture(input);

    expect(snapshot.sceneId).toBe('landscape');
    expect(snapshot.loaded).toBe(true);
    expect(snapshot.sitUpActive).toBe(false);
    expect(snapshot.posturePhase).toBe('rising');
    expect(snapshot.worldPitchDeg).toBeCloseTo(12, 6);
    expect(snapshot.worldRollDeg).toBeCloseTo(0, 6);
    expect(snapshot.postureRiseM).toBe(0.4);
    expect(snapshot.postureProgress).toBe(0.3);
    expect(snapshot.floorOffset).toBe(-1.7);
  });

  it('follows the sit-up base quaternion without re-deriving an angle', () => {
    const snapshot = new SceneSnapshot();
    const input = neutralInput();
    const path = new SitUpPath({ standEyeHeight: 1.7 });
    input.sitUp = path;
    input.sitUpT = path.rotationPortion / 2;
    input.sitUpTarget = 1;
    input.sitUpMoving = true;
    // A stale comfort posture must not leak into the sit-up numbers.
    input.posture = posture({ phase: 'standing', worldPitchDeg: 5, riseM: 0.9, progress: 1 });
    input.baseQuaternion = rotationQuaternion({ pitchDeg: 45, rollDeg: 0, yawDeg: 0 });
    input.baseReferenceQuaternion = IDENTITY.clone();
    snapshot.capture(input);

    expect(snapshot.sitUpActive).toBe(true);
    expect(snapshot.posturePhase).toBe('rising');
    expect(snapshot.worldPitchDeg).toBeCloseTo(45, 6);
    expect(snapshot.worldRollDeg).toBeCloseTo(0, 6);
    expect(snapshot.postureRiseM).toBeCloseTo(path.riseAt(path.rotationPortion / 2), 6);
    expect(snapshot.postureRiseM).toBeLessThanOrEqual(POSTURE_LIMITS.maxRiseM);
    expect(snapshot.postureProgress).toBeCloseTo(path.rotationPortion / 2, 6);

    // The same progress with a different transform must report differently.
    input.baseQuaternion = rotationQuaternion({ pitchDeg: 70, rollDeg: 4, yawDeg: 0 });
    snapshot.capture(input);
    expect(snapshot.worldPitchDeg).toBeCloseTo(70, 6);
    expect(snapshot.worldRollDeg).toBeCloseTo(4, 6);

    input.sitUpMoving = false;
    input.sitUpT = 1;
    snapshot.capture(input);
    expect(snapshot.posturePhase).toBe('standing');

    input.sitUpT = 0;
    snapshot.capture(input);
    expect(snapshot.posturePhase).toBe('neutral');
  });

  it('stays allocation-free: capture returns the same instance', () => {
    const snapshot = new SceneSnapshot();
    const input = neutralInput();
    expect(snapshot.capture(input)).toBe(snapshot);
    expect(snapshot.capture(input)).toBe(snapshot);
  });

  it('emits the frozen wire keys from the measured values', () => {
    const snapshot = new SceneSnapshot();
    const input = neutralInput();
    input.upGazeDeg = 7.5;
    input.upGazeTargetDeg = 10;
    input.lookYawDeg = -42;
    input.lookYawTargetDeg = -45;
    input.viewAnim = 'playing';
    input.viewPreset = 'breathe';
    input.floorOffset = -1.6;
    input.baseQuaternion = rotationQuaternion({ pitchDeg: 33, rollDeg: -4, yawDeg: 0 });
    input.confidence = 0.62;
    snapshot.capture(input);

    const payload = stateFromSnapshot(snapshot);
    expect(payload.viewPitch).toBe(7.5);
    expect(payload.viewYaw).toBe(-42);
    // The wire carries the measurement, not a clamp: 33° is a real reading.
    expect(payload.posturePitch).toBe(33);
    expect(payload.postureRoll).toBeCloseTo(-4, 6);
    expect(payload.worldYaw).toBe(-12);
    expect(payload.worldPitch).toBe(8);
    expect(payload.worldRoll).toBe(-3);
    expect(payload.viewAnim).toBe('playing');
    expect(payload.viewPreset).toBe('breathe');
    expect(payload.eyeHeight).toBe(1.7);
    expect(payload.postureProgress).toBe(0);
    expect(payload.calibrationConfidence).toBe(0.62);
    expect(payload.sitUpActive).toBe(false);
    expect('viewX' in payload).toBe(false);
    expect('viewZ' in payload).toBe(false);
    expect(Object.keys(payload).sort()).toEqual(
      [
        'audio',
        'calibrationConfidence',
        'calibrating',
        'cueEnabled',
        'cueIntensity',
        'eyeHeight',
        'posturePitch',
        'postureProgress',
        'postureRise',
        'postureRoll',
        'scene',
        'session',
        'sitUpActive',
        'viewAnim',
        'viewPitch',
        'viewPreset',
        'viewYaw',
        'worldYaw',
        'worldPitch',
        'worldRoll'
      ].sort()
    );
  });
});
