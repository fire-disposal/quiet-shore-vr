import type { SceneDefinition } from '../core/scene/contract';
import { shoreScene } from './shore/index';

/**
 * The one scene this system ships.
 *
 * Scene switching was removed with the multi-scene era: the tablet, the
 * headset console and the boot bootstrap no longer carry a scene id, and the
 * page always loads this definition. Adding a scene again means a new folder,
 * a protocol field and a decision — not an array entry.
 */
export const SCENE: SceneDefinition = shoreScene;
