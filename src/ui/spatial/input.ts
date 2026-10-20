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

  private uiLayer = true;
  private sceneLayer = true;
  private focusTarget: RegisteredTarget | null = null;
  private dwell = 0;
  private progress = -1;
  private latched = false;
  private disposed = false;

  constructor(camera: THREE.Camera, scene: THREE.Scene, theme: SpatialTheme = DEFAULT_SPATIAL_THEME) {
    this.camera = camera;
    this.scene = scene;
    this.theme = theme;

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
    this.progress = 0;
    this.latched = true;
    target.interactable.onProgress?.(1);
    target.interactable.onSelect?.();
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
    const scale = this.progress > 0 ? 1 + this.progress * 0.55 : 1;
    this.reticle.scale.setScalar(scale);
  }
}
