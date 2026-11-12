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

/**
 * Type ladder for the 0.8 m card, one step above the old 54/34/32. The card is
 * the closest thing the patient reads, so it leads the scale: title, body,
 * hint. The vertical rhythm follows from these, not from hard-coded y values.
 */
const TITLE_PX = 58;
const BODY_PX = 38;
const HINT_PX = 34;
const PAD = 56;
const TITLE_TOP = 40;
const BODY_TOP = 124;
const BODY_LINE = Math.round(BODY_PX * 1.4);

const TITLE = '记录起始体位';
/**
 * The card asks for nothing the patient cannot already do. Calibration only
 * measures the posture the head is holding, so naming a direction to look at
 * was a requirement the system did not have — and one a supine patient cannot
 * satisfy anyway.
 */
const BODY = [
  '保持现在的姿势就好，不用特意看向哪里。',
  '场景会按您此刻的体位对齐。',
  '请保持不动。'
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
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

    // Card body: square corners, flat fill, one hairline. No radius, no shadow:
    // this is the closest card the patient sees, and furniture reads as weight.
    ctx.fillStyle = options.theme.panel;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    ctx.lineWidth = 2;
    ctx.strokeStyle = options.theme.border;
    ctx.strokeRect(1, 1, CANVAS_W - 2, CANVAS_H - 2);

    ctx.textBaseline = 'top';
    ctx.fillStyle = options.theme.text;
    ctx.font = `600 ${TITLE_PX}px ${options.theme.fontFamily}`;
    ctx.fillText(TITLE, PAD, TITLE_TOP);

    ctx.fillStyle = options.theme.muted;
    ctx.font = `400 ${BODY_PX}px ${options.theme.fontFamily}`;
    let y = BODY_TOP;
    for (const line of BODY) {
      ctx.fillText(line, PAD, y);
      y += BODY_LINE;
    }
    if (hint) {
      // Ink, not green: this variant has one accent and the hint is not it.
      ctx.fillStyle = options.theme.text;
      ctx.font = `500 ${HINT_PX}px ${options.theme.fontFamily}`;
      ctx.fillText(hint, PAD, y + 4);
    }

    // Progress track: a 1 px rule under the fill, both square. The accent is a
    // fill only, so it never appears here as an outline.
    if (progress !== null) {
      const barH = 12;
      const barY = CANVAS_H - 48;
      const barW = CANVAS_W - PAD * 2;
      ctx.fillStyle = options.theme.panelStrong;
      ctx.fillRect(PAD, barY, barW, barH);
      ctx.lineWidth = 1;
      ctx.strokeStyle = options.theme.border;
      ctx.strokeRect(PAD + 0.5, barY + 0.5, barW - 1, barH - 1);
      const width = Math.max(4, (barW - 4) * Math.max(0, Math.min(1, progress)));
      ctx.fillStyle = options.theme.accent;
      ctx.fillRect(PAD + 2, barY + 2, width, barH - 4);
    }

    texture.needsUpdate = true;
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
