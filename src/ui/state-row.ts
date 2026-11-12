import { element, optional } from './dom';

/**
 * The device state: one mark, one sentence.
 *
 * ```text
 *   ▏ 正在检测设备…
 * ```
 *
 * The mark is a 1 px rule in the ink of the sentence, told apart by tone — ice
 * when the page has something to report, muted while it is only waiting. It is
 * never red: red belongs to the operator's console, and a patient lying down
 * cannot act on an alarm.
 */
export class StateRow {
  private readonly row = element<HTMLElement>('status');
  private readonly text = optional<HTMLElement>('status-text');

  set(text: string, tone: 'neutral' | 'ok' | 'error' = 'neutral'): void {
    if (this.text) {
      this.text.textContent = text;
    } else {
      this.row.textContent = text;
    }
    this.row.dataset.tone = tone;
    // An empty state is absent, not blank: a reserved line would push the
    // instruction around between launches.
    this.row.hidden = text.length === 0;
  }
}
