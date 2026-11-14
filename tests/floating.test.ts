import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createFloating } from '../src/app/floating';
import type { BuoyancyGate } from '../src/core/xr/buoyancy-frame';
import { FLOAT_AMPLITUDE_M } from '../src/core/xr/float';

function harness(options: {
  gate?: Partial<BuoyancyGate>;
  amount?: number;
} = {}) {
  const content = new THREE.Group();
  const backdrop = new THREE.Group();
  /** What the heave wrote, in order: the content's position, per applied frame. */
  const applied: { x: number; y: number; z: number }[] = [];
  const gate = {
    active: true,
    capturePending: false,
    rising: false,
    ...options.gate
  } satisfies BuoyancyGate;
  // One mechanism: every scene moves its content and every scene keeps a
  // backdrop still. The content's own +Y carries the compensation.
  const floating = createFloating({
    host: {
      setFloorOffset: (y) => {
        content.position.y = y;
      },
      setBackdropOffset: (y) => {
        backdrop.position.y = y;
      },
      setContentPosition: (x, y, z) => {
        content.position.set(x, y, z);
        applied.push({ x, y, z });
      }
    },
    gate: () => gate,
    amount: options.amount,
    breath: true
  });
  const run = (seconds: number, step = 1 / 60): void => {
    for (let t = 0; t < seconds; t += step) {
      floating.update(step);
    }
  };
  return { floating, content, backdrop, applied, gate, run };
}

describe('buoyancy envelope', () => {
  it('fades in from rest and keeps the heave inside the envelope', () => {
    const h = harness({ amount: 1 / 3 });
    h.run(1.5);
    const state = h.floating.getState();
    expect(state.amplitudeM).toBeGreaterThan(0.015);
    expect(state.amplitudeM).toBeLessThanOrEqual(0.065 + 1e-9);
    expect(Math.abs(state.offsetM)).toBeLessThanOrEqual(state.amplitudeM + 1e-9);
  });

  it('fades out instead of cutting when the gate closes', () => {
    const h = harness({ amount: 1 });
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
    // Settled scenes are cheap: the last write carries no heave.
    const last = h.applied.at(-1)!;
    expect(Math.abs(last.y - h.floating.getState().baseOffset)).toBeLessThan(1e-9);
  });

  it('never runs outside a running session or inside a capture', () => {
    for (const gate of [{ active: false }, { capturePending: true }, { rising: true }]) {
      const h = harness({ amount: 1, gate });
      h.run(1);
      expect(h.floating.getState().amplitudeM).toBe(0);
    }
  });

  it('returns the scene to rest once the gate closes', () => {
    const h = harness({ amount: 2 / 3 });
    h.run(1.5);
    h.gate.active = false;
    h.run(2.5);
    expect(h.floating.getState().offsetM).toBe(0);
    const last = h.applied.at(-1)!;
    expect(Math.abs(last.y - h.floating.getState().baseOffset)).toBeLessThan(1e-9);
  });
});

describe('perceptible heave', () => {
  it('heaves along the compensated content vertical, never double-counted', () => {
    const h = harness({ amount: 1 });
    h.run(9);
    const state = h.floating.getState();
    expect(Math.abs(state.offsetM)).toBeGreaterThan(0.001);

    const moved = new THREE.Vector3(
      h.content.position.x,
      h.content.position.y - state.baseOffset,
      h.content.position.z
    );
    expect(moved.x).toBeCloseTo(0, 8);
    expect(moved.y).toBeCloseTo(state.offsetM, 8);
    expect(moved.z).toBeCloseTo(0, 8);
  });
  it('keeps the backdrop still while the content heaves', () => {
    const h = harness({ amount: 1 });
    h.floating.setBaseOffset(-1.7);
    h.run(3);
    const bob = h.floating.getState().offsetM;
    expect(Math.abs(bob)).toBeGreaterThan(0.001);
    // The sky takes the frame offset and nothing else.
    expect(h.backdrop.position.y).toBeCloseTo(-1.7, 6);
    expect(h.content.position.y).toBeCloseTo(-1.7 + bob, 6);
  });

  it('uses the whole envelope at 100% and a third of it at 33%', () => {
    const full = harness({ amount: 1 });
    full.run(20);
    expect(full.floating.getState().amplitudeM).toBeCloseTo(FLOAT_AMPLITUDE_M, 4);
    const peak = Math.max(...full.applied.map((entry) => Math.abs(entry.y - 0)));
    // Full envelope has to be a real vertical change: ~150 mm off the base.
    expect(peak).toBeGreaterThan(0.10);
    expect(peak).toBeLessThanOrEqual(FLOAT_AMPLITUDE_M + 1e-6);

    const low = harness({ amount: 1 / 3 });
    low.run(20);
    const lowPeak = Math.max(...low.applied.map((entry) => Math.abs(entry.y - 0)));
    expect(lowPeak).toBeLessThan(0.07);
  });
});

