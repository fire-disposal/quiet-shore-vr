import type { AudioTrack } from '../audio/types';
import type { LocalizedText, SceneDefinition } from '../core/scene/contract';
import { landscapeScene } from './landscape/index';
import { wardScene } from './ward/index';

/** Card-sized view of a scene for 2D and XR menus. */
export interface SceneSummary {
  id: string;
  name: LocalizedText;
  tagline: LocalizedText;
  description: LocalizedText;
  audio: AudioTrack;
}

export const SCENES: readonly SceneDefinition[] = [landscapeScene, wardScene];

export function getSceneDefinition(id: string): SceneDefinition | undefined {
  for (let i = 0; i < SCENES.length; i++) {
    if (SCENES[i].id === id) {
      return SCENES[i];
    }
  }
  return undefined;
}

/** Menu metadata, in stable registry order; scene-heavy fields stay behind `getSceneDefinition`. */
export function listScenes(): SceneSummary[] {
  return SCENES.map(function (scene) {
    return {
      id: scene.id,
      name: scene.name,
      tagline: scene.tagline,
      description: scene.description,
      audio: scene.audio
    };
  });
}
