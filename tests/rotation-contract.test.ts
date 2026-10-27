import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { clampSigned, degToRad, radToDeg } from '../src/core/xr/angle';
import { worldQuaternion } from '../src/core/xr/frame';
import { viewToWorld } from '../src/core/xr/view-motion';

const DEG = Math.PI / 180;
const FORWARD = new THREE.Vector3(0, 0, -1);

/** The golden vectors every layer must agree on (docs/rotation-contract.md §9). */
describe('rotation contract', () => {
  it('converts units exactly once', () => {
    expect(degToRad(180)).toBeCloseTo(Math.PI, 12);
    expect(radToDeg(Math.PI)).toBeCloseTo(180, 12);
    expect(radToDeg(degToRad(-37.5))).toBeCloseTo(-37.5, 12);
    expect(clampSigned(25, 20)).toBe(20);
    expect(clampSigned(-25, 20)).toBe(-20);
    expect(clampSigned(Number.NaN, 20)).toBe(0);
  });

  it('maps the patient-centric view to the opposite world rotation', () => {
    const up = viewToWorld(0, 20);
    expect(up.pitchDeg).toBeCloseTo(-20);
    expect(Math.abs(up.rollDeg)).toBe(0);
    const down = viewToWorld(0, -20);
    expect(down.pitchDeg).toBeCloseTo(20);
    const left = viewToWorld(90, 0);
    expect(left.yawDeg).toBeCloseTo(-90);
    expect(Math.abs(left.pitchDeg)).toBeLessThan(1e-12);
    const ahead = FORWARD.clone().applyQuaternion(
      worldQuaternion(new THREE.Quaternion(), viewToWorld(0, 20))
    );
    // Content moves down, so the patient sees more sky.
    expect(ahead.y).toBeCloseTo(-Math.sin(20 * DEG), 6);
  });

  it('builds Rx(pitch) · Rz(roll) in XYZ order', () => {
    const product = worldQuaternion(new THREE.Quaternion(), {
      pitchDeg: 12,
      rollDeg: -6,
      yawDeg: 0
    });
    const expected = new THREE.Quaternion()
      .setFromAxisAngle(new THREE.Vector3(1, 0, 0), 12 * DEG)
      .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -6 * DEG));
    expect(product.angleTo(expected)).toBeLessThan(1e-6);
  });

  it('a +90° world tilt cancels a +90° head pitch', () => {
    // The sit-up end state: the patient physically looks up while the world
    // tilts, and the content that was overhead lands dead ahead.
    const world = worldQuaternion(new THREE.Quaternion(), {
      pitchDeg: 90,
      rollDeg: 0,
      yawDeg: 0
    });
    const headUp = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(1, 0, 0),
      90 * DEG
    );
    const content = FORWARD.clone().applyQuaternion(world);
    const gaze = FORWARD.clone().applyQuaternion(headUp);
    expect(content.distanceTo(gaze)).toBeLessThan(1e-9);
  });

});
