import { describe, expect, it } from 'vitest';
import { planCapabilities, planMotion, type MotionPlanInput } from '../src/app/motion-plan';

function input(overrides: Partial<MotionPlanInput> = {}): MotionPlanInput {
  return {
    session: true,
    presenting: true,
    capturing: false,
    correctionDeg: 0,
    correctionMoving: false,
    ...overrides
  };
}

describe('motion plan', () => {
  it('offers the rise at a settled ceiling and the lie-back once corrected', () => {
    const ceiling = planCapabilities(input({ correctionDeg: 0 }));
    expect(ceiling.rise).toBe(true);
    expect(ceiling.lie).toBe(false);

    // 88° still has 2° of rise left; only a settled forward view retires it.
    expect(planCapabilities(input({ correctionDeg: 88 })).rise).toBe(true);
    const forward = planCapabilities(input({ correctionDeg: 89.5 }));
    expect(forward.rise).toBe(false);
    expect(forward.lie).toBe(true);

    const halfway = planCapabilities(input({ correctionDeg: 45, correctionMoving: true }));
    expect(halfway.rise).toBe(true);
    expect(halfway.lie).toBe(true);
    expect(halfway.stop).toBe(true);
  });

  it('reports the correction angle, not a sit-up-only field', () => {
    // The bug this replaced: 躺下 was gated on postureRise, which only exists
    // in sit-up mode, so in a float session it never armed.
    const floatMode = planCapabilities(input({ correctionDeg: 90 }));
    expect(floatMode.lie).toBe(true);
  });

  it('blocks everything outside a presenting session and says why', () => {
    for (const [overrides, reason] of [
      [{ session: false }, '未开始会话'],
      [{ presenting: false }, '头显不在场景中'],
      [{ capturing: true }, '校准中']
    ] as const) {
      const caps = planCapabilities(input(overrides));
      expect(caps).toEqual({
        rise: false,
        lie: false,
        stop: false,
        float: false,
        view: false,
        blocked: reason
      });
    }
  });

  it('treats a non-finite correction as a settled ceiling', () => {
    const caps = planCapabilities(input({ correctionDeg: Number.NaN }));
    expect(caps.rise).toBe(true);
    expect(caps.lie).toBe(false);
  });

  it('bumps the revision only when the plan changed', () => {
    const first = planMotion(input({ correctionDeg: 10 }));
    const same = planMotion(input({ correctionDeg: 10 }), first);
    expect(same.revision).toBe(first.revision);

    const moved = planMotion(input({ correctionDeg: 40, correctionMoving: true }), same);
    expect(moved.revision).toBe(first.revision + 1);
  });

  it('expresses progress as a fraction of a full correction', () => {
    expect(planMotion(input({ correctionDeg: 45 })).correctionFraction).toBeCloseTo(0.5, 6);
    expect(planMotion(input({ correctionDeg: 400 })).correctionFraction).toBe(1);
    expect(planMotion(input({ correctionDeg: -400 })).correctionFraction).toBe(1);
  });
});
