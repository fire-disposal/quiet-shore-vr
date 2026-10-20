import * as THREE from 'three';
import type { HeadPose } from '../xr/types';
import {
  computeHeadLockedPose,
  computeSummonedPose,
  computeWorldBillboardPose,
  copySpatialPose,
  createSpatialPose,
  dampSpatialPose,
  distanceToHead
} from './placement';
import type { SpatialAnchorOptions, SpatialPose } from './types';

/**
 * Owns only the transform of a spatial surface. It never creates geometry.
 * The same anchor can be reused for menus, calibration cards, labels and
 * debug panels; the mode decides how the pose is derived.
 */
export class SpatialAnchor {
  readonly object = new THREE.Group();

  private readonly options: SpatialAnchorOptions;
  private readonly current = createSpatialPose();
  private readonly target = createSpatialPose();
  private readonly damped = createSpatialPose();
  private placed = false;
  private manuallyVisible = true;
  private autoHideAt = 0;
  private hiddenByDistance = false;

  constructor(options: SpatialAnchorOptions) {
    this.options = { ...options };
    this.object.name = `spatial-anchor:${options.mode}`;
  }

  get mode(): SpatialAnchorOptions['mode'] {
    return this.options.mode;
  }

  get isPlaced(): boolean {
    return this.placed;
  }

  get isVisible(): boolean {
    return this.manuallyVisible && this.object.visible;
  }

  /** Fixed world pose for world-locked and world-billboard modes. */
  setWorldPose(position: THREE.Vector3, quaternion: THREE.Quaternion): void {
    this.current.position.copy(position);
    this.current.quaternion.copy(quaternion);
    copySpatialPose(this.current, this.target);
    this.applyCurrent();
    this.placed = true;
  }

  /** Summon in front of the head, then freeze. Safe to call repeatedly. */
  summon(head: HeadPose): void {
    computeSummonedPose(head, this.options, this.target);
    copySpatialPose(this.target, this.current);
    this.applyCurrent();
    this.placed = true;
    this.manuallyVisible = true;
    this.autoHideAt = 0;
    this.options.onPlace?.(this.current);
  }

  setVisible(visible: boolean): void {
    this.manuallyVisible = visible;
    this.object.visible = visible && !this.hiddenByDistance;
  }

  update(head: HeadPose, dt: number, now: number): void {
    if (!this.placed) {
      return;
    }

    switch (this.options.mode) {
      case 'summoned':
        // Frozen after summon; no per-frame work.
        break;
      case 'head-locked':
        computeHeadLockedPose(head, this.options, this.target);
        dampSpatialPose(this.current, this.target, dt, this.options.dampingSeconds ?? 0.08, this.damped);
        copySpatialPose(this.damped, this.current);
        break;
      case 'world-billboard':
        computeWorldBillboardPose(this.current.position, head, this.options, this.target);
        dampSpatialPose(this.current, this.target, dt, this.options.dampingSeconds ?? 0.12, this.damped);
        copySpatialPose(this.damped, this.current);
        break;
      case 'world-locked':
        break;
    }

    this.applyCurrent();

    if (this.options.hideDistance && this.options.hideDistance > 0) {
      this.hiddenByDistance = distanceToHead(this.current.position, head) < this.options.hideDistance;
    }
    if (this.options.autoHideMs && this.options.autoHideMs > 0) {
      if (this.autoHideAt === 0) {
        this.autoHideAt = now + this.options.autoHideMs;
      } else if (now >= this.autoHideAt) {
        this.manuallyVisible = false;
      }
    }
    this.object.visible = this.manuallyVisible && !this.hiddenByDistance;
  }

  private applyCurrent(): void {
    this.object.position.copy(this.current.position);
    this.object.quaternion.copy(this.current.quaternion);
    this.object.updateMatrixWorld(true);
  }

  dispose(): void {
    this.object.clear();
  }
}
