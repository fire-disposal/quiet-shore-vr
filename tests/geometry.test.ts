import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import {
  applyTransform,
  composeMatrix,
  dampQuaternion,
  dampVector3
} from '../src/core/geometry/transform';
import { FramePipeline } from '../src/core/geometry/pipeline';
import { ResourceRegistry } from '../src/core/geometry/registry';
import { SceneBudget, measureObject } from '../src/core/geometry/budget';
import { disposeObject3D } from '../src/core/geometry/dispose';
import type { FrameTask, FramePhase } from '../src/core/geometry/types';

const DEG = Math.PI / 180;

function task(
  id: string,
  phase: FramePhase,
  order: number,
  run: (dt: number, now: number) => void
): FrameTask {
  return { id, phase, order, run };
}

describe('transform', () => {
  it('applies position, YXZ rotation degrees and uniform scale', () => {
    const object = new THREE.Object3D();
    applyTransform(object, { position: [1, 2, 3], rotationDeg: [10, 20, 30], scale: 2 });

    expect(object.position.toArray()).toEqual([1, 2, 3]);
    expect(object.rotation.order).toBe('YXZ');
    expect(object.rotation.x).toBeCloseTo(10 * DEG, 12);
    expect(object.rotation.y).toBeCloseTo(20 * DEG, 12);
    expect(object.rotation.z).toBeCloseTo(30 * DEG, 12);
    expect(object.scale.toArray()).toEqual([2, 2, 2]);
  });

  it('applies per-axis scale and lets a quaternion win over rotationDeg', () => {
    const object = new THREE.Object3D();
    const quaternion: [number, number, number, number] = [0, Math.SQRT1_2, 0, Math.SQRT1_2];
    applyTransform(object, {
      rotationDeg: [0, 90, 0],
      quaternion,
      scale: [1, 2, 3]
    });

    expect(object.scale.toArray()).toEqual([1, 2, 3]);
    expect(object.quaternion.x).toBeCloseTo(quaternion[0], 12);
    expect(object.quaternion.y).toBeCloseTo(quaternion[1], 12);
    expect(object.quaternion.z).toBeCloseTo(quaternion[2], 12);
    expect(object.quaternion.w).toBeCloseTo(quaternion[3], 12);
  });

  it('composes the same matrix the object ends up with', () => {
    const spec = {
      position: [1, 2, 3] as [number, number, number],
      rotationDeg: [15, 40, -20] as [number, number, number],
      scale: [2, 1, 0.5] as [number, number, number]
    };
    const object = new THREE.Object3D();
    applyTransform(object, spec);
    object.updateMatrix();

    const composed = composeMatrix(spec);
    expect(composed.elements).toHaveLength(16);
    for (let i = 0; i < 16; i++) {
      expect(composed.elements[i]).toBeCloseTo(object.matrix.elements[i], 12);
    }
  });

  it('damps vectors frame-rate independently', () => {
    const slow = new THREE.Vector3(0, 0, 0);
    const fast = new THREE.Vector3(0, 0, 0);
    const target = new THREE.Vector3(10, -4, 2);
    const rate = 6;

    for (let i = 0; i < 30; i++) dampVector3(slow, target, rate, 1 / 30);
    for (let i = 0; i < 60; i++) dampVector3(fast, target, rate, 1 / 60);

    // Both exp-decay trajectories land on the analytic value after one second.
    const alpha = 1 - Math.exp(-rate);
    expect(slow.x).toBeCloseTo(10 * alpha, 9);
    expect(slow.y).toBeCloseTo(-4 * alpha, 9);
    expect(slow.z).toBeCloseTo(2 * alpha, 9);
    expect(fast.x).toBeCloseTo(slow.x, 9);
    expect(fast.y).toBeCloseTo(slow.y, 9);
    expect(fast.z).toBeCloseTo(slow.z, 9);
  });

  it('damps quaternions frame-rate independently along the shortest arc', () => {
    const target = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
    const slow = new THREE.Quaternion();
    const fast = new THREE.Quaternion();

    for (let i = 0; i < 30; i++) dampQuaternion(slow, target, 8, 1 / 30);
    for (let i = 0; i < 60; i++) dampQuaternion(fast, target, 8, 1 / 60);

    expect(slow.x).toBeCloseTo(fast.x, 9);
    expect(slow.y).toBeCloseTo(fast.y, 9);
    expect(slow.z).toBeCloseTo(fast.z, 9);
    expect(slow.w).toBeCloseTo(fast.w, 9);
    expect(Math.abs(slow.dot(target))).toBeLessThan(1);
  });

  it('snaps on a non-positive rate and holds on a non-positive dt', () => {
    const value = new THREE.Vector3(0, 0, 0);
    const target = new THREE.Vector3(3, 3, 3);
    dampVector3(value, target, 0, 1 / 60);
    expect(value.toArray()).toEqual([3, 3, 3]);

    value.set(0, 0, 0);
    dampVector3(value, target, 5, 0);
    expect(value.toArray()).toEqual([0, 0, 0]);

    const rotation = new THREE.Quaternion();
    const rotationTarget = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(1, 0, 0),
      Math.PI / 3
    );
    dampQuaternion(rotation, rotationTarget, 0, 1 / 60);
    expect(rotation.equals(rotationTarget)).toBe(true);
  });
});

