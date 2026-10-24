/**
 * Stable-heading sampler for the calibration step.
 *
 * The operator (or the patient's button) starts the window explicitly; the
 * sampler then averages the head orientation over a short interval and reports
 * how far the head wandered. An average over a still head is exactly what the
 * world frame wants, and the spread is the only honest "was the patient still?"
 * signal we have — no countdown, no silent fallback.
 *
 * Pure: no clock, no allocation per sample beyond the fixed ring.
 */

export interface QuatSample {
  x: number;
  y: number;
  z: number;
  w: number;
}

export interface SampleResult {
  ok: boolean;
  /** Mean orientation, normalized; undefined when no usable sample arrived. */
  quaternion?: QuatSample;
  /** Worst angle between any sample and the mean, in degrees. */
  deviationDeg: number;
  samples: number;
}

export interface CalibrationSamplerOptions {
  durationMs?: number;
  /** Above this spread the window is rejected. */
  maxDeviationDeg?: number;
  /** Hard cap on retained samples so a long window cannot grow unbounded. */
  capacity?: number;
}

export interface CalibrationSampler {
  start(nowMs: number): void;
  /** Feed one frame; returns the result once the window has elapsed. */
  add(sample: QuatSample, nowMs: number): SampleResult | null;
  reset(): void;
  isActive(): boolean;
}

const DEFAULT_DURATION_MS = 900;
const DEFAULT_MAX_DEVIATION_DEG = 6;
const DEFAULT_CAPACITY = 64;

function angleBetween(a: QuatSample, b: QuatSample): number {
  const dot = Math.abs(a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w);
  return (2 * Math.acos(Math.min(1, dot)) * 180) / Math.PI;
}

export function createCalibrationSampler(
  options: CalibrationSamplerOptions = {}
): CalibrationSampler {
  const durationMs = Math.max(100, options.durationMs ?? DEFAULT_DURATION_MS);
  const maxDeviationDeg = Math.max(0.5, options.maxDeviationDeg ?? DEFAULT_MAX_DEVIATION_DEG);
  const capacity = Math.max(4, options.capacity ?? DEFAULT_CAPACITY);

  const buf = new Float32Array(capacity * 4);
  let count = 0;
  let startedAt = 0;
  let active = false;

  function reset(): void {
    count = 0;
    startedAt = 0;
    active = false;
  }

  return {
    start(nowMs: number): void {
      reset();
      active = true;
      startedAt = nowMs;
    },

    add(sample: QuatSample, nowMs: number): SampleResult | null {
      if (!active) {
        return null;
      }
      const finite =
        Number.isFinite(sample.x) &&
        Number.isFinite(sample.y) &&
        Number.isFinite(sample.z) &&
        Number.isFinite(sample.w);
      if (finite && count < capacity) {
        const o = count * 4;
        // Hemisphere-align with the first sample: q and -q are the same pose,
        // and averaging across the sign flip would cancel the heading.
        const flip =
          count > 0 &&
          buf[0] * sample.x + buf[1] * sample.y + buf[2] * sample.z + buf[3] * sample.w < 0;
        const s = flip ? -1 : 1;
        buf[o] = sample.x * s;
        buf[o + 1] = sample.y * s;
        buf[o + 2] = sample.z * s;
        buf[o + 3] = sample.w * s;
        count += 1;
      }
      if (nowMs - startedAt < durationMs) {
        return null;
      }
      active = false;
      if (count === 0) {
        return { ok: false, deviationDeg: 0, samples: 0 };
      }
      let sx = 0;
      let sy = 0;
      let sz = 0;
      let sw = 0;
      for (let i = 0; i < count; i += 1) {
        sx += buf[i * 4];
        sy += buf[i * 4 + 1];
        sz += buf[i * 4 + 2];
        sw += buf[i * 4 + 3];
      }
      const norm = Math.hypot(sx, sy, sz, sw) || 1;
      const mean: QuatSample = { x: sx / norm, y: sy / norm, z: sz / norm, w: sw / norm };
      let worst = 0;
      for (let i = 0; i < count; i += 1) {
        const s = { x: buf[i * 4], y: buf[i * 4 + 1], z: buf[i * 4 + 2], w: buf[i * 4 + 3] };
        worst = Math.max(worst, angleBetween(mean, s));
      }
      return {
        ok: worst <= maxDeviationDeg,
        quaternion: mean,
        deviationDeg: worst,
        samples: count
      };
    },

    reset,
    isActive: () => active
  };
}
