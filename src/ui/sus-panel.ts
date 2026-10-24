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
 * use comfortably while lying down. Every target uses the same dwell, the same
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

const OPTION_LABELS = ['很不同意', '不同意', '一般', '同意', '很同意'];

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

/**
 * Gaze dwell for every SUS target.
 *
 * The 5 s dwell this panel used to carry fired after roughly two seconds of
 * looking in the headset. The panel is the one place where a mistaken answer is
 * expensive, so the dwell is set to 8 s: four times the trigger a patient
 * noticed, not a number that merely looks plausible on paper. Field tuning
 * brought it 8 s → 4 s → 3 s: still half again the observed ~2 s premature
 * trigger, without reading as stuck.
 */
export const SUS_DWELL_SECONDS = 3;

export interface SusPanelOptions {
  scene: THREE.Scene;
  theme: SpatialTheme;
  input: SpatialInput;
  stringsDwellHint: string;
  onAnswer?: (index: number, value: number) => void;
  onClose?: () => void;
  /**
   * Called whenever a new statement appears on the card (open, pager, or the
   * automatic advance after an answer). The app speaks it; the panel never
   * touches audio.
   */
  onShow?: (index: number, firstTime: boolean) => void;
  /**
   * The patient dwelled the finish target after the last statement: the card
   * turns into the thank-you page and the app speaks the closing line and
   * stops driving the sheet. The panel never touches audio.
   */
  onFinish?: () => void;
}

