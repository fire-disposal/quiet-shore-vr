/**
 * The one place that says what the world is doing and what may be asked of it.
 *
 * Four writers used to decide motion independently — the correction ramp, the
 * buoyancy envelope, the view controller, and the sit-up transform — and the
 * tablet guessed at the result from whatever field happened to be nearby
 * (`postureRise` is only meaningful in sit-up mode, which is why 躺下 stayed
 * disabled after a rise in float mode). This module composes the applied
 * motion **once** per frame and declares the capabilities that follow from it;
 * every consumer — the state frame, the JSON flags, the page's own command
 * gates, the tablet's buttons — reads this and nothing else.
 */

/** What the operator may ask for right now, and why not when it is false. */
export interface MotionCapabilities {
  /** Correction may be increased. */
  rise: boolean;
  /** Correction may be decreased. */
  lie: boolean;
  /** A running ramp may be frozen. */
  stop: boolean;
  /** Buoyancy may be switched on or off. */
  float: boolean;
  /** View angles may be driven (slider or preset). */
  view: boolean;
  /** Short reason for the first blocked capability, '' when nothing is blocked. */
  blocked: string;
  /**
   * Highest buoyancy level the loaded scene allows (1..3).
   *
   * The scene owns this ceiling, not the motion plan: it is carried here so a
   * remote stepper can clamp instead of sending a level the page will reduce.
   */
  floatCap: number;
}

export interface MotionPlanInput {
  /** A session exists in the page's state machine. */
  session: boolean;
  /**
   * Highest buoyancy the loaded scene tolerates, 0–1. Scene knowledge, carried
   * through the plan so every consumer reads one number; 0 is a room that does
   * not move.
   */
  floatCap: number;
  /** The page is presenting in XR. */
  presenting: boolean;
  /** A calibration capture owns the world. */
  capturing: boolean;
  /**
   * Applied correction, 0..1 — the same scalar that rotates the world and
   * lifts the eye. Never a measurement derived from a transform: the number
   * the tablet shows and the number that gates its buttons are this one.
   */
  correctionMix: number;
  correctionMoving: boolean;
}

export interface MotionPlan {
  capabilities: MotionCapabilities;
  /** Applied correction as a 0..1 fraction (the mix, clamped). */
  correctionFraction: number;
  /** Bumped whenever the plan's inputs change; consumers can skip work. */
  revision: number;
}

/** Settled states: the corresponding button has nothing left to do. */
const CORRECTION_EPSILON_MIX = 0.01;

/**
 * Pure: the same inputs always yield the same plan. A full 90° is the ceiling
 * of the correction, so "nearly corrected" and "nearly uncorrected" are both
 * settled states where the corresponding button has nothing left to do.
 */
export function planCapabilities(input: MotionPlanInput): MotionCapabilities {
  const mix = clamp01(input.correctionMix);
  const live = input.session && input.presenting && !input.capturing;
  const blocked = !input.session
    ? '未开始会话'
    : !input.presenting
      ? '头显不在场景中'
      : input.capturing
        ? '校准中'
        : '';
  if (!live) {
    return {
      rise: false,
      lie: false,
      stop: false,
      float: false,
      view: false,
      blocked,
      floatCap: Number.isFinite(input.floatCap) ? Math.min(1, Math.max(0, input.floatCap)) : 1
    };
  }
  // A caller that says nothing about the ceiling means "no ceiling", not
  // "no motion": the absence of a cap must not disable the control.
  const askedCap = Number.isFinite(input.floatCap) ? input.floatCap : 1;
  const floatCeiling = Math.min(1, Math.max(0, askedCap));
  return {
    rise: mix < 1 - CORRECTION_EPSILON_MIX,
    lie: mix > CORRECTION_EPSILON_MIX,
    stop: input.correctionMoving,
    // A ceiling of 0 is a room that does not move: the control is not offered
    // at all, rather than offered and then refused.
    float: floatCeiling > 0,
    view: true,
    blocked: '',
    floatCap: floatCeiling
  };
}

/** Compose the plan; `revision` grows when any input that matters changed. */
export function planMotion(input: MotionPlanInput, previous?: MotionPlan): MotionPlan {
  const capabilities = planCapabilities(input);
  const fraction = clamp01(input.correctionMix);
  const changed =
    !previous ||
    previous.correctionFraction !== fraction ||
    previous.capabilities.rise !== capabilities.rise ||
    previous.capabilities.lie !== capabilities.lie ||
    previous.capabilities.stop !== capabilities.stop ||
    previous.capabilities.float !== capabilities.float ||
    previous.capabilities.view !== capabilities.view ||
    previous.capabilities.blocked !== capabilities.blocked;
  return {
    capabilities,
    correctionFraction: fraction,
    revision: changed ? (previous?.revision ?? 0) + 1 : (previous?.revision ?? 0)
  };
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return value < 0 ? 0 : value > 1 ? 1 : value;
}
