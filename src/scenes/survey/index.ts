import * as THREE from 'three';
import type { SceneSettings } from '../../core/scene/contract';
import { defineScene } from '../shared/define-scene';
import { Disposer } from '../shared/disposer';
import { lyingEyeY } from '../../core/anatomy';

/**
 * The questionnaire's own room.
 *
 * A face that asks a patient to rate their experience should not show them the
 * room the experience was about: the urinal, the lake and the ward all carry a
 * claim, and a claim in the background is an argument in a survey. This is the
 * quietest thing the renderer can draw — six planes, one soft ceiling wash, no
 * props, no signage, and **no ambience**: the questionnaire is the one face
 * with nothing playing, because a soundscape is an opinion too.
 *
 * It is `special`, so it never appears in the operator's scene picker; the app
 * face owns it and swaps it in when the pad selects 问卷.
 */

const ROOM_W = 5;
const ROOM_D = 5;
const ROOM_H = 2.6;

const WALL = 0xb9b6ae;
const FLOOR = 0x9d9a92;
const CEILING = 0xc6c3bb;
const WASH = 0xf4f2ec;

export const surveyScene = defineScene(
  {
    id: 'survey',
    special: true,
    name: { zh: '问卷环境', en: 'Questionnaire Room' },
    tagline: {
      zh: '安静的房间，没有陈设，也没有声音。',
      en: 'A quiet room: no props, no sound.'
    },
    description: {
      zh: '问卷应用专用的空房间：六面素色墙、一块柔和的天光，没有陈设、没有标牌、没有环境声。用量表时不出现任何与训练内容有关的画面或声音。',
      en: 'The questionnaire face’s own empty room: six plain surfaces and one soft ceiling wash, no props, no signage, no ambience. Nothing in it refers to the training content while a scale is being answered.'
    }
    // No `audio`: the questionnaire face is silent by design.
  },
  // Read for a body on its back, like every other scene: the room is drawn
  // around the lying eye so the first frame is already a plausible ceiling.
  { standingEyeY: 1.7, supine: 'mattress', viewer: 'supine' },
  function () {
    const root = new THREE.Group();
    root.name = 'survey-room';

    const disposer = new Disposer();
    const eyeY = lyingEyeY({ standingEyeY: 1.7, supine: 'mattress', viewer: 'supine' });
    const floorY = -eyeY;
    const ceilingY = floorY + ROOM_H;

    const wallMaterial = new THREE.MeshStandardMaterial({
      color: WALL,
      roughness: 0.92,
      metalness: 0
    });
    const floorMaterial = new THREE.MeshStandardMaterial({
      color: FLOOR,
      roughness: 0.95,
      metalness: 0
    });
    const ceilingMaterial = new THREE.MeshStandardMaterial({
      color: CEILING,
      roughness: 1,
      metalness: 0
    });
    const washMaterial = new THREE.MeshBasicMaterial({ color: WASH });
    disposer.add(wallMaterial, floorMaterial, ceilingMaterial, washMaterial);

    const wallGeometry = new THREE.PlaneGeometry(ROOM_W, ROOM_H);
    const sideGeometry = new THREE.PlaneGeometry(ROOM_D, ROOM_H);
    const floorGeometry = new THREE.PlaneGeometry(ROOM_W, ROOM_D);
    const washGeometry = new THREE.PlaneGeometry(2.2, 2.2);
    disposer.add(wallGeometry, sideGeometry, floorGeometry, washGeometry);

    const front = new THREE.Mesh(wallGeometry, wallMaterial);
    front.position.set(0, (floorY + ceilingY) / 2, -ROOM_D / 2);
    root.add(front);

    const back = new THREE.Mesh(wallGeometry, wallMaterial);
    back.position.set(0, (floorY + ceilingY) / 2, ROOM_D / 2);
    back.rotation.y = Math.PI;
    root.add(back);

    const left = new THREE.Mesh(sideGeometry, wallMaterial);
    left.position.set(-ROOM_W / 2, (floorY + ceilingY) / 2, 0);
    left.rotation.y = Math.PI / 2;
    root.add(left);

    const right = new THREE.Mesh(sideGeometry, wallMaterial);
    right.position.set(ROOM_W / 2, (floorY + ceilingY) / 2, 0);
    right.rotation.y = -Math.PI / 2;
    root.add(right);

    const floor = new THREE.Mesh(floorGeometry, floorMaterial);
    floor.position.set(0, floorY, 0);
    floor.rotation.x = -Math.PI / 2;
    root.add(floor);

    const ceiling = new THREE.Mesh(floorGeometry, ceilingMaterial);
    ceiling.position.set(0, ceilingY, 0);
    ceiling.rotation.x = Math.PI / 2;
    root.add(ceiling);

    // One wash of light, slightly off the head so the ceiling is not a flat
    // rectangle: the only thing in the room that is not a surface.
    const wash = new THREE.Mesh(washGeometry, washMaterial);
    wash.position.set(0, ceilingY - 0.02, 0);
    wash.rotation.x = Math.PI / 2;
    root.add(wash);

    const key = new THREE.DirectionalLight(0xffffff, 0.55);
    key.position.set(0.4, 2.2, 0.6);
    root.add(key);
    const fill = new THREE.HemisphereLight(0xffffff, WALL, 0.85);
    root.add(fill);

    const settings: SceneSettings = {
      background: new THREE.Color(WALL),
      fog: null
    };

    return {
      root,
      settings,
      // Nothing moves: no `update`, no `setMotion`, no `applyBuoyancy`.
      // The app still owns the posture correction and the buoyancy envelope;
      // this room simply has no opinion about either.
      dispose(): void {
        root.remove(key, fill);
        disposer.disposeAll();
        root.clear();
        root.removeFromParent();
      }
    };
  }
);
