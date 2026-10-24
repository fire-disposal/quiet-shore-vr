import type * as THREE from 'three';
import type {
  SceneDefinition,
  SceneHandle,
  SceneSettings,
  SceneSummary
} from '../../core/scene/contract';
import { SceneBudget, measureObject } from '../../core/geometry/budget';

/**
 * What a scene builder actually has to produce. Everything else — the handle
 * shape, the measured budget, the settings teardown — is the same for every
 * scene and lives here.
 */
export interface SceneBuild {
  root: THREE.Object3D;
  settings: SceneSettings;
  update?: (dt: number, elapsed: number) => void;
  /** Only scenes that manufacture self-motion (the light well) implement this. */
  setFlow?: (flow: number) => void;
  selectables?: THREE.Object3D[];
  dispose: () => void;
}

/**
 * Wrap a builder as a `SceneDefinition`.
 *
 * The budget is measured from what the builder returned, so growth shows up as
 * a violation instead of silent drift; `dispose` releases the scene, then
 * clears the settings so a stale fog or background cannot outlive it.
 */
export function defineScene(
  summary: SceneSummary,
  build: () => SceneBuild
): SceneDefinition {
  return {
    ...summary,
    build(): SceneHandle {
      const parts = build();
      const stats = measureObject(parts.root);
      const handle: SceneHandle = {
        root: parts.root,
        selectables: parts.selectables ?? [],
        settings: parts.settings,
        budget: new SceneBudget({
          geometries: stats.geometries,
          materials: stats.materials,
          textures: stats.textures,
          drawCalls: stats.drawCalls,
          triangles: stats.triangles
        }),
        update(dt: number, elapsed: number): void {
          parts.update?.(dt, elapsed);
        },
        dispose(): void {
          parts.dispose();
          parts.settings.background = null;
          parts.settings.fog = null;
          parts.root.removeFromParent();
        }
      };
      if (parts.setFlow) {
        handle.setFlow = parts.setFlow;
      }
      return handle;
    }
  };
}
