import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { computeSummonedPose, createSpatialPose } from '../src/core/spatial/placement';
import { SpatialAnchor } from '../src/core/spatial/anchor';
import type { HeadPose } from '../src/core/xr/types';
import type { SpatialInteractable } from '../src/core/spatial/types';
import { SpatialInput } from '../src/ui/spatial/input';

function makeHead(
  x = 0,
  y = 0,
  z = 0,
  pitchRad = 0,
  yawRad = 0
): HeadPose {
  const quaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(pitchRad, yawRad, 0, 'YXZ'));
  return { position: new THREE.Vector3(x, y, z), quaternion };
}

function forwardOf(head: HeadPose): THREE.Vector3 {
  return new THREE.Vector3(0, 0, -1).applyQuaternion(head.quaternion);
}

function planeObject(x = 0, y = 0, z = 0, size = 1): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(size, size),
    new THREE.MeshBasicMaterial({ transparent: true, side: THREE.DoubleSide })
  );
  mesh.position.set(x, y, z);
  return mesh;
}

function disposeScene(scene: THREE.Scene): void {
  scene.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (mesh.isMesh) {
      mesh.geometry.dispose();
      const material = mesh.material as THREE.Material | THREE.Material[];
      if (Array.isArray(material)) {
        for (let i = 0; i < material.length; i += 1) material[i].dispose();
      } else {
        material.dispose();
      }
    }
  });
}

describe('computeSummonedPose', () => {
  it('places the panel in front of the head at the requested distance', () => {
    const head = makeHead();
    const out = createSpatialPose();
    computeSummonedPose(head, { mode: 'summoned', distance: 1.25 }, out);

    expect(out.position.distanceTo(head.position)).toBeCloseTo(1.25, 5);
    expect(out.position.x).toBeCloseTo(0, 5);
    expect(out.position.y).toBeCloseTo(0, 5);
    expect(out.position.z).toBeCloseTo(-1.25, 5);

    // Panel +Z faces the head.
    const panelForward = new THREE.Vector3(0, 0, 1).applyQuaternion(out.quaternion);
    const toHead = head.position.clone().sub(out.position).normalize();
    expect(panelForward.dot(toHead)).toBeCloseTo(1, 5);
  });

  it('keeps an in-range gaze direction unclamped', () => {
    const head = makeHead(0, 0, 0, THREE.MathUtils.degToRad(20));
    const out = createSpatialPose();
    computeSummonedPose(head, { mode: 'summoned', distance: 1.25, minPitchDeg: -12, maxPitchDeg: 28 }, out);

    const direction = out.position.clone().sub(head.position).normalize();
    expect(direction.y).toBeCloseTo(Math.sin(THREE.MathUtils.degToRad(20)), 5);
  });

  it('clamps the vertical component of a steep downward gaze', () => {
    const head = makeHead(0, 0, 0, THREE.MathUtils.degToRad(-60));
    const out = createSpatialPose();
    computeSummonedPose(head, { mode: 'summoned', distance: 1.25, minPitchDeg: -12, maxPitchDeg: 28 }, out);

    const raw = forwardOf(head);
    const clamped = new THREE.Vector3(raw.x, Math.sin(THREE.MathUtils.degToRad(-12)), raw.z).normalize();
    const direction = out.position.clone().sub(head.position).normalize();
    expect(direction.y).toBeCloseTo(clamped.y, 5);
    expect(direction.y).toBeGreaterThan(raw.y);
  });

  it('clamps the vertical component of a steep upward gaze', () => {
    const head = makeHead(0, 0, 0, THREE.MathUtils.degToRad(80));
    const out = createSpatialPose();
    computeSummonedPose(head, { mode: 'summoned', distance: 1.25, minPitchDeg: -12, maxPitchDeg: 28 }, out);

    const raw = forwardOf(head);
    const clamped = new THREE.Vector3(raw.x, Math.sin(THREE.MathUtils.degToRad(28)), raw.z).normalize();
    const direction = out.position.clone().sub(head.position).normalize();
    expect(direction.y).toBeCloseTo(clamped.y, 5);
    expect(direction.y).toBeLessThan(raw.y);
  });
});

