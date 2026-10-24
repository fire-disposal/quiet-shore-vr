import type * as THREE from 'three';
import type { ResourceRegistry } from '../geometry/registry';
import type { SceneBudget } from '../geometry/budget';
import type { SceneAudio } from '../../audio/types';

export interface LocalizedText {
  zh: string;
  en: string;
}

export interface SceneSettings {
  background: THREE.Color | THREE.Texture | null;
  fog: THREE.Fog | null;
}

/**
 * Build inputs. There is deliberately no quality tier: the system targets one
 * headset, so a scene has one shape and one budget.
 */
export interface SceneBuildContext {
  eyeHeight: number;
  registry: ResourceRegistry;
}

/**
 * App-computed buoyancy for one frame. The app owns the envelope (attack,
 * release, stop); a scene that implements `applyBuoyancy` only decides *where*
 * the motion goes, which is what keeps a horizon still while the foreground
 * breathes.
 */
export interface BuoyancyState {
  /** Vertical offset in metres, signed. */
  amountM: number;
  /** Horizon pitch in degrees, signed. */
  swayDeg: number;
}

export interface SceneHandle {
  /** Everything the scene owns. Added under the host scene; never the host scene itself. */
  root: THREE.Object3D;
  selectables: THREE.Object3D[];
  settings: SceneSettings;
  update(dt: number, elapsed: number): void;
  /**
   * Optional motion cue, 0..1. Scenes that manufacture self-motion (the light
   * well) ease their environment flow towards this; the app feeds it the same
   * value that drives the posture cue, so one stop silences both.
   */
  setFlow?(flow: number): void;
  /**
   * Optional: spread the frame's buoyancy across this scene's layers.
   *
   * A global content translation moves the sky as well as the water, so the one
   * surface a supine patient looks at barely changes angle. A scene that knows
   * its own depth order can hold the dome still and move the near field, which
   * is both more visible and keeps the subjective horizon stable.
   */
  applyBuoyancy?(state: BuoyancyState): void;
  dispose(): void;
  budget?: SceneBudget;
}

export interface SceneSummary {
  id: string;
  name: LocalizedText;
  tagline: LocalizedText;
  description: LocalizedText;
  audio: SceneAudio;
}

export interface SceneDefinition extends SceneSummary {
  build(ctx: SceneBuildContext): SceneHandle;
}
