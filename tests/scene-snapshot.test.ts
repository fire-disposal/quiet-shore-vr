import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { SceneSnapshot, type SceneSnapshotInput } from '../src/core/scene/snapshot';
import { POSTURE_LIMITS, type PostureState } from '../src/core/xr/comfort';
import { worldQuaternion, type WorldRotation } from '../src/core/xr/frame';
import { stateFromSnapshot } from '../src/app/portal-link';

const IDENTITY = new THREE.Quaternion();

function rotationQuaternion(r: WorldRotation): THREE.Quaternion {
  return worldQuaternion(new THREE.Quaternion(), r);
}

function neutralInput(): SceneSnapshotInput {
  return {
    sceneId: 'washroom',
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
    correctionMix: 0,
    correctionTarget: 0,
    correctionMoving: false,
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

    // The mix numbers are deliberately loose: only the transform counts.
    input.correctionMix = 0.3;
    input.correctionTarget = 1;
    input.correctionMoving = true;
    input.baseQuaternion = qPosture.clone().multiply(qCal);
    input.baseReferenceQuaternion = qCal;
    snapshot.capture(input);

    expect(snapshot.sceneId).toBe('washroom');
    expect(snapshot.loaded).toBe(true);
    expect(snapshot.sitUpActive).toBe(true);
    expect(snapshot.posturePhase).toBe('rising');
    expect(snapshot.worldPitchDeg).toBeCloseTo(12, 6);
    expect(snapshot.worldRollDeg).toBeCloseTo(0, 6);
    // The eye keeps its height through the ramp: nothing is lowered.
    expect(snapshot.postureRiseM).toBe(0);
    expect(snapshot.postureProgress).toBeCloseTo(0.3, 6);
    expect(snapshot.floorOffset).toBe(-1.7);
  });

  it('reports the correction mix and the measured world tilt', () => {
    const snapshot = new SceneSnapshot();
    const input = neutralInput();
    input.correctionMix = 0.5;
    input.correctionTarget = 1;
    input.correctionMoving = true;
    input.baseQuaternion = rotationQuaternion({ pitchDeg: 45, rollDeg: 0, yawDeg: 0 });
    input.baseReferenceQuaternion = IDENTITY.clone();
    snapshot.capture(input);

    expect(snapshot.sitUpActive).toBe(true);
    expect(snapshot.posturePhase).toBe('rising');
    expect(snapshot.postureProgress).toBeCloseTo(0.5, 6);
    expect(snapshot.worldPitchDeg).toBeCloseTo(45, 6);
    expect(snapshot.worldRollDeg).toBeCloseTo(0, 6);

    // The same mix with a different transform must report differently: the
    // angles are measured from what was applied, never from the mix.
    input.baseQuaternion = rotationQuaternion({ pitchDeg: 70, rollDeg: 4, yawDeg: 0 });
    snapshot.capture(input);
    expect(snapshot.worldPitchDeg).toBeCloseTo(70, 6);
    expect(snapshot.worldRollDeg).toBeCloseTo(4, 6);

    input.correctionMoving = false;
    input.correctionMix = 1;
    input.correctionTarget = 1;
    snapshot.capture(input);
    expect(snapshot.posturePhase).toBe('corrected');
    expect(snapshot.postureProgress).toBe(1);

    input.correctionMix = 0;
    input.correctionTarget = 0;
    snapshot.capture(input);
    expect(snapshot.posturePhase).toBe('neutral');
    expect(snapshot.sitUpActive).toBe(false);
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
    input.floatMm = 31.5;
    input.swayDeg = 1.2;
    input.sessionSec = 96;
    input.voiceId = 7;
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
    expect(payload.floatMm).toBe(31.5);
    expect(payload.swayDeg).toBe(1.2);
    expect(payload.elapsedSec).toBe(96);
    expect(payload.voiceId).toBe(7);
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
        'elapsedSec',
        'eyeHeight',
        'floatLevel',
        'floatMm',
        'floatProfile',
        'posturePitch',
        'postureProgress',
        'postureRise',
        'postureMode',
        'postureRoll',
        'scene',
        'session',
        'swayDeg',
        'voiceId',
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
