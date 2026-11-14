import * as THREE from 'three';
import type { SceneSettings } from '../../core/scene/contract';
import { defineScene } from '../shared/define-scene';
import { AUTHORED_EYE_Y } from '../../core/anatomy';
import { createDome } from '../shore/dome';
import { createClouds } from '../shore/clouds';
import { createWater } from '../shore/water';
import { createShoreline } from '../shore/shoreline';

/**
 * APP2's quiet lakeside, recovered from the v1 shore scene. The component
 * files are byte-identical to that release. Motion and ambience are deliberately
 * absent: the lake is a readable backdrop, not a second intervention.
 */
const FOG_COLOR = 0xe7d7bd;
const SHORE_DROP_M = 0.26;
const FOG_NEAR = 48;
const FOG_FAR = 135;

export const surveyScene = defineScene(
  {
    id: 'survey',
    special: true,
    comfort: 0,
    name: { zh: '湖边问卷', en: 'Lakeside Questionnaire' },
    tagline: {
      zh: 'v1 的清晨湖边，作为安静的问卷背景。',
      en: 'The v1 dawn lake as a quiet questionnaire backdrop.'
    },
    description: {
      zh: '问卷应用使用 v1 湖边场景的天空、云、水面和近岸木桩。没有环境声，没有水面自运动，题目与注视选项位于前景。',
      en: 'The v1 sky, clouds, water and near-shore posts form the questionnaire backdrop. There is no ambience or scene motion.'
    }
  },
  { standingEyeY: AUTHORED_EYE_Y, supine: 'water', viewer: 'supine' },
  function () {
    const root = new THREE.Group();
    root.name = 'survey-shore';
    root.position.y = -SHORE_DROP_M;

    const dome = createDome();
    const water = createWater();
    const shoreline = createShoreline();
    const clouds = createClouds();

    dome.mesh.name = 'survey-dome';
    water.root.name = 'survey-water';
    shoreline.root.name = 'survey-shoreline';
    clouds.root.name = 'survey-clouds';
    root.add(dome.mesh, water.root, shoreline.root, clouds.root);

    const settings: SceneSettings = {
      background: new THREE.Color(FOG_COLOR),
      fog: new THREE.Fog(FOG_COLOR, FOG_NEAR, FOG_FAR)
    };

    return {
      root,
      settings,
      dispose(): void {
        clouds.dispose();
        shoreline.dispose();
        water.dispose();
        dome.dispose();
        root.clear();
        root.removeFromParent();
      }
    };
  }
);
