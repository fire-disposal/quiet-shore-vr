import * as THREE from 'three';
import {
  clearTransform,
  copyWorldRotation,
  isIdentityRotation,
  worldQuaternion,
  writeWorld,
  type WorldRotation
} from './frame';
import type { WorldTransform } from './situp-path';

/**
 * Scene-agnostic transform composition for the patient world.
 *
 * ```text
 * scene
 * └── world-shell          world rotation about the eye (this module)
 *     └── base             comfort.group: calibration + posture, or the sit-up pose
 *         └── content      scene host: floor offset
 *             └── root     scene art (content-only)
 * ```
 *
 * The shell owns the *order* of the layers and is the only writer of its own
 * transform. It does not own policy: `setWorldRotation` stores a world-frame
 * rotation, and `update` applies exactly that rotation about the eye. Easing,
 * hold, recentre and limits live above it (`view-motion`, `comfort`).
 *
 * Each layer has exactly one writer:
 * - `group` here, from the rotation handed in by the view controller;
 * - `base` by `Comfort` while calibrated, and by `setBasePose` for the sit-up
 *   performance (the sit-up inverse replaces the calibration frame);
 * - `content` by `SceneHost.setFloorOffset` only.
 *
 * The XR camera is never read or written. The rotation is about the patient's
 * eye, so it composes with any rigid base pose without moving the eye point.
 */

export interface WorldShellApi {
  /** Outermost world transform; `base`'s parent. Nothing else may write it. */
  readonly group: THREE.Group;
  /** Base pose layer: `Comfort.group`, or the sit-up transform. */
  readonly base: THREE.Object3D;
  /**
   * World-frame rotation in degrees (see `frame.ts`). Non-finite components
   * are ignored; the caller owns the envelope.
   */
  setWorldRotation(rotation: WorldRotation): void;
  getWorldRotation(out: WorldRotation): WorldRotation;
  /**
   * Hand the base layer to the sit-up performance, or give it back to
   * `Comfort` with `null`. `null` leaves the base transform untouched: the
   * next comfort update owns it again.
   */
  setBasePose(world: WorldTransform | null): void;
  /** True while the sit-up pose owns the base layer. */
  isBasePosed(): boolean;
  /** Apply the stored rotation about `eye`. Allocation-free. */
  update(eye: THREE.Vector3): void;
  dispose(): void;
}

export interface WorldShellOptions {
  scene: THREE.Scene;
  /** Base pose layer; moved under the shell. */
  base: THREE.Object3D;
}

export function createWorldShell(options: WorldShellOptions): WorldShellApi {
  const { scene, base } = options;
  const group = new THREE.Group();
  group.name = 'world-shell';
  scene.add(group);
  scene.remove(base);
  group.add(base);

  const rotation: WorldRotation = { pitchDeg: 0, rollDeg: 0, yawDeg: 0 };
  const quaternion = new THREE.Quaternion();
  let basePosed = false;
  let disposed = false;

  function setWorldRotation(next: WorldRotation): void {
    if (
      !Number.isFinite(next.pitchDeg) ||
      !Number.isFinite(next.rollDeg) ||
      !Number.isFinite(next.yawDeg)
    ) {
      return;
    }
    copyWorldRotation(next, rotation);
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
    if (isIdentityRotation(rotation)) {
      clearTransform(group);
      return;
    }
    worldQuaternion(quaternion, rotation);
    // Rotation about the eye: the pivot itself is a fixed point of the shell.
    writeWorld(group, quaternion, eye);
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
    setWorldRotation,
    getWorldRotation: (out) => copyWorldRotation(rotation, out),
    setBasePose,
    isBasePosed: () => basePosed,
    update,
    dispose
  };
}
