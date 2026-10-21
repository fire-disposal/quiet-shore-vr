import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createPostureCue } from '../src/core/xr/posture-cue';
import type { PostureCueApi } from '../src/core/xr/posture-cue';

function positionArray(cue: PostureCueApi, index: number): Float32Array {
  const geometry = cue.layers[index].geometry;
  const attribute = geometry.getAttribute('position') as THREE.BufferAttribute;
  return attribute.array as Float32Array;
}

function meanDrop(before: Float32Array, after: Float32Array): number {
  let total = 0;
  let moved = 0;
  for (let i = 0; i < before.length; i += 3) {
    // Only count downward travel; wrapped motes jump back to the top.
    const drop = before[i + 1] - after[i + 1];
    if (drop > 0) {
      total += drop;
      moved += 1;
    }
  }
  return moved === 0 ? 0 : total / moved;
}

function opacity(cue: PostureCueApi, index: number): number {
  return (cue.layers[index].material as THREE.PointsMaterial).opacity;
}

/** Run `seconds` of flow at 20 fps and return how far each layer settled. */
function settle(cue: PostureCueApi, head: THREE.Vector3, flow: number, seconds: number): void {
  const frames = Math.round(seconds / 0.05);
  for (let i = 0; i < frames; i += 1) {
    cue.update(0.05, head, flow);
  }
}

