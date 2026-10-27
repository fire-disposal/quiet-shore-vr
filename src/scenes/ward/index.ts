import * as THREE from 'three';
import type { SceneSettings } from '../../core/scene/contract';
import { defineScene } from '../shared/define-scene';
import { createRoom } from './room';

/**
 * The ward, from the pillow.
 *
 * This is the one scene authored *in the bed* rather than in front of it. The
 * patient is supine; the comfort layer's frame puts the scene's −Z where their
 * gaze goes when they look towards their feet, and its +Y where the ceiling is.
 * So the eye is placed at 0.85 m — the 0.55 m mattress plus a head raised on
 * the pillow — and the room is drawn around that number: the bedding fills the
 * lower field, the footboard sits at 1.6 m, the window's blind and its soft
 * daylight are 3.3 m ahead, the monitor is turned back towards the pillow at
 * 1.4 m, and the ceiling with its two recessed panels is the surface above.
 *
 * Nothing here asks anything of the patient: no figures, no signage, no
 * machinery that moves except a trace being written on a screen. The ward is
 * the room they are already in, made calm and legible — it is what to show
 * someone who needs the hospital to be recognisable rather than escaped.
 *
 * Cost: ten opaque draws plus one transparent strip, ~1.7 k triangles, five
 * canvas textures, no shadows, no post-processing, no fog (a 4.4 m room has no
 * distance to hide, and fog inside a room only greys the near wall).
 */

const BACKGROUND = 0x0b0f12;

export const wardScene = defineScene(
  {
    id: 'ward',
    name: { zh: '病房', en: 'The Ward' },
    tagline: {
      zh: '躺在自己的床上，看窗外那一点天光。',
      en: 'Lie back in your own bed and watch the daylight by the blind.'
    },
    description: {
      zh: '按仰卧视角布置的病房：眼睛在床垫上方 0.30 米（离地 0.85 米），头靠着枕头。视线里是盖着被子的床、1.6 米外的床尾板、3.3 米外挂着百叶的窗与两侧布帘投下的柔光，右前方床旁的监护仪屏幕上心率波形缓慢滚动，头顶能看到天花板与两盏嵌灯。房间里没有人物、没有标牌，床边柜与输液架放在余光里。',
      en: 'A ward built around a supine eye: 0.30 m above the mattress, 0.85 m above the floor, the head on the pillow. In view are the bedding, the footboard at 1.6 m, the window with its venetian blind and soft daylight at 3.3 m, a bedside monitor slowly writing a trace to the right, and the ceiling with two recessed panels above. No figures, no signage; the cabinet and the IV stand stay in the periphery.'
    },
    // Rain outside the window: the one sound this room would have.
    audio: { track: 'rain', volume: 0.4, fadeMs: 1200, loop: true }
  },
  // Drawn for a body on its back in the bed: mattress 0.55 m plus a head on a
  // pillow, which is what `core/anatomy.ts` derives as the lying eye.
  { standingEyeY: 1.7, supine: 'mattress', pillow: true },
  function () {
    const room = createRoom();
    const settings: SceneSettings = {
      background: new THREE.Color(BACKGROUND),
      fog: null
    };
    return {
      root: room.root,
      settings,
      // The only motion is the monitor's trace and its faint screen breath.
      update: function (dt: number, elapsed: number): void {
        room.update(dt, elapsed);
      },
      dispose: function (): void {
        room.dispose();
      }
    };
  }
);
