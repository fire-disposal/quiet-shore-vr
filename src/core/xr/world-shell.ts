import * as THREE from 'three';
import type { WorldTransform } from './situp-path';

/**
 * Scene-agnostic transform composition for the patient world.
 *
 * ```text
 * scene
 * └── world-shell          view pitch: rotation about the eye (this module)
 *     └── base             comfort.group: calibration + posture, or the sit-up pose
 *         └── content      scene host: floor offset
 *             └── root     scene art (content-only)
 * ```
 *
 * The shell owns the *order* of the layers and the only writer of its own
 * pitch transform. It does not own animation policy: `setPitch` is a plain
 * setter, and easing/hold/reset live in the view-motion controller. It is
 * rebuilt and rebound on a scene switch, so no scene module ever sees a
 * transform layer or decides precedence.
 *
 * Each layer has exactly one writer:
 * - `group` here, from the pitch value handed in by the view-motion controller;
 * - `base` by `Comfort` while calibrated, and by `setBasePose` for the sit-up
 *   performance (the sit-up inverse replaces the calibration frame);
 * - `content` by `SceneHost.setFloorOffset` only.
 *
 * The XR camera is never read or written. The pitch is a world rotation about
 * the patient's eye, so it composes with any rigid base pose without moving
 * the eye point.
 */

export interface WorldShellApi {
  /** Outermost world transform; `base`'s parent. Nothing else may write it. */
  readonly group: THREE.Group;
  /** Base pose layer: `Comfort.group`, or the sit-up transform. */
  readonly base: THREE.Object3D;
  /**
   * Absolute pitch in degrees, positive = 上仰 (the patient sees more sky).
   * Non-finite input is ignored; the caller clamps to the wire limit.
   */
  setPitch(deg: number): void;
  getPitch(): number;
  /**
   * Hand the base layer to the sit-up performance, or give it back to
   * `Comfort` with `null`. `null` leaves the base transform untouched: the
   * next comfort update owns it again.
   */
  setBasePose(world: WorldTransform | null): void;
  /** True while the sit-up pose owns the base layer. */
  isBasePosed(): boolean;
  /** Place the pitch transform around `eye`. Allocation-free. */
  update(eye: THREE.Vector3): void;
  dispose(): void;
}

export interface WorldShellOptions {
  scene: THREE.Scene;
  /** Base pose layer; moved under the shell. */
  base: THREE.Object3D;
}

const DEG_TO_RAD = Math.PI / 180;
const PITCH_AXIS = new THREE.Vector3(1, 0, 0);

export function createWorldShell(options: WorldShellOptions): WorldShellApi {
  const { scene, base } = options;
  const group = new THREE.Group();
  group.name = 'world-shell';
  scene.add(group);
  scene.remove(base);
  group.add(base);

  const rotation = new THREE.Quaternion();
  const rotatedEye = new THREE.Vector3();
  let pitchDeg = 0;
  let basePosed = false;
  let disposed = false;

  function setPitch(deg: number): void {
    if (!Number.isFinite(deg)) {
      return;
    }
    pitchDeg = deg;
  }

  function setBasePose(world: WorldTransform | null): void {
    if (!world) {
      basePosed = false;
      return;
    }
    basePosed = true;
    base.quaternion.copy(world.quaternion);
    base.position.copy(world.position);
  }

  function update(eye: THREE.Vector3): void {
    if (disposed) {
      return;
    }
    if (
      !Number.isFinite(eye.x) ||
      !Number.isFinite(eye.y) ||
      !Number.isFinite(eye.z)
    ) {
      return;
    }
    if (pitchDeg === 0) {
      group.quaternion.identity();
      group.position.set(0, 0, 0);
      return;
    }
    // Positive pitch = look up = the world tilts down, i.e. content rotates by
    // -pitch about +X (a point straight ahead moves toward -Y).
    rotation.setFromAxisAngle(PITCH_AXIS, -pitchDeg * DEG_TO_RAD);
    rotatedEye.copy(eye).applyQuaternion(rotation);
    group.quaternion.copy(rotation);
    // Rotation about the eye: the pivot itself is a fixed point of the shell.
    group.position.copy(eye).sub(rotatedEye);
  }

  function dispose(): void {
    if (disposed) {
      return;
    }
    disposed = true;
    group.remove(base);
    scene.add(base);
    scene.remove(group);
  }

  return {
    group,
    base,
    setPitch,
    getPitch: () => pitchDeg,
    setBasePose,
    isBasePosed: () => basePosed,
    update,
    dispose
  };
}
