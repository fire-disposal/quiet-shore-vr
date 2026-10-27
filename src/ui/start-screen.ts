import type { Strings } from './strings';

export interface StartScreenHandlers {
  onEnter: () => void;
}

/** Restored whenever the page is inviting again; the picture says where. */
const ENTER_LABEL = '按一下头显右侧的按钮';

function element<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) {
    throw new Error(`missing #${id}`);
  }
  return node as T;
}

function optional<T extends HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

/**
 * Pre-session gate only. Scene choice belongs to the headset console or the
 * tablet; this surface confirms it, names the one button, and starts WebXR
 * from a single press.
 */
export class StartScreen {
  readonly stageElement = element<HTMLElement>('stage');

  private readonly start = element<HTMLElement>('start');
  private readonly status = element<HTMLElement>('status');
  private readonly statusText = optional<HTMLElement>('status-text');
  private readonly enter = element<HTMLButtonElement>('enter');
  private readonly enterLabel = optional<HTMLElement>('enter-label');
  private readonly scene = element<HTMLElement>('launch-scene');
  private readonly hint = optional<HTMLElement>('enter-hint');
  private readonly core = this.enter.closest('.entry-core');
  private readonly handlers: StartScreenHandlers;
  private readonly strings: Strings;
  private enterBusy = false;
  private enterAvailable = false;

  constructor(strings: Strings, handlers: StartScreenHandlers) {
    this.strings = strings;
    this.handlers = handlers;
    this.enter.addEventListener('click', () => this.press());
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
    // Where the press lands is still up to the runtime, which has delivered
    // the same button as a bare pointerdown and as Enter/Space in some builds.
    // Only the click used to be wired, so a build that sends a key could not
    // enter at all; every channel now lands in the same gated handler.
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
   * transient user activation, and a patient press is the only source of one.
   * The target's `disabled` flag already marks every phase where entry is
   * unwanted — still detecting, entering, in a session, ended — so it is the
   * whole gate.
   */
  private press(): void {
    if (this.enter.disabled) {
      return;
    }
    this.handlers.onEnter();
  }

  setStatus(text: string, tone: 'neutral' | 'ok' | 'error' = 'neutral'): void {
    if (this.statusText) {
      this.statusText.textContent = text;
    } else {
      this.status.textContent = text;
    }
    this.status.dataset.tone = tone;
    this.status.hidden = text.length === 0;
  }

  setScene(name: string): void {
    this.scene.textContent = name;
  }

  setEnterEnabled(enabled: boolean): void {
    this.enterAvailable = enabled;
    this.enter.disabled = !enabled || this.enterBusy;
  }

  setEnterBusy(busy: boolean): void {
    this.enterBusy = busy;
    this.enter.disabled = !this.enterAvailable || busy;
    this.setEnterLabel(busy ? this.strings.entering : ENTER_LABEL);
    this.enter.classList.toggle('is-busy', busy);
    this.start.setAttribute('aria-busy', busy ? 'true' : 'false');
  }

  showStage(): void {
    this.start.hidden = true;
    this.stageElement.hidden = false;
  }

  showStart(): void {
    this.start.hidden = false;
    this.stageElement.hidden = true;
    this.setEnded(false);
  }

  /**
   * After a session the entry target is not an invitation: the patient must
   * stay put until the operator starts again. Say so instead of re-prompting.
   */
  showEnded(): void {
    this.start.hidden = false;
    this.stageElement.hidden = true;
    this.setEnded(true);
    if (this.hint) {
      this.hint.textContent = '训练已结束。请保持现在的姿势，等待技术员。';
    }
  }

  private setEnded(ended: boolean): void {
    this.enter.disabled = ended || !this.enterAvailable;
    this.core?.classList.toggle('is-ended', ended);
    this.setEnterLabel(ended ? '训练已结束' : ENTER_LABEL);
  }

  setHint(text: string): void {
    if (this.hint) {
      this.hint.textContent = text;
    }
  }

  private setEnterLabel(text: string): void {
    if (this.enterLabel) {
      this.enterLabel.textContent = text;
    } else {
      this.enter.textContent = text;
    }
  }
}
