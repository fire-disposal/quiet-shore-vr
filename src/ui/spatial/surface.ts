import * as THREE from 'three';
import type { SpatialTheme } from '../../core/spatial/theme';
import { DEFAULT_SPATIAL_THEME } from '../../core/spatial/theme';
import { SpatialButton } from './button';
import { TextTexture } from './text';

const UNIT_PLANE = new THREE.PlaneGeometry(1, 1);

export interface SpatialSurfaceOptions {
  width: number;
  height: number;
  theme?: SpatialTheme;
  title?: string;
  body?: string;
  /**
   * Vertical room (metres) to keep free at the bottom of the card, for rows the
   * caller places itself (a five-option answer strip, a pager). Without it the
   * body text is fitted to the full card and lands under those controls.
   */
  reserveBottom?: number;
  /** Per-card type scale; the theme's sizes are the default. */
  titlePx?: number;
  bodyPx?: number;
  /**
   * Header texture height as a multiple of `titlePx`. The surface's 1.35
   * default leaves a tall empty box that pushes the body down a card's worth.
   */
  titleEm?: number;
  /**
   * Resolution of the body texture. Glyph size on the card is bodyPx/texture
   * width, so raising both keeps the text crisp at a larger physical size.
   */
  bodyTexturePx?: number;
  renderOrder?: number;
  /**
   * Place header and body by explicit vertical anchors instead of stacking
   * them from the top. A card that must hold fixed rows below the body (a
   * dwell strip) cannot let the body's line count move those rows.
   */
  layout?: SpatialSurfaceLayout;
}

/** Card-local metres, measured from the centre of the panel. */
export interface SpatialSurfaceLayout {
  /** Top of the header text box. */
  headerTop: number;
  /** Space between the header box and the first body line. */
  headerGap: number;
  /** Bottom of the body's *single-line* block: two lines grow upwards. */
  bodyBottom: number;
  lineHeight: number;
  bodyColor: string;
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
  ctx.shadowColor = 'rgba(32, 37, 31, 0.3)';
  ctx.shadowBlur = 18;
  ctx.shadowOffsetY = 8;
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
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    toneMapped: false
  });
  const mesh = new THREE.Mesh(UNIT_PLANE, material);
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

  private readonly options: Required<
    Pick<SpatialSurfaceOptions, 'width' | 'height' | 'theme' | 'renderOrder' | 'reserveBottom'>
  > &
    Pick<
      SpatialSurfaceOptions,
      'title' | 'body' | 'titlePx' | 'titleEm' | 'bodyPx' | 'bodyTexturePx' | 'layout'
    >;
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
      reserveBottom: Math.max(0, options.reserveBottom ?? 0),
      title: options.title,
      body: options.body,
      titlePx: options.titlePx,
      titleEm: options.titleEm,
      bodyPx: options.bodyPx,
      bodyTexturePx: options.bodyTexturePx,
      layout: options.layout
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
        sizePx: this.options.titlePx ?? this.options.theme.titlePx,
        heightPx: Math.round((this.options.titlePx ?? this.options.theme.titlePx) * (this.options.titleEm ?? 1.35)),
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
    const layout = this.options.layout;
    if (!this.body) {
      const texturePx = this.options.bodyTexturePx ?? 512;
      this.body = new TextTexture({
        theme: this.options.theme,
        widthPx: texturePx,
        heightPx: texturePx / 2,
        sizePx: this.options.bodyPx ?? this.options.theme.bodyPx,
        weight: layout ? 650 : 400,
        color: layout ? layout.bodyColor : this.options.theme.muted,
        align: 'left',
        lineHeight: layout ? layout.lineHeight : 1.18
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
    const anchors = this.options.layout;
    let cursor = height / 2 - padding;

    if (anchors && this.title && this.titleMesh) {
      const textWidth = width - padding * 2;
      const headerHeight = textWidth * this.title.aspect;
      this.titleMesh.scale.set(textWidth, headerHeight, 1);
      this.titleMesh.position.set(
        -width / 2 + padding + textWidth / 2,
        anchors.headerTop - headerHeight / 2,
        0.006
      );

      // The body may arrive after the title (a card built from its header
      // first), so this branch places whatever exists and never stacks.
      if (!this.body || !this.bodyMesh) {
        return;
      }
      // The bottom of a one-line block is the anchor; a second line grows up
      // into the gap under the header instead of pushing towards the answers.
      const bodyPx = this.options.bodyPx ?? this.options.theme.bodyPx;
      const lineHeightM = (bodyPx * anchors.lineHeight) / (this.options.bodyTexturePx ?? 512);
      const headerBottom = anchors.headerTop - headerHeight;
      const capacity = headerBottom - anchors.headerGap - anchors.bodyBottom;
      if (capacity <= 0) {
        throw new Error('surface layout: no room for the body under the header');
      }
      // Exactly the body's own height, capped at the room between header and
      // rows: squeezing it would scale the glyphs off their 60 px design.
      const blockHeight = Math.min(capacity, this.body.aspect * textWidth);
      this.bodyMesh.scale.set(textWidth, blockHeight, 1);
      this.bodyMesh.position.set(-width / 2 + padding + textWidth / 2, anchors.bodyBottom + blockHeight / 2, 0.006);
      return;
    }

    if (this.title && this.titleMesh) {
      const titleWidth = width - padding * 2;
      const titleHeight = titleWidth * this.title.aspect;
      this.titleMesh.scale.set(titleWidth, titleHeight, 1);
      this.titleMesh.position.set(-width / 2 + padding + titleWidth / 2, cursor - titleHeight / 2, 0.006);
      cursor -= titleHeight + 0.018;
    }

    if (this.body && this.bodyMesh) {
      // Fit the body inside what is left of the panel: keep the texture's
      // aspect and shrink whichever dimension runs out first. A fixed
      // width-only fit made long copy spill below the card.
      const availWidth = width - padding * 2;
      const availHeight = Math.max(
        0.04,
        cursor + height / 2 - padding - 0.022 - this.options.reserveBottom
      );
      const aspect = this.body.aspect;
      let bodyWidth = availWidth;
      let bodyHeight = bodyWidth * aspect;
      if (bodyHeight > availHeight) {
        bodyHeight = availHeight;
        bodyWidth = bodyHeight / aspect;
      }
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
      (this.titleMesh.material as THREE.Material).dispose();
      this.titleMesh = null;
    }
    if (this.body) {
      this.body.dispose();
      this.body = null;
    }
    if (this.bodyMesh) {
      this.object.remove(this.bodyMesh);
      (this.bodyMesh.material as THREE.Material).dispose();
      this.bodyMesh = null;
    }
    this.object.remove(this.panelMesh);
    this.panelGeometry.dispose();
    this.panelMaterial.dispose();
    this.panelTexture.dispose();
  }
}
