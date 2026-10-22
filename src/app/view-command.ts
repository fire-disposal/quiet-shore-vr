import {
  LOOK_YAW_LIMIT_DEG,
  UP_GAZE_LIMIT_DEG,
  isViewPresetId,
  type ViewPresetId
} from '../core/xr/view-motion';

/**
 * Strict wire parsing for the operator view channel.
 *
 * `view:orient:<yaw>,<pitch>` carries an ABSOLUTE orientation in degrees:
 * yaw ∈ [−180, 180] (positive = the patient's view turns left), pitch
 * ∈ [−90, 90] (positive = the patient sees more sky). Anything else —
 * extra fields, exponents, a leading dot or plus, out-of-range values — is
 * rejected whole, never coerced or clamped.
 */
const VIEW_ARG = /^-?\d+(?:\.\d+)?$/;

export interface ViewOrientation {
  lookYawDeg: number;
  upGazeDeg: number;
}

/**
 * Parse the payload after `view:orient:`.
 *
 * @returns the absolute orientation, or `null` when the frame is invalid.
 */
export function parseViewOrient(raw: string): ViewOrientation | null {
  const comma = raw.indexOf(',');
  if (comma < 0 || raw.indexOf(',', comma + 1) >= 0) {
    return null;
  }
  const rawYaw = raw.slice(0, comma);
  const rawPitch = raw.slice(comma + 1);
  if (!VIEW_ARG.test(rawYaw) || !VIEW_ARG.test(rawPitch)) {
    return null;
  }
  const lookYawDeg = Number(rawYaw);
  const upGazeDeg = Number(rawPitch);
  if (!Number.isFinite(lookYawDeg) || !Number.isFinite(upGazeDeg)) {
    return null;
  }
  if (lookYawDeg < -LOOK_YAW_LIMIT_DEG || lookYawDeg > LOOK_YAW_LIMIT_DEG) {
    return null;
  }
  if (upGazeDeg < -UP_GAZE_LIMIT_DEG || upGazeDeg > UP_GAZE_LIMIT_DEG) {
    return null;
  }
  return { lookYawDeg, upGazeDeg };
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
