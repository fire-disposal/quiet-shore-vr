import {
  VIEW_PITCH_LIMIT_DEG,
  isViewPresetId,
  type ViewPresetId
} from '../core/xr/view-motion';

/**
 * Strict wire parsing for the operator view channel.
 *
 * `view:move:<x>,<z>` carries an ABSOLUTE pitch target: `x` must be 0
 * (|x| < 1e-6, no translation axis exists any more) and `z ∈ [-1, 1]` maps to
 * `pitch = z × 20°`. Anything else is rejected whole, never coerced.
 */
const VIEW_ARG = /^-?\d+(?:\.\d+)?$/;

/** Tolerated residual on the dead `x` slot, per the shared wire contract. */
const VIEW_X_EPSILON = 1e-6;

/**
 * Parse the payload after `view:move:`.
 *
 * @returns the absolute target in degrees, or `null` when the frame is invalid.
 */
export function parseViewMove(raw: string): number | null {
  const comma = raw.indexOf(',');
  if (comma < 0 || raw.indexOf(',', comma + 1) >= 0) {
    return null;
  }
  const rawX = raw.slice(0, comma);
  const rawZ = raw.slice(comma + 1);
  if (!VIEW_ARG.test(rawX) || !VIEW_ARG.test(rawZ)) {
    return null;
  }
  const x = Number(rawX);
  const z = Number(rawZ);
  if (!Number.isFinite(x) || !Number.isFinite(z)) {
    return null;
  }
  if (Math.abs(x) >= VIEW_X_EPSILON) {
    return null;
  }
  if (z < -1 || z > 1) {
    return null;
  }
  return z * VIEW_PITCH_LIMIT_DEG;
}

/**
 * Parse the payload of `view:anim:<id>`; only playable catalog ids exist.
 * `none` is the state encoding for "no preset" and is not playable, so it is
 * rejected here like any other unknown name.
 */
export function parseViewAnim(raw: string): ViewPresetId | null {
  const id = raw.trim().toLowerCase();
  return isViewPresetId(id) ? id : null;
}
