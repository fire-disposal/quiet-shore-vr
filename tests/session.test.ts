import { describe, expect, it } from 'vitest';
import {
  INITIAL_SESSION,
  isActive,
  reduceSession,
  type SessionEvent
} from '../src/app/session';

const RUNNING = [
  { type: 'start' },
  { type: 'calibrated' }
] as const satisfies readonly SessionEvent[];

describe('session reducer', () => {
  it('walks start → calibrated → stop → faded back to idle', () => {
    const s = [
      { type: 'start' },
      { type: 'calibrated' },
      { type: 'stop', reason: 'technician' },
      { type: 'faded' }
    ] as const satisfies readonly SessionEvent[];
    const end = s.reduce(reduceSession, INITIAL_SESSION);
    expect(end.phase).toBe('idle');
    expect(end.stopReason).toBe('technician');
  });

  it('ignores start while a session is running', () => {
    const running = RUNNING.reduce(reduceSession, INITIAL_SESSION);
    expect(reduceSession(running, { type: 'start' })).toBe(running);
  });

  it('calibrates before it runs, never the other way round', () => {
    const started = reduceSession(INITIAL_SESSION, { type: 'start' });
    expect(started.phase).toBe('calibrating');
    expect(isActive(started)).toBe(false);
    const running = reduceSession(started, { type: 'calibrated' });
    expect(running.phase).toBe('running');
    expect(isActive(running)).toBe(true);
  });

  it('patient confirm records heading while calibrating', () => {
    const started = reduceSession(INITIAL_SESSION, { type: 'start' });
    const running = reduceSession(started, { type: 'confirm' });
    expect(running.phase).toBe('running');
    expect(isActive(running)).toBe(true);
  });

  it('patient confirm stops a running session', () => {
    const running = RUNNING.reduce(reduceSession, INITIAL_SESSION);
    const stopped = reduceSession(running, { type: 'confirm' });
    expect(stopped.phase).toBe('stopping');
    expect(stopped.stopReason).toBe('patient');
  });

  it('confirm does nothing when idle or already stopping', () => {
    expect(reduceSession(INITIAL_SESSION, { type: 'confirm' })).toBe(INITIAL_SESSION);
    const stopping = reduceSession(
      RUNNING.reduce(reduceSession, INITIAL_SESSION),
      { type: 'stop', reason: 'technician' }
    );
    expect(reduceSession(stopping, { type: 'confirm' })).toBe(stopping);
  });

  it('keeps the first stop reason while fading', () => {
    const running = RUNNING.reduce(reduceSession, INITIAL_SESSION);
    const stopping = reduceSession(running, { type: 'stop', reason: 'patient' });
    // A second reason cannot overwrite the first: the patient asked first.
    const again = reduceSession(stopping, { type: 'stop', reason: 'link-lost' });
    expect(again).toBe(stopping);
    expect(reduceSession(again, { type: 'faded' }).stopReason).toBe('patient');
  });

  it('does not treat a stop from idle as a session', () => {
    expect(reduceSession(INITIAL_SESSION, { type: 'stop', reason: 'technician' })).toBe(
      INITIAL_SESSION
    );
  });

  it('ignores a fade that was never requested', () => {
    const running = RUNNING.reduce(reduceSession, INITIAL_SESSION);
    expect(reduceSession(running, { type: 'faded' })).toBe(running);
  });

  it('only reports the running phase as active', () => {
    for (const phase of ['idle', 'calibrating', 'stopping'] as const) {
      expect(isActive({ phase, stopReason: null })).toBe(false);
    }
    expect(isActive({ phase: 'running', stopReason: null })).toBe(true);
  });
});
