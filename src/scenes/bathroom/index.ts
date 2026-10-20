import * as THREE from 'three';
import type { SceneBuildContext, SceneDefinition, SceneHandle } from '../../core/scene/contract';
import { createLegacyHandle } from '../shared/legacy-handle';
import type { LegacyWorld } from '../shared/legacy-handle';
import { createWorld } from './bathroom.js';

/**
 * Quiet bathroom definition. The room, materials and gaze targets stay in the
 * ES5 module (`bathroom.js`); this file only adapts it to the scene contract.
 */
export const bathroomScene: SceneDefinition = {
  id: 'bathroom',
  name: { zh: '暖石浴室', en: 'Quiet Bathroom' },
  tagline: {
    zh: '暖石与柔和的光，把门外的声音留在门外。',
    en: 'Warm stone and soft light, with the noise of the day left at the door.'
  },
  description: {
    zh: '按真实尺度布置的居家卫生间：暖米色大砖、石材地面、木质洗手台与陶瓷台盆，镜前暖光与磨砂窗透进柔和的亮，扶手与防滑垫让站立与转身更稳妥。镜子、植物与扶手三个可注视目标用于练习注视选择。',
    en: 'A real-scale home bathroom with warm large-format tile, stone floor, a timber vanity and ceramic basin. Soft light from the mirror strip and a frosted window, plus a grab bar and a slip-resistant mat for steady footing. The mirror, the plant and the grab bar are gaze targets for selection practice.'
  },
  audio: { track: 'stream', volume: 0.8, fadeMs: 1200, loop: true },
  build: function (ctx: SceneBuildContext): SceneHandle {
    const built = createWorld(THREE, {
      quality: ctx.quality,
      eyeHeight: ctx.eyeHeight
    }) as LegacyWorld;
    return createLegacyHandle(built, 'bathroom');
  }
};
