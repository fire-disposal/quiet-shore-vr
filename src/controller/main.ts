import * as THREE from 'three';
import { SceneHost } from '../core/scene/host';
import { degToRad } from '../core/xr/angle';
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
  onState(
    scene: string,
    session: boolean,
    calibrating: boolean,
    audioMuted: boolean,
    eyeHeight: number
  ): void;
  onPosture(worldPitchDeg: number, worldRollDeg: number, riseM: number, progress: number): void;
  onBleState(state: string): void;
  onAuth(ok: boolean): void;
  setViewMode(mode: ViewMode): void;
}

interface RecorderBridge {
  recordingStarted?(mimeType: string): void;
  recordingChunk?(base64: string): void;
  recordingFinished?(): void;
  recordingFailed?(message: string): void;
}

interface RecorderApi {
  start(): boolean;
  stop(): void;
  active(): boolean;
}

declare global {
  interface Window {
    qsControl: ControllerApi;
    qsRecorder: RecorderApi;
    QuietShoreBridge?: { send(command: string): void; openFullscreen?: () => void } & RecorderBridge;
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

const pose: Pose = { x: 0, y: 1.7, z: 0.4, yaw: 0, pitch: 0 };
let sceneId = 'landscape';
let viewMode: ViewMode = 'global';
let eyeHeight = 1.7;
let builtEyeHeight = 0;
let session = false;
let calibrating = false;
let audioMuted = false;
let auth = false;
let worldPitchDeg = 0;
let worldRollDeg = 0;
let postureRiseM = 0;
let postureProgress = 0;

const orbit = {
  yaw: Math.PI * 0.22,
  pitch: 0.38,
  distance: 4.4
};

const marker = createPatientMarker();
scene.add(marker);
const target = new THREE.Vector3();

/** Eye height of the schematic bust; arrows must leave the visor, not the crown. */
const MARKER_EYE_Y = 1.55;
const MARKER_EYE_Z = -0.125;

/** Thin unlit ray used for gaze; ArrowHelper's hairline reads poorly at 4 m. */
function createGazeRig(name: string, color: number, length: number, radius: number): THREE.Group {
  const rig = new THREE.Group();
  rig.name = name;
  rig.position.set(0, MARKER_EYE_Y, MARKER_EYE_Z);

  const material = new THREE.MeshBasicMaterial({ color, toneMapped: false });
  const shaft = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, length, 8),
    material
  );
  shaft.rotation.x = -Math.PI / 2;
  shaft.position.z = -length / 2;
  rig.add(shaft);

  const tip = new THREE.Mesh(
    new THREE.ConeGeometry(radius * 4.5, 0.075, 12),
    material
  );
  tip.rotation.x = -Math.PI / 2;
  tip.position.z = -length;
  rig.add(tip);

  return rig;
}

