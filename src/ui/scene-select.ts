export type SceneId = 'landscape' | 'ward' | 'bathroom';

export const DEFAULT_SCENE: SceneId = 'landscape';
export const SCENE_STORAGE_KEY = 'quietshore.scene.v1';
export const LEGACY_SCENE_STORAGE_KEY = 'stillwater.scene.v1';

export function normalizeSceneId(value: string | null | undefined): SceneId | null {
  return value === 'landscape' || value === 'ward' || value === 'bathroom' ? value : null;
}

/** New key wins; a legacy draft key is migrated once and then ignored. */
export function readStoredScene(): SceneId | null {
  try {
    const current = normalizeSceneId(window.localStorage.getItem(SCENE_STORAGE_KEY));
    if (current) {
      return current;
    }
    const legacy = normalizeSceneId(window.localStorage.getItem(LEGACY_SCENE_STORAGE_KEY));
    if (legacy) {
      window.localStorage.setItem(SCENE_STORAGE_KEY, legacy);
      return legacy;
    }
    return null;
  } catch {
    return null;
  }
}

export function storeScene(id: SceneId): void {
  try {
    window.localStorage.setItem(SCENE_STORAGE_KEY, id);
  } catch {
    // Storage can be disabled; the selection lasts for this page load.
  }
}
