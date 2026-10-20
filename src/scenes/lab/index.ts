import * as THREE from 'three';
import type { SceneBuildContext, SceneDefinition, SceneHandle } from '../../core/scene/contract';
import { createLegacyHandle } from '../shared/legacy-handle';
import type { LegacyWorld } from '../shared/legacy-handle';
import { createWorld } from './lab.js';

/**
 * First-class spatial UI lab. The environment is intentionally abstract; the
 * four mode panels and the control console are UI objects owned by the app.
 */
export const labScene: SceneDefinition = {
  id: 'lab',
  name: { zh: '空间实验', en: 'Spatial Lab' },
  tagline: {
    zh: '把四种空间 UI 放在同一个视野里，逐一看清边界。',
    en: 'See the four spatial UI modes side by side and probe their boundaries.'
  },
  description: {
    zh: '一个低刺激的抽象场地：地面网格、环形边界与四根立柱。四块面板分别演示召唤后锁定、跟随视角、世界锁定、世界锁定+朝向用户；下方控制台可重新布置或隐藏面板。用视线指向、短按确认键操作。',
    en: 'A low-stimulus abstract stage: grid floor, ring boundary and four pillars. Four panels demonstrate summoned, head-locked, world-locked and world-billboard modes; the lower console can re-layout or hide them. Aim with gaze and press the confirm button.'
  },
  audio: 'stream',
  build: function (ctx: SceneBuildContext): SceneHandle {
    const built = createWorld(THREE, {
      quality: ctx.quality,
      eyeHeight: ctx.eyeHeight
    }) as LegacyWorld;
    return createLegacyHandle(built, 'lab');
  }
};
