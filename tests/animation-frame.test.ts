import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { SitUpPath } from '../src/core/xr/situp-path';
import { createComfort } from '../src/core/xr/comfort';
import { createWorldShell } from '../src/core/xr/world-shell';
import { buoyancyAllowed, contentOffsetFor } from '../src/core/xr/buoyancy-frame';
import { planFrame, visualUpInContent } from '../src/core/xr/world-frame';
import { viewToWorld } from '../src/core/xr/view-motion';
import type { PoseLike } from '../src/core/xr/types';

/** What the patient sees: a distant point in head-local frame. */
function stack(options: {
  mode: 'float' | 'posture';
  eyeY?: number;
  t?: number;
  bob?: number;
  /** Operator up-gaze, in degrees: the shell rotation on top of the base. */
  upGazeDeg?: number;
  yawDeg?: number;
}) {
  const standEyeHeight = 1.7;
  const path = new SitUpPath({ standEyeHeight });
  const eyeY = options.eyeY ?? 1.7;
  const plan = planFrame({
    mode: options.mode,
    eyeY,
    standEyeHeight,
    lyingEyeHeight: path.hipHeight
  });
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
  if (plan.base === 'situp') {
    shell.setBasePose(path.worldFor(cam0, path.at(options.t ?? 0)));
  }
  // The operator's view channel sits on top of the base, so the heave axis has
  // to compose both: undoing only the base would tilt the heave by the view.
  if (options.upGazeDeg || options.yawDeg) {
    shell.setWorldRotation(viewToWorld(options.yawDeg ?? 0, options.upGazeDeg ?? 0));
  }
  const parent = shell.group.quaternion.clone().multiply(shell.base.quaternion);
  const axis = visualUpInContent(headQuat, parent, new THREE.Vector3());
  const bob = options.bob ?? 0;
  content.position.set(axis.x * bob, plan.offsetY + axis.y * bob, axis.z * bob);
  shell.update(headPos);
  scene.updateMatrixWorld(true);
  const horizon = new THREE.Vector3(0, 0, -40)
    .applyMatrix4(content.matrixWorld)
    .sub(headPos)
    .applyQuaternion(headQuat.clone().invert());
  return { headPos, headQuat, horizon, axis, plan };
}

function elevationDeg(local: THREE.Vector3): number {
  return (Math.atan2(local.y, Math.hypot(local.x, -local.z)) * 180) / Math.PI;
}

describe('frame planner', () => {
  const base = { eyeY: 1.7, standEyeHeight: 1.7, lyingEyeHeight: 0.45 };

  it('gives the floating mode the calibrated frame and puts the eye at its Y', () => {
    expect(planFrame({ ...base, mode: 'float' })).toEqual({ base: 'calibrated', offsetY: -1.7 });
    // The shore's eye sits 0.45 m above its water, so the art drops by 0.45.
    expect(planFrame({ ...base, mode: 'float', eyeY: 0.45 })).toEqual({
      base: 'calibrated',
      offsetY: -0.45
    });
  });

  it('gives the posture mode the sit-up frame in every scene', () => {
    expect(planFrame({ ...base, mode: 'posture' })).toEqual({ base: 'situp', offsetY: 0 });
    // The rise ends with the camera at the operator's setting, so the art moves
    // by however far that setting is from the authored eye.
    const plan = planFrame({ ...base, mode: 'posture', standEyeHeight: 1.55 });
    expect(plan.base).toBe('situp');
    expect(plan.offsetY).toBeCloseTo(-0.15, 9);
  });

  it('never produces a non-finite offset', () => {
    const plan = planFrame({
      mode: 'float',
      eyeY: Number.NaN,
      standEyeHeight: Number.NaN,
      lyingEyeHeight: Number.NaN
    });
    expect(Number.isFinite(plan.offsetY)).toBe(true);
    expect(plan.offsetY).toBe(0);
  });
});

