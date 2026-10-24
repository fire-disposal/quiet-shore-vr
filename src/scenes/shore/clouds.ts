import * as THREE from 'three';

/**
 * Cloud deck for a patient on their back: two horizontal sheets overhead,
 * drifting at different speeds so the sky has depth without geometry.
 *
 * Two textured quads is the whole budget. The old scene stacked three sheets
 * here plus a second, drifting instanced cloud system below the horizon; for a
 * supine viewer that was five near-full-screen transparent passes per eye for
 * one visual idea.
 */

const SHEETS = 2;
const SPREAD = 150;
const BASE_HEIGHT = 24;

interface Sheet {
  mesh: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
  /** Drift radius and rate, kept per sheet for parallax. */
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
  if (typeof document === 'undefined' || !document.createElement) {
    return null;
  }
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return null;
  }
  ctx.clearRect(0, 0, size, size);
  // Deterministic: the same sky on every launch.
  let seed = 20261024;
  const random = (): number => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
  for (let i = 0; i < 14; i += 1) {
    const x = size * (0.14 + random() * 0.72);
    const y = size * (0.2 + random() * 0.6);
    const radius = size * (0.1 + random() * 0.2);
    const alpha = 0.22 + random() * 0.3;
    const blob = ctx.createRadialGradient(x, y, 0, x, y, radius);
    blob.addColorStop(0, `rgba(255, 252, 246, ${alpha.toFixed(3)})`);
    blob.addColorStop(0.55, `rgba(252, 244, 232, ${(alpha * 0.55).toFixed(3)})`);
    blob.addColorStop(1, 'rgba(250, 244, 234, 0)');
    ctx.fillStyle = blob;
    ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  }
  // Feather the border so the quad never shows an edge against the dome.
  const edge = ctx.createLinearGradient(0, 0, size, 0);
  edge.addColorStop(0, 'rgba(0, 0, 0, 0)');
  edge.addColorStop(0.14, 'rgba(0, 0, 0, 1)');
  edge.addColorStop(0.86, 'rgba(0, 0, 0, 1)');
  edge.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.globalCompositeOperation = 'destination-in';
  ctx.fillStyle = edge;
  ctx.fillRect(0, 0, size, size);
  ctx.globalCompositeOperation = 'source-over';

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

export function createClouds(): CloudLayer {
  const root = new THREE.Group();
  root.name = 'shore-clouds';

  const texture = cloudTexture();
  const geometry = new THREE.PlaneGeometry(1, 1);
  const sheets: Sheet[] = [];

  for (let i = 0; i < SHEETS; i += 1) {
    const material = new THREE.MeshBasicMaterial({
      ...(texture ? { map: texture } : {}),
      color: texture ? 0xffffff : 0xdfe6e6,
      transparent: true,
      opacity: i === 0 ? 0.52 : 0.3,
      depthWrite: false,
      fog: false,
      toneMapped: false,
      side: THREE.DoubleSide
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = `shore-clouds-${i}`;
    // Horizontal, seen from below. The far sheet is higher and wider, so the
    // two move against each other and read as a deck rather than a card.
    mesh.rotation.x = Math.PI / 2;
    mesh.rotation.z = i * 0.8;
    mesh.position.y = BASE_HEIGHT + i * 11;
    mesh.scale.setScalar(SPREAD * (0.85 + i * 0.5));
    mesh.renderOrder = 1 + i;
    mesh.frustumCulled = false;
    root.add(mesh);
    sheets.push({
      mesh,
      material,
      reach: 5 + i * 3,
      speed: 0.018 + i * 0.008,
      phase: i * 2.1
    });
  }

  return {
    root,
    update(dt: number, elapsed: number): void {
      for (let i = 0; i < sheets.length; i += 1) {
        const sheet = sheets[i];
        const drift = elapsed * sheet.speed + sheet.phase;
        sheet.mesh.position.x = Math.sin(drift) * sheet.reach;
        sheet.mesh.position.z = Math.cos(drift * 0.63) * sheet.reach * 0.7;
        // Barely perceptible roll: enough that a still head still sees motion.
        sheet.mesh.rotation.z = i * 0.8 + Math.sin(drift * 0.4) * 0.05 + dt * 0.0015;
      }
    },
    dispose(): void {
      geometry.dispose();
      if (texture) texture.dispose();
      for (let i = 0; i < sheets.length; i += 1) {
        sheets[i].material.dispose();
      }
      root.clear();
      root.removeFromParent();
    }
  };
}
