import type * as THREE from 'three';
import type { BudgetLimits, ResourceStats } from './types';
import { forEachMaterialTexture, renderableFields } from './dispose';

export type BudgetKind = 'geometries' | 'materials' | 'textures' | 'drawCalls' | 'triangles';

export interface BudgetViolation {
  kind: BudgetKind;
  limit: number;
  actual: number;
}

const BUDGET_KINDS: readonly BudgetKind[] = [
  'geometries',
  'materials',
  'textures',
  'drawCalls',
  'triangles'
];

/** Scratch list for `ok()` so the check itself allocates nothing per call. */
const okScratch: BudgetViolation[] = [];

/**
 * Declared resource limits for one scene. Any omitted limit is unbounded.
 * Kept free of private members so a structural object literal also satisfies
 * the `SceneBudget` contract.
 */
export class SceneBudget {
  readonly limits: BudgetLimits;

  constructor(limits: BudgetLimits = {}) {
    this.limits = { ...limits };
  }

  /** Violations for `stats`; pass `out` to reuse an array in hot loops. */
  check(stats: ResourceStats, out: BudgetViolation[] = []): BudgetViolation[] {
    out.length = 0;
    for (let i = 0; i < BUDGET_KINDS.length; i++) {
      const kind = BUDGET_KINDS[i];
      const limit = this.limits[kind];
      if (limit === undefined) continue;
      const actual = stats[kind];
      if (actual > limit) out.push({ kind, limit, actual });
    }
    return out;
  }

  ok(stats: ResourceStats): boolean {
    return this.check(stats, okScratch).length === 0;
  }
}

/**
 * Measure what a subtree would actually render.
 *
 * Invisible subtrees are skipped entirely (three.js does not draw them).
 * Draw calls follow material groups: a mesh with a material array issues one
 * draw per material. Instanced meshes count their instance count in the
 * triangle total but still cost a single draw call.
 */
export function measureObject(root: THREE.Object3D): ResourceStats {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  let drawCalls = 0;
  let triangles = 0;

  const stack: THREE.Object3D[] = [root];
  while (stack.length > 0) {
    const object = stack.pop() as THREE.Object3D;
    if (!object.visible) continue;

    const fields = renderableFields(object);
    const geometry = fields.geometry;
    if (geometry) geometries.add(geometry);

    const material = fields.material;
    if (Array.isArray(material)) {
      drawCalls += material.length;
      for (let i = 0; i < material.length; i++) materials.add(material[i]);
    } else if (material) {
      drawCalls += 1;
      materials.add(material);
    }

    if (fields.isMesh === true && geometry) {
      const position = geometry.getAttribute('position');
      if (position) {
        const count = geometry.index ? geometry.index.count : position.count;
        const instances = fields.isInstancedMesh === true ? Math.max(1, fields.count ?? 1) : 1;
        triangles += Math.floor(count / 3) * instances;
      }
    }

    const children = object.children;
    for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]);
  }

  materials.forEach((material) => {
    forEachMaterialTexture(material, (texture) => textures.add(texture));
  });

  return {
    geometries: geometries.size,
    materials: materials.size,
    textures: textures.size,
    drawCalls,
    triangles
  };
}