describe('FramePipeline', () => {
  it('runs phases in input→simulation→animation→layout→render order', () => {
    const pipeline = new FramePipeline();
    const log: string[] = [];
    pipeline.add(task('render', 'render', 0, () => log.push('render')));
    pipeline.add(task('layout', 'layout', 0, () => log.push('layout')));
    pipeline.add(task('input', 'input', 0, () => log.push('input')));
    pipeline.add(task('animation', 'animation', 0, () => log.push('animation')));
    pipeline.add(task('simulation', 'simulation', 0, () => log.push('simulation')));

    pipeline.run(1 / 60, 0);
    expect(log).toEqual(['input', 'simulation', 'animation', 'layout', 'render']);
  });

  it('sorts by order then keeps insertion order for ties', () => {
    const pipeline = new FramePipeline();
    const log: string[] = [];
    pipeline.add(task('c', 'simulation', 30, () => log.push('c')));
    pipeline.add(task('a', 'simulation', 10, () => log.push('a')));
    pipeline.add(task('b-first', 'simulation', 20, () => log.push('b-first')));
    pipeline.add(task('b-second', 'simulation', 20, () => log.push('b-second')));

    pipeline.run(1 / 60, 0);
    expect(log).toEqual(['a', 'b-first', 'b-second', 'c']);
  });

  it('cancels idempotently and rejects duplicate ids', () => {
    const pipeline = new FramePipeline();
    const log: string[] = [];
    pipeline.add(task('a', 'simulation', 0, () => log.push('a')));
    const cancelB = pipeline.add(task('b', 'simulation', 1, () => log.push('b')));

    expect(pipeline.size).toBe(2);
    expect(cancelB()).toBe(true);
    expect(cancelB()).toBe(false);
    expect(pipeline.size).toBe(1);
    pipeline.run(1 / 60, 0);
    expect(log).toEqual(['a']);

    expect(() => pipeline.add(task('a', 'animation', 0, () => log.push('dup')))).toThrow(
      'duplicate task id "a"'
    );
  });

  it('applies tasks added during a frame on the next frame', () => {
    const pipeline = new FramePipeline();
    const log: string[] = [];
    let added = false;
    pipeline.add(
      task('a', 'simulation', 0, () => {
        log.push('a');
        if (added) return;
        added = true;
        pipeline.add(task('b', 'simulation', 1, () => log.push('b')));
      })
    );

    pipeline.run(1 / 60, 0);
    expect(log).toEqual(['a']);
    pipeline.run(1 / 60, 1);
    expect(log).toEqual(['a', 'a', 'b']);
  });

  it('skips a task cancelled earlier in the same frame', () => {
    const pipeline = new FramePipeline();
    const log: string[] = [];
    let cancelB: (() => boolean) | null = null;
    pipeline.add(
      task('a', 'simulation', 0, () => {
        log.push('a');
        if (cancelB) cancelB();
      })
    );
    cancelB = pipeline.add(task('b', 'simulation', 1, () => log.push('b')));

    pipeline.run(1 / 60, 0);
    expect(log).toEqual(['a']);
    pipeline.run(1 / 60, 1);
    expect(log).toEqual(['a', 'a']);
  });

  it('clears all tasks', () => {
    const pipeline = new FramePipeline();
    const log: string[] = [];
    pipeline.add(task('a', 'input', 0, () => log.push('a')));
    pipeline.add(task('b', 'render', 0, () => log.push('b')));
    pipeline.clear();
    pipeline.run(1 / 60, 0);
    expect(log).toEqual([]);
    expect(pipeline.size).toBe(0);
  });
});

