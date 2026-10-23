/**
 * Session lifecycle as a pure reducer. No XR, DOM or BLE dependencies, so every
 * transition is testable. Mode is fixed for the whole session; every stop
 * path converges on `stopping` and then `idle`.
 */

export type SessionMode = 'float' | 'posture';

export type SessionPhase = 'idle' | 'calibrating' | 'floating' | 'posture' | 'stopping';

export type StopReason =
  | 'patient'
  | 'technician'
  | 'link-lost'
  | 'headset-removed'
  | 'pose-lost'
  | 'session-end';

export interface SessionState {
  readonly phase: SessionPhase;
  readonly mode: SessionMode;
  readonly stopReason: StopReason | null;
}

export type SessionEvent =
  | { readonly type: 'start'; readonly mode: SessionMode }
  | { readonly type: 'confirm' }
  | { readonly type: 'calibrated' }
  /** Operator switches mode mid-session; only legal while motion is running. */
  | { readonly type: 'mode'; readonly mode: SessionMode }
  | { readonly type: 'stop'; readonly reason: StopReason }
  | { readonly type: 'faded' };

export const INITIAL_SESSION: SessionState = {
  phase: 'idle',
  mode: 'float',
  stopReason: null
};

/** Phases in which the patient is inside a session and motion may run. */
export function isActive(state: SessionState): boolean {
  return state.phase === 'floating' || state.phase === 'posture';
}

export function reduceSession(state: SessionState, event: SessionEvent): SessionState {
  switch (event.type) {
    case 'start':
      // Start is accepted only from idle; a running session is never re-armed.
      if (state.phase !== 'idle') {
        return state;
      }
      return { phase: 'calibrating', mode: event.mode, stopReason: null };

    case 'calibrated':
      if (state.phase !== 'calibrating') {
        return state;
      }
      return {
        phase: state.mode === 'posture' ? 'posture' : 'floating',
        mode: state.mode,
        stopReason: null
      };

    case 'confirm':
      // Patient button: records the heading while calibrating, otherwise
      // only ever stops. It never switches mode.
      if (state.phase === 'calibrating') {
        return reduceSession(state, { type: 'calibrated' });
      }
      if (isActive(state)) {
        return { phase: 'stopping', mode: state.mode, stopReason: 'patient' };
      }
      return state;

    case 'mode':
      // Switching mode is a running-session action: the phase follows the mode
      // so `floating` and `posture` stay the only motion-capable states.
      if (state.phase !== 'floating' && state.phase !== 'posture') {
        return state;
      }
      if (state.mode === event.mode) {
        return state;
      }
      return {
        phase: event.mode === 'posture' ? 'posture' : 'floating',
        mode: event.mode,
        stopReason: null
      };

    case 'stop':
      // Stop precedence: every reason is honoured from any running phase.
      if (state.phase === 'idle' || state.phase === 'stopping') {
        return state;
      }
      return { phase: 'stopping', mode: state.mode, stopReason: event.reason };

    case 'faded':
      if (state.phase !== 'stopping') {
        return state;
      }
      return { phase: 'idle', mode: state.mode, stopReason: state.stopReason };
  }
}
