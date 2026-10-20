import type { SceneDefinition, SceneSummary } from '../core/scene/contract';
import { bathroomScene } from './bathroom/index';
import { labScene } from './lab/index';
import { landscapeScene } from './landscape/index';
import { wardScene } from './ward/index';

export type { SceneSummary } from '../core/scene/contract';

export const SCENES: readonly SceneDefinition[] = [
  landscapeScene,
  wardScene,
  bathroomScene,
  labScene
];

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
