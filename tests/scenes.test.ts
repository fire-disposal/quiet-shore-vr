import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { SCENE, SCENES, getSceneDefinition } from '../src/scenes/registry';
import { ResourceRegistry } from '../src/core/geometry/registry';
import { measureObject } from '../src/core/geometry/budget';

function build(id: string) {
  const definition = getSceneDefinition(id);
  if (!definition) {
    throw new Error(`scene ${id} must be registered`);
  }
  const registry = new ResourceRegistry();
  const handle = definition.build({ registry });
  return { definition, handle, registry };
}

function transparentMeshes(root: THREE.Object3D): THREE.Mesh[] {
  const found: THREE.Mesh[] = [];
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) {
      return;
    }
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    if (materials.some((material) => material && material.transparent)) {
      found.push(mesh);
    }
  });
  return found;
}

describe('scene registry', () => {
  it('declares the eye its art was authored for', () => {
    const placement = Object.fromEntries(SCENES.map((scene) => [scene.id, scene.eyeY]));
    expect(placement).toEqual({ washroom: 1.7, shore: 0.45, lightwell: 1.7 });
    for (const scene of SCENES) {
      expect(Number.isFinite(scene.eyeY)).toBe(true);
      expect(scene.eyeY).toBeGreaterThan(0);
    }
  });

  it('ships the operator-selectable scenes in wire order', () => {
    // Index order is the BLE state byte 11 contract: append only.
    expect(SCENES.map((scene) => scene.id)).toEqual(['washroom', 'shore', 'lightwell']);
    expect(SCENE.id).toBe('washroom');
  });

  it('resolves every registered scene and nothing else', () => {
    for (const scene of SCENES) {
      expect(getSceneDefinition(scene.id)).toBe(scene);
    }
    expect(getSceneDefinition('unknown')).toBeUndefined();
  });

  it('declares localized copy for each', () => {
    for (const scene of SCENES) {
      expect(scene.name.zh.length).toBeGreaterThan(0);
      expect(scene.name.en.length).toBeGreaterThan(0);
      expect(scene.tagline.zh.length).toBeGreaterThan(0);
      expect(scene.description.zh.length).toBeGreaterThan(scene.tagline.zh.length);
    }
  });

  it('keeps the water bed to the two scenes that have water', () => {
    const water = SCENES.filter((scene) => scene.audio !== undefined);
    expect(water.map((scene) => scene.id).sort()).toEqual(['shore', 'washroom']);
    for (const scene of water) {
      expect(['lake', 'stream']).toContain(scene.audio!.track);
      const width = scene.audio!.width ?? 0;
      expect(width).toBeGreaterThan(0);
      expect(width).toBeLessThanOrEqual(1);
    }
    // The light well is meant to be heard as one's own breathing.
    expect(getSceneDefinition('lightwell')?.audio).toBeUndefined();
  });
});

describe('scene capabilities', () => {
  it('declares one eye height per scene, sane for the headset', () => {
    for (const id of ['washroom', 'shore', 'lightwell']) {
      const scene = getSceneDefinition(id)!;
      // 0.45 m = lying on water, 1.70 m = standing height. Outside this band the
      // art would either sink through the floor or float above the room.
      expect(scene.eyeY).toBeGreaterThanOrEqual(0.3);
      expect(scene.eyeY).toBeLessThanOrEqual(2.0);
    }
  });

  it('caps the strongest flow-driven scene below the global maximum', () => {
    // The ceiling is the app's guard against the one combination we know is
    // uncomfortable: vertical optic flow at full amplitude.
    const ceilings = Object.fromEntries(SCENES.map((scene) => [scene.id, scene.comfortLevel ?? 3]));
    expect(ceilings).toEqual({ washroom: 3, shore: 3, lightwell: 2 });
  });

  it('hands each motion channel to the scene that needs it', () => {
    const washroom = build('washroom').handle;
    const shore = build('shore').handle;
    const lightwell = build('lightwell').handle;
    try {
      // The room is static: no per-frame work beyond the patient's own motion.
      expect(washroom.applyBuoyancy).toBeUndefined();
      expect(washroom.setFlow).toBeUndefined();
      // The lake carries the buoyancy itself so the horizon stays level.
      expect(typeof shore.applyBuoyancy).toBe('function');
      expect(shore.setFlow).toBeUndefined();
      // The well manufactures the flow; the app only feeds it a 0..1 value.
      expect(typeof lightwell.setFlow).toBe('function');
      expect(lightwell.applyBuoyancy).toBeUndefined();
    } finally {
      washroom.dispose();
      shore.dispose();
      lightwell.dispose();
    }
  });

  it('exposes no gaze targets and no camera of its own', () => {
    for (const id of ['washroom', 'shore', 'lightwell']) {
      const { handle } = build(id);
      try {
        // Selection in a scene would be a second interaction model; the only
        // gaze targets in the app belong to the SUS panel.
        expect(handle.selectables).toHaveLength(0);
        expect(handle.root.getObjectByProperty('isCamera', true)).toBeUndefined();
      } finally {
        handle.dispose();
      }
    }
  });
});

describe('scene budgets', () => {
  it('keeps every scene inside the one-device frame budget', () => {
    for (const scene of SCENES) {
      const { handle, registry } = build(scene.id);
      try {
        const stats = measureObject(handle.root);
        expect(stats.drawCalls).toBeLessThanOrEqual(10);
        expect(stats.triangles).toBeLessThanOrEqual(3000);
        expect(stats.textures).toBeLessThanOrEqual(6);
        expect(handle.budget).toBeDefined();
        expect(handle.budget!.check(stats)).toEqual([]);
      } finally {
        handle.dispose();
        registry.disposeAll();
      }
    }
  });

  it('builds a static room with no transparency', () => {
    const { handle } = build('washroom');
    expect(transparentMeshes(handle.root)).toHaveLength(0);
    expect(handle.settings.fog).toBeNull();
    handle.dispose();
  });

  it('builds a shoreline with a fog horizon and soft anchors', () => {
    const { handle } = build('shore');
    expect(handle.settings.fog).toBeInstanceOf(THREE.Fog);
    expect(handle.root.getObjectByName('shore-dome')).toBeDefined();
    expect(handle.root.getObjectByName('shore-posts')).toBeDefined();
    expect(handle.root.getObjectByName('shore-reeds')).toBeDefined();
    // Only the cloud sheet, the sun path and the reeds may blend.
    expect(transparentMeshes(handle.root).length).toBeLessThanOrEqual(3);
    handle.dispose();
  });

  it('drives the light well only through its flow hook', () => {
    const { handle } = build('lightwell');
    const rings = handle.root.getObjectByName('lightwell-rings') as THREE.InstancedMesh;
    const before = new THREE.Matrix4();
    rings.getMatrixAt(0, before);
    handle.update(0.5, 0.5);
    const still = new THREE.Matrix4();
    rings.getMatrixAt(0, still);
    expect(still.equals(before)).toBe(true);
    handle.setFlow?.(1);
    handle.update(0.5, 1);
    const moved = new THREE.Matrix4();
    rings.getMatrixAt(0, moved);
    expect(moved.equals(before)).toBe(false);
    // Falling body: the fixtures sweep upward past the eye.
    expect(moved.elements[13]).toBeGreaterThan(before.elements[13]);
    handle.dispose();
  });

  it('disposes idempotently', () => {
    const { handle } = build('shore');
    expect(() => {
      handle.dispose();
      handle.dispose();
    }).not.toThrow();
    expect(handle.root.children).toHaveLength(0);
  });
});