describe('ResourceRegistry', () => {
  it('shares one value per key and disposes at zero references', () => {
    const registry = new ResourceRegistry();
    const geometry = new THREE.BoxGeometry();
    let factoryCalls = 0;
    const factory = (): THREE.BufferGeometry => {
      factoryCalls += 1;
      return geometry;
    };
    const disposeSpy = vi.spyOn(geometry, 'dispose');

    const a = registry.acquireGeometry('box', factory);
    const b = registry.acquireGeometry('box', factory);
    expect(factoryCalls).toBe(1);
    expect(a.value).toBe(geometry);
    expect(b.value).toBe(geometry);
    expect(registry.refCount('geometry', 'box')).toBe(2);

    a.release();
    expect(registry.refCount('geometry', 'box')).toBe(1);
    expect(disposeSpy).not.toHaveBeenCalled();
    expect(registry.get('geometry', 'box')).toBe(geometry);

    a.release();
    expect(registry.refCount('geometry', 'box')).toBe(1);
    expect(disposeSpy).not.toHaveBeenCalled();

    b.release();
    expect(registry.refCount('geometry', 'box')).toBe(0);
    expect(registry.get('geometry', 'box')).toBeUndefined();
    expect(disposeSpy).toHaveBeenCalledTimes(1);

    b.release();
    expect(disposeSpy).toHaveBeenCalledTimes(1);
  });

  it('keeps kinds separate for the same key', () => {
    const registry = new ResourceRegistry();
    const geometry = new THREE.BoxGeometry();
    const material = new THREE.MeshBasicMaterial();
    const texture = new THREE.Texture();
    expect(registry.acquireGeometry('shared', () => geometry).value).toBe(geometry);
    expect(registry.acquireMaterial('shared', () => material).value).toBe(material);
    expect(registry.acquireTexture('shared', () => texture).value).toBe(texture);

    expect(registry.refCount('geometry', 'shared')).toBe(1);
    expect(registry.refCount('material', 'shared')).toBe(1);
    expect(registry.stats()).toEqual({
      geometries: 1,
      materials: 1,
      textures: 1,
      drawCalls: 0,
      triangles: 0
    });
  });

  it('disposeAll clears every kind and makes late releases no-ops', () => {
    const registry = new ResourceRegistry();
    const geometry = new THREE.BoxGeometry();
    const material = new THREE.MeshBasicMaterial();
    const texture = new THREE.Texture();
    const geometryRef = registry.acquireGeometry('g', () => geometry);
    registry.acquireMaterial('m', () => material);
    registry.acquireTexture('t', () => texture);
    const geometrySpy = vi.spyOn(geometry, 'dispose');
    const materialSpy = vi.spyOn(material, 'dispose');
    const textureSpy = vi.spyOn(texture, 'dispose');

    registry.disposeAll();
    expect(geometrySpy).toHaveBeenCalledTimes(1);
    expect(materialSpy).toHaveBeenCalledTimes(1);
    expect(textureSpy).toHaveBeenCalledTimes(1);
    expect(registry.stats()).toEqual({
      geometries: 0,
      materials: 0,
      textures: 0,
      drawCalls: 0,
      triangles: 0
    });

    geometryRef.release();
    expect(geometrySpy).toHaveBeenCalledTimes(1);
    expect(registry.refCount('geometry', 'g')).toBe(0);
  });
});

