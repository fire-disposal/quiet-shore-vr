import * as THREE from 'three';
import { SpatialAnchor } from '../core/spatial/anchor';
import type { SpatialTheme } from '../core/spatial/theme';
import { DEFAULT_SPATIAL_THEME } from '../core/spatial/theme';
import type { HeadPose } from '../core/xr/types';

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
    this.canvas.width = 1024;
    this.canvas.height = 128;
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

    const radius = 30;
    const pad = 4;
    ctx.beginPath();
    ctx.moveTo(pad + radius, pad);
    ctx.arcTo(width - pad, pad, width - pad, height - pad, radius);
    ctx.arcTo(width - pad, height - pad, pad, height - pad, radius);
    ctx.arcTo(pad, height - pad, pad, pad, radius);
    ctx.arcTo(pad, pad, width - pad, pad, radius);
    ctx.closePath();
    ctx.fillStyle = 'rgba(247, 243, 234, 0.94)';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = this.theme.border;
    ctx.stroke();

    ctx.textBaseline = 'middle';
    ctx.font = `650 31px ${this.theme.fontFamily}`;
    const fpsText = `FPS ${this.fps < 0 ? '--' : this.fps}`;
    ctx.fillStyle = this.theme.accent;
    ctx.fillText(fpsText, 30, height / 2 + 1);
    const fpsWidth = ctx.measureText(fpsText).width;

    const separatorX = 30 + fpsWidth + 22;
    ctx.fillStyle = this.theme.border;
    ctx.fillRect(separatorX, 32, 2, height - 64);

    ctx.font = `500 28px ${this.theme.fontFamily}`;
    ctx.fillStyle = this.theme.muted;
    ctx.fillText(
      this.summary,
      separatorX + 22,
      height / 2 + 1,
      width - separatorX - 52
    );
  }

  dispose(): void {
    this.anchor.object.remove(this.mesh);
    this.geometry.dispose();
    this.material.dispose();
    this.texture.dispose();
    this.anchor.dispose();
  }
}
