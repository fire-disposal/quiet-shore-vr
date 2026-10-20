import type { SceneSummary } from '../core/scene/contract';
import type { SceneId } from './scene-select';
import type { Strings } from './strings';

export interface StartScreenHandlers {
  onEnter: () => void;
  onPreview: () => void;
  onSelectScene: (id: SceneId) => void;
  onRecalibrate: () => void;
  onAudio: () => void;
  onExit: () => void;
  onLab: () => void;
  onDebugChange: (enabled: boolean) => void;
}

function element<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) {
    throw new Error(`missing #${id}`);
  }
  return node as T;
}

export class StartScreen {
  readonly stageElement = element<HTMLElement>('stage');

  private readonly start = element<HTMLElement>('start');
  private readonly hud = element<HTMLElement>('hud');
  private readonly toolbar = element<HTMLElement>('toolbar');
  private readonly status = element<HTMLElement>('status');
  private readonly enter = element<HTMLButtonElement>('enter');
  private readonly preview = element<HTMLButtonElement>('preview');
  private readonly audio = element<HTMLButtonElement>('audio');
  private readonly recalibrate = element<HTMLButtonElement>('recalibrate');
  private readonly exit = element<HTMLButtonElement>('exit');
  private readonly debug = element<HTMLInputElement>('debug');
  private readonly lab = element<HTMLButtonElement>('lab');
  private readonly sceneList = element<HTMLElement>('scene-list');
  private readonly sceneNote = element<HTMLElement>('scene-note');
  private readonly cards: Array<{ id: SceneId; node: HTMLButtonElement }> = [];
  private readonly strings: Strings;
  private readonly lang: 'zh' | 'en';
  private debugEnabled = false;

  constructor(
    scenes: readonly SceneSummary[],
    strings: Strings,
    lang: 'zh' | 'en',
    handlers: StartScreenHandlers
  ) {
    this.strings = strings;
    this.lang = lang;

    this.enter.addEventListener('click', handlers.onEnter);
    this.preview.addEventListener('click', handlers.onPreview);
    this.audio.addEventListener('click', handlers.onAudio);
    this.recalibrate.addEventListener('click', handlers.onRecalibrate);
    this.exit.addEventListener('click', handlers.onExit);
    this.lab.addEventListener('click', handlers.onLab);

    this.debug.addEventListener('change', () => {
      this.debugEnabled = this.debug.checked;
      this.lab.hidden = !this.debugEnabled;
      this.hud.hidden = !this.debugEnabled;
      handlers.onDebugChange(this.debugEnabled);
    });

    for (let i = 0; i < scenes.length; i += 1) {
      const scene = scenes[i];
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'scene-card';
      button.setAttribute('data-scene', scene.id);
      button.setAttribute('aria-pressed', 'false');

      const head = document.createElement('span');
      head.className = 'scene-card-head';
      const name = document.createElement('span');
      name.className = 'scene-card-name';
      name.textContent = scene.name[this.lang];
      const check = document.createElement('span');
      check.className = 'scene-card-check';
      check.setAttribute('aria-hidden', 'true');
      check.textContent = '已选';
      head.appendChild(name);
      head.appendChild(check);

      const tagline = document.createElement('span');
      tagline.className = 'scene-card-tag';
      tagline.textContent = scene.tagline[this.lang];

      const description = document.createElement('span');
      description.className = 'scene-card-desc';
      description.textContent = scene.description[this.lang];

      button.appendChild(head);
      button.appendChild(tagline);
      button.appendChild(description);
      button.addEventListener('click', () => handlers.onSelectScene(scene.id as SceneId));
      this.sceneList.appendChild(button);
      this.cards.push({ id: scene.id as SceneId, node: button });
    }
  }

  setSelected(id: SceneId): void {
    for (let i = 0; i < this.cards.length; i += 1) {
      const card = this.cards[i];
      const selected = card.id === id;
      card.node.classList.toggle('is-selected', selected);
      card.node.setAttribute('aria-pressed', selected ? 'true' : 'false');
    }
  }

  setStatus(text: string, tone: 'neutral' | 'ok' | 'error' = 'neutral'): void {
    this.status.textContent = text;
    this.status.dataset.tone = tone;
  }

  setEnterEnabled(enabled: boolean): void {
    this.enter.disabled = !enabled;
  }

  setRecalibrateEnabled(enabled: boolean): void {
    this.recalibrate.disabled = !enabled;
  }

  setAudioLabel(muted: boolean): void {
    this.audio.textContent = muted ? this.strings.audioOff : this.strings.audioOn;
  }

  setSceneNote(text: string): void {
    this.sceneNote.textContent = text;
  }

  setHud(lines: readonly string[]): void {
    this.hud.textContent = lines.join('\n');
    this.hud.hidden = !this.debugEnabled;
  }

  showStage(): void {
    this.start.hidden = true;
    this.stageElement.hidden = false;
    this.toolbar.hidden = false;
    this.hud.hidden = !this.debugEnabled;
  }

  showStart(): void {
    this.start.hidden = false;
    this.stageElement.hidden = true;
    this.toolbar.hidden = true;
    this.hud.hidden = true;
  }

  setLabVisible(visible: boolean): void {
    this.lab.hidden = !visible || !this.debugEnabled;
  }

  setDebug(enabled: boolean): void {
    this.debugEnabled = enabled;
    this.debug.checked = enabled;
    this.lab.hidden = !enabled;
    this.hud.hidden = !enabled;
  }

  get isDebug(): boolean {
    return this.debugEnabled;
  }
}
