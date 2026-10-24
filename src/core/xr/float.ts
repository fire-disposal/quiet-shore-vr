/**
 * Slow vertical buoyancy for the supine patient.
 *
 * The whole world drifts up and down; nothing rotates the patient's view, so
 * the vestibular load is the gentle heave of floating rather than the sickness
 * of turning.
 *
 * Three tunable profiles exist because "feels like floating" is a judgement
 * nobody can make from a desk. A technician picks one on the headset, in the
 * room, wearing the headset.
 *
 * Pure math only: the app owns when it runs, this owns how far.
 */

export type FloatProfileId = 'a' | 'b' | 'c';

export interface FloatProfile {
  readonly id: FloatProfileId;
  readonly label: string;
  /** Peak vertical displacement at full intensity, in metres. */
  readonly amplitudeM: number;
  /** One full up-down cycle, in seconds. Longer reads as drift, not bobbing. */
  readonly periodS: number;
}

/**
 * Profiles.
 *
 * Two findings shape these numbers:
 *  - Supine viewers get faster vection from motion along the body axis, and a
 *    floating body has an ambiguous vestibular "down", so the vertical heave
 *    itself is the strongest cue we can give (Vection Res. 2020, Sci Rep 11:1022).
 *  - An unstable subjective vertical triggers disorientation and space motion
 *    sickness (NASA Neurolab). The horizon therefore **never tilts**: there is
 *    no sway channel at all, and the world only translates along the visual up.
 *
 * Amplitudes doubled on 2026-10-24 field request ("浮动大一倍"). The near-field
 * speed budget doubles with them, pending volunteer re-calibration — see
 * FLOAT_LEVEL_CAP.
 */
export const FLOAT_PROFILES: Readonly<Record<FloatProfileId, FloatProfile>> = {
  a: { id: 'a', label: '温和', amplitudeM: 0.11, periodS: 16 },
  b: { id: 'b', label: '标准', amplitudeM: 0.15, periodS: 13 },
  c: { id: 'c', label: '飘浮', amplitudeM: 0.2, periodS: 9 }
};

export const DEFAULT_FLOAT_PROFILE: FloatProfileId = 'b';

/** Intensity levels the technician can pick (0 = off). */
export const FLOAT_MAX_LEVEL = 3;

/**
 * Highest level each profile may be asked for, from the near-field speed cap.
 *
 * The world translates along one axis only — no rotation, no looming — so the
 * budget is expressed at the near field (~1.1 m at the shore). The desk budget
 * was 2.5 °/s (0.048 m/s of travel); the 2026-10-24 field pass doubled the
 * amplitudes and the budget with them (5 °/s, 0.096 m/s), explicitly pending
 * volunteer re-calibration. The shaped curve's peak speed is what counts, not
 * the sine's: numerically that keeps the gentle and standard profiles at
 * level 3 and lets the immersive 9 s profile reach level 2.
 */
export const FLOAT_LEVEL_CAP: Readonly<Record<FloatProfileId, number>> = {
  a: FLOAT_MAX_LEVEL,
  b: FLOAT_MAX_LEVEL,
  c: 2
};


export function isFloatProfileId(value: unknown): value is FloatProfileId {
  return value === 'a' || value === 'b' || value === 'c';
}

/**
 * Level is a discrete 0..[FLOAT_MAX_LEVEL] choice; amplitude scales linearly so
 * level 1 is already perceptible and level 3 stays inside the comfort envelope.
 */
export function floatAmplitudeForLevel(profile: FloatProfile, level: number): number {
  const clamped = Math.min(FLOAT_MAX_LEVEL, Math.max(0, Math.round(level)));
  return (clamped / FLOAT_MAX_LEVEL) * profile.amplitudeM;
}

/**
 * Shape of the heave.
 *
 * A pure sine reads mechanical — the patient hears a metronome in it. Two cheap
 * additions fix that without touching the envelope:
 *  - a small second harmonic and a phase warp, so the rise is slower than the
 *    settle and the crest is broader than the trough (the way a body actually
 *    bobs in water);
 *  - a very slow swell (~43 s) that varies the height of consecutive cycles.
 *
 * Both are pure arithmetic, no allocation, three sin() per frame.
 */
