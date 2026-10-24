import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { mirrorCameraTransform } from '../src/mirror/camera';

const DEG = Math.PI / 180;

/** The transform the headset renders with: content through world, seen by head. */
function patientDirection(worldDeg: [number, number, number], headRad: [number, number, number]): THREE.Vector3 {
  const world = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(worldDeg[0] * DEG, worldDeg[1] * DEG, worldDeg[2] * DEG, 'XYZ')
  );
  const head = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(headRad[0], headRad[1], headRad[2], 'YXZ')
  );
  return new THREE.Vector3(0, 0, -1).applyQuaternion(world).applyQuaternion(head.clone().invert());
}

function mirrorDirection(camera: { quaternion: THREE.Quaternion }): THREE.Vector3 {
  return new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion.clone().invert());
}

describe('mirror camera', () => {
  const world: [number, number, number] = [-25, 12, 4];
  const head: [number, number, number] = [-9 * DEG, 38 * DEG, 0];

  it('shows the same direction the patient sees', () => {
    const camera = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion() };
    mirrorCameraTransform(camera, { yaw: world[1], pitch: world[0], roll: world[2] }, {
      yaw: head[1],
      pitch: head[0],
      roll: head[2]
    }, { x: 0, y: 1.7, z: 0 });

    const expected = patientDirection(world, head);
    const actual = mirrorDirection(camera);
    expect(actual.distanceTo(expected)).toBeLessThan(1e-6);
  });

  it('keeps the eye at the head pose rotated into content space', () => {
    const camera = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion() };
    const pose = { x: 0.1, y: 1.7, z: 0 };
    mirrorCameraTransform(camera, { yaw: 0, pitch: -25, roll: 0 }, { yaw: 0, pitch: 0, roll: 0 }, pose);
    const expected = new THREE.Vector3(pose.x, pose.y, pose.z).applyQuaternion(
      new THREE.Quaternion().setFromEuler(new THREE.Euler(-25 * DEG, 0, 0, 'XYZ')).invert()
    );
    expect(camera.position.distanceTo(expected)).toBeLessThan(1e-9);
  });

  it('treats the head pose as radians, so a 40° turn aims 40° further', () => {
    const camera = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion() };
    mirrorCameraTransform(camera, { yaw: 0, pitch: 0, roll: 0 }, { yaw: 0, pitch: 0, roll: 0 }, { x: 0, y: 1.7, z: 0 });
    const straight = mirrorDirection(camera);
    mirrorCameraTransform(camera, { yaw: 0, pitch: 0, roll: 0 }, { yaw: 40 * DEG, pitch: 0, roll: 0 }, { x: 0, y: 1.7, z: 0 });
    const turned = mirrorDirection(camera);
    expect(THREE.MathUtils.radToDeg(straight.angleTo(turned))).toBeCloseTo(40, 3);
  });
});
