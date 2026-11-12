import * as THREE from 'three';
import type { SceneSettings } from '../../core/scene/contract';
import { defineScene } from '../shared/define-scene';
import { Disposer } from '../shared/disposer';
import { lyingEyeY } from '../../core/anatomy';

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
const HALF_W = ROOM_W / 2;
const HALF_D = ROOM_D / 2;

const WALL = 0x8b8e90;
const FLOOR = 0x6d7073;
const CEILING = 0x9a9d9f;
const PANEL = 0xf1f3f4;

export const prepScene = defineScene(
  {
    id: 'prep',
    // Built-in: the first surface of a session, never a card in the picker.
    special: true,
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
  { standingEyeY: 1.7, supine: 'mattress', viewer: 'supine' },
  function () {
    const root = new THREE.Group();
    root.name = 'prep';
    const disposer = new Disposer();
    const eyeY = lyingEyeY({ standingEyeY: 1.7, supine: 'mattress', viewer: 'supine' });
    const floorY = -eyeY;
    const ceilingY = floorY + ROOM_H;

    const wallMaterial = new THREE.MeshStandardMaterial({
      color: WALL,
      roughness: 1,
      metalness: 0
    });
    const floorMaterial = new THREE.MeshStandardMaterial({
      color: FLOOR,
      roughness: 1,
      metalness: 0
    });
    const ceilingMaterial = new THREE.MeshStandardMaterial({
      color: CEILING,
      roughness: 1,
      metalness: 0
    });
    const panelMaterial = new THREE.MeshBasicMaterial({ color: PANEL });
    disposer.add(wallMaterial, floorMaterial, ceilingMaterial, panelMaterial);

    const wallGeometry = new THREE.PlaneGeometry(ROOM_W, ROOM_H);
    const sideGeometry = new THREE.PlaneGeometry(ROOM_D, ROOM_H);
    const floorGeometry = new THREE.PlaneGeometry(ROOM_W, ROOM_D);
    const panelGeometry = new THREE.PlaneGeometry(1.4, 1.4);
    disposer.add(wallGeometry, sideGeometry, floorGeometry, panelGeometry);

    // Interior faces only: each plane is turned towards the eye.
    // The mirror hides meshes named `-walls` when its camera steps outside the
    // room; an unnamed shell would leave the operator looking at a closed grey
    // box with no patient in it.
    const front = new THREE.Mesh(wallGeometry, wallMaterial);
    front.name = 'prep-walls';
    front.position.set(0, (floorY + ceilingY) / 2, -HALF_D);
    const back = new THREE.Mesh(wallGeometry, wallMaterial);
    back.name = 'prep-walls';
    back.position.set(0, (floorY + ceilingY) / 2, HALF_D);
    back.rotation.y = Math.PI;
    const left = new THREE.Mesh(sideGeometry, wallMaterial);
    left.name = 'prep-walls';
    left.position.set(-HALF_W, (floorY + ceilingY) / 2, 0);
    left.rotation.y = Math.PI / 2;
    const right = new THREE.Mesh(sideGeometry, wallMaterial);
    right.name = 'prep-walls';
    right.position.set(HALF_W, (floorY + ceilingY) / 2, 0);
    right.rotation.y = -Math.PI / 2;
    const floor = new THREE.Mesh(floorGeometry, floorMaterial);
    floor.name = 'prep-floor';
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, floorY, 0);
    const ceiling = new THREE.Mesh(floorGeometry, ceilingMaterial);
    ceiling.name = 'prep-ceiling';
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.set(0, ceilingY, 0);
    // One soft panel, directly above the bed: a place for the eye to rest that
    // is not a feature of a room.
    const panel = new THREE.Mesh(panelGeometry, panelMaterial);
    panel.name = 'prep-light';
    panel.rotation.x = Math.PI / 2;
    panel.position.set(0, ceilingY - 0.01, 0);
    root.add(front, back, left, right, floor, ceiling, panel);

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
