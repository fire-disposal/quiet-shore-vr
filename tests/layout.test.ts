import { describe, expect, it, vi } from 'vitest';
import {
  createLayoutToken,
  invalidateLayout,
  isLayoutCurrent,
  nextLayoutTicket
} from '../src/app/layout';

/**
 * The scene swap runs 220 ms behind the curtain, so these tests reproduce the
 * order the audit found: command, then stop/exit/dispose, then the timer.
 */
describe('deferred scene change', () => {
  it('runs the swap when nothing happens in between', () => {
    vi.useFakeTimers();
    try {
      const token = createLayoutToken();
      const ticket = nextLayoutTicket(token);
      const swap = vi.fn();
      setTimeout(() => {
        if (isLayoutCurrent(token, ticket)) {
          swap();
        }
      }, 220);
      vi.advanceTimersByTime(220);
      expect(swap).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('drops a swap the session was stopped under', () => {
    vi.useFakeTimers();
    try {
      const token = createLayoutToken();
      const ticket = nextLayoutTicket(token);
      const swap = vi.fn();
      setTimeout(() => {
        if (isLayoutCurrent(token, ticket)) {
          swap();
        }
      }, 220);
      // The stop lands inside the curtain.
      vi.advanceTimersByTime(100);
      invalidateLayout(token);
      vi.advanceTimersByTime(120);
      expect(swap).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('drops a swap the page was disposed under', () => {
    const token = createLayoutToken();
    const ticket = nextLayoutTicket(token);
    invalidateLayout(token);
    expect(isLayoutCurrent(token, ticket)).toBe(false);
  });

  it('lets the next session order a swap of its own', () => {
    const token = createLayoutToken();
    const first = nextLayoutTicket(token);
    invalidateLayout(token);
    const second = nextLayoutTicket(token);
    expect(isLayoutCurrent(token, first)).toBe(false);
    expect(isLayoutCurrent(token, second)).toBe(true);
  });

  it('keeps only the newest of two queued scene commands', () => {
    // Two commands inside one curtain window must not swap the world twice:
    // the second is the operator's latest choice.
    const token = createLayoutToken();
    const ward = nextLayoutTicket(token);
    const shore = nextLayoutTicket(token);
    expect(isLayoutCurrent(token, ward)).toBe(false);
    expect(isLayoutCurrent(token, shore)).toBe(true);
  });

  it('never reissues a ticket across a whole run of stops', () => {
    const token = createLayoutToken();
    const seen = new Set<number>();
    for (let run = 0; run < 5; run += 1) {
      seen.add(nextLayoutTicket(token));
      invalidateLayout(token);
    }
    expect(seen.size).toBe(5);
  });
});
