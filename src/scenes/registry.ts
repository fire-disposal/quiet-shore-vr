import type { SceneDefinition } from '../core/scene/contract';
import { shoreScene } from './shore/index';
import { washroomScene } from './washroom/index';

/**
 * Registered scenes, in registry order.
 *
 * The choice belongs to the operator, never to the patient: the tablet sends
 * `scene:<id>` over BLE, the headset stores it as the launch parameter and
 * forwards it to the page, and the page only accepts it outside a session.
 * Scene ids must stay in sync with `ControlProtocol.SCENE_IDS`, whose index
 * order is the wire contract for state byte 11 (append only).
 */
export const SCENES: readonly SceneDefinition[] = [washroomScene, shoreScene];

/** Default when nothing was chosen: the standing washroom. */
export const SCENE: SceneDefinition = washroomScene;

export function getSceneDefinition(id: string): SceneDefinition | undefined {
  for (let i = 0; i < SCENES.length; i += 1) {
    if (SCENES[i].id === id) {
      return SCENES[i];
    }
  }
  return undefined;
}
