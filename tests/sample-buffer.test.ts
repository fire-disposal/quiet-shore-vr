import { describe, expect, it } from 'vitest';
import { createSampleBuffer, type PoseSample } from '../src/core/xr/sample-buffer';

function pose(overrides: Partial<PoseSample> = {}): PoseSample {
  return {
    headYaw: 0,
    headPitch: 0,
    headRoll: 0,
    worldYaw: 0,
    worldPitch: 0,
    worldRoll: 0,
    floatMm: 0,
    swayDeg: 0,
    ...overrides
  };
}

describe('sample buffer', () => {
  it('returns null before the first sample', () => {
    const buffer = createSampleBuffer();
    expect(buffer.sampleAt(0)).toBeNull();
  });

  it('interpolates halfway between the two surrounding samples', () => {
    const buffer = createSampleBuffer();
    buffer.push(pose({ worldYaw: 10, floatMm: 0 }), 0);
    buffer.push(pose({ worldYaw: 30, floatMm: 40 }), 1000);

    const mid = buffer.sampleAt(600);
    expect(mid).not.toBeNull();
    expect(mid!.worldYaw).toBeCloseTo(20, 6);
    expect(mid!.floatMm).toBeCloseTo(20, 6);
  });

  it('holds the render 100 ms behind the newest sample by default', () => {
    const buffer = createSampleBuffer();
    buffer.push(pose({ floatMm: 0 }), 0);
    buffer.push(pose({ floatMm: 100 }), 1000);

    expect(buffer.sampleAt(1000)!.floatMm).toBeCloseTo(90, 6);
    expect(buffer.sampleAt(900)!.floatMm).toBeCloseTo(80, 6);
  });

  it('honours a custom delay', () => {
    const buffer = createSampleBuffer({ delayMs: 300 });
    buffer.push(pose({ floatMm: 0 }), 0);
    buffer.push(pose({ floatMm: 100 }), 1000);

    expect(buffer.sampleAt(800)!.floatMm).toBeCloseTo(50, 6);
  });

  it('takes the shortest path across the ±180 yaw wrap', () => {
    const buffer = createSampleBuffer();
    buffer.push(pose({ worldYaw: 170, headYaw: -170 }), 0);
    buffer.push(pose({ worldYaw: -170, headYaw: 170 }), 1000);

    const mid = buffer.sampleAt(600)!;
    expect(Math.abs(mid.worldYaw)).toBeCloseTo(180, 6);
    expect(Math.abs(mid.headYaw)).toBeCloseTo(180, 6);
  });

  it('does not wrap roll or pitch', () => {
    const buffer = createSampleBuffer();
    buffer.push(pose({ worldPitch: 0, worldRoll: 0 }), 0);
    buffer.push(pose({ worldPitch: 40, worldRoll: -40 }), 1000);

    const mid = buffer.sampleAt(600)!;
    expect(mid.worldPitch).toBeCloseTo(20, 6);
    expect(mid.worldRoll).toBeCloseTo(-20, 6);
  });

  it('clamps to both ends of a single sample', () => {
    const buffer = createSampleBuffer();
    buffer.push(pose({ worldYaw: 42, swayDeg: 3 }), 1000);

    expect(buffer.sampleAt(0)!.worldYaw).toBeCloseTo(42, 6);
    expect(buffer.sampleAt(1000)!.worldYaw).toBeCloseTo(42, 6);
    expect(buffer.sampleAt(90000)!.swayDeg).toBeCloseTo(3, 6);
  });

  it('clamps to the oldest sample when sampling before it', () => {
    const buffer = createSampleBuffer();
    buffer.push(pose({ floatMm: 5 }), 500);
    buffer.push(pose({ floatMm: 55 }), 1500);

    expect(buffer.sampleAt(0)!.floatMm).toBeCloseTo(5, 6);
    expect(buffer.sampleAt(200)!.floatMm).toBeCloseTo(5, 6);
  });

  it('flags staleness against the newest sample', () => {
    const buffer = createSampleBuffer({ staleMs: 1500 });
    buffer.push(pose(), 1000);

    expect(buffer.isStale(2500)).toBe(false);
    expect(buffer.isStale(2501)).toBe(true);
    expect(createSampleBuffer().isStale(0)).toBe(true);
  });

  it('drops out-of-order timestamps', () => {
    const buffer = createSampleBuffer();
    buffer.push(pose({ floatMm: 10 }), 1000);
    buffer.push(pose({ floatMm: 99 }), 500);

    expect(buffer.sampleAt(1100)!.floatMm).toBeCloseTo(10, 6);
  });

  it('keeps the newest value for duplicate timestamps', () => {
    const buffer = createSampleBuffer();
    buffer.push(pose({ floatMm: 10 }), 1000);
    buffer.push(pose({ floatMm: 25 }), 1000);

    expect(buffer.sampleAt(1100)!.floatMm).toBeCloseTo(25, 6);
  });

  it('clears every sample on reset', () => {
    const buffer = createSampleBuffer();
    buffer.push(pose({ floatMm: 10 }), 1000);
    buffer.reset();

    expect(buffer.sampleAt(1000)).toBeNull();
    expect(buffer.isStale(1000)).toBe(true);

    buffer.push(pose({ floatMm: 7 }), 2000);
    expect(buffer.sampleAt(2100)!.floatMm).toBeCloseTo(7, 6);
  });

  it('evicts the oldest sample once capacity is reached', () => {
    const buffer = createSampleBuffer({ capacity: 2, delayMs: 0 });
    buffer.push(pose({ floatMm: 0 }), 0);
    buffer.push(pose({ floatMm: 10 }), 100);
    buffer.push(pose({ floatMm: 20 }), 200);

    expect(buffer.sampleAt(0)!.floatMm).toBeCloseTo(10, 6);
    expect(buffer.sampleAt(150)!.floatMm).toBeCloseTo(15, 6);
  });

  it('reuses its scratch object instead of allocating per sample', () => {
    const buffer = createSampleBuffer();
    buffer.push(pose(), 0);
    buffer.push(pose({ floatMm: 10 }), 1000);

    const first = buffer.sampleAt(600);
    const second = buffer.sampleAt(600);
    expect(second).toBe(first);
  });
});
