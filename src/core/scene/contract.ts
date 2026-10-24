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
 *
 * There is no eye height here: a scene states where its eye belongs
 * (`SceneDefinition.eyeY`) and the frame places it. Passing a height in as
 * well gave two sources for the same number, and every scene ignored it.
 */
export interface SceneBuildContext {
  registry: ResourceRegistry;
}

/** Which eye the art was authored for; decides the frame a session runs in. */
export type ScenePosture = 'standing' | 'supine';

/**
 * App-computed buoyancy for one frame. The app owns the envelope (attack,
 * release, stop); a scene that implements `applyBuoyancy` only decides *where*
 * the motion goes, which is what keeps a horizon still while the foreground
 * breathes.
 */
export interface BuoyancyState {
  /** Offset in metres along `axis`, signed. */
  amountM: number;
  /** Horizon pitch in degrees, signed; 0 when the visual up is not the scene up. */
  swayDeg: number;
  /**
   * Unit vector in content space pointing along the patient's visual up. A
   * supine viewer's up is not the scene's +Y, so a scene that moves layers by
   * `amountM` alone turns the heave into a push toward the face.
   */
  axis: { x: number; y: number; z: number };
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
  /** Ambience owned by the scene; absent means the scene is silent. */
  audio?: SceneAudio;
}

export interface SceneDefinition extends SceneSummary {
  /**
   * The eye the art was authored for. `standing` scenes are laid out for a
   * viewer on their feet (a floor below them); `supine` scenes for a viewer on
   * their back (the sky above). The floating mode picks the matching world
   * frame, so neither kind is shown from the wrong eye.
   */
  posture: ScenePosture;
  /**
   * Content-space Y of that eye. The frame places the art by it, which is why
   * the app never needs a global `-eyeHeight` fudge.
   */
  eyeY: number;
  build(ctx: SceneBuildContext): SceneHandle;
}