const HARMONIC = 0.22;
const WARP = 0.2;
const SWELL_PERIOD_S = 43;
const SWELL_DEPTH = 0.1;
/**
 * A little high-frequency wobble on top of the slow heave. Adding oscillation
 * to the visual field is a known way to strengthen vection; kept at a few
 * millimetres so it reads as water, not vibration. The main curve is scaled
 * down by the same fraction so the total never leaves the envelope.
 */
const JITTER_FRACTION = 0.03;
const JITTER_HZ = 0.31;
/**
 * Breathing layer: a slow rise and fall that rides on top of the heave. A body
 * held in water moves with its breath, and that coupling is a strong, very
 * cheap self-motion cue — it is the difference between "the floor moves" and
 * "I am buoyant".
 */
const BREATH_PERIOD_S = 7.5;
const BREATH_FRACTION = 0.16;
/**
 * The breath swell every scene gets when the big heave is scene-gated off:
 * ±12 mm at the breath period, slow enough to read as breathing, not motion.
 */
const BREATH_ONLY_M = 0.012;

/** Normalises the shaped curve so its crest is exactly 1 before scaling. */
const CURVE_NORM = ((): number => {
  let peak = 0;
  for (let i = 0; i < 2048; i += 1) {
    const phase = (i / 2048) * Math.PI * 2;
    const warped = phase + WARP * Math.sin(phase);
    peak = Math.max(peak, Math.abs(Math.sin(warped) + HARMONIC * Math.sin(2 * warped)));
  }
  return peak > 0 ? peak : 1;
})();

/**
 * Vertical offset in metres at time [seconds]. Continuous in position, velocity
 * and acceleration, so starting and stopping never jerks.
 */
export function floatOffsetAt(
  profile: FloatProfile,
  seconds: number,
  amplitudeM: number,
  breath = true
): number {
  if (!(amplitudeM > 0)) {
    return 0;
  }
  const phase = (seconds * 2 * Math.PI) / profile.periodS;
  // The warp runs *against* the phase so the crest lasts longer than the
  // trough: a body rising through water slows near the top and settles a
  // little quicker. Measured: crest/trough dwell ≈ 1.06–1.11.
  const warped = phase - WARP * Math.sin(phase);
  const shaped = (Math.sin(warped) + HARMONIC * Math.sin(2 * warped)) / CURVE_NORM;
  const swell = swellFactor(seconds);
  const wobble = Math.sin(seconds * 2 * Math.PI * JITTER_HZ) * JITTER_FRACTION;
  const breathWave = breath ? Math.sin((seconds * 2 * Math.PI) / BREATH_PERIOD_S) : 0;
  // The breathing term is scaled by how much envelope is in use and folded in
  // below the main shape, so the total still cannot exceed ±amplitude.
  const combined = shaped * (1 - JITTER_FRACTION - (breath ? BREATH_FRACTION : 0)) +
    wobble + breathWave * BREATH_FRACTION;
  return combined * amplitudeM * swell;
}

function swellFactor(seconds: number): number {
  return 1 - SWELL_DEPTH * 0.5 * (1 - Math.cos((seconds * 2 * Math.PI) / SWELL_PERIOD_S));
}

/**
 * The breath swell on its own, at a fixed small amplitude. Scenes that do not
 * take the big heave (everything except the lake) still get this, so the world
 * never reads as frozen while the switch is on.
 */
export function breathOffsetAt(seconds: number): number {
  return Math.sin((seconds * 2 * Math.PI) / BREATH_PERIOD_S) * BREATH_ONLY_M * swellFactor(seconds);
}

/**
 * Ramps the effective amplitude toward its target. Stopping is therefore a
 * fade, not a cut: with the default tau the visible motion is gone in ~1 s.
 */
export function easeAmplitude(current: number, target: number, dt: number, tauSeconds: number): number {
  if (tauSeconds <= 0) {
    return target;
  }
  const alpha = 1 - Math.exp(-dt / tauSeconds);
  const next = current + (target - current) * alpha;
  return Math.abs(next - target) < 1e-4 ? target : next;
}
