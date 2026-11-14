import * as THREE from 'three';
import { SpatialAnchor } from '../core/spatial/anchor';
import type { HeadPose } from '../core/xr/types';
import type { SpatialInteractable } from '../core/spatial/types';
import type { SpatialTheme } from '../core/spatial/theme';
import { SpatialButton } from './spatial/button';
import { SpatialSurface } from './spatial/surface';
import type { SpatialInput } from './spatial/input';
import type { Questionnaire } from '../questionnaire/contract';

const HEADER_TEMPLATE = '第 {n} 题，共 {total} 题';
const GUIDE = '看向一个选项，停住。';
const FINISH_BODY = '所有题目都答完了。\n看向「完成」，就结束。';
const THANKS_BODY = '可以摘下头显了。\n有感受请告诉工作人员。';

export type QuestionnaireAnswers = (number | null)[];
export type QuestionnairePhase = 'questions' | 'finish' | 'thanks';

export interface QuestionnaireSheetState {
  readonly answers: QuestionnaireAnswers;
  readonly page: number;
  readonly phase: QuestionnairePhase;
}

export function emptyQuestionnaireSheet(questionCount: number): QuestionnaireSheetState {
  return {
    answers: new Array<number | null>(Math.max(0, questionCount)).fill(null),
    page: 0,
    phase: 'questions'
  };
}

export interface QuestionnairePanelApi {
  readonly object: THREE.Object3D;
  open(): void;
  close(): void;
  isOpen(): boolean;
  questionnaire(): Questionnaire;
  page(): number;
  phase(): QuestionnairePhase;
  answers(): QuestionnaireAnswers;
  move(delta: number): void;
  show(index: number): void;
  answer(value: number): void;
  replay(): void;
  reset(): void;
  setDwellEnabled(enabled: boolean): void;
  update(dt: number, now: number, head: HeadPose | null): void;
  dispose(): void;
}

export const QUESTIONNAIRE_DWELL_SECONDS = 3;

export interface QuestionnairePanelOptions {
  scene: THREE.Scene;
  theme: SpatialTheme;
  input: SpatialInput;
  questionnaire: Questionnaire;
  onAnswer?: (index: number, value: number) => void;
  onClose?: () => void;
  onShow?: (index: number, firstTime: boolean) => void;
  onFinish?: () => void;
}

