import * as THREE from 'three';
import type { SpatialTheme } from '../../core/spatial/theme';
import { DEFAULT_SPATIAL_THEME } from '../../core/spatial/theme';
import { SpatialButton } from './button';
import { TextTexture } from './text';

export interface SpatialSurfaceOptions {
  width: number;
  height: number;
  theme?: SpatialTheme;
  title?: string;
  body?: string;
  renderOrder?: number;
}

function createPanelTexture(widthMeters: number, heightMeters: number, theme: SpatialTheme): THREE.CanvasTexture {
  const widthPx = 512;
  const heightPx = Math.max(64, Math.round((widthPx * heightMeters) / widthMeters));
  const canvas = document.createElement('canvas');
  canvas.width = widthPx;
  canvas.height = heightPx;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('2D canvas context unavailable');
  }

  const pad = 10;
  const r = theme.radiusPx * (widthPx / 512);
  ctx.clearRect(0, 0, widthPx, heightPx);
  ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
  ctx.shadowBlur = 26;
  ctx.shadowOffsetY = 12;
  ctx.beginPath();
  ctx.moveTo(pad + r, pad);
  ctx.arcTo(widthPx - pad, pad, widthPx - pad, heightPx - pad, r);
  ctx.arcTo(widthPx - pad, heightPx - pad, pad, heightPx - pad, r);
  ctx.arcTo(pad, heightPx - pad, pad, pad, r);
  ctx.arcTo(pad, pad, widthPx - pad, pad, r);
  ctx.closePath();
  ctx.fillStyle = theme.panel;
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.lineWidth = 3;
  ctx.strokeStyle = theme.border;
  ctx.stroke();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  return texture;
}

function createTextMesh(texture: THREE.Texture, width: number, height: number, renderOrder: number): THREE.Mesh {
  // Unit geometry: layout writes world-space size via scale.
  const geometry = new THREE.PlaneGeometry(1, 1);
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    toneMapped: false
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = renderOrder;
  return mesh;
}

/**
 * A spatial panel: background, optional title/body text, and ordered buttons.
 * It owns its geometries/materials/textures; the caller owns the anchor.
 */
export class SpatialSurface {
  readonly object = new THREE.Group();
  readonly buttons: SpatialButton[] = [];

  private readonly options: Required<Pick<SpatialSurfaceOptions, 'width' | 'height' | 'theme' | 'renderOrder'>> &
    Pick<SpatialSurfaceOptions, 'title' | 'body'>;
  private readonly panelTexture: THREE.CanvasTexture;
  private readonly panelGeometry: THREE.PlaneGeometry;
  private readonly panelMaterial: THREE.MeshBasicMaterial;
  private readonly panelMesh: THREE.Mesh;

  private title: TextTexture | null = null;
  private titleMesh: THREE.Mesh | null = null;
  private body: TextTexture | null = null;
  private bodyMesh: THREE.Mesh | null = null;
  private nextButtonIndex = 0;

  constructor(options: SpatialSurfaceOptions) {
    this.options = {
      width: options.width,
      height: options.height,
      theme: options.theme ?? DEFAULT_SPATIAL_THEME,
      renderOrder: options.renderOrder ?? 1000,
      title: options.title,
      body: options.body
    };
    this.object.name = 'spatial-surface';

    this.panelTexture = createPanelTexture(this.options.width, this.options.height, this.options.theme);
    this.panelGeometry = new THREE.PlaneGeometry(this.options.width, this.options.height);
    this.panelMaterial = new THREE.MeshBasicMaterial({
      map: this.panelTexture,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      toneMapped: false
    });
    this.panelMesh = new THREE.Mesh(this.panelGeometry, this.panelMaterial);
    this.panelMesh.renderOrder = this.options.renderOrder;
    this.object.add(this.panelMesh);

    if (this.options.title) {
      this.setTitle(this.options.title);
    }
    if (this.options.body) {
      this.setBody(this.options.body);
    }
    this.layout();
  }

  setTitle(text: string): void {
    if (!this.title) {
      this.title = new TextTexture({
        theme: this.options.theme,
        sizePx: this.options.theme.titlePx,
        weight: 650,
        align: 'left'
      });
      this.titleMesh = createTextMesh(this.title.texture, 0.1, 0.1, this.options.renderOrder + 1);
      this.object.add(this.titleMesh);
    }
    this.title.setText(text);
    this.layout();
  }

  setBody(text: string): void {
    if (!this.body) {
      this.body = new TextTexture({
        theme: this.options.theme,
        widthPx: 512,
        heightPx: 256,
        sizePx: this.options.theme.bodyPx,
        weight: 400,
        color: this.options.theme.muted,
        align: 'left'
      });
      this.bodyMesh = createTextMesh(this.body.texture, 0.1, 0.1, this.options.renderOrder + 2);
      this.object.add(this.bodyMesh);
    }
    this.body.setText(text);
    this.layout();
  }

  addButton(label: string, onSelect: () => void, dwellTime = 0): SpatialButton {
    const width = this.options.width - 0.1;
    const height = 0.115;
    const button = new SpatialButton({
      width,
      height,
      label,
      theme: this.options.theme,
      renderOrder: this.options.renderOrder + 3 + this.nextButtonIndex,
      dwellTime
    });
    button.onSelect = onSelect;
    this.object.add(button.object);
    this.buttons.push(button);
    this.nextButtonIndex += 1;
    this.layout();
    return button;
  }

  setVisible(visible: boolean): void {
    this.object.visible = visible;
  }

  private layout(): void {
    const { width, height } = this.options;
    const padding = 0.05;
    let cursor = height / 2 - padding;

    if (this.title && this.titleMesh) {
      const titleWidth = width - padding * 2;
      const titleHeight = titleWidth * this.title.aspect;
      this.titleMesh.scale.set(titleWidth, titleHeight, 1);
      this.titleMesh.position.set(-width / 2 + padding + titleWidth / 2, cursor - titleHeight / 2, 0.006);
      cursor -= titleHeight + 0.018;
    }

    if (this.body && this.bodyMesh) {
      const bodyWidth = width - padding * 2;
      const bodyHeight = bodyWidth * this.body.aspect;
      this.bodyMesh.scale.set(bodyWidth, bodyHeight, 1);
      this.bodyMesh.position.set(-width / 2 + padding + bodyWidth / 2, cursor - bodyHeight / 2, 0.006);
      cursor -= bodyHeight + 0.022;
    }

    const rowGap = 0.017;
    for (let i = 0; i < this.buttons.length; i += 1) {
      const button = this.buttons[i];
      const buttonHeight = 0.115;
      button.setPose(0, cursor - buttonHeight / 2, 0.01);
      cursor -= buttonHeight + rowGap;
    }
  }

  dispose(): void {
    for (let i = 0; i < this.buttons.length; i += 1) {
      this.buttons[i].dispose();
    }
    this.buttons.length = 0;
    if (this.title) {
      this.title.dispose();
      this.title = null;
    }
    if (this.titleMesh) {
      this.object.remove(this.titleMesh);
      this.titleMesh.geometry.dispose();
      (this.titleMesh.material as THREE.Material).dispose();
      this.titleMesh = null;
    }
    if (this.body) {
      this.body.dispose();
      this.body = null;
    }
    if (this.bodyMesh) {
      this.object.remove(this.bodyMesh);
      this.bodyMesh.geometry.dispose();
      (this.bodyMesh.material as THREE.Material).dispose();
      this.bodyMesh = null;
    }
    this.object.remove(this.panelMesh);
    this.panelGeometry.dispose();
    this.panelMaterial.dispose();
    this.panelTexture.dispose();
  }
}
