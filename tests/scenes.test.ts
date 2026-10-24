import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { SCENE, SCENES, getSceneDefinition } from '../src/scenes/registry';
import { advanceCloudOffset } from '../src/scenes/shore/clouds';
import { ResourceRegistry } from '../src/core/geometry/registry';
import { measureObject } from '../src/core/geometry/budget';

function build(id: string) {
  const definition = getSceneDefinition(id);
  if (!definition) {
    throw new Error(`scene ${id} must be registered`);
  }
  const registry = new ResourceRegistry();
  const handle = definition.build({ registry });
  return { definition, handle, registry };
}

function transparentMeshes(root: THREE.Object3D): THREE.Mesh[] {
  const found: THREE.Mesh[] = [];
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) {
      return;
    }
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    if (materials.some((material) => material && material.transparent)) {
      found.push(mesh);
    }
  });
  return found;
}

describe('scene registry', () => {
  it('declares the eye its art was authored for', () => {
    const placement = Object.fromEntries(SCENES.map((scene) => [scene.id, scene.eyeY]));
    expect(placement).toEqual({ washroom: 1.7, shore: 0.45, lightwell: 1.7 });
    for (const scene of SCENES) {
      expect(Number.isFinite(scene.eyeY)).toBe(true);
      expect(scene.eyeY).toBeGreaterThan(0);
    }
  });

  it('ships the operator-selectable scenes in wire order', () => {
    // Index order is the BLE state byte 11 contract: append only.
    expect(SCENES.map((scene) => scene.id)).toEqual(['washroom', 'shore', 'lightwell']);
    expect(SCENE.id).toBe('washroom');
  });

  it('resolves every registered scene and nothing else', () => {
    for (const scene of SCENES) {
      expect(getSceneDefinition(scene.id)).toBe(scene);
    }
    expect(getSceneDefinition('unknown')).toBeUndefined();
  });

  it('declares localized copy for each', () => {
    for (const scene of SCENES) {
      expect(scene.name.zh.length).toBeGreaterThan(0);
      expect(scene.name.en.length).toBeGreaterThan(0);
      expect(scene.tagline.zh.length).toBeGreaterThan(0);
      expect(scene.description.zh.length).toBeGreaterThan(scene.tagline.zh.length);
    }
  });

  it('keeps the water bed to the two scenes that have water', () => {
    const water = SCENES.filter((scene) => scene.audio !== undefined);
    expect(water.map((scene) => scene.id).sort()).toEqual(['shore', 'washroom']);
    for (const scene of water) {
      expect(['lake', 'stream']).toContain(scene.audio!.track);
      const width = scene.audio!.width ?? 0;
      expect(width).toBeGreaterThan(0);
      expect(width).toBeLessThanOrEqual(1);
    }
    // The light well is meant to be heard as one's own breathing.
    expect(getSceneDefinition('lightwell')?.audio).toBeUndefined();
  });
});

