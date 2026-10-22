import type * as THREE from 'three';

/**
 * Four spatial UI modes. They differ only in how the anchor pose is derived;
 * surface/input/lifecycle are shared.
 */
export type SpatialMode =
  | 'summoned'       // place in front once, then freeze in world
  | 'head-locked'    // follow the head every frame
  | 'world-locked'   // fixed world pose
  | 'world-billboard'; // fixed world position, rotate toward the head

export interface SpatialPose {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
}

export interface SpatialPlacementOptions {
  mode: SpatialMode;
  /** Meters from the head for summoned/head-locked. */
  distance?: number;
  /** Vertical offset in meters, applied in world space. */
  heightOffset?: number;
  /** Extra yaw around world up, degrees. */
  yawOffsetDeg?: number;
  /** Clamp the summon direction so panels never spawn overhead/underfoot. */
  minPitchDeg?: number;
  maxPitchDeg?: number;
  /** Billboard style for world-billboard. Yaw-only is the readable default. */
  billboard?: 'yaw' | 'full';
  /** Seconds to settle; 0 snaps. Ignored by world-locked and summoned. */
  dampingSeconds?: number;
  /** Hide after this many ms; 0 disables. */
  autoHideMs?: number;
  /** Hide when the head is closer than this distance; 0 disables. */
  hideDistance?: number;
}

export interface SpatialAnchorOptions extends SpatialPlacementOptions {
  onPlace?: (pose: SpatialPose) => void;
}

export type SpatialLayer = 'ui' | 'scene';

export interface SpatialInteractable {
  object: THREE.Object3D;
  layer?: SpatialLayer;
  enabled?: boolean;
  dwellTime?: number;
  /** `self` means the target draws its own progress (buttons); default is the reticle ring. */
  progressDisplay?: 'self' | 'reticle';
  onFocus?: (focused: boolean) => void;
  onSelect?: () => void;
  onProgress?: (progress: number) => void;
}
