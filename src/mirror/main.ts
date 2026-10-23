import * as THREE from 'three';
import { SCENE } from '../scenes/registry';
import { SceneHost } from '../core/scene/host';

/**
 * Tablet scene mirror, minimal on purpose.
 *
 * The operator needs one thing from this surface: what the patient is looking
 * at, right now. It is not an editor and not a second app: no markers, no gaze
 * reticle, no recording, no menus. Only the scene, a camera driven by the
 * headset's own world rotation, and a status line when data stops arriving.
 *
 * Cost control: low quality build, pixel ratio capped at 1, and the loop stops
 * entirely when the host says the view is hidden (the operator collapsed it) or
 * when the page is not visible. A mirror nobody is looking at should not warm
 * the tablet.
 */

const RENDER_PIXEL_RATIO = 1;
const DEG = Math.PI / 180;

interface MirrorState {
  session?: boolean;
  eyeHeight?: number;
  worldYaw?: number;
  worldPitch?: number;
  worldRoll?: number;
  pose?: { x?: number; y?: number; z?: number; yaw?: number; pitch?: number } | null;
  postureRise?: number;
}

const host = document.createElement('div');
host.id = 'mirror-host';
host.style.cssText = 'position:fixed;inset:0;overflow:hidden;';

const canvasHost = document.createElement('div');
canvasHost.style.cssText = 'position:absolute;inset:0;';
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
sceneHost.load(SCENE, { quality: 'low', eyeHeight: 1.7 });

const headEuler = new THREE.Euler(0, 0, 0, 'YXZ');
const headQuat = new THREE.Quaternion();
const worldEuler = new THREE.Euler(0, 0, 0, 'XYZ');
const worldQuat = new THREE.Quaternion();

let state: MirrorState = {};
let lastStateAt = 0;
/** False until the first start(): an initial `true` would make start() a no-op. */
let running = false;
let raf = 0;
let lastFrame = 0;

function resize(): void {
  const width = Math.max(1, host.clientWidth);
  const height = Math.max(1, host.clientHeight);
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}

function settleFloor(): void {
  const eyeHeight = state.eyeHeight ?? 1.7;
  // Same rule as the headset: content sits one eye-height below the eyes while
  // a session runs. The posture branch rotates the world base instead of
  // moving the floor, so it needs no extra term here.
  sceneHost.setFloorOffset(state.session ? -eyeHeight : 0);
}

function applyCamera(): void {
  const pose = state.pose;
  const eyeHeight = state.eyeHeight ?? 1.7;
  camera.position.set(pose?.x ?? 0, pose?.y ?? eyeHeight, pose?.z ?? 0);
  // The patient sees content rotated by the world shell; undo that rotation
  // here, so calibration, view and posture offsets are visible in the mirror.
  headEuler.set(pose?.pitch ?? 0, pose?.yaw ?? 0, 0, 'YXZ');
  headQuat.setFromEuler(headEuler);
  worldEuler.set(
    (state.worldPitch ?? 0) * DEG,
    (state.worldYaw ?? 0) * DEG,
    (state.worldRoll ?? 0) * DEG,
    'XYZ'
  );
  worldQuat.setFromEuler(worldEuler).invert();
  camera.quaternion.copy(headQuat).multiply(worldQuat);
}

function frame(now: number): void {
  if (!running) {
    return;
  }
  const dt = lastFrame > 0 ? Math.min(0.1, (now - lastFrame) / 1000) : 0;
  lastFrame = now;
  if (dt > 0) {
    sceneHost.update?.(dt, now / 1000);
  }
  applyCamera();
  renderer.render(scene, camera);
  const stale = lastStateAt > 0 && now - lastStateAt > 2500;
  label.textContent = stale
    ? `${SCENE.name.zh} · 头显数据已中断`
    : `${SCENE.name.zh} · ${state.session ? '训练中' : '待机'}`;
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
    settleFloor();
  } catch {
    // A malformed frame is dropped; the next one supersedes it anyway.
  }
}

Object.assign(window, {
  QuietShoreMirror: {
    onState,
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
start();
