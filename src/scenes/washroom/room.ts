import * as THREE from 'three';
import {
  ceramicTexture,
  floorTexture,
  metalTexture,
  oakTexture,
  wallTexture
} from './textures';

/**
 * One calm standing washroom, built to real dimensions around a single
 * wall-hung urinal.
 *
 * The viewer stands at the origin facing -Z: the wall is 0.85 m ahead, the
 * bowl lip is at 1.00 m and projects 0.30 m. That is the geometry a 1.7 m man
 * actually stands in front of.
 *
 * Everything is vertices, written here: no imported mesh, no primitive that a
 * revolve could not produce. The scene is merged down to one draw per material
 * (ceramic, metal, dark, oak, walls, floor, ceiling, light) so the detail below
 * costs triangles, not draw calls.
 *
 * Palette: pale sage micro-cement, warm stone, white ceramic, brushed steel,
 * light oak.
 */

const ROOM_WIDTH = 2.4;
const ROOM_DEPTH = 2.4;
const ROOM_HEIGHT = 2.55;
const BACK_Z = -0.85;
const FRONT_Z = BACK_Z + ROOM_DEPTH;

const WALL_UV = 0.5;
const FLOOR_UV = 0.5;

type Vec3 = [number, number, number];

/** Wall reveal: basin rim height, lip projection, and the bowl axis tilt. */
const LIP_Y = 1.0;
const LIP_R = 0.105;

/**
 * A geometry accumulator.
 *
 * Every helper writes positions, normals, uvs, vertex tints and indices into
 * the same arrays, so a whole material can be one mesh. Tints are the only
 * shading trick used (no shadows, no AO pass): they darken a vertex where two
 * convex pieces meet.
 */
class MeshBuilder {
  private readonly positions: number[] = [];
  private readonly normals: number[] = [];
  private readonly uvs: number[] = [];
  private readonly colors: number[] = [];
  private readonly indices: number[] = [];

  /** One quad from four corners, wound counter-clockwise seen from outside. */
  quad(a: Vec3, b: Vec3, c: Vec3, d: Vec3, tint = 1, uvScale = 1): void {
    const base = this.positions.length / 3;
    const corners = [a, b, c, d];
    const width = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) * uvScale;
    const height = Math.hypot(d[0] - a[0], d[1] - a[1], d[2] - a[2]) * uvScale;
    const cornerUvs: [number, number][] = [[0, 0], [width, 0], [width, height], [0, height]];
    const e1 = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const e2 = new THREE.Vector3(d[0] - a[0], d[1] - a[1], d[2] - a[2]);
    const normal = e1.cross(e2).normalize();
    for (let i = 0; i < 4; i += 1) {
      const corner = corners[i];
      this.positions.push(corner[0], corner[1], corner[2]);
      this.normals.push(normal.x, normal.y, normal.z);
      this.uvs.push(cornerUvs[i][0], cornerUvs[i][1]);
      this.colors.push(tint, tint, tint);
    }
    this.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  /**
   * Axis-aligned box from its centre and size. Six quads, no shared vertices:
   * a box has hard edges, and welding them would round the corners.
   */
  box(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, tint = 1): void {
    this.quad(
      [cx - sx / 2, cy - sy / 2, cz + sz / 2],
      [cx + sx / 2, cy - sy / 2, cz + sz / 2],
      [cx + sx / 2, cy + sy / 2, cz + sz / 2],
      [cx - sx / 2, cy + sy / 2, cz + sz / 2],
      tint
    );
    this.quad(
      [cx + sx / 2, cy - sy / 2, cz - sz / 2],
      [cx - sx / 2, cy - sy / 2, cz - sz / 2],
      [cx - sx / 2, cy + sy / 2, cz - sz / 2],
      [cx + sx / 2, cy + sy / 2, cz - sz / 2],
      tint
    );
    this.quad(
      [cx - sx / 2, cy + sy / 2, cz + sz / 2],
      [cx + sx / 2, cy + sy / 2, cz + sz / 2],
      [cx + sx / 2, cy + sy / 2, cz - sz / 2],
      [cx - sx / 2, cy + sy / 2, cz - sz / 2],
      tint
    );
    this.quad(
      [cx - sx / 2, cy - sy / 2, cz - sz / 2],
      [cx + sx / 2, cy - sy / 2, cz - sz / 2],
      [cx + sx / 2, cy - sy / 2, cz + sz / 2],
      [cx - sx / 2, cy - sy / 2, cz + sz / 2],
      tint
    );
    this.quad(
      [cx - sx / 2, cy - sy / 2, cz - sz / 2],
      [cx - sx / 2, cy - sy / 2, cz + sz / 2],
      [cx - sx / 2, cy + sy / 2, cz + sz / 2],
      [cx - sx / 2, cy + sy / 2, cz - sz / 2],
      tint
    );
    this.quad(
      [cx + sx / 2, cy - sy / 2, cz + sz / 2],
      [cx + sx / 2, cy - sy / 2, cz - sz / 2],
      [cx + sx / 2, cy + sy / 2, cz - sz / 2],
      [cx + sx / 2, cy + sy / 2, cz + sz / 2],
      tint
    );
  }

