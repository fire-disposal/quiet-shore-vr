import * as THREE from 'three';

/**
 * The buoyancy cue: a few dust motes rising through the near field. One
 * additive `Points` draw, 48 sprites, positions advanced in place.
 *
 * This is the only moving element the scene owns besides the cloud deck, and
 * it is what the stop fade cuts together with the audio swell.
 */

const COUNT = 48;
const SPREAD = 5.2;
/** Motes live between the floor and a little above eye height. */
const MIN_Y = 0.35;
const MAX_Y = 3.4;

export interface MotesLayer {
  points: THREE.Points;
  update(dt: number): void;
  dispose(): void;
}

function spriteTexture(): THREE.CanvasTexture | null {
  if (typeof document === 'undefined' || !document.createElement) {
    return null;
  }
  const size = 32;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return null;
  }
  const blob = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  blob.addColorStop(0, 'rgba(255, 255, 255, 1)');
  blob.addColorStop(0.35, 'rgba(255, 250, 238, 0.7)');
  blob.addColorStop(1, 'rgba(255, 250, 238, 0)');
  ctx.fillStyle = blob;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function createMotes(): MotesLayer {
  const positions = new Float32Array(COUNT * 3);
  const speeds = new Float32Array(COUNT);
  let seed = 913;
  const random = (): number => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
  for (let i = 0; i < COUNT; i += 1) {
    positions[i * 3] = (random() - 0.5) * SPREAD;
    positions[i * 3 + 1] = MIN_Y + random() * (MAX_Y - MIN_Y);
    positions[i * 3 + 2] = (random() - 0.5) * SPREAD;
    speeds[i] = 0.02 + random() * 0.035;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const texture = spriteTexture();
  const material = new THREE.PointsMaterial({
    ...(texture ? { map: texture } : {}),
    color: 0xfff3dc,
    size: 0.032,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
    toneMapped: false
  });
  const points = new THREE.Points(geometry, material);
  points.name = 'shore-motes';
  points.renderOrder = 4;
  // The box is small; culling it when the head turns would pop the whole cue.
  points.frustumCulled = false;

  return {
    points,
    update(dt: number): void {
      const attribute = geometry.getAttribute('position') as THREE.BufferAttribute;
      const array = attribute.array as Float32Array;
      for (let i = 0; i < COUNT; i += 1) {
        const y = i * 3 + 1;
        array[y] += speeds[i] * dt;
        if (array[y] > MAX_Y) {
          array[y] = MIN_Y;
        }
      }
      attribute.needsUpdate = true;
    },
    dispose(): void {
      geometry.dispose();
      material.dispose();
      if (texture) texture.dispose();
      points.removeFromParent();
    }
  };
}
