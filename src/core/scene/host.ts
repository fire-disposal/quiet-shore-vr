import * as THREE from 'three';
import type { SceneBuildContext, SceneDefinition, SceneHandle } from './contract';
import { ResourceRegistry } from '../geometry/registry';

export interface SceneHostOptions {
  /** Shared resource registry; created when omitted. */
  registry?: ResourceRegistry;
}

const NO_SELECTABLES: THREE.Object3D[] = [];

/**
 * Owns the single live THREE.Scene and swaps scene definitions in and out.
 *
 * Loading builds the new scene first: a throw from `build` leaves the current
 * scene, its settings and its resources untouched. Content lives under
 * `content`, a child group that carries the floor offset, so a scene never
 * needs to mutate the host scene itself. Callers may re-parent
 * `handle.root` (for example into a comfort wrapper); `unload` detaches it
 * from wherever it currently lives instead of assuming the host scene.
 */
export class SceneHost {
  readonly scene: THREE.Scene;
  readonly registry: ResourceRegistry;
  readonly content: THREE.Group;

  private current: SceneHandle | null = null;
  private currentDefinition: SceneDefinition | null = null;
  private readonly baselineBackground: THREE.Color | THREE.Texture | null;
  private readonly baselineFog: THREE.FogBase | null;
  private floorOffset = 0;
  private elapsed = 0;

  constructor(scene: THREE.Scene = new THREE.Scene(), options: SceneHostOptions = {}) {
    this.scene = scene;
    this.registry = options.registry ?? new ResourceRegistry();
    this.content = new THREE.Group();
    this.content.name = 'scene-content';
    this.scene.add(this.content);
    this.baselineBackground = this.scene.background;
    this.baselineFog = this.scene.fog;
  }

  get definition(): SceneDefinition | null {
    return this.currentDefinition;
  }

  get handle(): SceneHandle | null {
    return this.current;
  }

  get selectables(): THREE.Object3D[] {
    return this.current ? this.current.selectables : NO_SELECTABLES;
  }

  get floor(): number {
    return this.floorOffset;
  }

  /**
   * Build `def` and swap it in. The old scene is disposed only after the new
   * one is live, so shared registry resources survive the switch.
   *
   * The host injects its registry so resource ownership stays single-source;
   * a scene states its own eye (`SceneDefinition.eyeY`) instead of receiving a
   * height from the caller.
   */
  load(def: SceneDefinition): SceneHandle {
    const handle = def.build({ registry: this.registry });

    const previous = this.current;
    if (previous) previous.root.removeFromParent();

    this.current = handle;
    this.currentDefinition = def;
    this.elapsed = 0;
    this.content.add(handle.root);
    this.scene.background = handle.settings.background;
    this.scene.fog = handle.settings.fog;

    if (previous) previous.dispose();
    return handle;
  }

  /** Tear down the live scene and restore the host's original settings. */
  unload(): void {
    const previous = this.current;
    if (!previous) return;
    this.current = null;
    this.currentDefinition = null;
    // The caller may have wrapped the root in a comfort group and disposed
    // that wrapper already, so detach from whatever parent remains (or none).
    previous.root.removeFromParent();
    try {
      previous.dispose();
    } finally {
      this.scene.background = this.baselineBackground;
      this.scene.fog = this.baselineFog;
    }
  }

  /** `elapsed` may be supplied by the app loop; otherwise it accumulates here. */
  update(dt: number, elapsed?: number): void {
    this.elapsed = elapsed === undefined ? this.elapsed + dt : elapsed;
    if (this.current) this.current.update(dt, this.elapsed);
  }

  /** Lift scene content so its eye sits where the frame's eye is. */
  setFloorOffset(y: number): void {
    this.setContentPosition(this.content.position.x, y, this.content.position.z);
  }

  /**
   * Place the whole art at a content-space offset. Y is reported through
   * `floor` for telemetry; X/Z exist because a supine frame's heave does not
   * run along Y (see `core/xr/world-frame.ts`).
   */
  setContentPosition(x: number, y: number, z: number): void {
    this.floorOffset = y;
    this.content.position.set(
      Number.isFinite(x) ? x : 0,
      Number.isFinite(y) ? y : 0,
      Number.isFinite(z) ? z : 0
    );
  }

  dispose(): void {
    this.unload();
    this.registry.disposeAll();
    this.scene.remove(this.content);
    this.scene.background = this.baselineBackground;
    this.scene.fog = this.baselineFog;
  }
}
