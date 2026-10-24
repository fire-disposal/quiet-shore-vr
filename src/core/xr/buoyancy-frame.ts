/**
 * When buoyancy may run, and how its offset composes with the world frame that
 * currently owns the content.
 *
 * The heave is authored along the patient's **visual** vertical: for a supine
 * viewer that is the only direction that reads as up/down
 * (`docs/research-standing-sensation.md` §2.1 — motion along the body axis).
 * It coincides with the content's +Y only while the calibrated frame owns the
 * world. Once the sit-up path poses the base, content +Y runs along the gaze,
 * so the same offset would push the world toward the patient instead of
 * lifting it. Hence the frame gate: buoyancy belongs to the floating mode with
 * the calibrated frame, and nowhere else.
 *
 * The second half is ownership: the active frame decides the content Y, and
 * buoyancy is a delta on top of it. A frame that reassigns the offset (the
 * sit-up path, a fresh calibration) must never be fought by the bob.
 */

export type BuoyancyFrame = 'calibrated' | 'posture';

export interface BuoyancyGate {
  /** Session mode; fixed for the whole session. */
  readonly mode: 'float' | 'posture';
  /** `isActive(lifecycle)`: floating or posture, never idle/calibrating. */
  readonly active: boolean;
  /** A capture is between frames: the world must hold still. */
  readonly capturePending: boolean;
  /** Which layer currently writes the base transform. */
  readonly frame: BuoyancyFrame;
}

export function buoyancyAllowed(gate: BuoyancyGate): boolean {
  return (
    gate.mode === 'float' &&
    gate.active &&
    !gate.capturePending &&
    gate.frame === 'calibrated'
  );
}

/**
 * Content Y for one frame.
 *
 * `sceneSplits` is true when the scene implements `applyBuoyancy`: it moves
 * its own depth layers, so the host content carries only the frame's offset
 * and the bob is passed through separately.
 */
export function contentOffsetFor(
  baseOffset: number,
  bobM: number,
  sceneSplits: boolean
): number {
  const base = Number.isFinite(baseOffset) ? baseOffset : 0;
  if (sceneSplits) {
    return base;
  }
  const bob = Number.isFinite(bobM) ? bobM : 0;
  return base + bob;
}

/**
 * Content Y the calibrated frame expects: the scenes are authored with their
 * eye at the content origin, so the floor has to sit one eye height below it.
 * Desktop preview already has the camera at that height.
 */
export function calibratedFloorOffset(eyeHeight: number, inHeadset: boolean): number {
  const eye = Number.isFinite(eyeHeight) && eyeHeight > 0 ? eyeHeight : 0;
  return inHeadset && eye > 0 ? -eye : 0;
}
