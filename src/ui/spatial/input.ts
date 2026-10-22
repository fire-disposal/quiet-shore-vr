import * as THREE from 'three';
import type { SpatialTheme } from '../../core/spatial/theme';
import { DEFAULT_SPATIAL_THEME } from '../../core/spatial/theme';
import type { HeadPose } from '../../core/xr/types';
import type { SpatialInteractable, SpatialLayer } from '../../core/spatial/types';

/** Nothing beyond this distance is focusable; 3DoF gaze gets imprecise far away. */
const MAX_RAY_DISTANCE = 12;
const RETICLE_ORDER = 4000;
/** Push the reticle slightly toward the eye so it never sits inside the target. */
const RETICLE_OFFSET = 0.012;
/** Guard against tab-restore spikes triggering a dwell instantly. */
const MAX_DWELL_STEP = 0.25;
/** Dwell ring: large enough to read at arm's length, small enough not to hide UI. */
const ARC_INNER = 0.026;
const ARC_OUTER = 0.034;
/** Sprite hint sits below the dwell ring, clear of the target label. */
const HINT_OFFSET = 0.168;
const HINT_WIDTH = 0.38;
const HINT_HEIGHT = 0.092;
/** Default Chinese hint; the app can pass a localized string. */
const DEFAULT_HINT = '保持注视以选择';

const EMPTY_HITS: THREE.Intersection[] = [];

interface RegisteredTarget {
  readonly interactable: SpatialInteractable;
  readonly layer: SpatialLayer;
  readonly object: THREE.Object3D;
  /** False while this target's layer is muted (for example, a closed menu). */
  active: boolean;
}

export interface SpatialInputLayers {
  ui: boolean;
  scene: boolean;
}

/**
 * The single gaze input for spatial UI and scenes.
 *
 * One raycaster, one reticle, one focus. UI targets always win over scene
 * targets regardless of depth, so a panel can never be occluded by scenery.
 * Dwell accumulates only while a target stays focused; `select()` is the
 * explicit confirmation path for 3DoF controllers.
 */
export class SpatialInput {
  /** The only reticle in the app. Owned and disposed by this class. */
  readonly reticle: THREE.Mesh;

  private readonly camera: THREE.Camera;
  private readonly scene: THREE.Scene;
  private readonly theme: SpatialTheme;

  private readonly raycaster = new THREE.Raycaster();
  private readonly registered: RegisteredTarget[] = [];
  private readonly byObject = new Map<THREE.Object3D, RegisteredTarget>();
  /** Flattened raycast list; rebuilt only when registration or layers change. */
  private readonly targets: THREE.Object3D[] = [];

  private readonly origin = new THREE.Vector3();
  private readonly direction = new THREE.Vector3();
  private readonly headQuaternion = new THREE.Quaternion();
  private readonly lookProbe = new THREE.Object3D();

  private readonly reticleGeometry: THREE.RingGeometry;
  private readonly reticleMaterial: THREE.MeshBasicMaterial;
  private readonly arcGeometry: THREE.RingGeometry;
  private readonly arcMaterial: THREE.ShaderMaterial;
  private readonly arc: THREE.Mesh;
  private readonly trackGeometry: THREE.RingGeometry;
  private readonly trackMaterial: THREE.MeshBasicMaterial;
  private readonly track: THREE.Mesh;
  private readonly hintText: string;
  private readonly hintOffset = new THREE.Vector3();
  private hint: THREE.Sprite | null = null;
  private hintTexture: THREE.CanvasTexture | null = null;
  private hintMaterial: THREE.SpriteMaterial | null = null;

  private uiLayer = true;
  private sceneLayer = true;
  private focusTarget: RegisteredTarget | null = null;
  private dwell = 0;
  private progress = -1;
  private latched = false;
  private disposed = false;

