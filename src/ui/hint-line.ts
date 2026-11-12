import { optional } from './dom';

/**
 * The second line: a report the page may lose.
 *
 * Two ranks, and the rank is the whole design:
 *
 * - **sticky** — a sentence that speaks for this launch ("没有等到确认…",
 *   "请保持现在的姿势…"). It outranks every report, is drawn in full ink, and
 *   survives transient updates until the entry screen is invited again.
 * - **transient** — a passing report (link state, a clip that failed to load).
 *   It yields to a sticky hint, because the sticky line is the one the patient
 *   has to act on.
 *
 * An empty line is `hidden`, never rendered: a reserved gap would move the
 * instruction between launches.
 */
export class HintLine {
  private readonly node = optional<HTMLElement>('enter-hint');
  private stickyText = '';
  private transientText = '';

  /** A report the page may overwrite with the next one. */
  set(text: string): void {
    this.transientText = text;
    this.render();
  }

  /** A sentence for the whole launch; it outranks [set] until reset. */
  setSticky(text: string): void {
    this.stickyText = text;
    this.render();
  }

  private render(): void {
    if (!this.node) {
      return;
    }
    const text = this.stickyText || this.transientText;
    this.node.textContent = text;
    if (this.stickyText) {
      this.node.dataset.sticky = 'true';
    } else {
      delete this.node.dataset.sticky;
    }
    this.node.hidden = text.length === 0;
  }
}
