import * as THREE from 'three';
import type { SceneBuildContext, SceneDefinition, SceneHandle } from '../../core/scene/contract';
import { createLegacyHandle } from '../shared/legacy-handle';
import type { LegacyWorld } from '../shared/legacy-handle';
import { createWorld } from './landscape.js';

/**
 * Shoreside definition. The visual algorithm stays in the ES5 module
 * (`landscape.js`); this file only adapts it to the scene contract.
 */
export const landscapeScene: SceneDefinition = {
  id: 'landscape',
  name: { zh: '湖畔晨岸', en: 'Lakeside Shore' },
  tagline: {
    zh: '看水面一点点亮起来，呼吸随之变慢。',
    en: 'Watch the water brighten and let your breathing slow down.'
  },
  description: {
    zh: '清晨的湖岸：远山薄雾、芦苇、木栈桥与低飞的水鸟，阳光在水面拉出一条细碎的波光。柔和的天光和水声适合放松与注意力恢复练习。',
    en: 'A lakeside at sunrise with misted ridges, reeds, a timber pier and low-flying birds, and a glittering path of sunlight across the water. Soft light and lapping water support relaxation and attention-restoration practice.'
  },
  audio: { track: 'lake', volume: 0.8, fadeMs: 1200, loop: true },
  build: function (ctx: SceneBuildContext): SceneHandle {
    const built = createWorld(THREE, {
      quality: ctx.quality,
      eyeHeight: ctx.eyeHeight
    }) as LegacyWorld;
    return createLegacyHandle(built, 'landscape');
  }
};
