import * as THREE from 'three';
import { SpatialAnchor } from '../core/spatial/anchor';
import type { HeadPose } from '../core/xr/types';
import type { SpatialInteractable } from '../core/spatial/types';
import type { SpatialTheme } from '../core/spatial/theme';
import { SpatialButton } from './spatial/button';
import { SpatialSurface } from './spatial/surface';
import type { SpatialInput } from './spatial/input';

/**
 * System Usability Scale, answered by gaze.
 *
 * Ten statements, five options, and the headset has no pointer the patient can
 * use comfortably while lying down. Every target is a 5 second dwell, the same
 * interaction the rest of the spatial UI uses; the operator can still answer
 * from the tablet (`sus:answer:<1-5>`) when the patient cannot.
 *
 * The panel is head-locked at 0.9 m: it must follow the patient's head so a
 * supine person never has to turn to read it.
 */

const SUS_STATEMENTS: readonly string[] = [
  '我愿意经常使用这个系统。',
  '这个系统没有必要这么复杂。',
  '我觉得这个系统容易使用。',
  '我需要技术人员的帮助才能用这个系统。',
  '这个系统的各项功能整合得很好。',
  '这个系统有太多不一致的地方。',
  '我认为大多数人能很快学会使用这个系统。',
  '这个系统用起来很麻烦。',
  '使用这个系统时我很有信心。',
  '我需要先学习很多内容才能开始使用这个系统。'
];

const OPTION_LABELS = ['非常不同意', '不同意', '一般', '同意', '非常同意'];

/** Answer slots; the operator can also fill them from the tablet. */
export type SusAnswers = (number | null)[];

export interface SusPanelApi {
  readonly object: THREE.Object3D;
  open(): void;
  close(): void;
  isOpen(): boolean;
  /** Moves the page; the tablet's prev/next buttons drive this. */
  move(delta: number): void;
  /** Jumps to a question (0-based); the tablet's "显示" button drives this. */
  show(index: number): void;
  /** Records an answer (1..5) for the current item and advances. */
  answer(value: number): void;
  /** Rebuilds the registered targets with or without dwell. */
  setDwellEnabled(enabled: boolean): void;
  update(dt: number, now: number, head: HeadPose | null): void;
  dispose(): void;
}

export interface SusPanelOptions {
  scene: THREE.Scene;
  theme: SpatialTheme;
  input: SpatialInput;
  stringsDwellHint: string;
  onAnswer?: (index: number, value: number) => void;
  onClose?: () => void;
}

export function createSusPanel(options: SusPanelOptions): SusPanelApi {
  const { scene, theme, input } = options;
  // Summoned, not head-locked: the panel is placed once in front of the patient
  // and then frozen in the world. A head-locked panel moves with every glance,
  // which makes a stationary 5 second dwell impossible to complete.
  const anchor = new SpatialAnchor({
    mode: 'summoned',
    distance: 1.1,
    dampingSeconds: 0,
    // A supine patient looks slightly up; keep the panel inside a readable band.
    minPitchDeg: -10,
    maxPitchDeg: 45
  });
  const root = new THREE.Group();
  root.name = 'sus-panel';
  anchor.object.add(root);

  const surface = new SpatialSurface({
    width: 1.24,
    height: 0.74,
    theme,
    title: 'SUS 1/10',
    body: SUS_STATEMENTS[0],
    renderOrder: 1300
  });
  root.add(surface.object);

  const answers: SusAnswers = new Array(SUS_STATEMENTS.length).fill(null);
  let page = 0;
  let open = false;
  let dwellEnabled = true;

  const optionButtons: SpatialButton[] = OPTION_LABELS.map((label, index) => {
    const button = new SpatialButton({
      width: 0.216,
      height: 0.13,
      label,
      theme,
      renderOrder: 1310,
      dwellTime: 5
    });
    button.object.position.set(-0.452 + index * 0.226, -0.12, 0.002);
    button.onSelect = () => record(index + 1);
    root.add(button.object);
    return button;
  });

  const prevButton = new SpatialButton({
    width: 0.3,
    height: 0.11,
    label: '上一题',
    theme,
    renderOrder: 1310,
    dwellTime: 5
  });
  prevButton.object.position.set(-0.22, -0.28, 0.002);
  prevButton.onSelect = () => move(-1);
  root.add(prevButton.object);

  const nextButton = new SpatialButton({
    width: 0.3,
    height: 0.11,
    label: '下一题',
    theme,
    renderOrder: 1310,
    dwellTime: 5
  });
  nextButton.object.position.set(0.22, -0.28, 0.002);
  nextButton.onSelect = () => move(1);
  root.add(nextButton.object);

  const offs: Array<() => void> = [];

  function interactableFor(button: SpatialButton): SpatialInteractable {
    return {
      ...button.interactable,
      dwellTime: dwellEnabled ? 5 : 0,
      progressDisplay: 'self'
    };
  }

  function registerTargets(): void {
    unregisterTargets();
    if (!open) {
      return;
    }
    const targets = [...optionButtons, prevButton, nextButton];
    for (const button of targets) {
      const off = input.register(interactableFor(button));
      offs.push(off);
    }
  }

  function unregisterTargets(): void {
    for (const off of offs) {
      off();
    }
    offs.length = 0;
  }

  function render(): void {
    surface.setTitle(`SUS ${page + 1}/${SUS_STATEMENTS.length}`);
    const chosen = answers[page];
    surface.setBody(
      chosen === null
        ? SUS_STATEMENTS[page]
        : `${SUS_STATEMENTS[page]}\n已选：${OPTION_LABELS[chosen - 1]}`
    );
    const atStart = page === 0;
    const atEnd = page === SUS_STATEMENTS.length - 1;
    prevButton.setEnabled(!atStart);
    nextButton.setEnabled(!atEnd);
  }

  function move(delta: number): void {
    const next = Math.min(SUS_STATEMENTS.length - 1, Math.max(0, page + delta));
    if (next === page) {
      return;
    }
    page = next;
    render();
  }

  function record(value: number): void {
    if (value < 1 || value > 5) {
      return;
    }
    answers[page] = value;
    options.onAnswer?.(page, value);
    render();
    if (page < SUS_STATEMENTS.length - 1) {
      move(1);
    }
  }

  anchor.setVisible(false);
  scene.add(anchor.object);
  render();

  return {
    object: root,
    open(): void {
      if (open) {
        return;
      }
      open = true;
      anchor.setVisible(true);
      render();
      registerTargets();
    },
    close(): void {
      if (!open) {
        return;
      }
      open = false;
      anchor.setVisible(false);
      unregisterTargets();
      options.onClose?.();
    },
    isOpen: () => open,
    move,
    show(index: number): void {
      if (index < 0 || index >= SUS_STATEMENTS.length) {
        return;
      }
      page = index;
      if (!open) {
        open = true;
        anchor.setVisible(true);
        registerTargets();
      }
      render();
    },
    answer: record,
    setDwellEnabled(enabled: boolean): void {
      dwellEnabled = enabled;
      if (open) {
        registerTargets();
      }
    },
    update(dt: number, now: number, head: HeadPose | null): void {
      if (!open || !head) {
        return;
      }
      // Summoned mode places the panel on the first update; visibility only
      // sticks once placement has happened, so it is asserted after the update.
      anchor.update(head, dt, now);
      anchor.setVisible(true);
    },
    dispose(): void {
      unregisterTargets();
      for (const button of [...optionButtons, prevButton, nextButton]) {
        button.dispose();
      }
      scene.remove(anchor.object);
      anchor.object.remove(root);
      anchor.dispose();
    }
  };
}
