import { describe, expect, it } from 'vitest';
import { SceneSnapshot, type SceneSnapshotInput } from '../src/core/scene/snapshot';
import { SitUpPath } from '../src/core/xr/situp-path';
import { POSTURE_LIMITS, type PostureState } from '../src/core/xr/comfort';
import { stateFromSnapshot } from '../src/app/portal-link';

function neutralInput(): SceneSnapshotInput {
  return {
    sceneId: 'landscape',
    loaded: true,
    session: true,
    calibrating: false,
    calibrated: true,
    audioMuted: false,
    eyeHeight: 1.7,
    confidence: 0.62,
    sitUp: null,
    sitUpT: 0,
    sitUpTarget: 0,
    sitUpMoving: false,
    posture: null,
    viewPitchDeg: 0,
    viewPitchTargetDeg: 0,
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
    pitchDeg: 0,
    rollDeg: 0,
    riseM: 0,
    progress: 0,
    ...overrides
  };
}

describe('scene snapshot', () => {
  it('collects comfort posture when the calibration frame owns the world', () => {
    const snapshot = new SceneSnapshot();
    const input = neutralInput();
    input.posture = posture({ phase: 'rising', pitchDeg: -18, riseM: 0.4, progress: 0.3 });
    snapshot.capture(input);

    expect(snapshot.sceneId).toBe('landscape');
    expect(snapshot.loaded).toBe(true);
    expect(snapshot.sitUpActive).toBe(false);
    expect(snapshot.posturePhase).toBe('rising');
    expect(snapshot.posturePitchDeg).toBe(-18);
    expect(snapshot.postureRiseM).toBe(0.4);
    expect(snapshot.postureProgress).toBe(0.3);
    expect(snapshot.floorOffset).toBe(-1.7);
  });

  it('derives the sit-up posture without building a pose', () => {
    const snapshot = new SceneSnapshot();
    const input = neutralInput();
    const path = new SitUpPath({ standEyeHeight: 1.7 });
    input.sitUp = path;
    input.sitUpT = path.rotationPortion / 2;
    input.sitUpTarget = 1;
    input.sitUpMoving = true;
    // A stale comfort posture must not leak into the sit-up numbers.
    input.posture = posture({ phase: 'standing', pitchDeg: 5, riseM: 0.9, progress: 1 });
    snapshot.capture(input);

    expect(snapshot.sitUpActive).toBe(true);
    expect(snapshot.posturePhase).toBe('rising');
    expect(snapshot.posturePitchDeg).toBeCloseTo(-45, 6);
    expect(snapshot.postureRollDeg).toBe(0);
    expect(snapshot.postureRiseM).toBeCloseTo(path.riseAt(path.rotationPortion / 2), 6);
    expect(snapshot.postureRiseM).toBeLessThanOrEqual(POSTURE_LIMITS.maxRiseM);
    expect(snapshot.postureProgress).toBeCloseTo(path.rotationPortion / 2, 6);

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

  it('emits the state payload with viewPitch, viewAnim and viewPreset', () => {
    const snapshot = new SceneSnapshot();
    const input = neutralInput();
    input.viewPitchDeg = 7.5;
    input.viewPitchTargetDeg = 10;
    input.viewAnim = 'playing';
    input.viewPreset = 'breathe';
    input.floorOffset = -1.6;
    snapshot.capture(input);

    const payload = stateFromSnapshot(snapshot);
    expect(payload.viewPitch).toBe(7.5);
    expect(payload.viewAnim).toBe('playing');
    expect(payload.viewPreset).toBe('breathe');
    expect(payload.eyeHeight).toBe(1.7);
    expect(payload.postureProgress).toBe(0);
    expect(payload.calibrationConfidence).toBe(0.62);
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
        'viewAnim',
        'viewPitch',
        'viewPreset'
      ].sort()
    );
  });
});
