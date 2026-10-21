import * as THREE from 'three';

export interface PostureCueState {
  enabled: boolean;
  intensity: number;
  visible: boolean;
  count: number;
  /**
   * Last accepted flow, clamped to 0–1. +1 only while a rising transition is
   * actually moving; 0 at rest, while braking, during a lowering transition
   * and whenever the lease is gone.
   */
  flow: number;
  /** Far-layer separation factor, 0–1. */
  depth: number;
  /** Horizontal radius multiplier for both layers. */
  spread: number;
}

export interface PostureCueApi {
  /** Near layer, kept as the primary object for backwards compatibility. */
  readonly object: THREE.Points;
  /** Near layer first, far layer second. Both are scene-scoped. */
  readonly layers: readonly THREE.Points[];
  setEnabled(enabled: boolean): void;
  setIntensity(intensity: number): void;
  /** 0 pushes the far layer inward, 1 spreads it out. Default 0.5. */
  setDepth(depth: number): void;
  /** 0.5–2 horizontal radius multiplier. Default 1. */
  setSpread(spread: number): void;
  /**
   * `flow` is +1 only while a rising transition is actually moving; any other
   * value (including a lowering transition) freezes the motes in place and
   * fades the cloud out with the existing τ. `progress` only shapes the fade.
   */
  update(dt: number, head: THREE.Vector3, flow: number): void;
  getState(): PostureCueState;
  dispose(): void;
}

export interface PostureCueOptions {
  scene: THREE.Scene;
  /** 20–40 near-field motes; fixed count so update() never allocates. */
  count?: number;
  /** Seed for the deterministic layout. Same seed, same cloud. */
  seed?: number;
}

const COUNT_DEFAULT = 28;
const SEED_DEFAULT = 0x5eed1a;

const NEAR_SHARE = 0.6;
const NEAR_SIZE = 0.0095;
const FAR_SIZE = 0.0075;
/** Kept under the 0.35 comfort bound for near-field additive overlays. */
const NEAR_OPACITY = 0.34;
const FAR_OPACITY = 0.18;
const MIN_ALPHA = 0.004;
const MAX_STEP = 0.05;
/** Descent limiter on the displayed alpha; kills intensity pops. */
const LIT_TAU = 0.15;
/** Peak lateral sway. Sway angular rate stays well under 1 deg/s. */
const SWAY_RAD = 0.045;
const TAU = Math.PI * 2;

interface LayerSpec {
  readonly radiusMin: number;
  readonly radiusMax: number;
  readonly yMin: number;
  readonly ySpan: number;
  readonly speedMin: number;
  readonly speedMax: number;
  readonly size: number;
  readonly opacity: number;
  /** Attack time constant while flow is +1; a restart never pops back on. */
  readonly growTau: number;
  /** Release time constant once flow drops to 0; ~95 % gone in 3τ. */
  readonly fadeTau: number;
}

/**
 * Two radial bands: close bright motes and a slower, dimmer backdrop. The
 * speed limits keep the worst-case angular rate (speed / inner radius) under
 * 10 deg/s, so the near layer never reads as vection.
 */
const NEAR_LAYER: LayerSpec = {
  radiusMin: 0.22,
  radiusMax: 0.46,
  yMin: -0.58,
  ySpan: 0.95,
  speedMin: 0.02,
  speedMax: 0.034,
  size: NEAR_SIZE,
  opacity: NEAR_OPACITY,
  // The near band leads: it arrives first and leaves first.
  growTau: 0.5,
  fadeTau: 0.28
};

const FAR_LAYER: LayerSpec = {
  radiusMin: 0.4,
  radiusMax: 1.1,
  yMin: -0.8,
  ySpan: 1.6,
  speedMin: 0.01,
  speedMax: 0.018,
  size: FAR_SIZE,
  opacity: FAR_OPACITY,
  // The far backdrop lags the near band in and lingers longer on release.
  growTau: 1,
  fadeTau: 0.45
};

interface CueLayer {
  readonly points: THREE.Points;
  readonly geometry: THREE.BufferGeometry;
  readonly material: THREE.PointsMaterial;
  readonly position: THREE.BufferAttribute;
  readonly positions: Float32Array;
  readonly speeds: Float32Array;
  readonly swayRate: Float32Array;
  readonly swayOffset: Float32Array;
  readonly baseX: Float32Array;
  readonly baseZ: Float32Array;
  readonly yMin: number;
  readonly ySpan: number;
  readonly opacity: number;
  readonly growTau: number;
  readonly fadeTau: number;
  /** 0–1 envelope of this layer; rises with flow and decays without it. */
  level: number;
}

