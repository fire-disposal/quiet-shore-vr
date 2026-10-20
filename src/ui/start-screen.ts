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
  onPerfChange: (enabled: boolean) => void;
}

interface SceneCard {
  readonly id: SceneId;
  readonly node: HTMLButtonElement;
  readonly name: string;
  readonly tagline: string;
  readonly description: string;
}

/** Keys that move focus inside the single-select scene group. */
const MOVE_KEYS = ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End'];

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
  private readonly toolbar = element<HTMLElement>('toolbar');
  private readonly status = element<HTMLElement>('status');
  private readonly enter = element<HTMLButtonElement>('enter');
  private readonly preview = element<HTMLButtonElement>('preview');
  private readonly audio = element<HTMLButtonElement>('audio');
  private readonly recalibrate = element<HTMLButtonElement>('recalibrate');
  private readonly exit = element<HTMLButtonElement>('exit');
  private readonly perf = element<HTMLInputElement>('perf');
  private readonly sceneList = element<HTMLElement>('scene-list');
  private readonly sceneNote = element<HTMLElement>('scene-note');
  private readonly scenePicker = element<HTMLElement>('scene-picker');
  private readonly scenePreview = element<HTMLElement>('scene-preview');
  private readonly previewIndex = element<HTMLElement>('preview-index');
  private readonly previewName = element<HTMLElement>('preview-name');
  private readonly previewDesc = element<HTMLElement>('preview-desc');
  private readonly launchScene = element<HTMLElement>('launch-scene');
  private readonly launchNote = element<HTMLElement>('launch-note');
  private readonly cards: SceneCard[] = [];
  private readonly handlers: StartScreenHandlers;
  private readonly strings: Strings;
  private readonly lang: 'zh' | 'en';
  private selectedId: SceneId | null = null;
  private minimal = false;
  private enterBusy = false;
  private enterAvailable = false;
  private enterIdleLabel = '';

  constructor(
    scenes: readonly SceneSummary[],
    strings: Strings,
    lang: 'zh' | 'en',
    handlers: StartScreenHandlers
  ) {
    this.strings = strings;
    this.lang = lang;
    this.handlers = handlers;
    this.enterIdleLabel = strings.enter;

    this.enter.addEventListener('click', handlers.onEnter);
    // Firefox Reality's right-side confirm arrives as a normal click at gaze.
    // Treat a click on empty start-page space as the same one-time gesture, so
    // the patient does not have to aim at a small button.
    this.start.addEventListener('click', (event) => {
      const target = event.target as HTMLElement | null;
      if (target && target.closest('button, input, label, a')) {
        return;
      }
      handlers.onEnter();
    });
    this.preview.addEventListener('click', handlers.onPreview);
    this.audio.addEventListener('click', handlers.onAudio);
    this.recalibrate.addEventListener('click', handlers.onRecalibrate);
    this.exit.addEventListener('click', handlers.onExit);

    this.perf.addEventListener('change', () => {
      handlers.onPerfChange(this.perf.checked);
    });

    // The note is announced as a whole whenever the selection settles.
    this.sceneNote.setAttribute('aria-atomic', 'true');
    this.sceneList.addEventListener('keydown', this.onKeyDown);

    for (let i = 0; i < scenes.length; i += 1) {
      this.cards.push(this.createCard(scenes[i], i));
    }
    if (this.cards.length > 0) {
      // Roving tabindex: the group is one tab stop until a card is selected.
      this.cards[0].node.tabIndex = 0;
    }
  }

  setSelected(id: SceneId): void {
    this.selectedId = id;
    let matched = false;
    for (let i = 0; i < this.cards.length; i += 1) {
      const card = this.cards[i];
      const selected = card.id === id;
      matched = matched || selected;
      card.node.classList.toggle('is-selected', selected);
      card.node.setAttribute('aria-pressed', selected ? 'true' : 'false');
      card.node.tabIndex = selected ? 0 : -1;
      if (selected) {
        this.launchScene.textContent = `${this.strings.sceneTitle}：${card.name}`;
        this.enterIdleLabel = `${this.strings.enter} ${card.name}`;
        this.scenePreview.dataset.scene = card.id;
        this.previewIndex.textContent = String(i + 1).padStart(2, '0');
        this.previewName.textContent = card.name;
        this.previewDesc.textContent = card.description;
        if (!this.enterBusy) {
          this.enter.textContent = this.enterIdleLabel;
        }
      }
    }
    // A stale stored id must not leave the whole group out of the tab order.
    if (!matched && this.cards.length > 0) {
      this.cards[0].node.tabIndex = 0;
    }
  }

  setStatus(text: string, tone: 'neutral' | 'ok' | 'error' = 'neutral'): void {
    this.status.textContent = text;
    this.status.dataset.tone = tone;
  }

  setEnterEnabled(enabled: boolean): void {
    this.enterAvailable = enabled;
    this.enter.disabled = !enabled || this.enterBusy;
  }

  setEnterBusy(busy: boolean): void {
    this.enterBusy = busy;
    this.enter.disabled = !this.enterAvailable || busy;
    this.enter.textContent = busy ? this.strings.entering : this.enterIdleLabel;
    this.enter.classList.toggle('is-busy', busy);
    this.start.setAttribute('aria-busy', busy ? 'true' : 'false');
  }

  setRecalibrateEnabled(enabled: boolean): void {
    this.recalibrate.disabled = !enabled;
  }

  setAudioLabel(muted: boolean): void {
    this.audio.textContent = muted ? this.strings.audioOff : this.strings.audioOn;
  }

  /** Patient-facing scene copy; engineering stats belong to the optional performance bar. */
  setSceneNote(text: string): void {
    this.sceneNote.textContent = text;
    this.launchNote.textContent = text;
  }

  /** Portal launch: hide choices, keep one primary action and an optional switch. */
  setMinimal(minimal: boolean): void {
    this.minimal = minimal;
    this.start.classList.toggle('is-minimal', minimal);
    this.scenePicker.hidden = minimal;
    this.preview.hidden = minimal;
    this.launchScene.hidden = !minimal;
    this.launchNote.hidden = !minimal;
  }

  get isMinimal(): boolean {
    return this.minimal;
  }

  showStage(): void {
    this.start.hidden = true;
    this.stageElement.hidden = false;
    this.toolbar.hidden = false;
  }

  showStart(): void {
    this.start.hidden = false;
    this.stageElement.hidden = true;
    this.toolbar.hidden = true;
  }

  setPerf(enabled: boolean): void {
    this.perf.checked = enabled;
  }

  /**
   * Cards are generated from the registry, so a scene added later gets a card
   * without touching this file. The thumbnail art is pure CSS keyed on
   * `data-scene`; unknown ids fall back to the neutral gradient.
   */
  private createCard(scene: SceneSummary, index: number): SceneCard {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'scene-card';
    button.dataset.scene = scene.id;
    button.setAttribute('aria-pressed', 'false');
    button.tabIndex = -1;

    const order = document.createElement('span');
    order.className = 'scene-card-index';
    order.setAttribute('aria-hidden', 'true');
    order.textContent = String(index + 1).padStart(2, '0');

    const body = document.createElement('span');
    body.className = 'scene-card-body';

    const head = document.createElement('span');
    head.className = 'scene-card-head';

    const name = document.createElement('span');
    name.className = 'scene-card-name';
    name.textContent = scene.name[this.lang];

    const check = document.createElement('span');
    check.className = 'scene-card-check';
    check.setAttribute('aria-hidden', 'true');
    check.textContent = this.strings.sceneSelected;

    const tagline = document.createElement('span');
    tagline.className = 'scene-card-tag';
    tagline.textContent = scene.tagline[this.lang];

    head.appendChild(name);
    head.appendChild(check);
    body.appendChild(head);
    body.appendChild(tagline);
    button.appendChild(order);
    button.appendChild(body);

    const id = scene.id as SceneId;
    button.addEventListener('click', () => this.choose(id));

    this.sceneList.appendChild(button);
    return {
      id,
      node: button,
      name: scene.name[this.lang],
      tagline: scene.tagline[this.lang],
      description: scene.description[this.lang]
    };
  }

  /**
   * Optimistic selection: the host answers synchronously and may call
   * `setSelected` again to roll back (for example inside a VR session).
   */
  private choose(id: SceneId): void {
    this.setSelected(id);
    this.handlers.onSelectScene(id);
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (this.cards.length === 0 || MOVE_KEYS.indexOf(event.key) === -1) {
      return;
    }
    const active = document.activeElement;
    let index = -1;
    for (let i = 0; i < this.cards.length; i += 1) {
      if (this.cards[i].node === active) {
        index = i;
        break;
      }
    }
    for (let i = 0; index === -1 && i < this.cards.length; i += 1) {
      if (this.cards[i].id === this.selectedId) {
        index = i;
      }
    }
    if (index === -1) {
      index = 0;
    }

    let next = index;
    if (event.key === 'Home') {
      next = 0;
    } else if (event.key === 'End') {
      next = this.cards.length - 1;
    } else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      next = (index + 1) % this.cards.length;
    } else {
      next = (index - 1 + this.cards.length) % this.cards.length;
    }

    event.preventDefault();
    const card = this.cards[next];
    card.node.focus();
    this.choose(card.id);
  };
}
