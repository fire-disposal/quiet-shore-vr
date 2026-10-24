import { describe, expect, it } from 'vitest';
import { planDetail, planSwap } from '../src/audio/bed-schedule';

/** Deterministic random source: a small LCG, so plans are reproducible. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

describe('bed swap plan', () => {
  it('keeps every value inside the ranges the mixer needs', () => {
    const random = seeded(7);
    for (const clip of [16, 25]) {
      for (let i = 0; i < 200; i += 1) {
        const plan = planSwap(random, clip);
        expect(plan.fadeS).toBeGreaterThan(0);
        expect(plan.fadeS).toBeLessThanOrEqual(clip / 3);
        expect(plan.swapAfterS).toBeGreaterThanOrEqual(5.5);
        // A swap must never outlast the source, or the "short" feeling returns.
        expect(plan.swapAfterS).toBeLessThanOrEqual(clip * 1.2);
        expect(plan.offsetS).toBeGreaterThanOrEqual(0);
        expect(plan.offsetS).toBeLessThan(clip);
        expect(plan.rate).toBeGreaterThanOrEqual(0.994);
        expect(plan.rate).toBeLessThanOrEqual(1.006);
      }
    }
  });

  it('is reproducible for a given seed', () => {
    expect(planSwap(seeded(3), 16)).toEqual(planSwap(seeded(3), 16));
  });

  it('drifts the lanes apart rather than locking them together', () => {
    const random = seeded(11);
    const rates = new Set<number>();
    for (let i = 0; i < 50; i += 1) {
      rates.add(planSwap(random, 16).rate);
    }
    // A constant rate would let both lanes settle into one steady pattern.
    expect(rates.size).toBeGreaterThan(20);
  });

  it('survives a nonsense clip length', () => {
    for (const clip of [0, -3, Number.NaN, 0.4]) {
      const plan = planSwap(seeded(1), clip);
      expect(Number.isFinite(plan.swapAfterS)).toBe(true);
      expect(Number.isFinite(plan.fadeS)).toBe(true);
      expect(Number.isFinite(plan.offsetS)).toBe(true);
      expect(Number.isFinite(plan.rate)).toBe(true);
      expect(plan.offsetS).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('detail plan', () => {
  it('fits the slice inside the clip and keeps the level subtle', () => {
    const random = seeded(5);
    for (const clip of [16, 25]) {
      for (let i = 0; i < 100; i += 1) {
        const plan = planDetail(random, clip);
        expect(plan.lengthS).toBeGreaterThan(0);
        expect(plan.lengthS).toBeLessThanOrEqual(clip / 4);
        expect(plan.offsetS + plan.lengthS).toBeLessThanOrEqual(clip + 1e-9);
        expect(plan.gain).toBeGreaterThanOrEqual(0.14);
        expect(plan.gain).toBeLessThanOrEqual(0.28);
        expect(plan.afterS).toBeGreaterThanOrEqual(6);
        expect(plan.afterS).toBeLessThanOrEqual(15);
      }
    }
  });

  it('does not schedule details faster than they end', () => {
    const random = seeded(9);
    for (let i = 0; i < 50; i += 1) {
      const plan = planDetail(random, 16);
      expect(plan.afterS).toBeGreaterThan(plan.lengthS);
    }
  });
});
