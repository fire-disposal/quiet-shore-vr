import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { FramePipeline } from '../src/core/geometry/pipeline';
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
