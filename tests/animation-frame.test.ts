import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createComfort } from '../src/core/xr/comfort';
import { createWorldShell } from '../src/core/xr/world-shell';
import { worldUpInContent } from '../src/core/xr/world-frame';
import { viewToWorld } from '../src/core/xr/view-motion';
import type { PoseLike } from '../src/core/xr/types';

/**
 * The world stack: shell (view) → comfort (heading × correction mix) →
 * content (+ buoyancy delta). The head lies on its back looking at the ceiling.
 */
function stack(options: { mix: number; bob?: number; upGazeDeg?: number }) {
  const headPos = new THREE.Vector3(0, 0.62, -1.4);
  // Supine: the head's up is +Z, its gaze is +Y (straight up).
  const headQuat = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(-Math.PI / 2, 0, 0, 'YXZ')
  );
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
  comfort.setCorrectionMix(options.mix);
  const shell = createWorldShell({ scene, base: comfort.group });
  if (options.upGazeDeg) {
    shell.setWorldRotation(viewToWorld(0, options.upGazeDeg));
  }

  // The frame lowers the art by the authored eye height; the heave is a
  // vector along world up, exactly as `floating` writes it. The shell must
  // apply its rotation first: production computes the axis after `update`.
  shell.update(headPos);
  const parent = shell.group.quaternion.clone().multiply(shell.base.quaternion);
  const axis = worldUpInContent(parent, new THREE.Vector3());
  const bob = options.bob ?? 0;
  content.position.set(axis.x * bob, -1.7 + axis.y * bob, axis.z * bob);
  scene.updateMatrixWorld(true);

  const horizonWorld = new THREE.Vector3(0, 0, -40).applyMatrix4(content.matrixWorld);
  const horizon = horizonWorld
    .clone()
    .sub(headPos)
    .applyQuaternion(headQuat.clone().invert());
  return { headPos, headQuat, horizon, horizonWorld, axis, parent };
}

function elevationDeg(local: THREE.Vector3): number {
  return (Math.atan2(local.y, Math.hypot(local.x, -local.z)) * 180) / Math.PI;
}

describe('correction mix', () => {
  it('starts with the real ceiling: the horizon is ~90 degrees out of view', () => {
    const { horizon } = stack({ mix: 0 });
    // Uncorrected, the room is upright in the physical world: a head looking at
    // the ceiling has the far wall at the edge of the view, ~90° from the gaze.
    expect(Math.abs(elevationDeg(horizon))).toBeGreaterThan(80);
  });

  it('fully corrected, the horizon is at eye level', () => {
    const { horizon } = stack({ mix: 1 });
    expect(Math.abs(elevationDeg(horizon))).toBeLessThan(5);
  });

  it('halfway is between the two, not a jump', () => {
    const raw = Math.abs(elevationDeg(stack({ mix: 0 }).horizon));
    const half = Math.abs(elevationDeg(stack({ mix: 0.5 }).horizon));
    const full = Math.abs(elevationDeg(stack({ mix: 1 }).horizon));
    // The horizon walks from the edge of the view to eye level without a jump.
    expect(full).toBeLessThan(5);
    expect(half).toBeLessThan(raw);
    expect(half).toBeGreaterThan(full + 5);
  });

  it('the axis round-trips to world up at any mix', () => {
    for (const mix of [0, 0.5, 1]) {
      const { axis, parent } = stack({ mix });
      expect(axis.length()).toBeCloseTo(1, 6);
      // Applying the parent rotation to the content-space axis recovers world
      // vertical, independent of the head or the operator's view pitch.
      const world = axis.clone().applyQuaternion(parent);
      expect(world.x).toBeCloseTo(0, 6);
      expect(world.y).toBeCloseTo(1, 6);
      expect(world.z).toBeCloseTo(0, 6);
    }
  });
});

describe('heave in world space', () => {
  it('moves the world vertically, whatever the view or posture', () => {
    for (const mix of [0, 0.5, 1]) {
      for (const upGazeDeg of [-30, 0, 30]) {
        const rest = stack({ mix, upGazeDeg, bob: 0 });
        const lifted = stack({ mix, upGazeDeg, bob: 0.065 });
        const delta = lifted.horizonWorld.clone().sub(rest.horizonWorld);
        expect(delta.x).toBeCloseTo(0, 6);
        expect(delta.y).toBeCloseTo(0.065, 6);
        expect(delta.z).toBeCloseTo(0, 6);
      }
    }
  });
});

describe('world up', () => {
  it('is the content Y before any frame rotation is applied', () => {
    const axis = worldUpInContent(new THREE.Quaternion(), new THREE.Vector3());
    expect(axis.y).toBeCloseTo(1, 6);
  });

  it('stays scene-vertical in the uncorrected frame', () => {
    const { axis } = stack({ mix: 0 });
    // The uncorrected frame carries no pitch, so world up is still content Y.
    expect(Math.abs(axis.y)).toBeGreaterThan(0.9);
    expect(Math.abs(axis.z)).toBeLessThan(0.2);
  });
});