/** v1.0.0 spatial presentation, generalized only at the data boundary. */
export function createQuestionnairePanel(
  options: QuestionnairePanelOptions
): QuestionnairePanelApi {
  const { scene, theme, input, questionnaire } = options;
  const anchor = new SpatialAnchor({
    mode: 'summoned',
    distance: 1.2,
    dampingSeconds: 0,
    minPitchDeg: -10,
    maxPitchDeg: 45
  });
  const root = new THREE.Group();
  root.name = 'questionnaire-panel';
  anchor.object.add(root);

  const CARD_WIDTH = 1.5;
  const CARD_TOP = 0.4;
  const BOTTOM_PAD = 0.045;
  const OPTION_HALF = 0.065;
  const PAGER_HALF = 0.055;
  const HEADER_PX = 26;
  const HEADER_EM = 1.05;
  const HEADER_TOP = CARD_TOP - 0.03;
  const HEADER_GAP = 0.045;
  const BODY_PX = 60;
  const BODY_LINE_HEIGHT = 1.3;
  const PAGER_Y = -0.255;
  const OPTION_Y = PAGER_Y + PAGER_HALF + 0.03 + OPTION_HALF;
  const BODY_BOTTOM = OPTION_Y + OPTION_HALF + 0.03;
  const CARD_BOTTOM = PAGER_Y - PAGER_HALF - BOTTOM_PAD;
  const CARD_HEIGHT = CARD_TOP - CARD_BOTTOM;

  const surface = new SpatialSurface({
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    theme,
    renderOrder: 1300,
    reserveBottom: 0,
    titlePx: HEADER_PX,
    titleEm: HEADER_EM,
    bodyPx: BODY_PX,
    bodyTexturePx: 1024,
    layout: {
      headerTop: HEADER_TOP,
      headerGap: HEADER_GAP,
      bodyBottom: BODY_BOTTOM,
      lineHeight: BODY_LINE_HEIGHT,
      bodyColor: theme.text
    }
  });
  root.add(surface.object);

  let answers: QuestionnaireAnswers = emptyQuestionnaireSheet(questionnaire.questions.length).answers;
  let page = 0;
  let phase: QuestionnairePhase = 'questions';
  let open = false;
  let dwellEnabled = true;
  let needsPlacement = false;
  let spokenPage = -1;
  let offs: Array<() => void> = [];

  const optionCount = questionnaire.options.length;
  const buttonWidth = 0.216;
  const pitch = Math.min(0.248, (CARD_WIDTH - 0.1 - buttonWidth) / Math.max(1, optionCount - 1));
  const left = -((optionCount - 1) * pitch) / 2;
  const optionButtons = questionnaire.options.map((option, index) => {
    const button = new SpatialButton({
      width: buttonWidth,
      height: OPTION_HALF * 2,
      label: option.label.zh,
      theme,
      renderOrder: 1310,
      dwellTime: QUESTIONNAIRE_DWELL_SECONDS
    });
    button.object.position.set(left + index * pitch, OPTION_Y, 0.002);
    button.onSelect = () => record(option.value);
    root.add(button.object);
    return button;
  });

  const prevButton = new SpatialButton({
    width: 0.3,
    height: 0.11,
    label: '上一题',
    theme,
    renderOrder: 1310,
    dwellTime: QUESTIONNAIRE_DWELL_SECONDS
  });
  prevButton.object.position.set(-0.22, PAGER_Y, 0.002);
  prevButton.onSelect = () => move(-1);
  root.add(prevButton.object);

  const nextButton = new SpatialButton({
    width: 0.3,
    height: 0.11,
    label: '下一题',
    theme,
    renderOrder: 1310,
    dwellTime: QUESTIONNAIRE_DWELL_SECONDS
  });
  nextButton.object.position.set(0.22, PAGER_Y, 0.002);
  nextButton.onSelect = () => phase === 'finish' ? enterThanks() : move(1);
  root.add(nextButton.object);

  function interactableFor(button: SpatialButton): SpatialInteractable {
    return {
      ...button.interactable,
      dwellTime: dwellEnabled ? QUESTIONNAIRE_DWELL_SECONDS : 0,
      progressDisplay: 'self'
    };
  }

  function unregisterTargets(): void {
    for (const off of offs) off();
    offs = [];
  }

  function registerTargets(): void {
    unregisterTargets();
    if (!open) return;
    const targets = phase === 'questions'
      ? [...optionButtons, ...(prevButton.interactable.enabled ? [prevButton] : []), nextButton]
      : phase === 'finish' ? [nextButton] : [];
    for (const button of targets) offs.push(input.register(interactableFor(button)));
  }

  function render(): void {
    const total = questionnaire.questions.length;
    if (phase === 'questions') {
      const question = questionnaire.questions[page];
      const answered = answers[page] != null;
      surface.setTitle(HEADER_TEMPLATE.replace('{n}', String(page + 1)).replace('{total}', String(total)));
      surface.setBody(answered ? question.text.zh : `${question.text.zh}\n${GUIDE}`);
      prevButton.setEnabled(page > 0);
      nextButton.setEnabled(true);
      nextButton.setLabel(page === total - 1 ? '完成' : '下一题');
      questionnaire.options.forEach((option, index) => {
        optionButtons[index].setChosen(answered && answers[page] === option.value);
        optionButtons[index].object.visible = true;
      });
      prevButton.object.visible = true;
      nextButton.object.visible = true;
    } else {
      surface.setTitle(phase === 'finish' ? '最后一步' : '谢谢您');
      surface.setBody(phase === 'finish' ? FINISH_BODY : THANKS_BODY);
      for (const button of optionButtons) button.object.visible = false;
      prevButton.object.visible = false;
      nextButton.object.visible = phase === 'finish';
      nextButton.setLabel('完成');
    }
    registerTargets();
    if (open && phase === 'questions' && spokenPage !== page) {
      const firstTime = spokenPage === -1;
      spokenPage = page;
      options.onShow?.(page, firstTime);
    }
  }

  function enterFinish(): void {
    if (phase !== 'questions') return;
    phase = 'finish';
    render();
  }

  function enterThanks(): void {
    if (phase !== 'finish') return;
    phase = 'thanks';
    render();
    options.onFinish?.();
  }

  function move(delta: number): void {
    const total = questionnaire.questions.length;
    if (!total) return;
    if (delta > 0 && page === total - 1) {
      enterFinish();
      return;
    }
    const next = Math.min(total - 1, Math.max(0, page + delta));
    if (next === page) return;
    page = next;
    render();
  }

  function record(value: number): void {
    if (phase !== 'questions' || !questionnaire.options.some((option) => option.value === value)) return;
    answers[page] = value;
    options.onAnswer?.(page, value);
    if (page < questionnaire.questions.length - 1) page += 1;
    render();
  }

  anchor.setVisible(false);
  scene.add(anchor.object);
  render();

  return {
    object: root,
    open(): void {
      if (open) return;
      open = true;
      needsPlacement = true;
      spokenPage = -1;
      render();
    },
    close(): void {
      if (!open) return;
      open = false;
      anchor.setVisible(false);
      unregisterTargets();
      options.onClose?.();
    },
    isOpen: () => open,
    questionnaire: () => questionnaire,
    page: () => page,
    phase: () => phase,
    answers: () => answers.slice(),
    move,
    show(index: number): void {
      if (index < 0 || index >= questionnaire.questions.length) return;
      page = index;
      phase = 'questions';
      if (!open) {
        open = true;
        needsPlacement = true;
      }
      render();
    },
    answer: record,
    replay(): void {
      if (!open || phase !== 'questions') return;
      options.onShow?.(page, false);
      registerTargets();
    },
    reset(): void {
      answers = emptyQuestionnaireSheet(questionnaire.questions.length).answers;
      page = 0;
      phase = 'questions';
      spokenPage = -1;
      needsPlacement = true;
      render();
    },
    setDwellEnabled(enabled: boolean): void {
      dwellEnabled = enabled;
      registerTargets();
    },
    update(dt: number, now: number, head: HeadPose | null): void {
      if (!open || !head) return;
      if (needsPlacement) {
        needsPlacement = false;
        anchor.summon(head);
      }
      anchor.update(head, dt, now);
      anchor.setVisible(true);
    },
    dispose(): void {
      unregisterTargets();
      for (const button of [...optionButtons, prevButton, nextButton]) button.dispose();
      surface.dispose();
      scene.remove(anchor.object);
      anchor.object.remove(root);
      anchor.dispose();
    }
  };
}
