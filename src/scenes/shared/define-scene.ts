import type * as THREE from 'three';
import type {
  SceneDefinition,
  SceneHandle,
  SceneSettings,
  SceneSummary
} from '../../core/scene/contract';
import { SceneBudget, measureObject } from '../../core/geometry/budget';
import { disposeObject3D } from '../../core/geometry/dispose';
import { lyingEyeY, type ScenePosture } from '../../core/anatomy';

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
  /** Geometry that belongs to the weather, not the world: it never bobs. */
  backdrop?: THREE.Object3D;
  dispose: () => void;
}

/**
 * The eye the art is drawn around, derived from the scene's own posture.
 *
 * Handed to the builder instead of letting each scene re-type its posture
 * literal: two copies of `{ supine: 'mattress', pillow: … }` are two chances to
 * disagree, and the floor line they set is what every prop is positioned from.
 */
export interface AuthoredEye {
  /** Lying eye height, metres above the scene's own floor line. */
  readonly lyingEyeY: number;
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
 * scene). The lying height is derived from that statement once, here, and
 * handed to the builder — never re-typed inside a scene.
 */
export function defineScene(
  summary: SceneSummary & { comfort?: number },
  posture: ScenePosture,
  build: (eye: AuthoredEye) => SceneBuild
): SceneDefinition {
  return {
    ...summary,
    posture,
    special: summary.special === true,
    comfort: summary.comfort,
    build(): SceneHandle {
      const parts = build({ lyingEyeY: lyingEyeY(posture) });
      const stats = measureObject(parts.root);
      const handle: SceneHandle = {
        root: parts.root,
        backdrop: parts.backdrop ?? null,
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
        controls: {
          setMotion(scale: number): void {
            parts.setMotion?.(Math.min(1, Math.max(0, scale)));
          }
        },
        dispose(): void {
          // The scene releases what it owns; anything left (instanced buffers,
          // textures a material still holds) is released here, once.
          parts.dispose();
          if (parts.backdrop) {
            disposeObject3D(parts.backdrop);
            parts.backdrop.removeFromParent();
          }
          disposeObject3D(parts.root);
          parts.settings.background = null;
          parts.settings.fog = null;
          parts.root.removeFromParent();
        }
      };
      return handle;
    }
  };
}
