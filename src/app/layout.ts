/**
 * Where a deferred world change belongs.
 *
 * App defers the scene swap behind the curtain (220 ms), and the swap writes
 * into the world: it loads a scene, restarts the scene bed, logs
 * `scene.switched` and can start a posture ramp. A stop, an exit or a dispose
 * can all land inside that window, so the callback re-checks a ticket before
 * acting: a deferred change either still belongs to the run that ordered it or
 * does nothing at all.
 *
 * Tickets only move forward, so a ticket can never be reissued and an
 * abandoned callback can never adopt the next run's work.
 */
export interface LayoutToken {
  /** Bumped by every start, by every stop, and by every superseding command. */
  ticket: number;
}

export function createLayoutToken(): LayoutToken {
  return { ticket: 0 };
}

/**
 * Void every deferred change ordered so far: a stop, an exit or a dispose ends
 * the run that scheduled them.
 */
export function invalidateLayout(token: LayoutToken): void {
  token.ticket += 1;
}

/**
 * Take the one slot for the next deferred change, superseding any still
 * scheduled. Two scene commands in a row must not swap the world twice.
 */
export function nextLayoutTicket(token: LayoutToken): number {
  token.ticket += 1;
  return token.ticket;
}

/**
 * True only for the callback still scheduled for the current run: a later
 * scheduling, a stop, an exit or a dispose all make this false.
 */
export function isLayoutCurrent(token: LayoutToken, ticket: number): boolean {
  return token.ticket === ticket;
}
