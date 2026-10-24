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
}

export interface MotionPlanInput {
  /** A session exists in the page's state machine. */
  session: boolean;
  /** The page is presenting in XR. */
  presenting: boolean;
  /** A calibration capture owns the world. */
  capturing: boolean;
  /** Applied correction, in degrees, and whether a ramp is running. */
  correctionDeg: number;
  correctionMoving: boolean;
}

export interface MotionPlan {
  capabilities: MotionCapabilities;
  /** Applied correction as a 0..1 fraction of a full 90° turn. */
  correctionFraction: number;
  /** Bumped whenever the plan's inputs change; consumers can skip work. */
  revision: number;
}

const FULL_CORRECTION_DEG = 90;
/** Below this the world is a settled ceiling; above it a settled forward view. */
const CORRECTION_EPSILON_DEG = 1;

/**
 * Pure: the same inputs always yield the same plan. A full 90° is the ceiling
 * of the correction, so "nearly corrected" and "nearly uncorrected" are both
 * settled states where the corresponding button has nothing left to do.
 */
export function planCapabilities(input: MotionPlanInput): MotionCapabilities {
  const angle = Number.isFinite(input.correctionDeg)
    ? Math.abs(input.correctionDeg)
    : 0;
  const live = input.session && input.presenting && !input.capturing;
  const blocked = !input.session
    ? '未开始会话'
    : !input.presenting
      ? '头显不在场景中'
      : input.capturing
        ? '校准中'
        : '';
  if (!live) {
    return { rise: false, lie: false, stop: false, float: false, view: false, blocked };
  }
  return {
    rise: angle < FULL_CORRECTION_DEG - CORRECTION_EPSILON_DEG,
    lie: angle > CORRECTION_EPSILON_DEG,
    stop: input.correctionMoving,
    float: true,
    view: true,
    blocked: ''
  };
}

/** Compose the plan; `revision` grows when any input that matters changed. */
export function planMotion(input: MotionPlanInput, previous?: MotionPlan): MotionPlan {
  const capabilities = planCapabilities(input);
  const fraction = Math.min(
    1,
    Math.max(0, (Number.isFinite(input.correctionDeg) ? Math.abs(input.correctionDeg) : 0) / FULL_CORRECTION_DEG)
  );
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
