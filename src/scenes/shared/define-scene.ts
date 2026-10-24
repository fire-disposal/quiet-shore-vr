import type * as THREE from 'three';
import type {
  BuoyancyState,
  SceneDefinition,
  SceneHandle,
  ScenePosture,
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
  /** Scenes that place the buoyancy themselves instead of moving the content. */
  applyBuoyancy?: (state: BuoyancyState) => void;
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
/**
 * `placement` is the scene's own statement about which eye the art was drawn
 * for; without it the frame planner would have to guess (and it used to, with
 * one global eye height for every scene).
 */
export function defineScene(
  summary: SceneSummary,
  placement: { posture: ScenePosture; eyeY: number },
  build: () => SceneBuild
): SceneDefinition {
  return {
    ...summary,
    posture: placement.posture,
    eyeY: placement.eyeY,
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
      if (parts.applyBuoyancy) {
        handle.applyBuoyancy = parts.applyBuoyancy;
      }
      return handle;
    }
  };
}
