import * as THREE from 'three';
import type { SceneBuildContext, SceneDefinition, SceneHandle } from '../../core/scene/contract';
import { createLegacyHandle } from '../shared/legacy-handle';
import type { LegacyWorld } from '../shared/legacy-handle';
import { createWorld } from './ward.js';

/**
 * Training-ward definition. The room, lighting and gaze targets stay in the
 * ES5 module (`ward.js`); this file only adapts it to the scene contract.
 */
export const wardScene: SceneDefinition = {
  id: 'ward',
  name: { zh: '训练病区', en: 'Training Ward' },
  tagline: {
    zh: '百叶窗筛下的柔光里，一步一步熟悉病房。',
    en: 'Learn the room one calm step at a time, in the soft light by the blinds.'
  },
  description: {
    zh: '按真实尺寸布置的训练病房：铺着褶皱床品的病床、带滚动心电波形的监护仪、床旁柜与输液架，窗外百叶与布帘投下柔和日光，另有三处可注视的目标点。用于熟悉病房环境、适应注视选择与操作流程。',
    en: 'A real-scale training ward: a made bed with layered linen, a monitor with a scrolling ECG trace, bedside cabinet and IV stand, soft daylight through blinds and curtains, plus three gaze targets. Rehearse the ward and gaze-based selection before going live.'
  },
  audio: { track: 'rain', volume: 0.8, fadeMs: 1200, loop: true },
  build: function (ctx: SceneBuildContext): SceneHandle {
    const built = createWorld(THREE, {
      quality: ctx.quality,
      eyeHeight: ctx.eyeHeight
    }) as LegacyWorld;
    return createLegacyHandle(built, 'ward');
  }
};
