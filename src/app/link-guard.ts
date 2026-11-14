/**
 * The tablet link as a small state machine, so "the tablet is gone" has one
 * definition instead of a flag and a timer that can disagree.
 *
 * The patient wears the headset and does nothing after the one click that
 * enters WebXR; every other control is on the tablet. So a dropped tablet is
 * not a control-panel outage, it is the emergency:
 *
 * ```text
 *  online ──drop──► frozen ──return ≤5 s──► online   (session continues)
 *                     └──────5 s elapsed ──► lost   (session is over)
 * ```
 *
 * `frozen` freezes motion and voice but keeps the session: the world is still
 * there and a reconnect continues it exactly where it stopped. `lost` is the
 * only state that ends the session, and it ends it as `link-lost`.
 *
 * Pure: no timers, no sockets. The owner feeds `dropLink`, `returnLink` and
 * `elapseLink`, so the five seconds are testable without waiting five seconds.
 */

/** How long a reconnect may take before the session is abandoned. */
export const LINK_LOST_GRACE_MS = 5000;

export type LinkPhase = 'online' | 'frozen' | 'lost';

export interface LinkGuardState {
  readonly phase: LinkPhase;
  /** Milliseconds still owed to the reconnect window while `frozen`. */
  readonly remainingMs: number;
}

export const INITIAL_LINK: LinkGuardState = { phase: 'online', remainingMs: 0 };

export type LinkEvent =
  /** The socket closed while a session was running. */
  | { readonly type: 'drop' }
  /** The socket is open again; the session may continue. */
  | { readonly type: 'return' }
  /** Time passed with the link still down. */
  | { readonly type: 'elapse'; readonly ms: number }
  /** A session ended for its own reasons; the guard starts clean. */
  | { readonly type: 'reset' };

/** Motion and voice must be frozen: the operator side is unreachable. */
export function isFrozen(state: LinkGuardState): boolean {
  return state.phase === 'frozen';
}

/** The session is over because the tablet never came back. */
export function isLost(state: LinkGuardState): boolean {
  return state.phase === 'lost';
}

export function reduceLink(state: LinkGuardState, event: LinkEvent): LinkGuardState {
  switch (event.type) {
    case 'drop':
      // A second drop (link flapping) does not restart the window: the five
      // seconds are counted from the first loss, or a flapping socket would
      // hold a frozen patient forever.
      if (state.phase !== 'online') {
        return state;
      }
      return { phase: 'frozen', remainingMs: LINK_LOST_GRACE_MS };

    case 'return':
      if (state.phase !== 'frozen') {
        return state;
      }
      return { phase: 'online', remainingMs: 0 };

    case 'elapse': {
      if (state.phase !== 'frozen') {
        return state;
      }
      const ms = Number.isFinite(event.ms) && event.ms > 0 ? event.ms : 0;
      if (ms === 0) {
        // No time passed: nothing about the window changed.
        return state;
      }
      const remainingMs = Math.max(0, state.remainingMs - ms);
      return remainingMs > 0
        ? { phase: 'frozen', remainingMs }
        : { phase: 'lost', remainingMs: 0 };
    }

    case 'reset':
      return state.phase === 'online' ? state : INITIAL_LINK;

    default:
      // Total by construction: a stale frame from an older page is ignored,
      // never allowed to return `undefined` into the connection state.
      return state;
  }
}
