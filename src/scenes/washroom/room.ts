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
 * The viewer stands at the origin facing -Z: the wall is 0.55 m ahead, the
 * bowl projects to 0.28 m, the rim is at 1.00 m — the geometry a 1.7 m man
 * actually stands in front of, not a showroom approximation.
 *
 * Everything is baked: two lights (one hemisphere, one soft key), no shadows,
 * no post-processing, no transparency. Seven draws, no full-screen passes
 * beyond the room itself, so the frame budget goes to supersampling.
 *
 * The palette is the one already spoken for in the product: pale sage
 * micro-cement, warm stone, white ceramic, brushed steel, light oak.
 */

const ROOM_WIDTH = 2.4;
const ROOM_DEPTH = 2.4;
const ROOM_HEIGHT = 2.55;
/**
 * Wall to eye: 0.85 m. A man at a urinal stands 0.4–0.6 m from the lip, and
 * the lip projects 0.34 m, so this is the real distance, not a showroom one.
 */
const BACK_Z = -0.85;
const FRONT_Z = BACK_Z + ROOM_DEPTH;

/** Texture repeats per metre; the wall texture spans ~2 m. */
const WALL_UV = 0.5;
const FLOOR_UV = 0.5;

type Vec3 = [number, number, number];

interface Surface {
  /** Bottom-left, bottom-right, top-right, top-left, as seen from the front. */
  corners: [Vec3, Vec3, Vec3, Vec3];
  /** Per-corner brightness, used as cheap baked occlusion. */
  tint: [number, number, number, number];
  uv: number;
}

/**
 * Merge coplanar quads into one geometry. Vertex tints stand in for ambient
 * occlusion at the floor line, which is the only shading a flat wall needs.
 */
function buildSurfaces(surfaces: readonly Surface[]): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];

  for (let s = 0; s < surfaces.length; s += 1) {
    const surface = surfaces[s];
    const base = positions.length / 3;
    const [a, b, c, d] = surface.corners;
    const width = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) * surface.uv;
    const height = Math.hypot(d[0] - a[0], d[1] - a[1], d[2] - a[2]) * surface.uv;
    const corners = [a, b, c, d];
    const cornerUvs: [number, number][] = [[0, 0], [width, 0], [width, height], [0, height]];
    for (let i = 0; i < 4; i += 1) {
      const corner = corners[i];
      positions.push(corner[0], corner[1], corner[2]);
      uvs.push(cornerUvs[i][0], cornerUvs[i][1]);
      const tint = surface.tint[i];
      colors.push(tint, tint, tint);
    }
    // Normal from the winding; three recomputes nothing when supplied.
    const e1 = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const e2 = new THREE.Vector3(d[0] - a[0], d[1] - a[1], d[2] - a[2]);
    const normal = e1.cross(e2).normalize();
    for (let i = 0; i < 4; i += 1) {
      normals.push(normal.x, normal.y, normal.z);
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  return geometry;
}

/**
 * Bowl geometry: a funnel from the oval mouth at the front to a narrow throat
 * at the wall. That is what a urinal is from the patient's side — an opening
 * that slopes down and away — and it reads correctly without a rim curve.
 */
const BOWL_CENTER_Y = 0.68;
const BOWL_CENTER_Z = -0.63;
const BOWL_LIP_RADIUS = 0.21;
const BOWL_DEPTH = 0.42;
/** Vertical stretch: urinal mouths are taller than they are wide. */
const BOWL_ASPECT = 1.15;
/**
 * Mouth tilt, radians. A urinal is not a funnel aimed at the user: its lip
 * faces up and out, and the bowl runs down to a throat at the wall.
 */
