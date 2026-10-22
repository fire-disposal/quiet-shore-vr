import * as THREE from 'three';
import type { HeadPose } from '../xr/types';
import type { SpatialPlacementOptions, SpatialPose } from './types';
import { degToRad } from '../xr/angle';

const WORLD_UP = new THREE.Vector3(0, 1, 0);
const tmpDirection = new THREE.Vector3();
const tmpDummy = new THREE.Object3D();

export function createSpatialPose(): SpatialPose {
  return {
    position: new THREE.Vector3(),
    quaternion: new THREE.Quaternion()
  };
}

export function copySpatialPose(source: SpatialPose, out: SpatialPose): SpatialPose {
  out.position.copy(source.position);
  out.quaternion.copy(source.quaternion);
  return out;
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/**
 * Direction from the head, clamped by pitch so a panel never spawns
 * overhead or underfoot. Uses the head quaternion's forward vector.
 */
function headDirection(head: HeadPose, minPitchDeg: number, maxPitchDeg: number): THREE.Vector3 {
  tmpDirection.set(0, 0, -1).applyQuaternion(head.quaternion);
  const minY = Math.sin(degToRad(Math.min(minPitchDeg, maxPitchDeg)));
  const maxY = Math.sin(degToRad(Math.max(minPitchDeg, maxPitchDeg)));
  tmpDirection.y = clamp(tmpDirection.y, minY, maxY);
  if (tmpDirection.lengthSq() < 1e-8) {
    tmpDirection.set(0, 0, -1).applyQuaternion(head.quaternion);
  }
  return tmpDirection.normalize();
}

/** Face the head from a fixed world position. +Z of the panel points at the head. */
function faceHead(position: THREE.Vector3, head: HeadPose, yawOnly: boolean, out: THREE.Quaternion): void {
  if (yawOnly) {
    const yaw = Math.atan2(head.position.x - position.x, head.position.z - position.z);
    out.setFromAxisAngle(WORLD_UP, yaw);
    return;
  }
  tmpDummy.position.copy(position);
  tmpDummy.up.copy(WORLD_UP);
  tmpDummy.lookAt(head.position);
  out.copy(tmpDummy.quaternion);
}

/**
 * Summoned: compute a pose in front of the head once. The caller freezes it
 * in world space; re-summoning recomputes it.
 */
export function computeSummonedPose(
  head: HeadPose,
  options: SpatialPlacementOptions,
  out: SpatialPose
): SpatialPose {
  const distance = options.distance ?? 1.25;
  const direction = headDirection(
    head,
    options.minPitchDeg ?? -12,
    options.maxPitchDeg ?? 28
  );
  if (options.yawOffsetDeg) {
    direction.applyAxisAngle(WORLD_UP, degToRad(options.yawOffsetDeg));
  }
  out.position.copy(head.position).addScaledVector(direction, distance);
  out.position.y += options.heightOffset ?? 0;
  faceHead(out.position, head, false, out.quaternion);
  return out;
}

/**
 * Head-locked: the panel follows the head each frame. The position is
 * recomputed from the current head pose; the caller applies damping.
 */
export function computeHeadLockedPose(
  head: HeadPose,
  options: SpatialPlacementOptions,
  out: SpatialPose
): SpatialPose {
  const distance = options.distance ?? 0.8;
  const direction = headDirection(
    head,
    options.minPitchDeg ?? -80,
    options.maxPitchDeg ?? 80
  );
  if (options.yawOffsetDeg) {
    direction.applyAxisAngle(WORLD_UP, degToRad(options.yawOffsetDeg));
  }
  out.position.copy(head.position).addScaledVector(direction, distance);
  out.position.y += options.heightOffset ?? 0;
  faceHead(out.position, head, false, out.quaternion);
  return out;
}

/**
 * World-billboard: fixed world position, orientation follows the head.
 * Yaw-only is the default because full billboarding introduces roll/pitch
 * that makes text harder to read.
 */
export function computeWorldBillboardPose(
  position: THREE.Vector3,
  head: HeadPose,
  options: SpatialPlacementOptions,
  out: SpatialPose
): SpatialPose {
  out.position.copy(position);
  faceHead(position, head, (options.billboard ?? 'yaw') === 'yaw', out.quaternion);
  return out;
}

/** Exponential, frame-rate-independent damping. seconds <= 0 snaps. */
export function dampSpatialPose(
  current: SpatialPose,
  target: SpatialPose,
  dt: number,
  seconds: number,
  out: SpatialPose
): SpatialPose {
  if (!(seconds > 0) || dt <= 0) {
    return copySpatialPose(target, out);
  }
  const alpha = clamp(1 - Math.exp(-dt / seconds), 0, 1);
  out.position.lerpVectors(current.position, target.position, alpha);
  out.quaternion.copy(current.quaternion).slerp(target.quaternion, alpha);
  return out;
}

export function distanceToHead(position: THREE.Vector3, head: HeadPose): number {
  return position.distanceTo(head.position);
}