  /**
   * Surface of revolution around +Y from a 2-D profile `[radius, height]`.
   *
   * The profile is walked mouth-to-throat, so the shell's outside faces away
   * from the axis. Normals come from the profile tangent (rotated), which is
   * what makes the rolled lip read as a curve rather than a chamfer.
   *
   * `arc` limits the sweep: the back half of a wall-hung bowl is inside the
   * wall, so only the front half is emitted.
   */
  revolve(
    profile: readonly (readonly [number, number])[],
    segments: number,
    options: {
      arc?: number;
      /** Where the sweep starts; the default centres it on +X. */
      start?: number;
      tint?: (index: number) => number;
      uvScale?: number;
      /** Close the flat back where the arc stops, if the sweep is partial. */
      cap?: boolean;
    } = {}
  ): void {
    const arc = options.arc ?? Math.PI * 2;
    const startAngle = options.start ?? -arc / 2;
    const closed = Math.abs(arc - Math.PI * 2) < 1e-6;
    const tintFor = options.tint ?? (() => 1);
    const uvScale = options.uvScale ?? 1;
    const rings = profile.length;
    const cols = closed ? segments : segments + 1;

    // Profile normals in the (radius, height) plane, averaged per point.
    const profileNormals: [number, number][] = profile.map((_point, i) => {
      const prev = profile[Math.max(0, i - 1)];
      const next = profile[Math.min(rings - 1, i + 1)];
      const dr = next[0] - prev[0];
      const dy = next[1] - prev[1];
      const length = Math.hypot(dr, dy) || 1;
      return [dy / length, -dr / length];
    });

    const base = this.positions.length / 3;
    for (let c = 0; c < cols; c += 1) {
      const angle = startAngle + (c / segments) * arc;
      const sin = Math.sin(angle);
      const cos = Math.cos(angle);
      for (let r = 0; r < rings; r += 1) {
        const [radius, height] = profile[r];
        const normal = profileNormals[r];
        this.positions.push(cos * radius, height, sin * radius);
        this.normals.push(cos * normal[0], normal[1], sin * normal[0]);
        this.uvs.push((c / segments) * uvScale, height * uvScale);
        const tint = tintFor(r);
        this.colors.push(tint, tint, tint);
      }
    }
    for (let c = 0; c < segments; c += 1) {
      const nextCol = closed ? (c + 1) % cols : c + 1;
      for (let r = 0; r < rings - 1; r += 1) {
        const a = base + c * rings + r;
        const b = base + nextCol * rings + r;
        this.indices.push(a, a + 1, b, b, a + 1, b + 1);
      }
    }

    if (options.cap && !closed) {
      // Flat back: a fan from the axis out to the first and last profile point.
      const first = profile[0];
      const last = profile[rings - 1];
      const left = startAngle;
      const right = startAngle + arc;
      const lx = Math.cos(left);
      const lz = Math.sin(left);
      const rx = Math.cos(right);
      const rz = Math.sin(right);
      const capBase = this.positions.length / 3;
      const corners: Vec3[] = [
        [lx * first[0], first[1], lz * first[0]],
        [rx * first[0], first[1], rz * first[0]],
        [rx * last[0], last[1], rz * last[0]],
        [lx * last[0], last[1], lz * last[0]]
      ];
      const normal = new THREE.Vector3(lz - rz, 0, rx - lx).normalize();
      for (const corner of corners) {
        this.positions.push(corner[0], corner[1], corner[2]);
        this.normals.push(normal.x, normal.y, normal.z);
        this.uvs.push(0, 0);
        this.colors.push(0.86, 0.86, 0.86);
      }
      this.indices.push(capBase, capBase + 1, capBase + 2, capBase, capBase + 2, capBase + 3);
    }
  }

