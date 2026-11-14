/**
 * When — and whether — the page lifts the world on its own.
 *
 * The rise is the therapy: a supine patient watches the world turn until their
 * forward is the front wall. It is also the one motion nobody asked for at that
 * moment, so the rules for firing it are worth stating once, as data:
 *
 * 1. **Never in the preparation room.** Prep is where the patient settles and
 *    gets used to the headset. Turning the ceiling under them there would be the
 *    first thing they experience, before any consent or posture check.
 * 2. **Only in a scene that actually rests supine.** A standing scene has
 *    nothing to lift, so the cue would announce a turn that never happens.
 * 3. **Only once the capture has landed**, because the ramp is built on the
 *    frame the capture recorded.
 * 4. **Only after the cue has actually sounded.** The line says what is about
 *    to happen; a world that turns while the cue is missing turns without
 *    warning, which is the one thing a supine patient cannot brace for.
 */

/** Scene id of the neutral first room; a rise is never scheduled here. */
export const PREP_SCENE_ID = 'prep';

/** Milliseconds from the capture landing to the cue. */
export const AUTO_RISE_CUE_MS = 6000;
/** Silence after the cue before the ramp starts. */
export const AUTO_RISE_GAP_MS = 2000;

/** Cue id that announces the rise. */
export const AUTO_RISE_CUE = 'v-rise-1';
/** The line's length when the manifest cannot say; 3.5 s is the shipped clip. */
export const AUTO_RISE_CUE_FALLBACK_MS = 3500;

export interface AutoRiseFacts {
  /** Loaded scene id. */
  readonly sceneId: string;
  /** Correction the scene rests in: 0 supine, 1 standing. */
  readonly restMix: number;
  /** A session is live. */
  readonly session: boolean;
  /** The capture produced a frame the ramp can build on. */
  readonly calibrated: boolean;
}

/**
 * May the page schedule a rise for this state?
 *
 * Returns the reason it refuses, so a status line or a test can say *why*
 * instead of only that nothing happened. `null` means yes.
 */
export type AutoRiseRefusal =
  | 'no-session'
  | 'prep-scene'
  | 'standing-scene'
  | 'not-calibrated';

export function autoRiseRefusal(facts: AutoRiseFacts): AutoRiseRefusal | null {
  if (!facts.session) {
    return 'no-session';
  }
  if (facts.sceneId === PREP_SCENE_ID) {
    return 'prep-scene';
  }
  if (!(facts.restMix < 1)) {
    return 'standing-scene';
  }
  if (!facts.calibrated) {
    return 'not-calibrated';
  }
  return null;
}

export function shouldScheduleAutoRise(facts: AutoRiseFacts): boolean {
  return autoRiseRefusal(facts) === null;
}

/**
 * The wait between a cue that has finished and the ramp that follows it.
 *
 * `clipMs` is what the manifest says the line lasts; a missing or unusable
 * duration falls back to the shipped clip's length rather than to zero, so a
 * broken manifest cannot turn the cue into a formality.
 */
export function autoRiseDelayMs(clipMs: number): number {
  const raw = Number.isFinite(clipMs) && clipMs > 0 ? clipMs : AUTO_RISE_CUE_FALLBACK_MS;
  return Math.round(raw) + AUTO_RISE_GAP_MS;
}
