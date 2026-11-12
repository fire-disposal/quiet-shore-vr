import * as THREE from 'three';
import type { SceneDefinition, SceneHandle } from './contract';


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
  readonly content: THREE.Group;

  private current: SceneHandle | null = null;
  private currentDefinition: SceneDefinition | null = null;
  /**
   * Built scenes waiting to be swapped in.
   *
   * A switch during a session must not run `build()` on the render thread: the
   * light well alone generates several canvas textures. Every registered scene
   * is built once, here, before it is needed; `load` takes the handle out of
   * this map instead of building. `keepPrevious` puts the outgoing scene back,
   * so switching back and forth costs two pointer swaps.
   */
  private readonly parked = new Map<string, SceneHandle>();
  private readonly baselineBackground: THREE.Color | THREE.Texture | null;
  private readonly baselineFog: THREE.FogBase | null;
  private floorOffset = 0;
  private elapsed = 0;

  constructor(scene: THREE.Scene = new THREE.Scene()) {
    this.scene = scene;
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
  /** Build `def` now and keep it out of the scene graph until it is loaded. */
  preload(def: SceneDefinition): void {
    if (this.currentDefinition?.id === def.id || this.parked.has(def.id)) {
      return;
    }
    try {
      this.parked.set(def.id, def.build());
    } catch (error) {
      // A scene that cannot build must not take the others down with it.
      console.warn(`scene ${def.id} failed to preload`, error);
    }
  }

  /** Ids currently parked, for diagnostics and tests. */
  get preloaded(): readonly string[] {
    return [...this.parked.keys()];
  }

  /**
   * Swap `def` in, using a preloaded handle when there is one.
   *
   * The old scene is disposed unless `keepPrevious` is set, which is what a
   * live scene switch asks for: parking it makes the way back instant instead
   * of a rebuild on the render thread.
   */
  load(def: SceneDefinition, options: { keepPrevious?: boolean } = {}): SceneHandle {
    const handle = this.parked.get(def.id) ?? def.build();
    this.parked.delete(def.id);

    const previous = this.current;
    const previousDefinition = this.currentDefinition;
    if (previous) previous.root.removeFromParent();

    this.current = handle;
    this.currentDefinition = def;
    this.elapsed = 0;
    this.content.add(handle.root);
    this.scene.background = handle.settings.background;
    this.scene.fog = handle.settings.fog;

    if (previous && previousDefinition) {
      if (options.keepPrevious) {
        this.parked.set(previousDefinition.id, previous);
      } else {
        previous.dispose();
      }
    }
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
    for (const handle of this.parked.values()) {
      handle.dispose();
    }
    this.parked.clear();
    this.scene.remove(this.content);
    this.scene.background = this.baselineBackground;
    this.scene.fog = this.baselineFog;
  }
}