  constructor(
    camera: THREE.Camera,
    scene: THREE.Scene,
    theme: SpatialTheme = DEFAULT_SPATIAL_THEME,
    hintText: string = DEFAULT_HINT
  ) {
    this.camera = camera;
    this.scene = scene;
    this.theme = theme;
    this.hintText = hintText;

    this.raycaster.far = MAX_RAY_DISTANCE;

    this.reticleGeometry = new THREE.RingGeometry(0.0085, 0.012, 32);
    this.reticleMaterial = new THREE.MeshBasicMaterial({
      color: theme.focus,
      transparent: true,
      opacity: 0.92,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false
    });
    this.reticle = new THREE.Mesh(this.reticleGeometry, this.reticleMaterial);
    this.reticle.name = 'spatial-reticle';
    this.reticle.renderOrder = RETICLE_ORDER;
    this.reticle.visible = false;
    this.reticle.frustumCulled = false;
    this.reticle.matrixAutoUpdate = true;
    scene.add(this.reticle);

    // A shader arc fills clockwise while the gaze stays on a dwell target.
    this.arcGeometry = new THREE.RingGeometry(ARC_INNER, ARC_OUTER, 48, 1);
    this.arcMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uProgress: { value: 0 },
        uColor: { value: new THREE.Color(theme.accentText) }
      },
      vertexShader: [
        'varying vec2 vUv;',
        'void main() {',
        '  vUv = uv;',
        '  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
        '}'
      ].join('\n'),
      fragmentShader: [
        'varying vec2 vUv;',
        'uniform float uProgress;',
        'uniform vec3 uColor;',
        'void main() {',
        '  vec2 p = vUv - vec2(0.5);',
        '  float angle = atan(p.x, p.y);',
        '  if (angle < 0.0) angle += 6.28318530718;',
        '  if (angle / 6.28318530718 > uProgress) discard;',
        '  gl_FragColor = vec4(uColor, 1.0);',
        '}'
      ].join('\n'),
      transparent: true,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false
    });
    this.arc = new THREE.Mesh(this.arcGeometry, this.arcMaterial);
    this.arc.name = 'spatial-reticle-dwell';
    this.arc.renderOrder = RETICLE_ORDER + 1;
    this.arc.visible = false;
    this.arc.frustumCulled = false;
    scene.add(this.arc);

    // Dark track keeps the light arc readable on both panels and scenery.
    this.trackGeometry = new THREE.RingGeometry(ARC_INNER - 0.002, ARC_OUTER + 0.002, 48, 1);
    this.trackMaterial = new THREE.MeshBasicMaterial({
      color: 0x20251f,
      transparent: true,
      opacity: 0.38,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false
    });
    this.track = new THREE.Mesh(this.trackGeometry, this.trackMaterial);
    this.track.name = 'spatial-reticle-dwell-track';
    this.track.renderOrder = RETICLE_ORDER;
    this.track.visible = false;
    this.track.frustumCulled = false;
    scene.add(this.track);
  }

  /** Registers a target and returns an idempotent unregister function. */
  register(interactable: SpatialInteractable): () => void {
    const existing = this.byObject.get(interactable.object);
    if (existing) {
      return () => this.unregister(existing);
    }

    const target: RegisteredTarget = {
      interactable,
      layer: interactable.layer ?? 'ui',
      object: interactable.object,
      active: (interactable.layer ?? 'ui') === 'ui' ? this.uiLayer : this.sceneLayer
    };
    this.registered.push(target);
    this.byObject.set(target.object, target);
    this.rebuildTargets();
    return () => this.unregister(target);
  }

  /** Mutes/unmutes whole layers. Used by overlays that take over the gaze. */
  setLayers(ui: boolean, scene: boolean): void {
    if (this.uiLayer === ui && this.sceneLayer === scene) {
      return;
    }
    this.uiLayer = ui;
    this.sceneLayer = scene;
    for (let i = 0; i < this.registered.length; i += 1) {
      const target = this.registered[i];
      target.active = target.layer === 'ui' ? this.uiLayer : this.sceneLayer;
    }
    if (this.focusTarget && !this.focusTarget.active) {
      this.clearFocus();
    }
    this.rebuildTargets();
  }

  getLayers(): SpatialInputLayers {
    return { ui: this.uiLayer, scene: this.sceneLayer };
  }

  /** Interactable currently under the gaze, or null. */
  getFocused(): SpatialInteractable | null {
    return this.focusTarget ? this.focusTarget.interactable : null;
  }

  /** Dwell progress of the focused target, 0..1 (0 when not dwelling). */
  getProgress(): number {
    return this.progress > 0 ? this.progress : 0;
  }

  /** Target object currently under the gaze, or null. */
  get focusObject(): THREE.Object3D | null {
    return this.focusTarget ? this.focusTarget.object : null;
  }

  /**
   * One raycast per frame. `head` is the XR head pose; without it the camera
   * transform is used (2D preview / tests).
   */
  update(dt: number, now: number, head?: HeadPose | null): void {
    void now;
    if (this.disposed) {
      return;
    }

    if (head) {
      this.origin.copy(head.position);
      this.direction.set(0, 0, -1).applyQuaternion(head.quaternion);
    } else {
      this.camera.updateMatrixWorld();
      this.camera.getWorldPosition(this.origin);
      this.camera.getWorldQuaternion(this.headQuaternion);
      this.direction.set(0, 0, -1).applyQuaternion(this.headQuaternion);
    }
    this.direction.normalize();

    const ray = this.raycaster.ray;
    ray.origin.copy(this.origin);
    ray.direction.copy(this.direction);

    const hits = this.targets.length > 0 ? this.raycaster.intersectObjects(this.targets, true) : EMPTY_HITS;

    let uiHit: THREE.Intersection | null = null;
    let uiEntry: RegisteredTarget | null = null;
    let sceneHit: THREE.Intersection | null = null;
    let sceneEntry: RegisteredTarget | null = null;

    for (let i = 0; i < hits.length; i += 1) {
      const hit = hits[i];
      const entry = this.resolveEntry(hit.object);
      if (!entry) {
        continue;
      }
      if (entry.layer === 'ui') {
        if (!uiHit) {
          uiHit = hit;
          uiEntry = entry;
        }
      } else if (!sceneHit) {
        sceneHit = hit;
        sceneEntry = entry;
      }
      if (uiHit && sceneHit) {
        break;
      }
    }

    const entry = uiEntry ?? sceneEntry;
    const hit = uiEntry ? uiHit : sceneHit;

    this.setFocus(entry, dt);
    this.positionReticle(hit);
    this.syncDwellFeedback();
  }

  /**
   * Confirmation button (3DoF controller). Activates the focused target
   * immediately and resets its dwell so it cannot fire twice.
   */
  select(): void {
    const target = this.focusTarget;
    if (this.disposed || !target || target.interactable.enabled === false) {
      return;
    }
    this.dwell = 0;
    this.progress = 1;
    this.latched = true;
    const ring = target.interactable.progressDisplay !== 'self';
    this.arcMaterial.uniforms.uProgress.value = 1;
    this.arc.visible = ring && this.reticle.visible;
    this.track.visible = ring && this.reticle.visible;
    target.interactable.onProgress?.(1);
    target.interactable.onSelect?.();
    this.syncDwellFeedback();
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.clearFocus();
    this.registered.length = 0;
    this.byObject.clear();
    this.targets.length = 0;
    this.scene.remove(this.reticle);
    this.reticleGeometry.dispose();
    this.reticleMaterial.dispose();
    this.scene.remove(this.arc);
    this.arcGeometry.dispose();
    this.arcMaterial.dispose();
    this.scene.remove(this.track);
    this.trackGeometry.dispose();
    this.trackMaterial.dispose();
    if (this.hint) {
      this.scene.remove(this.hint);
      this.hint = null;
    }
    this.hintTexture?.dispose();
    this.hintTexture = null;
    this.hintMaterial?.dispose();
    this.hintMaterial = null;
  }

  private unregister(target: RegisteredTarget): void {
    const index = this.registered.indexOf(target);
    if (index < 0) {
      return;
    }
    this.registered.splice(index, 1);
    this.byObject.delete(target.object);
    if (this.focusTarget === target) {
      this.clearFocus();
    }
    this.rebuildTargets();
  }

  private rebuildTargets(): void {
    this.targets.length = 0;
    for (let i = 0; i < this.registered.length; i += 1) {
      const target = this.registered[i];
      if (target.active) {
        this.targets.push(target.object);
      }
    }
  }

  /** Walks up to the registered owner and rejects hidden or disabled subtrees. */
  private resolveEntry(object: THREE.Object3D): RegisteredTarget | null {
    let node: THREE.Object3D | null = object;
    let entry: RegisteredTarget | null = null;
    while (node) {
      if (!entry) {
        const candidate = this.byObject.get(node);
        if (candidate) {
          entry = candidate;
        }
      }
      node = node.parent;
    }
    if (!entry || !entry.active || entry.interactable.enabled === false) {
      return null;
    }
    node = object;
    while (node) {
      if (!node.visible) {
        return null;
      }
      node = node.parent;
    }
    return entry;
  }

  private setFocus(entry: RegisteredTarget | null, dt: number): void {
    if (entry !== this.focusTarget) {
      if (this.focusTarget) {
        this.focusTarget.interactable.onFocus?.(false);
        this.focusTarget.interactable.onProgress?.(0);
      }
      this.focusTarget = entry;
      this.dwell = 0;
      this.progress = 0;
      this.latched = false;
      if (entry) {
        entry.interactable.onFocus?.(true);
        entry.interactable.onProgress?.(0);
        this.reticleMaterial.color.set(this.theme.accent);
      } else {
        this.reticleMaterial.color.set(this.theme.focus);
      }
    }

    if (!entry || this.latched) {
      return;
    }

    const dwellTime = entry.interactable.dwellTime ?? 0;
    if (!(dwellTime > 0)) {
      return;
    }

    const step = dt > MAX_DWELL_STEP ? MAX_DWELL_STEP : dt > 0 ? dt : 0;
    this.dwell += step;
    const progress = this.dwell >= dwellTime ? 1 : this.dwell / dwellTime;
    if (progress !== this.progress) {
      this.progress = progress;
      entry.interactable.onProgress?.(progress);
    }
    if (progress >= 1) {
      this.latched = true;
      entry.interactable.onSelect?.();
    }
  }

  private clearFocus(): void {
    const target = this.focusTarget;
    if (target) {
      target.interactable.onFocus?.(false);
      target.interactable.onProgress?.(0);
    }
    this.focusTarget = null;
    this.dwell = 0;
    this.progress = 0;
    this.latched = false;
    if (this.reticle) {
      this.reticle.visible = false;
    }
    this.arc.visible = false;
    this.track.visible = false;
    this.arcMaterial.uniforms.uProgress.value = 0;
    this.reticleMaterial.opacity = 0.92;
    if (this.hint) {
      this.hint.visible = false;
    }
  }

  private positionReticle(hit: THREE.Intersection | null): void {
    if (!hit) {
      this.reticle.visible = false;
      return;
    }
    this.reticle.visible = true;
    this.reticle.position.copy(hit.point).addScaledVector(this.direction, -RETICLE_OFFSET);
    this.lookProbe.position.copy(this.reticle.position);
    this.lookProbe.lookAt(this.origin);
    this.reticle.quaternion.copy(this.lookProbe.quaternion);
    const scale = this.progress > 0 ? 1 + this.progress * 0.35 : 1;
    this.reticle.scale.setScalar(scale);

    this.arc.position.copy(this.reticle.position);
    this.arc.quaternion.copy(this.reticle.quaternion);
    this.track.position.copy(this.reticle.position);
    this.track.quaternion.copy(this.reticle.quaternion);
  }

  /** Keeps the arc and the instructional sprite in sync with focus/dwell. */
  private syncDwellFeedback(): void {
    const dwelling = this.focusTarget !== null &&
      this.reticle.visible &&
      (this.focusTarget.interactable.dwellTime ?? 0) > 0;
    const selfDrawn = dwelling &&
      (this.focusTarget?.interactable.progressDisplay ?? 'reticle') === 'self';
    const ring = dwelling && !selfDrawn;
    // Buttons already show focus through their fill; a dot over the label
    // just obscures the words.
    this.reticleMaterial.opacity = selfDrawn ? 0 : 0.92;
    this.track.visible = ring;
    this.arc.visible = ring && this.progress > 0.001;
    this.arcMaterial.uniforms.uProgress.value = this.progress;

    if (!dwelling) {
      if (this.hint) {
        this.hint.visible = false;
      }
      return;
    }
    this.ensureHint();
    const hint = this.hint;
    if (!hint) {
      return;
    }
    // Far scene targets would make the label unreadable; the arc still shows.
    const readable = this.origin.distanceTo(this.reticle.position) <= 4;
    hint.visible = !this.latched && readable;
    if (!hint.visible) {
      return;
    }
    this.hintOffset.set(0, -HINT_OFFSET, 0).applyQuaternion(this.reticle.quaternion);
    hint.position.copy(this.reticle.position).add(this.hintOffset);
  }

  /** Created on first use so headless tests never need a DOM canvas. */
  private ensureHint(): void {
    if (this.hint || typeof document === 'undefined') {
      return;
    }
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return;
    }
    ctx.clearRect(0, 0, 512, 128);
    const radius = 28;
    ctx.beginPath();
    ctx.moveTo(18 + radius, 16);
    ctx.arcTo(494, 16, 494, 112, radius);
    ctx.arcTo(494, 112, 18, 112, radius);
    ctx.arcTo(18, 112, 18, 16, radius);
    ctx.arcTo(18, 16, 494, 16, radius);
    ctx.closePath();
    ctx.fillStyle = 'rgba(32, 37, 31, 0.86)';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = this.theme.accent;
    ctx.stroke();
    ctx.fillStyle = '#f8f3e9';
    ctx.font = `600 48px ${this.theme.fontFamily}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(this.hintText, 256, 65);

    this.hintTexture = new THREE.CanvasTexture(canvas);
    this.hintTexture.colorSpace = THREE.SRGBColorSpace;
    this.hintMaterial = new THREE.SpriteMaterial({
      map: this.hintTexture,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      toneMapped: false
    });
    this.hint = new THREE.Sprite(this.hintMaterial);
    this.hint.name = 'spatial-dwell-hint';
    this.hint.scale.set(HINT_WIDTH, HINT_HEIGHT, 1);
    this.hint.renderOrder = RETICLE_ORDER + 2;
    this.hint.visible = false;
    this.scene.add(this.hint);
  }
}
