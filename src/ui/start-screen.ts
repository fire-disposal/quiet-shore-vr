import type { Strings } from './strings';
import { createGazeGuide } from './gaze-guide';

export interface StartScreenHandlers {
  onEnter: () => void;
}

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
 * tablet; this surface confirms it and starts WebXR with one gaze target.
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
  private readonly controllerGuide = optional<HTMLElement>('controller-guide');
  private readonly handlers: StartScreenHandlers;
  private readonly strings: Strings;
  private enterBusy = false;
  private enterAvailable = false;
  private seen = false;

  constructor(strings: Strings, handlers: StartScreenHandlers) {
    this.strings = strings;
    this.handlers = handlers;
    this.enter.addEventListener('click', handlers.onEnter);
    // The right-side confirm arrives as a normal click at gaze. Empty space
    // around the target is the same one-time gesture, so a patient does not
    // have to aim at a small button.
    this.start.addEventListener('click', (event) => {
      const target = event.target as HTMLElement | null;
      if (target && target.closest('button, a, input, label')) {
        return;
      }
      handlers.onEnter();
    });
    const guide = optional<HTMLCanvasElement>('gaze-guide');
    const visual = this.enter.querySelector('.target-visual');
    if (guide) {
      createGazeGuide(guide, (visual as HTMLElement | null) ?? this.enter);
    }
    this.enter.addEventListener('pointerenter', () => this.setSeen(true));
    this.enter.addEventListener('pointerleave', () => this.setSeen(false));
    this.enter.addEventListener('focus', () => this.setSeen(true));
    this.enter.addEventListener('blur', () => this.setSeen(false));
    window.addEventListener('pointermove', (event) => {
      if (this.enterBusy) return;
      const box = this.enter.getBoundingClientRect();
      const inside = event.clientX >= box.left && event.clientX <= box.right
        && event.clientY >= box.top && event.clientY <= box.bottom;
      this.setSeen(inside);
    }, { passive: true });
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
    if (busy) {
      this.setSeen(false);
    }
    this.setEnterLabel(busy ? this.strings.entering : '准备好就开始');
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
  }

  setHint(text: string): void {
    if (this.hint) {
      this.hint.textContent = text;
    }
  }

  private setSeen(seen: boolean): void {
    if (this.enterBusy || this.seen === seen) {
      return;
    }
    this.seen = seen;
    this.enter.classList.toggle('is-seen', seen);
    this.core?.classList.toggle('is-seen', seen);
    if (this.controllerGuide) {
      this.controllerGuide.setAttribute('aria-hidden', seen ? 'false' : 'true');
    }
    this.setEnterLabel(seen ? '按下头显右侧中间的按钮，或等操作员提示' : '准备好就开始');
  }

  private setEnterLabel(text: string): void {
    if (this.enterLabel) {
      this.enterLabel.textContent = text;
    } else {
      this.enter.textContent = text;
    }
  }
}
