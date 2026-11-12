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

/** Ink at 6%: the pressed state of a light button, no second fill colour. */
const PRESSED_INK = 'rgba(22, 22, 22, 0.06)';
/** Edge inset of the canvas; the hover line sits on the fill's own edge. */
const EDGE_PAD = 2;
const INSET_PX = 24;

function drawButton(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  label: string,
  theme: SpatialTheme,
  focused: boolean,
  pressed: boolean,
  enabled: boolean,
  chosen: boolean
): void {
  ctx.clearRect(0, 0, width, height);
  // Square corners: the variant has no radius, and a 1 px rule is the whole
  // edge treatment. Nothing is stacked on top of the fill.
  const left = EDGE_PAD;
  const top = EDGE_PAD;
  const boxW = width - EDGE_PAD * 2;
  const boxH = height - EDGE_PAD * 2;
  const active = enabled && (focused || chosen);

  // Ice marks "current / pressable": focused or recorded, always as a fill
  // with ink type on it. Hover is the same fill, pressed only adds a breath of
  // ink over it.
  if (active) {
    ctx.fillStyle = theme.accent;
  } else {
    ctx.fillStyle = theme.panelStrong;
  }
  ctx.fillRect(left, top, boxW, boxH);
  if (enabled && pressed) {
    ctx.fillStyle = active ? 'rgba(22, 22, 22, 0.10)' : PRESSED_INK;
    ctx.fillRect(left, top, boxW, boxH);
  }

  // One hairline, never a coloured outline. The rule is drawn inside the fill
  // so the two edges cannot read as a doubled line.
  ctx.lineWidth = 1;
  ctx.strokeStyle = enabled ? theme.border : 'rgba(22, 22, 22, 0.08)';
  ctx.strokeRect(left + 0.5, top + 0.5, boxW - 1, boxH - 1);

  ctx.fillStyle = !enabled ? theme.muted : active ? theme.accentText : theme.text;
  // Type follows the button's own height, not a fixed pixel size: a 0.13 m
  // button on a 512x128 canvas drew its label at a third of the height, which
  // read as a tiny caption inside a large card. 0.46 rather than 0.4 lifts the
  // label a step without touching the geometry.
  const fontPx = Math.round(Math.max(20, height * 0.46));
  ctx.font = `600 ${fontPx}px ${theme.fontFamily}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, width / 2, height / 2 + 1, width - INSET_PX * 2);
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
  private readonly barGeometry: THREE.PlaneGeometry;
  private readonly barMaterial: THREE.MeshBasicMaterial;
  private readonly bar: THREE.Mesh;
  private readonly theme: SpatialTheme;
  private readonly width: number;
  private readonly height: number;
  private label: string;
  private focused = false;
  private pressed = false;
  private enabled = true;
  private chosen = false;
  private progress = 0;
  private pressTimer = 0;

  constructor(options: SpatialButtonOptions) {
    this.theme = options.theme;
    this.label = options.label;
    this.width = options.width;
    this.height = options.height;
    this.canvas = document.createElement('canvas');
    this.canvas.width = 512;
    // Match the metre aspect so the label is not stretched across a 4:1 canvas.
    this.canvas.height = Math.max(
      64,
      Math.round((512 * options.height) / Math.max(0.01, options.width))
    );
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

    // Flat bar inside the lower edge; no texture upload while dwelling.
    this.barGeometry = new THREE.PlaneGeometry(1, 0.018);
    this.barMaterial = new THREE.MeshBasicMaterial({
      color: options.theme.accent,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      toneMapped: false
    });
    this.bar = new THREE.Mesh(this.barGeometry, this.barMaterial);
    this.bar.renderOrder = (options.renderOrder ?? 1001) + 1;
    this.bar.position.set(0, -options.height / 2 + 0.03, 0.002);
    this.bar.visible = false;
    this.object.add(this.bar);

    this.interactable = {
      object: this.mesh,
      layer: 'ui',
      dwellTime: options.dwellTime ?? 0,
      progressDisplay: 'self',
      enabled: true,
      onFocus: (focused: boolean) => this.setFocused(focused),
      onProgress: (progress: number) => this.setProgress(progress),
      onSelect: () => this.activate()
    };

    this.draw();
  }

  setFocused(focused: boolean): void {
    if (focused === this.focused) {
      return;
    }
    this.focused = focused;
    this.syncBarColor();
    this.draw();
  }

  /**
   * The bar rides the button's own bottom edge, so it must stay visible against
   * whichever fill it sits on: ink on an accent fill, accent on white paper.
   * It tracks the same `focused || chosen` state the fill does.
   */
  private syncBarColor(): void {
    const onAccent = this.focused || this.chosen;
    this.barMaterial.color.set(onAccent ? this.theme.accentText : this.theme.accent);
  }

  setEnabled(enabled: boolean): void {
    if (enabled === this.enabled) {
      return;
    }
    this.enabled = enabled;
    // `enabled` is what the input layer reads; a disabled button must not be
    // registered as a target at all, or a gaze on it stalls with no feedback.
    this.interactable.enabled = enabled;
    this.draw();
  }

  /** The recorded answer: accent fill, no extra words on the card. */
  setChosen(chosen: boolean): void {
    if (chosen === this.chosen) {
      return;
    }
    this.chosen = chosen;
    this.syncBarColor();
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

  private setProgress(progress: number): void {
    const value = Math.max(0, Math.min(1, progress));
    if (value === this.progress) {
      return;
    }
    this.progress = value;
    const barWidth = Math.max(0.02, this.width - 0.09);
    this.bar.visible = value > 0.001;
    if (!this.bar.visible) {
      return;
    }
    this.bar.scale.x = Math.max(0.0001, barWidth * value);
    this.bar.position.x = -barWidth / 2 + (barWidth * value) / 2;
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
      this.enabled,
      this.chosen
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
    this.object.remove(this.bar);
    this.barGeometry.dispose();
    this.barMaterial.dispose();
  }
}
