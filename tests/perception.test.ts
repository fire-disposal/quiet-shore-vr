import { describe, expect, it } from 'vitest';
import { FLOAT_AMPLITUDE_M, FLOAT_MAX_LEVEL, FLOAT_PERIOD_S, floatAmplitudeForLevel } from '../src/core/xr/float';

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

function peakDegPerS(level: number, distance: number): number {
  const amplitude = floatAmplitudeForLevel(level);
  const speed = (2 * Math.PI * amplitude) / FLOAT_PERIOD_S;
  return ((speed / distance) * 180) / Math.PI;
}

describe('buoyancy perception envelope', () => {
  it('keeps the nearest layer inside the comfort cap at every level', () => {
    for (let level = 0; level <= FLOAT_MAX_LEVEL; level += 1) {
      expect(peakDegPerS(level, NEAR_M)).toBeLessThanOrEqual(NEAR_CAP_DEG_PER_S);
    }
  });

  it('is actually visible at the working level', () => {
    // Level 3: the shoreline must clear the ~0.5 °/s floor where vection starts
    // to be reported, with margin for a small scene.
    expect(peakDegPerS(FLOAT_MAX_LEVEL, NEAR_M)).toBeGreaterThan(0.9);
    expect(peakDegPerS(2, NEAR_M)).toBeGreaterThan(0.5);
  });

  it('leaves the horizon effectively still', () => {
    expect(peakDegPerS(FLOAT_MAX_LEVEL, DOME_M)).toBeLessThan(0.07);
    expect(peakDegPerS(FLOAT_MAX_LEVEL, CLOUD_M)).toBeLessThan(0.18);
  });

  it('uses the envelope the operator asked for', () => {
    expect(floatAmplitudeForLevel(FLOAT_MAX_LEVEL)).toBeCloseTo(FLOAT_AMPLITUDE_M, 6);
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
