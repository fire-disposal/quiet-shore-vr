import * as THREE from 'three';
import type { SceneBuildContext, SceneDefinition, SceneHandle } from '../../core/scene/contract';
import { createLegacyHandle } from '../shared/legacy-handle';
import type { LegacyWorld } from '../shared/legacy-handle';
import { createWorld } from './lab.js';

/**
 * Upright light chamber. The room, materials and gaze targets stay in the ES5
 * module (`lab.js`); this file only adapts it to the scene contract.
 *
 * The environment is a standing reference rather than a UI stage: every
 * vertical cue (floor grid receding into fog, tall columns, overhead halo,
 * slow rising motes) is laid out around a 1.7 m eye line so a reclined patient
 * reads the scene as upright. No panels or text are scene-owned.
 */
export const labScene: SceneDefinition = {
  id: 'lab',
  name: { zh: '直立光室', en: 'Upright Light Chamber' },
  tagline: {
    zh: '退向雾里的地面网格、高过视线的光柱与缓缓上升的尘埃，让平躺的身体重新读成站立。',
    en: 'A floor grid receding into fog, columns rising past eye level and slow rising motes let a reclined body read itself as standing.'
  },
  description: {
    zh: '按 1.7 米眼高搭建的参照空间：地面圆盘与网格一直退向雾里，八根高过视线的立柱带着竖向光带，头顶的金色光环与贯穿中轴的淡光柱给出绝对竖直；暖冷交错的尘埃沿竖直方向缓慢上升，近场浮尘随头部转动产生视差。中景三块碑状体是这里仅有的注视目标。整体刻意保持低刺激：无文字、无面板、无操作区——它不是 UI 实验台，而是一处判断“我是否站直”的身体参照。',
    en: 'A standing reference built around a 1.7 m eye line: a floor disc and grid recede into fog, eight columns rise past eye level with vertical light strips, an overhead gold halo and a faint central shaft fix an absolute vertical, and warm and cool motes drift slowly upward while near-field dust shifts with parallax as the head turns. Three mid-depth monoliths are the only gaze targets. The scene is deliberately low-stimulus, with no text, panels or controls: it is not a UI lab but a body reference for judging whether you are standing upright.'
  },
  audio: { track: 'stream', volume: 0.8, fadeMs: 1200, loop: true },
  build: function (ctx: SceneBuildContext): SceneHandle {
    const built = createWorld(THREE, {
      quality: ctx.quality,
      eyeHeight: ctx.eyeHeight
    }) as LegacyWorld;
    return createLegacyHandle(built, 'lab');
  }
};