function createPatientMarker(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'patient-marker';

  // Soft ground shadow plus footprint ring: gives the bust a stable anchor.
  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(0.52, 32),
    new THREE.MeshBasicMaterial({
      color: 0x1b2725,
      transparent: true,
      opacity: 0.16,
      depthWrite: false
    })
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.002;
  group.add(shadow);

  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.4, 0.45, 48),
    new THREE.MeshBasicMaterial({
      color: 0xe0bb78,
      transparent: true,
      opacity: 0.62,
      side: THREE.DoubleSide
    })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.012;
  group.add(ring);

  // Small floor chevron marks the patient's forward direction.
  const chevronShape = new THREE.Shape();
  chevronShape.moveTo(0, 0.09);
  chevronShape.lineTo(0.07, -0.04);
  chevronShape.lineTo(0, -0.005);
  chevronShape.lineTo(-0.07, -0.04);
  chevronShape.closePath();
  const chevron = new THREE.Mesh(
    new THREE.ShapeGeometry(chevronShape),
    new THREE.MeshBasicMaterial({ color: 0xe0bb78, transparent: true, opacity: 0.8 })
  );
  chevron.rotation.x = -Math.PI / 2;
  chevron.position.set(0, 0.014, -0.56);
  group.add(chevron);

  const bodyMaterial = new THREE.MeshStandardMaterial({
    color: 0x4f8f84,
    emissive: 0x0e2a26,
    emissiveIntensity: 0.35,
    roughness: 0.72,
    metalness: 0.04
  });

  // Seated bust: rounded torso and shoulders, no stick-figure limbs.
  const torso = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.22, 0.45, 6, 18),
    bodyMaterial
  );
  torso.position.y = 0.98;
  torso.scale.z = 0.78;
  group.add(torso);

  const shoulders = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.085, 0.36, 5, 14),
    bodyMaterial
  );
  shoulders.rotation.z = Math.PI / 2;
  shoulders.position.set(0, 1.35, 0);
  shoulders.scale.z = 0.9;
  group.add(shoulders);

  const neck = new THREE.Mesh(
    new THREE.CylinderGeometry(0.055, 0.062, 0.1, 14),
    new THREE.MeshStandardMaterial({ color: 0xf1dcc0, roughness: 0.8 })
  );
  neck.position.y = 1.43;
  group.add(neck);

  // Head + headset rotate together around the eye line; arrows stay separate
  // so the virtual gaze can lag behind the applied world rotation.
  const head = new THREE.Group();
  head.name = 'patient-head';
  head.position.set(0, MARKER_EYE_Y, 0);
  group.add(head);

  const skull = new THREE.Mesh(
    new THREE.SphereGeometry(0.105, 24, 18),
    new THREE.MeshStandardMaterial({ color: 0xf1dcc0, roughness: 0.78 })
  );
  skull.scale.z = 1.05;
  head.add(skull);

  const shell = new THREE.Mesh(
    new THREE.BoxGeometry(0.25, 0.145, 0.12),
    new THREE.MeshStandardMaterial({
      color: 0x1b2725,
      roughness: 0.5,
      metalness: 0.15
    })
  );
  shell.position.set(0, 0.005, -0.055);
  head.add(shell);

  const visor = new THREE.Mesh(
    new THREE.BoxGeometry(0.2, 0.075, 0.012),
    new THREE.MeshStandardMaterial({
      color: 0x0b1211,
      emissive: 0x0b1211,
      emissiveIntensity: 0.35,
      roughness: 0.25
    })
  );
  visor.position.set(0, 0.005, -0.119);
  head.add(visor);

  const strap = new THREE.Mesh(
    new THREE.TorusGeometry(0.112, 0.012, 8, 28),
    new THREE.MeshStandardMaterial({ color: 0x2a3533, roughness: 0.8 })
  );
  strap.rotation.x = Math.PI / 2;
  strap.position.y = 0.005;
  head.add(strap);

  // Actual gaze (gold) and perceived gaze (teal) leave the same eye point.
  const gaze = createGazeRig('gaze-rig', 0xe0bb78, 0.62, 0.0055);
  group.add(gaze);
  const virtualGaze = createGazeRig('virtual-gaze-rig', 0x7fc8b8, 0.72, 0.0045);
  group.add(virtualGaze);

  const glow = new THREE.PointLight(0x7fc8b8, 0.45, 2.8, 1.8);
  glow.position.set(0, 1.25, 0);
  group.add(glow);

  return group;
}

function updateMarker(): void {
  marker.position.set(pose.x, 0, pose.z);
  marker.rotation.y = pose.yaw;
  // Yaw is the marker body; pitch must show on the head and gaze rays,
  // otherwise the global view looks level while the patient looks up or down.
  const head = marker.getObjectByName('patient-head');
  if (head) {
    head.rotation.x = pose.pitch;
  }
  const gaze = marker.getObjectByName('gaze-rig');
  if (gaze) {
    gaze.rotation.x = pose.pitch;
  }
  const virtualGaze = marker.getObjectByName('virtual-gaze-rig');
  if (virtualGaze) {
    // The base layer applies worldPitchDeg (a measured rotation, not a
    // requested one). Content moves with the world, so the patient's perceived
    // pitch is the head pitch minus it — see docs/rotation-contract.md §4.
    virtualGaze.rotation.x = pose.pitch - degToRad(worldPitchDeg);
    virtualGaze.position.y = MARKER_EYE_Y + postureRiseM;
  }
  marker.visible = viewMode === 'global' && session;
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
  if (!definition) {
    return;
  }
  const eyeHeightChanged = Math.abs(eyeHeight - builtEyeHeight) > 0.005;
  if (nextId === sceneId && host.definition && !eyeHeightChanged) {
    host.setFloorOffset(session ? -eyeHeight : 0);
    return;
  }
  sceneId = definition.id;
  builtEyeHeight = eyeHeight;
  host.load(definition, { quality: 'high', eyeHeight });
  host.setFloorOffset(session ? -eyeHeight : 0);
  scene.add(marker);
  marker.visible = viewMode === 'global' && session;
  label.textContent = `患者场景 ${definition.name.zh}`;
}

