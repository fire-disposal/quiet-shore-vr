import type * as THREE from 'three';
import type { SceneBudget } from '../geometry/budget';
import type { SceneAudio } from '../../audio/types';
import type { ScenePosture } from '../anatomy';

export interface LocalizedText {
  zh: string;
  en: string;
}

export interface SceneSettings {
  background: THREE.Color | THREE.Texture | null;
  fog: THREE.Fog | null;
}

/**
 * App-computed buoyancy for one frame. The app owns the envelope (attack,
 * release, stop); a scene that implements `applyBuoyancy` only decides *where*
 * the motion goes, which is what keeps a horizon still while the foreground
 * breathes.
 */
export interface BuoyancyState {
  /** Offset in metres along `axis`, signed. */
  amountM: number;
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
  settings: SceneSettings;
  update(dt: number, elapsed: number): void;
  /**
   * Optional world-motion permission, 0..1. Scenes that manufacture their own
   * self-motion (the light well's fall) ease their speed towards this; the app
   * feeds it the **session**, never the posture: a running session may move the
   * scene, a stop, a calibration capture or an idle page may not.
   */
  setMotion?(scale: number): void;
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
   * Highest buoyancy level this scene stays comfortable at (1..3).
   *
   * The light well is pure vertical optic flow — the strongest self-motion cue
   * of the three and the one most likely to make someone queasy — so it caps
   * lower than the room or the lake. Absent means "the global maximum".
   */
  comfortLevel?: number;
  /**
   * Where the eye is for this scene: the height its art was authored from, and
   * what the patient's back rests on. The lying height is **derived** by
   * `core/anatomy.ts`, never written here, so the world's rest offset and the
   * end of a rise come from one table.
   */
  posture: ScenePosture;
  build(): SceneHandle;
}
