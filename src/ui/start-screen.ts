import type { Strings } from './strings';

export interface StartScreenHandlers {
  onEnter: () => void;
  onShowPerfChange: (enabled: boolean) => void;
}

function element<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) {
    throw new Error(`missing #${id}`);
  }
  return node as T;
}

/**
 * Pre-session confirmation only. Scene choice belongs to the headset console
 * or the tablet; this surface confirms the pending scene and starts WebXR.
 */
export class StartScreen {
  readonly stageElement = element<HTMLElement>('stage');

  private readonly start = element<HTMLElement>('start');
  private readonly status = element<HTMLElement>('status');
  private readonly enter = element<HTMLButtonElement>('enter');
  private readonly scene = element<HTMLElement>('launch-scene');
  private readonly hint = element<HTMLElement>('enter-hint');
  private readonly confirm = element<HTMLElement>('start').querySelector('.confirm') as HTMLElement;
  private readonly settingsPanel = element<HTMLElement>('session-settings');
  private readonly openSettings = element<HTMLButtonElement>('open-settings');
  private readonly closeSettings = element<HTMLButtonElement>('close-settings');
  private readonly perfSetting = element<HTMLInputElement>('perf-setting');
  private readonly handlers: StartScreenHandlers;
  private readonly strings: Strings;
  private enterBusy = false;
  private enterAvailable = false;

  constructor(strings: Strings, handlers: StartScreenHandlers) {
    this.strings = strings;
    this.handlers = handlers;
    this.enter.addEventListener('click', handlers.onEnter);
    this.openSettings.addEventListener('click', () => this.setSettingsOpen(true));
    this.closeSettings.addEventListener('click', () => this.setSettingsOpen(false));
    this.perfSetting.addEventListener('change', () => {
      handlers.onShowPerfChange(this.perfSetting.checked);
    });
    // The right-side confirm arrives as a normal click at gaze. Empty space
    // around the card is the same one-time gesture, so the patient does not
    // have to aim at a small target.
    this.start.addEventListener('click', (event) => {
      const target = event.target as HTMLElement | null;
      if (target && target.closest('button, a, input, label')) {
        return;
      }
      handlers.onEnter();
    });
  }

  setStatus(text: string, tone: 'neutral' | 'ok' | 'error' = 'neutral'): void {
    this.status.textContent = text;
    this.status.dataset.tone = tone;
  }

  setScene(name: string): void {
    this.scene.textContent = name;
    this.enter.textContent = this.strings.enter;
  }

  setEnterEnabled(enabled: boolean): void {
    this.enterAvailable = enabled;
    this.enter.disabled = !enabled || this.enterBusy;
  }

  setEnterBusy(busy: boolean): void {
    this.enterBusy = busy;
    this.enter.disabled = !this.enterAvailable || busy;
    this.enter.textContent = busy ? this.strings.entering : this.strings.enter;
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
    this.hint.textContent = text;
  }

  setShowPerf(enabled: boolean): void {
    this.perfSetting.checked = enabled;
  }

  private setSettingsOpen(open: boolean): void {
    this.settingsPanel.hidden = !open;
    this.confirm.classList.toggle('is-settings', open);
    if (open) {
      this.perfSetting.focus();
    } else {
      this.openSettings.focus();
    }
  }
}
