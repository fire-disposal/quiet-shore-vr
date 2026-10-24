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
  const handle = definition.build({ eyeHeight: 1.7, registry });
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
  it('ships the two operator-selectable scenes in wire order', () => {
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

  it('declares localized copy and a bundled audio track for each', () => {
    for (const scene of SCENES) {
      expect(scene.name.zh.length).toBeGreaterThan(0);
      expect(scene.name.en.length).toBeGreaterThan(0);
      expect(scene.tagline.zh.length).toBeGreaterThan(0);
      expect(scene.description.zh.length).toBeGreaterThan(scene.tagline.zh.length);
      expect(['lake', 'stream', 'rain']).toContain(scene.audio.track);
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