describe('SpatialAnchor', () => {
  it('freezes a summoned pose in the world after the head moves', () => {
    const anchor = new SpatialAnchor({ mode: 'summoned', distance: 1.2 });
    const first = makeHead();
    anchor.summon(first);

    const frozen = anchor.object.position.clone();
    expect(frozen.z).toBeCloseTo(-1.2, 5);

    anchor.update(makeHead(1, 0, 0, 0, Math.PI), 0.016, 16);
    anchor.update(makeHead(-2, 1, -3, 0, Math.PI / 2), 0.016, 32);

    expect(anchor.object.position.equals(frozen)).toBe(true);
  });

  it('head-locked follows the head each frame', () => {
    const anchor = new SpatialAnchor({ mode: 'head-locked', distance: 0.8, dampingSeconds: 0 });
    anchor.summon(makeHead());
    const moved = makeHead(1.5, 0.2, -1, 0, THREE.MathUtils.degToRad(45));
    anchor.update(moved, 0.016, 16);

    expect(anchor.object.position.distanceTo(moved.position)).toBeCloseTo(0.8, 5);
    const expected = moved.position.clone().addScaledVector(forwardOf(moved), 0.8);
    expect(anchor.object.position.distanceTo(expected)).toBeCloseTo(0, 5);
  });

  it('world-billboard keeps its position and yaws toward the head', () => {
    const anchor = new SpatialAnchor({ mode: 'world-billboard', billboard: 'yaw', dampingSeconds: 0 });
    anchor.setWorldPose(new THREE.Vector3(0, 0, -2), new THREE.Quaternion());

    // Head is level with the panel but to the right, so yaw is exactly 90deg.
    anchor.update(makeHead(2, 1, -2), 0.016, 16);

    expect(anchor.object.position.x).toBeCloseTo(0, 5);
    expect(anchor.object.position.y).toBeCloseTo(0, 5);
    expect(anchor.object.position.z).toBeCloseTo(-2, 5);

    const panelForward = new THREE.Vector3(0, 0, 1).applyQuaternion(anchor.object.quaternion);
    expect(panelForward.x).toBeCloseTo(1, 5);
    expect(panelForward.y).toBeCloseTo(0, 5);
    expect(panelForward.z).toBeCloseTo(0, 5);
  });
});

