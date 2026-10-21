import * as THREE from 'three';

/**
 * Stable world -> virtual camera model for the supine -> seated -> standing
 * performance. The caller animates `at(t)`; `worldFor(head)` returns the
 * inverse camera -> world transform that the VR world shell must apply.
 *
 * The physical XR head pose is authoritative. Nothing here writes the camera.
 */
export interface CameraPose {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
}

export interface WorldTransform {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
}

export interface SitUpPathOptions {
  /** Bed/hip height in metres. */
  hipHeight?: number;
  /** Hip-to-eye distance while lying. */
  torsoLength?: number;
  /** Standing eye height from the floor. */
  standEyeHeight: number;
  /** Fraction of the timeline used by the torso rotation (rest is rise). */
  rotationPortion?: number;
}

const DEFAULT_HIP_HEIGHT = 0.45;
const DEFAULT_TORSO_LENGTH = 0.55;
const DEFAULT_ROTATION_PORTION = 0.7;
const UP = new THREE.Vector3(0, 1, 0);
const FORWARD = new THREE.Vector3(0, 0, 1);

/** Quintic smootherstep: zero velocity and acceleration at both ends. */
function ease(x: number): number {
  const t = x < 0 ? 0 : x > 1 ? 1 : x;
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function poseFromBasis(up: THREE.Vector3, gaze: THREE.Vector3): THREE.Quaternion {
  // Three cameras look down -Z and use +Y as up.
  const zAxis = gaze.clone().negate().normalize();
  const xAxis = new THREE.Vector3().crossVectors(up, zAxis).normalize();
  const yAxis = new THREE.Vector3().crossVectors(zAxis, xAxis).normalize();
  const basis = new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis);
  return new THREE.Quaternion().setFromRotationMatrix(basis);
}

export class SitUpPath {
  readonly hipHeight: number;
  readonly torsoLength: number;
  readonly standEyeHeight: number;
  readonly rotationPortion: number;

  constructor(options: SitUpPathOptions) {
    this.hipHeight = options.hipHeight ?? DEFAULT_HIP_HEIGHT;
    this.torsoLength = options.torsoLength ?? DEFAULT_TORSO_LENGTH;
    this.standEyeHeight = Math.max(
      this.hipHeight + this.torsoLength,
      options.standEyeHeight
    );
    this.rotationPortion = Math.min(
      0.95,
      Math.max(0.1, options.rotationPortion ?? DEFAULT_ROTATION_PORTION)
    );
  }

  /**
   * Eye height in metres at normalised time `t`, allocation-free. Mirrors
   * `at(t).position.y` so per-frame telemetry never has to build a pose.
   */
  eyeHeightAt(t: number): number {
    const time = t < 0 ? 0 : t > 1 ? 1 : t;
    const theta = (Math.PI / 2) * ease(time / this.rotationPortion);
    return this.eyeHeightFor(time, Math.sin(theta));
  }

  /** Rise above the supine hip, in metres; what the posture layer reports. */
  riseAt(t: number): number {
    const rise = this.eyeHeightAt(t) - this.hipHeight;
    return rise > 0 ? rise : 0;
  }

  private eyeHeightFor(time: number, sin: number): number {
    const rotate = this.rotationPortion;
    const seatedEyeY = this.hipHeight + this.torsoLength;
    return time <= rotate
      ? this.hipHeight + this.torsoLength * sin
      : seatedEyeY + (this.standEyeHeight - seatedEyeY) * ease((time - rotate) / (1 - rotate));
  }

  /** Virtual camera in the room frame at normalised time `t` in [0, 1]. */
  at(t: number): CameraPose {
    const time = t < 0 ? 0 : t > 1 ? 1 : t;
    const rotate = this.rotationPortion;
    const theta = (Math.PI / 2) * ease(time / rotate);

    const sin = Math.sin(theta);
    const cos = Math.cos(theta);
    const eyeY = this.eyeHeightFor(time, sin);
    // Scene convention: forward is -Z, so the supine head lies toward +Z.
    const eyeZ = time <= rotate ? this.torsoLength * cos : 0;

    const up = new THREE.Vector3(0, sin, cos);
    const gaze = new THREE.Vector3(0, cos, -sin);
    if (time > rotate) {
      up.copy(UP);
      gaze.copy(FORWARD).negate();
    }

    return {
      position: new THREE.Vector3(0, eyeY, eyeZ),
      quaternion: poseFromBasis(up, gaze)
    };
  }

  /**
   * Inverse transform for the VR world shell:
   *   qWorld = qHead * qCamera^-1
   *   pWorld = pHead - qWorld * pCamera
   *
   * Applying this to the virtual camera pose recovers the physical head pose,
   * so the patient always sees the simulated camera while the real XR camera
   * remains untouched.
   */
  worldFor(head: CameraPose, camera: CameraPose = this.at(0)): WorldTransform {
    const quaternion = head.quaternion
      .clone()
      .multiply(camera.quaternion.clone().invert());
    const position = head.position
      .clone()
      .sub(camera.position.clone().applyQuaternion(quaternion));
    return { position, quaternion };
  }
}


