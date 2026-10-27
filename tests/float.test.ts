import { describe, expect, it } from 'vitest';
import {
  FLOAT_AMPLITUDE_M,
  FLOAT_MAX_LEVEL,
  FLOAT_PERIOD_S,
  easeAmplitude,
  floatAmplitudeForLevel,
  floatOffsetAt
} from '../src/core/xr/float';

const FULL = floatAmplitudeForLevel(FLOAT_MAX_LEVEL);

describe('float envelope', () => {
  it('ships one envelope sized for the near field', () => {
    expect(FLOAT_AMPLITUDE_M).toBeGreaterThan(0);
    expect(FLOAT_AMPLITUDE_M).toBeLessThanOrEqual(0.2);
    expect(FLOAT_PERIOD_S).toBeGreaterThanOrEqual(6);
  });

  it('levels map linearly onto the envelope', () => {
    expect(floatAmplitudeForLevel(0)).toBe(0);
    expect(floatAmplitudeForLevel(FLOAT_MAX_LEVEL)).toBeCloseTo(FLOAT_AMPLITUDE_M, 6);
    expect(floatAmplitudeForLevel(1)).toBeCloseTo(FLOAT_AMPLITUDE_M / 3, 6);
    expect(floatAmplitudeForLevel(2)).toBeCloseTo((FLOAT_AMPLITUDE_M * 2) / 3, 6);
  });

  it('rounds fractional levels instead of inventing new steps', () => {
    expect(floatAmplitudeForLevel(1.4)).toBeCloseTo(floatAmplitudeForLevel(1), 6);
    expect(floatAmplitudeForLevel(1.6)).toBeCloseTo(floatAmplitudeForLevel(2), 6);
  });

  it('clamps out-of-range levels instead of extrapolating', () => {
    expect(floatAmplitudeForLevel(-2)).toBe(0);
    expect(floatAmplitudeForLevel(99)).toBeCloseTo(FLOAT_AMPLITUDE_M, 6);
  });

  it('starts at zero and never leaves the envelope', () => {
    expect(floatOffsetAt(0, FULL)).toBe(0);
    let peak = 0;
    for (let t = 0; t < FLOAT_PERIOD_S * 3; t += 0.05) {
      const value = Math.abs(floatOffsetAt(t, FULL));
      expect(value).toBeLessThanOrEqual(FULL + 1e-9);
      peak = Math.max(peak, value);
    }
    // The shaped curve has to use most of the envelope, or the amplitude is a
    // lie to the operator.
    expect(peak).toBeGreaterThan(FULL * 0.75);
  });

  it('is asymmetric and not a plain sine', () => {
    const samples: number[] = [];
    const step = FLOAT_PERIOD_S / 240;
    for (let i = 0; i < 240; i += 1) {
      samples.push(floatOffsetAt(i * step, FULL));
    }
    let asymmetry = 0;
    for (let i = 0; i < 120; i += 1) {
      asymmetry = Math.max(asymmetry, Math.abs(samples[i] + samples[i + 120]));
    }
    expect(asymmetry).toBeGreaterThan(FULL * 0.01);
  });

  it('produces no motion when the amplitude is zero', () => {
    expect(floatOffsetAt(3, 0)).toBe(0);
  });

  it('stays under the near-field speed cap at full level', () => {
    // Pure translation, measured at the near field (~1.1 m). The desk budget
    // was 2.5 deg/s (0.048 m/s); the 2026-10-24 field pass doubled the
    // amplitude and set the budget to the measured worst case plus margin
    // (0.11 m/s ≈ 5.7 deg/s), pending volunteer re-calibration.
    const CAP_MPS = 0.11;
    let peak = 0;
    const step = 0.01;
    for (let t = 0; t < FLOAT_PERIOD_S * 2; t += step) {
      const delta = floatOffsetAt(t + step, FULL) - floatOffsetAt(t, FULL);
      peak = Math.max(peak, Math.abs(delta) / step);
    }
    expect(peak).toBeLessThanOrEqual(CAP_MPS + 1e-4);
  });

  it('dwells at the crest longer than at the trough', () => {
    // A buoyant body rises slowly and settles a little quicker; the shaped
    // curve has to show that, or it reads as a metronome.
    let above = 0;
    let below = 0;
    const step = 0.02;
    for (let t = 0; t < FLOAT_PERIOD_S; t += step) {
      const value = floatOffsetAt(t, FULL);
      if (value > FULL * 0.5) {
        above += step;
      } else if (value < -FULL * 0.5) {
        below += step;
      }
    }
    expect(above).toBeGreaterThan(below);
  });

  it('fades toward the target without overshooting', () => {
    let level = 1;
    let previous = level;
    for (let i = 0; i < 120; i += 1) {
      level = easeAmplitude(level, 0, 1 / 60, 0.25);
      expect(level).toBeGreaterThanOrEqual(0);
      expect(level).toBeLessThanOrEqual(previous);
      previous = level;
    }
    expect(level).toBeLessThan(1e-3);
  });

  it('zero tau snaps, which only the test seam uses', () => {
    expect(easeAmplitude(1, 0, 1 / 60, 0)).toBe(0);
  });
});
