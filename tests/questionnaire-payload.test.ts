import { describe, expect, it } from 'vitest';
import type { Questionnaire } from '../src/questionnaire/contract';
import {
  buildQuestionnaireResult,
  buildQuestionnaireState,
  emptyAnswers,
  questionLabel
} from '../src/app/questionnaire-payload';
import { gad7Score, scoreSheet, susScore } from '../src/app/scoring';

/**
 * Two instruments with different shapes, built here rather than taken from the
 * registry: the point of the generic code is that nothing in it knows how long
 * a sheet is or what values it accepts.
 */
const FIVE = [1, 2, 3, 4, 5].map((value) => ({
  value,
  label: { zh: `选项${value}`, en: `Option ${value}` }
}));

const TEN_QUESTIONS: Questionnaire = {
  id: 'usability',
  name: { zh: '可用性量表', en: 'Usability' },
  short: { zh: '十题', en: 'Ten questions' },
  questions: Array.from({ length: 10 }, (_, index) => ({
    id: `u-${index + 1}`,
    text: { zh: `第${index + 1}题`, en: `Q${index + 1}` },
    voiceId: `v-u-${index + 1}`
  })),
  options: FIVE,
  completionVoiceId: 'v-u-thanks',
  scoring: { type: 'sus' }
};

const FOUR_OPTIONS = [1, 2, 3, 4].map((value) => ({
  value,
  label: { zh: `等级${value}`, en: `Level ${value}` }
}));

const THREE_QUESTIONS: Questionnaire = {
  id: 'feedback',
  name: { zh: '体验反馈', en: 'Feedback' },
  short: { zh: '三题', en: 'Three questions' },
  questions: Array.from({ length: 3 }, (_, index) => ({
    id: `f-${index + 1}`,
    text: { zh: `反馈${index + 1}`, en: `F${index + 1}` },
    voiceId: `v-f-${index + 1}`
  })),
  options: FOUR_OPTIONS,
  completionVoiceId: 'v-f-thanks'
};

const facts = {
  scene: 'survey',
  sessionSec: 92.6,
  now: 1_761_300_000_000,
  app: 'questionnaire',
  score: null as number | null
};

describe('questionnaire result payload', () => {
  it('is as long as the instrument, not as long as SUS', () => {
    // The ten-and-five sheet and the three-and-four sheet differ in every
    // dimension the old fixed payload had hard-coded.
    const ten = buildQuestionnaireResult(TEN_QUESTIONS, emptyAnswers(TEN_QUESTIONS), facts);
    const three = buildQuestionnaireResult(THREE_QUESTIONS, emptyAnswers(THREE_QUESTIONS), facts);
    expect(ten.answers).toHaveLength(10);
    expect(three.answers).toHaveLength(3);
    expect(three.answers.every((answer) => answer === 0)).toBe(true);
    expect(three.questionnaireId).toBe('feedback');
    expect(three.questionnaireName).toBe('体验反馈');
  });

  it('carries the option values the instrument actually declares', () => {
    const answers = emptyAnswers(THREE_QUESTIONS);
    answers[0] = 4;
    answers[2] = 1;
    const payload = buildQuestionnaireResult(THREE_QUESTIONS, answers, facts);
    expect(payload.answers).toEqual([4, 0, 1]);
    expect(payload.filled).toBe(2);
    expect(payload.complete).toBe(false);
  });

  it('marks a sheet complete only when every slot is answered', () => {
    const answers = emptyAnswers(THREE_QUESTIONS);
    answers[0] = 2;
    answers[1] = 3;
    answers[2] = 4;
    const payload = buildQuestionnaireResult(THREE_QUESTIONS, answers, facts);
    expect(payload.complete).toBe(true);
    expect(payload.filled).toBe(3);
  });

  it('ignores answers past the instrument and never invents a slot', () => {
    const answers: (number | null)[] = [3, 3, 3, 5, 5];
    const payload = buildQuestionnaireResult(THREE_QUESTIONS, answers, facts);
    expect(payload.answers).toEqual([3, 3, 3]);
    expect(payload.complete).toBe(true);
  });

  it('carries the score it is handed, null included', () => {
    expect(buildQuestionnaireResult(THREE_QUESTIONS, [3, 3, 3], facts).score).toBeNull();
    expect(
      buildQuestionnaireResult(THREE_QUESTIONS, [3, 3, 3], { ...facts, score: 42 }).score
    ).toBe(42);
  });
});

