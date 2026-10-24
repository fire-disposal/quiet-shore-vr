import * as THREE from 'three';
import type { SceneDefinition, SceneHandle, SceneSettings } from '../../core/scene/contract';
import { SceneBudget, measureObject } from '../../core/geometry/budget';
import { createRoom } from './room';

/**
 * The only scene: a calm standing washroom with one wall-hung urinal.
 *
 * The patient stands where a man actually stands — 0.55 m from the wall, eye
 * at 1.7 m, bowl rim at 1.0 m — and the room is built to be believable at that
 * distance. Nothing in it is a prop: no figures, no signage, no fixtures that
 * are not in the field of view or in the way. The point is that the room
 * carries no demand, so attention stays on the body.
 *
 * Cost: seven opaque draws, ~450 triangles, no transparency, no shadows, no
 * post-processing, no full-screen pass beyond the room itself. The saved
 * budget is spent on 1.25× supersampling (see `src/core/xr/renderer.ts`).
 */

const BACKGROUND = 0xe9e5da;

export const washroomScene: SceneDefinition = {
  id: 'washroom',
  name: { zh: '洁净立便间', en: 'A Calm Washroom' },
  tagline: {
    zh: '墙面干净，光线柔和，脚下是稳的。',
    en: 'Clean walls, soft light, and a floor that holds.'
  },
  description: {
    zh: '按真人站立尺度布置的单间：正前方 0.55 米是一面浅鼠尾草色微水泥墙，墙上挂着白色陶瓷立便器，右侧一块浅橡木隔屏，脚下是暖灰石材地面，头顶一条柔和的天光。没有人物、标牌或多余设备；视线里只有这间屋子和它安静的边界。',
    en: 'A single stall at true standing scale: a pale sage micro-cement wall 0.55 m ahead with a white ceramic urinal, a light oak screen on the right, warm grey stone underfoot and one soft band of light above. No figures, no signage, no machinery; only the room and its quiet edges.'
  },
  audio: { track: 'stream', volume: 0.8, fadeMs: 1200, loop: true },
  build: function (): SceneHandle {
    const room = createRoom();

    const settings: SceneSettings = {
      background: new THREE.Color(BACKGROUND),
      // An interior needs no distance fog: the walls are two metres away.
      fog: null
    };

    const stats = measureObject(room.root);

    return {
      root: room.root,
      selectables: [],
      settings,
      budget: new SceneBudget({
        geometries: stats.geometries,
        materials: stats.materials,
        textures: stats.textures,
        drawCalls: stats.drawCalls,
        triangles: stats.triangles
      }),
      // A static room: the only motion is the patient's own.
      update: function (): void {},
      dispose: function (): void {
        room.dispose();
        settings.background = null;
        settings.fog = null;
      }
    };
  }
};
