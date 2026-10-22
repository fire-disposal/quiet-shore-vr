import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { getSceneDefinition, listScenes } from '../src/scenes/registry';
import { ResourceRegistry } from '../src/core/geometry/registry';
import { normalizeSceneId } from '../src/ui/scene-select';

interface BathroomStats {
  triangles: number;
  drawCalls: number;
  meshes: number;
  lights: number;
  quality: string;
}

function buildBathroom(quality: 'high' | 'low') {
  const definition = getSceneDefinition('bathroom');
  if (!definition) {
    throw new Error('bathroom scene must be registered');
  }
  const registry = new ResourceRegistry();
  const handle = definition.build({ quality, eyeHeight: 1.6, registry });
  const world = handle.root.children.find((child) => child.name === 'bathroom');
  if (!world) {
    throw new Error('bathroom world group must live under the handle root');
  }
  return {
    handle,
    registry,
    stats: world.userData.stats as BathroomStats | undefined
  };
}

interface LabStats {
  triangles: number;
  drawCalls: number;
  meshes: number;
  lights: number;
  textures: number;
  quality: string;
}

const LAB_WORLD_NAME = 'upright-light-chamber';

function buildLab(quality: 'high' | 'low') {
  const definition = getSceneDefinition('lab');
  if (!definition) {
    throw new Error('lab scene must be registered');
  }
  const registry = new ResourceRegistry();
  const handle = definition.build({ quality, eyeHeight: 1.7, registry });
  const world = handle.root.getObjectByName(LAB_WORLD_NAME);
  if (!world) {
    throw new Error('lab world group must live under the handle root');
  }
  return {
    handle,
    registry,
    world,
    stats: world.userData.stats as LabStats | undefined
  };
}

describe('scene registry', () => {
  it('lists the shipped scenes in stable order', () => {
    const scenes = listScenes();
    expect(scenes.map((scene) => scene.id)).toEqual(['landscape', 'ward', 'bathroom', 'lab']);
  });

  it('exposes localized metadata and the stream bed for the bathroom', () => {
    const bathroom = getSceneDefinition('bathroom');
    expect(bathroom).toBeDefined();
    expect(bathroom?.name).toEqual({ zh: '病房卫生间', en: 'Ward Bathroom' });
    expect(bathroom?.audio.track).toBe('stream');

    const summary = listScenes().find((scene) => scene.id === 'bathroom');
    expect(summary).toBeDefined();
    expect(summary?.tagline.zh.length).toBeGreaterThan(0);
    expect(summary?.tagline.en.length).toBeGreaterThan(0);
    expect(summary?.description.zh.length).toBeGreaterThan(summary?.tagline.zh.length ?? 0);
    expect(summary?.description.en.length).toBeGreaterThan(summary?.tagline.en.length ?? 0);
  });

  it('accepts the bathroom scene id from storage', () => {
    expect(normalizeSceneId('bathroom')).toBe('bathroom');
    expect(normalizeSceneId('unknown')).toBeNull();
  });
});

describe('bathroom scene build', () => {
  it('builds three gaze targets with selectable metadata', () => {
    const { handle, registry } = buildBathroom('high');
    try {
      expect(handle.root.name).toBe('bathroom');
      expect(handle.settings.background).toBeInstanceOf(THREE.Color);
      expect(handle.settings.fog).toBeInstanceOf(THREE.Fog);
      expect(handle.selectables).toHaveLength(3);

      const labels = handle.selectables.map((selectable) => selectable.userData.label);
      expect(labels).toEqual(['mirror', 'grab-bar', 'call-button']);
      for (const selectable of handle.selectables) {
        expect(selectable.userData.selectable).toBe(true);
        expect(typeof selectable.userData.targetId).toBe('number');
        expect(selectable.parent).not.toBeNull();
      }
    } finally {
      handle.dispose();
      registry.disposeAll();
    }
  });

  it('stays inside the declared quality budgets', () => {
    const cases = [
      { quality: 'high' as const, drawCalls: 18, triangles: 7000, lights: 3 },
      { quality: 'low' as const, drawCalls: 18, triangles: 6000, lights: 2 }
    ];

    for (const expected of cases) {
      const { handle, registry, stats } = buildBathroom(expected.quality);
      try {
        expect(stats).toBeDefined();
        expect(stats?.quality).toBe(expected.quality);
        expect(stats?.lights).toBe(expected.lights);
        expect(stats?.drawCalls).toBeGreaterThan(0);
        expect(stats?.drawCalls).toBeLessThanOrEqual(expected.drawCalls);
        expect(stats?.triangles).toBeGreaterThan(0);
        expect(stats?.triangles).toBeLessThanOrEqual(expected.triangles);
        expect(handle.budget?.limits.drawCalls).toBe(stats?.drawCalls);
        handle.update(1 / 60, 0);
        handle.update(0.5, 0.5);
      } finally {
        handle.dispose();
        registry.disposeAll();
      }
    }
  });

  it('disposes only the scene root and is idempotent', () => {
    const { handle, registry } = buildBathroom('low');
    const root = handle.root;
    expect(root.children.length).toBeGreaterThan(0);
    handle.dispose();
    expect(root.children).toHaveLength(0);
    expect(handle.selectables).toHaveLength(0);
    expect(handle.settings.background).toBeNull();
    expect(handle.settings.fog).toBeNull();
    expect(root.parent).toBeNull();
    handle.dispose();
    expect(root.children).toHaveLength(0);
    registry.disposeAll();
  });
});

