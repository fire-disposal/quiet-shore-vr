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
    zh: '在安静的病房里，跟着提示熟悉每一个动作。',
    en: 'Get to know each step, one calm instruction at a time.'
  },
  description: {
    zh: '按真实尺寸布置的病房：病床、监护仪、床旁柜、输液架与窗边冷光，外加三个可注视的目标点。用于熟悉病房环境、适应注视选择与操作流程。',
    en: 'A real-scale patient room with bed, monitor, bedside cabinet, IV stand and cool window light, plus three gaze targets. Rehearse the ward environment and gaze-based selection before going live.'
  },
  audio: 'rain',
  build: function (ctx: SceneBuildContext): SceneHandle {
    const built = createWorld(THREE, {
      quality: ctx.quality,
      eyeHeight: ctx.eyeHeight
    }) as LegacyWorld;
    return createLegacyHandle(built, 'ward');
  }
};
