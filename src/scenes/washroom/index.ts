import * as THREE from 'three';
import type { SceneSettings } from '../../core/scene/contract';
import { defineScene } from '../shared/define-scene';
import { createRoom } from './room';

/**
 * A calm washroom with one wall-hung urinal, authored for a **simulated**
 * standing eye line: the patient is supine in bed and the comfort layer
 * rotates the world, so the room must be believable at 1.7 m — not that the
 * patient is upright.
 *
 * Nothing in it is a prop: no figures, no signage, no fixtures that are not in
 * the field of view or in the way. The point is that the room carries no
 * demand, so attention stays on the body.
 *
 * Cost: seven opaque draws, no transparency, no shadows, no post-processing,
 * no full-screen pass beyond the room itself.
 */

const BACKGROUND = 0xe9e5da;

export const washroomScene = defineScene(
  {
    id: 'washroom',
    name: { zh: '洁净立便间', en: 'A Calm Washroom' },
    tagline: {
      zh: '墙面干净，光线柔和，脚下是稳的。',
      en: 'Clean walls, soft light, and a floor that holds.'
    },
    description: {
      zh: '按真人站立尺度布置的单间：正前方 0.85 米是一面浅鼠尾草色微水泥墙，墙上挂着白色陶瓷立便器，右侧一块浅橡木隔屏，脚下是暖灰石材地面，头顶一条柔和的天光。没有人物、标牌或多余设备；视线里只有这间屋子和它安静的边界。',
      en: 'A single stall at true standing scale: a pale sage micro-cement wall 0.85 m ahead with a white ceramic urinal, a light oak screen on the right, warm grey stone underfoot and one soft band of light above. No figures, no signage, no machinery; only the room and its quiet edges.'
    },
    // A small tiled room: the water reads close and narrow, not open.
    audio: { track: 'stream', volume: 0.8, fadeMs: 1200, loop: true, width: 0.35 }
  },
  function () {
    const room = createRoom();
    const settings: SceneSettings = {
      background: new THREE.Color(BACKGROUND),
      // An interior needs no distance fog: the walls are two metres away.
      fog: null
    };
    return {
      root: room.root,
      settings,
      // A static room: the only motion is the patient's own.
      dispose: function (): void {
        room.dispose();
      }
    };
  }
);
