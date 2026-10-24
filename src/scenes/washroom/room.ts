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

/** Wall-hung bowl lip height in metres. */
const LIP_Y = 1.05;

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
 * One continuous section through the ceramic shell: outside lip, tapered
 * body, rounded sump, and the inside basin returning to the rolled rim.
 * Radii and depth are in metres; the opening faces up and slightly forward.
 */
const BOWL_PROFILE: readonly (readonly [number, number])[] = [
  [0.176, 0.000],
  [0.182, 0.006],
  [0.183, 0.013],
  [0.179, 0.019],
  [0.171, 0.018],
  [0.166, 0.010],
  [0.164, -0.012],
  [0.158, -0.046],
  [0.144, -0.092],
  [0.124, -0.145],
  [0.100, -0.196],
  [0.075, -0.238],
  [0.052, -0.265],
  [0.035, -0.276],
  [0.026, -0.273],
  [0.028, -0.263],
  [0.043, -0.247],
  [0.066, -0.222],
  [0.091, -0.186],
  [0.115, -0.145],
  [0.136, -0.101],
  [0.151, -0.058],
  [0.161, -0.023],
  [0.166, -0.002],
  [0.176, 0.000]
];

const BOWL_TROUGH_DEPTH = 0.276;

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
  // A restrained porcelain backsplash panel gives the wall a scale cue without
  // adding a draw call or competing with the fixture.
  const panelZ = BACK_Z + 0.003;
  wallBuilder.quad(
    [-0.52, 0.24, panelZ],
    [0.52, 0.24, panelZ],
    [0.52, 1.82, panelZ],
    [-0.52, 1.82, panelZ],
    0.97,
    WALL_UV
  );
  for (const y of [0.68, 1.42]) {
    wallBuilder.quad(
      [-0.48, y, panelZ + 0.001],
      [0.48, y, panelZ + 0.001],
      [0.48, y + 0.003, panelZ + 0.001],
      [-0.48, y + 0.003, panelZ + 0.001],
      0.78
    );
  }
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

  // ── Ceramic: a full, wall-mounted bowl with a rolled oval mouth ─────────
  const ceramic = new MeshBuilder();

  // The opening faces up and forward; the rear of the bowl sits into the wall.
  const bowlTilt = 0.52;
  const bowlDepth = 0.34;
  const bowlScaleY = bowlDepth / BOWL_TROUGH_DEPTH;
  const mouth = new THREE.Vector3(0, LIP_Y, BACK_Z + 0.25);
  const bowlTints = [
    0.91, 0.94, 0.97, 0.99, 0.98, 0.96, 0.94, 0.92, 0.90,
    0.88, 0.85, 0.82, 0.78, 0.75, 0.73, 0.74, 0.77, 0.81,
    0.85, 0.89, 0.92, 0.95, 0.97, 0.97, 0.94
  ];
  const bowlShell = new MeshBuilder();
  bowlShell.revolve(BOWL_PROFILE, 32, {
    arc: Math.PI * 2,
    start: 0,
    tint: (index) => bowlTints[index] ?? 0.94,
    uvScale: 1.4
  });
  const bowlGeometry = bowlShell.build();
  bowlGeometry.scale(1, bowlScaleY, 1.18);
  bowlGeometry.rotateX(bowlTilt);
  bowlGeometry.translate(mouth.x, mouth.y, mouth.z);
  ceramic.merge(bowlGeometry);
  bowlGeometry.dispose();

  const ceramicMesh = new THREE.Mesh(ceramic.build(), ceramicMaterial);
  ceramicMesh.name = 'washroom-urinal';
  root.add(ceramicMesh);
  disposables.push(ceramicMesh.geometry);

  // ── Metal: one discreet flush button and a small floor drain ────────────
  const metal = new MeshBuilder();
  metal.box(0, 1.44, BACK_Z + 0.014, 0.12, 0.075, 0.014, 0.88);
  metal.disc(0, 1.44, BACK_Z + 0.026, 0.011, 16, 'front', 0.72);
  const drainZ = BACK_Z + 0.34;
  for (let i = 0; i < 3; i += 1) {
    const offset = -0.03 + i * 0.03;
    metal.box(offset, 0.003, drainZ, 0.007, 0.004, 0.10, 0.72);
  }
  metal.box(0, 0.003, drainZ - 0.05, 0.10, 0.004, 0.007, 0.68);
  metal.box(0, 0.003, drainZ + 0.05, 0.10, 0.004, 0.007, 0.68);
  const metalMesh = new THREE.Mesh(metal.build(), metalMaterial);
  metalMesh.name = 'washroom-metal';
  root.add(metalMesh);
  disposables.push(metalMesh.geometry);

  const dark = new MeshBuilder();
  dark.box(0, 0.0015, drainZ, 0.10, 0.002, 0.10, 0.35);
  const darkMesh = new THREE.Mesh(dark.build(), darkMaterial);
  darkMesh.name = 'washroom-dark';
  root.add(darkMesh);
  disposables.push(darkMesh.geometry);

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
