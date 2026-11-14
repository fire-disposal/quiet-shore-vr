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
 * release, stop) **and** where it goes; a scene only says which of its nodes
 * belong to the backdrop. Kept as a shape because the transport and the mirror
 * both read it.
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

/** Stable manual-control surface exposed by every built scene. */
export interface SceneControls {
  /** Scale scene-authored motion, 0..1. Static scenes accept and ignore it. */
  setMotion(scale: number): void;
}

export interface SceneHandle {
  /** Everything the scene owns. Added under the host scene; never the host scene itself. */
  root: THREE.Object3D;
  /**
   * The part of the scene that must not move with the heave — sky, horizon,
   * far layers. Added under the host's backdrop group, which is mounted inside
   * the comfort frame so it follows calibration, posture and world rotation;
   * only the bob is withheld.
   */
  backdrop: THREE.Object3D | null;
  settings: SceneSettings;
  update(dt: number, elapsed: number): void;
  /** The only scene-level control entry point used by the application. */
  controls: SceneControls;
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
  /**
   * Built-in infrastructure rather than an operator-facing room. The
   * preparation space is the only one: it is the session's first surface, not
   * a card in the scene picker.
   */
  readonly special?: boolean;
}

export interface SceneDefinition extends SceneSummary {
  /**
   * Where the eye is for this scene: the height its art was authored from, and
   * what the patient's back rests on. The lying height is **derived** by
   * `core/anatomy.ts`, never written here, so the world's rest offset and the
   * end of a rise come from one table.
   */
  posture: ScenePosture;
  build(): SceneHandle;
}
