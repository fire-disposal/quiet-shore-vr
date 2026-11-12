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
/**
 * Quiet reading size: at 1.35 m the plane is 1024 px ≈ 1.527 m wide, so 26 px
 * is about 4.2 cm per glyph — eight glyphs narrower than the old 30 px. The
 * card carries the spoken line, not a headline.
 */
const TEXT_PX = 26;
/**
 * 1.6 rather than 1.4: Chinese has no ascender/descender to separate lines, so
 * the lines need the extra air to read as a paragraph instead of a block.
 */
const LINE_HEIGHT = 1.6;
/** Three lines fits the longest shipped cue (~62 characters) at 26 px. */
const MAX_LINES = 3;
/** Patient-facing type is sans and bold; the theme's serif stays for surfaces. */
const SANS_FONT = '"Noto Sans CJK SC", "Source Han Sans SC", "Noto Sans SC", "PingFang SC", sans-serif';
/** Text column in canvas pixels: the card's 1024 px less 48 px of side padding. */
const TEXT_WIDTH_PX = 1024 - 96;
/** Glyphs per line, for the backstop that keeps a runaway cue inside the card. */
const GLYPHS_PER_LINE = Math.floor(TEXT_WIDTH_PX / TEXT_PX);
const MAX_CHARS = MAX_LINES * GLYPHS_PER_LINE;

/** CJK glyphs and full-width marks are their own break opportunities. */
const CJK = /[\u2E80-\u9FFF\u3000-\u303F\uFF00-\uFFEF]/;
/** A line may not begin with closing punctuation, nor end with opening it. */
const NO_LINE_START = /^[，。、；：？！）」』】》〉…·]$/;
const NO_LINE_END = /^[（「『【《〈]$/;

export class SubtitleCard {
  private readonly anchor: SpatialAnchor;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly texture: THREE.CanvasTexture;
  private readonly geometry: THREE.PlaneGeometry;
  private readonly material: THREE.MeshBasicMaterial;
  private text: string | null = null;

  /**
   * `theme` is accepted for symmetry with the other spatial UI and ignored: the
   * subtitle line uses the accent-free palette below, not the card theme.
   */
  constructor(scene: THREE.Scene, _theme: SpatialTheme = DEFAULT_SPATIAL_THEME) {
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
    const next = text && text.trim().length > 0
      ? this.fitSentences(this.densify(text.trim()))
      : null;
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

  /**
   * A spoken line with no break of its own becomes one dense block. Split it
   * into sentences, one per line, while a line is still worth reading on its
   * own — a short tail would rather share a line than hang under a full one.
   */
  private densify(text: string): string {
    if (text.includes('\n') || Array.from(text).length <= GLYPHS_PER_LINE) {
      return text;
    }
    const sentences = text.match(/[^。！？]+[。！？]?/g);
    if (!sentences || sentences.length <= 1) {
      return text;
    }
    return sentences
      .map((sentence) => sentence.trim())
      .filter((sentence) => sentence.length > 0)
      .join('\n');
  }

  /**
   * Elide the middle of anything longer than the card can hold. The end of a
   * cue ("……可以告诉我。") is the part that matters, so the head is cut first.
   */
  private fitSentences(text: string): string {
    const chars = Array.from(text);
    if (chars.length <= MAX_CHARS) {
      return text;
    }
    const head = Math.floor(MAX_CHARS * 0.4);
    const tail = MAX_CHARS - head - 1;
    return `${chars.slice(0, head).join('')}…${chars.slice(chars.length - tail).join('')}`;
  }

  private wrap(text: string): { lines: string[]; truncated: boolean } {
    const ctx = this.ctx;
    const maxWidth = this.canvas.width - 96;
    const lines: string[] = [];
    const paragraphs = text.split('\n');
    let truncated = false;
    // A paragraph boundary is a real break: two sentences each keep their own
    // line rather than one line ending mid-sentence.
    for (let p = 0; p < paragraphs.length; p += 1) {
      const paragraph = paragraphs[p];
      if (paragraph.length === 0) {
        continue;
      }
      let current = '';
      const tokens: string[] = [];
      let word = '';
      for (const char of Array.from(paragraph)) {
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
      for (const token of tokens) {
        const candidate = current + token;
        const fits = ctx.measureText(candidate).width <= maxWidth;
        // Keep closing punctuation off the start of a line and opening marks
        // off its end, unless the line would otherwise be a single glyph.
        const legalBreak = NO_LINE_START.test(token)
          ? true
          : !NO_LINE_END.test(current.slice(-1));
        if (fits || current.length === 0 || !legalBreak) {
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
      if (truncated) {
        break;
      }
      if (current.length > 0 && lines.length < MAX_LINES) {
        lines.push(current.replace(/\s+$/, ''));
      }
    }
    if (truncated && lines.length > 0) {
      lines[lines.length - 1] = `${lines[lines.length - 1].replace(/\s+$/, '')}…`;
    }
    return { lines, truncated };
  }

  private draw(text: string): void {
    const ctx = this.ctx;
    const width = this.canvas.width;
    const height = this.canvas.height;
    ctx.clearRect(0, 0, width, height);

    ctx.font = `700 ${TEXT_PX}px ${SANS_FONT}`;
    ctx.textBaseline = 'middle';
    const { lines } = this.wrap(text);

    // A flat scrim, not a card: the scene stays visible behind the line and
    // nothing here competes with it for attention.
    const pad = 4;
    ctx.beginPath();
    ctx.rect(pad, pad, width - pad * 2, height - pad * 2);
    ctx.fillStyle = 'rgba(20, 24, 22, 0.5)';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(247, 243, 234, 0.18)';
    ctx.stroke();

    ctx.fillStyle = '#F6F1E6';
    ctx.textAlign = 'center';
    const lineHeight = TEXT_PX * LINE_HEIGHT;
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
