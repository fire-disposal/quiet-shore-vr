import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  createFrustumGeometry,
  FOV_HALF_H_DEG,
  FOV_HALF_V_DEG,
  FOV_LENGTH_M,
  writeFrustumQuaternion
} from '../src/mirror/frustum';

const DEG = Math.PI / 180;

/** Head-oriented quaternion, the same convention the mirror camera carries. */
function viewQuat(yawDeg: number, pitchDeg: number, rollDeg: number): THREE.Quaternion {
  return new THREE.Quaternion().setFromEuler(
    new THREE.Euler(pitchDeg * DEG, yawDeg * DEG, rollDeg * DEG, 'YXZ')
  );
}

function axisOf(q: THREE.Quaternion, x: number, y: number, z: number): THREE.Vector3 {
  return new THREE.Vector3(x, y, z).applyQuaternion(q);
}

/** A view aimed by its two patient-centric angles, i.e. every pose the set has. */
const POSES: [number, number, number][] = [];
for (const yaw of [0, 45, 120, -160]) {
  for (const pitch of [-80, -30, 0, 25, 60, 89]) {
    for (const roll of [0, 15, -35]) {
      POSES.push([yaw, pitch, roll]);
    }
  }
}

describe('mirror frustum orientation', () => {
  /**
   * Regression: the basis used to be built as `makeBasis(up × gaze, up, -gaze)`,
   * which is left-handed (det = −1). `setFromRotationMatrix` cannot express a
   * reflection, so it returned a non-unit quaternion with no relation to the
   * view: measured up to 97° off the gaze, and 87.5° at the lying pose, which
   * is the one the operator sees most.
   */
  it('points where the view points, for every pose', () => {
    const out = new THREE.Quaternion();
    for (const [yaw, pitch, roll] of POSES) {
      const view = viewQuat(yaw, pitch, roll);
      writeFrustumQuaternion(out, view);

      expect(out.length()).toBeCloseTo(1, 12);

      const saw = axisOf(out, 0, 0, -1);
      const want = axisOf(view, 0, 0, -1);
      expect(saw.dot(want)).toBeCloseTo(1, 12);
    }
  });

  it('keeps the patient’s up along the wire’s +Y', () => {
    const out = new THREE.Quaternion();
    for (const [yaw, pitch, roll] of POSES) {
      const view = viewQuat(yaw, pitch, roll);
      writeFrustumQuaternion(out, view);

      const saw = axisOf(out, 0, 1, 0);
      const want = axisOf(view, 0, 1, 0);
      expect(saw.dot(want)).toBeCloseTo(1, 12);
    }
  });

  it('is a rotation, not a reflection: +X matches the view’s +X', () => {
    const out = new THREE.Quaternion();
    for (const [yaw, pitch, roll] of POSES) {
      const view = viewQuat(yaw, pitch, roll);
      writeFrustumQuaternion(out, view);

      // The old basis had this negated; a symmetric wire hid the swap.
      const saw = axisOf(out, 1, 0, 0);
      const want = axisOf(view, 1, 0, 0);
      expect(saw.dot(want)).toBeCloseTo(1, 12);
    }
  });

  it('agrees with the mirror camera’s own quaternion', () => {
    // The wire rides the same quaternion the panel renders with, so a single
    // call has to reproduce it exactly, not approximately.
    const view = viewQuat(-25, 12, 4);
    const out = new THREE.Quaternion();
    writeFrustumQuaternion(out, view);
    expect(out.angleTo(view)).toBeLessThan(1e-6);
  });
});

describe('mirror frustum wire', () => {
  it('is eight segments: four apex edges and the far rectangle', () => {
    const geometry = createFrustumGeometry();
    const positions = geometry.getAttribute('position');
    expect(positions.count).toBe(16);
    geometry.dispose();
  });

  it('opens along −Z with the far corners at the headset’s half-angles', () => {
    const geometry = createFrustumGeometry();
    const positions = geometry.getAttribute('position');
    const halfW = Math.tan(FOV_HALF_H_DEG * DEG) * FOV_LENGTH_M;
    const halfH = Math.tan(FOV_HALF_V_DEG * DEG) * FOV_LENGTH_M;

    let apex = 0;
    let far = 0;
    for (let i = 0; i < positions.count; i += 1) {
      const x = positions.getX(i);
      const y = positions.getY(i);
      const z = positions.getZ(i);
      if (x === 0 && y === 0 && z === 0) {
        apex += 1;
        continue;
      }
      far += 1;
      expect(z).toBeCloseTo(-FOV_LENGTH_M, 12);
      // The buffer is float32: five decimals is exact to its own resolution.
      expect(Math.abs(x)).toBeCloseTo(halfW, 5);
      expect(Math.abs(y)).toBeCloseTo(halfH, 5);
    }
    // Four apex edges share the apex; the far rectangle contributes no origin.
    expect(apex).toBe(4);
    expect(far).toBe(12);
    geometry.dispose();
  });
});
