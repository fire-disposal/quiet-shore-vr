import { describe, expect, it } from 'vitest';
import { SceneSnapshot, type SceneSnapshotInput } from '../src/core/scene/snapshot';
import { stateFromSnapshot } from '../src/app/portal-link';
import { degrees, metres } from '../src/core/units';

function neutralInput(): SceneSnapshotInput {
  return {
    sceneId: 'washroom',
    app: 'training',
    loaded: true,
    session: true,
    calibrating: false,
    calibrated: true,
    audioMuted: false,
    eyeHeight: metres(0.66),
    worldQuat: { x: 0, y: 0.183, z: 0, w: 0.983 },
    worldT: { x: metres(0.1), y: metres(-0.2), z: metres(0.3) },
    confidence: 0.62,
    correctionMix: 0,
    correctionTarget: 0,
    correctionMoving: false,
    lookYawDeg: degrees(0),
    lookYawTargetDeg: degrees(0),
    upGazeDeg: degrees(0),
    upGazeTargetDeg: degrees(0),
    viewAnim: 'idle',
    floorOffset: metres(-0.66),
    floatLevel: 1,
    floatMm: 0,
    sessionSec: 0,
    voiceId: -1,
    caps: {
      rise: true,
      lie: false,
      stop: false,
      float: true,
      view: true,
      blocked: ''
    }
  };
}

describe('scene snapshot', () => {
  it('carries the posture scalar, not an angle measured from a transform', () => {
    const snapshot = new SceneSnapshot();
    snapshot.capture({
      ...neutralInput(),
      correctionMix: 0.3,
      correctionTarget: 1,
      correctionMoving: true,
      eyeHeight: metres(0.98)
    });

    expect(snapshot.sceneId).toBe('washroom');
    expect(snapshot.session).toBe(true);
    expect(snapshot.correctionMoving).toBe(true);
    expect(snapshot.mix).toBeCloseTo(0.3, 6);
    expect(snapshot.correctionTarget).toBeCloseTo(1, 6);
    // The eye is the height the page actually applied.
    expect(snapshot.eyeHeight).toBeCloseTo(0.98, 6);
    // The world transform is the applied one, verbatim.
    expect(snapshot.worldQuat.x).toBeCloseTo(0, 6);
    expect(snapshot.worldQuat.y).toBeCloseTo(0.183, 6);
    expect(snapshot.worldT.y).toBeCloseTo(-0.2, 6);
  });

  it('clamps a bad mix instead of reporting it', () => {
    const snapshot = new SceneSnapshot();
    snapshot.capture({ ...neutralInput(), correctionMix: 7 });
    expect(snapshot.mix).toBe(1);

    snapshot.capture({ ...neutralInput(), correctionMix: Number.NaN });
    expect(snapshot.mix).toBe(0);
  });

  it('stays allocation-free: capture returns the same instance', () => {
    const snapshot = new SceneSnapshot();
    const input = neutralInput();
    expect(snapshot.capture(input)).toBe(snapshot);
    expect(snapshot.capture(input)).toBe(snapshot);
  });

  it('emits exactly the v14 wire keys', () => {
    const snapshot = new SceneSnapshot();
    snapshot.capture({
      ...neutralInput(),
      correctionMix: 0.6,
      eyeHeight: metres(1.28),
      upGazeDeg: degrees(7.5),
      lookYawDeg: degrees(-42),
      viewAnim: 'playing',
      floatLevel: 3,
      floatMm: 31.5,
      confidence: 0.62,
      sessionSec: 96,
      voiceId: 7
    });

    const payload = stateFromSnapshot(snapshot);
    expect(payload.mix).toBeCloseTo(0.6, 6);
    expect(payload.eyeHeight).toBeCloseTo(1.28, 6);
    expect(payload.viewPitch).toBe(7.5);
    expect(payload.viewYaw).toBe(-42);
    expect(payload.viewAnim).toBe('playing');
    expect(payload.moving).toBe(true);
    expect(payload.worldQ).toEqual({ x: 0, y: 0.183, z: 0 });
    expect(payload.worldT).toEqual({ x: 0.1, y: -0.2, z: 0.3 });
    expect(payload.caps.rise).toBe(true);
    expect(payload.caps.lie).toBe(false);
    expect(payload.elapsedSec).toBe(96);
    expect(payload.voiceId).toBe(7);
    expect(payload.app).toBe('training');

    expect(Object.keys(payload).sort()).toEqual(
      [
        'app',
        'calibrationConfidence',
        'calibrating',
        'audio',
        'caps',
        'elapsedSec',
        'eyeHeight',
        'floatLevel',
        'floatMm',
        'mix',
        'moving',
        'scene',
        'session',
        'viewAnim',
        'viewPitch',
        'viewYaw',
        'voiceId',
        'worldQ',
        'worldT'
      ].sort()
    );
  });
});