  /** Flat disc facing `normal` (only ±Y and ±Z are used here). */
  disc(
    cx: number,
    cy: number,
    cz: number,
    radius: number,
    segments: number,
    facing: 'up' | 'down' | 'front',
    tint = 1
  ): void {
    const base = this.positions.length / 3;
    const normal: Vec3 =
      facing === 'up' ? [0, 1, 0] : facing === 'down' ? [0, -1, 0] : [0, 0, 1];
    this.positions.push(cx, cy, cz);
    this.normals.push(normal[0], normal[1], normal[2]);
    this.uvs.push(0, 0);
    this.colors.push(tint, tint, tint);
    for (let i = 0; i <= segments; i += 1) {
      const angle = (i / segments) * Math.PI * 2;
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      const px = facing === 'up' || facing === 'down' ? cx + x : cx + x;
      const py = facing === 'up' || facing === 'down' ? cy : cy + z;
      const pz = facing === 'up' || facing === 'down' ? cz + z : cz;
      this.positions.push(px, py, pz);
      this.normals.push(normal[0], normal[1], normal[2]);
      this.uvs.push(x / (radius * 2) + 0.5, pz / (radius * 2) + 0.5);
      this.colors.push(tint, tint, tint);
    }
    for (let i = 0; i < segments; i += 1) {
      this.indices.push(base, base + 1 + i, base + 2 + i);
    }
  }

  /** Append another geometry's attributes, keeping one draw per material. */
  merge(geometry: THREE.BufferGeometry): void {
    const position = geometry.getAttribute('position') as THREE.BufferAttribute;
    const normal = geometry.getAttribute('normal') as THREE.BufferAttribute | undefined;
    const uv = geometry.getAttribute('uv') as THREE.BufferAttribute | undefined;
    const color = geometry.getAttribute('color') as THREE.BufferAttribute | undefined;
    const base = this.positions.length / 3;
    for (let i = 0; i < position.count; i += 1) {
      this.positions.push(position.getX(i), position.getY(i), position.getZ(i));
      this.normals.push(
        normal ? normal.getX(i) : 0,
        normal ? normal.getY(i) : 1,
        normal ? normal.getZ(i) : 0
      );
      this.uvs.push(uv ? uv.getX(i) : 0, uv ? uv.getY(i) : 0);
      this.colors.push(
        color ? color.getX(i) : 1,
        color ? color.getY(i) : 1,
        color ? color.getZ(i) : 1
      );
    }
    const index = geometry.getIndex();
    if (index) {
      for (let i = 0; i < index.count; i += 1) {
        this.indices.push(base + index.getX(i));
      }
    } else {
      for (let i = 0; i < position.count; i += 1) {
        this.indices.push(base + i);
      }
    }
  }

  build(): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(this.normals, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(this.uvs, 2));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(this.colors, 3));
    geometry.setIndex(this.indices);
    return geometry;
  }

  get triangleCount(): number {
    return this.indices.length / 3;
  }
}

/**
 * The bowl profile, mouth first.
 *
 * `[radius, height]` in bowl-local metres: the rolled lip, then the throat
 * narrowing to a 25 mm drain. Heights are negative because the bowl runs down
 * away from its mouth.
 */
const BOWL_PROFILE: readonly (readonly [number, number])[] = [
  [0.104, 0.0],
  [0.1055, 0.006],
  [0.1045, 0.014],
  [0.0995, 0.015],
  [0.0975, 0.010],
  [0.094, -0.02],
  [0.086, -0.06],
  [0.072, -0.105],
  [0.055, -0.145],
  [0.038, -0.175],
  [0.026, -0.19],
  [0.0, -0.192]
];

export interface RoomLayer {
  root: THREE.Group;
  dispose(): void;
}

