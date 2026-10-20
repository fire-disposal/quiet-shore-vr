import * as THREE from 'three';
import type { SpatialInteractable } from '../../core/spatial/types';
import type { SpatialTheme } from '../../core/spatial/theme';

export interface SpatialButtonOptions {
  width: number;
  height: number;
  label: string;
  theme: SpatialTheme;
  renderOrder?: number;
  dwellTime?: number;
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function drawButton(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  label: string,
  theme: SpatialTheme,
  focused: boolean,
  pressed: boolean,
  enabled: boolean
): void {
  ctx.clearRect(0, 0, width, height);
  const pad = 3;
  roundRect(ctx, pad, pad, width - pad * 2, height - pad * 2, 20);

  if (!enabled) {
    ctx.fillStyle = 'rgba(40, 54, 51, 0.9)';
  } else if (focused) {
    ctx.fillStyle = pressed ? '#c9a45f' : theme.accent;
  } else {
    ctx.fillStyle = pressed ? '#1b302b' : theme.panelStrong;
  }
  ctx.fill();

  ctx.lineWidth = focused ? 3 : 1.5;
  ctx.strokeStyle = !enabled ? theme.muted : focused ? '#f0d49a' : theme.border;
  ctx.stroke();

  ctx.fillStyle = !enabled ? theme.muted : focused ? theme.accentText : theme.text;
  ctx.font = `600 ${theme.buttonPx}px ${theme.fontFamily}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, width / 2, height / 2 + 1, width - 48);
}

export class SpatialButton {
  readonly object = new THREE.Group();
  readonly mesh: THREE.Mesh;
  readonly interactable: SpatialInteractable;

  onSelect: (() => void) | null = null;

  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly texture: THREE.CanvasTexture;
  private readonly geometry: THREE.PlaneGeometry;
  private readonly material: THREE.MeshBasicMaterial;
  private readonly theme: SpatialTheme;
  private label: string;
  private focused = false;
  private pressed = false;
  private enabled = true;
  private pressTimer = 0;

  constructor(options: SpatialButtonOptions) {
    this.theme = options.theme;
    this.label = options.label;
    this.canvas = document.createElement('canvas');
    this.canvas.width = 512;
    this.canvas.height = 128;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) {
      throw new Error('2D canvas context unavailable');
    }
    this.ctx = ctx;

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.minFilter = THREE.LinearMipmapLinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.generateMipmaps = true;
    this.texture.anisotropy = 4;

    this.geometry = new THREE.PlaneGeometry(options.width, options.height);
    this.material = new THREE.MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      toneMapped: false
    });
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.renderOrder = options.renderOrder ?? 1001;
    this.object.add(this.mesh);

    this.interactable = {
      object: this.mesh,
      layer: 'ui',
      dwellTime: options.dwellTime ?? 0,
      onFocus: (focused: boolean) => this.setFocused(focused),
      onSelect: () => this.activate()
    };

    this.draw();
  }

  setFocused(focused: boolean): void {
    if (focused === this.focused) {
      return;
    }
    this.focused = focused;
    this.draw();
  }

  setEnabled(enabled: boolean): void {
    if (enabled === this.enabled) {
      return;
    }
    this.enabled = enabled;
    this.draw();
  }

  setLabel(label: string): void {
    if (label === this.label) {
      return;
    }
    this.label = label;
    this.draw();
  }

  setPose(x: number, y: number, z = 0): void {
    this.object.position.set(x, y, z);
  }

  private activate(): void {
    if (!this.enabled) {
      return;
    }
    this.pressed = true;
    this.draw();
    if (this.pressTimer) {
      window.clearTimeout(this.pressTimer);
    }
    this.pressTimer = window.setTimeout(() => {
      this.pressed = false;
      this.draw();
    }, 120);
    this.onSelect?.();
  }

  private draw(): void {
    drawButton(
      this.ctx,
      this.canvas.width,
      this.canvas.height,
      this.label,
      this.theme,
      this.focused,
      this.pressed,
      this.enabled
    );
    this.texture.needsUpdate = true;
  }

  dispose(): void {
    if (this.pressTimer) {
      window.clearTimeout(this.pressTimer);
    }
    this.object.remove(this.mesh);
    this.geometry.dispose();
    this.material.dispose();
    this.texture.dispose();
  }
}