describe('scene capabilities', () => {
  it('declares one eye height per scene, sane for the headset', () => {
    for (const id of ['washroom', 'shore', 'lightwell']) {
      const scene = getSceneDefinition(id)!;
      // 0.45 m = lying on water, 1.70 m = standing height. Outside this band the
      // art would either sink through the floor or float above the room.
      expect(scene.eyeY).toBeGreaterThanOrEqual(0.3);
      expect(scene.eyeY).toBeLessThanOrEqual(2.0);
    }
  });

  it('caps the strongest flow-driven scene below the global maximum', () => {
    // The ceiling is the app's guard against the one combination we know is
    // uncomfortable: vertical optic flow at full amplitude.
    const ceilings = Object.fromEntries(SCENES.map((scene) => [scene.id, scene.comfortLevel ?? 3]));
    expect(ceilings).toEqual({ washroom: 3, shore: 3, lightwell: 2 });
  });

  it('hands each motion channel to the scene that needs it', () => {
    const washroom = build('washroom').handle;
    const shore = build('shore').handle;
    const lightwell = build('lightwell').handle;
    try {
      // The room is static: no per-frame work beyond the patient's own motion.
      expect(washroom.applyBuoyancy).toBeUndefined();
      expect(washroom.setFlow).toBeUndefined();
      // The lake carries the buoyancy itself so the horizon stays level.
      expect(typeof shore.applyBuoyancy).toBe('function');
      expect(shore.setFlow).toBeUndefined();
      // The well manufactures the flow; the app only feeds it a 0..1 value.
      expect(typeof lightwell.setFlow).toBe('function');
      expect(lightwell.applyBuoyancy).toBeUndefined();
    } finally {
      washroom.dispose();
      shore.dispose();
      lightwell.dispose();
    }
  });

  it('keeps the lake swell inside a comfort envelope', () => {
    const { handle } = build('shore');
    try {
      const swell = handle.root.getObjectByName('shore-swell') as THREE.Object3D;
      expect(swell).toBeDefined();
      let minY = Infinity;
      let maxY = -Infinity;
      let maxTilt = 0;
      for (let i = 0; i < 400; i += 1) {
        handle.update(0.25, i * 0.25);
        minY = Math.min(minY, swell.position.y);
        maxY = Math.max(maxY, swell.position.y);
        maxTilt = Math.max(maxTilt, Math.abs(swell.rotation.x), Math.abs(swell.rotation.z));
      }
      // A couple of centimetres of heave, and a tilt the horizon cannot show.
      expect(maxY - minY).toBeGreaterThan(0.005);
      expect(maxY - minY).toBeLessThan(0.05);
      expect(THREE.MathUtils.radToDeg(maxTilt)).toBeLessThan(0.05);
    } finally {
      handle.dispose();
    }
  });

  it('drifts the clouds one way, without moving the sheet', () => {
    const { handle } = build('shore');
    try {
      const clouds = handle.root.getObjectByName('shore-cloud-sheet') as THREE.Mesh | undefined;
      const group = handle.root.getObjectByName('shore-clouds') as THREE.Object3D | undefined;
      expect(clouds).toBeDefined();
      expect(group).toBeDefined();

      const start = clouds!.position.clone();
      const startRotation = clouds!.rotation.z;
      for (let i = 0; i < 120; i += 1) {
        handle.update(0.5, i * 0.5);
      }
      // The sheet never moves: no swings, no wobble, no rolling accumulation.
      expect(clouds!.position.distanceTo(start)).toBeLessThan(1e-9);
      expect(clouds!.rotation.z).toBeCloseTo(startRotation, 9);
    } finally {
      handle.dispose();
    }
  });

  it('scrolls the cloud texture at a constant, one-way, very slow rate', () => {
    // Headless hosts have no canvas, so the offset is exercised directly.
    let offset = 0;
    const step = advanceCloudOffset(offset, 1);
    expect(step).toBeGreaterThan(0);
    // 0.12 m/s across an 83 m tile: ~0.00144 per second.
    expect(step).toBeGreaterThan(0.0013);
    expect(step).toBeLessThan(0.0016);

    for (let i = 0; i < 10_000; i += 1) {
      const next = advanceCloudOffset(offset, 1);
      if (next >= offset) {
        // One direction only, at a constant rate.
        expect(next - offset).toBeCloseTo(step, 9);
      } else {
        // The only discontinuity is the modulo, and it lands one step past 0.
        expect(next).toBeLessThan(step * 2);
      }
      offset = next;
    }
  });

  it('exposes no gaze targets and no camera of its own', () => {
    for (const id of ['washroom', 'shore', 'lightwell']) {
      const { handle } = build(id);
      try {
        // Selection in a scene would be a second interaction model; the only
        // gaze targets in the app belong to the SUS panel.
        expect(handle.selectables).toHaveLength(0);
        expect(handle.root.getObjectByProperty('isCamera', true)).toBeUndefined();
      } finally {
        handle.dispose();
      }
    }
  });
});

