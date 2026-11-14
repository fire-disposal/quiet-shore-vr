import { describe, expect, it } from 'vitest';
import {
  INITIAL_LINK,
  LINK_LOST_GRACE_MS,
  isFrozen,
  isLost,
  reduceLink,
  type LinkEvent
} from '../src/app/link-guard';

const drop = { type: 'drop' } as const satisfies LinkEvent;
const back = { type: 'return' } as const satisfies LinkEvent;

describe('link guard', () => {
  it('starts online and counts nothing down', () => {
    expect(INITIAL_LINK).toEqual({ phase: 'online', remainingMs: 0 });
    expect(isFrozen(INITIAL_LINK)).toBe(false);
    expect(isLost(INITIAL_LINK)).toBe(false);
  });

  it('freezes the session on a drop without ending it', () => {
    const frozen = reduceLink(INITIAL_LINK, drop);
    expect(frozen.phase).toBe('frozen');
    expect(frozen.remainingMs).toBe(LINK_LOST_GRACE_MS);
    // Freezing is not a stop: the session is still there to be continued.
    expect(isLost(frozen)).toBe(false);
  });

  it('continues the session when the link returns inside five seconds', () => {
    const frozen = reduceLink(INITIAL_LINK, drop);
    const elapsed = reduceLink(frozen, { type: 'elapse', ms: LINK_LOST_GRACE_MS - 100 });
    expect(elapsed.phase).toBe('frozen');
    const back1 = reduceLink(elapsed, back);
    expect(back1).toEqual({ phase: 'online', remainingMs: 0 });
    expect(isLost(back1)).toBe(false);
  });

  it('ends the session only once the whole window has elapsed', () => {
    const frozen = reduceLink(INITIAL_LINK, drop);
    const almost = reduceLink(frozen, { type: 'elapse', ms: LINK_LOST_GRACE_MS - 1 });
    expect(almost.phase).toBe('frozen');
    expect(almost.remainingMs).toBe(1);
    const lost = reduceLink(almost, { type: 'elapse', ms: 1 });
    expect(lost.phase).toBe('lost');
    expect(isLost(lost)).toBe(true);
  });

  it('does not restart the window when the socket flaps', () => {
    // A link that drops, returns and drops again inside the first window must
    // not buy itself another five seconds: the patient would be frozen forever.
    const first = reduceLink(INITIAL_LINK, drop);
    const spent = reduceLink(first, { type: 'elapse', ms: 4000 });
    const second = reduceLink(spent, drop);
    expect(second).toBe(spent);
    expect(second.remainingMs).toBe(1000);
  });

  it('ignores a return that was never preceded by a drop', () => {
    expect(reduceLink(INITIAL_LINK, back)).toBe(INITIAL_LINK);
  });

  it('ignores elapsed time while online or already lost', () => {
    expect(reduceLink(INITIAL_LINK, { type: 'elapse', ms: 5000 })).toBe(INITIAL_LINK);
    const lost = reduceLink(reduceLink(INITIAL_LINK, drop), {
      type: 'elapse',
      ms: LINK_LOST_GRACE_MS
    });
    expect(reduceLink(lost, { type: 'elapse', ms: 5000 })).toBe(lost);
  });

  it('cannot be revived by a reconnect after the session ended', () => {
    const lost = reduceLink(reduceLink(INITIAL_LINK, drop), {
      type: 'elapse',
      ms: LINK_LOST_GRACE_MS
    });
    // The tablet coming back after the timeout does not reopen a dead session;
    // only a `reset` (the next session) clears it.
    expect(reduceLink(lost, back)).toBe(lost);
    expect(reduceLink(lost, { type: 'reset' })).toEqual(INITIAL_LINK);
  });

  it('treats a non-positive or missing duration as no time at all', () => {
    const frozen = reduceLink(INITIAL_LINK, drop);
    expect(reduceLink(frozen, { type: 'elapse', ms: 0 })).toBe(frozen);
    expect(reduceLink(frozen, { type: 'elapse', ms: Number.NaN })).toBe(frozen);
    expect(reduceLink(frozen, { type: 'elapse', ms: -1000 })).toBe(frozen);
  });

  it('leaves an online guard untouched on reset', () => {
    expect(reduceLink(INITIAL_LINK, { type: 'reset' })).toBe(INITIAL_LINK);
  });
});
