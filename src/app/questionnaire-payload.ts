import type { Questionnaire } from '../questionnaire/contract';

/**
 * The questionnaire world as the tablet receives it.
 *
 * The 20/28-byte state frame is frozen by the wire contract and has no room for
 * a record, so everything a sheet needs travels as JSON: page → headset app
 * (socket) → tablet (its own characteristic). Both ends must agree on the
 * shapes, so they are built here, in one place, and the Kotlin decoders mirror
 * them.
 *
 * Nothing in this module knows how many questions an instrument has, what its
 * option values are, nor what any instrument's score means. It only knows that
 * a questionnaire is data and that a sheet is as long as its instrument.
 */

/**
 * One filed sheet, on `questionnaire-result`.
 *
 * ```text
 * { answers: int[n] (0 = unanswered), filled, complete, score: number|null,
 *   scene, sessionSec, completedAt, app, questionnaireId, questionnaireName }
 * ```
 */
export interface QuestionnaireResultPayload {
  /** One slot per question, in instrument order; 0 means unanswered. */
  answers: number[];
  filled: number;
  complete: boolean;
  /** Computed by `scoring.ts`; null when the instrument publishes none. */
  score: number | null;
  scene: string;
  sessionSec: number;
  /** Epoch millis, taken from the headset clock. */
  completedAt: number;
  /** Product face that produced the sheet; the ledger's app field. */
  app: string;
  /** Instrument id and its label at filing time. */
  questionnaireId: string;
  questionnaireName: string;
}

/**
 * The live state of the sheet, on `questionnaire-state`.
 *
 * Pushed on every change and not persisted by anyone: it is the tablet's truth
 * for "which instrument, which question, what has been answered so far", which
 * the patient can change by gaze and the control side cannot infer.
 */
export interface QuestionnaireStatePayload {
  questionnaireId: string;
  open: boolean;
  /** 1-based question on the card; 0 when the card shows no question. */
  index: number;
  /** Positional answers in the instrument's own option values; 0 = unanswered. */
  answers: number[];
  gazeDwell: boolean;
  voice: boolean;
}

/** An empty sheet for an instrument, in that instrument's length. */
export function emptyAnswers(questionnaire: Questionnaire): (number | null)[] {
  return new Array<number | null>(questionnaire.questions.length).fill(null);
}

/** The answers as the wire carries them: 0 for an unanswered slot. */
function wireAnswers(
  questionnaire: Questionnaire,
  answers: ReadonlyArray<number | null>
): number[] {
  const slots: number[] = [];
  for (let index = 0; index < questionnaire.questions.length; index += 1) {
    const answer = answers[index];
    // An unanswered slot is 0 on the wire: JSON null would make the Kotlin
    // decoder branch on types it cannot see in a BLE notification.
    slots.push(answer == null ? 0 : answer);
  }
  return slots;
}

export function buildQuestionnaireResult(
  questionnaire: Questionnaire,
  answers: ReadonlyArray<number | null>,
  facts: {
    scene: string;
    sessionSec: number;
    now: number;
    app: string;
    score: number | null;
  }
): QuestionnaireResultPayload {
  const slots = wireAnswers(questionnaire, answers);
  const filled = slots.filter((answer) => answer !== 0).length;
  return {
    answers: slots,
    filled,
    complete: slots.length > 0 && filled === slots.length,
    score: facts.score,
    scene: facts.scene,
    sessionSec: Math.max(0, Math.round(facts.sessionSec)),
    completedAt: facts.now,
    app: facts.app,
    questionnaireId: questionnaire.id,
    questionnaireName: questionnaire.name.zh
  };
}

/**
 * The live state, built from where the panel actually is.
 *
 * `page` is 0-based inside the app and 1-based on the wire, because the tablet
 * labels the question the patient is looking at with a number.
 */
export function buildQuestionnaireState(
  questionnaire: Questionnaire,
  facts: {
    open: boolean;
    page: number;
    answers: ReadonlyArray<number | null>;
    gazeDwell: boolean;
    voice: boolean;
  }
): QuestionnaireStatePayload {
  const total = questionnaire.questions.length;
  // 0-based in, 1-based out: page 7 of a three-question sheet is the third
  // question, not a fourth slot the tablet would draw from nothing.
  const index = total > 0 ? Math.min(total - 1, Math.max(0, facts.page)) + 1 : 0;
  return {
    questionnaireId: questionnaire.id,
    open: facts.open,
    index,
    answers: wireAnswers(questionnaire, facts.answers),
    gazeDwell: facts.gazeDwell,
    voice: facts.voice
  };
}

/**
 * The operator-facing name of one question: `SUS 3/10`, `fb-2 1/3`.
 *
 * The instrument short name and the real question count, so a three-question
 * sheet never reads as a tenth of something.
 */
export function questionLabel(questionnaire: Questionnaire, index: number): string {
  return `${questionnaire.id.toUpperCase()} ${index + 1}/${questionnaire.questions.length}`;
}
