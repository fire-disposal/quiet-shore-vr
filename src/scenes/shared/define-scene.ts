import type * as THREE from 'three';
import type {
  BuoyancyState,
  SceneDefinition,
  SceneHandle,
  SceneSettings,
  SceneSummary
} from '../../core/scene/contract';
import { SceneBudget, measureObject } from '../../core/geometry/budget';
import { disposeObject3D } from '../../core/geometry/dispose';
import type { ScenePosture } from '../../core/anatomy';

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
  setMotion?: (scale: number) => void;
  /** Scenes that place the buoyancy themselves instead of moving the content. */
  applyBuoyancy?: (state: BuoyancyState) => void;
  dispose: () => void;
}

/**
 * Wrap a builder as a `SceneDefinition`.
 *
 * The budget is measured from what the builder returned, so growth shows up as
 * a violation instead of silent drift; `dispose` releases the scene, then
 * clears the settings so a stale fog or background cannot outlive it.
 *
 * `posture` is the scene's own statement about its eye; without it the frame
 * would have to guess (and it used to, with one global eye height for every
 * scene). The lying height is derived from that statement, never passed in.
 */
export function defineScene(
  summary: SceneSummary & { comfortLevel?: number; heaveScale?: number },
  posture: ScenePosture,
  build: () => SceneBuild
): SceneDefinition {
  return {
    ...summary,
    posture,
    comfortLevel: summary.comfortLevel,
    heaveScale: summary.heaveScale,
    build(): SceneHandle {
      const parts = build();
      const stats = measureObject(parts.root);
      const handle: SceneHandle = {
        root: parts.root,
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
          // The scene releases what it owns; anything left (instanced buffers,
          // textures a material still holds) is released here, once.
          parts.dispose();
          disposeObject3D(parts.root);
          parts.settings.background = null;
          parts.settings.fog = null;
          parts.root.removeFromParent();
        }
      };
      if (parts.setMotion) {
        handle.setMotion = parts.setMotion;
      }
      if (parts.applyBuoyancy) {
        handle.applyBuoyancy = parts.applyBuoyancy;
      }
      return handle;
    }
  };
}
