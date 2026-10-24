/**
 * When buoyancy may run, and how its offset composes with the world frame that
 * currently owns the content.
 *
 * The heave is authored along the patient's **visual** vertical
 * (`docs/research-standing-sensation.md` §2.1 — motion along the body axis).
 * `world-frame.ts` turns that into a content-space axis, so the direction is
 * right in every frame; this gate only decides *when*:
 *
 * - only in the floating mode: the posture mode's rise owns all motion;
 * - only inside a running session, never while a capture holds the world still;
 * - never during a rise, even in a supine scene's floating mode, so the two
 *   animations cannot stack.
 *
 * The second half is ownership: the active frame decides the content offset,
 * and buoyancy is a delta on top of it. A frame that reassigns the offset
 * (the sit-up path, a fresh calibration) must never be fought by the bob.
 */

export interface BuoyancyGate {
  /** Session mode; fixed for the whole session. */
  readonly mode: 'float' | 'posture';
  /** `isActive(lifecycle)`: floating or posture, never idle/calibrating. */
  readonly active: boolean;
  /** A capture is between frames: the world must hold still. */
  readonly capturePending: boolean;
  /** A rise is running: that animation owns all the motion there is. */
  readonly rising: boolean;
}

export function buoyancyAllowed(gate: BuoyancyGate): boolean {
  return gate.mode === 'float' && gate.active && !gate.capturePending && !gate.rising;
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
