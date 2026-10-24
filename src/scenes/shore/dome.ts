import * as THREE from 'three';

/**
 * The whole sky in one draw: a gradient dome with the warm horizon, the sun
 * wash and the sun disk painted into a single equirectangular texture.
 *
 * No vertex shader, no per-pixel noise, no dither: a supine patient stares at
 * this surface for ten minutes, and every bit of per-pixel work here is paid
 * twice (one pass per eye) at full screen.
 */

const DOME_RADIUS = 90;

/** Texture u that maps to -Z, the direction the patient faces. */
const SUN_U = 0.75;
/** Just above the equator, so the sun sits on the horizon. */
const SUN_V = 0.515;

export interface DomeLayer {
  mesh: THREE.Mesh;
  dispose(): void;
}

/** Equirectangular dawn ramp: zenith, pale mid sky, warm horizon, dark nadir. */
function paintSky(ctx: CanvasRenderingContext2D, width: number, height: number): void {
  const ramp = ctx.createLinearGradient(0, 0, 0, height);
  ramp.addColorStop(0.0, '#48739E');
  ramp.addColorStop(0.24, '#78A0C0');
  ramp.addColorStop(0.41, '#B4C9D2');
  ramp.addColorStop(0.472, '#DCCFB8');
  ramp.addColorStop(0.505, '#EFDFBF');
  ramp.addColorStop(0.545, '#E7D7BD');
  ramp.addColorStop(0.62, '#CDBBA0');
  ramp.addColorStop(1.0, '#6E6A60');
  ctx.fillStyle = ramp;
  ctx.fillRect(0, 0, width, height);

  const cx = SUN_U * width;
  const cy = SUN_V * height;

  // Wide warm wash: the horizon glows before the sun is anywhere near it.
  const wash = ctx.createRadialGradient(cx, cy, 0, cx, cy, width * 0.26);
  wash.addColorStop(0, 'rgba(255, 232, 196, 0.5)');
  wash.addColorStop(0.45, 'rgba(255, 224, 184, 0.22)');
  wash.addColorStop(1, 'rgba(255, 232, 196, 0)');
  ctx.fillStyle = wash;
  ctx.fillRect(0, 0, width, height);

  // The disk itself: a readable point of light, not a lamp.
  const disk = ctx.createRadialGradient(cx, cy, 0, cx, cy, 26);
  disk.addColorStop(0, 'rgba(255, 251, 240, 1)');
  disk.addColorStop(0.35, 'rgba(255, 248, 230, 0.95)');
  disk.addColorStop(0.7, 'rgba(255, 239, 208, 0.35)');
  disk.addColorStop(1, 'rgba(255, 239, 208, 0)');
  ctx.fillStyle = disk;
  ctx.fillRect(cx - 30, cy - 30, 60, 60);
}

function skyTexture(): THREE.CanvasTexture | null {
  if (typeof document === 'undefined' || !document.createElement) {
    return null;
  }
  const width = 1024;
  const height = 512;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return null;
  }
  paintSky(ctx, width, height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

export function createDome(): DomeLayer {
  const texture = skyTexture();
  const geometry = new THREE.SphereGeometry(DOME_RADIUS, 24, 12);
  const material = new THREE.MeshBasicMaterial({
    ...(texture ? { map: texture } : {}),
    // Headless test hosts have no canvas: a flat sky still builds and measures.
    color: texture ? 0xffffff : 0x9cbbd2,
    side: THREE.BackSide,
    fog: false,
    depthWrite: false,
    toneMapped: false
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'shore-dome';
  mesh.renderOrder = -10;
  mesh.frustumCulled = false;

  return {
    mesh,
    dispose(): void {
      geometry.dispose();
      material.dispose();
      if (texture) texture.dispose();
      mesh.removeFromParent();
    }
  };
}
