import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createWorldShell, type WorldShellApi } from '../src/core/xr/world-shell';
import { viewToWorld } from '../src/core/xr/view-motion';
import { worldQuaternion, type WorldRotation } from '../src/core/xr/frame';
import { SitUpPath } from '../src/core/xr/situp-path';

const DEG = Math.PI / 180;

function buildShell(): {
  scene: THREE.Scene;
  base: THREE.Group;
  shell: WorldShellApi;
} {
  const scene = new THREE.Scene();
  const base = new THREE.Group();
  base.name = 'comfort';
  scene.add(base);
  const shell = createWorldShell({ scene, base });
  return { scene, base, shell };
}

/** World matrix of `point` including the shell above it. */
function applyThrough(shell: WorldShellApi, point: THREE.Vector3): THREE.Vector3 {
  shell.group.updateMatrixWorld(true);
  return point.clone().applyMatrix4(shell.group.matrixWorld);
}

describe('world shell', () => {
  it('parent order is shell -> base, with the base pose untouched', () => {
    const { scene, base, shell } = buildShell();
    expect(shell.group.parent).toBe(scene);
    expect(base.parent).toBe(shell.group);
    expect(shell.base).toBe(base);

    shell.setBasePose(null);
    base.position.set(1, 2, 3);
    shell.setWorldRotation(viewToWorld(0, 12));
    shell.update(new THREE.Vector3(0, 1.6, 0));
    // The rotation is a separate layer: the base keeps what its owner wrote.
    expect(base.position.x).toBeCloseTo(1);
    expect(base.position.y).toBeCloseTo(2);
    expect(base.position.z).toBeCloseTo(3);
    expect(shell.isBasePosed()).toBe(false);
  });

  it('a positive up-gaze looks up: the point ahead drops, the eye stays put', () => {
    const { shell } = buildShell();
    const eye = new THREE.Vector3(0, 1.6, 0);
    const ahead = new THREE.Vector3(0, 1.6, -1);

    shell.setWorldRotation(viewToWorld(0, 0));
    shell.update(eye);
    expect(applyThrough(shell, eye).distanceTo(eye)).toBeLessThan(1e-9);

    shell.setWorldRotation(viewToWorld(0, 10));
    shell.update(eye);
    expect(applyThrough(shell, eye).distanceTo(eye)).toBeLessThan(1e-9);

    const rotatedAhead = applyThrough(shell, ahead);
    expect(rotatedAhead.y - eye.y).toBeCloseTo(-Math.sin(10 * DEG), 6);
    expect(rotatedAhead.z - eye.z).toBeCloseTo(-Math.cos(10 * DEG), 6);
    expect(Math.abs(rotatedAhead.x - eye.x)).toBeLessThan(1e-9);
  });

  it('keeps the eye fixed for a pitched-down target too', () => {
    const { shell } = buildShell();
    const eye = new THREE.Vector3(0.2, 1.5, 0.1);
    shell.setWorldRotation(viewToWorld(0, -14));
    shell.update(eye);
    expect(applyThrough(shell, eye).distanceTo(eye)).toBeLessThan(1e-9);
    const ahead = applyThrough(shell, new THREE.Vector3(0.2, 1.5, -0.9));
    expect(ahead.y).toBeGreaterThan(eye.y);
  });

  it('rotates by exactly the quaternion the frame module builds, about the eye', () => {
    const { shell } = buildShell();
    const eye = new THREE.Vector3(-0.3, 1.2, 0.7);
    const target: WorldRotation = { pitchDeg: 8, rollDeg: -5, yawDeg: 21 };
    const expected = worldQuaternion(new THREE.Quaternion(), target);

    shell.setWorldRotation(target);
    shell.update(eye);

    expect(shell.group.quaternion.angleTo(expected)).toBeLessThan(1e-9);
    expect(applyThrough(shell, eye).distanceTo(eye)).toBeLessThan(1e-9);
  });

  it('composes with the sit-up base pose at every t without losing the head', () => {
    const { base, shell } = buildShell();
    const path = new SitUpPath({ standEyeHeight: 1.7 });
    const head = {
      position: new THREE.Vector3(0.15, 0.35, -0.4),
      quaternion: new THREE.Quaternion().setFromEuler(new THREE.Euler(0.1, -0.2, 0.05))
    };

    for (const t of [0, 0.15, 0.5, 0.7, 0.85, 1]) {
      const camera = path.at(t);
      const world = path.worldFor(head, camera);
      shell.setBasePose(world);

      expect(shell.isBasePosed()).toBe(true);
      expect(base.position.distanceTo(world.position)).toBeLessThan(1e-9);
      expect(base.quaternion.angleTo(world.quaternion)).toBeLessThan(1e-6);

      shell.setWorldRotation(viewToWorld(0, 9));
      shell.update(head.position);

      // The sit-up pose is not rewritten by the rotation layer.
      expect(base.position.distanceTo(world.position)).toBeLessThan(1e-9);
      expect(base.quaternion.angleTo(world.quaternion)).toBeLessThan(1e-6);

      // The composed transform still maps the virtual camera onto the physical
      // head: the rotation is about the eye, so the eye is a fixed point.
      shell.group.updateMatrixWorld(true);
      const composed = new THREE.Matrix4().multiplyMatrices(
        shell.group.matrixWorld,
        base.matrix
      );
      const recovered = camera.position.clone().applyMatrix4(composed);
      expect(recovered.distanceTo(head.position)).toBeLessThan(1e-6);
    }
  });

  it('drops back to identity at 0°, copies on read and ignores non-finite input', () => {
    const { scene, base, shell } = buildShell();
    const out: WorldRotation = { pitchDeg: 0, rollDeg: 0, yawDeg: 0 };

    shell.setWorldRotation(viewToWorld(0, 18));
    shell.update(new THREE.Vector3(0, 1.6, 0));
    shell.getWorldRotation(out);
    expect(out.pitchDeg).toBeCloseTo(-18);
    expect(out.rollDeg).toBe(0);
    expect(Math.abs(out.yawDeg)).toBe(0);

    // The read is a copy: mutating it must not steer the shell.
    out.pitchDeg = 0;
    shell.update(new THREE.Vector3(0, 1.6, 0));
    expect(shell.group.quaternion.angleTo(worldQuaternion(new THREE.Quaternion(), viewToWorld(0, 18)))).toBeLessThan(1e-9);

    shell.setWorldRotation(viewToWorld(0, 0));
    shell.update(new THREE.Vector3(0, 1.6, 0));
    expect(shell.group.quaternion.angleTo(new THREE.Quaternion())).toBeLessThan(1e-9);
    expect(shell.group.position.length()).toBeLessThan(1e-9);

    // Non-finite input is ignored rather than poisoning the transform.
    shell.setWorldRotation({ pitchDeg: Number.NaN, rollDeg: 0, yawDeg: 0 });
    shell.getWorldRotation(out);
    expect(Math.abs(out.pitchDeg)).toBe(0);

    shell.dispose();
    expect(base.parent).toBe(scene);
    expect(shell.group.parent).toBeNull();
  });
});
