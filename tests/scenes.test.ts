import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { SCENE, SCENES, getSceneDefinition } from '../src/scenes/registry';
import { advanceCloudOffset } from '../src/scenes/shore/clouds';
import { advanceEcgOffset } from '../src/scenes/ward/room';
import { measureObject } from '../src/core/geometry/budget';
import { MATTRESS_TOP_M, WATER_EYE_M, lyingEyeY } from '../src/core/anatomy';
import { FLOAT_AMPLITUDE_M } from '../src/core/xr/float';
import { SHORE_DROP_M, SWELL_M } from '../src/scenes/shore';

function build(id: string) {
  const definition = getSceneDefinition(id);
  if (!definition) {
    throw new Error(`scene ${id} must be registered`);
  }
  const handle = definition.build();
  return { definition, handle };
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
  it('declares a posture the anatomy table resolves', () => {
    // Scenes state the height their art was drawn from and what the body rests
    // on; the lying height is derived, so no scene can hand-type a bed again.
    const eyes = Object.fromEntries(
      SCENES.map((scene) => [
        scene.id,
        {
          standing: scene.posture.standingEyeY,
          lying: Number(lyingEyeY(scene.posture).toFixed(2)),
          viewer: scene.posture.viewer
        }
      ])
    );
    expect(eyes).toEqual({
      washroom: { standing: 1.7, lying: 0.66, viewer: 'standing' },
      shore: { standing: 1.7, lying: 0.08, viewer: 'supine' },
      ward: { standing: 1.7, lying: 0.71, viewer: 'supine' },
      prep: { standing: 1.7, lying: 0.66, viewer: 'supine' }
    });
  });

  it('ships the operator-selectable scenes in wire order', () => {
    // The catalogue's order is the state frame's 4-bit index: append only.
    expect(SCENES.map((scene) => scene.id)).toEqual([
      'washroom',
      'shore',
      'ward',
      'prep'
    ]);

    // A session opens in the neutral preparation room, not in a real scene.
    expect(SCENE.id).toBe('prep');
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

  it('gives the preparation room a shell the mirror can cut away', () => {
    // The mirror hides `-walls` meshes when its camera leaves the room. An
    // unnamed shell turns the operator's overview into a closed grey box.
    const { handle } = build('prep');
    try {
      const walls: THREE.Mesh[] = [];
      handle.root.traverse((node) => {
        const mesh = node as THREE.Mesh;
        if (mesh.isMesh && /-walls$/.test(mesh.name)) {
          walls.push(mesh);
        }
      });
      expect(walls).toHaveLength(4);
      expect(handle.root.getObjectByName('prep-floor')).toBeDefined();
      expect(handle.root.getObjectByName('prep-light')).toBeDefined();
    } finally {
      handle.dispose();
    }
  });

  it('keeps the water bed to the two scenes that have water', () => {
    // The ward declares rain, not water; it is a room with a window, not a
    // body in a lake. The ambience rule below is about the open-water scenes.
    const water = SCENES.filter(
      (scene) => scene.audio !== undefined && scene.audio.track !== 'rain'
    );
    expect(water.map((scene) => scene.id).sort()).toEqual(['shore', 'washroom']);
    for (const scene of water) {
      expect(['lake', 'stream']).toContain(scene.audio!.track);
      const width = scene.audio!.width ?? 0;
      expect(width).toBeGreaterThan(0);
      expect(width).toBeLessThanOrEqual(1);
    }
  });
});

describe('scene capabilities', () => {
  it('declares eye heights sane for the headset', () => {
    for (const scene of SCENES) {
      const lying = lyingEyeY(scene.posture);
      // Lying on water is the lowest (0.08); the art is never drawn from below
      // 1.2 m or above 2 m, or the room would read as a miniature or a hall.
      expect(lying).toBeGreaterThanOrEqual(0.05);
      expect(lying).toBeLessThan(1.2);
      expect(scene.posture.standingEyeY).toBeGreaterThanOrEqual(1.2);
      expect(scene.posture.standingEyeY).toBeLessThanOrEqual(2.0);
      expect(lying).toBeLessThan(scene.posture.standingEyeY);
    }
  });

  it('leaves every remaining scene at the global maximum', () => {
    // `comfortLevel` stays on the contract for a scene that earns a lower cap;
    // none of the shipped scenes now does, and the catalogue must say so.
    const ceilings = Object.fromEntries(SCENES.map((scene) => [scene.id, scene.comfortLevel ?? 3]));
    expect(ceilings).toEqual({ washroom: 3, shore: 3, ward: 3, prep: 3 });
  });

  it('hands each motion channel to the scene that needs it', () => {
    const washroom = build('washroom').handle;
    const shore = build('shore').handle;
    try {
      // The room is static: no per-frame work beyond the patient's own motion.
      expect(washroom.applyBuoyancy).toBeUndefined();
      expect(washroom.setMotion).toBeUndefined();
      // The lake carries the buoyancy itself so the horizon stays level.
      expect(typeof shore.applyBuoyancy).toBe('function');
      expect(shore.setMotion).toBeUndefined();
    } finally {
      washroom.dispose();
      shore.dispose();
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
    for (const scene of SCENES) {
      const { handle } = build(scene.id);
      try {
        // Selection in a scene would be a second interaction model; the only
        // gaze targets in the app belong to the SUS panel.
        expect(handle.root.getObjectByProperty('isCamera', true)).toBeUndefined();
      } finally {
        handle.dispose();
      }
    }
  });
});

describe('the ward', () => {
  it('draws the room from the pillow', () => {
    const scene = getSceneDefinition('ward')!;
    // Derived, not typed: 0.55 m mattress + 0.11 m of head + 0.05 m pillow.
    const eye = lyingEyeY(scene.posture);
    expect(eye).toBeCloseTo(0.71, 5);
    expect(scene.audio).toEqual({ track: 'rain', volume: 0.4, fadeMs: 1200, loop: true });

    const { handle } = build('ward');
    try {
      const duvet = handle.root.getObjectByName('ward-duvet') as THREE.Mesh;
      const shell = handle.root.getObjectByName('ward-shell') as THREE.Mesh;
      expect(duvet).toBeDefined();
      expect(shell).toBeDefined();

      // The duvet is bedding, not a wall: its body sits on the mattress inside
      // a 0.3 m band above it, and its sides hang over the frame — so the
      // lowest point may go below the mattress, but never to the floor.
      const bedding = new THREE.Box3().setFromObject(duvet);
      expect(bedding.min.y).toBeGreaterThan(MATTRESS_TOP_M - 0.35);
      expect(bedding.max.y).toBeGreaterThan(MATTRESS_TOP_M + 0.02);
      expect(bedding.max.y).toBeLessThan(MATTRESS_TOP_M + 0.3);
      // The ceiling clears even the standing eye, or the room would read as a box.
      const room = new THREE.Box3().setFromObject(shell);
      expect(room.max.y).toBeGreaterThan(scene.posture.standingEyeY + 0.8);

      // The monitor stands ahead of the pillow — the content origin is the eye's
      // own X/Z — and to the right, with its face turned back. A screen behind
      // the eye would be one nobody can read.
      const screen = handle.root.getObjectByName('ward-monitor-screen') as THREE.Mesh;
      const face = new THREE.Box3().setFromObject(screen);
      expect(face.min.x).toBeGreaterThan(0);
      expect(face.max.z).toBeLessThan(-0.8);
      expect(face.min.y).toBeGreaterThan(eye);
    } finally {
      handle.dispose();
    }
  });

  it('scrolls the trace one way, inside one tile', () => {
    // Headless hosts have no canvas, so the offset is exercised directly.
    let offset = 0.5;
    const step = advanceEcgOffset(offset, 0.1);
    expect(step).toBeLessThan(offset);
    expect(offset - step).toBeCloseTo(0.009, 6);
    // A step off zero wraps to the far end of the tile rather than going negative.
    expect(advanceEcgOffset(0, 0.1)).toBeGreaterThan(0.98);
    // The scene clamps its own frame length: a stall must not teleport the trace.
    expect(advanceEcgOffset(offset, 5)).toBeCloseTo(step, 12);
    expect(advanceEcgOffset(offset, 0)).toBe(offset);
    expect(advanceEcgOffset(offset, Number.NaN)).toBe(offset);

    for (let i = 0; i < 2000; i += 1) {
      const next = advanceEcgOffset(offset, 1 / 60);
      expect(next).toBeGreaterThanOrEqual(0);
      expect(next).toBeLessThan(1);
      const drop = offset - next;
      if (drop < 0) {
        // The only discontinuity is the wrap, and it lands one step before 1.
        expect(drop).toBeLessThan(-0.9);
      } else {
        // One direction only, at a constant rate.
        expect(drop).toBeCloseTo(0.0015, 6);
      }
      offset = next;
    }
  });

  it('advances the waveform without rebuilding anything', () => {
    const { handle } = build('ward');
    try {
      const ecg = handle.root.getObjectByName('ward-ecg') as THREE.Mesh;
      expect(ecg).toBeDefined();
      const geometry = ecg.geometry;

      let previous = ecg.userData.scroll as number;
      expect(previous).toBe(0);
      for (let i = 0; i < 240; i += 1) {
        handle.update(1 / 60, i / 60);
        const next = ecg.userData.scroll as number;
        expect(next).toBeGreaterThanOrEqual(0);
        expect(next).toBeLessThan(1);
        expect(next).not.toBe(previous);
        previous = next;
      }
      // Animation is a texture offset: the strip's own buffers never change.
      expect(ecg.geometry).toBe(geometry);
    } finally {
      handle.dispose();
    }
  });

  it('stays inside the room budget with one transparent surface', () => {
    const { handle } = build('ward');
    try {
      const stats = measureObject(handle.root);
      expect(stats.drawCalls).toBeLessThanOrEqual(10);
      expect(stats.triangles).toBeLessThanOrEqual(3000);
      // Only the ECG strip blends; everything else in the ward is opaque.
      expect(transparentMeshes(handle.root)).toHaveLength(1);
      expect(handle.budget!.check(stats)).toEqual([]);
      // An interior needs no distance fog.
      expect(handle.settings.fog).toBeNull();
    } finally {
      handle.dispose();
    }
  });

  it('disposes idempotently', () => {
    const { handle } = build('ward');
    expect(() => {
      handle.dispose();
      handle.dispose();
    }).not.toThrow();
    expect(handle.root.children).toHaveLength(0);
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

  it('disposes idempotently', () => {
    const { handle } = build('shore');
    expect(() => {
      handle.dispose();
      handle.dispose();
    }).not.toThrow();
    expect(handle.root.children).toHaveLength(0);
  });
});

describe('the shore lake', () => {
  it('keeps the water below the lying eye through the largest heave', () => {
    // Level-3 buoyancy moves the lake 150 mm along the patient's visual up and
    // the swell adds 20 mm; with the art's authored 80 mm the surface crossed
    // the eye and the single-sided plane showed the void.
    const clearance =
      WATER_EYE_M + SHORE_DROP_M - (FLOAT_AMPLITUDE_M + SWELL_M);
    expect(clearance).toBeGreaterThan(0.05);
  });

  it('applies that drop to the built root', () => {
    const { handle } = build('shore');
    expect(handle.root.position.y).toBeCloseTo(-SHORE_DROP_M, 5);
    handle.dispose();
  });
});
