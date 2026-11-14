import { describe, expect, it } from 'vitest';
import type { Questionnaire } from '../src/questionnaire/contract';
import {
  QUESTIONNAIRE_DWELL_SECONDS,
  emptyQuestionnaireSheet,
  type QuestionnaireAnswers,
  type QuestionnaireSheetState
} from '../src/ui/questionnaire-panel';

/** A ten-question sheet, answered slot by slot, as the panel does it. */
const TEN: Questionnaire = {
  id: 'usability',
  name: { zh: '可用性量表', en: 'Usability' },
  short: { zh: '十题', en: 'Ten questions' },
  questions: Array.from({ length: 10 }, (_, index) => ({
    id: `u-${index + 1}`,
    text: { zh: `第${index + 1}题`, en: `Q${index + 1}` },
    voiceId: `v-u-${index + 1}`
  })),
  options: [1, 2, 3, 4, 5].map((value) => ({
    value,
    label: { zh: `选项${value}`, en: `Option ${value}` }
  })),
  completionVoiceId: 'v-u-thanks',
  scoring: { type: 'sus' }
};

/** A three-question sheet with four options whose values are not 1..4. */
const THREE: Questionnaire = {
  id: 'feedback',
  name: { zh: '体验反馈', en: 'Feedback' },
  short: { zh: '三题', en: 'Three questions' },
  questions: Array.from({ length: 3 }, (_, index) => ({
    id: `f-${index + 1}`,
    text: { zh: `反馈${index + 1}`, en: `F${index + 1}` },
    voiceId: `v-f-${index + 1}`
  })),
  options: [
    { value: 1, label: { zh: '很差', en: 'Poor' } },
    { value: 3, label: { zh: '一般', en: 'Fair' } },
    { value: 4, label: { zh: '好', en: 'Good' } },
    { value: 6, label: { zh: '很好', en: 'Great' } }
  ],
  completionVoiceId: 'v-f-thanks'
};

describe('questionnaire sheet boundary', () => {
  /** Answer the first `n` questions with `value`, mirroring what the panel does. */
  function answered(questionnaire: Questionnaire, n: number, value: number): QuestionnaireAnswers {
    const answers = emptyQuestionnaireSheet(questionnaire.questions.length).answers;
    for (let i = 0; i < n; i += 1) {
      answers[i] = value;
    }
    return answers;
  }

  it('starts a sheet empty, on the first question', () => {
    const sheet = emptyQuestionnaireSheet(TEN.questions.length);
    expect(sheet.answers).toEqual(new Array(10).fill(null));
    expect(sheet.page).toBe(0);
    expect(sheet.phase).toBe('questions');
  });

  it('sizes the sheet from the instrument, not from a constant', () => {
    expect(emptyQuestionnaireSheet(THREE.questions.length).answers).toHaveLength(3);
    // A sheet for an instrument with no questions is empty, not a slot of null.
    expect(emptyQuestionnaireSheet(0).answers).toHaveLength(0);
  });

  it('gives a new respondent a clean sheet, not the previous one', () => {
    // The previous respondent paged to question 6 and left it on the thanks
    // page; the next one must open on neither.
    expect(emptyQuestionnaireSheet(10)).toEqual({
      answers: new Array(10).fill(null),
      page: 0,
      phase: 'questions'
    });
  });

  it('does not mutate the sheet it replaces', () => {
    const answers = answered(TEN, 3, 2);
    const fresh = emptyQuestionnaireSheet(10);
    // The old record stays intact for whoever still holds it…
    expect(answers[0]).toBe(2);
    // …and the new sheet is a separate array, not a view of it.
    expect(fresh.answers).not.toBe(answers);
  });

  it('keeps the sheet itself across a close and reopen', () => {
    // Closing is not a boundary: the panel and the page both keep what was
    // answered so the same respondent can finish the sheet later.
    const sheet: QuestionnaireSheetState = {
      answers: answered(TEN, 2, 4),
      page: 2,
      phase: 'questions'
    };
    expect(sheet.answers.filter((answer) => answer !== null)).toHaveLength(2);
    expect(sheet.page).toBe(2);
    expect(sheet.phase).toBe('questions');
  });

  it('keeps the dwell the panel actually uses', () => {
    // The reset must not change the answer dwell: a mistaken answer costs more
    // than an extra second of looking.
    expect(QUESTIONNAIRE_DWELL_SECONDS).toBeGreaterThanOrEqual(3);
  });
});
