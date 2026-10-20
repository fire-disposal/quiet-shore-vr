import * as THREE from 'three';

export interface PostureCueState {
  enabled: boolean;
  intensity: number;
  progress: number;
  visible: boolean;
  count: number;
}

export interface PostureCueApi {
  readonly object: THREE.Points;
  setEnabled(enabled: boolean): void;
  setIntensity(intensity: number): void;
  update(dt: number, progress: number, head: THREE.Vector3): void;
  getState(): PostureCueState;
  dispose(): void;
}

export interface PostureCueOptions {
  scene: THREE.Scene;
  /** 20–40 near-field motes; fixed count so update() never allocates. */
  count?: number;
}

const COUNT_DEFAULT = 28;
const SPAN_Y = 1.35;
const MIN_Y = -0.62;
const SIZE = 0.018;

/**
 * Near-field downward motes for the virtual-rise illusion. The layer follows
 * the head but lives in world space, so comfort rotation and view translation
 * never move the particles with the scene. It is intentionally scene-scoped:
 * only the landscape installs it for now.
 */
export function createPostureCue(options: PostureCueOptions): PostureCueApi {
  const count = Math.max(20, Math.min(40, options.count ?? COUNT_DEFAULT));
  const positions = new Float32Array(count * 3);
  const speeds = new Float32Array(count);
  const drift = new Float32Array(count * 2);

  for (let i = 0; i < count; i += 1) {
    const angle = (i / count) * Math.PI * 2 + Math.random() * 0.6;
    const radius = 0.22 + Math.random() * 0.48;
    positions[i * 3] = Math.cos(angle) * radius;
    positions[i * 3 + 1] = MIN_Y + Math.random() * SPAN_Y;
    positions[i * 3 + 2] = Math.sin(angle) * radius;
    speeds[i] = 0.018 + Math.random() * 0.035;
    drift[i * 2] = (Math.random() - 0.5) * 0.012;
    drift[i * 2 + 1] = (Math.random() - 0.5) * 0.012;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

  // Soft round sprite; in the Node test environment there is no document,
  // so the material falls back to a square point without allocating DOM.
  let sprite: THREE.CanvasTexture | null = null;
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 32;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      const gradient = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
      gradient.addColorStop(0, 'rgba(255,255,255,1)');
      gradient.addColorStop(0.45, 'rgba(255,255,255,.7)');
      gradient.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, 32, 32);
      sprite = new THREE.CanvasTexture(canvas);
      sprite.needsUpdate = true;
    }
  }

  const material = new THREE.PointsMaterial({
    color: 0xdce7dd,
    map: sprite ?? undefined,
    size: SIZE,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  });

  const points = new THREE.Points(geometry, material);
  points.name = 'posture-cue';
  points.frustumCulled = false;
  points.renderOrder = 4;
  points.visible = false;
  options.scene.add(points);

  let enabled = true;
  let intensity = 1;
  let progress = 0;
  let visible = false;
  let disposed = false;

  function setEnabled(next: boolean): void {
    enabled = next;
    if (!enabled) {
      points.visible = false;
      visible = false;
    }
  }

  function setIntensity(next: number): void {
    intensity = Number.isFinite(next) ? Math.max(0, Math.min(1, next)) : 1;
  }

  function update(dt: number, nextProgress: number, head: THREE.Vector3): void {
    if (disposed) return;
    progress = Number.isFinite(nextProgress) ? Math.max(0, Math.min(1, nextProgress)) : 0;
    if (!enabled || intensity <= 0.001) {
      points.visible = false;
      visible = false;
      return;
    }

    // Fade in during the first fifth, out after the fourth fifth.
    const envelope = Math.sin(Math.PI * progress) ** 2;
    const opacity = envelope * intensity * 0.42;
    points.visible = opacity > 0.004;
    visible = points.visible;
    if (!visible) return;

    material.opacity = opacity;
    points.position.copy(head);
    if (!Number.isFinite(dt) || dt <= 0) return;

    const step = Math.min(dt, 0.05);
    for (let i = 0; i < count; i += 1) {
      const y = i * 3 + 1;
      positions[y] -= speeds[i] * intensity * step;
      positions[i * 3] += drift[i * 2] * step;
      positions[i * 3 + 2] += drift[i * 2 + 1] * step;
      if (positions[y] < MIN_Y) {
        positions[y] += SPAN_Y;
        positions[i * 3] = (Math.random() - 0.5) * 0.9;
        positions[i * 3 + 2] = (Math.random() - 0.5) * 0.9;
      }
    }
    (geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
  }

  function getState(): PostureCueState {
    return { enabled, intensity, progress, visible, count };
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    options.scene.remove(points);
    geometry.dispose();
    material.dispose();
    sprite?.dispose();
  }

  return { object: points, setEnabled, setIntensity, update, getState, dispose };
}
