export type SceneId = 'landscape' | 'ward' | 'bathroom' | 'lab';

export const DEFAULT_SCENE: SceneId = 'landscape';
export const SCENE_STORAGE_KEY = 'quietshore.scene.v1';

export function normalizeSceneId(value: string | null | undefined): SceneId | null {
  return value === 'landscape'
    || value === 'ward'
    || value === 'bathroom'
    || value === 'lab'
    ? value
    : null;
}

export function readStoredScene(): SceneId | null {
  try {
    return normalizeSceneId(window.localStorage.getItem(SCENE_STORAGE_KEY));
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
