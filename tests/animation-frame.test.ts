import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { SitUpPath } from '../src/core/xr/situp-path';
import { createComfort } from '../src/core/xr/comfort';
import { createWorldShell } from '../src/core/xr/world-shell';
import {
  buoyancyAllowed,
  calibratedFloorOffset,
  contentOffsetFor
} from '../src/core/xr/buoyancy-frame';
import type { PoseLike } from '../src/core/xr/types';


function elevationDeg(local: THREE.Vector3): number {
  return (Math.atan2(local.y, Math.hypot(local.x, -local.z)) * 180) / Math.PI;
}

/**
 * Minimal reproduction of the App's world stack: shell -> base (calibrated
 * frame or sit-up pose) -> content (frame offset + bob).
 */
function stack(options: { base: 'calibrated' | 'posture'; t?: number; offset: number; bob?: number }) {
  const eyeHeight = 1.7;
  const path = new SitUpPath({ standEyeHeight: eyeHeight });
  const cam0 = path.at(0);
  // A supine head lying on a bed: same orientation as the supine camera.
  const headPos = new THREE.Vector3(0, 0.62, -1.4);
  const headQuat = cam0.quaternion.clone();
  const pose: PoseLike = {
    transform: {
      position: { x: headPos.x, y: headPos.y, z: headPos.z },
      orientation: { x: headQuat.x, y: headQuat.y, z: headQuat.z, w: headQuat.w }
    }
  };
  const scene = new THREE.Scene();
  const content = new THREE.Group();
  scene.add(content);
  const comfort = createComfort({ scene, world: content });
  comfort.calibrate(pose);
  const shell = createWorldShell({ scene, base: comfort.group });
  if (options.base === 'posture') {
    shell.setBasePose(path.worldFor(cam0, path.at(options.t ?? 0)));
  }
  content.position.y = options.offset + (options.bob ?? 0);
  shell.update(headPos);
  scene.updateMatrixWorld(true);
  // What the patient sees: a distant horizon point in head-local frame.
  const horizon = new THREE.Vector3(0, 0, -40)
    .applyMatrix4(content.matrixWorld)
    .sub(headPos)
    .applyQuaternion(headQuat.clone().invert());
  return { headPos, headQuat, horizon };
}

describe('buoyancy gate', () => {
  const base = { active: true, capturePending: false } as const;

  it('runs only in the floating mode with the calibrated frame', () => {
    expect(buoyancyAllowed({ ...base, mode: 'float', frame: 'calibrated' })).toBe(true);
    expect(buoyancyAllowed({ ...base, mode: 'float', frame: 'posture' })).toBe(false);
    expect(buoyancyAllowed({ ...base, mode: 'posture', frame: 'calibrated' })).toBe(false);
    expect(buoyancyAllowed({ ...base, mode: 'posture', frame: 'posture' })).toBe(false);
  });

  it('holds still outside a running session or during a capture', () => {
    for (const phase of ['idle', 'calibrating', 'stopping']) {
      expect(
        buoyancyAllowed({
          mode: 'float',
          active: phase === 'floating',
          capturePending: false,
          frame: 'calibrated'
        })
      ).toBe(false);
    }
    expect(
      buoyancyAllowed({ ...base, mode: 'float', frame: 'calibrated', capturePending: true })
    ).toBe(false);
  });
});

describe('frame offset ownership', () => {
  it('adds the bob to the frame offset instead of replacing it', () => {
    expect(contentOffsetFor(-1.7, 0.06, false)).toBeCloseTo(-1.64, 6);
    expect(contentOffsetFor(-1.7, -0.06, false)).toBeCloseTo(-1.76, 6);
    expect(contentOffsetFor(0, 0.065, false)).toBeCloseTo(0.065, 6);
  });

  it('leaves the bob to a scene that splits its own layers', () => {
    expect(contentOffsetFor(-1.7, 0.06, true)).toBeCloseTo(-1.7, 6);
    expect(contentOffsetFor(0, 0.06, true)).toBe(0);
  });

  it('never propagates a non-finite number into the scene', () => {
    expect(contentOffsetFor(Number.NaN, 0.06, false)).toBeCloseTo(0.06, 6);
    expect(contentOffsetFor(0, Number.NaN, false)).toBe(0);
  });

  it('offsets the calibrated frame by the eye height only inside a headset', () => {
    expect(calibratedFloorOffset(1.7, true)).toBeCloseTo(-1.7, 6);
    expect(calibratedFloorOffset(1.7, false)).toBe(0);
    expect(calibratedFloorOffset(Number.NaN, true)).toBe(0);
  });
});

describe('world frames', () => {
  it('the calibrated frame gives a supine patient a standing view', () => {
    const { horizon } = stack({ base: 'calibrated', offset: -1.7 });
    // Horizon within a couple of degrees of eye level: the patient is lying,
    // but sees the world the way a standing person does.
    expect(Math.abs(elevationDeg(horizon))).toBeLessThan(5);
  });

  it('the sit-up frame starts supine and ends standing', () => {
    const supine = stack({ base: 'posture', t: 0, offset: 0 });
    const standing = stack({ base: 'posture', t: 1, offset: 0 });
    expect(elevationDeg(supine.horizon)).toBeLessThan(-80);
    expect(Math.abs(elevationDeg(standing.horizon))).toBeLessThan(5);
  });

  it('a heave lifts the world in the calibrated frame only', () => {
    const rest = stack({ base: 'calibrated', offset: -1.7, bob: 0 });
    const lifted = stack({ base: 'calibrated', offset: -1.7, bob: 0.065 });
    const angle = Math.abs(elevationDeg(lifted.horizon) - elevationDeg(rest.horizon));
    expect(angle).toBeLessThan(0.5);

    // In the supine frame the same offset runs along the gaze: the world comes
    // at the patient instead of rising. That is why the gate exists.
    const supine = stack({ base: 'posture', t: 0, offset: 0 });
    const pushed = stack({ base: 'posture', t: 0, offset: 0, bob: 0.065 });
    expect(Math.abs(pushed.horizon.z - supine.horizon.z)).toBeGreaterThan(0.05);
  });

  it('re-applying the frame offset after a bob is a no-op', () => {
    // Calibration writes the offset once; the first buoyant frame must not add
    // a second eye height on top of it.
    const calibrated = stack({ base: 'calibrated', offset: -1.7, bob: 0 });
    const firstBob = stack({ base: 'calibrated', offset: -1.7, bob: 0.001 });
    expect(Math.abs(elevationDeg(firstBob.horizon) - elevationDeg(calibrated.horizon)))
      .toBeLessThan(0.05);
  });
});
