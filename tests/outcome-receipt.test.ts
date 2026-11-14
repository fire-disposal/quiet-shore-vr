import { describe, expect, it } from 'vitest';
import { OUTCOME_RECORDED, type OutcomeReceipt } from '../src/app/outcome-receipt';

describe('outcome receipt', () => {
  it('names one fixed log kind', () => {
    // The tablet dispatches on this exact string; a rename is a wire break.
    expect(OUTCOME_RECORDED).toBe('outcome.recorded');
  });

  it('carries the slot, the value and when it was written', () => {
    // `slot` is what the tablet keys its two buttons on, so it must name the
    // half of the question — not the page's own field name (`attempted`).
    const attempt: OutcomeReceipt = { slot: 'attempt', value: true, at: 1700000000000 };
    const success: OutcomeReceipt = { slot: 'success', value: false, at: 1700000000001 };
    expect(Object.keys(attempt).sort()).toEqual(['at', 'slot', 'value']);
    expect(attempt.slot).toBe('attempt');
    expect(success.slot).toBe('success');
    expect(success.value).toBe(false);
  });

  it('serialises to the payload the tablet reads', () => {
    const receipt: OutcomeReceipt = { slot: 'success', value: true, at: 42 };
    expect(JSON.parse(JSON.stringify({ ...receipt }))).toEqual({
      slot: 'success',
      value: true,
      at: 42
    });
  });
});
