import * as THREE from 'three';

/**
 * Resource teardown for arbitrary Object3D subtrees.
 *
 * Disposal is deduplicated: a resource shared by several meshes is released
 * once, and disposing the same object twice never calls `dispose()` twice.
 */

const disposedGeometries = new WeakSet<THREE.BufferGeometry>();
const disposedMaterials = new WeakSet<THREE.Material>();
const disposedTextures = new WeakSet<THREE.Texture>();

interface RenderableHolder {
  geometry?: THREE.BufferGeometry;
  material?: THREE.Material | THREE.Material[];
  isMesh?: boolean;
  isPoints?: boolean;
  isLine?: boolean;
  isSprite?: boolean;
  isInstancedMesh?: boolean;
  count?: number;
}

/** Expose the renderable fields of a node without an instanceof cascade. */
export function renderableFields(object: THREE.Object3D): RenderableHolder {
  return object as unknown as RenderableHolder;
}

/**
 * Visit every texture a material references, including arrays, common map
 * slots and ShaderMaterial uniforms. Iterating own+prototype fields keeps this
 * independent of the ever-growing slot list in newer three releases.
 */
export function forEachMaterialTexture(
  material: THREE.Material,
  visit: (texture: THREE.Texture) => void
): void {
  const fields = material as unknown as Record<string, unknown>;
  for (const key in fields) {
    const value = fields[key];
    if (value && (value as THREE.Texture).isTexture === true) {
      visit(value as THREE.Texture);
    }
  }
  const uniforms = fields.uniforms as Record<string, { value?: unknown }> | undefined;
  if (!uniforms) return;
  for (const name in uniforms) {
    const value = uniforms[name]?.value;
    if (value && (value as THREE.Texture).isTexture === true) {
      visit(value as THREE.Texture);
    }
  }
}

/**
 * Dispose every geometry/material/texture under `root`.
 *
 * Materials are disposed once; their textures are collected and disposed once
 * as well. The hierarchy itself is left intact so callers decide when to
 * detach the subtree from the scene graph.
 */
export function disposeObject3D(root: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();

  root.traverse((object) => {
    const fields = renderableFields(object);
    if (fields.geometry) geometries.add(fields.geometry);
    const material = fields.material;
    if (Array.isArray(material)) {
      for (let i = 0; i < material.length; i++) materials.add(material[i]);
    } else if (material) {
      materials.add(material);
    }
  });

  materials.forEach((material) => {
    forEachMaterialTexture(material, (texture) => textures.add(texture));
  });

  geometries.forEach((geometry) => {
    if (disposedGeometries.has(geometry)) return;
    disposedGeometries.add(geometry);
    geometry.dispose();
  });
  materials.forEach((material) => {
    if (disposedMaterials.has(material)) return;
    disposedMaterials.add(material);
    material.dispose();
  });
  textures.forEach((texture) => {
    if (disposedTextures.has(texture)) return;
    disposedTextures.add(texture);
    texture.dispose();
  });
}
