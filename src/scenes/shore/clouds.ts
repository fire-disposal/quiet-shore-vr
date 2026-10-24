import * as THREE from 'three';
import { makeTexture } from '../shared/canvas';

/**
 * Cloud deck for a patient on their back: one horizontal sheet overhead,
 * drifting slowly, with clear sky between the masses.
 *
 * One sheet, not three: every sheet is a near-full-screen transparent pass per
 * eye, and the scene budget is spent on supersampling instead. The texture
 * tiles 2× so the puffs keep an edge after magnification rather than turning
 * into bokeh.
 */

const SPREAD = 175;
const BASE_HEIGHT = 34;

interface Sheet {
  mesh: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
  reach: number;
  speed: number;
  phase: number;
}

export interface CloudLayer {
  root: THREE.Group;
  update(dt: number, elapsed: number): void;
  dispose(): void;
}

function cloudTexture(): THREE.CanvasTexture | null {
  return makeTexture((ctx, size) => {
  ctx.clearRect(0, 0, size, size);
  // Deterministic: the same sky on every launch.
  let seed = 20261024;
  const random = (): number => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };

  const drawPuff = (
    x: number,
    y: number,
    radius: number,
    alpha: number,
    bright: boolean
  ): void => {
    for (let ox = -1; ox <= 1; ox += 1) {
      for (let oy = -1; oy <= 1; oy += 1) {
        const px = x + ox * size;
        const py = y + oy * size;
        const gradient = ctx.createRadialGradient(
          px,
          bright ? py - radius * 0.25 : py + radius * 0.3,
          0,
          px,
          py,
          radius
        );
        if (bright) {
          gradient.addColorStop(0, `rgba(255, 253, 248, ${alpha.toFixed(3)})`);
          gradient.addColorStop(0.42, `rgba(250, 248, 242, ${(alpha * 0.7).toFixed(3)})`);
          gradient.addColorStop(0.78, `rgba(216, 226, 234, ${(alpha * 0.35).toFixed(3)})`);
          gradient.addColorStop(1, 'rgba(206, 219, 230, 0)');
        } else {
          gradient.addColorStop(0, `rgba(146, 166, 186, ${alpha.toFixed(3)})`);
          gradient.addColorStop(0.6, `rgba(150, 170, 190, ${(alpha * 0.5).toFixed(3)})`);
          gradient.addColorStop(1, 'rgba(150, 170, 190, 0)');
        }
        ctx.fillStyle = gradient;
        ctx.fillRect(px - radius, py - radius, radius * 2, radius * 2);
      }
    }
  };

  for (let mass = 0; mass < 12; mass += 1) {
    const cx = size * random();
    const cy = size * random();
    const spread = size * (0.045 + random() * 0.05);
    // Cool shaded base, then a few large bright lobes bind the small puffs
    // into one mass, so the deck reads as cloud rather than beads.
    drawPuff(cx, cy, spread * 1.5, 0.22, false);
    for (let lobe = 0; lobe < 4; lobe += 1) {
      drawPuff(
        cx + (random() - 0.5) * spread * 0.7,
        cy + (random() - 0.5) * spread * 0.4,
        spread * (0.35 + random() * 0.35),
        0.12 + random() * 0.1,
        true
      );
    }
    const puffs = 12 + Math.floor(random() * 6);
    for (let puff = 0; puff < puffs; puff += 1) {
      drawPuff(
        cx + (random() + random() - 1) * spread,
        cy + (random() + random() - 1) * spread * 0.6,
        size * (0.008 + random() * 0.016),
        0.45 + random() * 0.25,
        true
      );
    }
  }

  }, { size: 1024, repeat: [2, 2] });
}

export function createClouds(): CloudLayer {
  const root = new THREE.Group();
  root.name = 'shore-clouds';

  const texture = cloudTexture();
  const geometry = new THREE.PlaneGeometry(1, 1);
  const material = new THREE.MeshBasicMaterial({
    ...(texture ? { map: texture } : {}),
    color: texture ? 0xffffff : 0xdfe6e6,
    transparent: true,
    opacity: 0.7,
    depthWrite: false,
    fog: false,
    toneMapped: false,
    side: THREE.DoubleSide
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'shore-clouds';
  // Horizontal, seen from below.
  mesh.rotation.x = Math.PI / 2;
  mesh.position.y = BASE_HEIGHT;
  mesh.scale.setScalar(SPREAD * 0.95);
  mesh.renderOrder = 1;
  mesh.frustumCulled = false;
  root.add(mesh);

  const sheet: Sheet = { mesh, material, reach: 6, speed: 0.02, phase: 0 };

  return {
    root,
    update(dt: number, elapsed: number): void {
      const drift = elapsed * sheet.speed + sheet.phase;
      sheet.mesh.position.x = Math.sin(drift) * sheet.reach;
      sheet.mesh.position.z = Math.cos(drift * 0.63) * sheet.reach * 0.7;
      sheet.mesh.rotation.z = 0.8 + Math.sin(drift * 0.4) * 0.02 + dt * 0.0008;
    },
    dispose(): void {
      geometry.dispose();
      material.dispose();
      if (texture) texture.dispose();
      root.clear();
      root.removeFromParent();
    }
  };
}
