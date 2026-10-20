import type * as THREE from 'three';
import type { HeadPose, XRManagerLike } from './types';

/**
 * Reads the authoritative head pose for the current frame. In XR the XR
 * camera owns the pose; in 2D the perspective camera does. The output is
 * reused by the caller to avoid per-frame allocation.
 */
export function readHeadPose(
  camera: THREE.Camera,
  xr: XRManagerLike,
  out: HeadPose
): HeadPose {
  if (xr.isPresenting && xr.getCamera) {
    const xrCamera = xr.getCamera(camera);
    xrCamera.updateMatrixWorld(true);
    xrCamera.getWorldPosition(out.position);
    xrCamera.getWorldQuaternion(out.quaternion);
    return out;
  }
  camera.updateMatrixWorld(true);
  camera.getWorldPosition(out.position);
  camera.getWorldQuaternion(out.quaternion);
  return out;
}
