import * as THREE from 'three';
import { makeTexture } from '../shared/canvas';

/**
 * Cloud deck for a patient on their back: one horizontal sheet overhead,
 * drifting in one direction, very slowly, with clear sky between the masses.
 *
 * The sheet used to follow a two-sine Lissajous path with a rolling wobble. A
 * 166 m plane 34 m overhead moving back and forth is not "drifting clouds":
 * every turning point reads as acceleration, and the two axes at different
 * frequencies read as shaking. A single linear scroll of the texture does the
 * job with no reversal at all, and wraps without a jump.
 *
 * One sheet, not three: every sheet is a near-full-screen transparent pass per
 * eye, and the scene budget is spent on supersampling instead. The texture
 * tiles 2× so the puffs keep an edge after magnification rather than turning
 * into bokeh.
 */

const SPREAD = 175;
const BASE_HEIGHT = 34;

/** Metres per second of cloud travel. Barely perceptible on purpose. */
export const CLOUD_DRIFT_MPS = 0.12;
/** The sheet spans SPREAD*0.95 with the texture tiled twice. */
const TILE_METRES = (SPREAD * 0.95) / 2;

/**
 * One step of the scroll, in texture units (1 = one full tile). Linear and
 * one-way; the modulo is the only discontinuity, and it is invisible because
 * the texture repeats.
 */
export function advanceCloudOffset(offset: number, dt: number): number {
  if (!(dt > 0)) {
    return offset;
  }
  return (offset + (dt * CLOUD_DRIFT_MPS) / TILE_METRES) % 1;
}

/** One drifting sheet, described by height, size, opacity and drift rate. */
interface SheetSpec {
  name: string;
  height: number;
  scale: number;
  opacity: number;
  /** Multiplier on [CLOUD_DRIFT_MPS]. */
  rate: number;
}

/**
 * Two decks, not one: a high thin layer at a different speed gives the cloud
 * base parallax against the fixed dome. A single sheet read as a flat ceiling.
 */
const SHEETS: readonly SheetSpec[] = [
  { name: 'shore-cloud-sheet', height: 34, scale: 0.95, opacity: 0.7, rate: 1 },
  { name: 'shore-cloud-sheet-high', height: 66, scale: 1.6, opacity: 0.26, rate: 0.45 }
];

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
  const materials: THREE.MeshBasicMaterial[] = [];
  const textures: THREE.CanvasTexture[] = [];
  const offsets: number[] = [];

  for (const spec of SHEETS) {
    // A clone shares the canvas image; only the transform differs.
    const map = texture ? texture.clone() : null;
    if (map) {
      map.needsUpdate = true;
      textures.push(map);
    }
    const material = new THREE.MeshBasicMaterial({
      ...(map ? { map } : {}),
      color: map ? 0xffffff : 0xdfe6e6,
      transparent: true,
      opacity: spec.opacity,
      depthWrite: false,
      fog: false,
      toneMapped: false,
      side: THREE.DoubleSide
    });
    materials.push(material);

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = spec.name;
    mesh.rotation.x = Math.PI / 2;
    mesh.rotation.z = 0.8;
    mesh.position.y = spec.height;
    mesh.scale.setScalar(SPREAD * spec.scale);
    mesh.renderOrder = 1;
    mesh.frustumCulled = false;
    root.add(mesh);
    offsets.push(0);
  }

  return {
    root,
    update(dt: number): void {
      if (!(dt > 0)) {
        return;
      }
      root.children.forEach((child, index) => {
        const current = advanceCloudOffset(offsets[index], dt * SHEETS[index].rate);
        offsets[index] = current;
        const map = materials[index].map;
        if (map) {
          map.offset.x = current;
        }
      });
    },
    dispose(): void {
      geometry.dispose();
      for (const material of materials) {
        material.dispose();
      }
      for (const map of textures) {
        map.dispose();
      }
      if (texture) texture.dispose();
      root.clear();
      root.removeFromParent();
    }
  };
}
