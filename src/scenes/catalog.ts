import type { LocalizedText, SceneDefinition } from '../core/scene/contract';
import { SCENES } from './registry';

/**
 * One scene as every consumer outside the page sees it.
 *
 * The registry is the only place a scene is declared; this mapping is the only
 * place it becomes wire data. The headset APK ships the result as
 * `assets/catalog.json`, the tablet receives the same list on the JSON channel,
 * and neither keeps a second table of ids, names or taglines.
 *
 * `id` order is part of the contract: the state frame still carries a 4-bit
 * scene index, so entries are append-only. Moving one changes what an old
 * tablet thinks is playing.
 */
export interface SceneCatalogEntry {
  id: string;
  name: LocalizedText;
  tagline: LocalizedText;
  /** Highest buoyancy level this scene stays comfortable at; null = global max. */
  comfortLevel: number | null;
  /** True for the built-in preparation space, which is not an operator choice. */
  special: boolean;
}

export function catalogEntries(
  scenes: readonly SceneDefinition[] = SCENES
): SceneCatalogEntry[] {
  return scenes.map((scene) => ({
    id: scene.id,
    name: scene.name,
    tagline: scene.tagline,
    comfortLevel: scene.comfortLevel ?? null,
    special: scene.special === true
  }));
}
