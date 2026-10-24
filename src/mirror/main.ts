import * as THREE from 'three';
import { getSceneDefinition, SCENE } from '../scenes/registry';
import { SceneHost } from '../core/scene/host';
import { mirrorCameraTransform } from './camera';

/**
 * Tablet scene mirror, minimal on purpose.
 *
 * The operator needs one thing from this surface: what the patient is looking
 * at, right now. It is not an editor and not a second app: no markers, no gaze
 * reticle, no recording, no menus. Only the scene, a camera driven by the
 * headset's own world rotation, and a status line when data stops arriving.
 *
 * Cost control: pixel ratio capped at 1 and the loop stops
 * entirely when the host says the view is hidden (the operator collapsed it) or
 * when the page is not visible. A mirror nobody is looking at should not warm
 * the tablet.
 */

const RENDER_PIXEL_RATIO = 1;
const DEG = Math.PI / 180;
const TAU = Math.PI * 2;
/**
 * The feed arrives at 5 Hz and the tablet renders at 60 fps, so every frame
 * moves a fraction of the way to the newest sample (`1 - exp(-dt/tau)`)
 * instead of stepping once per payload.
 */
const SMOOTH_TAU_S = 0.12;

/** The patient's own view, or a pulled-back view of where the patient is. */
type MirrorMode = 'patient' | 'overview';

interface MirrorState {
  /** Scene loaded on the headset; the mirror rebuilds when it changes. */
  scene?: string;
  session?: boolean;
  eyeHeight?: number;
  worldYaw?: number;
  worldPitch?: number;
  worldRoll?: number;
  /** Applied world translation, metres, device frame (the correction pivot). */
  worldXM?: number;
  worldYM?: number;
  worldZM?: number;
  /** Buoyancy already applied by the page, in millimetres. */
  floatMm?: number;
  /** Horizon pitch already applied by the page, in degrees. */
  swayDeg?: number;
  pose?: {
    x?: number;
    y?: number;
    z?: number;
    yaw?: number;
    pitch?: number;
    roll?: number;
  } | null;
  postureRise?: number;
}

const host = document.createElement('div');
host.id = 'mirror-host';
host.style.cssText = 'position:fixed;inset:0;overflow:hidden;';

const canvasHost = document.createElement('div');
// Pointer events only: without this a drag on a touch panel scrolls instead.
canvasHost.style.cssText = 'position:absolute;inset:0;touch-action:none;';
host.appendChild(canvasHost);

const label = document.createElement('div');
label.style.cssText =
  'position:absolute;left:12px;bottom:10px;font:12px/1.4 system-ui,sans-serif;' +
  'color:#ECE6DA;opacity:.75;pointer-events:none;letter-spacing:.04em';
label.textContent = `${SCENE.name.zh} · 等待头显数据`;
host.appendChild(label);

document.body.style.margin = '0';
document.body.style.background = '#0f1210';
document.body.appendChild(host);

const scene = new THREE.Scene();
const renderer = new THREE.WebGLRenderer({
  antialias: false,
  powerPreference: 'low-power',
  alpha: false
});
renderer.setPixelRatio(RENDER_PIXEL_RATIO);
canvasHost.appendChild(renderer.domElement);

const camera = new THREE.PerspectiveCamera(72, 1, 0.05, 300);
const sceneHost = new SceneHost(scene);
sceneHost.load(SCENE);

let state: MirrorState = {};
let lastStateAt = 0;
/** False until the first start(): an initial `true` would make start() a no-op. */
let running = false;
let raf = 0;
let lastFrame = 0;

/** Newest payload values: radians for the angles, millimetres for the heave. */
const target = {
  yaw: 0, pitch: 0, roll: 0,
  worldYaw: 0, worldPitch: 0, worldRoll: 0,
  worldXM: 0, worldYM: 0, worldZM: 0,
  floatMm: 0, swayDeg: 0,
  /** Device-frame eye position from telemetry, metres. */
  x: 0, y: 1.7, z: 0
};
/** False until a payload carries a finite pose. */
let hasPose = false;
/** What this frame renders; eased toward `target` to hide the 5 Hz feed. */
const applied = {
  yaw: 0, pitch: 0, roll: 0,
  worldYaw: 0, worldPitch: 0, worldRoll: 0,
  worldXM: 0, worldYM: 0, worldZM: 0,
  floatMm: 0, swayDeg: 0,
  x: 0, y: 1.7, z: 0
};
/** False until the first payload, which snaps instead of easing in from zero. */
let primed = false;
/** Patient view by default; the operator can pull back to the overview. */
let mode: MirrorMode = 'patient';
let sceneId = SCENE.id;
let sceneName = SCENE.name.zh;
/**
 * The room's own walls and ceiling. In the overview the camera sits outside the
 * room, so these are hidden — the same cutaway the washroom's walls read as —
 * or the diorama is a closed box with the patient invisible inside it.
 */