describe('scene budgets', () => {
  it('keeps every scene inside the one-device frame budget', () => {
    for (const scene of SCENES) {
      const { handle, registry } = build(scene.id);
      try {
        const stats = measureObject(handle.root);
        expect(stats.drawCalls).toBeLessThanOrEqual(10);
        expect(stats.triangles).toBeLessThanOrEqual(3000);
        expect(stats.textures).toBeLessThanOrEqual(6);
        expect(handle.budget).toBeDefined();
        expect(handle.budget!.check(stats)).toEqual([]);
      } finally {
        handle.dispose();
        registry.disposeAll();
      }
    }
  });

  it('builds a static room with no transparency', () => {
    const { handle } = build('washroom');
    expect(transparentMeshes(handle.root)).toHaveLength(0);
    expect(handle.settings.fog).toBeNull();
    handle.dispose();
  });

  it('keeps the urinal mouth broad and clear of the wall', () => {
    const { handle } = build('washroom');
    try {
      const fixture = handle.root.getObjectByName('washroom-urinal') as THREE.Mesh;
      const position = fixture.geometry.getAttribute('position') as THREE.BufferAttribute;
      let minX = Number.POSITIVE_INFINITY;
      let maxX = Number.NEGATIVE_INFINITY;
      let maxZ = Number.NEGATIVE_INFINITY;
      let minZ = Number.POSITIVE_INFINITY;
      for (let i = 0; i < position.count; i += 1) {
        const x = position.getX(i);
        const y = position.getY(i);
        const z = position.getZ(i);
        minZ = Math.min(minZ, z);
        if (y < 0.88 || y > 1.2 || z < -0.76) {
          continue;
        }
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        maxZ = Math.max(maxZ, z);
      }
      expect(maxX - minX).toBeGreaterThan(0.33);
      expect(maxZ).toBeLessThan(-0.35);
      expect(minZ).toBeGreaterThan(-0.85);
    } finally {
      handle.dispose();
    }
  });

  it('builds a shoreline with a fog horizon and soft anchors', () => {
    const { handle } = build('shore');
    expect(handle.settings.fog).toBeInstanceOf(THREE.Fog);
    expect(handle.root.getObjectByName('shore-dome')).toBeDefined();
    expect(handle.root.getObjectByName('shore-posts')).toBeDefined();
    expect(handle.root.getObjectByName('shore-reeds')).toBeDefined();
    expect(handle.root.getObjectByName('shore-treeline')).toBeDefined();
    // Only the two cloud decks, the sun path and the reeds may blend.
    expect(transparentMeshes(handle.root).length).toBeLessThanOrEqual(4);
    handle.dispose();
  });

  it('moves the wall fixtures upward only through the flow hook', () => {
    const { handle } = build('lightwell');
    const fixtures = handle.root.getObjectByName('lightwell-shelves') as THREE.InstancedMesh;
    expect(fixtures).toBeDefined();
    // Four wall planes, not a box: the box's own lid fought the sky cap.
    expect((handle.root.getObjectByName('lightwell-walls') as THREE.InstancedMesh).count).toBe(4);
    // No hoop can cross the camera plane: the tori are gone, and the fixtures
    // are directional wall brackets, not rings.
    expect(handle.root.getObjectByName('lightwell-rings')).toBeUndefined();
    expect(handle.root.getObjectByName('lightwell-gussets')).toBeDefined();

    const before = new THREE.Matrix4();
    fixtures.getMatrixAt(0, before);
    // Fixtures hang on a wall of the square shaft: the anchor sits on the
    // 6 m section's skin (3 m from the axis), so the shelf touches the wall
    // instead of floating out in the middle of the shaft.
    const anchor = new THREE.Vector3().setFromMatrixPosition(before);
    expect(Math.max(Math.abs(anchor.x), Math.abs(anchor.z))).toBeCloseTo(3, 1);
    handle.update(0.5, 0.5);
    const still = new THREE.Matrix4();
    fixtures.getMatrixAt(0, still);
    expect(still.equals(before)).toBe(true);

    handle.setFlow?.(1);
    let previousY = new THREE.Vector3().setFromMatrixPosition(before).y;
    const offsets: number[] = [];
    for (let i = 0; i < 60; i += 1) {
      handle.update(1 / 30, 0.5 + i / 30);
      fixtures.getMatrixAt(0, still);
      const y = new THREE.Vector3().setFromMatrixPosition(still).y;
      // Upward, never down (a wrap drops it by the band length once).
      expect(y).toBeGreaterThanOrEqual(previousY - 40.1);
      previousY = y;
      offsets.push(y);
    }
    // The brackets are the only moving part now; the shaft itself is static.
    expect(offsets[offsets.length - 1]).toBeGreaterThan(offsets[0]);
    handle.dispose();
  });
  it('disposes idempotently', () => {
    const { handle } = build('shore');
    expect(() => {
      handle.dispose();
      handle.dispose();
    }).not.toThrow();
    expect(handle.root.children).toHaveLength(0);
  });
});
