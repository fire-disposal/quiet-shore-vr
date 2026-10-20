import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { SitUpPath } from '../src/core/xr/situp-path';

const CAMERA_FORWARD = new THREE.Vector3(0, 0, -1);
const CAMERA_UP = new THREE.Vector3(0, 1, 0);

function forwardOf(quaternion: THREE.Quaternion): THREE.Vector3 {
  return CAMERA_FORWARD.clone().applyQuaternion(quaternion);
}

describe('sit-up camera path', () => {
  it('starts supine looking up at the ceiling', () => {
    const path = new SitUpPath({ standEyeHeight: 1.7 });
    const pose = path.at(0);
    expect(pose.position.y).toBeCloseTo(path.hipHeight, 6);
    expect(pose.position.z).toBeCloseTo(path.torsoLength, 6);
    const forward = forwardOf(pose.quaternion);
    expect(forward.x).toBeCloseTo(0, 6);
    expect(forward.y).toBeCloseTo(1, 6);
    expect(forward.z).toBeCloseTo(0, 6);
  });

  it('reaches seated at the end of the rotation phase', () => {
    const path = new SitUpPath({ standEyeHeight: 1.7 });
    const pose = path.at(path.rotationPortion);
    expect(pose.position.y).toBeCloseTo(path.hipHeight + path.torsoLength, 6);
    expect(pose.position.z).toBeCloseTo(0, 6);
    const forward = forwardOf(pose.quaternion);
    expect(forward.z).toBeCloseTo(-1, 6);
  });

  it('ends at the configured standing eye height facing forward', () => {
    const path = new SitUpPath({ standEyeHeight: 1.7 });
    const pose = path.at(1);
    expect(pose.position.y).toBeCloseTo(1.7, 6);
    const forward = forwardOf(pose.quaternion);
    expect(forward.z).toBeCloseTo(-1, 6);
    const up = CAMERA_UP.clone().applyQuaternion(pose.quaternion);
    expect(up.y).toBeCloseTo(1, 6);
  });

  it('never lowers the eye and stays finite outside 0..1', () => {
    const path = new SitUpPath({ standEyeHeight: 1.7 });
    let previous = -Infinity;
    for (let i = 0; i <= 100; i += 1) {
      const pose = path.at(i / 100);
      expect(Number.isFinite(pose.position.y)).toBe(true);
      expect(Number.isFinite(pose.quaternion.x)).toBe(true);
      expect(pose.position.y).toBeGreaterThanOrEqual(previous - 1e-9);
      previous = pose.position.y;
    }
    expect(path.at(-1).position.y).toBeCloseTo(path.hipHeight, 6);
    expect(path.at(2).position.y).toBeCloseTo(1.7, 6);
  });

  it('inverts the virtual camera into the world shell transform', () => {
    const path = new SitUpPath({ standEyeHeight: 1.7 });
    const head = {
      position: new THREE.Vector3(0.3, 0.4, -1.2),
      quaternion: new THREE.Quaternion().setFromEuler(new THREE.Euler(0.2, 0.6, 0, 'YXZ'))
    };
    for (const t of [0, 0.2, 0.5, 0.7, 0.9, 1]) {
      const camera = path.at(t);
      const world = path.worldFor(head, camera);

      const recoveredQuaternion = world.quaternion
        .clone()
        .multiply(camera.quaternion);
      expect(recoveredQuaternion.angleTo(head.quaternion)).toBeLessThan(1e-6);

      const recoveredPosition = camera.position
        .clone()
        .applyQuaternion(world.quaternion)
        .add(world.position);
      expect(recoveredPosition.distanceTo(head.position)).toBeLessThan(1e-6);
    }
  });
});
