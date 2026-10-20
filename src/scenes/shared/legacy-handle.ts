import * as THREE from 'three';
import { SceneBudget } from '../../core/geometry/budget';
import type { SceneSettings } from '../../core/scene/contract';

/** Shape returned by the two ES5 scene modules (landscape.js / ward.js). */
export interface LegacyWorld {
  /** Legacy THREE.Scene: only a carrier for background/fog and the world group. */
  scene: THREE.Scene;
  /** Every mesh and light the legacy scene authored (floor/terrain at local y = 0). */
  world: THREE.Object3D;
  update(dt: number): void;
  selectables: THREE.Object3D[];
  /** Legacy disposal walks the whole legacy scene; never call it from a handle. */
  dispose(): void;
}

/**
 * Everything under a handle root that has to be released, deduped. Unique
 * geometry/material/texture instances are the unit of GPU memory here.
 */
interface ResourceCounts {
  geometries: Set<THREE.BufferGeometry>;
  materials: Set<THREE.Material>;
  textures: Set<THREE.Texture>;
}

function addMaterial(counts: ResourceCounts, source: unknown): void {
  if (!source) {
    return;
  }
  if (Array.isArray(source)) {
    for (let i = 0; i < source.length; i++) {
      addMaterial(counts, source[i]);
    }
    return;
  }
  if (!(source instanceof THREE.Material) || counts.materials.has(source)) {
    return;
  }
  counts.materials.add(source);

  const map = (source as THREE.MeshStandardMaterial).map;
  if (map instanceof THREE.Texture) {
    counts.textures.add(map);
  }
  const uniforms = (source as THREE.ShaderMaterial).uniforms;
  if (!uniforms) {
    return;
  }
  for (const key in uniforms) {
    if (!Object.prototype.hasOwnProperty.call(uniforms, key)) {
      continue;
    }
    const value = uniforms[key] ? uniforms[key].value : null;
    if (value instanceof THREE.Texture) {
      counts.textures.add(value);
    }
  }
}

/**
 * Scene-owned budget: limits equal the measured design footprint of the legacy
 * world, so growth in geometry/material/texture count surfaces as a violation
 * instead of silently shipping.
 */
function createBudget(root: THREE.Object3D, stats: LegacyStats | undefined): SceneBudget | undefined {
  if (!stats) {
    return undefined;
  }
  const counts: ResourceCounts = {
    geometries: new Set<THREE.BufferGeometry>(),
    materials: new Set<THREE.Material>(),
    textures: new Set<THREE.Texture>()
  };
  root.traverse(function (object) {
    const geometry = (object as THREE.Mesh).geometry;
    if (geometry instanceof THREE.BufferGeometry) {
      counts.geometries.add(geometry);
    }
    addMaterial(counts, (object as THREE.Mesh).material);
  });
  return new SceneBudget({
    geometries: counts.geometries.size,
    materials: counts.materials.size,
    textures: counts.textures.size,
    drawCalls: stats.drawCalls,
    triangles: stats.triangles
  });
}

/**
 * Wrap a legacy `createWorld()` result as a `SceneHandle`.
 *
 * Ownership boundaries:
 * - `root` owns `built.world` plus anything the legacy scene parented directly
 *   (lights, helper objects); the legacy `THREE.Scene` itself is never returned.
 * - `settings` take over background/fog; the legacy scene drops its references
 *   so it cannot release host state later.
 * - `dispose()` only releases what it finds under `root` (plus a texture
 *   background); it never touches the host scene, the UI, or the legacy
 *   `dispose()` (which walks its whole scene and would cross that boundary).
 */
export function createLegacyHandle(built: LegacyWorld, name: string): HandleParts {
  const container = built.scene;
  const settings: SceneSettings = {
    background: container.background,
    fog: container.fog instanceof THREE.Fog ? container.fog : null
  };
  container.background = null;
  container.fog = null;

  const root = new THREE.Group();
  root.name = name;
  root.add(built.world);
  // Anything else the legacy scene parented directly belongs to this scene too;
  // add() re-parents it away from the legacy scene.
  while (container.children.length > 0) {
    root.add(container.children[0]);
  }

  const selectables = built.selectables.slice();
  const stats = built.world.userData ? (built.world.userData.stats as LegacyStats | undefined) : undefined;
  const budget = createBudget(root, stats);

  let disposed = false;

  function update(dt: number): void {
    if (disposed) {
      return;
    }
    // Legacy modules integrate their own elapsed clock from dt, so the host's
    // absolute `elapsed` stays unused here.
    built.update(typeof dt === 'number' && isFinite(dt) && dt > 0 ? dt : 0);
  }

  function dispose(): void {
    if (disposed) {
      return;
    }
    disposed = true;

    const counts: ResourceCounts = {
      geometries: new Set<THREE.BufferGeometry>(),
      materials: new Set<THREE.Material>(),
      textures: new Set<THREE.Texture>()
    };
    root.traverse(function (object) {
      const geometry = (object as THREE.Mesh).geometry;
      if (geometry instanceof THREE.BufferGeometry) {
        counts.geometries.add(geometry);
      }
      addMaterial(counts, (object as THREE.Mesh).material);
    });
    if (settings.background instanceof THREE.Texture) {
      counts.textures.add(settings.background);
    }

    counts.textures.forEach(function (texture) {
      texture.dispose();
    });
    counts.materials.forEach(function (material) {
      material.dispose();
    });
    counts.geometries.forEach(function (geometry) {
      geometry.dispose();
    });

    selectables.length = 0;
    settings.background = null;
    settings.fog = null;

    root.clear();
    root.removeFromParent();
  }

  return {
    root: root,
    selectables: selectables,
    settings: settings,
    update: update,
    dispose: dispose,
    budget: budget
  };
}

/** Per-scene numbers the legacy modules publish on `world.userData.stats`. */
export interface LegacyStats {
  triangles: number;
  drawCalls: number;
  meshes?: number;
  lights?: number;
  textures?: number;
  textureBytes?: number;
  quality?: string;
}

/**
 * Handle shape produced by `createLegacyHandle`. `update` accepts the host's
 * `(dt, elapsed)` signature; the legacy clock only needs `dt`.
 */
export interface HandleParts {
  root: THREE.Group;
  selectables: THREE.Object3D[];
  settings: SceneSettings;
  update(dt: number, elapsed: number): void;
  dispose(): void;
  budget: SceneBudget | undefined;
}
