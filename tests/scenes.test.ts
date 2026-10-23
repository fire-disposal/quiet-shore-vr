import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { SCENE, SCENES, getSceneDefinition } from '../src/scenes/registry';
import { ResourceRegistry } from '../src/core/geometry/registry';
import { measureObject } from '../src/core/geometry/budget';

function build(id: string, quality: 'high' | 'low') {
  const definition = getSceneDefinition(id);
  if (!definition) {
    throw new Error(`scene ${id} must be registered`);
  }
  const registry = new ResourceRegistry();
  const handle = definition.build({ quality, eyeHeight: 1.6, registry });
  return { definition, handle, registry };
}

describe('scene registry', () => {
  it('ships the four scenes in registry order', () => {
    expect(SCENES.map((scene) => scene.id)).toEqual(['bathroom', 'landscape', 'ward', 'lab']);
    expect(SCENE).toBe(SCENES[0]);
  });

  it('resolves every registered scene and nothing else', () => {
    for (const scene of SCENES) {
      expect(getSceneDefinition(scene.id)).toBe(scene);
    }
    expect(getSceneDefinition('unknown')).toBeUndefined();
  });

  it('exposes localized metadata and an audio track for each scene', () => {
    for (const scene of SCENES) {
      expect(scene.name.zh.length).toBeGreaterThan(0);
      expect(scene.name.en.length).toBeGreaterThan(0);
      expect(scene.tagline.zh.length).toBeGreaterThan(0);
      expect(scene.description.zh.length).toBeGreaterThan(scene.tagline.zh.length);
      expect(['lake', 'stream', 'rain']).toContain(scene.audio.track);
    }
  });
});

describe('scene builds', () => {
  it('builds a usable handle for every shipped scene', () => {
    for (const scene of SCENES) {
      const { handle, registry } = build(scene.id, 'low');
      try {
        expect(handle.root).toBeInstanceOf(THREE.Object3D);
        expect(handle.settings.background).toBeInstanceOf(THREE.Color);
        expect(handle.settings.fog).toBeInstanceOf(THREE.Fog);
        expect(handle.root.parent).toBeNull();
        expect(measureObject(handle.root).drawCalls).toBeGreaterThan(0);
      } finally {
        handle.dispose();
        registry.disposeAll();
      }
    }
  });

  it('keeps the landscape inside its declared budget in both tiers', () => {
    for (const quality of ['high', 'low'] as const) {
      const { handle, registry } = build('landscape', quality);
      try {
        const stats = measureObject(handle.root);
        expect(handle.budget).toBeDefined();
        expect(handle.budget!.check(stats)).toEqual([]);
      } finally {
        handle.dispose();
        registry.disposeAll();
      }
    }
  });

  it('disposes idempotently', () => {
    const { handle, registry } = build('landscape', 'low');
    expect(() => {
      handle.dispose();
      handle.dispose();
    }).not.toThrow();
    expect(handle.root.children).toHaveLength(0);
    registry.disposeAll();
  });
});
