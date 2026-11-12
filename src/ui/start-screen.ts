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
  private readonly sceneField = optional<HTMLElement>('launch-index')?.closest<HTMLElement>('.entry-field') ?? null;
  private readonly sceneIndex = optional<HTMLElement>('launch-index');
  private readonly sceneTotal = optional<HTMLElement>('launch-total');
  private readonly hint = optional<HTMLElement>('enter-hint');
  /** A hint that speaks for this launch and must survive transient reports. */
  private stickyHint = '';
  private transientHint = '';
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

  /**
   * The scene is the operator's choice, so the page only states it: the name
   * in the top rule, the ordinal beside it. Without an ordinal (no registry
   * match yet) the field row hides rather than printing a made-up number.
   */
  setScene(name: string, index?: number, total?: number): void {
    this.scene.textContent = name;
    const known =
      typeof index === 'number' && typeof total === 'number' && index >= 1 && total >= 1;
    if (this.sceneIndex) {
      this.sceneIndex.textContent = known ? String(index).padStart(2, '0') : '';
    }
    if (this.sceneTotal) {
      this.sceneTotal.textContent = known ? String(total).padStart(2, '0') : '';
    }
    if (this.sceneField) {
      this.sceneField.hidden = !known;
    }
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
    // The invitation is back: whatever this launch said about the entry is done.
    this.setEntryHint('');
  }

  /**
   * After a session the entry target is not an invitation: the patient must
   * stay put until the operator starts again. Say so instead of re-prompting.
   */
  showEnded(): void {
    this.start.hidden = false;
    this.stageElement.hidden = true;
    this.setEnded(true);
    // The label already says the training ended; the hint is the one thing
    // left to do, which is nothing.
    this.setEntryHint('请保持现在的姿势，等待工作人员。');
  }

  private setEnded(ended: boolean): void {
    this.enter.disabled = ended || !this.enterAvailable;
    this.core?.classList.toggle('is-ended', ended);
    this.setEnterLabel(ended ? '训练已结束' : ENTER_LABEL);
  }

  /**
   * A report the page can lose (link state, a failed clip). It yields to an
   * entry hint, which is the one line the patient has to act on.
   */
  setHint(text: string): void {
    this.transientHint = text;
    this.renderHint();
  }

  /**
   * A hint that speaks for the whole launch — the shell relaunched this entry
   * because the last one was never confirmed, or the training has just ended.
   * It outranks [setHint] until the entry screen is invited again.
   */
  setEntryHint(text: string): void {
    this.stickyHint = text;
    this.renderHint();
  }

  private renderHint(): void {
    if (!this.hint) {
      return;
    }
    const text = this.stickyHint || this.transientHint;
    this.hint.textContent = text;
    // A sticky hint outranks reports, and it is the line the patient acts on,
    // so it is the one in full text.
    if (this.stickyHint) {
      this.hint.dataset.sticky = 'true';
    } else {
      delete this.hint.dataset.sticky;
    }
    // A hint that stays rendered as an empty line would push the entry target
    // around between launches; the element exists only while it has something
    // to say.
    this.hint.hidden = text.length === 0;
  }

  private setEnterLabel(text: string): void {
    if (this.enterLabel) {
      this.enterLabel.textContent = text;
    } else {
      this.enter.textContent = text;
    }
  }
}
