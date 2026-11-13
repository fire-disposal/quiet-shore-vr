import * as THREE from 'three';

/**
 * The patient, as a view frustum, for the mirror's overview.
 *
 * A wireframe pyramid: apex at the eye, opening along the gaze, sized to the
 * headset's usable field of view. It is the only representation of the patient
 * in the diorama — no body, no head — so its axis has to be the patient's real
 * gaze rather than an approximation of it.
 *
 * The wire's local frame is the one the geometry is built in: apex at the
 * origin, opening along **−Z**, up along **+Y**. That is the same frame the
 * mirror camera carries (`world⁻¹ · head`, see `camera.ts`), so the orientation
 * is that camera's own quaternion — one source, no second derivation.
 */

/** Half-angles of the headset's usable field of view, degrees (84° × 76°). */
export const FOV_HALF_H_DEG = 42;
export const FOV_HALF_V_DEG = 38;
/** Apex-to-far-plane length of the wire, metres. */
export const FOV_LENGTH_M = 1.5;

/** Half-extents of the far plane in the wire's local frame. */
const FAR_HALF_W = Math.tan((FOV_HALF_H_DEG * Math.PI) / 180) * FOV_LENGTH_M;
const FAR_HALF_H = Math.tan((FOV_HALF_V_DEG * Math.PI) / 180) * FOV_LENGTH_M;

/**
 * Edges of the wire: four from the apex to the far corners, four around the far
 * plane. Eight `LineSegments` pairs, built once per mirror.
 */
export function createFrustumGeometry(): THREE.BufferGeometry {
  const far = -FOV_LENGTH_M;
  const corners: [number, number][] = [
    [-FAR_HALF_W, FAR_HALF_H],
    [FAR_HALF_W, FAR_HALF_H],
    [FAR_HALF_W, -FAR_HALF_H],
    [-FAR_HALF_W, -FAR_HALF_H]
  ];
  const positions: number[] = [];
  for (const [x, y] of corners) {
    positions.push(0, 0, 0, x, y, far);
  }
  for (let i = 0; i < 4; i += 1) {
    const a = corners[i];
    const b = corners[(i + 1) % 4];
    positions.push(a[0], a[1], far, b[0], b[1], far);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  return geometry;
}

const basis = new THREE.Matrix4();
const up = new THREE.Vector3();
const axis = new THREE.Vector3();
const right = new THREE.Vector3();

/**
 * Write the wire's orientation for the view it belongs to; allocation-free.
 *
 * `X = Y × Z`, in that order. With the apex at the origin and the opening along
 * −Z, the basis must be right-handed: `Z = −gaze` and `X = up × Z`. Swapping
 * the cross product yields a reflection (`det = −1`) that
 * `Quaternion.setFromRotationMatrix` cannot represent — it returns a non-unit
 * quaternion whose axis lies 60°–97° off the gaze, and the wire points
 * somewhere else while looking like a plausible frustum.
 *
 * No degenerate case to guard: `up` and `axis` are this one rotation's own +Y
 * and +Z, so they are exactly orthogonal and unit — the cross is always unit.
 */
export function writeFrustumQuaternion(
  target: THREE.Quaternion,
  view: THREE.Quaternion
): void {
  up.set(0, 1, 0).applyQuaternion(view);
  axis.set(0, 0, 1).applyQuaternion(view);
  right.crossVectors(up, axis);
  basis.makeBasis(right, up, axis);
  target.setFromRotationMatrix(basis);
}
