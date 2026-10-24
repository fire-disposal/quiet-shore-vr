import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createFloating } from '../src/app/floating';
import type { BuoyancyGate } from '../src/core/xr/buoyancy-frame';
import { FLOAT_PROFILES } from '../src/core/xr/float';
import type { SceneHandle } from '../src/core/scene/contract';

function harness(options: {
  gate?: Partial<BuoyancyGate>;
  axis?: THREE.Vector3;
  split?: boolean;
  level?: number;
  profile?: 'a' | 'b' | 'c';
  heaveScale?: number;
} = {}) {
  const content = new THREE.Group();
  const floor = { y: 0 };
  const applied: { amountM: number; swayDeg: number }[] = [];
  const gate: BuoyancyGate = {
    mode: 'float',
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
    profile: options.profile,
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

  it('never runs outside the floating mode or inside a capture', () => {
    for (const gate of [{ mode: 'posture' as const }, { capturePending: true }, { rising: true }]) {
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
  it('keeps flow-driving scenes scrolling where the heave is gated off', () => {
    // The light well scrolls on getFlow(): gating the lake heave (heaveScale 0)
    // must leave the intent amplitude — and therefore the flow — intact.
    const h = harness({ level: 3, heaveScale: 0 });
    h.run(2);
    expect(h.floating.getState().amplitudeM).toBeCloseTo(0, 6);
    expect(h.floating.getFlow()).toBeGreaterThan(0.9);
    // The applied offset is only the small breath swell.
    const peak = Math.max(...h.applied.map((entry) => Math.abs(entry.amountM)));
    expect(peak).toBeLessThan(0.02);
  });

  it('uses the whole envelope at level 3 and a third of it at level 1', () => {
    const full = harness({ level: 3 });
    full.run(20);
    expect(full.floating.getState().amplitudeM).toBeCloseTo(FLOAT_PROFILES.b.amplitudeM, 4);
    const peak = Math.max(...full.applied.map((entry) => Math.abs(entry.amountM)));
    // Level 3 has to be a real vertical change: ~75 mm off the base.
    expect(peak).toBeGreaterThan(0.06);
    expect(peak).toBeLessThanOrEqual(FLOAT_PROFILES.b.amplitudeM + 1e-6);

    const low = harness({ level: 1 });
    low.run(20);
    const lowPeak = Math.max(...low.applied.map((entry) => Math.abs(entry.amountM)));
    expect(lowPeak).toBeLessThan(0.06);
  });

  it('carries the breathing layer inside the same envelope', () => {
    const h = harness({ level: 3 });
    h.run(20);
    const magnitudes = h.applied.map((entry) => Math.abs(entry.amountM));
    const peak = Math.max(...magnitudes);
    // The slow heave dominates and the breath rides below it: the total stays
    // inside the profile amplitude at every instant.
    for (const value of magnitudes) {
      expect(value).toBeLessThanOrEqual(FLOAT_PROFILES.b.amplitudeM + 1e-6);
    }
    expect(peak).toBeGreaterThan(0.06);
  });
});

describe('technician choice', () => {
  it('clamps the level to the profile cap', () => {
    const h = harness({ profile: 'c' });
    expect(h.floating.setLevel(3)).toBe(2);
    expect(h.floating.setLevel(-2)).toBe(0);
    expect(h.floating.setLevel(Number.NaN)).toBe(0);
  });

  it('pulls the level down when the profile gets stricter', () => {
    const h = harness({ level: 3, profile: 'b' });
    expect(h.floating.getLevel()).toBe(3);
    expect(h.floating.setProfile('c')).toBe(2);
    expect(h.floating.getLevel()).toBe(2);
    expect(h.floating.getProfile().label).toBe(FLOAT_PROFILES.c.label);
  });

  it('honours a scene ceiling below the profile cap', () => {
    const h = harness({ profile: 'b' });
    expect(h.floating.setLevel(3, 2)).toBe(2);
    expect(h.floating.setLevel(3, 1)).toBe(1);
    expect(h.floating.setLevel(0, 1)).toBe(0);
    // The scene cap never raises the profile cap.
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