let cutaway: THREE.Mesh[] = [];
/** Scene bounds, for deciding whether the camera is inside the room. */
const sceneBounds = new THREE.Box3();
/** Last scene name reported as unknown, so the console is not spammed at 5 Hz. */
let warnedSceneId = '';

function resize(): void {
  const width = Math.max(1, host.clientWidth);
  const height = Math.max(1, host.clientHeight);
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}

function setTarget(next: MirrorState): void {
  const pose = next.pose;
  // The telemetry pose is already in radians; only the world angles (state
  // frame) are degrees. Scaling the pose by DEG made a 40° head turn move the
  // mirror by 0.7°.
  //
  // A payload without a pose must not move the camera: the state frame and the
  // telemetry frame arrive on different cadences, and resetting to zero on a
  // missing sample makes the mirror swing at the payload rate ("jittering, and
  // never following the head").
  if (pose && Number.isFinite(pose.yaw) && Number.isFinite(pose.pitch)) {
    target.yaw = pose.yaw as number;
    target.pitch = pose.pitch as number;
    target.roll = Number.isFinite(pose.roll) ? (pose.roll as number) : 0;
    if (Number.isFinite(pose.x)) target.x = pose.x as number;
    if (Number.isFinite(pose.y)) target.y = pose.y as number;
    if (Number.isFinite(pose.z)) target.z = pose.z as number;
    hasPose = true;
  }
  target.worldYaw = (next.worldYaw ?? 0) * DEG;
  target.worldPitch = (next.worldPitch ?? 0) * DEG;
  target.worldRoll = (next.worldRoll ?? 0) * DEG;
  target.worldXM = next.worldXM ?? 0;
  target.worldYM = next.worldYM ?? 0;
  target.worldZM = next.worldZM ?? 0;
  target.floatMm = next.floatMm ?? 0;
  target.swayDeg = next.swayDeg ?? 0;
  if (primed) {
    return;
  }
  primed = true;
  applied.yaw = target.yaw;
  applied.pitch = target.pitch;
  applied.roll = target.roll;
  applied.worldYaw = target.worldYaw;
  applied.worldPitch = target.worldPitch;
  applied.worldRoll = target.worldRoll;
  applied.worldXM = target.worldXM;
  applied.worldYM = target.worldYM;
  applied.worldZM = target.worldZM;
  applied.floatMm = target.floatMm;
  applied.swayDeg = target.swayDeg;
  applied.x = target.x;
  applied.y = target.y;
  applied.z = target.z;
}

/** Swap to the reported scene when the registry can build it. */
/** Find the room's shell in whatever was just loaded, and its bounds. */
function collectCutaway(): void {
  cutaway = [];
  sceneHost.content.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (mesh.isMesh && /(-walls?|-shell)$/.test(mesh.name)) {
      cutaway.push(mesh);
    }
  });
  sceneBounds.setFromObject(sceneHost.content);
}

function syncScene(): void {
  const id = state.scene;
  if (!id || id === sceneId) {
    return;
  }
  // A name the registry cannot resolve is logged once and the current scene
  // keeps running: a mirror of the wrong room still beats a blank one.
  const definition = getSceneDefinition(id);
  if (!definition) {
    if (warnedSceneId !== id) {
      warnedSceneId = id;
      console.warn(`[mirror] unknown scene "${id}"; keeping "${sceneId}"`);
    }
    return;
  }
  sceneHost.load(definition);
  sceneId = definition.id;
  sceneName = definition.name.zh;
  collectCutaway();
  settleFloor();
}

function shortestAngleDelta(from: number, to: number): number {
  let delta = (to - from) % TAU;
  if (delta > Math.PI) {
    delta -= TAU;
  } else if (delta < -Math.PI) {
    delta += TAU;
  }
  return delta;
}