describe('SpatialInput', () => {
  function setup() {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(70, 1, 0.1, 100);
    const input = new SpatialInput(camera, scene);
    return { scene, camera, input };
  }

  it('focuses a target under the gaze and parks the reticle on it', () => {
    const { scene, input } = setup();
    const mesh = planeObject(0, 0, -2);
    scene.add(mesh);
    scene.updateMatrixWorld(true);

    const onFocus = vi.fn();
    input.register({ object: mesh, layer: 'scene', onFocus });

    input.update(0.016, 0, makeHead());

    expect(onFocus).toHaveBeenCalledWith(true);
    expect(input.focusObject).toBe(mesh);
    expect(input.reticle.visible).toBe(true);
    expect(input.reticle.position.z).toBeCloseTo(-2, 1);
    expect(input.reticle.renderOrder).toBeGreaterThan(1000);

    disposeScene(scene);
    input.dispose();
  });

  it('prefers a UI target over a nearer scene target', () => {
    const { scene, input } = setup();
    const near = planeObject(0, 0, -1.2);
    const far = planeObject(0, 0, -3);
    scene.add(near, far);
    scene.updateMatrixWorld(true);

    input.register({ object: near, layer: 'scene' });
    input.register({ object: far, layer: 'ui' });

    input.update(0.016, 0, makeHead());
    expect(input.focusObject).toBe(far);

    disposeScene(scene);
    input.dispose();
  });

  it('advances dwell, selects once at 1 and latches', () => {
    const { scene, input } = setup();
    const mesh = planeObject(0, 0, -2);
    scene.add(mesh);
    scene.updateMatrixWorld(true);

    const onProgress = vi.fn();
    const onSelect = vi.fn();
    input.register({ object: mesh, layer: 'ui', dwellTime: 0.4, onProgress, onSelect });

    input.update(0.1, 0, makeHead());
    input.update(0.1, 16, makeHead());
    expect(onSelect).not.toHaveBeenCalled();
    expect(onProgress).toHaveBeenLastCalledWith(0.5);
    expect(input.getProgress()).toBeCloseTo(0.5, 5);

    input.update(0.1, 32, makeHead());
    input.update(0.1, 48, makeHead());
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onProgress).toHaveBeenLastCalledWith(1);
    expect(input.getProgress()).toBe(1);

    input.update(0.5, 64, makeHead());
    input.update(0.5, 80, makeHead());
    expect(onSelect).toHaveBeenCalledTimes(1);

    disposeScene(scene);
    input.dispose();
  });

  it('select() activates the focused target immediately and only once per latch', () => {
    const { scene, input } = setup();
    const mesh = planeObject(0, 0, -2);
    scene.add(mesh);
    scene.updateMatrixWorld(true);

    const onSelect = vi.fn();
    const interactable: SpatialInteractable = { object: mesh, layer: 'ui', dwellTime: 2, onSelect };
    input.register(interactable);

    input.select();
    expect(onSelect).not.toHaveBeenCalled();

    input.update(0.016, 0, makeHead());
    expect(input.getFocused()).toBe(interactable);
    input.select();
    expect(onSelect).toHaveBeenCalledTimes(1);

    input.update(0.1, 16, makeHead());
    input.update(0.1, 32, makeHead());
    expect(onSelect).toHaveBeenCalledTimes(1);

    disposeScene(scene);
    input.dispose();
  });

  it('ignores hidden, disabled and unregistered targets', () => {
    const { scene, input } = setup();
    const hidden = planeObject(0, 0, -2);
    const disabled = planeObject(0, 0, -2.5);
    hidden.visible = false;
    scene.add(hidden, disabled);
    scene.updateMatrixWorld(true);

    input.register({ object: hidden, layer: 'ui' });
    const off = input.register({ object: disabled, layer: 'ui', enabled: false });

    input.update(0.016, 0, makeHead());
    expect(input.focusObject).toBeNull();
    expect(input.reticle.visible).toBe(false);

    off();
    input.update(0.016, 16, makeHead());
    expect(input.focusObject).toBeNull();

    disposeScene(scene);
    input.dispose();
  });

  it('mutes layers and clears focus when a layer is switched off', () => {
    const { scene, input } = setup();
    const mesh = planeObject(0, 0, -2);
    scene.add(mesh);
    scene.updateMatrixWorld(true);

    const onFocus = vi.fn();
    input.register({ object: mesh, layer: 'ui', onFocus });

    input.update(0.016, 0, makeHead());
    expect(input.focusObject).toBe(mesh);

    input.setLayers(false, false);
    expect(input.focusObject).toBeNull();
    expect(onFocus).toHaveBeenLastCalledWith(false);

    input.update(0.016, 16, makeHead());
    expect(input.focusObject).toBeNull();

    input.setLayers(true, false);
    input.update(0.016, 32, makeHead());
    expect(input.focusObject).toBe(mesh);

    disposeScene(scene);
    input.dispose();
  });

  it('unregisters cleanly and disposes its reticle', () => {
    const { scene, input } = setup();
    const mesh = planeObject(0, 0, -2);
    scene.add(mesh);
    scene.updateMatrixWorld(true);

    const onFocus = vi.fn();
    const unregister = input.register({ object: mesh, layer: 'scene', onFocus });
    input.update(0.016, 0, makeHead());
    expect(input.focusObject).toBe(mesh);

    unregister();
    unregister();
    expect(onFocus).toHaveBeenLastCalledWith(false);
    expect(input.focusObject).toBeNull();

    input.update(0.016, 16, makeHead());
    expect(input.focusObject).toBeNull();
    expect(input.reticle.visible).toBe(false);

    input.dispose();
    expect(scene.children.indexOf(input.reticle)).toBe(-1);
    input.update(0.016, 32, makeHead());
    expect(input.focusObject).toBeNull();

    disposeScene(scene);
  });
});
