import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createPostureCue } from '../src/core/xr/posture-cue';

describe('posture cue', () => {
  it('hides at rest and fades with posture progress', () => {
    const scene = new THREE.Scene();
    const cue = createPostureCue({ scene, count: 24 });
    const head = new THREE.Vector3(0, 1.6, 0);

    cue.update(0.016, 0, head);
    expect(cue.getState().visible).toBe(false);

    cue.update(0.016, 0.5, head);
    const state = cue.getState();
    expect(state.count).toBe(24);
    expect(state.visible).toBe(true);
    expect(cue.object.visible).toBe(true);
    expect(cue.object.position.x).toBeCloseTo(0);
    expect(cue.object.position.y).toBeCloseTo(1.6);
    expect(cue.object.material).toBeInstanceOf(THREE.PointsMaterial);

    cue.dispose();
    expect(cue.object.parent).toBeNull();
  });

  it('respects the control handle: enable, intensity and fixed count', () => {
    const scene = new THREE.Scene();
    const cue = createPostureCue({ scene, count: 40 });
    const head = new THREE.Vector3(0.2, 1.4, -0.1);

    cue.setIntensity(0);
    cue.update(0.1, 0.5, head);
    expect(cue.getState().visible).toBe(false);

    cue.setIntensity(1.4);
    expect(cue.getState().intensity).toBe(1);
    cue.setEnabled(false);
    cue.update(0.1, 0.5, head);
    expect(cue.getState().visible).toBe(false);

    cue.setEnabled(true);
    cue.update(0.1, 0.5, head);
    expect(cue.getState().visible).toBe(true);
    expect(cue.getState().count).toBe(40);
    cue.dispose();
  });

  it('advances positions without changing the particle count', () => {
    const scene = new THREE.Scene();
    const cue = createPostureCue({ scene, count: 28 });
    const head = new THREE.Vector3(0, 1.6, 0);
    const positions = cue.object.geometry.getAttribute('position') as THREE.BufferAttribute;
    const before = Array.from(positions.array as Float32Array);

    cue.update(0.05, 0.5, head);
    const after = Array.from(positions.array as Float32Array);
    expect(after.length).toBe(before.length);
    expect(after.some((value, index) => value !== before[index])).toBe(true);
    cue.dispose();
  });
});
