import * as THREE from 'three';
import type { SceneBuildContext, SceneDefinition, SceneHandle } from '../../core/scene/contract';
import { createLegacyHandle } from '../shared/legacy-handle';
import type { LegacyWorld } from '../shared/legacy-handle';
import { createWorld } from './bathroom.js';

/**
 * Ward bathroom definition. The room, materials and gaze targets stay in the
 * ES5 module (`bathroom.js`); this file only adapts it to the scene contract.
 * The toilet is centred on the back wall directly ahead of the patient at the
 * local origin, with accessible grab bars and an emergency call cord.
 */
export const bathroomScene: SceneDefinition = {
  id: 'bathroom',
  name: { zh: '病房卫生间', en: 'Ward Bathroom' },
  tagline: {
    zh: '马桶就在正前方，扶手与呼叫绳让站立转身更安心。',
    en: 'The toilet sits directly ahead, with grab bars and a call cord close at hand.'
  },
  description: {
    zh: '按病房尺度布置的无障碍卫生间：坐便器位于后墙正中、正对患者站位，两侧连续扶手、拉绳呼叫面板、卫生纸架、污物桶与免洗消毒液都在伸手可及的范围内。浅鼠尾草墙砖、防滑地面、白色陶瓷、拉丝不锈钢与浅橡木构成安静的临床色调，镜前柔光与磨砂窗透进暖白日光。镜子、扶手与呼叫按钮三个可注视目标用于练习注视选择。',
    en: 'An accessible ward bathroom in real scale: the toilet is centred on the back wall directly in front of the patient, flanked by continuous grab bars, with a pull-cord call unit, paper holder, sanitary bin and hand sanitizer within reach. Pale sage tile, a non-slip floor, white ceramic, brushed stainless and light oak keep the palette calm and clinical, while soft mirror light and a frosted window bring in warm daylight. The mirror, the grab bar and the call button are the three gaze targets for selection practice.'
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
