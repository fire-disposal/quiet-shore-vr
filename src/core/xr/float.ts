/**
 * Slow vertical buoyancy for the supine patient.
 *
 * The whole world drifts up and down; nothing rotates the patient's view, so
 * the vestibular load is the gentle heave of floating rather than the sickness
 * of turning.
 *
 * One envelope, one period: the technician's only choice is on/off (level 0 or
 * 3). The character presets (gentle / standard / float) and the separate
 * breathing layer are gone — nobody could tell them apart in the headset, and
 * two knobs for one sensation is what made the control surface unreadable.
 *
 * Pure math only: the app owns when it runs, this owns how far.
 */

/**
 * The envelope.
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
export const FLOAT_AMPLITUDE_M = 0.15;
export const FLOAT_PERIOD_S = 13;

/**
 * The intensity is a fraction of the full envelope, 0–1.
 *
 * It used to be four levels (`0..3`), which made the operator's only dial
 * quantised for no reason: the heave is a continuous amplitude and the patient
 * can feel the difference between 40 % and 60 %. A scene still caps it, now as
 * the same fraction, and 0 means "this room does not move".
 */
export function floatAmplitude(amount: number): number {
  const clamped = Number.isFinite(amount) ? Math.min(1, Math.max(0, amount)) : 0;
  return clamped * FLOAT_AMPLITUDE_M;
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
export function floatOffsetAt(seconds: number, amplitudeM: number, breath = 1): number {
  if (!(amplitudeM > 0)) {
    return 0;
  }
  const b = Number.isFinite(breath) ? Math.min(1, Math.max(0, breath)) : 1;
  const phase = (seconds * 2 * Math.PI) / FLOAT_PERIOD_S;
  // The warp runs *against* the phase so the crest lasts longer than the
  // trough: a body rising through water slows near the top and settles a
  // little quicker. Measured: crest/trough dwell ≈ 1.06–1.11.
  const warped = phase - WARP * Math.sin(phase);
  const harmonic = HARMONIC * b;
  // The normalisation follows the harmonic: at `breath = 1` this is exactly the
  // shipped curve, at 0 the same envelope runs as a plain sine.
  const norm = CURVE_NORM + (1 - CURVE_NORM) * (1 - b);
  const shaped = (Math.sin(warped) + harmonic * Math.sin(2 * warped)) / norm;
  const swell = swellFactor(seconds, b);
  const jitter = JITTER_FRACTION * b;
  const wobble = Math.sin(seconds * 2 * Math.PI * JITTER_HZ) * jitter;
  // The wobble is folded below the main shape, so the total cannot exceed
  // ±amplitude at any instant.
  const combined = shaped * (1 - jitter) + wobble;
  return combined * amplitudeM * swell;
}

/**
 * The slow breathing of the heave: how much the height of consecutive cycles
 * varies. `breath` is the operator's switch — at 0 the wave keeps its envelope
 * and period but stops breathing, which is the one thing that switch can
 * honestly change.
 */
function swellFactor(seconds: number, breath: number): number {
  return 1 - SWELL_DEPTH * breath * 0.5 * (1 - Math.cos((seconds * 2 * Math.PI) / SWELL_PERIOD_S));
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
