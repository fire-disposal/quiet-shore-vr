/**
 * The SUS sheet as the tablet receives it.
 *
 * The 20/28-byte state frame is frozen by the wire contract and has no room for
 * a record, so a sheet travels as JSON: page → headset app (socket) → tablet
 * (its own characteristic). Both ends must agree on the shape, so it is built
 * here, in one place, and the Kotlin decoder mirrors it:
 *
 * ```text
 * { answers: int[10] (0 = unanswered), filled, complete, scene, sessionSec, completedAt }
 * ```
 */
export interface SusPayload {
  answers: number[];
  filled: number;
  complete: boolean;
  scene: string;
  sessionSec: number;
  /** Epoch millis, taken from the headset clock. */
  completedAt: number;
}

export const SUS_ITEMS = 10;

export function buildSusPayload(
  answers: ReadonlyArray<number | null>,
  facts: { scene: string; sessionSec: number; now: number }
): SusPayload {
  const slots = answers.slice(0, SUS_ITEMS);
  return {
    // An unanswered slot is 0 on the wire: JSON null would make the Kotlin
    // decoder branch on types it cannot see in a BLE notification.
    answers: slots.map((answer) => (answer === null ? 0 : answer)),
    filled: slots.filter((answer) => answer !== null).length,
    complete: slots.length === SUS_ITEMS && slots.every((answer) => answer !== null),
    scene: facts.scene,
    sessionSec: Math.max(0, Math.round(facts.sessionSec)),
    completedAt: facts.now
  };
}
