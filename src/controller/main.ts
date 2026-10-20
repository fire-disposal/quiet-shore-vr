import * as THREE from 'three';
import { SceneHost } from '../core/scene/host';
import { getSceneDefinition } from '../scenes/registry';
import './style.css';

type ViewMode = 'patient' | 'global';

interface Pose {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
}

interface ControllerApi {
  onTelemetry(x: number, y: number, z: number, yaw: number, pitch: number): void;
  onState(scene: string, session: boolean, calibrating: boolean, audioMuted: boolean): void;
  onBleState(state: string): void;
  onAuth(ok: boolean): void;
  setViewMode(mode: ViewMode): void;
}

declare global {
  interface Window {
    qsControl: ControllerApi;
    QuietShoreBridge?: { send(command: string): void };
  }
}

const viewport = document.getElementById('viewport') as HTMLDivElement;
const label = document.getElementById('world-label') as HTMLDivElement;
const status = document.getElementById('world-status') as HTMLDivElement;

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
viewport.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const host = new SceneHost(scene);
const camera = new THREE.PerspectiveCamera(64, 1, 0.04, 400);
camera.rotation.order = 'YXZ';

const pose: Pose = { x: 0, y: 1.6, z: 0.4, yaw: 0, pitch: 0 };
let sceneId = 'landscape';
let viewMode: ViewMode = 'global';
let session = false;
let calibrating = false;
let audioMuted = false;
let auth = false;

const orbit = {
  yaw: Math.PI * 0.22,
  pitch: 0.38,
  distance: 4.4
};

const marker = createPatientMarker();
scene.add(marker);
const target = new THREE.Vector3();

function createPatientMarker(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'patient-marker';

  const bodyMaterial = new THREE.MeshStandardMaterial({
    color: 0x7fc8b8,
    emissive: 0x153f38,
    emissiveIntensity: 0.7,
    roughness: 0.55,
    metalness: 0.05
  });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.27, 0.9, 18), bodyMaterial);
  body.position.y = 0.9;
  group.add(body);

  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.17, 20, 16),
    new THREE.MeshStandardMaterial({
      color: 0xf1dcc0,
      emissive: 0x3b2d22,
      emissiveIntensity: 0.35,
      roughness: 0.7
    })
  );
  head.position.y = 1.54;
  group.add(head);

  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.36, 0.46, 40),
    new THREE.MeshBasicMaterial({
      color: 0xe0bb78,
      transparent: true,
      opacity: 0.72,
      side: THREE.DoubleSide
    })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.012;
  group.add(ring);

  const arrow = new THREE.ArrowHelper(
    new THREE.Vector3(0, 0, -1),
    new THREE.Vector3(0, 1.64, 0),
    0.85,
    0xe0bb78,
    0.24,
    0.12
  );
  group.add(arrow);

  const glow = new THREE.PointLight(0x7fc8b8, 0.55, 2.6, 1.8);
  glow.position.set(0, 1.2, 0);
  group.add(glow);

  return group;
}

function updateMarker(): void {
  marker.position.set(pose.x, 0, pose.z);
  marker.rotation.y = pose.yaw;
  marker.visible = viewMode === 'global';
}

function updateCamera(): void {
  if (viewMode === 'patient') {
    camera.position.set(pose.x, pose.y, pose.z);
    camera.rotation.set(pose.pitch, pose.yaw, 0, 'YXZ');
    return;
  }
  target.set(pose.x, 1.08, pose.z);
  const offset = new THREE.Vector3(
    Math.cos(orbit.pitch) * Math.sin(orbit.yaw),
    Math.sin(orbit.pitch),
    Math.cos(orbit.pitch) * Math.cos(orbit.yaw)
  ).multiplyScalar(orbit.distance);
  camera.position.copy(target).add(offset);
  camera.lookAt(target);
}

function setStatus(text: string, error = false): void {
  status.textContent = text;
  status.classList.toggle('error', error);
}

function loadScene(nextId: string): void {
  const definition = getSceneDefinition(nextId);
  if (!definition || nextId === sceneId && host.definition) {
    return;
  }
  sceneId = definition.id;
  host.load(definition, { quality: 'high', eyeHeight: 1.6 });
  host.setFloorOffset(0);
  scene.add(marker);
  marker.visible = viewMode === 'global';
  label.textContent = `患者场景 ${definition.name.zh}`;
}