describe('upright light chamber', () => {
  it('publishes standing-reference metadata on the stream bed', () => {
    const lab = getSceneDefinition('lab');
    expect(lab).toBeDefined();
    expect(lab?.name).toEqual({ zh: '直立光室', en: 'Upright Light Chamber' });
    expect(lab?.audio).toEqual({ track: 'stream', volume: 0.8, fadeMs: 1200, loop: true });

    const summary = listScenes().find((scene) => scene.id === 'lab');
    expect(summary).toBeDefined();
    expect(summary?.tagline.zh.length).toBeGreaterThan(0);
    expect(summary?.tagline.en.length).toBeGreaterThan(0);
    expect(summary?.description.zh.length).toBeGreaterThan(summary?.tagline.zh.length ?? 0);
    expect(summary?.description.en.length).toBeGreaterThan(summary?.tagline.en.length ?? 0);
  });

  it('builds three mid-depth gaze targets with selectable metadata', () => {
    const { handle, registry } = buildLab('high');
    try {
      expect(handle.root.name).toBe('lab');
      expect(handle.settings.background).toBeInstanceOf(THREE.Color);
      expect(handle.settings.fog).toBeInstanceOf(THREE.Fog);
      expect(handle.selectables).toHaveLength(3);

      const labels = handle.selectables.map((selectable) => selectable.userData.label);
      expect(labels).toEqual(['monolith-a', 'monolith-b', 'monolith-c']);
      const targetIds = handle.selectables.map((selectable) => selectable.userData.targetId);
      expect(targetIds).toEqual([1, 2, 3]);
      for (const selectable of handle.selectables) {
        expect(selectable.userData.selectable).toBe(true);
        expect(selectable.parent).not.toBeNull();
      }
    } finally {
      handle.dispose();
      registry.disposeAll();
    }
  });

  it('stays inside the upright-chamber quality budgets', () => {
    const cases = [
      { quality: 'high' as const, drawCalls: 22, triangles: 20000, lights: 3 },
      { quality: 'low' as const, drawCalls: 22, triangles: 12000, lights: 3 }
    ];

    for (const expected of cases) {
      const { handle, registry, stats } = buildLab(expected.quality);
      try {
        expect(stats).toBeDefined();
        expect(stats?.quality).toBe(expected.quality);
        expect(stats?.lights).toBe(expected.lights);
        expect(stats?.textures).toBe(0);
        expect(stats?.drawCalls).toBeGreaterThan(0);
        expect(stats?.drawCalls).toBeLessThanOrEqual(expected.drawCalls);
        expect(stats?.triangles).toBeGreaterThan(0);
        expect(stats?.triangles).toBeLessThanOrEqual(expected.triangles);
        expect(handle.budget?.limits.drawCalls).toBe(stats?.drawCalls);
        expect(handle.budget?.limits.triangles).toBe(stats?.triangles);
        handle.update(0.016, 0);
        handle.update(0.016, 0.016);
        handle.update(0.5, 0.516);
      } finally {
        handle.dispose();
        registry.disposeAll();
      }
    }
  });

  it('updates after disposal without touching a released world', () => {
    const { handle, registry, world, stats } = buildLab('low');
    const root = handle.root;
    expect(stats?.quality).toBe('low');
    expect(world.parent).not.toBeNull();
    handle.update(0.016, 0);
    handle.dispose();
    expect(() => handle.update(0.016, 0.016)).not.toThrow();
    expect(root.children).toHaveLength(0);
    expect(handle.selectables).toHaveLength(0);
    expect(handle.settings.background).toBeNull();
    expect(handle.settings.fog).toBeNull();
    expect(root.parent).toBeNull();
    handle.dispose();
    expect(root.children).toHaveLength(0);
    registry.disposeAll();
  });
});
