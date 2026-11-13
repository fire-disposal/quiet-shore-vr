import {
  createCalibrationSampler,
  headingDeviationDeg,
  type QuatSample,
  type SampleResult
} from '../core/xr/calibration-sample';

/**
 * The calibration window as a state machine.
 *
 * ```text
 * settle  --hold complete-->  countdown  --window elapses-->  done
 *   |                            |
 *   +-- moved: restart the hold  +-- wandered past the loose gate: restart the
 *                                |   countdown from this pose
 *                                +-- deadline / no pose: done(null)
 * ```
 *
 * A manual trigger (`skipSettle`) opens the countdown straight away: the
 * operator is watching the head, and the settle gate is there to start the
 * window on a still head, not to make them wait a second time. The wander gate
 * inside the countdown is the same for both entries — one rule, one place.
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
  /**
   * Spread allowed inside the countdown before it restarts.
   *
   * Deliberately looser than [maxDeviationDeg]: the hold has to start on a
   * still head, while a window only has to average one heading. This gate
   * catches a real move, not breathing.
   */
  restartDeviationDeg: number;
  /** An unread pose (0,0,0,0) is given this long before we open anyway. */
  poseGraceMs: number;
}

export const DEFAULT_CALIBRATION_TIMING: CalibrationTiming = {
  holdMs: 1800,
  countdownMs: 3000,
  deadlineMs: 9000,
  maxDeviationDeg: 6,
  restartDeviationDeg: 12,
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
  /**
   * Show the card from `nowMs`; resets the hold window and the sampler.
   * `skipSettle` opens the sampling window immediately (manual trigger).
   */
  start(nowMs: number, skipSettle?: boolean): void;
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

  /** Arm the averaging window; `pose` seeds the wander gate when known. */
  function openWindow(nowMs: number, pose: QuatSample | null): void {
    status = 'countdown';
    countdownAt = nowMs;
    reference = pose ? { x: pose.x, y: pose.y, z: pose.z, w: pose.w } : null;
    sampler.start(nowMs);
  }

  function start(nowMs: number, skipSettle = false): void {
    status = 'settling';
    shownAt = nowMs;
    countdownAt = 0;
    stableMs = 0;
    lastFrameAt = 0;
    reference = null;
    sampler.reset();
    if (skipSettle) {
      // Manual trigger: no hold, no wait. The countdown's own gate restarts it
      // if the patient moves, so nothing is lost by not gating the start.
      openWindow(nowMs, null);
    }
  }

  function settle(pose: QuatSample, nowMs: number): CalibrationStep {
    if (!reference) {
      reference = { x: pose.x, y: pose.y, z: pose.z, w: pose.w };
    }
    const deviation = headingDeviationDeg(reference, pose);
    if (deviation > config.maxDeviationDeg) {
      // Moved: restart the window from the new pose instead of failing.
      reference = { x: pose.x, y: pose.y, z: pose.z, w: pose.w };
      stableMs = 0;
    } else if (lastFrameAt > 0) {
      stableMs += nowMs - lastFrameAt;
    }
    lastFrameAt = nowMs;

    if (stableMs >= config.holdMs) {
      openWindow(nowMs, pose);
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

    // Wander gate: a head that moved this far inside the window would smear two
    // headings into one average. Restart from where it is now rather than
    // failing the whole attempt. Same rule for a settled and a manual window.
    if (read) {
      if (!reference) {
        reference = { x: pose.x, y: pose.y, z: pose.z, w: pose.w };
      } else if (headingDeviationDeg(reference, pose) > config.restartDeviationDeg) {
        openWindow(nowMs, pose);
        return { status, progress: 0 };
      }
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
