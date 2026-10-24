import * as THREE from 'three';
import { createRandom, makeTexture as paintTexture } from '../shared/canvas';

/**
 * Canvas surfaces for the ward. Everything is procedural and small: the room is
 * seen from a bed, three metres of nothing between the eye and the far wall, so
 * 256² is plenty and the upload stays cheap on the headset.
 *
 * Five textures carry ten draws: the linen, duvet and curtain all reuse the one
 * fabric weave and differ only by material colour, which is what keeps this
 * scene inside the same six-texture budget as the rest of the app.
 */

function makeTexture(
  width: number,
  height: number,
  paint: (ctx: CanvasRenderingContext2D, width: number, height: number) => void
): THREE.CanvasTexture | null {
  return paintTexture(paint, { width, height, repeat: [1, 1] });
}

/**
 * Painted plasterboard: one tile is 2 m, so a 256² tile is 8 mm per pixel — the
 * mottling reads as paint tooth from the bed, not as noise.
 */
export function wallTexture(): THREE.CanvasTexture | null {
  return makeTexture(256, 256, (ctx, width, height) => {
    // Flat base: a baked vertical gradient would tile every two metres and read
    // as banding. Directional shading comes from the mesh's vertex tint.
    ctx.fillStyle = '#E3E7E1';
    ctx.fillRect(0, 0, width, height);

    const random = createRandom(0x51a7c3);
    for (let i = 0; i < 60; i += 1) {
      const cx = random() * width;
      const cy = random() * height;
      const radius = 18 + random() * 46;
      const blot = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
      blot.addColorStop(0, `rgba(146,156,148,${(0.02 + random() * 0.035).toFixed(3)})`);
      blot.addColorStop(1, 'rgba(146,156,148,0)');
      ctx.fillStyle = blot;
      ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);
    }

    // Roller streaks: vertical, one or two pixels wide, barely there.
    for (let i = 0; i < 70; i += 1) {
      ctx.fillStyle = `rgba(206,210,204,${(0.05 + random() * 0.06).toFixed(3)})`;
      ctx.fillRect(random() * width, 0, 1 + random() * 2, height);
    }

    for (let i = 0; i < 900; i += 1) {
      ctx.fillStyle = `rgba(112,124,118,${(0.02 + random() * 0.04).toFixed(3)})`;
      ctx.fillRect(random() * width, random() * height, 1, 1 + random());
    }
  });
}

/**
 * Medical sheet vinyl: one tile is 1.2 m, drawn as 2×2 welded 600 mm sheets.
 * The floor is only a sliver beyond the footboard, so the seams are what sells
 * it — no gloss gradient (it would tile visibly).
 */
export function floorTexture(): THREE.CanvasTexture | null {
  return makeTexture(256, 256, (ctx, width, height) => {
    const random = createRandom(0x2c81f5);
    ctx.fillStyle = '#C6CBC8';
    ctx.fillRect(0, 0, width, height);

    for (let y = 0; y < 2; y += 1) {
      for (let x = 0; x < 2; x += 1) {
        const tone = 194 + Math.floor(random() * 10);
        ctx.fillStyle = `rgb(${tone},${tone + 4},${tone + 2})`;
        ctx.fillRect(x * 128 + 1.5, y * 128 + 1.5, 125, 125);
      }
    }

    // Welded seam: a dark line with the bead's highlight on one side.
    ctx.strokeStyle = 'rgba(126,134,130,0.5)';
    ctx.lineWidth = 2;
    for (let i = 0; i <= 2; i += 1) {
      ctx.beginPath();
      ctx.moveTo(i * 128, 0);
      ctx.lineTo(i * 128, height);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, i * 128);
      ctx.lineTo(width, i * 128);
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(238,242,238,0.5)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 2; i += 1) {
      ctx.beginPath();
      ctx.moveTo(i * 128 + 1.5, 0);
      ctx.lineTo(i * 128 + 1.5, height);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, i * 128 + 1.5);
      ctx.lineTo(width, i * 128 + 1.5);
      ctx.stroke();
    }

    for (let i = 0; i < 1800; i += 1) {
      ctx.fillStyle = `rgba(118,128,124,${(0.02 + random() * 0.06).toFixed(3)})`;
      ctx.fillRect(random() * width, random() * height, 1 + random(), 1 + random());
    }
  });
}

/**
 * A plain cotton weave, near-white so three materials can tint it: the linen,
 * the duvet and the curtain. One metre per tile, so the weave is 4 mm thread.
 */