/** One easing step toward the newest payload; only called with dt > 0. */
function smooth(dt: number): void {
  const alpha = 1 - Math.exp(-dt / SMOOTH_TAU_S);
  applied.yaw += shortestAngleDelta(applied.yaw, target.yaw) * alpha;
  applied.pitch += (target.pitch - applied.pitch) * alpha;
  applied.roll += (target.roll - applied.roll) * alpha;
  // The world shell is the other half of the step: a sit-up rotates it at up to
  // 40 °/s, which at 5 Hz is an 8° jump per payload.
  applied.worldYaw += shortestAngleDelta(applied.worldYaw, target.worldYaw) * alpha;
  applied.worldPitch += (target.worldPitch - applied.worldPitch) * alpha;
  applied.worldRoll += (target.worldRoll - applied.worldRoll) * alpha;
  applied.worldXM += (target.worldXM - applied.worldXM) * alpha;
  applied.worldYM += (target.worldYM - applied.worldYM) * alpha;
  applied.worldZM += (target.worldZM - applied.worldZM) * alpha;
  applied.floatMm += (target.floatMm - applied.floatMm) * alpha;
  applied.swayDeg += (target.swayDeg - applied.swayDeg) * alpha;
  applied.x += (target.x - applied.x) * alpha;
  applied.y += (target.y - applied.y) * alpha;
  applied.z += (target.z - applied.z) * alpha;
}

function settleFloor(): void {
  // Same rule as the headset: the content is dropped by the **scene's** eye
  // height, not the operator's measured one. Using `state.eyeHeight` here put
  // the washroom's floor 1.7 m too low, so the patient view was a wall far
  // below and the room looked enormous.
  const sceneEye = getSceneDefinition(sceneId)?.eyeY ?? state.eyeHeight ?? 1.7;
  // Unconditional: the camera lives in the page's `local` frame, where the eye
  // is the origin, so the art only lands at eye level because it is dropped by
  // its own eye height. Gating that on `state.session` put the camera on the
  // floor of an unshifted room whenever the session flag was not there yet.
  const base = -sceneEye;
  // The buoyancy arrives already applied: the mirror only adds it to the base
  // the page uses and never recomputes the curve.
  sceneHost.setFloorOffset(base + applied.floatMm / 1000);
  // Horizon sway is the world pitch the page puts on its content.
  sceneHost.content.rotation.x = applied.swayDeg * DEG;
}

/**
 * The patient, as a view frustum.
 *
 * No body, no head: in the overview the operator only needs to see where the
 * patient stands and what the field of view covers. A wireframe frustum does
 * that in one object — apex at the eye, opening along the gaze, sized to the
 * headset's field of view — and it cannot be mistaken for a person.
 */
const overview = new THREE.Group();
overview.name = 'mirror-overview';
overview.visible = false;
scene.add(overview);

/** Half-angles of the headset's usable field of view, degrees. */
const FOV_HALF_H = 42;
const FOV_HALF_V = 38;
const FOV_LENGTH = 1.5;

