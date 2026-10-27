import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createFloating } from '../src/app/floating';
import type { BuoyancyGate } from '../src/core/xr/buoyancy-frame';
import { FLOAT_AMPLITUDE_M } from '../src/core/xr/float';
import type { SceneHandle } from '../src/core/scene/contract';

function harness(options: {
  gate?: Partial<BuoyancyGate>;
  axis?: THREE.Vector3;
  split?: boolean;
  level?: number;
  heaveScale?: number;
} = {}) {
  const content = new THREE.Group();
  const floor = { y: 0 };
  const applied: { amountM: number; swayDeg: number }[] = [];
  const gate: BuoyancyGate = {
    active: true,
    capturePending: false,
    rising: false,
    ...options.gate
  };
  const handle = (options.split === false
    ? null
    : ({
        applyBuoyancy: (state: { amountM: number; swayDeg: number }) => {
          applied.push({ ...state });
          content.rotation.x = 0;
        }
      } as unknown as SceneHandle)) ?? null;
  const floating = createFloating({
    host: {
      setFloorOffset: (y) => {
        floor.y = y;
        content.position.y = y;
      },
      setContentPosition: (x, y, z) => {
        floor.y = y;
        content.position.set(x, y, z);
      },
      content
    },
    handle: () => handle,
    gate: () => gate,
    axis: (out) => out.copy(options.axis ?? new THREE.Vector3(0, 1, 0)),
    level: options.level,
    breath: true,
    heaveScale: () => options.heaveScale ?? 1
  });
  const run = (seconds: number, step = 1 / 60): void => {
    for (let t = 0; t < seconds; t += step) {
      floating.update(step);
    }
  };
  return { floating, floor, content, applied, gate, run };
}

describe('buoyancy envelope', () => {
  it('fades in from rest and keeps the heave inside the envelope', () => {
    const h = harness({ level: 1 });
    h.run(1.5);
    const state = h.floating.getState();
    expect(state.amplitudeM).toBeGreaterThan(0.015);
    expect(state.amplitudeM).toBeLessThanOrEqual(0.065 + 1e-9);
    expect(Math.abs(state.offsetM)).toBeLessThanOrEqual(state.amplitudeM + 1e-9);
  });

  it('fades out instead of cutting when the gate closes', () => {
    const h = harness({ level: 3 });
    h.run(1.5);
    const before = Math.abs(h.floating.getState().offsetM);
    expect(before).toBeGreaterThan(0.01);
    h.gate.active = false;
    h.run(0.3);
    expect(h.floating.getState().amplitudeM).toBeGreaterThan(0);
    // A 0.25 s time constant needs ~1.6 s to reach the settle threshold.
    h.run(2.5);
    expect(h.floating.getState().amplitudeM).toBe(0);
    expect(h.floating.getState().offsetM).toBe(0);
    // Settled scenes are cheap: the last write is a single zero.
    const last = h.applied.at(-1)!;
    expect(last.amountM).toBe(0);
  });

  it('never runs outside a running session or inside a capture', () => {
    for (const gate of [{ active: false }, { capturePending: true }, { rising: true }]) {
      const h = harness({ level: 3, gate });
      h.run(1);
      expect(h.floating.getState().amplitudeM).toBe(0);
    }
  });

  it('returns the scene to rest once the gate closes', () => {
    const h = harness({ level: 2 });
    h.run(1.5);
    h.gate.active = false;
    h.run(2.5);
    expect(h.floating.getState().offsetM).toBe(0);
    const last = h.applied.at(-1)!;
    expect(last.amountM).toBe(0);
  });
});