export function createRoom(): RoomLayer {
  const root = new THREE.Group();
  root.name = 'washroom';
  const disposables: { dispose(): void }[] = [];

  const wallMap = wallTexture();
  const floorMap = floorTexture();
  const ceramicMap = ceramicTexture();
  const oakMap = oakTexture();
  const metalMap = metalTexture();
  for (const map of [wallMap, floorMap, ceramicMap, oakMap, metalMap]) {
    if (map) disposables.push(map);
  }

  const wallMaterial = new THREE.MeshLambertMaterial({
    ...(wallMap ? { map: wallMap } : {}),
    color: wallMap ? 0xffffff : 0xdcdad0,
    vertexColors: true,
    side: THREE.DoubleSide
  });
  const floorMaterial = new THREE.MeshLambertMaterial({
    ...(floorMap ? { map: floorMap } : {}),
    color: floorMap ? 0xdcd6c9 : 0xbdb6a8,
    vertexColors: true
  });
  const ceilingMaterial = new THREE.MeshLambertMaterial({ color: 0xf2efe8 });
  const ceramicMaterial = new THREE.MeshLambertMaterial({
    ...(ceramicMap ? { map: ceramicMap } : {}),
    color: ceramicMap ? 0xffffff : 0xf6f4ef,
    vertexColors: true,
    side: THREE.DoubleSide
  });
  const oakMaterial = new THREE.MeshLambertMaterial({
    ...(oakMap ? { map: oakMap } : {}),
    color: oakMap ? 0xffffff : 0xc2a176,
    vertexColors: true,
    side: THREE.DoubleSide
  });
  const metalMaterial = new THREE.MeshLambertMaterial({
    ...(metalMap ? { map: metalMap } : {}),
    color: metalMap ? 0xffffff : 0xb7bcc0,
    vertexColors: true,
    emissive: 0x0e1012
  });
  const darkMaterial = new THREE.MeshBasicMaterial({ color: 0x4b514c, vertexColors: true });
  disposables.push(
    wallMaterial,
    floorMaterial,
    ceilingMaterial,
    ceramicMaterial,
    oakMaterial,
    metalMaterial,
    darkMaterial
  );

  // ── Walls, skirting and the door reveal ─────────────────────────────────
  const wallBuilder = new MeshBuilder();
  wallBuilder.quad(
    [-ROOM_WIDTH / 2, 0, BACK_Z],
    [ROOM_WIDTH / 2, 0, BACK_Z],
    [ROOM_WIDTH / 2, ROOM_HEIGHT, BACK_Z],
    [-ROOM_WIDTH / 2, ROOM_HEIGHT, BACK_Z],
    0.92,
    WALL_UV
  );
  wallBuilder.quad(
    [-ROOM_WIDTH / 2, 0, FRONT_Z],
    [-ROOM_WIDTH / 2, 0, BACK_Z],
    [-ROOM_WIDTH / 2, ROOM_HEIGHT, BACK_Z],
    [-ROOM_WIDTH / 2, ROOM_HEIGHT, FRONT_Z],
    0.9,
    WALL_UV
  );
  wallBuilder.quad(
    [ROOM_WIDTH / 2, 0, FRONT_Z],
    [-ROOM_WIDTH / 2, 0, FRONT_Z],
    [-ROOM_WIDTH / 2, ROOM_HEIGHT, FRONT_Z],
    [ROOM_WIDTH / 2, ROOM_HEIGHT, FRONT_Z],
    0.88,
    WALL_UV
  );
  // Skirting: 60 mm tall, 12 mm proud, darker at its own top edge.
  const skirt = 0.06;
  const proud = 0.012;
  wallBuilder.quad(
    [-ROOM_WIDTH / 2, 0, BACK_Z + proud],
    [ROOM_WIDTH / 2, 0, BACK_Z + proud],
    [ROOM_WIDTH / 2, skirt, BACK_Z + proud],
    [-ROOM_WIDTH / 2, skirt, BACK_Z + proud],
    0.74
  );
  wallBuilder.quad(
    [-ROOM_WIDTH / 2, skirt, BACK_Z + proud],
    [ROOM_WIDTH / 2, skirt, BACK_Z + proud],
    [ROOM_WIDTH / 2, skirt, BACK_Z],
    [-ROOM_WIDTH / 2, skirt, BACK_Z],
    0.66
  );
  wallBuilder.quad(
    [-ROOM_WIDTH / 2, 0, BACK_Z],
    [-ROOM_WIDTH / 2, 0, BACK_Z + proud],
    [-ROOM_WIDTH / 2, skirt, BACK_Z + proud],
    [-ROOM_WIDTH / 2, skirt, BACK_Z],
    0.7
  );
  wallBuilder.quad(
    [ROOM_WIDTH / 2, 0, BACK_Z + proud],
    [ROOM_WIDTH / 2, 0, BACK_Z],
    [ROOM_WIDTH / 2, skirt, BACK_Z],
    [ROOM_WIDTH / 2, skirt, BACK_Z + proud],
    0.7
  );
  const walls = new THREE.Mesh(wallBuilder.build(), wallMaterial);
  walls.name = 'washroom-walls';
  root.add(walls);
  disposables.push(walls.geometry);

  const floorBuilder = new MeshBuilder();
  floorBuilder.quad(
    [-ROOM_WIDTH / 2, 0, FRONT_Z],
    [ROOM_WIDTH / 2, 0, FRONT_Z],
    [ROOM_WIDTH / 2, 0, BACK_Z],
    [-ROOM_WIDTH / 2, 0, BACK_Z],
    0.96,
    FLOOR_UV
  );
  const floor = new THREE.Mesh(floorBuilder.build(), floorMaterial);
  floor.name = 'washroom-floor';
  root.add(floor);
  disposables.push(floor.geometry);

  const ceiling = new THREE.Mesh(
    (() => {
      const geometry = new THREE.PlaneGeometry(ROOM_WIDTH, ROOM_DEPTH);
      geometry.rotateX(Math.PI / 2);
      return geometry;
    })(),
    ceilingMaterial
  );
  ceiling.name = 'washroom-ceiling';
  ceiling.position.set(0, ROOM_HEIGHT, BACK_Z + ROOM_DEPTH / 2);
  root.add(ceiling);
  disposables.push(ceiling.geometry);

  // ── Oak: privacy screen, its post, and the door reveal behind the viewer ─
  const oakBuilder = new MeshBuilder();
  oakBuilder.box(0.98, 1.025, BACK_Z + 0.31, 0.028, 2.05, 0.62);
  oakBuilder.box(0.98, 0.02, BACK_Z + 0.03, 0.05, 0.04, 0.06);
  oakBuilder.box(0.98, 2.04, BACK_Z + 0.03, 0.05, 0.04, 0.06);
  // Door reveal on the wall behind the patient: jambs and head, 0.9 × 2.1.
  for (const [x, y, sy] of [
    [-0.45, 1.05, 2.1],
    [0.45, 1.05, 2.1]
  ] as const) {
    oakBuilder.box(x, y, FRONT_Z - 0.02, 0.05, sy, 0.04, 0.92);
  }
  oakBuilder.box(0, 2.1, FRONT_Z - 0.02, 0.95, 0.05, 0.04, 0.92);
  const oak = new THREE.Mesh(oakBuilder.build(), oakMaterial);
  oak.name = 'washroom-oak';
  root.add(oak);
  disposables.push(oak.geometry);

  // ── Ceramic: back plate + revolved bowl with a rolled lip ───────────────
  const ceramic = new MeshBuilder();

  // Ceramic shroud: the fixture's body on the wall, a curved slab rather than a
  // card. A flat card read as a poster taped to the wall.
  {
    // Built around the local axis first: a revolve is centred on the origin,
    // and a shroud left there sits around the patient's knees.
    const shroudBuilder = new MeshBuilder();
    // Kept shallow: a deep shroud sits in front of the bowl and turns the
    // fixture into a slab with a slot cut in it.
    shroudBuilder.revolve(
      [
        [0.112, 0.60],
        [0.128, 0.64],
        [0.128, 1.01],
        [0.112, 1.05]
      ],
      18,
      { arc: 1.5, start: Math.PI / 2 - 0.75, tint: () => 0.93, uvScale: 1.6 }
    );
    const shroud = shroudBuilder.build();
    shroud.translate(0, 0, BACK_Z + 0.02);
    ceramic.merge(shroud);
    shroud.dispose();
  }

  // Bowl: the mouth sits at the lip height and faces up-and-out; the throat
  // runs down and back into the wall. The emitted half is the front one, so the
  // missing half is the part already inside the wall.
  const bowlTilt = 0.62;
  const bowlDepth = 0.30;
  const profileDepth = Math.abs(BOWL_PROFILE[BOWL_PROFILE.length - 1][1]);
  const bowlScaleY = bowlDepth / profileDepth;
  const mouth = new THREE.Vector3(0, LIP_Y, BACK_Z + 0.30);
  const throatPoint = new THREE.Vector3(
    mouth.x,
    mouth.y - Math.cos(bowlTilt) * bowlDepth,
    mouth.z - Math.sin(bowlTilt) * bowlDepth
  );
  const bowlShell = new MeshBuilder();
  bowlShell.revolve(BOWL_PROFILE, 26, {
    arc: Math.PI,
    start: 0,
    tint: (index) => {
      // Darker into the throat: the only depth cue without shadows.
      const d = 1 - index / (BOWL_PROFILE.length - 1);
      return 0.6 + 0.38 * d;
    },
    uvScale: 1.4
  });
  const bowlGeometry = bowlShell.build();
  bowlGeometry.scale(1, bowlScaleY, 1);
  bowlGeometry.rotateX(bowlTilt);
  bowlGeometry.translate(mouth.x, mouth.y, mouth.z);
  ceramic.merge(bowlGeometry);
  bowlGeometry.dispose();

  const ceramicMesh = new THREE.Mesh(ceramic.build(), ceramicMaterial);
  ceramicMesh.name = 'washroom-urinal';
  root.add(ceramicMesh);
  disposables.push(ceramicMesh.geometry);

  // ── Metal: flush plate, pipe into the bowl, brackets, floor drain ────────
  const metal = new MeshBuilder();
  metal.box(0, 1.42, BACK_Z + 0.007, 0.16, 0.115, 0.014, 0.9);
  // Pipe: flush plate down the wall, then a short spout into the mouth.
  metal.box(0, 1.30, BACK_Z + 0.03, 0.032, 0.22, 0.032, 0.86);
  metal.box(0, 1.19, BACK_Z + 0.06, 0.028, 0.14, 0.028, 0.8);
  // Spout reaches the mouth's back edge: a nozzle that stops short reads as a
  // second, floating fixture.
  metal.box(0, 1.045, BACK_Z + 0.235, 0.045, 0.022, 0.30, 0.78);
  metal.box(0, 1.028, BACK_Z + 0.375, 0.05, 0.03, 0.05, 0.7);
  // Two wall brackets under the bowl.
  for (const x of [-0.11, 0.11]) {
    metal.box(x, 0.66, BACK_Z + 0.05, 0.035, 0.03, 0.11, 0.8);
  }
  // Floor drain: a 150 mm square grate under the bowl.
  const drainZ = BACK_Z + 0.34;
  for (let i = 0; i < 5; i += 1) {
    const offset = -0.06 + i * 0.03;
    metal.box(offset, 0.003, drainZ, 0.012, 0.006, 0.14, 0.55);
  }
  metal.box(0, 0.003, drainZ - 0.07, 0.15, 0.006, 0.012, 0.5);
  metal.box(0, 0.003, drainZ + 0.07, 0.15, 0.006, 0.012, 0.5);
  const metalMesh = new THREE.Mesh(metal.build(), metalMaterial);
  metalMesh.name = 'washroom-metal';
  root.add(metalMesh);
  disposables.push(metalMesh.geometry);

  // ── Dark: the drain throat and the hole behind the grate ────────────────
  const dark = new MeshBuilder();
  dark.box(0, 0.0015, drainZ, 0.15, 0.002, 0.15, 0.35);
  // The bowl's throat: a dark cap so the bowl does not read as a hollow cone
  // with the wall showing through it.
  dark.box(throatPoint.x, throatPoint.y, throatPoint.z, 0.05, 0.03, 0.05, 0.3);
  const throat = new THREE.Mesh(dark.build(), darkMaterial);
  throat.name = 'washroom-dark';
  root.add(throat);
  disposables.push(throat.geometry);

  // Recessed light above the bowl: an emissive-looking plane.
  const lightGeometry = new THREE.PlaneGeometry(0.26, 0.9);
  lightGeometry.rotateX(Math.PI / 2);
  const lightMaterial = new THREE.MeshBasicMaterial({
    color: 0xfff4e4,
    toneMapped: false,
    side: THREE.DoubleSide
  });
  const light = new THREE.Mesh(lightGeometry, lightMaterial);
  light.name = 'washroom-light';
  light.position.set(0, ROOM_HEIGHT - 0.012, BACK_Z + 0.45);
  root.add(light);
  disposables.push(lightGeometry, lightMaterial);

  // Two lights, no shadows: a soft sky/ground mix plus a warm key from above
  // and behind the viewer.
  const hemisphere = new THREE.HemisphereLight(0xfffaf0, 0x8f8879, 0.82);
  const key = new THREE.DirectionalLight(0xfff1dc, 0.42);
  key.position.set(0.6, 2.4, 1.4);
  root.add(hemisphere, key);

  return {
    root,
    dispose(): void {
      root.remove(hemisphere, key);
      for (let i = 0; i < disposables.length; i += 1) {
        disposables[i].dispose();
      }
      root.clear();
      root.removeFromParent();
    }
  };
}