export function createSusPanel(options: SusPanelOptions): SusPanelApi {
  const { scene, theme, input } = options;
  // Summoned, not head-locked: the panel is placed once in front of the patient
  // and then frozen in the world. A head-locked panel moves with every glance,
  // which makes a stationary 5 second dwell impossible to complete.
  const anchor = new SpatialAnchor({
    mode: 'summoned',
    distance: 1.2,
    dampingSeconds: 0,
    // A supine patient looks slightly up; keep the panel inside a readable band.
    minPitchDeg: -10,
    maxPitchDeg: 45
  });
  const root = new THREE.Group();
  root.name = 'sus-panel';
  anchor.object.add(root);

  // The card carries only the statement; the answer row sits below it. With a
  // full-height card the buttons landed on top of the body text.
  // One card holds everything: title, statement, the five-point row and the
  // pager. The reserved bottom band is what keeps the statement off the
  // controls instead of floating buttons outside the panel.
  const surface = new SpatialSurface({
    // Wider and taller than the old card: the statement is now ~12 cm per glyph
    // at 1.2 m, which needs three lines for the longest item.
    width: 1.5,
    height: 1.02,
    theme,
    title: 'SUS 1/10',
    body: SUS_STATEMENTS[0],
    renderOrder: 1300,
    reserveBottom: 0.3,
    // A big statement, a small caption: the card is read at 1.2 m and the
    // statement is the only thing the patient has to parse. The "SUS 5/10"
    // counter is furniture, so it shrank; the statement grew.
    titlePx: 26,
    bodyPx: 88,
    bodyTexturePx: 1024
  });
  root.add(surface.object);

  const answers: SusAnswers = new Array(SUS_STATEMENTS.length).fill(null);
  let page = 0;
  /** questions → finish (dwell target) → thanks. Pager/answers only touch questions. */
  let phase: 'questions' | 'finish' | 'thanks' = 'questions';
  let open = false;
  let dwellEnabled = true;
  /**
   * Summoned anchors never place themselves: `SpatialAnchor.update` returns
   * early until something calls `summon(head)`. The panel has no head pose in
   * `open()`, so it remembers to place on the first update after opening.
   */
  let needsPlacement = false;

  const optionButtons: SpatialButton[] = OPTION_LABELS.map((label, index) => {
    const button = new SpatialButton({
      width: 0.216,
      height: 0.13,
      label,
      theme,
      renderOrder: 1310,
      dwellTime: SUS_DWELL_SECONDS
    });
    button.object.position.set(-0.496 + index * 0.248, -0.22, 0.002);
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
    dwellTime: SUS_DWELL_SECONDS
  });
  prevButton.object.position.set(-0.22, -0.36, 0.002);
  prevButton.onSelect = () => move(-1);
  root.add(prevButton.object);

  const nextButton = new SpatialButton({
    width: 0.3,
    height: 0.11,
    label: '下一题',
    theme,
    renderOrder: 1310,
    dwellTime: SUS_DWELL_SECONDS
  });
  nextButton.object.position.set(0.22, -0.36, 0.002);
  nextButton.onSelect = () => move(1);
  root.add(nextButton.object);

  const offs: Array<() => void> = [];

  function interactableFor(button: SpatialButton): SpatialInteractable {
    return {
      ...button.interactable,
      dwellTime: dwellEnabled ? SUS_DWELL_SECONDS : 0,
      progressDisplay: 'self'
    };
  }

  function registerTargets(): void {
    unregisterTargets();
    if (!open) {
      return;
    }
    const targets =
      phase === 'questions'
        ? [...optionButtons, prevButton, nextButton]
        : phase === 'finish'
          ? [nextButton]
          : [];
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

  /** Last statement read aloud, so a re-render does not repeat it. */
  let spokenPage = -1;

  function render(): void {
    if (phase !== 'questions') {
      return;
    }
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
    // The pager stays live at the end: that is where it becomes the finish
    // target. Disabling it here left "完成" inert — nothing to dwell on.
    nextButton.setEnabled(true);
    nextButton.setLabel(atEnd ? '完成' : '下一题');
    for (const button of optionButtons) {
      button.object.visible = true;
    }
    prevButton.object.visible = true;
    nextButton.object.visible = true;
    if (open && spokenPage !== page) {
      const firstTime = spokenPage === -1;
      spokenPage = page;
      options.onShow?.(page, firstTime);
    }
  }

  /** After the last statement: one dwell target between the sheet and the thanks. */
  function enterFinish(): void {
    if (phase !== 'questions') {
      return;
    }
    phase = 'finish';
    surface.setTitle('最后一步');
    surface.setBody('十道题都答完了。\n再看向下面的「完成」，我们就结束。');
    for (const button of optionButtons) {
      button.object.visible = false;
    }
    prevButton.object.visible = false;
    nextButton.setLabel('完成');
    nextButton.object.visible = true;
    registerTargets();
  }

  /** The dwell target fired: thank the patient and hand the rest to the app. */
  function enterThanks(): void {
    if (phase !== 'finish') {
      return;
    }
    phase = 'thanks';
    surface.setTitle('谢谢您');
    surface.setBody('可以摘下来了，慢慢来。\n有什么想说的，\n随时告诉身边的护士或医生。');
    nextButton.object.visible = false;
    registerTargets();
    options.onFinish?.();
  }

  function move(delta: number): void {
    if (delta > 0 && page === SUS_STATEMENTS.length - 1) {
      // Past the last statement the pager is the finish target.
      enterFinish();
      return;
    }
    const next = Math.min(SUS_STATEMENTS.length - 1, Math.max(0, page + delta));
    if (next === page) {
      return;
    }
    page = next;
    render();
    // Re-register after the card changed: the gaze is very likely still parked
    // on the option it just picked, and that button now belongs to the next
    // statement. Fresh registrations drop the latch and the accumulated
    // progress, so a held gaze has to start the dwell over instead of sliding
    // an accidental answer in (the occasional misfire this replaces).
    if (open && phase === 'questions') {
      registerTargets();
    }
  }

  function record(value: number): void {
    if (value < 1 || value > 5) {
      return;
    }
    answers[page] = value;
    options.onAnswer?.(page, value);
    render();
    if (page < SUS_STATEMENTS.length - 1) {
      // move() re-registers: the answered button must not carry its latch into
      // the next statement.
      move(1);
    } else if (open) {
      registerTargets();
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
      needsPlacement = true;
      spokenPage = -1;
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
        needsPlacement = true;
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
      // Place in front of the patient on the first frame after opening (and
      // again on every reopen, so a panel opened later is never behind them).
      if (needsPlacement) {
        needsPlacement = false;
        anchor.summon(head);
      }
      // Visibility only sticks once placement has happened.
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
