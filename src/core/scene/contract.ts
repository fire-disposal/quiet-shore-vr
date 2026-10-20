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

export interface SceneBuildContext {
  quality: 'high' | 'low';
  eyeHeight: number;
  registry: ResourceRegistry;
}

export interface SceneHandle {
  /** Everything the scene owns. Added under the host scene; never the host scene itself. */
  root: THREE.Object3D;
  selectables: THREE.Object3D[];
  settings: SceneSettings;
  update(dt: number, elapsed: number): void;
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
