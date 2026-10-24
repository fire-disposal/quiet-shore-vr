import * as THREE from 'three';

/**
 * The lake, as one opaque quad plus one additive strip.
 *
 * §2.1 of `docs/research-standing-sensation.md`: floating over water produces
 * roughly four times the vection distance of standing on ground, because the
 * vestibular "below" reference goes vague. That is the whole job of this
 * object. Nothing animates: ripples drawn per pixel shimmer badly at
 * 20 px/deg with no MSAA, and the head's own motion supplies the parallax.
 */

const WATER_DEPTH = 300;
const WATER_CENTER_Z = -140;
const GLITTER_LENGTH = 104;
const GLITTER_WIDTH = 9;

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
  ramp.addColorStop(0.0, '#C6BFAA');
  ramp.addColorStop(0.12, '#9FA99A');
  ramp.addColorStop(0.3, '#7B9189');
  ramp.addColorStop(0.52, '#5C7A74');
  ramp.addColorStop(0.76, '#44625F');
  ramp.addColorStop(1.0, '#2F4A49');
  ctx.fillStyle = ramp;
  ctx.fillRect(0, 0, width, height);

  let seed = 7;
  const random = (): number => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };

  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 26; i += 1) {
    const y = height * (0.08 + random() * 0.88);
    const band = height * (0.004 + random() * 0.012);
    const alpha = 0.05 + random() * 0.05;
    const grad = ctx.createLinearGradient(0, y - band, 0, y + band);
    grad.addColorStop(0, 'rgba(232, 235, 220, 0)');
    grad.addColorStop(0.5, `rgba(232, 235, 220, ${alpha.toFixed(3)})`);
    grad.addColorStop(1, 'rgba(232, 235, 220, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, y - band, width, band * 2);
  }
  for (let i = 0; i < 120; i += 1) {
    const t = random() ** 0.6;
    const y = height * (0.42 + t * 0.58);
    const len = 8 + random() * 30 * (0.4 + t);
    const alpha = 0.04 + t * 0.08;
    ctx.fillStyle = `rgba(226, 231, 214, ${alpha.toFixed(3)})`;
    ctx.fillRect(random() * width, y, len, 1);
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
  const width = 64;
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
    const along = 1 - y / (height - 1);
    const falloff = Math.sin(Math.PI * Math.min(1, along * 1.05)) ** 1.4;
    for (let x = 0; x < width; x += 1) {
      const across = 1 - Math.abs((x / (width - 1)) * 2 - 1);
      const value = Math.round(255 * falloff * across ** 2.4);
      const index = (y * width + x) * 4;
      image.data[index] = 255;
      image.data[index + 1] = 243;
      image.data[index + 2] = 214;
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
  const geometry = new THREE.PlaneGeometry(WATER_DEPTH, WATER_DEPTH);
  geometry.rotateX(-Math.PI / 2);
  const material = new THREE.MeshBasicMaterial({
    ...(texture ? { map: texture } : {}),
    color: texture ? 0xffffff : 0x4f6b64,
    toneMapped: false
  });
  const plane = new THREE.Mesh(geometry, material);
  plane.name = 'shore-water-plane';
  plane.position.z = WATER_CENTER_Z;
  plane.renderOrder = 0;
  root.add(plane);

  const glitterMap = glitterTexture();
  const glitterGeometry = new THREE.PlaneGeometry(GLITTER_WIDTH, GLITTER_LENGTH);
  glitterGeometry.rotateX(-Math.PI / 2);
  const glitterMaterial = new THREE.MeshBasicMaterial({
    ...(glitterMap ? { map: glitterMap } : {}),
    color: glitterMap ? 0xffffff : 0xf5e4c6,
    transparent: true,
    opacity: 0.42,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
    toneMapped: false
  });
  const glitter = new THREE.Mesh(glitterGeometry, glitterMaterial);
  glitter.name = 'shore-water-glitter';
  glitter.position.set(0, 0.02, -6 - GLITTER_LENGTH * 0.5);
  glitter.renderOrder = 3;
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