const frustumGeometry = (() => {
  const halfW = Math.tan((FOV_HALF_H * Math.PI) / 180) * FOV_LENGTH;
  const halfH = Math.tan((FOV_HALF_V * Math.PI) / 180) * FOV_LENGTH;
  // Local frame: apex at the origin, axis along -Z, up along +Y.
  const far = -FOV_LENGTH;
  const corners: [number, number][] = [
    [-halfW, halfH],
    [halfW, halfH],
    [halfW, -halfH],
    [-halfW, -halfH]
  ];
  const positions: number[] = [];
  for (const [x, y] of corners) {
    positions.push(0, 0, 0, x, y, far);
  }
  for (let i = 0; i < 4; i += 1) {
    const a = corners[i];
    const b = corners[(i + 1) % 4];
    positions.push(a[0], a[1], far, b[0], b[1], far);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  return geometry;
})();
const frustumMaterial = new THREE.LineBasicMaterial({
  color: 0xdff3e6,
  transparent: true,
  opacity: 0.7,
  depthTest: false,
  depthWrite: false,
  toneMapped: false
});
const frustum = new THREE.LineSegments(frustumGeometry, frustumMaterial);
frustum.name = 'mirror-frustum';
frustum.renderOrder = 3000;
overview.add(frustum);

const eyePoint = new THREE.Vector3();
const gazeDir = new THREE.Vector3();
const headUp = new THREE.Vector3();
const upAxis = new THREE.Vector3(0, 1, 0);
const lookAt = new THREE.Vector3();
const basis = new THREE.Matrix4();
const orbitOffset = new THREE.Vector3();

/**
 * Overview camera orbit: **not** driven by the patient's gaze.
 *
 * The operator's own gesture owns this camera — drag to walk around the
 * diorama, pinch to zoom — while the patient's head only steers the frustum.
 * Following the gaze here made the whole room swing whenever the patient
 * looked around, which read as the mirror being broken rather than as a view.
 */
const orbit = {
  azimuthDeg: 205,
  elevationDeg: 24,
  distance: 3.6
};
const ORBIT_DISTANCE_MIN = 1.6;
const ORBIT_DISTANCE_MAX = 9;
const ORBIT_ELEVATION_MIN = 2;
const ORBIT_ELEVATION_MAX = 82;

/** Active pointers, in CSS pixels; one drags, two pinch. */
const pointers = new Map<number, { x: number; y: number }>();
let pinchSpan = 0;
let pinchDistance = 0;

function pointerSpan(): number {
  const [a, b] = [...pointers.values()];
  return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

canvasHost.addEventListener('pointerdown', (event) => {
  if (mode !== 'overview') {
    return;
  }
  canvasHost.setPointerCapture(event.pointerId);
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  if (pointers.size === 2) {
    pinchSpan = pointerSpan();
    pinchDistance = orbit.distance;
  }
});

canvasHost.addEventListener('pointermove', (event) => {
  const previous = pointers.get(event.pointerId);
  if (!previous || mode !== 'overview') {
    return;
  }
  const dx = event.clientX - previous.x;
  const dy = event.clientY - previous.y;
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  if (pointers.size >= 2) {
    const span = pointerSpan();
    if (pinchSpan > 8 && span > 8) {
      // Fingers apart = closer: the diorama is what the gesture scales.
      orbit.distance = clamp(
        (pinchDistance * pinchSpan) / span,
        ORBIT_DISTANCE_MIN,
        ORBIT_DISTANCE_MAX
      );
    }
    return;
  }
  // One finger walks around the patient; elevation stops short of both poles.
  orbit.azimuthDeg = (orbit.azimuthDeg - dx * 0.35) % 360;
  orbit.elevationDeg = clamp(orbit.elevationDeg + dy * 0.25, ORBIT_ELEVATION_MIN, ORBIT_ELEVATION_MAX);
});

const releasePointer = (event: PointerEvent): void => {
  pointers.delete(event.pointerId);
  if (pointers.size < 2) {
    pinchSpan = 0;
  }
};
canvasHost.addEventListener('pointerup', releasePointer);
canvasHost.addEventListener('pointercancel', releasePointer);

function applyOverview(): void {
  eyePoint.copy(camera.position);
  // Patient orientation, used for the frustum only.
  gazeDir.set(0, 0, -1).applyQuaternion(camera.quaternion).normalize();
  headUp.set(0, 1, 0).applyQuaternion(camera.quaternion).normalize();

  const azimuth = (orbit.azimuthDeg * Math.PI) / 180;
  const elevation = (orbit.elevationDeg * Math.PI) / 180;
  orbitOffset.set(
    Math.cos(elevation) * Math.sin(azimuth),
    Math.sin(elevation),
    Math.cos(elevation) * Math.cos(azimuth)
  );

  camera.position.copy(eyePoint).addScaledVector(orbitOffset, orbit.distance);
  // Aim a little above the eye: the eye itself sits on the art floor's 1.7 m
  // line, so aiming exactly at it puts the room's furniture at the frame edge.
  lookAt.copy(eyePoint).addScaledVector(upAxis, 0.35);
  camera.up.copy(upAxis);
  camera.lookAt(lookAt);

  // Frustum: local -Z along the gaze, local +Y along the patient's up.
  basis.makeBasis(
    new THREE.Vector3().crossVectors(headUp, gazeDir).normalize(),
    headUp,
    gazeDir.clone().negate()
  );
  frustum.position.copy(eyePoint);
  frustum.quaternion.setFromRotationMatrix(basis);
  overview.visible = true;
}

function applyCamera(): void {
  if (hasPose) {
    camera.position.set(applied.x, applied.y, applied.z);
  } else {
    // The XR reference origin is the headset itself, not the floor: a fallback
    // at `eyeHeight` put the eye 1.7 m above the room.
    camera.position.set(0, 0, 0);
  }
  // The patient sees content moved by the full world transform; undo it here,
  // so calibration, view and posture offsets are visible in the mirror.
  // Roll is the head's own, so it stays in the YXZ head rotation.
  mirrorCameraTransform(
    camera,
    {
      yaw: applied.worldYaw,
      pitch: applied.worldPitch,
      roll: applied.worldRoll,
      xM: applied.worldXM,
      yM: applied.worldYM,
      zM: applied.worldZM
    },
    { yaw: applied.yaw, pitch: applied.pitch, roll: applied.roll },
    { x: camera.position.x, y: camera.position.y, z: camera.position.z }
  );
  camera.up.set(0, 1, 0);
  if (mode === 'overview') {
    applyOverview();
  } else {
    overview.visible = false;
    camera.fov = 72;
    camera.updateProjectionMatrix();
    return;
  }
  camera.fov = 58;
  camera.updateProjectionMatrix();
}

/**
 * Inside the room the walls stay; outside it they step aside. Recomputed per
 * frame because the overview orbit crosses the wall when the operator zooms in.
 */
const CAMERA_INSET_M = 0.05;
function applyCutaway(): void {
  if (cutaway.length === 0 || sceneBounds.isEmpty()) {
    return;
  }
  const inside =
    camera.position.x > sceneBounds.min.x + CAMERA_INSET_M &&
    camera.position.x < sceneBounds.max.x - CAMERA_INSET_M &&
    camera.position.z > sceneBounds.min.z + CAMERA_INSET_M &&
    camera.position.z < sceneBounds.max.z - CAMERA_INSET_M;
  for (const mesh of cutaway) {
    mesh.visible = inside;
  }
}

/** Operator view: the patient's own view, or a pulled-back diorama. */
function setMode(next: MirrorMode): void {
  if (next !== 'patient' && next !== 'overview') {
    return;
  }
  // Drop any half-finished gesture: the next one starts from a clean slate.
  pointers.clear();
  pinchSpan = 0;
  mode = next;
}

function frame(now: number): void {
  if (!running) {
    return;
  }
  const dt = lastFrame > 0 ? Math.min(0.1, (now - lastFrame) / 1000) : 0;
  lastFrame = now;
  if (dt > 0) {
    smooth(dt);
    sceneHost.update?.(dt, now / 1000);
  }
  settleFloor();
  applyCamera();
  applyCutaway();
  renderer.render(scene, camera);
  const stale = lastStateAt > 0 && now - lastStateAt > 2500;
  const hint = mode === 'overview' ? ' · 拖动旋转 · 双指缩放' : '';
  label.textContent = (stale
    ? `${sceneName} · 头显数据已中断`
    : `${sceneName} · ${state.session ? '训练中' : '待机'}`) + hint;
  raf = requestAnimationFrame(frame);
}

function start(): void {
  if (running) {
    return;
  }
  running = true;
  lastFrame = 0;
  raf = requestAnimationFrame(frame);
}

function stop(): void {
  running = false;
  if (raf) {
    cancelAnimationFrame(raf);
    raf = 0;
  }
}

/** Called by the native side with a JSON snapshot of the headset state. */
function onState(json: string): void {
  try {
    const next = JSON.parse(json) as MirrorState;
    state = next;
    lastStateAt = performance.now();
    setTarget(next);
    syncScene();
    // First data means the host wants a picture: never leave the canvas black
    // because a native `start()` call raced the page load.
    if (!running) {
      start();
    }
  } catch {
    // A malformed frame is dropped; the next one supersedes it anyway.
  }
}

Object.assign(window, {
  QuietShoreMirror: {
    onState,
    setMode,
    getMode: () => mode,
    /** Field diagnostics: where the camera and the art actually are. */
    debug: () => ({
      mode,
      scene: sceneId,
      camera: camera.position.toArray().map((n) => Math.round(n * 100) / 100),
      quaternion: camera.quaternion.toArray().map((n) => Math.round(n * 1000) / 1000),
      contentY: Math.round(sceneHost.content.position.y * 100) / 100,
      hasPose,
      applied: {
        yaw: Math.round(applied.yaw * 1000) / 1000,
        pitch: Math.round(applied.pitch * 1000) / 1000,
        worldYaw: Math.round(applied.worldYaw * 1000) / 1000,
        worldPitch: Math.round(applied.worldPitch * 1000) / 1000
      }
    }),
    start,
    stop,
    resize
  }
});

window.addEventListener('resize', resize);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    stop();
  } else {
    start();
  }
});

resize();
// The startup scene never passes through syncScene: take its shell now.
collectCutaway();
start();
