import { describe, expect, it } from 'vitest';
import {
  AUTO_RISE_CUE,
  AUTO_RISE_CUE_FALLBACK_MS,
  AUTO_RISE_CUE_MS,
  AUTO_RISE_GAP_MS,
  PREP_SCENE_ID,
  autoRiseDelayMs,
  autoRiseRefusal,
  shouldScheduleAutoRise,
  type AutoRiseFacts
} from '../src/app/auto-rise';

/** A live supine session with a landed capture, in a real scene. */
const READY: AutoRiseFacts = {
  sceneId: 'shore',
  restMix: 0,
  session: true,
  calibrated: true
};

describe('auto rise policy', () => {
  it('schedules a rise in a live, calibrated supine scene', () => {
    expect(shouldScheduleAutoRise(READY)).toBe(true);
    expect(autoRiseRefusal(READY)).toBeNull();
  });

  it('never schedules a rise in the preparation room', () => {
    // Prep is where the patient settles. The first motion of the session is not
    // the therapy — it is arriving somewhere.
    expect(shouldScheduleAutoRise({ ...READY, sceneId: PREP_SCENE_ID })).toBe(false);
    expect(autoRiseRefusal({ ...READY, sceneId: PREP_SCENE_ID })).toBe('prep-scene');
  });

  it('does not schedule a rise before the capture has landed', () => {
    expect(shouldScheduleAutoRise({ ...READY, calibrated: false })).toBe(false);
    expect(autoRiseRefusal({ ...READY, calibrated: false })).toBe('not-calibrated');
  });

  it('does not schedule a rise without a session', () => {
    expect(shouldScheduleAutoRise({ ...READY, session: false })).toBe(false);
    expect(autoRiseRefusal({ ...READY, session: false })).toBe('no-session');
  });

  it('does not schedule a rise in a standing scene', () => {
    expect(shouldScheduleAutoRise({ ...READY, restMix: 1 })).toBe(false);
    expect(autoRiseRefusal({ ...READY, restMix: 1 })).toBe('standing-scene');
  });

  it('names the prep room with the same constant the page uses', () => {
    expect(AUTO_RISE_CUE).toBe('v-rise-1');
    expect(AUTO_RISE_CUE_MS).toBeGreaterThan(0);
    expect(AUTO_RISE_GAP_MS).toBeGreaterThan(0);
  });

  it('waits out the cue before starting the ramp', () => {
    expect(autoRiseDelayMs(3500)).toBe(3500 + AUTO_RISE_GAP_MS);
  });

  it('falls back to the shipped clip length when the manifest is silent', () => {
    // A missing duration must not collapse the wait to the gap alone: that
    // would start the turn while the line is still being spoken.
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(autoRiseDelayMs(bad)).toBe(AUTO_RISE_CUE_FALLBACK_MS + AUTO_RISE_GAP_MS);
    }
  });
});