window.qsControl = {
  onTelemetry(x, y, z, yaw, pitch) {
    if (![x, y, z, yaw, pitch].every(Number.isFinite)) {
      return;
    }
    pose.x = x;
    pose.y = y;
    pose.z = z;
    pose.yaw = yaw;
    pose.pitch = pitch;
    updateMarker();
    updateCamera();
  },
  onState(nextScene, nextSession, nextCalibrating, nextAudioMuted) {
    session = nextSession;
    calibrating = nextCalibrating;
    audioMuted = nextAudioMuted;
    loadScene(nextScene);
    const phase = calibrating ? '校准中' : session ? '训练中' : '待机';
    setStatus(`${phase}，${audioMuted ? '声音关' : '声音开'}`);
  },
  onBleState(state) {
    if (state === 'ready') {
      setStatus(auth ? '平板控制中，实时姿态' : '已连接，等待接管');
    } else if (state === 'scanning') {
      setStatus('扫描头显…');
    } else if (state === 'connecting') {
      setStatus('连接头显…');
    } else if (state === 'authenticating') {
      setStatus('验证控制码…');
    } else if (state === 'error') {
      setStatus('连接失败', true);
    } else if (state === 'disconnected') {
      setStatus('头显已断开', true);
    }
  },
  onAuth(ok) {
    auth = ok;
    setStatus(ok ? '平板控制中，实时姿态' : '未获得控制权', !ok);
  },
  setViewMode(mode) {
    viewMode = mode;
    updateMarker();
    updateCamera();
  }
};

function resize(): void {
  const width = Math.max(1, viewport.clientWidth);
  const height = Math.max(1, viewport.clientHeight);
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}

window.addEventListener('resize', resize);
if (typeof ResizeObserver !== 'undefined') {
  new ResizeObserver(resize).observe(viewport);
}
resize();

let dragging = false;
let lastX = 0;
let lastY = 0;
const pointers = new Map<number, { x: number; y: number }>();
let pinchDistance = 0;

renderer.domElement.addEventListener('pointerdown', (event) => {
  if (viewMode !== 'global') return;
  renderer.domElement.setPointerCapture(event.pointerId);
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  if (pointers.size === 1) {
    dragging = true;
    lastX = event.clientX;
    lastY = event.clientY;
  } else if (pointers.size === 2) {
    pinchDistance = pointerDistance();
  }
});

renderer.domElement.addEventListener('pointermove', (event) => {
  if (viewMode !== 'global') return;
  if (!pointers.has(event.pointerId)) return;
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  if (pointers.size >= 2) {
    const distance = pointerDistance();
    if (pinchDistance > 0) {
      orbit.distance = THREE.MathUtils.clamp(orbit.distance * (pinchDistance / distance), 1.8, 10);
    }
    pinchDistance = distance;
    updateCamera();
    return;
  }
  if (!dragging) return;
  const dx = event.clientX - lastX;
  const dy = event.clientY - lastY;
  lastX = event.clientX;
  lastY = event.clientY;
  orbit.yaw -= dx * 0.008;
  orbit.pitch = THREE.MathUtils.clamp(orbit.pitch + dy * 0.006, 0.08, 1.25);
  updateCamera();
});

function endPointer(event: PointerEvent): void {
  pointers.delete(event.pointerId);
  if (pointers.size === 0) {
    dragging = false;
    pinchDistance = 0;
  } else if (pointers.size === 1) {
    const remaining = pointers.values().next().value;
    if (remaining) {
      lastX = remaining.x;
      lastY = remaining.y;
    }
    dragging = true;
    pinchDistance = 0;
  }
}

function pointerDistance(): number {
  const values = Array.from(pointers.values());
  if (values.length < 2) return 0;
  return Math.hypot(values[0].x - values[1].x, values[0].y - values[1].y);
}

renderer.domElement.addEventListener('pointerup', endPointer);
renderer.domElement.addEventListener('pointercancel', endPointer);
renderer.domElement.addEventListener('wheel', (event) => {
  if (viewMode !== 'global') return;
  event.preventDefault();
  orbit.distance = THREE.MathUtils.clamp(orbit.distance + event.deltaY * 0.0025, 1.8, 10);
  updateCamera();
}, { passive: false });

loadScene(sceneId);
updateMarker();
updateCamera();
setStatus('等待头显数据');

let lastFrame = 0;
function frame(now: number): void {
  const dt = lastFrame === 0 ? 0.016 : Math.min(0.1, (now - lastFrame) / 1000);
  lastFrame = now;
  host.update(dt);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Desktop/browser preview: animate a patient so the world view can be
// inspected without a headset. The Android bridge is injected before load.
window.setTimeout(() => {
  if (window.QuietShoreBridge) return;
  let demo = 0;
  window.setInterval(() => {
    demo += 0.016;
    window.qsControl.onTelemetry(
      Math.sin(demo * 0.36) * 0.35,
      1.6,
      0.4 + Math.cos(demo * 0.28) * 0.2,
      Math.sin(demo * 0.5) * 0.55,
      Math.sin(demo * 0.23) * 0.06
    );
    window.qsControl.onState(sceneId, true, false, false);
  }, 80);
}, 700);
