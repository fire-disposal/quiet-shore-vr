import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createFloating } from '../src/app/floating';
import type { BuoyancyGate } from '../src/core/xr/buoyancy-frame';
import { FLOAT_PROFILES } from '../src/core/xr/float';
import type { SceneHandle } from '../src/core/scene/contract';

function harness(options: {
  gate?: Partial<BuoyancyGate>;
  split?: boolean;
  level?: number;
  profile?: 'a' | 'b' | 'c';
} = {}) {
  const content = new THREE.Group();
  const floor = { y: 0 };
  const applied: { amountM: number; swayDeg: number }[] = [];
  const swell: { depth: number; period: number }[] = [];
  const gate: BuoyancyGate = {
    mode: 'float',
    active: true,
    capturePending: false,
    frame: 'calibrated',
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
      content
    },
    handle: () => handle,
    gate: () => gate,
    swell: (depth, period) => swell.push({ depth, period }),
    level: options.level,
    profile: options.profile,
    breath: true
  });
  const run = (seconds: number, step = 1 / 60): void => {
    for (let t = 0; t < seconds; t += step) {
      floating.update(step);
    }
  };
  return { floating, floor, content, applied, swell, gate, run };
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
    expect(h.applied.at(-1)).toEqual({ amountM: 0, swayDeg: 0 });
  });

  it('never runs outside the floating mode or inside a capture', () => {
    for (const gate of [{ mode: 'posture' as const }, { capturePending: true }, { frame: 'posture' as const }]) {
      const h = harness({ level: 3, gate });
      h.run(1);
      expect(h.floating.getState().amplitudeM).toBe(0);
    }
  });

  it('stops the audio swell with the motion', () => {
    const h = harness({ level: 2 });
    h.run(1);
    expect(h.swell.at(-1)!.depth).toBeGreaterThan(0);
    h.gate.active = false;
    h.run(2.5);
    expect(h.swell.at(-1)!.depth).toBe(0);
  });
});

describe('technician choice', () => {
  it('clamps the level to the profile cap', () => {
    const h = harness({ profile: 'c' });
    expect(h.floating.setLevel(3)).toBe(1);
    expect(h.floating.setLevel(-2)).toBe(0);
    expect(h.floating.setLevel(Number.NaN)).toBe(0);
  });

  it('pulls the level down when the profile gets stricter', () => {
    const h = harness({ level: 3, profile: 'b' });
    expect(h.floating.getLevel()).toBe(3);
    expect(h.floating.setProfile('c')).toBe(1);
    expect(h.floating.getLevel()).toBe(1);
    expect(h.floating.getProfile().label).toBe(FLOAT_PROFILES.c.label);
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
