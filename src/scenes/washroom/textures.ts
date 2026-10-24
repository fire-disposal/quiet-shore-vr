import * as THREE from 'three';

/**
 * Canvas surfaces for the washroom. Everything is procedural and small: a
 * 512² tile is plenty for a room the patient stands in, and it keeps the
 * upload cheap on the headset.
 *
 * Each painter is deliberately low-contrast. This is a room meant to be calm
 * to stand in front of, not a showroom: the detail that matters is the joint
 * lines and the soft mottling that stop the surfaces reading as flat colour.
 */

/** Deterministic PRNG so the room looks identical on every launch. */
export function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return function random(): number {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

function makeTexture(size: number, paint: (ctx: CanvasRenderingContext2D, size: number) => void): THREE.CanvasTexture | null {
  if (typeof document === 'undefined' || !document.createElement) {
    return null;
  }
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return null;
  }
  paint(ctx, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

/** Pale sage micro-cement: mottled, with a faint horizontal seam at waist height. */
export function wallTexture(): THREE.CanvasTexture | null {
  return makeTexture(512, (ctx, size) => {
    // Flat base: a baked vertical gradient would repeat with the tile and
    // cancel out. Vertical shading comes from the mesh's vertex tint instead.
    ctx.fillStyle = '#CBD1C4';
    ctx.fillRect(0, 0, size, size);

    // Micro-cement, not plaster with dirt: broad, very faint mottling only.
    const random = createRandom(0x51ce);
    for (let i = 0; i < 90; i += 1) {
      const alpha = 0.004 + random() * 0.008;
      const radius = 40 + random() * 90;
      const tone = random() > 0.5
        ? `rgba(255, 255, 250, ${alpha.toFixed(3)})`
        : `rgba(104, 110, 98, ${(alpha * 0.9).toFixed(3)})`;
      const blob = ctx.createRadialGradient(
        random() * size,
        random() * size,
        0,
        random() * size,
        random() * size,
        radius
      );
      blob.addColorStop(0, tone);
      blob.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = blob;
      ctx.fillRect(0, 0, size, size);
    }
  });
}

/** Warm grey stone floor with thin joints and a light speckle. */
export function floorTexture(): THREE.CanvasTexture | null {
  return makeTexture(512, (ctx, size) => {
    ctx.fillStyle = '#BCB5A7';
    ctx.fillRect(0, 0, size, size);

    const random = createRandom(0x7a11);
    for (let i = 0; i < 1400; i += 1) {
      const alpha = 0.03 + random() * 0.05;
      ctx.fillStyle = random() > 0.45
        ? `rgba(255, 252, 244, ${alpha.toFixed(3)})`
        : `rgba(92, 86, 76, ${(alpha * 0.9).toFixed(3)})`;
      const radius = 0.6 + random() * 2.2;
      ctx.beginPath();
      ctx.arc(random() * size, random() * size, radius, 0, Math.PI * 2);
      ctx.fill();
    }

    // Joints: two large-format slabs per tile, hairline only.
    ctx.strokeStyle = 'rgba(96, 90, 80, 0.22)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, size / 2);
    ctx.lineTo(size, size / 2);
    ctx.moveTo(size / 2, 0);
    ctx.lineTo(size / 2, size);
    ctx.stroke();
  });
}

/** Glazed ceramic: near-white, cool at the rim, warm towards the floor. */
export function ceramicTexture(): THREE.CanvasTexture | null {
  return makeTexture(256, (ctx, size) => {
    const base = ctx.createLinearGradient(0, 0, 0, size);
    base.addColorStop(0, '#FBFAF6');
    base.addColorStop(0.55, '#F3F1EA');
    base.addColorStop(1, '#E5E2D8');
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, size, size);
    // A single broad highlight is enough to read as glaze.
    const glow = ctx.createRadialGradient(size * 0.42, size * 0.3, 0, size * 0.42, size * 0.3, size * 0.6);
    glow.addColorStop(0, 'rgba(255, 255, 255, 0.55)');
    glow.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, size, size);
  });
}

/** Light oak for the privacy screen: vertical grain, no knots. */
export function oakTexture(): THREE.CanvasTexture | null {
  return makeTexture(256, (ctx, size) => {
    const base = ctx.createLinearGradient(0, 0, size, 0);
    base.addColorStop(0, '#C9A97C');
    base.addColorStop(0.5, '#BE9C70');
    base.addColorStop(1, '#CBAE84');
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, size, size);
    const random = createRandom(0x9c31);
    for (let i = 0; i < 60; i += 1) {
      const x = random() * size;
      ctx.strokeStyle = `rgba(120, 92, 62, ${(0.05 + random() * 0.08).toFixed(3)})`;
      ctx.lineWidth = 0.8 + random() * 1.6;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.bezierCurveTo(x + 6, size * 0.3, x - 6, size * 0.7, x, size);
      ctx.stroke();
    }
  });
}

/** Brushed stainless for the flush plate. */
export function metalTexture(): THREE.CanvasTexture | null {
  return makeTexture(128, (ctx, size) => {
    ctx.fillStyle = '#B7BCC0';
    ctx.fillRect(0, 0, size, size);
    const random = createRandom(0x4b1d);
    for (let i = 0; i < 200; i += 1) {
      const y = random() * size;
      ctx.strokeStyle = random() > 0.5
        ? `rgba(255, 255, 255, ${(0.04 + random() * 0.06).toFixed(3)})`
        : `rgba(60, 66, 70, ${(0.04 + random() * 0.06).toFixed(3)})`;
      ctx.lineWidth = 0.6;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(size, y);
      ctx.stroke();
    }
  });
}
