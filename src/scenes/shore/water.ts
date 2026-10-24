import * as THREE from 'three';

/**
 * The lake, as one opaque quad: a baked gradient from deep water at the
 * patient's feet to haze at the far shore, with the sun's path drawn into a
 * separate additive strip.
 *
 * Nothing here animates. Ripples drawn as per-pixel sine in a shader shimmer
 * badly at 20 px/deg without MSAA, and the patient's motion is the head's, not
 * the water's; clouds already carry the only motion the scene needs.
 */

const WATER_SIZE = 420;
const GLITTER_LENGTH = 150;
const GLITTER_WIDTH = 5.5;

export interface WaterLayer {
  root: THREE.Group;
  dispose(): void;
}

/** Canvas top row is v = 1: the far shore. Bottom is the water at the feet. */
function waterTexture(): THREE.CanvasTexture | null {
  if (typeof document === 'undefined' || !document.createElement) {
    return null;
  }
  const width = 256;
  const height = 512;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return null;
  }
  const ramp = ctx.createLinearGradient(0, 0, 0, height);
  ramp.addColorStop(0.0, '#E3D3B6');
  ramp.addColorStop(0.16, '#B9B39E');
  ramp.addColorStop(0.4, '#7C8C82');
  ramp.addColorStop(0.68, '#4C655F');
  ramp.addColorStop(1.0, '#2C423F');
  ctx.fillStyle = ramp;
  ctx.fillRect(0, 0, width, height);

  // Banded ripple hints: low contrast, mipmapped, so they never sparkle.
  let seed = 7;
  const random = (): number => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 140; i += 1) {
    const y = height * (0.2 + random() * 0.78);
    const depthFade = (y / height) * 0.09;
    const x = random() * width;
    const len = 6 + random() * 26;
    ctx.fillStyle = `rgba(226, 231, 218, ${(depthFade * (0.5 + random() * 0.5)).toFixed(3)})`;
    ctx.fillRect(x, y, len, 1);
  }
  ctx.globalCompositeOperation = 'source-over';

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function glitterTexture(): THREE.CanvasTexture | null {
  if (typeof document === 'undefined' || !document.createElement) {
    return null;
  }
  const width = 32;
  const height = 256;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return null;
  }
  const image = ctx.createImageData(width, height);
  for (let y = 0; y < height; y += 1) {
    // Brightest just off the far shore, fading toward the eye.
    const along = 1 - y / height;
    const falloff = Math.sin(Math.PI * Math.min(1, along * 1.15)) ** 1.6;
    for (let x = 0; x < width; x += 1) {
      const across = 1 - Math.abs((x / (width - 1)) * 2 - 1);
      const value = Math.round(255 * falloff * across ** 2.2);
      const index = (y * width + x) * 4;
      image.data[index] = 255;
      image.data[index + 1] = 240;
      image.data[index + 2] = 208;
      image.data[index + 3] = value;
    }
  }
  ctx.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

export function createWater(): WaterLayer {
  const root = new THREE.Group();
  root.name = 'shore-water';

  const texture = waterTexture();
  const geometry = new THREE.PlaneGeometry(WATER_SIZE, WATER_SIZE);
  geometry.rotateX(-Math.PI / 2);
  const material = new THREE.MeshBasicMaterial({
    ...(texture ? { map: texture } : {}),
    color: texture ? 0xffffff : 0x4f6b64,
    toneMapped: false
  });
  const plane = new THREE.Mesh(geometry, material);
  plane.name = 'shore-water-plane';
  plane.renderOrder = 0;
  root.add(plane);

  const glitterMap = glitterTexture();
  const glitterGeometry = new THREE.PlaneGeometry(GLITTER_WIDTH, GLITTER_LENGTH);
  glitterGeometry.rotateX(-Math.PI / 2);
  const glitterMaterial = new THREE.MeshBasicMaterial({
    ...(glitterMap ? { map: glitterMap } : {}),
    color: glitterMap ? 0xffffff : 0xf5e4c6,
    transparent: true,
    opacity: 0.28,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
    toneMapped: false
  });
  const glitter = new THREE.Mesh(glitterGeometry, glitterMaterial);
  glitter.name = 'shore-water-glitter';
  // Runs from just past the patient toward the sun on the -Z horizon.
  glitter.position.set(0, 0.02, -32 - GLITTER_LENGTH * 0.5);
  glitter.renderOrder = 2;
  root.add(glitter);

  return {
    root,
    dispose(): void {
      geometry.dispose();
      material.dispose();
      if (texture) texture.dispose();
      glitterGeometry.dispose();
      glitterMaterial.dispose();
      if (glitterMap) glitterMap.dispose();
      root.clear();
      root.removeFromParent();
    }
  };
}