describe('visual up', () => {
  it('is the content Y while the calibrated frame poses the world', () => {
    const head = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0.3, 0));
    const axis = visualUpInContent(head, new THREE.Quaternion(), new THREE.Vector3());
    expect(axis.y).toBeCloseTo(1, 6);
  });

  it('points along the scene depth in the supine frame', () => {
    const path = new SitUpPath({ standEyeHeight: 1.7 });
    const cam0 = path.at(0);
    // A head lying exactly in the supine camera pose leaves the base identity,
    // so the visual up is the head up: the scene's +Z.
    const world = path.worldFor(cam0, path.at(0));
    const axis = visualUpInContent(cam0.quaternion, world.quaternion, new THREE.Vector3());
    expect(axis.z).toBeCloseTo(1, 6);
    expect(Math.abs(axis.y)).toBeLessThan(1e-6);
  });
});

describe('what the patient sees', () => {
  it('the calibrated frame gives a supine patient a standing view', () => {
    const { horizon, plan } = stack({ mode: 'float' });
    expect(plan.base).toBe('calibrated');
    expect(Math.abs(elevationDeg(horizon))).toBeLessThan(5);
  });

  it('the sit-up frame starts supine and ends standing', () => {
    const supine = stack({ mode: 'posture', t: 0 });
    const standing = stack({ mode: 'posture', t: 1 });
    expect(elevationDeg(supine.horizon)).toBeLessThan(-80);
    expect(Math.abs(elevationDeg(standing.horizon))).toBeLessThan(5);
  });

  it('keeps the heave vertical while the operator tilts the view', () => {
    // The shell rotation is a correction on top of the base; a heave computed
    // from the base alone tilts with that correction and reads as a sideways
    // slide. Every up-gaze in the envelope must leave the lift vertical.
    for (const upGazeDeg of [-30, -12, 0, 12, 30]) {
      const rest = stack({ mode: 'float', bob: 0, upGazeDeg });
      const lifted = stack({ mode: 'float', bob: 0.065, upGazeDeg });
      const rise = Math.abs(elevationDeg(lifted.horizon) - elevationDeg(rest.horizon));
      const depth = Math.abs(lifted.horizon.z - rest.horizon.z);
      expect(rise).toBeLessThan(0.5);
      expect(depth).toBeLessThan(0.2);
    }
  });

  it('the heave reads as up and down in both frames', () => {
    for (const mode of ['float', 'posture'] as const) {
      const rest = stack({ mode, bob: 0 });
      const lifted = stack({ mode, bob: 0.065 });
      const rise = Math.abs(elevationDeg(lifted.horizon) - elevationDeg(rest.horizon));
      const depth = Math.abs(lifted.horizon.z - rest.horizon.z);
      // Lifting the world moves it up in view and does not push it at the face:
      // the head-local depth stays put in both frames.
      expect(rise).toBeLessThan(0.5);
      expect(depth).toBeLessThan(0.2);
      expect(lifted.axis.y).toBeGreaterThan(-1.1);
    }
  });
});

describe('legacy helpers', () => {
  it('still clamp the frame offset composition', () => {
    expect(contentOffsetFor(-1.7, 0.06, false)).toBeCloseTo(-1.64, 6);
    expect(contentOffsetFor(-1.7, 0.06, true)).toBeCloseTo(-1.7, 6);
  });

  it('gate the heave to a running floating session', () => {
    const ok = { mode: 'float' as const, active: true, capturePending: false, rising: false };
    expect(buoyancyAllowed(ok)).toBe(true);
    expect(buoyancyAllowed({ ...ok, rising: true })).toBe(false);
    expect(buoyancyAllowed({ ...ok, mode: 'posture' })).toBe(false);
    expect(buoyancyAllowed({ ...ok, active: false })).toBe(false);
    expect(buoyancyAllowed({ ...ok, capturePending: true })).toBe(false);
  });
});