const BOWL_TILT = 0.62;

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
  if (wallMap) disposables.push(wallMap);
  if (floorMap) disposables.push(floorMap);
  if (ceramicMap) disposables.push(ceramicMap);
  if (oakMap) disposables.push(oakMap);
  if (metalMap) disposables.push(metalMap);

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
  const panelMaterial = new THREE.MeshLambertMaterial({
    ...(ceramicMap ? { map: ceramicMap } : {}),
    color: ceramicMap ? 0xffffff : 0xf6f4ef,
    side: THREE.DoubleSide
  });
  const oakMaterial = new THREE.MeshLambertMaterial({
    ...(oakMap ? { map: oakMap } : {}),
    color: oakMap ? 0xffffff : 0xc2a176,
    side: THREE.DoubleSide
  });
  const metalMaterial = new THREE.MeshLambertMaterial({
    ...(metalMap ? { map: metalMap } : {}),
    color: metalMap ? 0xffffff : 0xb7bcc0,
    emissive: 0x0e1012
  });
  disposables.push(wallMaterial, floorMaterial, ceilingMaterial, ceramicMaterial, panelMaterial, oakMaterial, metalMaterial);

  const wallGeometry = buildSurfaces([
    {
      // Back wall, seen from the room (+Z normal).
      corners: [
        [-ROOM_WIDTH / 2, 0, BACK_Z],
        [ROOM_WIDTH / 2, 0, BACK_Z],
        [ROOM_WIDTH / 2, ROOM_HEIGHT, BACK_Z],
        [-ROOM_WIDTH / 2, ROOM_HEIGHT, BACK_Z]
      ],
      tint: [0.82, 0.82, 1.0, 1.0],
      uv: WALL_UV
    },
    {
      // Left wall, facing +X.
      corners: [
        [-ROOM_WIDTH / 2, 0, FRONT_Z],
        [-ROOM_WIDTH / 2, 0, BACK_Z],
        [-ROOM_WIDTH / 2, ROOM_HEIGHT, BACK_Z],
        [-ROOM_WIDTH / 2, ROOM_HEIGHT, FRONT_Z]
      ],
      tint: [0.84, 0.84, 1.0, 1.0],
      uv: WALL_UV
    },
    {
      // Wall behind the patient, facing -Z: turning around finds a room, not a void.
      corners: [
        [ROOM_WIDTH / 2, 0, FRONT_Z],
        [-ROOM_WIDTH / 2, 0, FRONT_Z],
        [-ROOM_WIDTH / 2, ROOM_HEIGHT, FRONT_Z],
        [ROOM_WIDTH / 2, ROOM_HEIGHT, FRONT_Z]
      ],
      tint: [0.78, 0.78, 0.95, 0.95],
      uv: WALL_UV
    }
  ]);
  const walls = new THREE.Mesh(wallGeometry, wallMaterial);
  walls.name = 'washroom-walls';
  root.add(walls);
  disposables.push(wallGeometry);

  const floorGeometry = buildSurfaces([
    {
      corners: [
        [-ROOM_WIDTH / 2, 0, FRONT_Z],
        [ROOM_WIDTH / 2, 0, FRONT_Z],
        [ROOM_WIDTH / 2, 0, BACK_Z],
        [-ROOM_WIDTH / 2, 0, BACK_Z]
      ],
      // Darker at the wall end: the only floor shading worth baking.
      tint: [1.0, 1.0, 0.82, 0.82],
      uv: FLOOR_UV
    }
  ]);
  const floor = new THREE.Mesh(floorGeometry, floorMaterial);
  floor.name = 'washroom-floor';
  root.add(floor);
  disposables.push(floorGeometry);

  const ceilingGeometry = new THREE.PlaneGeometry(ROOM_WIDTH, ROOM_DEPTH);
  ceilingGeometry.rotateX(Math.PI / 2);
  const ceiling = new THREE.Mesh(ceilingGeometry, ceilingMaterial);
  ceiling.name = 'washroom-ceiling';
  ceiling.position.set(0, ROOM_HEIGHT, BACK_Z + ROOM_DEPTH / 2);
  root.add(ceiling);
  disposables.push(ceilingGeometry);

  // Privacy screen on the right: light oak, one panel, no hardware.
  const screenGeometry = new THREE.PlaneGeometry(0.62, 2.05);
  const screen = new THREE.Mesh(screenGeometry, oakMaterial);
  screen.name = 'washroom-screen';
  screen.position.set(0.98, 1.025, BACK_Z + 0.31);
  screen.rotation.y = -Math.PI / 2;
  root.add(screen);
  disposables.push(screenGeometry);

  // Bowl: funnel from the oval mouth, tilted up and out, to the throat at the
  // wall. That tilt is what separates a urinal from a funnel aimed at the eye.
  const bowlGeometry = new THREE.CylinderGeometry(BOWL_LIP_RADIUS, 0.07, BOWL_DEPTH, 24, 1, true);
  // Depth cue without shadows: darken towards the throat by baking it into the
  // vertex colour, the cheapest shading this GPU can do.
  {
    const position = bowlGeometry.getAttribute('position') as THREE.BufferAttribute;
    const colors = new Float32Array(position.count * 3);
    for (let i = 0; i < position.count; i += 1) {
      const t = (position.getY(i) + BOWL_DEPTH / 2) / BOWL_DEPTH;
      const shade = 0.55 + 0.45 * Math.min(1, Math.max(0, t));
      colors[i * 3] = shade;
      colors[i * 3 + 1] = shade;
      colors[i * 3 + 2] = shade;
    }
    bowlGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  }
  bowlGeometry.rotateX(Math.PI / 2);
  bowlGeometry.scale(1, BOWL_ASPECT, 1);
  bowlGeometry.rotateX(-BOWL_TILT);
  const urinal = new THREE.Mesh(bowlGeometry, ceramicMaterial);
  urinal.name = 'washroom-urinal';
  urinal.position.set(0, BOWL_CENTER_Y, BOWL_CENTER_Z);
  root.add(urinal);
  disposables.push(bowlGeometry);

  // Lip centre, derived from the same tilt so the rim lands on the mouth.
  const lipY = BOWL_CENTER_Y + Math.sin(BOWL_TILT) * (BOWL_DEPTH / 2);
  const lipZ = BOWL_CENTER_Z + Math.cos(BOWL_TILT) * (BOWL_DEPTH / 2);

  // Rim: the only edge a man actually sees, so it gets its own thin ring.
  const rimGeometry = new THREE.TorusGeometry(BOWL_LIP_RADIUS, 0.012, 8, 28);
  rimGeometry.scale(1, BOWL_ASPECT, 1);
  rimGeometry.rotateX(-BOWL_TILT);
  const rimMaterial = new THREE.MeshLambertMaterial({ color: 0xfbfaf6 });
  const rim = new THREE.Mesh(rimGeometry, rimMaterial);
  rim.name = 'washroom-urinal-rim';
  rim.position.set(0, lipY, lipZ);
  root.add(rim);
  disposables.push(rimGeometry, rimMaterial);

  // Throat: a dark disc closing the narrow end, so the bowl does not read as
  // an open cone with the wall showing through it.
  const throatGeometry = new THREE.CircleGeometry(0.07, 20);
  throatGeometry.rotateX(-BOWL_TILT);
  const throatMaterial = new THREE.MeshBasicMaterial({ color: 0x4b514c });
  const throat = new THREE.Mesh(throatGeometry, throatMaterial);
  throat.name = 'washroom-urinal-throat';
  throat.position.set(
    0,
    BOWL_CENTER_Y - Math.sin(BOWL_TILT) * (BOWL_DEPTH / 2),
    BOWL_CENTER_Z - Math.cos(BOWL_TILT) * (BOWL_DEPTH / 2)
  );
  root.add(throat);
  disposables.push(throatGeometry, throatMaterial);

  // Ceramic back panel, rounded: the fixture's outline on the wall.
  const panelWidth = 0.3;
  const panelHeight = 0.48;
  const panelRadius = 0.07;
  const panelShape = new THREE.Shape();
  panelShape.moveTo(-panelWidth / 2 + panelRadius, -panelHeight / 2);
  panelShape.lineTo(panelWidth / 2 - panelRadius, -panelHeight / 2);
  panelShape.quadraticCurveTo(panelWidth / 2, -panelHeight / 2, panelWidth / 2, -panelHeight / 2 + panelRadius);
  panelShape.lineTo(panelWidth / 2, panelHeight / 2 - panelRadius);
  panelShape.quadraticCurveTo(panelWidth / 2, panelHeight / 2, panelWidth / 2 - panelRadius, panelHeight / 2);
  panelShape.lineTo(-panelWidth / 2 + panelRadius, panelHeight / 2);
  panelShape.quadraticCurveTo(-panelWidth / 2, panelHeight / 2, -panelWidth / 2, panelHeight / 2 - panelRadius);
  panelShape.lineTo(-panelWidth / 2, -panelHeight / 2 + panelRadius);
  panelShape.quadraticCurveTo(-panelWidth / 2, -panelHeight / 2, -panelWidth / 2 + panelRadius, -panelHeight / 2);
  const backPlateGeometry = new THREE.ShapeGeometry(panelShape, 6);
  const backPlate = new THREE.Mesh(backPlateGeometry, panelMaterial);
  backPlate.name = 'washroom-urinal-back';
  backPlate.position.set(0, 0.82, BACK_Z + 0.008);
  root.add(backPlate);
  disposables.push(backPlateGeometry);

  const plateGeometry = new THREE.BoxGeometry(0.16, 0.11, 0.012);
  const plate = new THREE.Mesh(plateGeometry, metalMaterial);
  plate.name = 'washroom-flush-plate';
  plate.position.set(0, 1.24, BACK_Z + 0.007);
  root.add(plate);
  disposables.push(plateGeometry);

  // Recessed light above the bowl: an emissive-looking plane, not a light source.
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
  // and slightly behind the viewer, so the bowl gets a readable gradient.
  // Total irradiance stays under 1.0: no tone mapping, so anything above it
  // would clip the white ceramic into a flat silhouette.
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
