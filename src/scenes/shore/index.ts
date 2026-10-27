import * as THREE from 'three';
import type { BuoyancyState, SceneSettings } from '../../core/scene/contract';
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
/** Cube-deck parallax: a little motion up there, none in the dome itself. */
const CLOUD_GAIN = 0.4;
/** Independent vertical heave against the posts: ±2 cm over 22 s, a 4 cm
 *  peak-to-peak that stays inside the comfort envelope the scene test pins. */
const SWELL_M = 0.02;
const SWELL_PERIOD_S = 22;
const SWELL_TILT_RAD = 0.0004;
const SWELL_PITCH_PERIOD_S = 13;
const SWELL_ROLL_RAD = 0.0003;
const SWELL_ROLL_PERIOD_S = 23;

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
      zh: '仰卧视角的清晨湖面：头顶是渐亮的天空、缓慢漂移的云与一轮低悬的太阳，脚下方向是延伸到雾里的水面与一条柔和的日光；近处木桩固定不动，湖面缓慢涨落。',
      en: 'A lakeside morning built for a supine view: a brightening sky overhead, a slowly drifting cloud deck, a low sun, and water running into haze with a soft sun path. The near posts stay fixed while the lake rises and falls slowly.'
    },
    audio: { track: 'lake', volume: 0.4, fadeMs: 1200, loop: true, width: 0.8 }
  },
  // Drawn for a body on its back on the water: the surface is content y=0 and
  // the eye that sees the dawn sits at 1.70 m once the body stands up out of it.
  { standingEyeY: 1.7, supine: 'water' },
  function () {
    const root = new THREE.Group();
    root.name = 'shore';

    const dome = createDome();
    const water = createWater();
    const shoreline = createShoreline();
    const clouds = createClouds();

    dome.mesh.name = 'shore-dome';
    water.root.name = 'shore-water';
    shoreline.root.name = 'shore-shoreline';
    clouds.root.name = 'shore-clouds';
    root.add(dome.mesh);
    // The water sits in its own group so the lake's own swell and tilt can run
    // without fighting buoyancy, which owns `water.root.position`.
    const swell = new THREE.Group();
    swell.name = 'shore-swell';
    swell.add(water.root);
    root.add(swell);
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
        // A calm, slow rise and fall remains visible against the fixed posts.
        // The ±2 cm amplitude stays below 1°/s at the nearest 1.1 m anchor.
        swell.position.y = Math.sin((elapsed * Math.PI * 2) / SWELL_PERIOD_S) * SWELL_M;
        swell.rotation.x = Math.sin((elapsed * Math.PI * 2) / SWELL_PITCH_PERIOD_S) * SWELL_TILT_RAD;
        swell.rotation.z = Math.sin((elapsed * Math.PI * 2) / SWELL_ROLL_PERIOD_S + 1.3) * SWELL_ROLL_RAD;
      },
      /**
       * Depth-weighted buoyancy: the sky is the horizon and never moves, the
       * deck drifts a little (parallax), the water and the near shore take the
       * full amplitude. Sway goes to the same near layers, so the horizon line
       * itself stays level.
       */
      applyBuoyancy: function (state: BuoyancyState): void {
        const amount = Number.isFinite(state.amountM) ? state.amountM : 0;
        // The heave runs along the patient's visual up, not the lake's: for a
        // supine viewer those differ, and moving the near field along +Y would
        // push it toward their face instead of lifting it.
        const axis = state.axis ?? { x: 0, y: 1, z: 0 };
        clouds.root.position.set(axis.x * amount * CLOUD_GAIN, axis.y * amount * CLOUD_GAIN, axis.z * amount * CLOUD_GAIN);
        water.root.position.set(axis.x * amount, axis.y * amount, axis.z * amount);
        shoreline.root.position.set(axis.x * amount, axis.y * amount, axis.z * amount);
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
