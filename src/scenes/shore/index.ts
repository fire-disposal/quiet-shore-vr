import * as THREE from 'three';
import type { SceneSettings } from '../../core/scene/contract';
import { defineScene } from '../shared/define-scene';
import { createDome } from './dome';
import { createClouds } from './clouds';
import { createWater } from './water';
import { createShoreline } from './shoreline';

/**
 * Looking up at a dawn lake. The supine scene.
 *
 * Every object earns its draw call by a cue in
 * `docs/research-standing-sensation.md`: the dome is the fixed horizon (§2.2,
 * the reference for "which way is up"), the cloud deck is overhead parallax
 * (§2.1, motion along the body axis), the water is the missing hard floor
 * (§2.1, floating over water measured 4× the vection distance of standing),
 * the sun path gives the water orientation, and the posts and reeds are the
 * near-field anchors that a 3DoF head can actually see move.
 *
 * No shore geometry, no pier, no trees, no birds, no mist banks, and no
 * in-scene particles: the app-level posture cue already owns the near-field
 * motes and drives them from the applied buoyancy.
 */

const FOG_COLOR = 0xe7d7bd;
const FOG_NEAR = 48;
const FOG_FAR = 135;

export const shoreScene = defineScene(
  {
    id: 'shore',
    name: { zh: '仰望湖面', en: 'Looking Up at the Lake' },
    tagline: {
      zh: '云慢慢走，水面一点点亮起来，呼吸跟着慢下来。',
      en: 'The clouds drift, the water brightens, and the breathing slows with it.'
    },
    description: {
      zh: '仰卧视角的清晨湖面：头顶是渐亮的天空、缓慢漂移的云与一轮低悬的太阳，脚下方向是延伸到雾里的水面与一条柔和的日光，近处有三根木桩与两丛芦苇作为参照。',
      en: 'A lakeside morning built for a supine view: a brightening sky overhead, a slowly drifting cloud deck, a low sun, and water running into haze with a soft sun path on it. Three mooring posts and two reed clumps anchor the near field.'
    },
    audio: { track: 'lake', volume: 0.8, fadeMs: 1200, loop: true }
  },
  function () {
    const root = new THREE.Group();
    root.name = 'shore';

    const dome = createDome();
    const water = createWater();
    const shoreline = createShoreline();
    const clouds = createClouds();

    root.add(dome.mesh);
    root.add(water.root);
    root.add(shoreline.root);
    root.add(clouds.root);

    const settings: SceneSettings = {
      background: new THREE.Color(FOG_COLOR),
      fog: new THREE.Fog(FOG_COLOR, FOG_NEAR, FOG_FAR)
    };

    let elapsed = 0;

    return {
      root,
      settings,
      update: function (dt: number): void {
        elapsed += dt;
        clouds.update(dt, elapsed);
      },
      dispose: function (): void {
        clouds.dispose();
        shoreline.dispose();
        water.dispose();
        dome.dispose();
        root.clear();
      }
    };
  }
);
