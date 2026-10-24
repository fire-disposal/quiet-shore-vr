import * as THREE from 'three';
import { Disposer } from '../shared/disposer';
import { ecgTexture, fabricTexture, floorTexture, screenTexture, wallTexture } from './textures';

/**
 * A training ward seen from the bed.
 *
 * The patient is supine, so the art is authored around an eye that is *in* the
 * bed rather than standing in front of it: 0.85 m above the floor — the
 * 0.55 m mattress plus the head raised on the pillow. The frame lowers the
 * content by that number, which puts the eye at the content origin and the floor
 * 0.85 m below it; the room's own ceiling (2.7 m) is then 1.85 m above the
 * pillow, exactly where a real ward ceiling sits.
 *
 * Facing −Z the patient sees, in order of depth: the flat sheet and their own
 * bedding in the lower field, the footboard at 1.6 m, the window with its
 * venetian blind at 3.3 m, and the ceiling with two recessed panels above the
 * bed's middle. The monitor cart stands to the right at 1.4 m with its screen
 * turned back towards the pillow; the bedside cabinet and the IV stand are to
 * the left, in the periphery a glance finds them.
 *
 * Everything is vertices written here: no imported mesh, no shadow map, no
 * post-processing. One mesh per material — walls and ceiling share one, the
 * bed's steel and the cart's dark parts share another — so the detail below
 * costs triangles, not draw calls. Ten draws, five canvas textures, and the
 * single transparent surface is the ECG strip.
 *
 * Palette: pale painted plaster, grey vinyl, off-white laminate, brushed steel,
 * white linen, a blue-grey duvet and sage curtains.
 */

/** Supine eye: mattress 0.55 m + a head raised on the pillow. */
export const EYE_Y = 0.85;
/**
 * Where the eye sits *inside the art*, in bed coordinates: the bed head is at
 * +1.62, so the pillow's front edge is 1.12. `MeshBuilder.build()` subtracts
 * this from every vertex, which is what puts the eye on the content origin —
 * the frame places content by `eyeY` alone, never in X or Z.
 */
export const EYE_Z = 1.12;

const ROOM_W = 3.6;
const ROOM_D = 4.4;
const ROOM_H = 2.7;
const HALF_W = ROOM_W / 2;
/** The wall the patient looks at, with the window. */
const Z_WINDOW = -ROOM_D / 2;
/** The wall behind the pillow. */
const Z_HEAD = ROOM_D / 2;
const MID_Z = (Z_HEAD + Z_WINDOW) / 2;

/** One wall tile is 2 m; a metre of wall is half a tile. */
const WALL_UV = 0.5;
/** The floor texture is 1.2 m across. */
const FLOOR_UV = 1 / 1.2;

const BED_W = 0.98;
const MATT_W = 0.9;
const BED_HEAD = 1.62;
const BED_FOOT = -0.44;
const BED_LEN = BED_HEAD - BED_FOOT;
const BED_CZ = (BED_HEAD + BED_FOOT) / 2;
/** Mattress top: the reference every bedding height below derives from. */
const MATTRESS_TOP = 0.55;

const WIN_LEFT = -0.95;
const WIN_RIGHT = 0.95;
const WIN_SILL = 1.04;
const WIN_HEAD = 2.08;

const MON_X = 0.82;
const MON_Y = 1.18;
const MON_Z = -0.02;
const CAB_X = -0.8;
const CAB_Z = 0.62;
const IV_X = -0.72;
const IV_Z = 0.28;

type Vec3 = [number, number, number];
/** One tint for the quad, or one per corner in a,b,c,d order. */
type QuadTint = number | readonly [number, number, number, number];

/**
 * A geometry accumulator.
 *
 * Positions, normals, uvs, vertex tints and indices go into the same arrays, so
 * a whole material is one mesh. Tints are the only shading trick used (no
 * shadows, no AO pass): they darken a corner where two surfaces meet and carry
 * the daylight falloff from the window.
 */
class MeshBuilder {
  private readonly positions: number[] = [];
  private readonly normals: number[] = [];
  private readonly uvs: number[] = [];
  private readonly colors: number[] = [];
  private readonly indices: number[] = [];

