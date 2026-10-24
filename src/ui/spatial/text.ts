import * as THREE from 'three';
import type { SpatialTheme } from '../../core/spatial/theme';

export interface TextTextureOptions {
  theme: SpatialTheme;
  widthPx?: number;
  heightPx?: number;
  sizePx: number;
  weight?: number;
  color?: string;
  align?: 'left' | 'center';
  paddingPx?: number;
  lineHeight?: number;
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  const paragraphs = text.split('\n');
  for (let p = 0; p < paragraphs.length; p += 1) {
    const paragraph = paragraphs[p];
    if (paragraph.length === 0) {
      lines.push('');
      continue;
    }
    const words = paragraph.split(/(\s+)/);
    let current = '';
    for (let i = 0; i < words.length; i += 1) {
      const word = words[i];
      const candidate = current + word;
      if (ctx.measureText(candidate).width <= maxWidth || current.length === 0) {
        current = candidate;
        continue;
      }
      lines.push(current.replace(/\s+$/, ''));
      current = word.replace(/^\s+/, '');
    }
    if (current.length > 0) {
      lines.push(current.replace(/\s+$/, ''));
    }
  }
  return lines;
}

/**
 * A reusable canvas-backed text texture. Redraws only when the text changes;
 * callers keep the mesh and swap the texture. Canvas dimensions are power-of-two
 * so mipmaps are safe on WebGL1.
 */
export class TextTexture {
  readonly texture: THREE.CanvasTexture;
  /** height / width; grows when long copy needs a taller texture. */
  aspect: number;

  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly options: Required<TextTextureOptions>;
  private lastText = '\u0000';

  constructor(options: TextTextureOptions) {
    this.options = {
      widthPx: options.widthPx ?? 512,
      heightPx: options.heightPx ?? 128,
      sizePx: options.sizePx,
      weight: options.weight ?? 600,
      color: options.color ?? options.theme.text,
      align: options.align ?? 'left',
      paddingPx: options.paddingPx ?? 24,
      lineHeight: options.lineHeight ?? 1.25,
      theme: options.theme
    };

    this.canvas = document.createElement('canvas');
    this.canvas.width = this.options.widthPx;
    this.canvas.height = this.options.heightPx;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) {
      throw new Error('2D canvas context unavailable');
    }
    this.ctx = ctx;

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    // Text is read at ~1 m and never minified, so mipmaps cost nothing but
    // would force power-of-two canvases. Exact sizes keep the mesh tight
    // against its glyphs, which is what makes a card look composed.
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.generateMipmaps = false;
    this.texture.anisotropy = 1;
    this.aspect = this.options.heightPx / this.options.widthPx;
  }

  setText(text: string): boolean {
    if (text === this.lastText) {
      return false;
    }
    this.lastText = text;
    this.draw(text);
    this.texture.needsUpdate = true;
    return true;
  }

  private draw(text: string): void {
    const { ctx, canvas } = this;
    const { sizePx, weight, color, align, paddingPx, lineHeight, theme } = this.options;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.font = `${weight} ${sizePx}px ${theme.fontFamily}`;
    ctx.fillStyle = color;
    ctx.textBaseline = 'middle';

    const lines = wrapText(ctx, text, canvas.width - paddingPx * 2);
    const lineHeightPx = sizePx * lineHeight;
    const totalHeight = lines.length * lineHeightPx;
    // Grow the canvas to the text instead of letting long copy fall outside
    // it: the surfaces scale the mesh by this texture's aspect, so a clipped
    // texture means text drawn under the card.
    const nextHeight = Math.max(48, Math.ceil(totalHeight + paddingPx * 2));
    if (canvas.height !== nextHeight) {
      canvas.height = nextHeight;
      ctx.font = `${weight} ${sizePx}px ${theme.fontFamily}`;
      ctx.fillStyle = color;
      ctx.textBaseline = 'middle';
      this.aspect = canvas.height / canvas.width;
    }
    const startY = (canvas.height - totalHeight) / 2 + lineHeightPx / 2;
    ctx.textAlign = align === 'center' ? 'center' : 'left';
    const x = align === 'center' ? canvas.width / 2 : paddingPx;

    for (let i = 0; i < lines.length; i += 1) {
      ctx.fillText(lines[i], x, startY + i * lineHeightPx);
    }
  }

  dispose(): void {
    this.texture.dispose();
  }
}
