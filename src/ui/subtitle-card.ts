import * as THREE from 'three';
import { SpatialAnchor } from '../core/spatial/anchor';
import type { SpatialTheme } from '../core/spatial/theme';
import { DEFAULT_SPATIAL_THEME } from '../core/spatial/theme';
import type { HeadPose } from '../core/xr/types';

/**
 * Subtitle card: the line the voice is speaking, in a head-locked bar below
 * the centre of the view.
 *
 * Same construction as the performance card (canvas → texture → head-locked
 * anchor), placed low instead of high so the two never stack. It is driven by
 * the voice module's `nowPlaying()`: a cue appearing calls `setLine(text)`, a
 * cue ending calls `setLine(null)`, which hides the card. Nothing here decides
 * timing — the audio does, so a long line stays up for its whole length.
 *
 * Chinese wraps per character; without that the whole sentence is one
 * unbreakable run and the card shows its first few glyphs.
 */

const CARD_WIDTH = 1.16;
const CARD_HEIGHT = 0.42;
const TEXT_PX = 30;
/** Three lines fits the longest shipped cue (~62 characters) at 30 px. */
const MAX_LINES = 3;

/** CJK glyphs and full-width marks are their own break opportunities. */
const CJK = /[\u2E80-\u9FFF\u3000-\u303F\uFF00-\uFFEF]/;

export class SubtitleCard {
  private readonly anchor: SpatialAnchor;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly texture: THREE.CanvasTexture;
  private readonly geometry: THREE.PlaneGeometry;
  private readonly material: THREE.MeshBasicMaterial;
  private readonly theme: SpatialTheme;
  private text: string | null = null;

  constructor(scene: THREE.Scene, theme: SpatialTheme = DEFAULT_SPATIAL_THEME) {
    this.theme = theme;
    this.anchor = new SpatialAnchor({
      mode: 'head-locked',
      distance: 1.35,
      // Below the centre line: the performance card owns the top third.
      heightOffset: -0.34,
      dampingSeconds: 0.08
    });
    this.anchor.object.name = 'subtitle-card';
    this.anchor.setVisible(false);
    scene.add(this.anchor.object);

    this.canvas = document.createElement('canvas');
    this.canvas.width = 1024;
    this.canvas.height = 384;
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

    this.geometry = new THREE.PlaneGeometry(CARD_WIDTH, CARD_HEIGHT);
    this.material = new THREE.MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      toneMapped: false
    });
    const mesh = new THREE.Mesh(this.geometry, this.material);
    mesh.renderOrder = 2090;
    this.anchor.object.add(mesh);
  }

  /** `null` hides the card: the line finished or nothing is speaking. */
  setLine(text: string | null): void {
    const next = text && text.trim().length > 0 ? text.trim() : null;
    if (next === this.text) {
      return;
    }
    this.text = next;
    this.anchor.setVisible(next !== null);
    if (next !== null) {
      this.draw(next);
      this.texture.needsUpdate = true;
    }
  }

  update(head: HeadPose, dt: number, now: number): void {
    if (this.text === null) {
      return;
    }
    this.anchor.update(head, dt, now);
  }

  isVisible(): boolean {
    return this.text !== null;
  }

  private wrap(text: string): { lines: string[]; truncated: boolean } {
    const ctx = this.ctx;
    const maxWidth = this.canvas.width - 96;
    const lines: string[] = [];
    let current = '';
    const tokens: string[] = [];
    let word = '';
    for (const char of Array.from(text)) {
      if (CJK.test(char) || char === ' ') {
        if (word.length > 0) {
          tokens.push(word);
          word = '';
        }
        tokens.push(char);
      } else {
        word += char;
      }
    }
    if (word.length > 0) {
      tokens.push(word);
    }
    let truncated = false;
    for (const token of tokens) {
      const candidate = current + token;
      if (ctx.measureText(candidate).width <= maxWidth || current.length === 0) {
        current = candidate;
        continue;
      }
      if (lines.length === MAX_LINES - 1) {
        // Filled every line: mark the cut instead of dropping a lone glyph
        // onto a fourth line.
        truncated = true;
        current = current.replace(/\s+$/, '');
        break;
      }
      lines.push(current.replace(/\s+$/, ''));
      current = token.replace(/^\s+/, '');
    }
    if (current.length > 0 && lines.length < MAX_LINES) {
      lines.push(truncated ? `${current}…` : current);
    }
    return { lines, truncated };
  }

  private draw(text: string): void {
    const ctx = this.ctx;
    const width = this.canvas.width;
    const height = this.canvas.height;
    ctx.clearRect(0, 0, width, height);

    ctx.font = `500 ${TEXT_PX}px ${this.theme.fontFamily}`;
    ctx.textBaseline = 'middle';
    const { lines } = this.wrap(text);

    const radius = 34;
    const pad = 6;
    ctx.beginPath();
    ctx.moveTo(pad + radius, pad);
    ctx.arcTo(width - pad, pad, width - pad, height - pad, radius);
    ctx.arcTo(width - pad, height - pad, pad, height - pad, radius);
    ctx.arcTo(pad, height - pad, pad, pad, radius);
    ctx.arcTo(pad, pad, width - pad, pad, radius);
    ctx.closePath();
    ctx.fillStyle = 'rgba(20, 24, 22, 0.62)';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(247, 243, 234, 0.22)';
    ctx.stroke();

    ctx.fillStyle = '#F6F1E6';
    ctx.textAlign = 'center';
    const lineHeight = TEXT_PX * 1.4;
    const startY = height / 2 - ((lines.length - 1) * lineHeight) / 2;
    for (let i = 0; i < lines.length; i += 1) {
      ctx.fillText(lines[i], width / 2, startY + i * lineHeight, width - 96);
    }
    ctx.textAlign = 'left';
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
    this.texture.dispose();
    this.anchor.dispose();
  }
}
