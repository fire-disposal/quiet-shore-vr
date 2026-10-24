import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { createWorldRuntime } from '../src/app/world-runtime';
import type { ComfortApi } from '../src/core/xr/comfort';

function harness() {

  /** Records the correction mix the runtime asks for. */
  const mixes: number[] = [];
  const comfort = {
    calibrate: vi.fn(() => true),
    reset: vi.fn(),
    stopPosture: vi.fn(),
    updatePosture: vi.fn(),
    isPostureMoving: vi.fn(() => false),
    getPostureState: vi.fn(() => ({
      phase: 'neutral' as const,
      worldPitchDeg: 0,
      worldRollDeg: 0,
      riseM: 0,
      progress: 0
    })),
    getCalibrationQuaternion: vi.fn((out: THREE.Quaternion) => out),
    setCorrectionMix: vi.fn((mix: number) => {
      mixes.push(mix);
    }),
    getCorrectionMix: vi.fn(() => mixes.at(-1) ?? 0)
  } as unknown as ComfortApi;

  const offsets: number[] = [];
  const runtime = createWorldRuntime({
    comfort: () => comfort,
    setBaseOffset: (y) => offsets.push(y)
  });
  const run = (seconds: number, step = 1 / 60): void => {
    for (let t = 0; t < seconds; t += step) {
      runtime.update(step);
    }
  };
  return {
    runtime,
    comfort,
    offsets,
    mixes,
    lastMix: () => mixes.at(-1),
    lastOffset: () => offsets.at(-1),
    run
  };
}

const SUPINE = { x: 0, y: 0, z: 0.7071068, w: 0.7071068 };
const POSITION = new THREE.Vector3(0.1, 0.62, -1.2);

describe('world runtime', () => {
  it('places the art by the scene eye and leaves the base to comfort', () => {
    const h = harness();
    h.runtime.setScene({ eyeY: 0.45 });
    h.runtime.calibrate(SUPINE, POSITION);

    expect(h.lastOffset()).toBeCloseTo(-0.45, 6);
  });

  it('starts uncorrected: the real ceiling is what the patient sees', () => {
    const h = harness();
    h.runtime.setScene({ eyeY: 1.7 });
    h.runtime.calibrate(SUPINE, POSITION);

    expect(h.lastMix()).toBe(0);
    expect(h.runtime.state().mix).toBe(0);
    expect(h.runtime.state().target).toBe(0);
    expect(h.runtime.state().ready).toBe(true);
  });

  it('ramps the correction up and back down with smootherstep', () => {
    const h = harness();
    h.runtime.setScene({ eyeY: 1.7 });
    h.runtime.calibrate(SUPINE, POSITION);
    h.runtime.setDuration(4000);

    expect(h.runtime.rise(1)).toBe(true);
    expect(h.runtime.isRising()).toBe(true);
    h.run(2);
    const halfway = h.runtime.state().mix;
    // Smootherstep is symmetric: halfway through is exactly 0.5.
    expect(halfway).toBeCloseTo(0.5, 1);
    expect(halfway).toBeGreaterThan(0.1);
    expect(halfway).toBeLessThan(0.9);

    h.run(3);
    expect(h.runtime.state().mix).toBe(1);
    expect(h.runtime.isRising()).toBe(false);

    h.runtime.rise(0);
    h.run(5);
    expect(h.runtime.state().mix).toBe(0);
  });

  it('refuses a rise before a calibration exists', () => {
    const h = harness();
    h.runtime.setScene({ eyeY: 1.7 });
    h.runtime.apply();
    expect(h.runtime.rise(1)).toBe(false);
    expect(h.runtime.state().ready).toBe(false);
  });

  it('a stop freezes the mix where it is, and a new rise resumes', () => {
    const h = harness();
    h.runtime.setScene({ eyeY: 1.7 });
    h.runtime.calibrate(SUPINE, POSITION);
    h.runtime.setDuration(4000);
    h.runtime.rise(1);
    h.run(1.2);
    const frozen = h.runtime.state().mix;
    h.runtime.stopRise();
    h.run(1);
    expect(h.runtime.state().mix).toBe(frozen);
    expect(h.runtime.isRising()).toBe(false);

    h.runtime.rise(1);
    h.run(4);
    expect(h.runtime.state().mix).toBe(1);
  });

  it('holds every motion while the calibration card is up', () => {
    const h = harness();
    h.runtime.setScene({ eyeY: 1.7 });
    h.runtime.calibrate(SUPINE, POSITION);
    h.runtime.setDuration(4000);
    h.runtime.rise(1);
    h.runtime.hold(true);

    const frozenAt = h.runtime.state().mix;
    h.runtime.update(1);
    expect(h.runtime.state().mix).toBe(frozenAt);

    h.runtime.hold(false);
    h.runtime.update(1);
    expect(h.runtime.state().mix).toBeGreaterThan(frozenAt);
  });

  it('places the art from the scene eye only', () => {
    const h = harness();
    h.runtime.setScene({ eyeY: 1.7 });
    h.runtime.calibrate(SUPINE, POSITION);
    expect(h.lastOffset()).toBeCloseTo(-1.7, 6);
    h.runtime.setScene({ eyeY: 0.45 });
    expect(h.lastOffset()).toBeCloseTo(-0.45, 6);
  });

  it('clearing the base drops the calibration and the mix', () => {
    const h = harness();
    h.runtime.setScene({ eyeY: 1.7 });
    h.runtime.calibrate(SUPINE, POSITION);
    h.runtime.rise(1);
    h.run(1);
    h.runtime.clearBase();

    expect(h.comfort.reset).toHaveBeenCalled();
    expect(h.runtime.state().mix).toBe(0);
    expect(h.runtime.state().ready).toBe(false);
  });
});
