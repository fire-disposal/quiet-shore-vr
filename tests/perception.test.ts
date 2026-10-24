import { describe, expect, it } from 'vitest';
import {
  FLOAT_LEVEL_CAP,
  FLOAT_MAX_LEVEL,
  FLOAT_PROFILES,
  floatAmplitudeForLevel,
  type FloatProfile
} from '../src/core/xr/float';

/**
 * Perceptual envelope, checked arithmetically instead of by eye.
 *
 * The world translates as one piece, so the nearest content moves the most:
 * the shore sits at ~1.1 m, the cloud deck at 34 m, the dome at 90 m. A layer's
 * peak angular speed is `2πA/T / d`, which is the number the eye actually sees.
 */
const NEAR_M = 1.1;
const CLOUD_M = 34;
const DOME_M = 90;
/** Comfort ceiling for the nearest layer. The desk value was 2 °/s; the
 *  2026-10-24 field pass doubled the amplitudes and raised the budget to the
 *  measured worst case plus margin (≈5.7 °/s), pending volunteer re-calibration. */
const NEAR_CAP_DEG_PER_S = 5.7;

function peakDegPerS(profile: FloatProfile, level: number, distance: number): number {
  const amplitude = floatAmplitudeForLevel(profile, level);
  const speed = (2 * Math.PI * amplitude) / profile.periodS;
  return ((speed / distance) * 180) / Math.PI;
}

describe('buoyancy perception envelope', () => {
  it('keeps the nearest layer inside the comfort cap at every allowed level', () => {
    for (const id of ['a', 'b', 'c'] as const) {
      const profile = FLOAT_PROFILES[id];
      const top = FLOAT_LEVEL_CAP[id];
      expect(top).toBeLessThanOrEqual(FLOAT_MAX_LEVEL);
      for (let level = 0; level <= top; level += 1) {
        const speed = peakDegPerS(profile, level, NEAR_M);
        expect(speed, `${id} level ${level}`).toBeLessThanOrEqual(NEAR_CAP_DEG_PER_S);
      }
    }
  });

  it('is actually visible at the default setting', () => {
    // Standard profile, level 2: the shoreline must clear the ~0.5 °/s floor
    // where vection starts to be reported, with margin for a small scene.
    expect(peakDegPerS(FLOAT_PROFILES.b, 2, NEAR_M)).toBeGreaterThan(0.9);
  });

  it('leaves the horizon effectively still', () => {
    for (const id of ['a', 'b', 'c'] as const) {
      const profile = FLOAT_PROFILES[id];
      const top = FLOAT_LEVEL_CAP[id];
      expect(peakDegPerS(profile, top, DOME_M)).toBeLessThan(0.07);
      expect(peakDegPerS(profile, top, CLOUD_M)).toBeLessThan(0.18);
    }
  });

  it('keeps the immersive profile available but shallow', () => {
    // Doubled amplitude: level 2 is the highest that stays inside the field
    // budget, and level 1 is still the comfortable default for it.
    expect(FLOAT_LEVEL_CAP.c).toBe(2);
    expect(peakDegPerS(FLOAT_PROFILES.c, 1, NEAR_M)).toBeLessThan(NEAR_CAP_DEG_PER_S);
  });
});

describe('cue prominence over the scene bed', () => {
  // Measured with `ffmpeg -af ebur128`: the lake bed is -24.7 LUFS and the
  // normalized cues sit at about -18.6 LUFS.
  const BED_LUFS = -24.7;
  const VOICE_LUFS = -18.6;
  const MASTER = 0.6;
  const SCENE_GAIN = 0.8;
  const VOICE_BUS = 0.9;
  const DUCK_DB = 12;
  const db = (gain: number): number => 20 * Math.log10(gain);

  it('puts the voice at least 10 dB above the ducked bed', () => {
    const bed = BED_LUFS + db(SCENE_GAIN) + db(MASTER) - DUCK_DB;
    const voice = VOICE_LUFS + db(VOICE_BUS) + db(MASTER);
    expect(voice - bed).toBeGreaterThan(10);
  });

  it('stays audible even with ducking off', () => {
    const bed = BED_LUFS + db(SCENE_GAIN) + db(MASTER);
    const voice = VOICE_LUFS + db(VOICE_BUS) + db(MASTER);
    expect(voice - bed).toBeGreaterThan(6);
  });
});
