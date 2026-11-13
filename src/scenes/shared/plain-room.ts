import * as THREE from 'three';
import type { Disposer } from './disposer';

/**
 * A room with nothing in it: four interior walls, a floor, a ceiling and one
 * soft panel of light.
 *
 * The preparation room and the questionnaire's room are the same object with
 * different paint — both are "six surfaces and a light, no props, no textures"
 * — and they were two near-copies of the same forty lines. The one thing worth
 * keeping in a single place is the convention below: **each face is turned
 * towards the eye**, so the room reads as a room from the inside rather than as
 * a box seen from outside. Getting that wrong per-scene is a silent one-plane
 * bug no test would catch.
 *
 * Art stays with the scene: dimensions, colours, roughness and the light rig
 * are arguments, not defaults. The mirror's cutaway hides meshes named
 * `*-walls`, hence `namePrefix`.
 */
export interface PlainRoomSpec {
  readonly width: number;
  readonly depth: number;
  readonly height: number;
  /** The floor's Y in the content frame; the ceiling is `floorY + height`. */
  readonly floorY: number;
  readonly wallColor: number;
  readonly floorColor: number;
  readonly ceilingColor: number;
  /** Roughness for wall / floor / ceiling; 1 when omitted. */
  readonly roughness?: readonly [number, number, number];
  /** Names become `<prefix>-walls`, `-floor`, `-ceiling`; omit for no names. */
  readonly namePrefix?: string;
  /** One soft panel under the ceiling; omit for a bare ceiling. */
  readonly panel?: {
    readonly size: number;
    /** How far below the ceiling it hangs, metres. */
    readonly insetM: number;
    readonly color: number;
    readonly name?: string;
  };
  /** Everything created here is registered so the scene's teardown stays one call. */
  readonly disposer: Disposer;
}

export interface PlainRoom {
  readonly root: THREE.Group;
  /** Y of the ceiling in the content frame, for the caller's own fixtures. */
  readonly ceilingY: number;
}

export function createPlainRoom(spec: PlainRoomSpec): PlainRoom {
  const { width, depth, height, floorY, disposer } = spec;
  const [wallRough = 1, floorRough = 1, ceilingRough = 1] = spec.roughness ?? [];
  const halfW = width / 2;
  const halfD = depth / 2;
  const ceilingY = floorY + height;
  const midY = (floorY + ceilingY) / 2;
  const prefix = spec.namePrefix ?? '';

  const wallMaterial = new THREE.MeshStandardMaterial({
    color: spec.wallColor,
    roughness: wallRough,
    metalness: 0
  });
  const floorMaterial = new THREE.MeshStandardMaterial({
    color: spec.floorColor,
    roughness: floorRough,
    metalness: 0
  });
  const ceilingMaterial = new THREE.MeshStandardMaterial({
    color: spec.ceilingColor,
    roughness: ceilingRough,
    metalness: 0
  });

  const wallGeometry = new THREE.PlaneGeometry(width, height);
  const sideGeometry = new THREE.PlaneGeometry(depth, height);
  const slabGeometry = new THREE.PlaneGeometry(width, depth);
  disposer.add(wallMaterial, floorMaterial, ceilingMaterial, wallGeometry, sideGeometry, slabGeometry);

  const root = new THREE.Group();

  const faces: {
    name: string;
    geometry: THREE.BufferGeometry;
    material: THREE.Material;
    position: [number, number, number];
    rotation: [number, number, number];
  }[] = [
    { name: 'walls', geometry: wallGeometry, material: wallMaterial, position: [0, midY, -halfD], rotation: [0, 0, 0] },
    { name: 'walls', geometry: wallGeometry, material: wallMaterial, position: [0, midY, halfD], rotation: [0, Math.PI, 0] },
    { name: 'walls', geometry: sideGeometry, material: wallMaterial, position: [-halfW, midY, 0], rotation: [0, Math.PI / 2, 0] },
    { name: 'walls', geometry: sideGeometry, material: wallMaterial, position: [halfW, midY, 0], rotation: [0, -Math.PI / 2, 0] },
    { name: 'floor', geometry: slabGeometry, material: floorMaterial, position: [0, floorY, 0], rotation: [-Math.PI / 2, 0, 0] },
    { name: 'ceiling', geometry: slabGeometry, material: ceilingMaterial, position: [0, ceilingY, 0], rotation: [Math.PI / 2, 0, 0] }
  ];
  for (const face of faces) {
    const mesh = new THREE.Mesh(face.geometry, face.material);
    if (prefix) {
      mesh.name = `${prefix}-${face.name}`;
    }
    mesh.position.set(...face.position);
    mesh.rotation.set(...face.rotation);
    root.add(mesh);
  }

  if (spec.panel) {
    const panelMaterial = new THREE.MeshBasicMaterial({ color: spec.panel.color });
    const panelGeometry = new THREE.PlaneGeometry(spec.panel.size, spec.panel.size);
    disposer.add(panelMaterial, panelGeometry);
    const panel = new THREE.Mesh(panelGeometry, panelMaterial);
    if (spec.panel.name) {
      panel.name = spec.panel.name;
    }
    panel.position.set(0, ceilingY - spec.panel.insetM, 0);
    panel.rotation.x = Math.PI / 2;
    root.add(panel);
  }

  return { root, ceilingY };
}
