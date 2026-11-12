import * as THREE from 'three';
import { SpatialAnchor } from '../core/spatial/anchor';
import type { SpatialTheme } from '../core/spatial/theme';
import { DEFAULT_SPATIAL_THEME } from '../core/spatial/theme';
import type { HeadPose } from '../core/xr/types';

/**
 * The bar is read once to confirm the session is live, so it carries one small
 * bold number and one muted line: no card, no rounding, hairline rules only.
 * The plane is 1.18 m wide at 1.5 m, so 28 px of canvas is about 3.2 mm of type.
 */
const FPS_PX = 28;
const SUMMARY_PX = 26;
/** Tabular figures: the frame rate must not jiggle as digits change. */
const FPS_FONT = '"Noto Sans CJK SC", "Source Han Sans SC", "PingFang SC", ui-monospace, monospace';
const PILL_PAD = 4;
const INSET_X = 26;
/** 2 px on a 2048-wide canvas renders a 1 px rule at about 1 mm at 1.5 m. */
const RULE_PX = 2;
const DIVIDER_GAP = 18;
/** Room the summary may use; anything past it is cut, never rescaled. */
const SUMMARY_GAP = 24;

/**
 * A compact, head-locked info bar above the center of the view. It replaces
 * the old DOM debug panel: FPS plus a one-line scene/quality/resource summary.
 * It follows the head with a small damping so it stays glued to the upper
 * field of view without jitter.
 */
export class SpatialHud {
  private readonly anchor: SpatialAnchor;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly texture: THREE.CanvasTexture;
  private readonly geometry: THREE.PlaneGeometry;
  private readonly material: THREE.MeshBasicMaterial;
  private readonly mesh: THREE.Mesh;
  private readonly theme: SpatialTheme;
  private fps = -1;
  private summary = '';
  private visible = false;

  constructor(scene: THREE.Scene, theme: SpatialTheme = DEFAULT_SPATIAL_THEME) {
    this.theme = theme;
    this.anchor = new SpatialAnchor({
      mode: 'head-locked',
      distance: 1.5,
      heightOffset: 0.56,
      dampingSeconds: 0.06
    });
    this.anchor.object.name = 'spatial-hud';
    this.anchor.setVisible(false);
    scene.add(this.anchor.object);

    this.canvas = document.createElement('canvas');
    this.canvas.width = 2048;
    this.canvas.height = 256;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) {
      throw new Error('2D canvas context unavailable');
    }
    this.ctx = ctx;

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.generateMipmaps = false;

    this.geometry = new THREE.PlaneGeometry(1.18, 0.148);
    this.material = new THREE.MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      toneMapped: false
    });
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.renderOrder = 2100;
    this.anchor.object.add(this.mesh);
  }

  setStats(fps: number, summary: string): void {
    const nextFps = Math.max(0, Math.round(fps));
    if (nextFps === this.fps && summary === this.summary) {
      return;
    }
    this.fps = nextFps;
    this.summary = summary;
    this.draw();
    this.texture.needsUpdate = true;
  }

  setVisible(visible: boolean): void {
    if (visible === this.visible) {
      return;
    }
    this.visible = visible;
    this.anchor.setVisible(visible);
  }

  update(head: HeadPose, dt: number, now: number): void {
    if (!this.visible) {
      return;
    }
    this.anchor.update(head, dt, now);
  }

  private draw(): void {
    const ctx = this.ctx;
    const width = this.canvas.width;
    const height = this.canvas.height;
    ctx.clearRect(0, 0, width, height);

    // A near-white fill, one hairline border and nothing else: a card with a
    // radius, a shadow or a gradient reads as furniture and costs head motion.
    // Fill and rule come from the theme so this bar, the subtitle and the SUS
    // card are literally the same paper.
    ctx.beginPath();
    ctx.rect(PILL_PAD, PILL_PAD, width - PILL_PAD * 2, height - PILL_PAD * 2);
    ctx.fillStyle = this.theme.panel;
    ctx.fill();
    // Stroked on the path edge: half falls outside the rect and is clipped, so
    // a 2 px stroke lands as a 1 px hairline.
    ctx.lineWidth = 2;
    ctx.strokeStyle = this.theme.border;
    ctx.stroke();

    const midY = height / 2;
    const baseline = midY + 1;
    ctx.textBaseline = 'middle';
    ctx.font = `700 ${FPS_PX}px ${FPS_FONT}`;
    const fpsText = this.fps < 0 ? '--' : `${this.fps}`;
    ctx.fillStyle = this.theme.text;
    ctx.fillText(fpsText, INSET_X, baseline);
    const fpsWidth = ctx.measureText(fpsText).width;

    const ruleX = Math.round(INSET_X + fpsWidth + DIVIDER_GAP);
    ctx.fillStyle = this.theme.border;
    ctx.fillRect(ruleX, Math.round(height * 0.24), RULE_PX, Math.round(height * 0.52));

    ctx.font = `650 ${SUMMARY_PX}px ${this.theme.fontFamily}`;
    ctx.fillStyle = this.theme.muted;
    ctx.fillText(this.summary, ruleX + DIVIDER_GAP, baseline, width - ruleX - INSET_X - SUMMARY_GAP);
  }

  dispose(): void {
    this.anchor.object.remove(this.mesh);
    this.geometry.dispose();
    this.material.dispose();
    this.texture.dispose();
    this.anchor.dispose();
  }
}
