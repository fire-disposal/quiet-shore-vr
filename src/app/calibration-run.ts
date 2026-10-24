import { createCalibrationSampler, type QuatSample, type SampleResult } from '../core/xr/calibration-sample';

/**
 * The calibration window as a state machine.
 *
 * ```text
 * settle  --hold complete-->  countdown  --window elapses-->  done
 *   |                            |
 *   +-- moved: restart the hold  +-- deadline / no pose: done(null)
 * ```
 *
 * App used to carry six fields (phase, reference, stable time, countdown
 * start, shown time, last frame) and re-derive the card's progress from them
 * every frame. The policy lives here now: the app only renders progress and
 * hides the card when the result lands, which also makes the wobble restart,
 * the deadline and the "pose never arrived" path testable without a headset.
 */

export interface CalibrationTiming {
  /** How long the head must hold still before the countdown starts. */
  holdMs: number;
  /** Averaging window, also the visible countdown. */
  countdownMs: number;
  /** The card may never hold the session longer than this. */
  deadlineMs: number;
  /** Spread allowed inside the hold window before it restarts. */
  maxDeviationDeg: number;
  /** An unread pose (0,0,0,0) is given this long before we open anyway. */
  poseGraceMs: number;
}

export const DEFAULT_CALIBRATION_TIMING: CalibrationTiming = {
  holdMs: 1800,
  countdownMs: 3000,
  deadlineMs: 9000,
  maxDeviationDeg: 6,
  poseGraceMs: 1500
};

export type CalibrationStatus = 'settling' | 'countdown' | 'done';

export interface CalibrationStep {
  status: CalibrationStatus;
  /** 0..1 fill of the card; 1 once the result landed. */
  progress: number;
  /** Result only on the frame the window closes. */
  result?: SampleResult | null;
}

export interface CalibrationRunApi {
  /** Show the card from `nowMs`; resets the hold window and the sampler. */
  start(nowMs: number): void;
  /** Feed one frame; idempotent once done. */
  update(pose: QuatSample, nowMs: number): CalibrationStep;
  isRunning(): boolean;
}

export function createCalibrationRun(
  timing: Partial<CalibrationTiming> = {}
): CalibrationRunApi {
  const config: CalibrationTiming = { ...DEFAULT_CALIBRATION_TIMING, ...timing };
  const sampler = createCalibrationSampler({
    durationMs: config.countdownMs,
    maxDeviationDeg: config.maxDeviationDeg
  });

  let status: CalibrationStatus = 'done';
  let shownAt = 0;
  let countdownAt = 0;
  let stableMs = 0;
  let lastFrameAt = 0;
  let reference: QuatSample | null = null;

  function start(nowMs: number): void {
    status = 'settling';
    shownAt = nowMs;
    countdownAt = 0;
    stableMs = 0;
    lastFrameAt = 0;
    reference = null;
    sampler.reset();
  }

  function settle(pose: QuatSample, nowMs: number): CalibrationStep {
    if (!reference) {
      reference = { x: pose.x, y: pose.y, z: pose.z, w: pose.w };
    }
    const dot = Math.abs(
      reference.x * pose.x + reference.y * pose.y + reference.z * pose.z + reference.w * pose.w
    );
    const deviation = (2 * Math.acos(Math.min(1, dot)) * 180) / Math.PI;
    if (deviation > config.maxDeviationDeg) {
      // Moved: restart the window from the new pose instead of failing.
      reference = { x: pose.x, y: pose.y, z: pose.z, w: pose.w };
      stableMs = 0;
    } else if (lastFrameAt > 0) {
      stableMs += nowMs - lastFrameAt;
    }
    lastFrameAt = nowMs;

    if (stableMs >= config.holdMs) {
      status = 'countdown';
      countdownAt = nowMs;
      sampler.start(nowMs);
      return { status, progress: 0 };
    }
    return { status, progress: Math.min(1, stableMs / config.holdMs) };
  }

  function update(pose: QuatSample, nowMs: number): CalibrationStep {
    if (status === 'done') {
      return { status, progress: 1 };
    }
    const read =
      Number.isFinite(pose.x) &&
      Number.isFinite(pose.y) &&
      Number.isFinite(pose.z) &&
      Number.isFinite(pose.w) &&
      (pose.x !== 0 || pose.y !== 0 || pose.z !== 0 || pose.w !== 0);

    // Hard deadline: whatever the pose does, the card cannot hold the session.
    if (nowMs - shownAt > config.deadlineMs) {
      status = 'done';
      return { status, progress: 1, result: null };
    }
    if (!read && nowMs - shownAt > config.poseGraceMs) {
      // Pose never arrived: open the scene with no re-orientation.
      status = 'done';
      return { status, progress: 1, result: null };
    }
    if (status === 'settling') {
      return settle(pose, nowMs);
    }

    const elapsed = nowMs - countdownAt;
    if (elapsed >= config.countdownMs) {
      status = 'done';
      return { status, progress: 1, result: sampler.add(pose, nowMs) };
    }
    sampler.add(pose, nowMs);
    return { status, progress: Math.min(1, elapsed / config.countdownMs) };
  }

  return { start, update, isRunning: () => status !== 'done' };
}