/* ---- Recording ------------------------------------------------------- */

/** 8 Mbps keeps the 720p-ish tablet preview crisp without huge files. */
const RECORDING_BITRATE = 8_000_000;
/** One Blob per second bounds MediaRecorder memory on long sessions. */
const RECORDING_TIMESLICE_MS = 1_000;
/** 256 KiB of video per bridge call; 341 KiB after base64. */
const RECORDING_CHUNK_BYTES = 256 * 1024;

// The clip is taken from the WebGL canvas itself, so it is the patient camera
// without the operator overlays. Chunks cross the bridge as base64 because the
// control APK cannot read the WebView's JS heap directly.
let mediaRecorder: MediaRecorder | null = null;

function recordingMimeCandidates(): string[] {
  if (typeof MediaRecorder === 'undefined') return [];
  const candidates = [
    'video/mp4;codecs=avc1.42E01E',
    'video/mp4',
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm'
  ];
  return candidates.filter((candidate) => {
    try {
      return MediaRecorder.isTypeSupported(candidate);
    } catch (error) {
      return false;
    }
  });
}

function recordingError(message: string): boolean {
  mediaRecorder = null;
  window.QuietShoreBridge?.recordingFailed?.(message);
  setStatus(message, true);
  return false;
}

function startRecording(): boolean {
  if (mediaRecorder) {
    // A retry after a dropped bridge event must not start a second encoder.
    window.QuietShoreBridge?.recordingStarted?.(mediaRecorder.mimeType);
    return true;
  }
  // Product demo: the saved clip must show what the patient sees.
  viewMode = 'patient';
  updateMarker();
  updateCamera();

  const canvas = renderer.domElement as HTMLCanvasElement;
  if (typeof canvas.captureStream !== 'function') {
    return recordingError('此 WebView 不支持画面录制');
  }
  const candidates = recordingMimeCandidates();
  if (candidates.length === 0) {
    return recordingError('WebView 缺少视频编码器');
  }
  let stream: MediaStream;
  try {
    stream = canvas.captureStream(30);
  } catch (error) {
    return recordingError('无法捕获三维视图');
  }
  if (stream.getVideoTracks().length === 0) {
    return recordingError('三维视图没有可用画面');
  }
  // Chromium can advertise a container it still refuses to configure (some
  // Android WebViews do this for MP4), so fall back to the next candidate.
  let recorder: MediaRecorder | null = null;
  let mimeType = '';
  for (const candidate of candidates) {
    try {
      recorder = new MediaRecorder(stream, {
        mimeType: candidate,
        videoBitsPerSecond: RECORDING_BITRATE
      });
      mimeType = candidate;
      break;
    } catch (error) {
      recorder = null;
    }
  }
  if (!recorder) {
    stream.getTracks().forEach((track) => track.stop());
    return recordingError('无法启动录制');
  }

  // MediaRecorder slices are not independently playable containers (MP4
  // timeslices start at arbitrary boxes), so keep the parts and concatenate
  // them into one Blob at stop. Product demos are minutes, not hours.
  const parts: Blob[] = [];
  recorder.ondataavailable = (event) => {
    if (event.data && event.data.size > 0) parts.push(event.data);
  };
  recorder.onerror = () => {
    stream.getTracks().forEach((track) => track.stop());
    recordingError('录制中断');
  };
  recorder.onstop = () => {
    stream.getTracks().forEach((track) => track.stop());
    const blob = new Blob(parts, { type: recorder.mimeType || mimeType });
    deliverRecording(blob).catch((error: unknown) => {
      window.QuietShoreBridge?.recordingFailed?.(
        error instanceof Error ? error.message : '保存录像失败'
      );
    });
  };
  try {
    recorder.start(RECORDING_TIMESLICE_MS);
  } catch (error) {
    stream.getTracks().forEach((track) => track.stop());
    return recordingError('无法启动录制');
  }
  mediaRecorder = recorder;
  window.QuietShoreBridge?.recordingStarted?.(mimeType);
  setStatus('录制患者视角中');
  return true;
}