  /** One quad from four corners, wound counter-clockwise seen from the front. */
  quad(a: Vec3, b: Vec3, c: Vec3, d: Vec3, tint: QuadTint = 1, uvScale = 1): void {
    const base = this.positions.length / 3;
    const corners = [a, b, c, d];
    const width = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) * uvScale;
    const height = Math.hypot(d[0] - a[0], d[1] - a[1], d[2] - a[2]) * uvScale;
    const cornerUvs: [number, number][] = [[0, 0], [width, 0], [width, height], [0, height]];
    const edgeA = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const edgeB = new THREE.Vector3(d[0] - a[0], d[1] - a[1], d[2] - a[2]);
    const normal = edgeA.cross(edgeB).normalize();
    for (let i = 0; i < 4; i += 1) {
      const corner = corners[i];
      const value = typeof tint === 'number' ? tint : tint[i];
      this.positions.push(corner[0], corner[1], corner[2]);
      this.normals.push(normal.x, normal.y, normal.z);
      this.uvs.push(cornerUvs[i][0], cornerUvs[i][1]);
      this.colors.push(value, value, value);
    }
    this.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  /**
   * Axis-aligned box from its centre and size. Six quads, no shared vertices:
   * a box has hard edges and welding them would round the corners.
   */
  box(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, tint = 1): void {
    const x0 = cx - sx / 2;
    const x1 = cx + sx / 2;
    const y0 = cy - sy / 2;
    const y1 = cy + sy / 2;
    const z0 = cz - sz / 2;
    const z1 = cz + sz / 2;
    this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], tint);
    this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], tint);
    this.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], tint);
    this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], tint);
    this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], tint);
    this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], tint);
  }

  /**
   * Append another geometry, optionally through a matrix, keeping one draw per
   * material. Used for the monitor head, which is the one part of the room that
   * is not axis-aligned: its screen has to face the pillow.
   */
  merge(geometry: THREE.BufferGeometry, matrix?: THREE.Matrix4, tint = 1): void {
    const position = geometry.getAttribute('position') as THREE.BufferAttribute;
    const normal = geometry.getAttribute('normal') as THREE.BufferAttribute | undefined;
    const uv = geometry.getAttribute('uv') as THREE.BufferAttribute | undefined;
    const color = geometry.getAttribute('color') as THREE.BufferAttribute | undefined;
    const base = this.positions.length / 3;
    const point = new THREE.Vector3();
    const direction = new THREE.Vector3();
    const rotation = matrix ? new THREE.Matrix3().setFromMatrix4(matrix) : null;
    for (let i = 0; i < position.count; i += 1) {
      point.set(position.getX(i), position.getY(i), position.getZ(i));
      if (matrix) {
        point.applyMatrix4(matrix);
      }
      this.positions.push(point.x, point.y, point.z);
      if (normal) {
        direction.set(normal.getX(i), normal.getY(i), normal.getZ(i));
        if (rotation) {
          direction.applyMatrix3(rotation).normalize();
        }
        this.normals.push(direction.x, direction.y, direction.z);
      } else {
        this.normals.push(0, 1, 0);
      }
      this.uvs.push(uv ? uv.getX(i) : 0, uv ? uv.getY(i) : 0);
      this.colors.push(
        (color ? color.getX(i) : 1) * tint,
        (color ? color.getY(i) : 1) * tint,
        (color ? color.getZ(i) : 1) * tint
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
    // The art is written in bed coordinates, where the head wall is at +2.2 and
    // the window at −2.2; the frame only shifts content in Y, so the scene has
    // to bring its own eye onto the content origin. Without this the whole room
    // sits a bed-length in front of the patient.
    geometry.translate(0, 0, -EYE_Z);
    return geometry;
  }
}

export interface RoomLayer {
  root: THREE.Group;
  update(dt: number, elapsed: number): void;
  dispose(): void;
}

/** Texture units per second; the strip holds two complexes. */
const ECG_SCROLL_PER_S = 0.09;
/** A stall must not teleport the trace; the scene clocks its own frames. */
const MAX_STEP_S = 0.1;

/**
 * Advance the ECG strip's texture offset, wrapping inside one tile.
 *
 * The trace scrolls right-to-left so it reads as a strip being written, and it
 * moves slowly on purpose: at 0.09 tiles per second a complex takes ~5.5 s,
 * which is calm enough to notice without becoming something to watch.
 */
export function advanceEcgOffset(offset: number, dt: number): number {
  const step = Number.isFinite(dt) ? Math.min(Math.max(dt, 0), MAX_STEP_S) : 0;
  let next = (offset - step * ECG_SCROLL_PER_S) % 1;
  if (next < 0) {
    next += 1;
  }
  return next;
}

export function createRoom(): RoomLayer {
  const root = new THREE.Group();
  root.name = 'ward';
  const disposer = new Disposer();

  const wallMap = wallTexture();
  const floorMap = floorTexture();
  const fabricMap = fabricTexture();
  const screenMap = screenTexture();
  const ecgMap = ecgTexture();
  disposer.add(wallMap, floorMap, fabricMap, screenMap, ecgMap);

  // Wall and ceiling share one draw: the ceiling is the same painted plaster,
  // a stop darker, and a second material for it would buy one flat tone.
  const shellMaterial = new THREE.MeshLambertMaterial({
    ...(wallMap ? { map: wallMap } : {}),
    color: wallMap ? 0xffffff : 0xdfe3dd,
    vertexColors: true,
    side: THREE.DoubleSide
  });
  const floorMaterial = new THREE.MeshLambertMaterial({
    ...(floorMap ? { map: floorMap } : {}),
    color: floorMap ? 0xffffff : 0xbdbfba,
    vertexColors: true,
    side: THREE.DoubleSide
  });
  const whiteMaterial = new THREE.MeshLambertMaterial({ color: 0xedefe9, vertexColors: true });
  // Steel and every dark part share one material: the tint range does the work
  // and a separate black material would be a second draw for eight cables.
  const steelMaterial = new THREE.MeshLambertMaterial({
    color: 0xc2c8cb,
    vertexColors: true,
    emissive: 0x0a0d0f
  });
  const linenMaterial = new THREE.MeshLambertMaterial({
    ...(fabricMap ? { map: fabricMap } : {}),
    color: fabricMap ? 0xffffff : 0xf1f4f1,
    vertexColors: true
  });
  const duvetMaterial = new THREE.MeshLambertMaterial({
    ...(fabricMap ? { map: fabricMap } : {}),
    color: fabricMap ? 0x7e94a0 : 0x6f9db4,
    vertexColors: true
  });
  const curtainMaterial = new THREE.MeshLambertMaterial({
    ...(fabricMap ? { map: fabricMap } : {}),
    color: fabricMap ? 0xdadecf : 0xd3d8cd,
    vertexColors: true,
    side: THREE.DoubleSide
  });
  // Unlit: these surfaces *are* light (window, ceiling panels, lamp lens).
  const glowMaterial = new THREE.MeshBasicMaterial({
    color: 0xfff4e4,
    vertexColors: true,
    toneMapped: false
  });
  const screenMaterial = new THREE.MeshBasicMaterial({
    ...(screenMap ? { map: screenMap } : {}),
    color: screenMap ? 0xffffff : 0x123a33,
    toneMapped: false
  });
  const ecgMaterial = new THREE.MeshBasicMaterial({
    ...(ecgMap ? { map: ecgMap } : {}),
    color: ecgMap ? 0xffffff : 0x2f7a5f,
    transparent: true,
    opacity: ecgMap ? 1 : 0.4,
    depthWrite: false,
    toneMapped: false
  });
  disposer.add(
    shellMaterial,
    floorMaterial,
    whiteMaterial,
    steelMaterial,
    linenMaterial,
    duvetMaterial,
    curtainMaterial,
    glowMaterial,
    screenMaterial,
    ecgMaterial
  );

  function addMesh(builder: MeshBuilder, material: THREE.Material, name: string): THREE.Mesh {
    const geometry = builder.build();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    root.add(mesh);
    disposer.add(geometry);
    return mesh;
  }

  // ── Shell: four walls and a four-panel ceiling ──────────────────────────
  const shell = new MeshBuilder();
  // The window wall is the brightest surface in the room; the wall behind the
  // pillow keeps the least light, which is what a room with one window does.
  // It is drawn as a 3×3 grid so the daylight has somewhere to land: the cells
  // that touch the opening are the bright ones, the corners are not.
  const windowWallTints: readonly (readonly number[])[] = [
    [0.9, 0.98, 0.9],
    [0.97, 1, 0.97],
    [0.94, 0.99, 0.94]
  ];
  const wallX = [-HALF_W, WIN_LEFT - 0.08, WIN_RIGHT + 0.08, HALF_W];
  const wallY = [0, WIN_SILL - 0.04, WIN_HEAD + 0.04, ROOM_H];
  for (let row = 0; row < 3; row += 1) {
    for (let col = 0; col < 3; col += 1) {
      shell.quad(
        [wallX[col], wallY[row], Z_WINDOW],
        [wallX[col + 1], wallY[row], Z_WINDOW],
        [wallX[col + 1], wallY[row + 1], Z_WINDOW],
        [wallX[col], wallY[row + 1], Z_WINDOW],
        windowWallTints[row][col],
        WALL_UV
      );
    }
  }
  shell.quad(
    [HALF_W, 0, Z_HEAD],
    [-HALF_W, 0, Z_HEAD],
    [-HALF_W, ROOM_H, Z_HEAD],
    [HALF_W, ROOM_H, Z_HEAD],
    0.86,
    WALL_UV
  );
  shell.quad(
    [-HALF_W, 0, Z_HEAD],
    [-HALF_W, 0, Z_WINDOW],
    [-HALF_W, ROOM_H, Z_WINDOW],
    [-HALF_W, ROOM_H, Z_HEAD],
    0.9,
    WALL_UV
  );
  shell.quad(
    [HALF_W, 0, Z_WINDOW],
    [HALF_W, 0, Z_HEAD],
    [HALF_W, ROOM_H, Z_HEAD],
    [HALF_W, ROOM_H, Z_WINDOW],
    0.93,
    WALL_UV
  );
  // Ceiling in four bands: the seams are the only thing a supine patient has to
  // read the room's depth by, and they cost two triangles each.
  const ceilingBands = 4;
  for (let i = 0; i < ceilingBands; i += 1) {
    const z0 = Z_WINDOW + i * (ROOM_D / ceilingBands);
    const z1 = z0 + ROOM_D / ceilingBands;
    shell.quad(
      [-HALF_W, ROOM_H, z1],
      [-HALF_W, ROOM_H, z0],
      [HALF_W, ROOM_H, z0],
      [HALF_W, ROOM_H, z1],
      0.93 - i * 0.02,
      WALL_UV
    );
  }
  addMesh(shell, shellMaterial, 'ward-shell');

  // ── Floor: three bands, brighter towards the window ─────────────────────
  const floor = new MeshBuilder();
  const floorBands: readonly [number, number, number][] = [
    [Z_WINDOW, -1.2, 0.92],
    [-1.2, 0.4, 0.85],
    [0.4, Z_HEAD, 0.79]
  ];
  for (const [z0, z1, tint] of floorBands) {
    floor.quad(
      [-HALF_W, 0, z1],
      [HALF_W, 0, z1],
      [HALF_W, 0, z0],
      [-HALF_W, 0, z0],
      tint,
      FLOOR_UV
    );
  }
  addMesh(floor, floorMaterial, 'ward-floor');

  // ── White laminate: bed carcass, window frame, cabinet, ceiling housings ──
  const white = new MeshBuilder();
  // Skirting, 70 mm, proud of the wall so the join reads in the corner.
  white.box(0, 0.035, Z_WINDOW + 0.012, ROOM_W, 0.07, 0.024, 0.95);
  white.box(0, 0.035, Z_HEAD - 0.012, ROOM_W, 0.07, 0.024, 0.88);
  white.box(-HALF_W + 0.012, 0.035, MID_Z, 0.024, 0.07, ROOM_D, 0.92);
  white.box(HALF_W - 0.012, 0.035, MID_Z, 0.024, 0.07, ROOM_D, 0.92);

  // Window frame: head, jambs, a centre mullion and an interior sill.
  white.box(0, WIN_HEAD + 0.06, Z_WINDOW + 0.055, 2.1, 0.1, 0.11, 0.99);
  white.box(-1.02, (WIN_SILL + WIN_HEAD) / 2, Z_WINDOW + 0.05, 0.1, 1.24, 0.1, 0.98);
  white.box(1.02, (WIN_SILL + WIN_HEAD) / 2, Z_WINDOW + 0.05, 0.1, 1.24, 0.1, 0.98);
  white.box(0, (WIN_SILL + WIN_HEAD) / 2, Z_WINDOW + 0.045, 0.05, 1.12, 0.06, 0.96);
  white.box(0, WIN_SILL - 0.025, Z_WINDOW + 0.08, 2.14, 0.05, 0.17, 1);

  // Bed headboard and footboard: laminate panels with a rounded top rail.
  white.box(0, 0.72, BED_HEAD + 0.045, BED_W, 0.62, 0.06, 0.97);
  white.box(0, 0.64, BED_FOOT - 0.045, BED_W, 0.44, 0.06, 0.96);
  // Bedside cabinet: carcass, top, two drawer faces, handles are steel.
  white.box(CAB_X, 0.36, CAB_Z, 0.46, 0.48, 0.42, 0.97);
  white.box(CAB_X, 0.615, CAB_Z, 0.5, 0.03, 0.46, 1);
  white.box(CAB_X, 0.46, CAB_Z + 0.215, 0.42, 0.15, 0.014, 1);
  white.box(CAB_X, 0.29, CAB_Z + 0.215, 0.42, 0.15, 0.014, 0.97);
  // A cup and a tissue box on the top: two small solids that give the cabinet
  // a scale at arm's length.
  white.box(CAB_X - 0.1, 0.675, CAB_Z - 0.07, 0.06, 0.09, 0.06, 1);
  white.box(CAB_X + 0.09, 0.655, CAB_Z + 0.08, 0.14, 0.05, 0.11, 0.95);

  // The monitor cart's shelf and housing.
  white.box(MON_X, 0.99, MON_Z, 0.34, 0.025, 0.24, 0.97);
  // Ceiling light housings: the glowing face is in the glow batch.
  white.box(0.3, 2.685, -0.95, 0.94, 0.03, 0.34, 0.99);
  white.box(-0.62, 2.685, -2, 0.94, 0.03, 0.34, 0.97);

  // Head wall: the services rail, three outlet plates, a reading lamp.
  white.box(-0.42, 1.42, Z_HEAD - 0.055, 0.08, 0.09, 0.02, 1);
  white.box(0, 1.42, Z_HEAD - 0.055, 0.08, 0.09, 0.02, 1);
  white.box(0.42, 1.42, Z_HEAD - 0.055, 0.08, 0.09, 0.02, 1);
  white.box(0.75, 1.53, Z_HEAD - 0.24, 0.1, 0.05, 0.1, 0.98);

  // Door on the right-hand wall, with a vision panel in the glow batch.
  white.box(HALF_W - 0.03, 1.05, -1.35, 0.04, 2.1, 0.92, 0.95);
  white.box(HALF_W - 0.04, 2.13, -1.35, 0.06, 0.07, 1.02, 0.82);
  white.box(HALF_W - 0.05, 1.05, -1.82, 0.05, 2.1, 0.06, 0.82);
  white.box(HALF_W - 0.05, 1.05, -0.88, 0.05, 2.1, 0.06, 0.82);

  // ── Steel and every dark part ───────────────────────────────────────────
  const steel = new MeshBuilder();
  // Anti-collision handrail along both side walls: the ward's one horizontal
  // line, and the thing that tells a supine patient how wide the room is.
  for (const side of [-1, 1]) {
    steel.box(side * (HALF_W - 0.055), 0.93, MID_Z, 0.05, 0.055, ROOM_D - 0.2, 0.82);
  }
  steel.box(0, 0.94, Z_HEAD - 0.025, 1.3, 0.11, 0.05, 0.72);
  for (const x of [-0.42, 0, 0.42]) {
    steel.box(x, 1.42, Z_HEAD - 0.068, 0.05, 0.05, 0.008, 0.32);
  }
  steel.box(0.75, 1.55, Z_HEAD - 0.12, 0.03, 0.03, 0.24, 0.8);
  steel.box(HALF_W - 0.07, 1.02, -1.62, 0.03, 0.1, 0.1, 0.7);
  // The curtain rod belongs to the steel batch even though it hangs in front of
  // the curtain: moving it here keeps the rod and the rail one draw.
  steel.box(0, 2.3, Z_WINDOW + 0.1, 2.9, 0.028, 0.028, 0.7);

  // Bed frame: casters, legs, side rails, cross rails.
  for (const side of [-1, 1]) {
    for (const end of [BED_HEAD - 0.12, BED_FOOT + 0.12]) {
      steel.box(side * 0.46, 0.275, end, 0.045, 0.33, 0.045, 0.8);
      steel.box(side * 0.46, 0.045, end, 0.05, 0.09, 0.09, 0.3);
    }
    steel.box(side * 0.47, 0.4, BED_CZ, 0.05, 0.09, BED_LEN - 0.06, 0.78);
  }
  steel.box(0, 0.4, BED_HEAD - 0.1, 0.88, 0.09, 0.05, 0.75);
  steel.box(0, 0.4, BED_FOOT + 0.1, 0.88, 0.09, 0.05, 0.75);
  // Head and foot rails.
  steel.box(0, 1.04, BED_HEAD + 0.045, 1.0, 0.05, 0.08, 0.9);
  steel.box(0, 0.87, BED_FOOT - 0.045, 1.0, 0.045, 0.07, 0.88);
  for (const side of [-1, 1]) {
    // An open frame: top bar, lower bar, four uprights. A solid panel this
    // close to the eye reads as a table top.
    steel.box(side * 0.545, 0.895, 0.12, 0.03, 0.03, 0.8, 0.85);
    steel.box(side * 0.545, 0.62, 0.12, 0.025, 0.025, 0.8, 0.72);
    for (const z of [-0.28, 0.0, 0.26, 0.52]) {
      steel.box(side * 0.545, 0.7, z, 0.025, 0.39, 0.025, 0.8);
    }
  }
  // Cabinet handles and legs.
  steel.box(CAB_X, 0.46, CAB_Z + 0.226, 0.12, 0.012, 0.012, 0.72);
  steel.box(CAB_X, 0.29, CAB_Z + 0.226, 0.12, 0.012, 0.012, 0.72);
  for (const dx of [-0.19, 0.19]) {
    for (const dz of [-0.17, 0.17]) {
      steel.box(CAB_X + dx, 0.06, CAB_Z + dz, 0.03, 0.12, 0.03, 0.4);
    }
  }

  // IV stand: crossed base, casters, pole, hook, and a short drip tube.
  steel.box(IV_X, 0.03, IV_Z, 0.44, 0.025, 0.035, 0.7);
  steel.box(IV_X, 0.03, IV_Z, 0.035, 0.025, 0.44, 0.7);
  for (const dx of [-0.21, 0.21]) {
    for (const dz of [-0.21, 0.21]) {
      steel.box(IV_X + dx, 0.045, IV_Z + dz, 0.05, 0.09, 0.05, 0.3);
    }
  }
  steel.box(IV_X, 0.95, IV_Z, 0.028, 1.8, 0.028, 0.82);
  steel.box(IV_X + 0.06, 1.88, IV_Z, 0.16, 0.018, 0.018, 0.85);
  steel.box(IV_X + 0.13, 1.855, IV_Z, 0.014, 0.05, 0.014, 0.8);
  steel.box(IV_X + 0.13, 1.235, IV_Z, 0.008, 0.73, 0.008, 0.3);

  // Monitor cart: plate, casters, column, and the cable down the back.
  steel.box(MON_X, 0.03, MON_Z, 0.36, 0.03, 0.3, 0.5);
  for (const dx of [-0.14, 0.14]) {
    for (const dz of [-0.11, 0.11]) {
      steel.box(MON_X + dx, 0.04, MON_Z + dz, 0.05, 0.08, 0.05, 0.28);
    }
  }
  steel.box(MON_X, 0.52, MON_Z, 0.05, 0.92, 0.05, 0.75);
  steel.box(MON_X + 0.06, 0.8, MON_Z - 0.08, 0.01, 0.4, 0.01, 0.28);

  // ── Monitor head: the one part that is not axis-aligned ─────────────────
  // Built in a local frame facing +Z, then merged through the frame that turns
  // that face towards the pillow, so the screen is square to the eye.
  const frame = new THREE.Object3D();
  frame.position.set(MON_X, MON_Y, MON_Z);
  frame.lookAt(0, EYE_Y, EYE_Z);
  frame.updateMatrix();
  const headMatrix = frame.matrix;
  const partMatrix = new THREE.Matrix4();
  const placed = new THREE.Matrix4();

  function place(localX: number, localY: number, localZ: number): THREE.Matrix4 {
    partMatrix.makeTranslation(localX, localY, localZ);
    return placed.multiplyMatrices(headMatrix, partMatrix);
  }

  function mergeBox(
    builder: MeshBuilder,
    sx: number,
    sy: number,
    sz: number,
    x: number,
    y: number,
    z: number,
    tint: number
  ): void {
    const geometry = new THREE.BoxGeometry(sx, sy, sz);
    builder.merge(geometry, place(x, y, z), tint);
    geometry.dispose();
  }

  mergeBox(white, 0.42, 0.3, 0.075, 0, 0, -0.05, 0.96);
  mergeBox(white, 0.44, 0.32, 0.02, 0, 0, -0.005, 1);
  for (let i = 0; i < 3; i += 1) {
    mergeBox(steel, 0.018, 0.008, 0.006, -0.07 + i * 0.07, -0.145, 0.007, 0.62);
  }

  addMesh(white, whiteMaterial, 'ward-laminate');
  addMesh(steel, steelMaterial, 'ward-steel');

  // ── Linen: mattress, sheet, pillows, folded towel ───────────────────────
  const linen = new MeshBuilder();
  linen.box(0, (0.42 + MATTRESS_TOP) / 2, BED_CZ, MATT_W, MATTRESS_TOP - 0.42, BED_LEN - 0.08, 0.95);
  // The flat sheet: a touch wider than the mattress so the fold reads.
  linen.box(0, MATTRESS_TOP + 0.008, BED_CZ, 0.94, 0.02, 2.02, 1);
  // The sheet turned back over the duvet's edge: the one white surface in the
  // near field, and the line the eye reads the bed by.
  linen.box(0, 0.588, 0.66, 0.96, 0.024, 0.26, 1);
  linen.box(0, 0.576, 0.9, 0.96, 0.018, 0.3, 0.95);
  for (const side of [-1, 1]) {
    linen.box(side * 0.47, 0.5, BED_CZ, 0.02, 0.18, 2, 0.92);
  }
  linen.box(0, 0.5, BED_FOOT - 0.02, 0.94, 0.18, 0.02, 0.94);
  // Two pillows: the one under the head is behind the eye, the other is
  // propped against the headboard.
  linen.box(0, 0.615, 1.3, 0.52, 0.12, 0.34, 1);
  linen.box(0, 0.7, 1.56, 0.56, 0.1, 0.26, 0.93);
  // Folded towel and a tissue tuft on the cabinet.
  linen.box(CAB_X - 0.09, 0.63, CAB_Z - 0.19, 0.2, 0.03, 0.15, 1);
  linen.box(CAB_X + 0.09, 0.685, CAB_Z + 0.08, 0.1, 0.02, 0.07, 1);
  addMesh(linen, linenMaterial, 'ward-linen');

  // ── Duvet: three lengths, so the window's light falls off along the bed ──
  const duvet = new MeshBuilder();
  // The duvet is folded back at the chest — 0.57 m in front of the eye — so the
  // near field is the white sheet and the eye has one hard edge to read the bed
  // by. A duvet drawn all the way to the chin is a featureless plane from 20 cm.
  const duvetSegments: readonly [number, number, number][] = [
    [0.15, 0.57, 0.86],
    [-0.2, 0.15, 0.9],
    [-0.42, -0.2, 0.95]
  ];
  for (const [z0, z1, tint] of duvetSegments) {
    duvet.box(0, 0.63, (z0 + z1) / 2, 1.02, 0.12, z1 - z0, tint);
  }
  // A crowned cross-section, not creases painted on: a body under a duvet lifts
  // the middle and lets the sides fall away. The four-centimetre step between
  // crown and shoulder is what the eye reads as a fold, and it costs no
  // texture and no extra draw.
  duvet.box(0, 0.71, 0.06, 0.4, 0.04, 0.94, 0.95);
  for (const side of [-1, 1]) {
    duvet.box(side * 0.35, 0.7, 0.06, 0.3, 0.02, 0.94, 0.9);
  }
  // The rolled edge where the duvet is turned back.
  duvet.box(0, 0.7, 0.57, 1.04, 0.055, 0.12, 0.84);
  // A folded blanket at the foot, sitting on the crown rather than in it.
  duvet.box(0.08, 0.75, -0.24, 0.6, 0.05, 0.4, 0.94);
  // The duvet hangs over the frame on both sides and over the foot.
  for (const side of [-1, 1]) {
    duvet.box(side * 0.52, 0.55, 0.06, 0.02, 0.26, 1.0, 0.8);
  }
  duvet.box(0, 0.55, -0.43, 1.04, 0.28, 0.02, 0.84);
  addMesh(duvet, duvetMaterial, 'ward-duvet');

  // ── Curtains: two pleated panels either side of the window ──────────────
  const curtain = new MeshBuilder();
  for (const side of [-1, 1]) {
    const x = side * 0.99;
    for (let fold = 0; fold < 4; fold += 1) {
      const z = Z_WINDOW + 0.14 + (fold - 1.5) * 0.05;
      curtain.box(x, 1.53, z, 0.32, 1.5, 0.055, 0.88 + (fold % 2) * 0.05);
    }
    curtain.box(x, 0.82, Z_WINDOW + 0.14, 0.32, 0.06, 0.24, 0.8);
  }
  addMesh(curtain, curtainMaterial, 'ward-curtain');

  // ── Window pane: the venetian blind as banded vertex colour ─────────────
  // A real slat stack would be fourteen boxes for a surface 3.3 m away; drawn
  // as alternating bright gaps and dim slats on one pane it reads the same and
  // costs a fifth of the triangles. The two columns give the daylight a soft
  // falloff towards the jambs.
  const glow = new MeshBuilder();
  const paneZ = Z_WINDOW + 0.02;
  const slats = 14;
  const slatPitch = (WIN_HEAD - WIN_SILL - 0.04) / slats;
  for (let i = 0; i < slats; i += 1) {
    const top = WIN_HEAD - 0.02 - i * slatPitch;
    const gapTop = top;
    const gapBottom = top - slatPitch * 0.54;
    const slatBottom = top - slatPitch * 0.94;
    const height = 0.5 - i * 0.006;
    for (const [x0, x1, edge] of [
      [WIN_LEFT, 0, 0.94],
      [0, WIN_RIGHT, 0.94]
    ] as const) {
      glow.quad(
        [x0, gapBottom, paneZ],
        [x1, gapBottom, paneZ],
        [x1, gapTop, paneZ],
        [x0, gapTop, paneZ],
        [height * edge, height * edge, (height + 0.2) * edge, (height + 0.2) * edge]
      );
      glow.quad(
        [x0, slatBottom, paneZ],
        [x1, slatBottom, paneZ],
        [x1, gapBottom, paneZ],
        [x0, gapBottom, paneZ],
        [height * 0.62 * edge, height * 0.62 * edge, height * 0.78 * edge, height * 0.78 * edge]
      );
    }
  }
  // Recessed ceiling panels: the two the patient can actually see.
  for (const [x, z, tint] of [
    [0.3, -0.95, 1],
    [-0.62, -2, 0.96]
  ] as const) {
    glow.quad(
      [x - 0.44, 2.667, z + 0.15],
      [x - 0.44, 2.667, z - 0.15],
      [x + 0.44, 2.667, z - 0.15],
      [x + 0.44, 2.667, z + 0.15],
      tint
    );
  }
  // Reading lamp lens, the IV bag's label and the door's vision panel.
  glow.box(0.75, 1.505, Z_HEAD - 0.24, 0.07, 0.008, 0.07, 0.9);
  glow.box(IV_X + 0.13, 1.755, IV_Z + 0.019, 0.06, 0.07, 0.004, 0.7);
  glow.box(HALF_W - 0.056, 1.55, -1.35, 0.006, 0.24, 0.2, 0.5);
  addMesh(glow, glowMaterial, 'ward-glow');

  // ── Monitor screen and its strip of waveform ────────────────────────────
  // Two planes in the head's frame: the face with the vitals, and the strip
  // that scrolls. Both are their own draw because they are their own textures.
  const screen = new MeshBuilder();
  const screenGeometry = new THREE.PlaneGeometry(0.4, 0.26);
  screen.merge(screenGeometry, place(0, 0, 0.006));
  screenGeometry.dispose();
  addMesh(screen, screenMaterial, 'ward-monitor-screen').renderOrder = 1;

  const ecg = new MeshBuilder();
  const ecgGeometry = new THREE.PlaneGeometry(0.355, 0.095);
  ecg.merge(ecgGeometry, place(0, -0.055, 0.01));
  ecgGeometry.dispose();
  const ecgMesh = addMesh(ecg, ecgMaterial, 'ward-ecg');
  ecgMesh.renderOrder = 2;
  ecgMesh.userData.scroll = 0;

  // Two lights, no shadows: a bright sky/ground mix so the ceiling and the
  // walls do not read as a grey box, plus daylight from the window, which is
  // the only direction this room has.
  const hemisphere = new THREE.HemisphereLight(0xfbfdfd, 0xa3a8a6, 0.95);
  const daylight = new THREE.DirectionalLight(0xfff3e2, 0.5);
  daylight.position.set(-0.3, 2.2, -4.2);
  root.add(hemisphere, daylight);

  let scroll = 0;

  return {
    root,
    update(dt: number, elapsed: number): void {
      // The strip is the only moving thing in the room: a trace being written,
      // plus a 3% brightness breath so the screen is not a still photograph.
      scroll = advanceEcgOffset(scroll, dt);
      ecgMesh.userData.scroll = scroll;
      if (ecgMap) {
        ecgMap.offset.x = scroll;
      }
      const pulse = Number.isFinite(elapsed) ? elapsed : 0;
      screenMaterial.color.setScalar(0.97 + 0.03 * Math.sin(pulse * 1.1));
    },
    dispose(): void {
      root.remove(hemisphere, daylight);
      disposer.disposeAll();
      ecgMesh.userData.scroll = 0;
      root.clear();
    }
  };
}
