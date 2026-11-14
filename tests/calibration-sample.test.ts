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

  describe('capacity covers the whole window, not its prefix', () => {
    /** A quaternion turned `deg` about Y. */
    function yawQuat(deg: number): { x: number; y: number; z: number; w: number } {
      const half = (deg * Math.PI) / 360;
      return { x: 0, y: Math.sin(half), z: 0, w: Math.cos(half) };
    }

    it('averages a 3 s window at 72 Hz including a late drift', () => {
      // The repro: still for 2 s, then 10° of drift in the last second. With a
      // 64-sample buffer the window only covered the first 0.89 s and reported
      // `samples=64, ok=true, meanY=0` — an accepted window of the wrong pose.
      const s = createCalibrationSampler({ durationMs: 3000 });
      const frameMs = 1000 / 72;
      const frames = Math.floor(3000 / frameMs);
      s.start(0);
      let result = null;
      for (let i = 0; i <= frames; i += 1) {
        const t = i * frameMs;
        const driftDeg = t > 2000 ? ((t - 2000) / 1000) * 10 : 0;
        result = s.add(yawQuat(driftDeg), t) ?? result;
      }

      expect(result).not.toBeNull();
      // Every frame of the window is in the average, so the late drift is too.
      expect(result?.samples).toBe(frames + 1);
      expect(result?.samples).toBeGreaterThan(200);
      // The drift is in the last third of the window, so the mean is a small
      // but unmistakable fraction of 10° — with the 64-sample buffer it was 0.
      expect(result?.quaternion?.y).toBeGreaterThan(0.005);
      expect(result?.deviationDeg).toBeGreaterThan(6);
      expect(result?.ok).toBe(false);
    });

    it('keeps samples spanning the window when the buffer is too small', () => {
      // A small explicit buffer must not turn into a silent prefix: the average
      // still has to reach the last frames, so a late move is still caught.
      const s = createCalibrationSampler({ durationMs: 1000, capacity: 8 });
      const frameMs = 1000 / 72;
      const frames = Math.floor(1000 / frameMs);
      s.start(0);
      let result = null;
      for (let i = 0; i <= frames; i += 1) {
        const t = i * frameMs;
        const driftDeg = t > 800 ? ((t - 800) / 200) * 20 : 0;
        result = s.add(yawQuat(driftDeg), t) ?? result;
      }
      expect(result).not.toBeNull();
      expect(result?.samples).toBeLessThanOrEqual(8);
      // The late 20° excursion is represented: the spread is far past the gate.
      expect(result?.deviationDeg).toBeGreaterThan(6);
      expect(result?.ok).toBe(false);
    });

    it('still averages exactly a still head inside a small buffer', () => {
      const s = createCalibrationSampler({ durationMs: 1000, capacity: 8 });
      s.start(0);
      let result = null;
      for (let i = 0; i <= 72; i += 1) {
        result = s.add(still, (i * 1000) / 72) ?? result;
      }
      expect(result?.ok).toBe(true);
      expect(result?.quaternion?.y).toBeCloseTo(still.y, 5);
      expect(result?.quaternion?.w).toBeCloseTo(still.w, 5);
    });
  });
});