describe('questionnaire live state', () => {
  it('reports the 1-based question, within the instrument', () => {
    const state = buildQuestionnaireState(THREE_QUESTIONS, {
      open: true,
      page: 1,
      answers: [1, null, null],
      gazeDwell: true,
      voice: false
    });
    expect(state.index).toBe(2);
    expect(state.answers).toEqual([1, 0, 0]);
    expect(state.voice).toBe(false);
    expect(state.open).toBe(true);
  });

  it('clamps a page past the instrument instead of pointing at nothing', () => {
    const state = buildQuestionnaireState(THREE_QUESTIONS, {
      open: true,
      page: 7,
      answers: [],
      gazeDwell: false,
      voice: true
    });
    expect(state.index).toBe(3);
    expect(state.answers).toHaveLength(3);
  });

  it('reports no question when the sheet holds none', () => {
    const empty: Questionnaire = { ...THREE_QUESTIONS, questions: [] };
    const state = buildQuestionnaireState(empty, {
      open: false,
      page: 0,
      answers: [],
      gazeDwell: true,
      voice: true
    });
    expect(state.index).toBe(0);
    expect(state.answers).toEqual([]);
  });

  it('names a question with its instrument and real count', () => {
    expect(questionLabel(THREE_QUESTIONS, 0)).toBe('FEEDBACK 1/3');
    expect(questionLabel(TEN_QUESTIONS, 9)).toBe('USABILITY 10/10');
  });
});

describe('scoring', () => {
  it('scores an alternating ten-question sheet on the 0-100 scale', () => {
    // Odd items 5 (best), even items 1 (best): the textbook maximum.
    const best = scoreSheet(TEN_QUESTIONS, [5, 1, 5, 1, 5, 1, 5, 1, 5, 1]);
    expect(best).toBe(100);
    const worst = scoreSheet(TEN_QUESTIONS, [1, 5, 1, 5, 1, 5, 1, 5, 1, 5]);
    expect(worst).toBe(0);
    const neutral = scoreSheet(TEN_QUESTIONS, [3, 3, 3, 3, 3, 3, 3, 3, 3, 3]);
    expect(neutral).toBe(50);
  });

  it('refuses to score a sheet that is not finished', () => {
    // A partial sum scaled to 100 would read as a real measurement of someone
    // who never finished the instrument.
    expect(susScore([1, 2, 3, 4, 5], [3, 3, 3, null, 3])).toBeNull();
    expect(scoreSheet(TEN_QUESTIONS, [5, 1, 5, 1, 5, 1, 5, 1, 5, null])).toBeNull();
  });

  it('files null for an instrument that declares no scoring', () => {
    expect(scoreSheet(THREE_QUESTIONS, [4, 4, 4])).toBeNull();
  });

  it('does not score an instrument whose options are outside its own scale', () => {
    const odd: Questionnaire = {
      ...TEN_QUESTIONS,
      options: [
        { value: 1, label: { zh: 'a', en: 'a' } },
        { value: 9, label: { zh: 'b', en: 'b' } }
      ]
    };
    // Two ranks map 1 and 9 onto the scale ends; the best answer is 9 on odd
    // items and 1 on even ones. A value that is not an option at all is refused
    // rather than scored as if it were.
    expect(scoreSheet(odd, [9, 1, 9, 1, 9, 1, 9, 1, 9, 1])).toBe(100);
    expect(scoreSheet(odd, [1, 9, 1, 9, 1, 9, 1, 9, 1, 9])).toBe(0);
    expect(scoreSheet(odd, [3, 9, 1, 9, 1, 9, 1, 9, 1, 9])).toBeNull();
  });

  it('scores by rank, so a reversed option order still reads the standard way', () => {
    const reversed: Questionnaire = {
      ...TEN_QUESTIONS,
      options: [...FIVE].reverse()
    };
    expect(scoreSheet(reversed, [5, 1, 5, 1, 5, 1, 5, 1, 5, 1])).toBe(100);
  });

  it('maps GAD-7 wire values 1..4 back to standard scores 0..21', () => {
    expect(gad7Score([1, 2, 3, 4], [1, 1, 1, 1, 1, 1, 1])).toBe(0);
    expect(gad7Score([1, 2, 3, 4], [4, 4, 4, 4, 4, 4, 4])).toBe(21);
    expect(gad7Score([1, 2, 3, 4], [1, 2, 3, 4, 1, 2, 3])).toBe(9);
    expect(gad7Score([1, 2, 3, 4], [1, 2, 3, null, 1, 2, 3])).toBeNull();
  });
});
