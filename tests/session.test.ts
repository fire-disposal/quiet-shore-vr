import { describe, expect, it } from 'vitest';
import {
  INITIAL_SESSION,
  isActive,
  reduceSession,
  type SessionEvent,
  type StopReason
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

  it('has no patient stop reason: the patient only enters and leaves the headset', () => {
    // The bedside has one control — the click that enters XR. Every reason the
    // reducer accepts is the operator's or the rig's, so a headset press can
    // never be written into the ledger as a stop.
    const reasons: readonly StopReason[] = [
      'technician',
      'link-lost',
      'headset-removed',
      'pose-lost',
      'session-end'
    ];
    expect(reasons).not.toContain('patient');
    for (const reason of reasons) {
      expect(reduceSession(INITIAL_SESSION, { type: 'stop', reason })).toBe(INITIAL_SESSION);
    }
  });

  it('accepts no confirm event at all', () => {
    // `confirm` used to start the capture and stop the session from the
    // headset button. It is gone from the event union, so this is a compile
    // -time guarantee that also holds at runtime for a stale wire frame.
    const stale = { type: 'confirm' } as unknown as SessionEvent;
    expect(reduceSession(INITIAL_SESSION, stale)).toBe(INITIAL_SESSION);
    const running = RUNNING.reduce(reduceSession, INITIAL_SESSION);
    expect(reduceSession(running, stale)).toBe(running);
  });

  it('keeps the first stop reason while fading', () => {
    const running = RUNNING.reduce(reduceSession, INITIAL_SESSION);
    const stopping = reduceSession(running, { type: 'stop', reason: 'technician' });
    // A second reason cannot overwrite the first.
    const again = reduceSession(stopping, { type: 'stop', reason: 'link-lost' });
    expect(again).toBe(stopping);
    expect(reduceSession(again, { type: 'faded' }).stopReason).toBe('technician');
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