/** Small, allocation-free deterministic PRNG (mulberry32). */
function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return function random(): number {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Near-field downward motes for the virtual-rise illusion. The cloud follows
 * the head position but lives in world space, so comfort rotation, the sit-up
 * pose and the operator pitch never drag the particles with the scene. Two
 * concentric layers
 * (near: faster, larger, brighter; far: slower, smaller, dimmer) give the
 * drift a sense of depth without moving the viewpoint. Lateral sway around
 * each mote's seeded column replaces wrap-around drift, so a mote never
 * teleports sideways and the horizontal radius stays fixed. It is
 * intentionally scene-scoped: only the landscape installs it for now.
 */
export function createPostureCue(options: PostureCueOptions): PostureCueApi {
  const count = Math.max(20, Math.min(40, options.count ?? COUNT_DEFAULT));
  const nearCount = Math.max(6, Math.min(count - 6, Math.round(count * NEAR_SHARE)));
  const farCount = count - nearCount;
  const random = createRandom(options.seed ?? SEED_DEFAULT);

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

  function buildLayer(spec: LayerSpec, layerCount: number, renderOrder: number): CueLayer {
    const positions = new Float32Array(layerCount * 3);
    const speeds = new Float32Array(layerCount);
    const swayRate = new Float32Array(layerCount);
    const swayOffset = new Float32Array(layerCount);
    const baseX = new Float32Array(layerCount);
    const baseZ = new Float32Array(layerCount);
    const colors = new Float32Array(layerCount * 3);

    for (let i = 0; i < layerCount; i += 1) {
      const angle = random() * TAU;
      // Area-uniform radius so motes do not clump at the inner edge.
      const radiusT = random();
      const radius = Math.sqrt(
        spec.radiusMin ** 2 + (spec.radiusMax ** 2 - spec.radiusMin ** 2) * radiusT
      );
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      baseX[i] = x;
      baseZ[i] = z;
      positions[i * 3 + 1] = spec.yMin + random() * spec.ySpan;
      speeds[i] = spec.speedMin + (spec.speedMax - spec.speedMin) * random();
      swayOffset[i] = random() * TAU;
      swayRate[i] = 0.15 + random() * 0.2;
      // Start already swayed so the first update does not nudge the cloud.
      const theta = SWAY_RAD * Math.sin(swayOffset[i]);
      positions[i * 3] = x - z * theta;
      positions[i * 3 + 2] = z + x * theta;
      // Per-mote brightness doubles as a per-mote opacity under additive blending.
      const brightness = 0.55 + random() * 0.45;
      colors[i * 3] = brightness;
      colors[i * 3 + 1] = brightness;
      colors[i * 3 + 2] = brightness;
    }

    const geometry = new THREE.BufferGeometry();
    const position = new THREE.BufferAttribute(positions, 3);
    position.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('position', position);
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const material = new THREE.PointsMaterial({
      color: 0xdce7dd,
      map: sprite ?? undefined,
      size: spec.size,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      vertexColors: true,
      blending: THREE.AdditiveBlending
    });

    const points = new THREE.Points(geometry, material);
    points.name = spec === NEAR_LAYER ? 'posture-cue' : 'posture-cue-far';
    points.frustumCulled = false;
    points.renderOrder = renderOrder;
    points.visible = false;

    return {
      points,
      geometry,
      material,
      position,
      positions,
      speeds,
      swayRate,
      swayOffset,
      baseX,
      baseZ,
      yMin: spec.yMin,
      ySpan: spec.ySpan,
      opacity: spec.opacity,
      growTau: spec.growTau,
      fadeTau: spec.fadeTau,
      level: 0
    };
  }

  const near = buildLayer(NEAR_LAYER, nearCount, 4);
  const far = buildLayer(FAR_LAYER, farCount, 3);
  const layers: readonly CueLayer[] = [near, far];
  const points = near.points;
  options.scene.add(points);
  options.scene.add(far.points);

  let enabled = true;
  let flow = 0;
  let intensity = 1;
  let visible = false;
  let depth = 0.5;
  let spread = 1;
  let disposed = false;
  let elapsed = 0;
  // Each layer eases its own envelope: the near band leads, the far one lags
  // in and lingers out. `lit` follows the product with an instant rise and a
  // rate-limited fall, so an intensity change dims over LIT_TAU, never pops.
  let nearLit = 0;
  let farLit = 0;

  function applyForm(): void {
    const farScale = 0.7 + depth * 0.6;
    // Keep the far band inside the near-field boundary even at max knobs.
    const farHorizontal = Math.min(
      spread * farScale,
      1.5 / FAR_LAYER.radiusMax
    );
    points.scale.set(spread, 1, spread);
    far.points.scale.set(farHorizontal, farScale, farHorizontal);
  }
  applyForm();

  function setEnabled(next: boolean): void {
    enabled = next;
  }

  function setIntensity(next: number): void {
    intensity = Number.isFinite(next) ? Math.max(0, Math.min(1, next)) : 1;
  }

  function setDepth(next: number): void {
    depth = Number.isFinite(next) ? Math.max(0, Math.min(1, next)) : 0.5;
    applyForm();
  }

  function setSpread(next: number): void {
    spread = Number.isFinite(next) ? Math.max(0.5, Math.min(2, next)) : 1;
    applyForm();
  }

  function stepLayer(layer: CueLayer, dt: number, time: number, motion: number): void {
    const positions = layer.positions;
    const speeds = layer.speeds;
    const swayRate = layer.swayRate;
    const swayOffset = layer.swayOffset;
    const baseX = layer.baseX;
    const baseZ = layer.baseZ;
    const length = speeds.length;

    for (let i = 0; i < length; i += 1) {
      const y = i * 3 + 1;
      positions[y] -= speeds[i] * motion * dt;
      if (positions[y] < layer.yMin) positions[y] += layer.ySpan;

      // Sway rotates the seeded column in place: bounded, radius-preserving
      // and continuous across a vertical wrap. The small-angle linearisation
      // (cos t ~ 1, sin t ~ t) is exact enough at SWAY_RAD and saves trig.
      const theta = SWAY_RAD * Math.sin(time * swayRate[i] + swayOffset[i]);
      const bx = baseX[i];
      const bz = baseZ[i];
      positions[i * 3] = bx - bz * theta;
      positions[i * 3 + 2] = bz + bx * theta;
    }
    layer.position.needsUpdate = true;
  }

  function update(dt: number, head: THREE.Vector3, nextFlow: number): void {
    if (disposed) return;
    // Negative flow is reserved for a future descent cue and reads as 0 here:
    // lowering must never produce downward flow.
    flow = Number.isFinite(nextFlow) ? Math.max(0, Math.min(1, nextFlow)) : 0;
    // `cue:off` fades the cloud out even while the posture keeps rising.
    const rising = enabled && flow > 0;

    const fadeDt = Number.isFinite(dt) && dt > 0 ? dt : 0;
    if (fadeDt > 0) {
      easeLevel(near, rising, fadeDt);
      easeLevel(far, rising, fadeDt);
    } else {
      // dt 0 is a hard reset, which is what teardown and scene swaps want.
      near.level = rising ? 1 : 0;
      far.level = rising ? 1 : 0;
    }

    const nearTarget = near.level * intensity * near.opacity;
    const farTarget = far.level * intensity * far.opacity;
    const ease = fadeDt > 0 ? Math.exp(-fadeDt / LIT_TAU) : 0;
    nearLit = nearTarget < nearLit ? nearTarget + (nearLit - nearTarget) * ease : nearTarget;
    farLit = farTarget < farLit ? farTarget + (farLit - farTarget) * ease : farTarget;

    near.material.opacity = nearLit;
    far.material.opacity = farLit;
    const nearVisible = nearLit > MIN_ALPHA;
    const farVisible = farLit > MIN_ALPHA;
    points.visible = nearVisible;
    far.points.visible = farVisible;
    visible = nearVisible || farVisible;
    if (!visible) return;

    points.position.copy(head);
    far.points.position.copy(head);
    // Flow 0 freezes the motes exactly where they are: no vertical advance and
    // no sway while the cloud fades out with the existing τ.
    if (fadeDt === 0 || !rising) return;

    const step = Math.min(fadeDt, MAX_STEP);
    elapsed += step;
    stepLayer(near, step, elapsed, flow * near.level);
    stepLayer(far, step, elapsed, flow * far.level);
  }

  /** One exponential envelope per band; the far band uses longer τs. */
  function easeLevel(layer: CueLayer, rising: boolean, dt: number): void {
    const target = rising ? 1 : 0;
    const tau = rising ? layer.growTau : layer.fadeTau;
    layer.level += (target - layer.level) * (1 - Math.exp(-dt / tau));
  }

  function getState(): PostureCueState {
    return { enabled, flow, intensity, visible, count, depth, spread };
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    for (let i = 0; i < layers.length; i += 1) {
      options.scene.remove(layers[i].points);
      layers[i].geometry.dispose();
      layers[i].material.dispose();
    }
    sprite?.dispose();
  }

  return {
    object: points,
    layers: [points, far.points],
    setEnabled,
    setIntensity,
    setDepth,
    setSpread,
    update,
    getState,
    dispose
  };
}
