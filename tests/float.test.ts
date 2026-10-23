import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FLOAT_PROFILE,
  FLOAT_MAX_LEVEL,
  FLOAT_PROFILES,
  easeAmplitude,
  floatAmplitudeForLevel,
  floatOffsetAt,
  floatPitchAt,
  isFloatProfileId
} from '../src/core/xr/float';

describe('float profiles', () => {
  it('ships three selectable profiles with the default present', () => {
    expect(Object.keys(FLOAT_PROFILES).sort()).toEqual(['a', 'b', 'c']);
    expect(FLOAT_PROFILES[DEFAULT_FLOAT_PROFILE]).toBeDefined();
    expect(isFloatProfileId('a')).toBe(true);
    expect(isFloatProfileId('z')).toBe(false);
  });

  it('keeps every profile inside the comfort envelope', () => {
    for (const profile of Object.values(FLOAT_PROFILES)) {
      expect(profile.amplitudeM).toBeGreaterThan(0);
      expect(profile.amplitudeM).toBeLessThanOrEqual(0.12);
      expect(profile.periodS).toBeGreaterThanOrEqual(6);
      expect(profile.pitchSwayDeg).toBeLessThanOrEqual(2);
    }
  });

  it('levels map linearly onto the profile amplitude', () => {
    const profile = FLOAT_PROFILES.b;
    expect(floatAmplitudeForLevel(profile, 0)).toBe(0);
    expect(floatAmplitudeForLevel(profile, FLOAT_MAX_LEVEL)).toBeCloseTo(profile.amplitudeM, 6);
    expect(floatAmplitudeForLevel(profile, 1)).toBeCloseTo(profile.amplitudeM / 3, 6);
    expect(floatAmplitudeForLevel(profile, 2)).toBeCloseTo((profile.amplitudeM * 2) / 3, 6);
  });

  it('rounds fractional levels instead of inventing new steps', () => {
    const profile = FLOAT_PROFILES.a;
    expect(floatAmplitudeForLevel(profile, 1.4)).toBeCloseTo(floatAmplitudeForLevel(profile, 1), 6);
    expect(floatAmplitudeForLevel(profile, 1.6)).toBeCloseTo(floatAmplitudeForLevel(profile, 2), 6);
  });

  it('clamps out-of-range levels instead of extrapolating', () => {
    const profile = FLOAT_PROFILES.c;
    expect(floatAmplitudeForLevel(profile, -2)).toBe(0);
    expect(floatAmplitudeForLevel(profile, 99)).toBeCloseTo(profile.amplitudeM, 6);
  });

  it('never leaves the amplitude envelope', () => {
    for (const profile of Object.values(FLOAT_PROFILES)) {
      const amplitude = floatAmplitudeForLevel(profile, FLOAT_MAX_LEVEL);
      for (let t = 0; t < profile.periodS * 3; t += 0.1) {
        expect(Math.abs(floatOffsetAt(profile, t, amplitude))).toBeLessThanOrEqual(amplitude + 1e-9);
      }
    }
  });

  it('starts at zero and stays inside the envelope for the whole cycle', () => {
    const profile = FLOAT_PROFILES.b;
    const amplitude = floatAmplitudeForLevel(profile, FLOAT_MAX_LEVEL);
    expect(floatOffsetAt(profile, 0, amplitude)).toBe(0);
    let peak = 0;
    for (let t = 0; t < profile.periodS * 3; t += 0.05) {
      const value = Math.abs(floatOffsetAt(profile, t, amplitude));
      expect(value).toBeLessThanOrEqual(amplitude + 1e-9);
      peak = Math.max(peak, value);
    }
    // The shaped curve must actually use most of the envelope, otherwise the
    // profile amplitude is a lie to the operator.
    expect(peak).toBeGreaterThan(amplitude * 0.75);
  });

  it('is asymmetric and not a plain sine', () => {
    const profile = FLOAT_PROFILES.b;
    const amplitude = floatAmplitudeForLevel(profile, FLOAT_MAX_LEVEL);
    // Sample one cycle and compare the first half with the mirrored second half.
    const samples: number[] = [];
    const step = profile.periodS / 240;
    for (let i = 0; i < 240; i += 1) {
      samples.push(floatOffsetAt(profile, i * step, amplitude));
    }
    let asymmetry = 0;
    for (let i = 0; i < 120; i += 1) {
      asymmetry = Math.max(asymmetry, Math.abs(samples[i] + samples[i + 120]));
    }
    expect(asymmetry).toBeGreaterThan(amplitude * 0.01);
  });

  it('produces no motion when the level is off', () => {
    const profile = FLOAT_PROFILES.c;
    expect(floatOffsetAt(profile, 3, 0)).toBe(0);
    expect(floatPitchAt(profile, 3, 0)).toBe(0);
  });

  it('only the immersive profile sways the horizon, and stays within its limit', () => {
    for (const profile of Object.values(FLOAT_PROFILES)) {
      const amplitude = floatAmplitudeForLevel(profile, FLOAT_MAX_LEVEL);
      for (let t = 0; t < profile.periodS; t += 0.25) {
        const pitch = floatPitchAt(profile, t, amplitude);
        expect(Math.abs(pitch)).toBeLessThanOrEqual(profile.pitchSwayDeg + 1e-9);
        if (profile.pitchSwayDeg === 0) {
          expect(pitch).toBe(0);
        }
      }
    }
    expect(FLOAT_PROFILES.c.pitchSwayDeg).toBeGreaterThan(0);
  });

  it('scales the sway with the intensity, never beyond the profile', () => {
    const profile = FLOAT_PROFILES.c;
    const full = floatAmplitudeForLevel(profile, FLOAT_MAX_LEVEL);
    const third = floatAmplitudeForLevel(profile, 1);
    const peak = (amplitude: number): number => {
      let max = 0;
      for (let t = 0; t < profile.periodS; t += 0.1) {
        max = Math.max(max, Math.abs(floatPitchAt(profile, t, amplitude)));
      }
      return max;
    };
    expect(peak(third)).toBeLessThan(peak(full));
    expect(peak(full)).toBeCloseTo(profile.pitchSwayDeg, 3);
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
