import { describe, expect, it } from 'vitest';
import { createCalibrationSampler } from '../src/core/xr/calibration-sample';

const still = { x: 0, y: 0.3826834, z: 0, w: 0.9238795 }; // 45° about Y

describe('calibration sampler', () => {
  it('averages a still head and accepts the window', () => {
    const s = createCalibrationSampler({ durationMs: 300 });
    s.start(0);
    let result = null;
    for (let t = 0; t <= 400; t += 16) {
      result = s.add(still, t) ?? result;
    }
    expect(result?.ok).toBe(true);
    expect(result?.quaternion?.y).toBeCloseTo(still.y, 5);
  });

  it('rejects a head that moved past the deviation limit', () => {
    const s = createCalibrationSampler({ durationMs: 200, maxDeviationDeg: 3 });
    s.start(0);
    let result = null;
    for (let t = 0; t <= 250; t += 16) {
      // ±10° swing about Y each frame.
      const a = (t / 16) % 2 === 0 ? 0.0872 : -0.0872;
      const w = Math.sqrt(1 - a * a);
      result = s.add({ x: 0, y: a, z: 0, w }, t) ?? result;
    }
    expect(result?.ok).toBe(false);
    expect(result?.deviationDeg).toBeGreaterThan(3);
  });

  it('treats q and -q as the same pose', () => {
    const s = createCalibrationSampler({ durationMs: 100 });
    s.start(0);
    let result = null;
    for (let i = 0, t = 0; t <= 120; i += 1, t += 16) {
      const sign = i % 2 === 0 ? 1 : -1;
      result =
        s.add({ x: 0, y: still.y * sign, z: 0, w: still.w * sign }, t) ?? result;
    }
    expect(result?.ok).toBe(true);
  });

  it('returns null until the window closes and after it is consumed', () => {
    const s = createCalibrationSampler({ durationMs: 200 });
    s.start(0);
    expect(s.add(still, 50)).toBeNull();
    expect(s.add(still, 220)).not.toBeNull();
    expect(s.isActive()).toBe(false);
    expect(s.add(still, 260)).toBeNull();
  });

  it('cannot be fed without a start', () => {
    const s = createCalibrationSampler();
    expect(s.add(still, 10)).toBeNull();
  });
});
