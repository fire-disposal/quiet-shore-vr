import type { Strings } from './strings';
import { element } from './dom';
import { DevicePictogram } from './device-pictogram';
import { HintLine } from './hint-line';
import { InstructionTarget } from './instruction-target';
import { StateRow } from './state-row';

export interface StartScreenHandlers {
  onEnter: () => void;
}

/**
 * Entry page and stage shell, in one object because they swap as one.
 *
 * It is orchestration only: the sentence is [InstructionTarget], its picture is
 * [DevicePictogram], the device state is [StateRow] and the report under it is
 * [HintLine]. This class owns the two things that belong to the screen as a
 * whole — where a press may come from, and which of the two surfaces is up.
 *
 * The page does **not** announce the scene. A scene can be switched from the
 * tablet mid-session, so naming one here would be a promise the next tap
 * breaks; the entry surface says the one thing the patient must do.
 */
export class StartScreen {
  readonly stageElement = element<HTMLElement>('stage');

  private readonly start = element<HTMLElement>('start');
  private readonly target = new InstructionTarget({ onPress: () => this.press() });
  private readonly state = new StateRow();
  private readonly hint = new HintLine();
  private readonly pictures = new DevicePictogram();
  private readonly handlers: StartScreenHandlers;
  private readonly strings: Strings;

  constructor(strings: Strings, handlers: StartScreenHandlers) {
    this.strings = strings;
    this.handlers = handlers;
    // The right-side confirm arrives as a normal click at the pointer. The
    // target is a cue, not a hit test: empty space around it is the same
    // one-time gesture, so a patient does not have to aim.
    this.start.addEventListener('click', (event) => {
      const target = event.target as HTMLElement | null;
      if (target && target.closest('button, a, input, label')) {
        return;
      }
      this.press();
    });
    // Where the press lands is still up to the runtime, which has delivered the
    // same button as a bare pointerdown and as Enter/Space in some builds. Only
    // the click used to be wired, so a build that sends a key could not enter at
    // all; every channel now lands in the same gated target.
    document.addEventListener('pointerdown', () => this.press(), { capture: true });
    document.addEventListener('keydown', (event) => {
      if (
        event.key === 'Enter' ||
        event.key === ' ' ||
        event.code === 'Enter' ||
        event.code === 'Space' ||
        event.keyCode === 13
      ) {
        this.press();
      }
    }, { capture: true });
  }

  /**
   * The one gesture the browser will not let us skip: `requestSession` needs a
   * transient user activation, and the target's `disabled` flag is the gate.
   */
  private press(): void {
    if (!this.target.allows()) {
      return;
    }
    this.handlers.onEnter();
  }

  setStatus(text: string, tone: 'neutral' | 'ok' | 'error' = 'neutral'): void {
    this.state.set(text, tone);
  }

  setEnterEnabled(enabled: boolean): void {
    this.target.setEnabled(enabled);
  }

  setEnterBusy(busy: boolean): void {
    this.target.setBusy(busy, this.strings.entering);
  }

  showStage(): void {
    this.start.hidden = true;
    this.stageElement.hidden = false;
  }

  showStart(): void {
    this.start.hidden = false;
    this.stageElement.hidden = true;
    this.target.setEnded(false);
    // The invitation is back: whatever this launch said about the entry is done.
    this.hint.setSticky('');
  }

  /**
   * After a session the entry target is not an invitation: the patient must
   * stay put until the operator starts again.
   */
  showEnded(): void {
    this.start.hidden = false;
    this.stageElement.hidden = true;
    this.target.setEnded(true);
    // The label already says the training ended; the hint is the one thing
    // left to do, which is nothing.
    this.hint.setSticky('请保持现在的姿势，等待工作人员。');
  }

  /** A report the page can lose (link state, a failed clip). */
  setHint(text: string): void {
    this.hint.set(text);
  }

  /** A sentence that speaks for the whole launch; outranks [setHint]. */
  setEntryHint(text: string): void {
    this.hint.setSticky(text);
  }
}
