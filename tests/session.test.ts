import { describe, expect, it } from 'vitest';
import {
  INITIAL_SESSION,
  isActive,
  reduceSession,
  type SessionEvent
} from '../src/app/session';

const RUNNING_FLOAT = [
  { type: 'start', mode: 'float' },
  { type: 'calibrated' }
] as const satisfies readonly SessionEvent[];

describe('session reducer', () => {
  it('walks start → calibrated → stop → faded back to idle', () => {
    const s = [
      { type: 'start', mode: 'float' },
      { type: 'calibrated' },
      { type: 'stop', reason: 'technician' },
      { type: 'faded' }
    ] as const satisfies readonly SessionEvent[];
    expect(s.reduce(reduceSession, INITIAL_SESSION).phase).toBe('idle');
  });

  it('ignores start while a session is running', () => {
    const running = RUNNING_FLOAT.reduce(reduceSession, INITIAL_SESSION);
    expect(reduceSession(running, { type: 'start', mode: 'posture' })).toBe(running);
  });

  it('fixes the mode for the whole session', () => {
    const floating = RUNNING_FLOAT.reduce(reduceSession, INITIAL_SESSION);
    expect(floating.mode).toBe('float');
    expect(reduceSession(floating, { type: 'start', mode: 'posture' }).mode).toBe('float');
  });

  it('enters posture only when the session was started in posture mode', () => {
    const s = [
      { type: 'start', mode: 'posture' },
      { type: 'calibrated' }
    ] as const satisfies readonly SessionEvent[];
    expect(s.reduce(reduceSession, INITIAL_SESSION).phase).toBe('posture');
  });

  it('patient confirm records heading while calibrating', () => {
    const s = [
      { type: 'start', mode: 'float' },
      { type: 'confirm' }
    ] as const satisfies readonly SessionEvent[];
    expect(s.reduce(reduceSession, INITIAL_SESSION).phase).toBe('floating');
  });

  it('patient confirm stops a running session and never switches mode', () => {
    const floating = RUNNING_FLOAT.reduce(reduceSession, INITIAL_SESSION);
    expect(reduceSession(floating, { type: 'confirm' })).toEqual({
      phase: 'stopping',
      mode: 'float',
      stopReason: 'patient'
    });
  });

  it('confirm does nothing when idle or already stopping', () => {
    expect(reduceSession(INITIAL_SESSION, { type: 'confirm' })).toBe(INITIAL_SESSION);
    const stopping = reduceSession(
      RUNNING_FLOAT.reduce(reduceSession, INITIAL_SESSION),
      { type: 'stop', reason: 'link-lost' }
    );
    expect(reduceSession(stopping, { type: 'confirm' })).toBe(stopping);
  });

  it.each<[string, SessionEvent]>([
    ['technician', { type: 'stop', reason: 'technician' }],
    ['link-lost', { type: 'stop', reason: 'link-lost' }],
    ['headset-removed', { type: 'stop', reason: 'headset-removed' }],
    ['pose-lost', { type: 'stop', reason: 'pose-lost' }],
    ['session-end', { type: 'stop', reason: 'session-end' }]
  ])('stop reason %s is honoured while calibrating or running', (_name, stop) => {
    const calibrating = reduceSession(INITIAL_SESSION, { type: 'start', mode: 'posture' });
    expect(reduceSession(calibrating, stop).phase).toBe('stopping');

    const running = reduceSession(calibrating, { type: 'calibrated' });
    expect(reduceSession(running, stop).phase).toBe('stopping');
  });

  it('keeps the first stop reason while fading', () => {
    const stopping = [
      ...RUNNING_FLOAT,
      { type: 'stop', reason: 'link-lost' },
      { type: 'stop', reason: 'technician' }
    ] as const satisfies readonly SessionEvent[];
    expect(stopping.reduce(reduceSession, INITIAL_SESSION).stopReason).toBe('link-lost');
  });

  it('does not treat a stop from idle as a session', () => {
    expect(reduceSession(INITIAL_SESSION, { type: 'stop', reason: 'technician' })).toBe(
      INITIAL_SESSION
    );
  });

  it('switches mode mid-session and keeps the session alive', () => {
    const floating = RUNNING_FLOAT.reduce(reduceSession, INITIAL_SESSION);
    const posture = reduceSession(floating, { type: 'mode', mode: 'posture' });
    expect(posture).toEqual({ phase: 'posture', mode: 'posture', stopReason: null });
    const back = reduceSession(posture, { type: 'mode', mode: 'float' });
    expect(back).toEqual({ phase: 'floating', mode: 'float', stopReason: null });
  });

  it('ignores a mode switch outside a running session', () => {
    expect(reduceSession(INITIAL_SESSION, { type: 'mode', mode: 'posture' })).toBe(INITIAL_SESSION);
    const stopping = reduceSession(
      RUNNING_FLOAT.reduce(reduceSession, INITIAL_SESSION),
      { type: 'stop', reason: 'technician' }
    );
    expect(reduceSession(stopping, { type: 'mode', mode: 'posture' })).toBe(stopping);
  });

  it('confirms against the mode the session is in now', () => {
    const posture = reduceSession(RUNNING_FLOAT.reduce(reduceSession, INITIAL_SESSION), {
      type: 'mode',
      mode: 'posture'
    });
    expect(reduceSession(posture, { type: 'confirm' }).phase).toBe('stopping');
  });

  it('only reports motion-capable phases as active', () => {
    expect(isActive(INITIAL_SESSION)).toBe(false);
    const calibrating = reduceSession(INITIAL_SESSION, { type: 'start', mode: 'float' });
    expect(isActive(calibrating)).toBe(false);
    expect(isActive(reduceSession(calibrating, { type: 'calibrated' }))).toBe(true);
  });
});
