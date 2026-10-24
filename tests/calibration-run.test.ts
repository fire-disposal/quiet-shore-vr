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
