import * as THREE from 'three';
import type { SceneBuildContext, SceneDefinition, SceneHandle } from '../../core/scene/contract';
import { SceneBudget, measureObject } from '../../core/geometry/budget';
import { createLegacyHandle } from '../shared/legacy-handle';
import type { LegacyWorld } from '../shared/legacy-handle';
import { createSkyLayer } from './sky';
import { createWorld } from './landscape.js';

/**
 * Lakeside definition.
 *
 * The visual algorithm stays in the ES5 module (`landscape.js`, built for a
 * standing viewer at the shore). A supine patient looks up instead, so the
 * overhead layer from `sky.ts` is added on top: the ground art is what they see
 * when they tilt down, the sky is what they see at rest.
 */
export const landscapeScene: SceneDefinition = {
  id: 'landscape',
  name: { zh: '湖畔晨岸', en: 'Lakeside Shore' },
  tagline: {
    zh: '看水面一点点亮起来，呼吸随之变慢。',
    en: 'Watch the water brighten and let your breathing slow down.'
  },
  description: {
    zh: '清晨的湖岸：远山薄雾、芦苇、木栈桥与低飞的水鸟，阳光在水面拉出一条细碎的波光。天顶有缓慢漂移的云层，供仰卧时观看。',
    en: 'A lakeside at sunrise with misted ridges, reeds, a timber pier and low-flying birds, plus a slow cloud deck overhead for supine viewing.'
  },
  audio: { track: 'lake', volume: 0.8, fadeMs: 1200, loop: true },
  build: function (ctx: SceneBuildContext): SceneHandle {
    const built = createWorld(THREE, {
      quality: ctx.quality,
      eyeHeight: ctx.eyeHeight
    }) as LegacyWorld;
    const base = createLegacyHandle(built, 'landscape');
    const sky = createSkyLayer();
    base.root.add(sky.root);
    // The legacy module keeps its own clock and does not expose it, so the sky
    // integrates its own drift from the same dt.
    let skyElapsed = 0;

    // The budget is the measured footprint of what ships, sky included, so a
    // later addition surfaces as a violation instead of silent drift.
    const stats = measureObject(base.root);
    const budget = new SceneBudget({
      geometries: stats.geometries,
      materials: stats.materials,
      textures: stats.textures,
      drawCalls: stats.drawCalls,
      triangles: stats.triangles
    });

    return {
      root: base.root,
      selectables: base.selectables,
      settings: base.settings,
      budget: budget,
      update: function (dt: number, elapsed: number): void {
        base.update(dt, elapsed);
        skyElapsed += dt;
        sky.update(dt, skyElapsed);
      },
      dispose: function (): void {
        sky.dispose();
        base.dispose();
      }
    };
  }
};
