/**
 * Page → tablet receipts.
 *
 * A command the tablet sends and a command the page *did* are different facts.
 * The tablet used to treat "I sent it" as "it happened", which is wrong for the
 * bedside outcome: the operator taps 是, the write lands in the page's own
 * ledger, and the tablet's button would show a success it never confirmed.
 *
 * So the page answers with a `log` whose kind is fixed and whose payload names
 * the slot it recorded. The tablet flips its state on that receipt, never on
 * the command acknowledgement.
 */

/** Which half of the bedside question was written. */
export type OutcomeSlot = 'attempt' | 'success';

/** The `log` kind for one outcome write. */
export const OUTCOME_RECORDED = 'outcome.recorded';

/** The `d` payload of that log line. */
export interface OutcomeReceipt {
  readonly slot: OutcomeSlot;
  readonly value: boolean;
  /** Epoch milliseconds when the page wrote it, for ordering a delayed frame. */
  readonly at: number;
}
