import * as THREE from 'three';
import type { SceneDefinition, SceneHandle, SceneSettings } from '../../core/scene/contract';
import { SceneBudget, measureObject } from '../../core/geometry/budget';
import { createDome } from './dome';
import { createClouds } from './clouds';
import { createWater } from './water';
import { createMotes } from './motes';

/**
 * The only scene: looking up at a dawn lake.
 *
 * Built for exactly one viewer — a patient on their back, in one headset
 * (PICO G2 4K, Adreno 540, 3DoF). Everything that is only visible from a
 * standing eye line is gone: no shore geometry, no pier, no trees, no birds,
 * no mist bank. What remains is what a supine head actually sees — sky,
 * clouds overhead, water at the edge of the view, and motes rising past.
 *
 * The budget is the whole argument for the rewrite. The previous scene drew
 * 21–24 calls over 39.5k triangles with eight transparent meshes and two
 * competing sky domes; this one draws six calls over ~1k triangles with three
 * transparent passes. Frame rate on this GPU is fill-bound, so the win is
 * measured in full-screen passes per eye, not in triangles.
 */

/** Fog turns the water into the horizon; it matches the dome's horizon band. */
const FOG_COLOR = 0xe7d7bd;
const FOG_NEAR = 26;
const FOG_FAR = 105;

export const shoreScene: SceneDefinition = {
  id: 'shore',
  name: { zh: '仰望湖面', en: 'Looking Up at the Lake' },
  tagline: {
    zh: '云慢慢走，水面一点点亮起来，呼吸跟着慢下来。',
    en: 'The clouds drift, the water brightens, and the breathing slows with it.'
  },
  description: {
    zh: '仰卧视角的清晨湖面：头顶是渐亮的天空、缓慢漂移的两层云与一轮低悬的太阳，脚下方向是延伸到雾里的水面与一条细碎的日光。近场有几粒尘埃缓缓上浮，作为失重感的参照。场景没有岸线、建筑或任何需要站立观看的物体。',
    en: 'A lakeside morning built for a supine view: a brightening sky overhead, two slowly drifting cloud decks, a low sun, and water running into haze with a thin sun path on it. A few motes rise through the near field as the buoyancy cue. No shoreline, no buildings, nothing that needs a standing eye line.'
  },
  audio: { track: 'lake', volume: 0.8, fadeMs: 1200, loop: true },
  build: function (): SceneHandle {
    const root = new THREE.Group();
    root.name = 'shore';

    const dome = createDome();
    const water = createWater();
    const clouds = createClouds();
    const motes = createMotes();

    root.add(dome.mesh);
    root.add(water.root);
    root.add(clouds.root);
    root.add(motes.points);

    const settings: SceneSettings = {
      background: new THREE.Color(FOG_COLOR),
      fog: new THREE.Fog(FOG_COLOR, FOG_NEAR, FOG_FAR)
    };

    let elapsed = 0;

    const stats = measureObject(root);

    return {
      root,
      selectables: [],
      settings,
      budget: new SceneBudget({
        geometries: stats.geometries,
        materials: stats.materials,
        textures: stats.textures,
        drawCalls: stats.drawCalls,
        triangles: stats.triangles
      }),
      update: function (dt: number): void {
        elapsed += dt;
        clouds.update(dt, elapsed);
        motes.update(dt);
      },
      dispose: function (): void {
        motes.dispose();
        clouds.dispose();
        water.dispose();
        dome.dispose();
        root.clear();
        root.removeFromParent();
        settings.background = null;
        settings.fog = null;
      }
    };
  }
};
