import * as THREE from 'three';

/**
 * Canvas-texture plumbing shared by every scene.
 *
 * Each scene paints its own surfaces, but the parts around the painting are
 * identical: a deterministic PRNG, a headless guard, sRGB tagging, anisotropy,
 * wrap mode and repeat. Six texture builders had drifted into six copies of
 * that boilerplate; this is the one copy.
 */

/** Deterministic PRNG (LCG) so a scene looks identical on every launch. */
export function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return function random(): number {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

export interface TextureOptions {
  /** Square size when `width`/`height` are omitted. */
  size?: number;
  width?: number;
  height?: number;
  /** Tile the texture; repeats are applied to both axes. */
  repeat?: [number, number] | null;
  anisotropy?: number;
}

/**
 * Paint a canvas and wrap it as a texture. Returns null on headless hosts (the
 * Node test environment), where callers fall back to a flat material colour.
 */
export function makeTexture(
  paint: (ctx: CanvasRenderingContext2D, width: number, height: number) => void,
  options: TextureOptions = {}
): THREE.CanvasTexture | null {
  if (typeof document === 'undefined' || !document.createElement) {
    return null;
  }
  const width = options.width ?? options.size ?? 512;
  const height = options.height ?? options.size ?? 512;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return null;
  }
  paint(ctx, width, height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = options.anisotropy ?? 4;
  if (options.repeat) {
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(options.repeat[0], options.repeat[1]);
  }
  return texture;
}