export function fabricTexture(): THREE.CanvasTexture | null {
  return makeTexture(256, 256, (ctx, width, height) => {
    const random = createRandom(0x3f9d2b);
    ctx.fillStyle = '#F3F3EF';
    ctx.fillRect(0, 0, width, height);

    for (let x = 0; x < width; x += 2) {
      ctx.fillStyle = 'rgba(122,126,120,0.07)';
      ctx.fillRect(x, 0, 1, height);
    }
    for (let y = 0; y < height; y += 2) {
      ctx.fillStyle = 'rgba(255,255,255,0.32)';
      ctx.fillRect(0, y, width, 1);
    }

    // Slack in the weave: a few soft creases, never a printed pattern.
    for (let i = 0; i < 22; i += 1) {
      const cx = random() * width;
      const cy = random() * height;
      const radius = 10 + random() * 24;
      const crease = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
      crease.addColorStop(0, 'rgba(176,178,170,0.09)');
      crease.addColorStop(1, 'rgba(176,178,170,0)');
      ctx.fillStyle = crease;
      ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);
    }
  });
}

/**
 * The monitor's face: grid, three vitals and a lead label. The waveform lives
 * on its own strip so it can scroll without repainting anything.
 */
export function screenTexture(): THREE.CanvasTexture | null {
  return makeTexture(256, 128, (ctx, width, height) => {
    ctx.fillStyle = '#061014';
    ctx.fillRect(0, 0, width, height);

    ctx.strokeStyle = 'rgba(40,120,110,0.24)';
    ctx.lineWidth = 1;
    for (let x = 0; x <= width; x += 32) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
    for (let y = 0; y <= height; y += 32) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }

    ctx.fillStyle = 'rgba(10,24,26,0.9)';
    ctx.fillRect(0, 0, width, 34);

    ctx.font = 'bold 10px monospace';
    ctx.fillStyle = '#8AF3C5';
    ctx.fillText('HR', 8, 13);
    ctx.font = 'bold 23px monospace';
    ctx.fillText('72', 8, 33);

    ctx.font = 'bold 9px monospace';
    ctx.fillStyle = '#7FDCFF';
    ctx.fillText('SpO2', 96, 13);
    ctx.font = 'bold 18px monospace';
    ctx.fillText('98', 96, 32);

    ctx.font = 'bold 9px monospace';
    ctx.fillStyle = '#FFD88A';
    ctx.fillText('NIBP', 162, 13);
    ctx.font = 'bold 13px monospace';
    ctx.fillText('118/76', 158, 31);

    ctx.font = '9px monospace';
    ctx.fillStyle = 'rgba(150,235,205,0.6)';
    ctx.fillText('LEAD II', 8, 48);
    ctx.fillStyle = 'rgba(200,225,235,0.45)';
    ctx.fillText('25 mm/s', 188, 48);

    // The baseline the strip of waveform rides on.
    ctx.strokeStyle = 'rgba(60,150,130,0.18)';
    ctx.beginPath();
    ctx.moveTo(6, 84);
    ctx.lineTo(width - 6, 84);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(90,240,190,0.26)';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, width - 2, height - 2);
  });
}

/**
 * One ECG strip: two complete complexes, seamless left to right, drawn on
 * transparent. Animation is a texture offset, so no pixels are re-uploaded.
 */
export function ecgTexture(): THREE.CanvasTexture | null {
  return makeTexture(256, 64, (ctx, width, height) => {
    ctx.clearRect(0, 0, width, height);

    const bump = (phase: number, centre: number, spread: number): number => {
      const d = (phase - centre) / spread;
      return Math.exp(-d * d);
    };
    const shape = (phase: number): number => {
      let out = 0;
      out += 0.055 * bump(phase, 0.14, 0.03); // P
      out -= 0.115 * bump(phase, 0.262, 0.009);
      out += 0.95 * bump(phase, 0.292, 0.01); // R
      out -= 0.24 * bump(phase, 0.325, 0.011); // S
      out += 0.17 * bump(phase, 0.52, 0.052); // T
      return out;
    };

    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#62F0B6';
    ctx.shadowColor = 'rgba(70,240,180,0.7)';
    ctx.shadowBlur = 4;
    ctx.beginPath();
    for (let x = 0; x <= width; x += 1) {
      const phase = ((x / width) * 2) % 1;
      const y = height * 0.62 - shape(phase) * height * 0.5;
      if (x === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.stroke();
    ctx.shadowBlur = 0;
  });
}
