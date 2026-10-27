/**
 * When buoyancy may run, and how its offset composes with the world frame that
 * currently owns the content.
 *
 * The heave is authored along the patient's **visual** vertical
 * (`docs/research-standing-sensation.md` §2.1 — motion along the body axis).
 * `world-frame.ts` turns that into a content-space axis, so the direction is
 * right in every frame; this gate only decides *when*:
 *
 * - only inside a running session, never while a capture holds the world still;
 * - never during a rise, so the two vertical animations cannot stack.
 *
 * The second half is ownership: the active frame decides the content offset,
 * and buoyancy is a delta on top of it. A frame that reassigns the offset
 * (the sit-up path, a fresh calibration) must never be fought by the bob.
 */

export interface BuoyancyGate {
  /** `isActive(lifecycle)`: a running session, never idle/calibrating. */
  readonly active: boolean;
  /** A capture is between frames: the world must hold still. */
  readonly capturePending: boolean;
  /** A rise is running: that animation owns all the motion there is. */
  readonly rising: boolean;
}

export function buoyancyAllowed(gate: BuoyancyGate): boolean {
  return gate.active && !gate.capturePending && !gate.rising;
}
