import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createComfort } from '../src/core/xr/comfort';
import type { PoseLike } from '../src/core/xr/types';

function pose(position: THREE.Vector3, quaternion: THREE.Quaternion): PoseLike {
  return {
    transform: {
      position: { x: position.x, y: position.y, z: position.z },
      orientation: {
        x: quaternion.x,
        y: quaternion.y,
        z: quaternion.z,
        w: quaternion.w
      }
    }
  };
}

function build(headQuat: THREE.Quaternion, headPos = new THREE.Vector3(0, 0.6, -1.2)) {
  const scene = new THREE.Scene();
  const world = new THREE.Group();
  scene.add(world);
  const comfort = createComfort({ scene, world });
  comfort.calibrate(pose(headPos, headQuat));
  return { comfort, group: comfort.group, headQuat };
}

const SUPINE = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0, 'YXZ'));

describe('comfort frame', () => {
  it('starts uncorrected: heading only, the ceiling stays the ceiling', () => {
    const { comfort, group } = build(SUPINE);
    expect(comfort.isCalibrated()).toBe(true);
    expect(comfort.getCorrectionMix()).toBe(0);

    // The patient's heading is zero here, so an uncorrected frame is identity:
    // the world is exactly where it was authored.
    expect(group.quaternion.angleTo(new THREE.Quaternion())).toBeLessThan(1e-6);
  });

  it('applies the heading even at mix 0', () => {
    const head = new THREE.Quaternion().setFromEuler(new THREE.Euler(-1.2, 0.7, 0, 'YXZ'));
    const { group } = build(head);
    // The frame's yaw equals the head's yaw: the room's front is on the
    // patient's heading, without any pitch correction.
    const euler = new THREE.Euler().setFromQuaternion(group.quaternion, 'YXZ');
    expect(euler.y).toBeCloseTo(0.7, 3);
    expect(Math.abs(euler.x)).toBeLessThan(1e-3);
  });

  it('at mix 1 the frame equals the captured orientation', () => {
    const head = new THREE.Quaternion().setFromEuler(new THREE.Euler(-1.1, 0.4, 0.08, 'YXZ'));
    const { comfort, group } = build(head);
    comfort.setCorrectionMix(1);
    expect(group.quaternion.angleTo(head)).toBeLessThan(1e-4);
  });

  it('the uncorrected frame is heading only, whatever the capture pose', () => {
    // Nothing in the calibration asks the patient to look at anything: two
    // captures with the same heading and different pitch produce the same
    // uncorrected frame, because the pitch is measured, not commanded.
    const upright = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.2, 0.7, 0, 'YXZ'));
    const supine = new THREE.Quaternion().setFromEuler(new THREE.Euler(-1.45, 0.7, 0.05, 'YXZ'));
    const a = build(upright);
    const b = build(supine);
    expect(a.group.quaternion.angleTo(b.group.quaternion)).toBeLessThan(1e-6);
    expect(a.group.position.distanceTo(b.group.position)).toBeLessThan(1e-6);

    // And the correction each capture would rise by is its own posture, so the
    // corrected frame is exactly where the head was — no declared pitch.
    a.comfort.setCorrectionMix(1);
    b.comfort.setCorrectionMix(1);
    expect(a.group.quaternion.angleTo(upright)).toBeLessThan(1e-4);
    expect(b.group.quaternion.angleTo(supine)).toBeLessThan(1e-4);
  });

  it('a half mix is halfway around the correction, never past it', () => {
    const { comfort, group } = build(SUPINE);
    comfort.setCorrectionMix(0.5);
    // 90 degrees of correction, halfway = 45 degrees off the authored frame.
    expect(group.quaternion.angleTo(new THREE.Quaternion())).toBeGreaterThan(0.6);
    expect(group.quaternion.angleTo(SUPINE)).toBeGreaterThan(0.6);
  });

  it('clamps the mix and ignores non-finite input', () => {
    const { comfort } = build(SUPINE);
    comfort.setCorrectionMix(2);
    expect(comfort.getCorrectionMix()).toBe(1);
    comfort.setCorrectionMix(-1);
    expect(comfort.getCorrectionMix()).toBe(0);
    comfort.setCorrectionMix(Number.NaN);
    expect(comfort.getCorrectionMix()).toBe(0);
  });

  it('rotates about the calibration eye, so the pivot stays put', () => {
    const headPos = new THREE.Vector3(0.12, 0.58, -1.3);
    const { comfort, group } = build(SUPINE, headPos);
    comfort.setCorrectionMix(0.7);
    // The pivot is a fixed point of the applied transform.
    const moved = headPos.clone().applyQuaternion(group.quaternion).add(group.position);
    expect(moved.distanceTo(headPos)).toBeLessThan(1e-6);
  });

  it('reset drops the calibration and the mix', () => {
    const { comfort, group } = build(SUPINE);
    comfort.setCorrectionMix(1);
    comfort.reset();
    expect(comfort.isCalibrated()).toBe(false);
    expect(comfort.getCorrectionMix()).toBe(0);
    expect(group.quaternion.angleTo(new THREE.Quaternion())).toBeLessThan(1e-6);
    expect(group.position.length()).toBeLessThan(1e-6);
  });
});