function stopRecording(): void {
  const recorder = mediaRecorder;
  if (!recorder) return;
  mediaRecorder = null;
  try {
    recorder.stop();
  } catch (error) {
    window.QuietShoreBridge?.recordingFailed?.('停止录制失败');
  }
  setStatus('正在保存录像…');
}

async function deliverRecording(blob: Blob): Promise<void> {
  const bridge = window.QuietShoreBridge;
  if (!bridge?.recordingChunk) {
    // Browser preview: hand the clip to the desktop instead of dropping it.
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `quiet-shore-${Date.now()}.${blob.type.includes('mp4') ? 'mp4' : 'webm'}`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
    return;
  }
  if (blob.size === 0) {
    bridge.recordingFailed?.('录像为空');
    return;
  }
  for (let offset = 0; offset < blob.size; offset += RECORDING_CHUNK_BYTES) {
    const slice = blob.slice(offset, offset + RECORDING_CHUNK_BYTES);
    const base64 = await blobToBase64(slice);
    bridge.recordingChunk(base64);
    // Let the bridge drain and the WebView paint between slices.
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
  }
  bridge.recordingFinished?.();
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error('读取录像失败'));
    reader.readAsDataURL(blob);
  });
}

window.qsRecorder = {
  start: startRecording,
  stop: stopRecording,
  active: () => mediaRecorder !== null
};

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
  onState(nextScene, nextSession, nextCalibrating, nextAudioMuted, nextEyeHeight) {
    session = nextSession;
    calibrating = nextCalibrating;
    audioMuted = nextAudioMuted;
    if (Number.isFinite(nextEyeHeight)) {
      eyeHeight = Math.min(1.9, Math.max(1.2, nextEyeHeight));
    }
    loadScene(nextScene);
    host.setFloorOffset(session ? -eyeHeight : 0);
    updateMarker();
    const legend = document.getElementById('view-legend');
    if (legend) {
      legend.hidden = !session;
    }
    const phase = calibrating ? '校准中' : session ? '训练中' : '待机';
    setStatus(`${phase}，${audioMuted ? '声音关' : '声音开'}`);
  },
  onPosture(pitchDeg, rollDeg, riseM, progress) {
    if (![pitchDeg, rollDeg, riseM, progress].every(Number.isFinite)) {
      return;
    }
    worldPitchDeg = pitchDeg;
    worldRollDeg = rollDeg;
    postureRiseM = riseM;
    postureProgress = progress;
    updateMarker();
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
    } else if (state === 'reconnecting') {
      setStatus('正在重连头显…');
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
let tapStartedAt = 0;
let tapStartX = 0;
let tapStartY = 0;
const pointers = new Map<number, { x: number; y: number }>();
let pinchDistance = 0;

renderer.domElement.addEventListener('pointerdown', (event) => {
  tapStartedAt = performance.now();
  tapStartX = event.clientX;
  tapStartY = event.clientY;
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
  const isTap = performance.now() - tapStartedAt < 450
    && Math.hypot(event.clientX - tapStartX, event.clientY - tapStartY) < 8;
  if (isTap && viewMode === 'patient') {
    window.QuietShoreBridge?.openFullscreen?.();
  }
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
      1.7,
      0.4 + Math.cos(demo * 0.28) * 0.2,
      Math.sin(demo * 0.5) * 0.55,
      Math.sin(demo * 0.23) * 0.06
    );
    window.qsControl.onState(sceneId, true, false, false, 1.7);
  }, 80);
}, 700);
