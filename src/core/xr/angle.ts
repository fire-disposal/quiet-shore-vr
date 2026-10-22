/**
 * The single degree↔radian boundary of the patient app.
 *
 * Every scalar angle above this file is signed degrees: the wire's normalized
 * z, the operator UI, the preset catalog, telemetry and the posture layer.
 * three.js speaks radians, so the conversion happens here and nowhere else.
 * A second conversion point is how two sign conventions drift apart.
 */

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

export function degToRad(degrees: number): number {
  return degrees * DEG_TO_RAD;
}

export function radToDeg(radians: number): number {
  return radians * RAD_TO_DEG;
}

/**
 * Clamp a signed angle into `[-limit, +limit]`.
 * A non-finite value collapses to 0 instead of poisoning the transform.
 */
export function clampSigned(value: number, limit: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  const max = Math.abs(limit);
  return value < -max ? -max : value > max ? max : value;
}
