import type * as THREE from 'three';

/** Structural subset shared by XRViewerPose and test fixtures. */
export interface PoseLike {
  transform: {
    position: { x: number; y: number; z: number };
    orientation: { x: number; y: number; z: number; w: number };
  };
}

export interface HeadPose {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
}

export interface XRManagerLike {
  enabled: boolean;
  isPresenting: boolean;
  setSession(session: XRSession): Promise<void>;
  getReferenceSpace(): XRReferenceSpace | null;
  getCamera?(camera?: THREE.Camera): THREE.Camera;
}

export interface AnimationLoopRenderer {
  setAnimationLoop(callback: ((time: number, frame?: XRFrame) => void) | null): void;
}
