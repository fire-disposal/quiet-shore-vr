/**
 * Session lifecycle as a pure reducer. No XR, DOM or BLE dependencies, so every
 * transition is testable.
 *
 * There is **one** kinematics, so there is no mode: a session is a posture
 * (the `mix` that rotates the world and lifts the eye) plus optional buoyancy
 * and view offsets. The machine only tracks *whether motion may run*, and every
 * stop path converges on `stopping` → `idle`.
 */

export type SessionPhase = 'idle' | 'calibrating' | 'running' | 'stopping';

export type StopReason =
  | 'patient'
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
  | { readonly type: 'confirm' }
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

    case 'confirm':
      // Patient button: records the heading while calibrating, otherwise only
      // ever stops.
      if (state.phase === 'calibrating') {
        return reduceSession(state, { type: 'calibrated' });
      }
      if (isActive(state)) {
        return { phase: 'stopping', stopReason: 'patient' };
      }
      return state;

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
  }
}
