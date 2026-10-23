import type { SceneDefinition } from '../core/scene/contract';
import { bathroomScene } from './bathroom/index';
import { labScene } from './lab/index';
import { landscapeScene } from './landscape/index';
import { wardScene } from './ward/index';

/**
 * Registered scenes, in registry order. Adding one is an array entry plus its
 * folder; the app loads what the tablet chose and never branches on id.
 *
 * Scene ids must stay in sync with `ControlProtocol.SCENE_LABELS`, which is what
 * the tablet renders and the headset validates against.
 */
export const SCENES: readonly SceneDefinition[] = [
  bathroomScene,
  landscapeScene,
  wardScene,
  labScene
];

/** Default scene when nothing was chosen: the flagship bathroom. */
export const SCENE: SceneDefinition = bathroomScene;

export function getSceneDefinition(id: string): SceneDefinition | undefined {
  for (let i = 0; i < SCENES.length; i++) {
    if (SCENES[i].id === id) {
      return SCENES[i];
    }
  }
  return undefined;
}
