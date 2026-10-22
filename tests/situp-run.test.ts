import { describe, expect, it } from 'vitest';
import { createSitUpMotion } from '../src/core/xr/situp-run';

describe('sit-up motion', () => {
  it('ramps linearly over the declared duration and lands exactly', () => {
    const motion = createSitUpMotion({ durationMs: 12000 });
    motion.setTarget(1);
    expect(motion.moving).toBe(true);

    // 6 s of a 12 s ramp: half the travel.
    for (let i = 0; i < 360; i += 1) {
      motion.update(1 / 60);
    }
    expect(motion.t).toBeCloseTo(0.5, 6);

    for (let i = 0; i < 360; i += 1) {
      motion.update(1 / 60);
    }
    // Frame quantisation leaves a sub-millisecond tail; one more frame lands it.
    expect(motion.t).toBeCloseTo(1, 6);
    motion.update(1 / 60);
    expect(motion.t).toBe(1);
    expect(motion.moving).toBe(false);
    expect(motion.update(1 / 60)).toBe(false);
  });

  it('freezes on stop and resumes from there', () => {
    const motion = createSitUpMotion({ durationMs: 12000 });
    motion.setTarget(1);
    for (let i = 0; i < 180; i += 1) {
      motion.update(1 / 60);
    }
    const frozen = motion.t;
    expect(frozen).toBeGreaterThan(0);
    expect(frozen).toBeLessThan(1);

    motion.stop();
    expect(motion.moving).toBe(false);
    for (let i = 0; i < 60; i += 1) {
      expect(motion.update(1 / 60)).toBe(false);
    }
    expect(motion.t).toBe(frozen);

    motion.setTarget(0);
    motion.update(1 / 60);
    expect(motion.t).toBeLessThan(frozen);
  });

  it('clamps targets and ignores unusable dt', () => {
    const motion = createSitUpMotion();
    motion.setTarget(4);
    expect(motion.target).toBe(1);
    motion.setTarget(-3);
    expect(motion.target).toBe(0);

    motion.setTarget(1);
    expect(motion.update(Number.NaN)).toBe(false);
    expect(motion.update(0)).toBe(false);
    expect(motion.t).toBe(0);

    motion.reset();
    expect(motion.t).toBe(0);
    expect(motion.target).toBe(0);
    expect(motion.moving).toBe(false);
  });
});
