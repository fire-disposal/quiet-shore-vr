import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { createWorldRuntime } from '../src/app/world-runtime';
import type { ComfortApi } from '../src/core/xr/comfort';
import type { WorldShellApi } from '../src/core/xr/world-shell';

function harness(options: { mode?: 'float' | 'posture'; eyeHeight?: number } = {}) {
  const basePose = vi.fn();
  const update = vi.fn();
  const shell = {
    setBasePose: basePose,
    update,
    group: new THREE.Group(),
    base: new THREE.Group()
  } as unknown as WorldShellApi;
  const offsets: number[] = [];
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
    getCalibrationQuaternion: vi.fn((out: THREE.Quaternion) => out)
  } as unknown as ComfortApi;

  let mode = options.mode ?? 'float';
  const runtime = createWorldRuntime({
    shell: () => shell,
    comfort: () => comfort,
    eyeHeight: () => options.eyeHeight ?? 1.7,
    setBaseOffset: (y) => offsets.push(y),
    mode: () => mode
  });
  return {
    runtime,
    shell,
    comfort,
    basePose,
    offsets,
    setMode: (next: 'float' | 'posture') => {
      mode = next;
    },
    lastOffset: () => offsets.at(-1)
  };
}

const SUPINE = { x: 0, y: 0, z: 0.7071068, w: 0.7071068 };
const POSITION = new THREE.Vector3(0.1, 0.62, -1.2);

describe('world runtime placement', () => {
  it('hands a standing scene to the calibrated frame with its eye at the origin', () => {
    const h = harness();
    h.runtime.setScene({ eyeY: 1.7 });
    h.runtime.calibrate(SUPINE, POSITION);

    expect(h.lastOffset()).toBeCloseTo(-1.7, 6);
    expect(h.basePose).toHaveBeenLastCalledWith(null);
    expect(h.runtime.state().posturePosesBase).toBe(false);
  });

  it('places the art by the scene eye and keeps the calibrated frame', () => {
    const h = harness();
    h.runtime.setScene({ eyeY: 0.45 });
    h.runtime.calibrate(SUPINE, POSITION);

    const state = h.runtime.state();
    expect(state.posturePosesBase).toBe(false);
    expect(h.lastOffset()).toBeCloseTo(-0.45, 6);
    expect(h.basePose).toHaveBeenLastCalledWith(null);
  });

  it('a standing scene in the posture mode starts lying and can rise', () => {
    const h = harness({ mode: 'posture' });
    h.runtime.setScene({ eyeY: 1.7 });
    h.runtime.calibrate(SUPINE, POSITION);
    expect(h.runtime.state().posturePosesBase).toBe(true);

    expect(h.runtime.rise(1)).toBe(true);
    expect(h.runtime.isRising()).toBe(true);
    h.runtime.update(0.5);
    expect(h.runtime.state().sitUpT).toBeGreaterThan(0);
    expect(h.basePose).toHaveBeenCalled();

    for (let i = 0; i < 200; i += 1) {
      h.runtime.update(0.1);
    }
    expect(h.runtime.state().sitUpT).toBe(1);
    expect(h.runtime.isRising()).toBe(false);
  });

  it('refuses a rise before a calibration prepared the path', () => {
    const h = harness({ mode: 'posture' });
    h.runtime.setScene({ eyeY: 1.7 });
    h.runtime.apply();
    expect(h.runtime.rise(1)).toBe(false);
    expect(h.runtime.state().sitUpReady).toBe(false);
  });

  it('moves the art when the eye height changes, and the path follows', () => {
    const h = harness({ mode: 'posture', eyeHeight: 1.7 });
    h.runtime.setScene({ eyeY: 1.7 });
    h.runtime.calibrate(SUPINE, POSITION);

    h.runtime.setEyeHeight(1.55);
    // The path's standing eye is now 0.15 m below the art's authored one.
    expect(h.lastOffset()).toBeCloseTo(-0.15, 6);
  });

  it('freezes every motion while the calibration card is up', () => {
    const h = harness({ mode: 'posture' });
    h.runtime.setScene({ eyeY: 1.7 });
    h.runtime.calibrate(SUPINE, POSITION);
    h.runtime.rise(1);
    h.runtime.hold(true);

    const frozenAt = h.runtime.state().sitUpT;
    h.runtime.update(1);
    expect(h.runtime.state().sitUpT).toBe(frozenAt);
    expect(h.comfort.updatePosture).not.toHaveBeenCalled();

    h.runtime.hold(false);
    h.runtime.update(1);
    expect(h.runtime.state().sitUpT).toBeGreaterThan(frozenAt);
  });

  it('advances the comfort posture only while the sit-up does not pose the base', () => {
    const h = harness();
    h.runtime.setScene({ eyeY: 1.7 });
    h.runtime.calibrate(SUPINE, POSITION);
    h.runtime.update(1 / 60);
    expect(h.comfort.updatePosture).toHaveBeenCalledTimes(1);

    h.setMode('posture');
    h.runtime.apply();
    h.runtime.update(1 / 60);
    expect(h.comfort.updatePosture).toHaveBeenCalledTimes(1);
  });

  it('clearing the base drops the pose and forgets the ramp', () => {
    const h = harness();
    h.runtime.setScene({ eyeY: 0.45 });
    h.runtime.calibrate(SUPINE, POSITION);
    h.runtime.clearBase();

    expect(h.basePose).toHaveBeenLastCalledWith(null);
    expect(h.runtime.state().sitUpReady).toBe(false);
    expect(h.runtime.state().posturePosesBase).toBe(false);
  });

  it('reports the anchor rotation telemetry measures against', () => {
    const h = harness();
    h.runtime.setScene({ eyeY: 0.45 });
    h.runtime.calibrate(SUPINE, POSITION);
    const { base0 } = h.runtime.state();
    expect(base0.length()).toBeCloseTo(1, 6);
  });
});