describe('perceptible heave', () => {
  it('heaves as one vector along the visual up, never double-counted', () => {
    // A tilted frame (the operator looked up): the content must move exactly
    // offsetM along the axis. Adding the full offset to Y as well made the
    // displacement 19% too long and pointed it the wrong way.
    const axis = new THREE.Vector3(0.6, 0.8, 0).normalize();
    const h = harness({ level: 3, axis, split: false });
    h.run(9);
    const state = h.floating.getState();
    expect(Math.abs(state.offsetM)).toBeGreaterThan(0.001);

    const moved = new THREE.Vector3(
      h.content.position.x,
      h.content.position.y - state.baseOffset,
      h.content.position.z
    );
    const expected = axis.clone().multiplyScalar(state.offsetM);
    expect(moved.distanceTo(expected)).toBeLessThan(1e-6);
  });
  it('leaves a heave-gated scene completely still', () => {
    // Only the shore takes the heave; other scenes are static, not "breathing".
    const h = harness({ level: 3, heaveScale: 0 });
    h.run(2);
    expect(h.floating.getState().amplitudeM).toBeCloseTo(0, 6);
    expect(h.floating.getState().offsetM).toBe(0);
  });

  it('uses the whole envelope at level 3 and a third of it at level 1', () => {
    const full = harness({ level: 3 });
    full.run(20);
    expect(full.floating.getState().amplitudeM).toBeCloseTo(FLOAT_AMPLITUDE_M, 4);
    const peak = Math.max(...full.applied.map((entry) => Math.abs(entry.amountM)));
    // Level 3 has to be a real vertical change: ~150 mm off the base.
    expect(peak).toBeGreaterThan(0.10);
    expect(peak).toBeLessThanOrEqual(FLOAT_AMPLITUDE_M + 1e-6);

    const low = harness({ level: 1 });
    low.run(20);
    const lowPeak = Math.max(...low.applied.map((entry) => Math.abs(entry.amountM)));
    expect(lowPeak).toBeLessThan(0.07);
  });
});

describe('technician choice', () => {
  it('clamps the level to the global range', () => {
    const h = harness();
    expect(h.floating.setLevel(3)).toBe(3);
    expect(h.floating.setLevel(-2)).toBe(0);
    expect(h.floating.setLevel(Number.NaN)).toBe(0);
  });

  it('honours a scene ceiling', () => {
    const h = harness();
    expect(h.floating.setLevel(3, 2)).toBe(2);
    expect(h.floating.setLevel(3, 1)).toBe(1);
    expect(h.floating.setLevel(0, 1)).toBe(0);
    // A generous scene cap never raises the global maximum.
    expect(h.floating.setLevel(3, 9)).toBe(3);
  });

  it('scales the envelope with the level', () => {
    const low = harness({ level: 1 });
    const high = harness({ level: 3 });
    low.run(2);
    high.run(2);
    expect(high.floating.getState().amplitudeM).toBeGreaterThan(low.floating.getState().amplitudeM);
  });
});

describe('content offset ownership', () => {
  it('adds the heave to the frame offset and never replaces it', () => {
    const h = harness({ level: 2, split: false });
    h.floating.setBaseOffset(-1.7);
    h.run(1.5);
    const { offsetM } = h.floating.getState();
    expect(offsetM).not.toBe(0);
    expect(h.floor.y).toBeCloseTo(-1.7 + offsetM, 6);
  });

  it('moves the art along the visual up, not only along Y', () => {
    const h = harness({ level: 3, split: false, axis: null });
    h.floating.setBaseOffset(-1.7);
    h.run(2);
    const { offsetM } = h.floating.getState();
    expect(offsetM).not.toBe(0);
    expect(h.floor.y).toBeCloseTo(-1.7 + offsetM, 6);
  });

  it('hands the bare frame offset to a scene that splits its own layers', () => {
    const h = harness({ level: 2, split: true });
    h.floating.setBaseOffset(-1.7);
    h.run(1.5);
    expect(h.floor.y).toBeCloseTo(-1.7, 6);
    expect(h.applied.at(-1)!.amountM).toBeCloseTo(h.floating.getState().offsetM, 6);
  });

  it('a new frame offset wipes nothing of the running heave', () => {
    const h = harness({ level: 3 });
    h.run(1.5);
    const bob = h.floating.getState().offsetM;
    h.floating.setBaseOffset(0);
    expect(h.floating.getState().offsetM).toBe(bob);
  });

  it('ignores a non-finite frame offset', () => {
    const h = harness({ level: 2 });
    h.floating.setBaseOffset(Number.NaN);
    expect(h.floating.getState().baseOffset).toBe(0);
  });

  it('reset clears the applied motion without moving the frame', () => {
    const h = harness({ level: 3 });
    h.floating.setBaseOffset(-1.7);
    h.run(1.5);
    h.floating.reset();
    expect(h.floating.getState().offsetM).toBe(0);
    expect(h.floating.getState().baseOffset).toBe(-1.7);
    expect(h.floor.y).toBeCloseTo(-1.7, 6);
  });
});