describe('SceneBudget', () => {
  it('reports only the limits that are exceeded', () => {
    const budget = new SceneBudget({ geometries: 10, drawCalls: 2, triangles: 50 });
    const violations = budget.check({
      geometries: 1,
      materials: 100,
      textures: 0,
      drawCalls: 3,
      triangles: 72
    });

    expect(violations).toHaveLength(2);
    const byKind = new Map(violations.map((violation) => [violation.kind, violation]));
    expect(byKind.get('drawCalls')).toEqual({ kind: 'drawCalls', limit: 2, actual: 3 });
    expect(byKind.get('triangles')).toEqual({ kind: 'triangles', limit: 50, actual: 72 });
    expect(budget.ok({ geometries: 10, materials: 99, textures: 0, drawCalls: 2, triangles: 50 })).toBe(
      true
    );
  });

  it('reuses a caller-provided violation array', () => {
    const budget = new SceneBudget({ triangles: 1 });
    const out: { kind: 'triangles'; limit: number; actual: number }[] = [];
    const stats = { geometries: 0, materials: 0, textures: 0, drawCalls: 0, triangles: 5 };
    expect(budget.check(stats, out)).toBe(out);
    expect(out).toHaveLength(1);
    expect(budget.check({ ...stats, triangles: 0 }, out)).toBe(out);
    expect(out).toHaveLength(0);
  });

  it('measures visible geometry, materials, textures and triangles', () => {
    const texture = new THREE.Texture();
    const material = new THREE.MeshBasicMaterial({ map: texture });
    const geometry = new THREE.BoxGeometry();
    const root = new THREE.Group();

    root.add(new THREE.Mesh(geometry, material));
    root.add(new THREE.Mesh(geometry, material));
    root.add(new THREE.InstancedMesh(geometry, material, 4));

    const hidden = new THREE.Mesh(geometry, material);
    hidden.visible = false;
    root.add(hidden);

    const hiddenGroup = new THREE.Group();
    hiddenGroup.visible = false;
    hiddenGroup.add(new THREE.Mesh(geometry, new THREE.MeshBasicMaterial()));
    root.add(hiddenGroup);

    expect(measureObject(root)).toEqual({
      geometries: 1,
      materials: 1,
      textures: 1,
      drawCalls: 3,
      triangles: 12 * 6
    });
  });

  it('counts one draw call per material in a material array', () => {
    const geometry = new THREE.BoxGeometry();
    const mesh = new THREE.Mesh(geometry, [
      new THREE.MeshBasicMaterial(),
      new THREE.MeshBasicMaterial()
    ]);
    expect(measureObject(mesh).drawCalls).toBe(2);
  });
});

describe('disposeObject3D', () => {
  it('disposes shared resources once and handles material arrays', () => {
    const texture = new THREE.Texture();
    const material = new THREE.MeshBasicMaterial({ map: texture });
    const extraMaterial = new THREE.MeshBasicMaterial();
    const geometry = new THREE.BoxGeometry();

    const first = new THREE.Mesh(geometry, material);
    const second = new THREE.Mesh(geometry, [material, extraMaterial]);
    const root = new THREE.Group();
    root.add(first);
    root.add(second);

    const geometrySpy = vi.spyOn(geometry, 'dispose');
    const materialSpy = vi.spyOn(material, 'dispose');
    const extraSpy = vi.spyOn(extraMaterial, 'dispose');
    const textureSpy = vi.spyOn(texture, 'dispose');

    disposeObject3D(root);
    disposeObject3D(root);

    expect(geometrySpy).toHaveBeenCalledTimes(1);
    expect(materialSpy).toHaveBeenCalledTimes(1);
    expect(extraSpy).toHaveBeenCalledTimes(1);
    expect(textureSpy).toHaveBeenCalledTimes(1);
  });
});
