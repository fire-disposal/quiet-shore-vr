import { element, optional } from './dom';

/**
 * The one thing the page asks for: a press.
 *
 * ```html
 * [按一下头显右侧的按钮]   ← the sentence, its underline is the pressable edge
 *   准备好就开始
 * ```
 *
 * The button is a target, not a hit test: the whole `.start` surface routes a
 * press here, because a patient lying down should not have to aim at a word.
 * `disabled` is the whole gate — still detecting, entering, in a session, ended
 * — so there is no second flag to keep in step with it.
 *
 * Three states, and the sentence is the same in all of them: it is the thing
 * the patient reads. Only the rule under it changes colour (`busy` = ice,
 * `ended` = the weak line, and the words themselves become the statement).
 */
export interface InstructionTargetHandlers {
  onPress: () => void;
}

export const INSTRUCTION_LABEL = '按一下头显右侧的按钮';
export const ENDED_LABEL = '训练已结束';

export class InstructionTarget {
  private readonly button = element<HTMLButtonElement>('enter');
  private readonly label = optional<HTMLElement>('enter-label');
  private readonly core = this.button.closest('.entry-core');
  private busy = false;
  private available = false;

  constructor(handlers: InstructionTargetHandlers) {
    this.button.addEventListener('click', () => {
      if (this.allows()) {
        handlers.onPress();
      }
    });
  }

  /**
   * The gate, in one place: no activation, no press. Every channel — the
   * button, the page's empty space, a pointerdown, Enter — asks this same
   * question, so a build that delivers the press differently still cannot
   * enter while the target is disabled.
   */
  allows(): boolean {
    return !this.button.disabled;
  }

  setEnabled(enabled: boolean): void {
    this.available = enabled;
    this.button.disabled = !enabled || this.busy;
  }

  setBusy(busy: boolean, busyLabel: string): void {
    this.busy = busy;
    this.button.disabled = !this.available || busy;
    this.setText(busy ? busyLabel : INSTRUCTION_LABEL);
    this.button.classList.toggle('is-busy', busy);
    element<HTMLElement>('start').setAttribute('aria-busy', busy ? 'true' : 'false');
  }

  /** After a session the target is a statement: it must not invite a press. */
  setEnded(ended: boolean): void {
    this.button.disabled = ended || !this.available;
    this.core?.classList.toggle('is-ended', ended);
    this.setText(ended ? ENDED_LABEL : INSTRUCTION_LABEL);
  }

  private setText(text: string): void {
    if (this.label) {
      this.label.textContent = text;
    } else {
      this.button.textContent = text;
    }
  }
}
