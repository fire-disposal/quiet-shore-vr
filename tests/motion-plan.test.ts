import { describe, expect, it } from 'vitest';
import { planCapabilities, planMotion, type MotionPlanInput } from '../src/app/motion-plan';

function input(overrides: Partial<MotionPlanInput> = {}): MotionPlanInput {
  return {
    session: true,
    presenting: true,
    capturing: false,
    correctionMix: 0,
    correctionMoving: false,
    ...overrides
  };
}

describe('motion plan', () => {
  it('offers the rise while lying and the lie-back while standing', () => {
    const ceiling = planCapabilities(input({ correctionMix: 0 }));
    expect(ceiling.rise).toBe(true);
    expect(ceiling.lie).toBe(false);

    // A mix of 0.5 is half-risen: both directions still have something to do.
    const halfway = planCapabilities(input({ correctionMix: 0.5, correctionMoving: true }));
    expect(halfway.rise).toBe(true);
    expect(halfway.lie).toBe(true);
    expect(halfway.stop).toBe(true);

    const forward = planCapabilities(input({ correctionMix: 1 }));
    expect(forward.rise).toBe(false);
    expect(forward.lie).toBe(true);
  });

  it('settles within a hair of each end so the button is never dead', () => {
    // Past 0.99 the rise is retired; below 0.01 the lie-back is.
    expect(planCapabilities(input({ correctionMix: 0.995 })).rise).toBe(false);
    expect(planCapabilities(input({ correctionMix: 0.995 })).lie).toBe(true);
    expect(planCapabilities(input({ correctionMix: 0.005 })).lie).toBe(false);
    expect(planCapabilities(input({ correctionMix: 0.005 })).rise).toBe(true);
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

  it('treats a non-finite mix as a settled ceiling', () => {
    const caps = planCapabilities(input({ correctionMix: Number.NaN }));
    expect(caps.rise).toBe(true);
    expect(caps.lie).toBe(false);
  });

  it('bumps the revision only when the plan changed', () => {
    const first = planMotion(input({ correctionMix: 0.1 }));
    const same = planMotion(input({ correctionMix: 0.1 }), first);
    expect(same.revision).toBe(first.revision);

    const moved = planMotion(input({ correctionMix: 0.4, correctionMoving: true }), same);
    expect(moved.revision).toBe(first.revision + 1);
  });

  it('reports progress as the mix itself, clamped', () => {
    expect(planMotion(input({ correctionMix: 0.5 })).correctionFraction).toBeCloseTo(0.5, 6);
    expect(planMotion(input({ correctionMix: 4 })).correctionFraction).toBe(1);
    expect(planMotion(input({ correctionMix: -4 })).correctionFraction).toBe(0);
  });
});