describe('posture cue', () => {
  it('hides while flow is 0 and appears only during a rise', () => {
    const scene = new THREE.Scene();
    const cue = createPostureCue({ scene, count: 24, seed: 11 });
    const head = new THREE.Vector3(0, 1.6, 0);

    cue.update(0.016, head, 0);
    expect(cue.getState().visible).toBe(false);
    expect(cue.layers[0].visible).toBe(false);
    expect(cue.layers[1].visible).toBe(false);

    settle(cue, head, 1, 1);
    const state = cue.getState();
    expect(state.count).toBe(24);
    expect(state.flow).toBe(1);
    expect(state.visible).toBe(true);
    expect(cue.object.visible).toBe(true);
    expect(cue.layers[1].visible).toBe(true);
    expect(cue.object.position.x).toBeCloseTo(0);
    expect(cue.object.position.y).toBeCloseTo(1.6);
    expect(cue.layers[1].position.y).toBeCloseTo(1.6);
    expect(cue.object.material).toBeInstanceOf(THREE.PointsMaterial);

    // Flow 0 fades both layers out; no snapping in the same frame.
    cue.update(0.05, head, 0);
    expect(cue.getState().visible).toBe(true);
    settle(cue, head, 0, 3);
    expect(cue.getState().visible).toBe(false);

    cue.dispose();
    expect(cue.object.parent).toBeNull();
    expect(cue.layers[1].parent).toBeNull();
  });

  it('installs two depth layers that stay within the 40-mote budget', () => {
    const scene = new THREE.Scene();
    const cue = createPostureCue({ scene, count: 40, seed: 3 });

    expect(cue.layers).toHaveLength(2);
    expect(scene.children).toContain(cue.layers[0]);
    expect(scene.children).toContain(cue.layers[1]);

    const near = cue.layers[0];
    const far = cue.layers[1];
    const nearCount = near.geometry.getAttribute('position').count;
    const farCount = far.geometry.getAttribute('position').count;

    expect(nearCount + farCount).toBe(40);
    expect(nearCount).toBeGreaterThan(farCount);
    expect(farCount).toBeGreaterThanOrEqual(6);

    // Near motes are larger and brighter than the far backdrop.
    expect((near.material as THREE.PointsMaterial).size).toBeGreaterThan(
      (far.material as THREE.PointsMaterial).size
    );
    settle(cue, new THREE.Vector3(0, 1.6, 0), 1, 1);
    expect(opacity(cue, 0)).toBeGreaterThan(opacity(cue, 1));

    cue.dispose();
    expect(scene.children).not.toContain(near);
    expect(scene.children).not.toContain(far);
  });

  it('drifts the near layer faster than the far layer', () => {
    const scene = new THREE.Scene();
    const cue = createPostureCue({ scene, count: 40, seed: 21 });
    const head = new THREE.Vector3(0, 1.6, 0);

    settle(cue, head, 1, 2);
    const nearBefore = positionArray(cue, 0).slice();
    const farBefore = positionArray(cue, 1).slice();

    cue.update(0.05, head, 1);
    const nearDrop = meanDrop(nearBefore, positionArray(cue, 0));
    const farDrop = meanDrop(farBefore, positionArray(cue, 1));

    expect(nearDrop).toBeGreaterThan(0);
    expect(farDrop).toBeGreaterThan(0);
    expect(nearDrop / farDrop).toBeGreaterThan(1.4);
    cue.dispose();
  });

  it('brings the near band in first and lets the far band linger', () => {
    const scene = new THREE.Scene();
    const cue = createPostureCue({ scene, count: 30, seed: 5 });
    const head = new THREE.Vector3(0, 1.6, 0);

    // Early in the rise the near band is proportionally brighter.
    settle(cue, head, 1, 0.15);
    const earlyNear = opacity(cue, 0);
    const earlyFar = opacity(cue, 1);
    expect(earlyNear).toBeGreaterThan(0);
    expect(earlyNear / 0.34).toBeGreaterThan(earlyFar / 0.18);

    settle(cue, head, 1, 4);
    const steadyNear = opacity(cue, 0);
    const steadyFar = opacity(cue, 1);

    // On release the far band keeps a larger share of its steady brightness.
    settle(cue, head, 0, 0.35);
    const heldNear = opacity(cue, 0) / steadyNear;
    const heldFar = opacity(cue, 1) / steadyFar;
    expect(heldFar).toBeGreaterThan(heldNear);
    cue.dispose();
  });

  it('fades out on stop instead of popping off', () => {
    const scene = new THREE.Scene();
    const cue = createPostureCue({ scene, count: 30, seed: 13 });
    const head = new THREE.Vector3(0, 1.6, 0);

    settle(cue, head, 1, 2);
    const lit = opacity(cue, 0);
    expect(lit).toBeGreaterThan(0);

    cue.update(0.2, head, 0);
    expect(cue.getState().visible).toBe(true);
    expect(opacity(cue, 0)).toBeGreaterThan(0);
    expect(opacity(cue, 0)).toBeLessThan(lit);
    expect(opacity(cue, 1)).toBeGreaterThan(0);

    settle(cue, head, 0, 3);
    expect(cue.getState().visible).toBe(false);
    expect(cue.layers[0].visible).toBe(false);
    expect(cue.layers[1].visible).toBe(false);

    // A zero step is a hard reset (teardown / scene swap), not a fade.
    cue.update(0.05, head, 1);
    expect(cue.getState().visible).toBe(true);
    cue.update(0, head, 0);
    expect(cue.getState().visible).toBe(false);
    cue.dispose();
  });

  it('freezes mote positions the instant flow drops to 0', () => {
    const scene = new THREE.Scene();
    const cue = createPostureCue({ scene, count: 40, seed: 19 });
    const head = new THREE.Vector3(0, 1.6, 0);

    settle(cue, head, 1, 2);
    const nearBefore = positionArray(cue, 0).slice();
    const farBefore = positionArray(cue, 1).slice();

    cue.update(0.05, head, 0);
    expect(Array.from(positionArray(cue, 0))).toEqual(Array.from(nearBefore));
    expect(Array.from(positionArray(cue, 1))).toEqual(Array.from(farBefore));

    // A lowering transition must never produce downward flow: flow 0 keeps
    // the cloud frozen while it fades.
    for (let i = 0; i < 20; i += 1) {
      cue.update(0.05, head, 0);
      expect(Array.from(positionArray(cue, 0))).toEqual(Array.from(nearBefore));
      expect(Array.from(positionArray(cue, 1))).toEqual(Array.from(farBefore));
    }

    // Negative flow (reserved for a future descent cue) reads as 0 too.
    cue.update(0.05, head, -1);
    expect(Array.from(positionArray(cue, 0))).toEqual(Array.from(nearBefore));
    expect(cue.getState().flow).toBe(0);
    cue.dispose();
  });

  it('never throws motes sideways when the vertical wrap fires', () => {
    const scene = new THREE.Scene();
    const cue = createPostureCue({ scene, count: 40, seed: 17 });
    const head = new THREE.Vector3(0, 1.6, 0);
    settle(cue, head, 1, 2);

    const previous = [positionArray(cue, 0).slice(), positionArray(cue, 1).slice()];
    let maxLateral = 0;
    for (let frame = 0; frame < 1500; frame += 1) {
      cue.update(0.05, head, 1);
      for (let layerIndex = 0; layerIndex < 2; layerIndex += 1) {
        const current = positionArray(cue, layerIndex);
        const before = previous[layerIndex];
        for (let i = 0; i < current.length; i += 3) {
          maxLateral = Math.max(
            maxLateral,
            Math.abs(current[i] - before[i]),
            Math.abs(current[i + 2] - before[i + 2])
          );
        }
        before.set(current);
      }
    }

    // Over 75 s every near mote wraps at least once (slowest: 47.5 s per pass)
    // while the far layer sweeps continuously; no mote may jump in x/z.
    expect(maxLateral).toBeLessThan(0.005);
    cue.dispose();
  });

  it('keeps worst-case mote angular speed under 10 deg/s', () => {
    const scene = new THREE.Scene();
    const cue = createPostureCue({ scene, count: 40, seed: 23 });
    const head = new THREE.Vector3(0, 1.6, 0);
    settle(cue, head, 1, 2);
    const before = [positionArray(cue, 0).slice(), positionArray(cue, 1).slice()];

    cue.update(0.05, head, 1);
    const limit = (10 * Math.PI) / 180;
    for (let layerIndex = 0; layerIndex < 2; layerIndex += 1) {
      const current = positionArray(cue, layerIndex);
      const prior = before[layerIndex];
      for (let i = 0; i < current.length; i += 3) {
        const dy = current[i + 1] - prior[i + 1];
        if (dy >= 0) continue; // vertical recycle, not drift
        const dx = current[i] - prior[i];
        const dz = current[i + 2] - prior[i + 2];
        const radius = Math.hypot(prior[i], prior[i + 2]);
        const angular = Math.hypot(dx, dy, dz) / radius / 0.05;
        expect(angular).toBeLessThan(limit);
      }
    }
    cue.dispose();
  });

  it('respects the control handle: intensity, enable and fixed count', () => {
    const scene = new THREE.Scene();
    const cue = createPostureCue({ scene, count: 40, seed: 8 });
    const head = new THREE.Vector3(0.2, 1.4, -0.1);

    cue.setIntensity(1.4);
    expect(cue.getState().intensity).toBe(1);
    settle(cue, head, 1, 2);
    const lit = opacity(cue, 0);
    expect(cue.getState().visible).toBe(true);
    expect(cue.getState().count).toBe(40);

    // Intensity 0 eases out instead of snapping off.
    cue.setIntensity(0);
    cue.update(0.1, head, 1);
    expect(cue.getState().visible).toBe(true);
    expect(opacity(cue, 0)).toBeGreaterThan(0);
    expect(opacity(cue, 0)).toBeLessThan(lit);
    settle(cue, head, 1, 3);
    expect(cue.getState().visible).toBe(false);

    // cue:off dims too, and comes back without a pop.
    cue.setIntensity(1);
    settle(cue, head, 1, 2);
    cue.setEnabled(false);
    const beforeOff = opacity(cue, 0);
    cue.update(0.1, head, 1);
    expect(opacity(cue, 0)).toBeLessThan(beforeOff);
    settle(cue, head, 1, 3);
    expect(cue.getState().visible).toBe(false);

    cue.setEnabled(true);
    settle(cue, head, 1, 2);
    expect(cue.getState().visible).toBe(true);
    expect(cue.object.position.x).toBeCloseTo(0.2);
    expect(cue.layers[1].position.z).toBeCloseTo(-0.1);
    cue.dispose();
  });

  it('resumes from the frozen cloud after a lease loss without a jump', () => {
    const scene = new THREE.Scene();
    const cue = createPostureCue({ scene, count: 28, seed: 31 });
    const head = new THREE.Vector3(0, 1.6, 0);

    settle(cue, head, 1, 2);
    const lit = opacity(cue, 0);
    expect(lit).toBeGreaterThan(0.1);

    // Lease loss: the app feeds 0, which freezes and fades. The far band has
    // the longer τ (0.45 s), so the cloud is fully gone at ~2 s.
    settle(cue, head, 0, 1);
    const afterLoss = opacity(cue, 0);
    expect(afterLoss).toBeLessThan(lit);
    expect(cue.getState().flow).toBe(0);
    settle(cue, head, 0, 1.5);
    expect(cue.getState().visible).toBe(false);

    // Re-claim resumes the same rise; it ramps back instead of popping on.
    cue.update(0.05, head, 1);
    expect(cue.getState().flow).toBe(1);
    expect(opacity(cue, 0)).toBeLessThan(lit);
    settle(cue, head, 1, 2);
    expect(opacity(cue, 0)).toBeGreaterThan(0);
    cue.dispose();
  });

  it('exposes clamped depth and spread controls', () => {
    const scene = new THREE.Scene();
    const cue = createPostureCue({ scene, count: 28, seed: 2 });
    const near = cue.layers[0];
    const far = cue.layers[1];

    expect(cue.getState().depth).toBeCloseTo(0.5);
    expect(cue.getState().spread).toBeCloseTo(1);
    expect(far.scale.x).toBeCloseTo(1);

    cue.setDepth(4);
    expect(cue.getState().depth).toBe(1);
    expect(far.scale.x).toBeCloseTo(1.3);
    expect(far.scale.z).toBeCloseTo(1.3);
    expect(near.scale.x).toBeCloseTo(1);

    cue.setDepth(-2);
    expect(cue.getState().depth).toBe(0);
    expect(far.scale.x).toBeCloseTo(0.7);

    cue.setSpread(5);
    expect(cue.getState().spread).toBe(2);
    expect(near.scale.x).toBeCloseTo(2);
    expect(near.scale.y).toBeCloseTo(1);
    expect(far.scale.x).toBeCloseTo(1.5 / 1.1, 5); // joint spread/depth clamp

    cue.setSpread(0.1);
    expect(cue.getState().spread).toBeCloseTo(0.5);
    cue.dispose();
  });

  it('lays out deterministically from the seed and keeps buffers fixed', () => {
    const sceneA = new THREE.Scene();
    const sceneB = new THREE.Scene();
    const a = createPostureCue({ scene: sceneA, count: 32, seed: 99 });
    const b = createPostureCue({ scene: sceneB, count: 32, seed: 99 });
    const c = createPostureCue({ scene: new THREE.Scene(), count: 32, seed: 100 });

    expect(Array.from(positionArray(a, 0))).toEqual(Array.from(positionArray(b, 0)));
    expect(Array.from(positionArray(a, 0))).not.toEqual(Array.from(positionArray(c, 0)));

    const nearBuffer = positionArray(a, 0);
    const farBuffer = positionArray(a, 1);
    const head = new THREE.Vector3(0, 1.6, 0);
    for (let i = 0; i < 400; i += 1) {
      a.update(0.05, head, 1);
      b.update(0.05, head, 1);
    }
    // Deterministic respawn: same seed, same cloud after many wraps.
    expect(Array.from(positionArray(a, 0))).toEqual(Array.from(positionArray(b, 0)));
    expect(Array.from(positionArray(a, 1))).toEqual(Array.from(positionArray(b, 1)));
    // Buffers are reused, never reallocated.
    expect(positionArray(a, 0)).toBe(nearBuffer);
    expect(positionArray(a, 1)).toBe(farBuffer);
    expect(nearBuffer.every(Number.isFinite)).toBe(true);
    expect(farBuffer.every(Number.isFinite)).toBe(true);

    a.dispose();
    b.dispose();
    c.dispose();
  });

  it('clamps the mote budget to 20–40 and advances within layer bounds', () => {
    const small = createPostureCue({ scene: new THREE.Scene(), count: 5, seed: 1 });
    const large = createPostureCue({ scene: new THREE.Scene(), count: 200, seed: 1 });
    expect(small.getState().count).toBe(20);
    expect(large.getState().count).toBe(40);

    settle(large, new THREE.Vector3(0, 1.6, 0), 1, 25);

    const farPositions = positionArray(large, 1);
    for (let i = 0; i < farPositions.length; i += 3) {
      expect(farPositions[i + 1]).toBeGreaterThanOrEqual(-0.8);
      expect(farPositions[i + 1]).toBeLessThanOrEqual(-0.8 + 1.6);
    }

    // Per-mote brightness variation exists and is stable across frames.
    const colors = large.layers[1].geometry.getAttribute('color') as THREE.BufferAttribute;
    const values = Array.from(colors.array as Float32Array);
    const brightnessSpread = Math.max(...values) - Math.min(...values);
    expect(brightnessSpread).toBeGreaterThan(0.2);

    small.dispose();
    large.dispose();
  });
});
