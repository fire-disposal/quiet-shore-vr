import * as THREE from 'three';
import { SpatialAnchor } from '../core/spatial/anchor';
import type { HeadPose } from '../core/xr/types';
import type { SpatialTheme } from '../core/spatial/theme';

/**
 * Calibration as one canvas.
 *
 * Earlier versions composed the card from separate panel, title, body and bar
 * meshes; every visual fault (text below the card, a huge wall in front of the
 * eye, elements layering in the wrong order) came from that composition. One
 * 2D canvas drawn once per state change removes the whole class: what you see
 * is exactly what was drawn, at one depth, in one draw call.
 *
 * The scene is hidden by the app (host content visibility + clear colour), not
 * by this overlay, so nothing here can look like a wall.
 */
export interface CalibrationOverlayOptions {
  scene: THREE.Scene;
  theme: SpatialTheme;
}

export interface CalibrationOverlayApi {
  show(): void;
  hide(): void;
  isVisible(): boolean;
  update(dt: number, now: number, head: HeadPose | null): void;
  setProgress(progress: number | null): void;
  setHint(text: string): void;
  dispose(): void;
}

const CANVAS_W = 768;
const CANVAS_H = 432;
const PLANE_W = 0.8;
const PLANE_H = (PLANE_W * CANVAS_H) / CANVAS_W;

const TITLE = '记录起始朝向';
const BODY = [
  '保持现在的姿势，看向前方。',
  '将以您面向的方向生成场景。',
  '保持不动即可，无需按键。'
];

export function createCalibrationOverlay(
  options: CalibrationOverlayOptions
): CalibrationOverlayApi {
  const canvas = document.createElement('canvas');
  canvas.width = CANVAS_W;
  canvas.height = CANVAS_H;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('2d canvas unavailable');
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;

  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    toneMapped: false
  });
  const geometry = new THREE.PlaneGeometry(PLANE_W, PLANE_H);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = 1500;

  const anchor = new SpatialAnchor({
    mode: 'head-locked',
    distance: 0.8,
    dampingSeconds: 0
  });
  anchor.object.add(mesh);
  anchor.setVisible(false);
  options.scene.add(anchor.object);

  let visible = false;
  let progress: number | null = null;
  let hint = '';

  function draw(): void {
    if (!ctx) {
      return;
    }
    const panel = options.theme.panel;
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

    // Card body.
    const radius = 28;
    ctx.fillStyle = panel;
    ctx.beginPath();
    ctx.moveTo(radius, 0);
    ctx.arcTo(CANVAS_W, 0, CANVAS_W, CANVAS_H, radius);
    ctx.arcTo(CANVAS_W, CANVAS_H, 0, CANVAS_H, radius);
    ctx.arcTo(0, CANVAS_H, 0, 0, radius);
    ctx.arcTo(0, 0, CANVAS_W, 0, radius);
    ctx.closePath();
    ctx.fill();

    const pad = 56;
    ctx.textBaseline = 'top';
    ctx.fillStyle = options.theme.text;
    ctx.font = `600 54px ${options.theme.fontFamily}`;
    ctx.fillText(TITLE, pad, 44);

    ctx.fillStyle = options.theme.muted;
    ctx.font = `400 34px ${options.theme.fontFamily}`;
    let y = 128;
    for (const line of BODY) {
      ctx.fillText(line, pad, y);
      y += 46;
    }
    if (hint) {
      ctx.fillStyle = options.theme.success;
      ctx.font = `500 32px ${options.theme.fontFamily}`;
      ctx.fillText(hint, pad, y + 6);
    }

    // Progress track: only while a window is running.
    const barY = CANVAS_H - 58;
    const barW = CANVAS_W - pad * 2;
    if (progress !== null) {
      ctx.fillStyle = options.theme.border;
      roundRect(ctx, pad, barY, barW, 14, 7);
      ctx.fill();
      const width = Math.max(6, barW * Math.max(0, Math.min(1, progress)));
      ctx.fillStyle = options.theme.success;
      roundRect(ctx, pad, barY, width, 14, 7);
      ctx.fill();
    }

    texture.needsUpdate = true;
  }

  function roundRect(
    c: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    r: number
  ): void {
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }

  draw();

  return {
    show(): void {
      visible = true;
      anchor.setVisible(true);
    },
    hide(): void {
      visible = false;
      anchor.setVisible(false);
    },
    isVisible: () => visible,
    update(dt: number, now: number, head: HeadPose | null): void {
      if (!visible || !head) {
        return;
      }
      anchor.update(head, dt, now);
    },
    setProgress(value: number | null): void {
      if (value === progress) {
        return;
      }
      progress = value;
      draw();
    },
    setHint(text: string): void {
      if (text === hint) {
        return;
      }
      hint = text;
      draw();
    },
    dispose(): void {
      options.scene.remove(anchor.object);
      anchor.object.remove(mesh);
      geometry.dispose();
      material.dispose();
      texture.dispose();
      anchor.dispose();
    }
  };
}
