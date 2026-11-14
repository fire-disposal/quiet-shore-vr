import { describe, expect, it } from 'vitest';
import {
  createCalibrationRun,
  type CalibrationRunApi,
  type CalibrationStep
} from '../src/app/calibration-run';

/**
 * The calibration window may never be able to block the session.
 *
 * Every input the headset can produce — a still head, a wobbling head, a pose
 * that never arrives at all, or no frames at all in between — must land on
 * `done` within the deadline. `done` is what lets `App` release the freeze and
 * the buoyancy gate; latching here means a frozen session.
 */
const HEAD = { x: 0, y: 0, z: 0.7071068, w: 0.7071068 };
const ZERO = { x: 0, y: 0, z: 0, w: 0 };

function step(run: CalibrationRunApi, pose: typeof HEAD, nowMs: number): CalibrationStep {
  return run.update(pose, nowMs);
}

describe('calibration window liveness', () => {
  it('a still head reaches done after hold + countdown', () => {
    const run = createCalibrationRun();
    run.start(0);
    let now = 0;
    let last = step(run, HEAD, now);
    while (last.status !== 'done' && now < 20_000) {
      now += 1000 / 60;
      last = step(run, HEAD, now);
    }
    expect(last.status).toBe('done');
    expect(last.result?.ok).toBe(true);
    expect(now).toBeLessThan(9_000);
  });

  it('a pose that never arrives still lands on done', () => {
    const run = createCalibrationRun();
    run.start(0);
    let now = 0;
    let last = step(run, ZERO, now);
    while (last.status !== 'done' && now < 20_000) {
      now += 1000 / 60;
      last = step(run, ZERO, now);
    }
    expect(last.status).toBe('done');
    expect(last.result).toBeNull();
    // The grace window is what ends it, well before the hard deadline.
    expect(now).toBeLessThan(2_000);
  });

  it('a head that keeps moving cannot extend the window past the deadline', () => {
    const run = createCalibrationRun();
    run.start(0);
    let now = 0;
    let done = false;
    while (!done && now < 20_000) {
      now += 1000 / 60;
      // 30 degrees of yaw every frame: the hold never completes.
      const angle = (now / 1000) * Math.PI;
      const pose = { x: 0, y: Math.sin(angle / 2), z: 0, w: Math.cos(angle / 2) };
      done = step(run, pose, now).status === 'done';
    }
    expect(done).toBe(true);
    expect(now).toBeLessThan(9_500);
  });

  it('no frames at all is safe: the deadline is measured on arrival', () => {
    const run = createCalibrationRun();
    run.start(0);
    // The page was suspended and resumes 30 s later: one frame must settle it.
    const late = step(run, HEAD, 30_000);
    expect(late.status).toBe('done');
    expect(late.result).toBeNull();
  });

  it('stays done: repeat calls never reopen the window', () => {
    const run = createCalibrationRun();
    run.start(0);
    const first = step(run, ZERO, 30_000);
    expect(first.status).toBe('done');
    for (let i = 0; i < 10; i += 1) {
      expect(step(run, HEAD, 30_000 + i * 16).status).toBe('done');
    }
    expect(run.isRunning()).toBe(false);
  });

  it('a restart after a completed window starts a fresh hold', () => {
    const run = createCalibrationRun();
    run.start(0);
    expect(step(run, HEAD, 10_000).status).toBe('done');
    run.start(20_000);
    expect(run.isRunning()).toBe(true);
    const first = step(run, HEAD, 20_000);
    expect(first.status).toBe('settling');
  });
});

/** HEAD rotated by `deg` about X: its deviation from HEAD is exactly `deg`. */
function tiltPose(deg: number): typeof HEAD {
  const half = (deg * Math.PI) / 360;
  const s = HEAD.z;
  const c = HEAD.w;
  return {
    x: c * Math.sin(half),
    y: s * Math.sin(half),
    z: s * Math.cos(half),
    w: c * Math.cos(half)
  };
}

describe('calibration window: manual trigger and the wander gate', () => {
  it('a manual trigger opens the countdown without a settle hold', () => {
    const run = createCalibrationRun();
    run.start(0, true);
    const first = step(run, HEAD, 0);
    expect(first.status).toBe('countdown');
    expect(first.progress).toBe(0);
  });

  it('a manual trigger finishes in the window length, not hold + window', () => {
    const run = createCalibrationRun();
    run.start(0, true);
    let now = 0;
    let last = step(run, HEAD, now);
    while (last.status !== 'done' && now < 20_000) {
      now += 1000 / 60;
      last = step(run, HEAD, now);
    }
    expect(last.status).toBe('done');
    expect(last.result?.ok).toBe(true);
    expect(now).toBeLessThan(3_500);
  });

  it('a head that moves inside the window restarts it from there', () => {
    const run = createCalibrationRun();
    run.start(0, true);
    step(run, HEAD, 0);
    // Halfway through the window, a 20° move: past the loose gate.
    const moved = step(run, tiltPose(20), 1_500);
    expect(moved.status).toBe('countdown');
    expect(moved.progress).toBe(0);
    // Two seconds later the restarted window is still running.
    expect(step(run, tiltPose(20), 3_500).status).toBe('countdown');
    let now = 3_500;
    let last = step(run, tiltPose(20), now);
    while (last.status !== 'done' && now < 20_000) {
      now += 16;
      last = step(run, tiltPose(20), now);
    }
    // Lands three seconds after the move, not after the original open.
    expect(now).toBeGreaterThan(4_300);
    expect(now).toBeLessThan(4_700);
    expect(last.result?.ok).toBe(true);
  });

  it('the gate is loose: 10° inside the window does not restart', () => {
    const run = createCalibrationRun();
    run.start(0, true);
    step(run, HEAD, 0);
    const moved = step(run, tiltPose(10), 1_500);
    expect(moved.progress).toBeGreaterThan(0.4);
  });

  it('a settled window uses the same gate, not a second rule', () => {
    const run = createCalibrationRun();
    run.start(0);
    let now = 0;
    let last = step(run, HEAD, now);
    while (last.status !== 'countdown' && now < 5_000) {
      now += 16;
      last = step(run, HEAD, now);
    }
    expect(last.status).toBe('countdown');
    expect(step(run, tiltPose(20), now + 500).progress).toBe(0);
  });

  it('the 3 s window at 72 Hz samples the late part of the window too', () => {
    // The original bug: the buffer held 64 frames (0.89 s at 72 Hz), so a head
    // that stayed still through the start and drifted 8° over the last second
    // produced `samples=64, ok=true, meanY≈0` — an accepted window describing a
    // pose the patient had already left. Frame count must now match the window,
    // and the late drift must reach the mean and the spread.
    const run = createCalibrationRun();
    run.start(0, true);
    const frameMs = 1000 / 72;
    let now = 0;
    let last = step(run, HEAD, now);
    while (last.status !== 'done' && now < 20_000) {
      now += frameMs;
      // Still for the first two seconds of the window, drifting after that.
      last = step(run, now > 2_000 ? tiltPose(8) : HEAD, now);
    }
    expect(last.status).toBe('done');
    expect(last.result?.samples).toBeGreaterThan(200);
    // 8° of drift late in the window: the mean is part-way there, and the
    // spread is measured against what the head did, not against a prefix.
    expect(last.result?.quaternion?.y).toBeGreaterThan(0.005);
    expect(last.result?.deviationDeg).toBeGreaterThan(3);
  });
});
