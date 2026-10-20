import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { SceneHost } from '../src/core/scene/host';
import { SceneRegistry } from '../src/core/scene/registry';
import type {
  SceneBuildContext,
  SceneDefinition,
  SceneHandle,
  SceneSettings
} from '../src/core/scene/contract';

interface HandleState {
  updates: number;
  lastDt: number;
  lastElapsed: number;
  disposed: number;
}

function createHandle(settings: Partial<SceneSettings> = {}): {
  handle: SceneHandle;
  state: HandleState;
  root: THREE.Group;
} {
  const root = new THREE.Group();
  const selectable = new THREE.Object3D();
  root.add(selectable);
  const state: HandleState = { updates: 0, lastDt: 0, lastElapsed: 0, disposed: 0 };
  const handle: SceneHandle = {
    root,
    selectables: [selectable],
    settings: {
      background: settings.background ?? null,
      fog: settings.fog ?? null
    },
    update: (dt: number, elapsed: number): void => {
      state.updates += 1;
      state.lastDt = dt;
      state.lastElapsed = elapsed;
    },
    dispose: (): void => {
      state.disposed += 1;
    }
  };
  return { handle, state, root };
}

function createDefinition(
  id: string,
  build: (ctx: SceneBuildContext) => SceneHandle
): SceneDefinition {
  return {
    id,
    name: { zh: id, en: id },
    tagline: { zh: '', en: '' },
    description: { zh: '', en: '' },
    audio: 'lake',
    build
  };
}

describe('SceneHost', () => {
  it('applies scene settings and restores the baseline on unload', () => {
    const background = new THREE.Color(0x102030);
    const fog = new THREE.Fog(0x102030, 1, 12);
    const host = new SceneHost();
    const scene = createHandle({ background, fog });

    expect(host.scene.background).toBeNull();
    host.load(createDefinition('a', () => scene.handle));

    expect(host.scene.background).toBe(background);
    expect(host.scene.fog).toBe(fog);
    expect(host.content.children).toContain(scene.root);
    expect(host.selectables).toBe(scene.handle.selectables);

    host.unload();

    expect(host.scene.background).toBeNull();
    expect(host.scene.fog).toBeNull();
    expect(host.handle).toBeNull();
    expect(host.definition).toBeNull();
    expect(host.selectables).toHaveLength(0);
    expect(host.content.children).toHaveLength(0);
    expect(scene.state.disposed).toBe(1);
  });

  it('restores the scene values that existed before the host took over', () => {
    const initialBackground = new THREE.Color(0x445566);
    const initialFog = new THREE.Fog(0x445566, 2, 30);
    const scene = new THREE.Scene();
    scene.background = initialBackground;
    scene.fog = initialFog;
    const host = new SceneHost(scene);

    host.load(
      createDefinition('a', () => createHandle({ background: new THREE.Color(0xff0000) }).handle)
    );
    expect(host.scene.background).not.toBe(initialBackground);

    host.unload();
    expect(host.scene.background).toBe(initialBackground);
    expect(host.scene.fog).toBe(initialFog);
  });

  it('keeps the current scene and settings when the next build throws', () => {
    const background = new THREE.Color(0x123456);
    const fog = new THREE.Fog(0x123456, 1, 9);
    const host = new SceneHost();
    const live = createHandle({ background, fog });
    host.load(createDefinition('a', () => live.handle));

    const failing = createDefinition('b', () => {
      throw new Error('build failed');
    });

    expect(() => host.load(failing)).toThrow('build failed');
    expect(host.handle).toBe(live.handle);
    expect(host.definition?.id).toBe('a');
    expect(host.scene.background).toBe(background);
    expect(host.scene.fog).toBe(fog);
    expect(host.content.children).toContain(live.root);
    expect(live.state.disposed).toBe(0);
  });

  it('disposes the previous handle after a successful swap', () => {
    const host = new SceneHost();
    const first = createHandle();
    const second = createHandle();
    host.load(createDefinition('a', () => first.handle));
    host.load(createDefinition('b', () => second.handle));

    expect(first.state.disposed).toBe(1);
    expect(first.root.parent).toBeNull();
    expect(host.content.children).toContain(second.root);
    expect(host.handle).toBe(second.handle);
  });

  it('applies the floor offset through the content group', () => {
    const host = new SceneHost();
    const scene = createHandle();
    host.setFloorOffset(-1.4);
    host.load(createDefinition('a', () => scene.handle));

    expect(host.content.position.y).toBe(-1.4);
    expect(scene.root.position.y).toBe(0);
  });

  it('forwards dt with an accumulated elapsed time and resets it on load', () => {
    const host = new SceneHost();
    const first = createHandle();
    const second = createHandle();
    host.load(createDefinition('a', () => first.handle));

    host.update(0.5);
    host.update(0.25);
    expect(first.state.updates).toBe(2);
    expect(first.state.lastDt).toBe(0.25);
    expect(first.state.lastElapsed).toBeCloseTo(0.75, 12);

    host.load(createDefinition('b', () => second.handle));
    host.update(0.1);
    expect(second.state.lastElapsed).toBeCloseTo(0.1, 12);

    // The app may supply the loop's elapsed time directly.
    host.update(0.05, 12.5);
    expect(second.state.lastDt).toBe(0.05);
    expect(second.state.lastElapsed).toBe(12.5);
  });

  it('disposes the handle and drains the registry on dispose', () => {
    const host = new SceneHost();
    const scene = createHandle();
    host.load(createDefinition('a', () => scene.handle));
    host.registry.acquireGeometry('box', () => new THREE.BoxGeometry());
    expect(host.registry.stats().geometries).toBe(1);

    host.dispose();

    expect(scene.state.disposed).toBe(1);
    expect(host.registry.stats().geometries).toBe(0);
    expect(host.content.parent).toBeNull();
  });
});

describe('SceneRegistry', () => {
  it('registers, lists in insertion order and rejects duplicates', () => {
    const registry = new SceneRegistry();
    const first = createDefinition('ward', () => createHandle().handle);
    const second = createDefinition('landscape', () => createHandle().handle);

    registry.register(first);
    registry.register(second);

    expect(registry.get('ward')).toBe(first);
    expect(registry.has('landscape')).toBe(true);
    expect(registry.list()).toEqual([first, second]);
    expect(registry.size).toBe(2);
    expect(() => registry.register(first)).toThrow('duplicate scene id "ward"');

    expect(registry.unregister('ward')).toBe(true);
    expect(registry.unregister('ward')).toBe(false);
    expect(registry.get('ward')).toBeUndefined();
    expect(registry.list()).toEqual([second]);
  });
});
