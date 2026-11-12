import type { SceneDefinition } from '../core/scene/contract';
import { prepScene } from './prep/index';
import { shoreScene } from './shore/index';
import { wardScene } from './ward/index';
import { washroomScene } from './washroom/index';

/**
 * Registered scenes, in registry order.
 *
 * The choice belongs to the operator, never to the patient: the tablet sends
 * `scene:<id>` over BLE, the headset stores it as the launch parameter and
 * forwards it to the page, and the page only accepts it outside a session.
 * This registry is the catalogue's source; its order is the state frame's
 * 4-bit index, so entries are append-only. Neither Android app keeps a second
 * table of ids, copy or caps.
 */
export const SCENES: readonly SceneDefinition[] = [
  washroomScene,
  shoreScene,
  wardScene,
  // Appended, never inserted: the state frame's 4-bit index is this order.
  prepScene
];

/**
 * Default when nothing was chosen: the preparation room. A session starts with
 * the patient getting used to the headset in an empty grey space; the operator
 * records the posture there and only then selects a real scene.
 */
export const SCENE: SceneDefinition = prepScene;

export function getSceneDefinition(id: string): SceneDefinition | undefined {
  for (let i = 0; i < SCENES.length; i += 1) {
    if (SCENES[i].id === id) {
      return SCENES[i];
    }
  }
  return undefined;
}
