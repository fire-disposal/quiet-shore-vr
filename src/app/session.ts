/**
 * Session lifecycle as a pure reducer. No XR, DOM or BLE dependencies, so every
 * transition is testable.
 *
 * There is **one** kinematics, so there is no mode: a session is a posture
 * (the `mix` that rotates the world and lifts the eye) plus optional buoyancy
 * and view offsets. The machine only tracks *whether motion may run*, and every
 * stop path converges on `stopping` → `idle`.
 *
 * The patient has exactly one control: the click that enters WebXR. Everything
 * inside the session is the tablet operator's, so the machine has no patient
 * stop reason and no patient confirm event — a session ends when the operator
 * ends it, when the link is gone long enough (see `link-guard`), or when the
 * runtime itself ends the session.
 */

export type SessionPhase = 'idle' | 'calibrating' | 'running' | 'stopping';

/** Why a session stopped. Every one of these is the operator's or the rig's. */
export type StopReason =
  | 'technician'
  | 'link-lost'
  | 'headset-removed'
  | 'pose-lost'
  | 'session-end';

export interface SessionState {
  readonly phase: SessionPhase;
  readonly stopReason: StopReason | null;
}

export type SessionEvent =
  | { readonly type: 'start' }
  | { readonly type: 'calibrated' }
  | { readonly type: 'stop'; readonly reason: StopReason }
  | { readonly type: 'faded' };

export const INITIAL_SESSION: SessionState = {
  phase: 'idle',
  stopReason: null
};

/** The patient is inside a session and motion may run. */
export function isActive(state: SessionState): boolean {
  return state.phase === 'running';
}

export function reduceSession(state: SessionState, event: SessionEvent): SessionState {
  switch (event.type) {
    case 'start':
      // Start is accepted only from idle; a running session is never re-armed.
      if (state.phase !== 'idle') {
        return state;
      }
      return { phase: 'calibrating', stopReason: null };

    case 'calibrated':
      if (state.phase !== 'calibrating') {
        return state;
      }
      return { phase: 'running', stopReason: null };

    case 'stop':
      // Stop precedence: every reason is honoured from any running phase.
      if (state.phase === 'idle' || state.phase === 'stopping') {
        return state;
      }
      return { phase: 'stopping', stopReason: event.reason };

    case 'faded':
      if (state.phase !== 'stopping') {
        return state;
      }
      return { phase: 'idle', stopReason: state.stopReason };

    default:
      // Total by construction: an event this build does not know — a stale
      // frame from an older page, or the removed patient `confirm` — is
      // ignored rather than returning `undefined` through the lifecycle.
      return state;
  }
}
