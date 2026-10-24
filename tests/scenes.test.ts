import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { SCENE } from '../src/scenes/registry';
import { ResourceRegistry } from '../src/core/geometry/registry';
import { measureObject } from '../src/core/geometry/budget';

function build() {
  const registry = new ResourceRegistry();
  const handle = SCENE.build({ eyeHeight: 1.7, registry });
  return { handle, registry };
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

describe('shore scene', () => {
  it('is the only shipped scene', () => {
    expect(SCENE.id).toBe('shore');
    expect(SCENE.name.zh).toBe('仰望湖面');
  });

  it('declares localized copy and a bundled audio track', () => {
    expect(SCENE.name.en.length).toBeGreaterThan(0);
    expect(SCENE.tagline.zh.length).toBeGreaterThan(0);
    expect(SCENE.description.zh.length).toBeGreaterThan(SCENE.tagline.zh.length);
    expect(SCENE.audio.track).toBe('lake');
  });

  it('stays inside the one-device frame budget', () => {
    const { handle, registry } = build();
    try {
      const stats = measureObject(handle.root);
      // The ceiling is what makes 1.25x supersampling affordable on Adreno
      // 540: six calls, one full-screen dome, three transparent passes.
      expect(stats.drawCalls).toBeLessThanOrEqual(6);
      expect(stats.triangles).toBeLessThanOrEqual(1500);
      expect(stats.textures).toBeLessThanOrEqual(5);
      expect(transparentMeshes(handle.root).length).toBeLessThanOrEqual(4);
      expect(handle.budget).toBeDefined();
      expect(handle.budget!.check(stats)).toEqual([]);
    } finally {
      handle.dispose();
      registry.disposeAll();
    }
  });

  it('keeps its own settings and releases them on dispose', () => {
    const { handle } = build();
    expect(handle.settings.background).toBeInstanceOf(THREE.Color);
    expect(handle.settings.fog).toBeInstanceOf(THREE.Fog);
    expect(handle.root.parent).toBeNull();
    handle.dispose();
    expect(handle.root.children).toHaveLength(0);
    expect(() => handle.dispose()).not.toThrow();
  });

  it('advances clouds and motes without allocating new objects', () => {
    const { handle } = build();
    const motes = handle.root.getObjectByName('shore-motes') as THREE.Points;
    const attribute = motes.geometry.getAttribute('position') as THREE.BufferAttribute;
    const before = (attribute.array as Float32Array).slice(0, 3);
    handle.update(0.5, 0.5);
    const after = attribute.array as Float32Array;
    expect(after[1]).not.toBe(before[1]);
    expect(handle.root.getObjectByName('shore-clouds-0')).toBeDefined();
    handle.dispose();
  });
});