describe('technician choice', () => {
  it('clamps the amount to the envelope', () => {
    const h = harness();
    expect(h.floating.setAmount(1)).toBe(1);
    expect(h.floating.setAmount(-2)).toBe(0);
    expect(h.floating.setAmount(Number.NaN)).toBe(0);
    // Continuous: 47 % is 47 %, not the nearest quarter.
    expect(h.floating.setAmount(0.47)).toBeCloseTo(0.47, 6);
  });

  it('scales the envelope with the amount', () => {
    const low = harness({ amount: 1 / 3 });
    const high = harness({ amount: 1 });
    low.run(2);
    high.run(2);
    expect(high.floating.getState().amplitudeM).toBeGreaterThan(low.floating.getState().amplitudeM);
  });
});

describe('content offset ownership', () => {
  it('adds the heave to the frame offset and never replaces it', () => {
    const h = harness({ amount: 0.6 });
    h.floating.setBaseOffset(-1.7);
    h.run(1.5);
    const { offsetM } = h.floating.getState();
    expect(offsetM).not.toBe(0);
    expect(h.content.position.y).toBeCloseTo(-1.7 + offsetM, 6);
  });

  it('moves the art only along content Y', () => {
    const h = harness({ amount: 1 });
    h.floating.setBaseOffset(-1.7);
    h.run(2);
    const { offsetM } = h.floating.getState();
    expect(offsetM).not.toBe(0);
    expect(h.content.position.x).toBeCloseTo(0, 8);
    expect(h.content.position.y).toBeCloseTo(-1.7 + offsetM, 6);
    expect(h.content.position.z).toBeCloseTo(0, 8);
  });

  it('gives the backdrop the frame offset and the content the heave', () => {
    const h = harness({ amount: 0.6 });
    h.floating.setBaseOffset(-1.7);
    h.run(1.5);
    expect(h.backdrop.position.y).toBeCloseTo(-1.7, 6);
    const last = h.applied.at(-1)!;
    expect(last.y).toBeCloseTo(-1.7 + h.floating.getState().offsetM, 6);
  });

  it('a new frame offset wipes nothing of the running heave', () => {
    const h = harness({ amount: 1 });
    h.run(1.5);
    const bob = h.floating.getState().offsetM;
    h.floating.setBaseOffset(0);
    expect(h.floating.getState().offsetM).toBe(bob);
  });

  it('ignores a non-finite frame offset', () => {
    const h = harness({ amount: 2 / 3 });
    h.floating.setBaseOffset(Number.NaN);
    expect(h.floating.getState().baseOffset).toBe(0);
  });

  it('reset clears the applied motion without moving the frame', () => {
    const h = harness({ amount: 1 });
    h.floating.setBaseOffset(-1.7);
    h.run(1.5);
    h.floating.reset();
    expect(h.floating.getState().offsetM).toBe(0);
    expect(h.floating.getState().baseOffset).toBe(-1.7);
    expect(h.content.position.y).toBeCloseTo(-1.7, 6);
  });
});
