import * as THREE from 'three';
import { getSceneDefinition, SCENE } from '../scenes/registry';
import { SceneHost } from '../core/scene/host';

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

interface MirrorState {
  /** Scene loaded on the headset; the mirror rebuilds when it changes. */
  scene?: string;
  session?: boolean;
  eyeHeight?: number;
  worldYaw?: number;
  worldPitch?: number;
  worldRoll?: number;
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
sceneHost.load(SCENE, { eyeHeight: 1.7 });

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

/** Newest payload values: radians for the angles, millimetres for the heave. */
const target = {
  yaw: 0, pitch: 0, roll: 0,
  worldYaw: 0, worldPitch: 0, worldRoll: 0,
  floatMm: 0, swayDeg: 0
};
/** What this frame renders; eased toward `target` to hide the 5 Hz feed. */
const applied = {
  yaw: 0, pitch: 0, roll: 0,
  worldYaw: 0, worldPitch: 0, worldRoll: 0,
  floatMm: 0, swayDeg: 0
};
/** False until the first payload, which snaps instead of easing in from zero. */
let primed = false;
let sceneId = SCENE.id;
let sceneName = SCENE.name.zh;
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
  target.yaw = (pose?.yaw ?? 0) * DEG;
  target.pitch = (pose?.pitch ?? 0) * DEG;
  target.roll = (pose?.roll ?? 0) * DEG;
  target.worldYaw = (next.worldYaw ?? 0) * DEG;
  target.worldPitch = (next.worldPitch ?? 0) * DEG;
  target.worldRoll = (next.worldRoll ?? 0) * DEG;
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
  applied.floatMm = target.floatMm;
  applied.swayDeg = target.swayDeg;
}

/** Swap to the reported scene when the registry can build it. */
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
  sceneHost.load(definition, { eyeHeight: state.eyeHeight ?? 1.7 });
  sceneId = definition.id;
  sceneName = definition.name.zh;
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
  applied.floatMm += (target.floatMm - applied.floatMm) * alpha;
  applied.swayDeg += (target.swayDeg - applied.swayDeg) * alpha;
}

function settleFloor(): void {
  const eyeHeight = state.eyeHeight ?? 1.7;
  // Same rule as the headset: content sits one eye-height below the eyes while
  // a session runs. The posture branch rotates the world base instead of
  // moving the floor, so it needs no extra term here.
  const base = state.session ? -eyeHeight : 0;
  // The buoyancy arrives already applied: the mirror only adds it to the base
  // the page uses and never recomputes the curve.
  sceneHost.setFloorOffset(base + applied.floatMm / 1000);
  // Horizon sway is the world pitch the page puts on its content.
  sceneHost.content.rotation.x = applied.swayDeg * DEG;
}

function applyCamera(): void {
  const pose = state.pose;
  const eyeHeight = state.eyeHeight ?? 1.7;
  camera.position.set(pose?.x ?? 0, pose?.y ?? eyeHeight, pose?.z ?? 0);
  // The patient sees content rotated by the world shell; undo that rotation
  // here, so calibration, view and posture offsets are visible in the mirror.
  // Roll is the head's own, so it stays in the YXZ head rotation.
  headEuler.set(applied.pitch, applied.yaw, applied.roll, 'YXZ');
  headQuat.setFromEuler(headEuler);
  worldEuler.set(
    applied.worldPitch,
    applied.worldYaw,
    applied.worldRoll,
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
    smooth(dt);
    sceneHost.update?.(dt, now / 1000);
  }
  settleFloor();
  applyCamera();
  renderer.render(scene, camera);
  const stale = lastStateAt > 0 && now - lastStateAt > 2500;
  label.textContent = stale
    ? `${sceneName} · 头显数据已中断`
    : `${sceneName} · ${state.session ? '训练中' : '待机'}`;
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
