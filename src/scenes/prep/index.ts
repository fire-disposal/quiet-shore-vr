import * as THREE from 'three';
import type { SceneSettings } from '../../core/scene/contract';
import { defineScene } from '../shared/define-scene';
import { createPlainRoom } from '../shared/plain-room';
import { Disposer } from '../shared/disposer';
import { AUTHORED_EYE_Y } from '../../core/anatomy';

/**
 * The preparation room: an empty grey space, and nothing else.
 *
 * This is the first thing a patient sees in a session. It exists so putting the
 * headset on is not also the first look at the scene the training is about:
 * there is no object to identify, no horizon to read and no motion. The
 * technician uses this stretch to settle the patient, adjust their posture and
 * record the starting orientation; only then is a real scene chosen, and the
 * world changes under a calibration that is already held.
 *
 * The room is deliberately neutral: six planes, one soft ceiling panel, no
 * textures, no props, no audio. The floor/wall junction is the only line in
 * view, which is enough to feel upright without giving the scene a subject.
 */

const ROOM_W = 6;
const ROOM_D = 6;
const ROOM_H = 2.7;

const WALL = 0x8b8e90;
const FLOOR = 0x6d7073;
const CEILING = 0x9a9d9f;
const PANEL = 0xf1f3f4;

export const prepScene = defineScene(
  {
    id: 'prep',
    // Built-in: the first surface of a session, never a card in the picker.
    special: true,
    // No motion, as the room's own description says — and declared, so the page
    // refuses a level here and the tablet's control is disabled instead of the
    // heave merely being switched off by the code that enters it.
    comfort: 0,
    name: { zh: '准备间', en: 'Preparation Room' },
    tagline: {
      zh: '空旷的灰色空间，先熟悉一下头显。',
      en: 'An empty grey room to get used to the headset.'
    },
    description: {
      zh: '一间没有陈设的灰色准备间：地面、四壁与顶面，只有头顶一块柔和的面光。没有物体、没有声音、没有运动，患者在这里适应头显、技术人员在这里调整体位并记录起始朝向；随后才切换到正式场景，校准保持不变。',
      en: 'An unfurnished grey preparation room: floor, four walls and a ceiling, with one soft panel of light overhead. No objects, no sound, no motion. The patient gets used to the headset here while the technician adjusts the posture and records the starting orientation; a real scene is chosen afterwards, with the calibration kept.'
    }
  },
  // The patient is supine, so the art is drawn from a lying eye: the floor is
  // 0.66 m below the origin and the ceiling 2.04 m above it. Starting in this
  // view means the headset is familiar before any correction is applied.
  { standingEyeY: AUTHORED_EYE_Y, supine: 'mattress', viewer: 'supine' },
  function ({ lyingEyeY: eyeY }) {
    const root = new THREE.Group();
    root.name = 'prep';
    const disposer = new Disposer();

    // Six surfaces and one soft panel, directly above the bed: a place for the
    // eye to rest that is not a feature of a room. The shell's own convention
    // (interior faces, `prep-walls` named for the mirror's cutaway) lives in
    // `createPlainRoom`.
    const room = createPlainRoom({
      width: ROOM_W,
      depth: ROOM_D,
      height: ROOM_H,
      floorY: -eyeY,
      wallColor: WALL,
      floorColor: FLOOR,
      ceilingColor: CEILING,
      namePrefix: 'prep',
      panel: { size: 1.4, insetM: 0.01, color: PANEL, name: 'prep-light' },
      disposer
    });
    root.add(room.root);

    // No shadows, no textures. Ambient keeps the down-facing ceiling from
    // reading as a black void; the hemisphere adds just enough gradient that
    // the corners still describe a room.
    const ambient = new THREE.AmbientLight(0xffffff, 0.85);
    const hemisphere = new THREE.HemisphereLight(0xf7f8f8, 0x505456, 0.45);
    root.add(ambient, hemisphere);

    const settings: SceneSettings = {
      background: new THREE.Color(0x2b2d2f),
      fog: null
    };

    return {
      root,
      settings,
      dispose(): void {
        root.remove(ambient, hemisphere);
        disposer.disposeAll();
        root.clear();
      }
    };
  }
);
