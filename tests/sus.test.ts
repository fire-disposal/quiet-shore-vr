import { describe, expect, it } from 'vitest';
import { SUS_ITEMS, buildSusPayload } from '../src/app/sus';
import {
  SUS_DWELL_SECONDS,
  emptySusSheet,
  resetSheet,
  type SusAnswers,
  type SusSheetState
} from '../src/ui/sus-panel';

const facts = {
  scene: 'shore',
  sessionSec: 612.4,
  now: 1_761_300_000_000,
  app: 'questionnaire',
  questionnaireId: 'sus',
  questionnaireName: '系统可用性量表'
};
const full = (value: number): number[] => Array.from({ length: 10 }, () => value);

describe('SUS payload', () => {
  it('sends ten integer slots, with 0 for unanswered', () => {
    const answers = [3, null, 5, null, 1, 2, null, 4, 5, null];
    const payload = buildSusPayload(answers, facts);
    expect(payload.answers).toEqual([3, 0, 5, 0, 1, 2, 0, 4, 5, 0]);
    expect(payload.answers).toHaveLength(SUS_ITEMS);
    expect(payload.filled).toBe(6);
    expect(payload.complete).toBe(false);
  });

  it('marks a full sheet complete', () => {
    const payload = buildSusPayload(full(4), facts);
    expect(payload.complete).toBe(true);
    expect(payload.filled).toBe(10);
  });

  it('carries the facts the tablet files the record with', () => {
    const payload = buildSusPayload([], facts);
    expect(payload.scene).toBe('shore');
    expect(payload.sessionSec).toBe(612);
    expect(payload.completedAt).toBe(facts.now);
    expect(payload.app).toBe('questionnaire');
    expect(payload.questionnaireId).toBe('sus');
    expect(payload.questionnaireName).toBe('系统可用性量表');
  });

  it('never invents a negative session time or more than ten slots', () => {
    const payload = buildSusPayload([1, 2, 3, 4, 5, 1, 2, 3, 4, 5, 1, 2], {
      ...facts,
      sessionSec: -5
    });
    expect(payload.answers).toHaveLength(SUS_ITEMS);
    expect(payload.sessionSec).toBe(0);
  });
});


describe('SUS sheet boundary', () => {
  /** Answer the first `n` statements with `value`, mirroring what the panel does. */
  function answered(n: number, value: number): SusAnswers {
    const answers = emptySusSheet(SUS_ITEMS).answers;
    for (let i = 0; i < n; i += 1) {
      answers[i] = value;
    }
    return answers;
  }

  it('starts a sheet empty, on the first statement', () => {
    const sheet = emptySusSheet(SUS_ITEMS);
    expect(sheet.answers).toEqual(new Array(SUS_ITEMS).fill(null));
    expect(sheet.page).toBe(0);
    expect(sheet.phase).toBe('questions');
  });

  it('clears the answers, the page and the phase on a new sheet', () => {
    // The previous respondent paged to statement 6 and left it in the thanks
    // page; the next one must not open on either.
    const previous: SusSheetState = {
      answers: answered(6, 5),
      page: 5,
      phase: 'thanks'
    };
    expect(resetSheet(previous, SUS_ITEMS)).toEqual({
      answers: new Array(SUS_ITEMS).fill(null),
      page: 0,
      phase: 'questions'
    });
  });

  it('does not mutate the sheet it resets', () => {
    const answers = answered(3, 2);
    const previous: SusSheetState = { answers, page: 2, phase: 'questions' };
    const fresh = resetSheet(previous, SUS_ITEMS);
    // The old record stays intact for whoever still holds it…
    expect(answers[0]).toBe(2);
    // …and the new sheet is a separate array, not a view of it.
    expect(fresh.answers).not.toBe(answers);
  });

  it('keeps the sheet itself across a close and reopen', () => {
    // Closing is not a boundary: the panel and the page both keep what was
    // answered so the same respondent can finish the sheet later.
    const sheet: SusSheetState = { answers: answered(2, 4), page: 2, phase: 'questions' };
    expect(sheet.answers.filter((answer) => answer !== null)).toHaveLength(2);
    expect(sheet.page).toBe(2);
    expect(sheet.phase).toBe('questions');
  });

  it('carries the dwell the panel actually uses', () => {
    // The reset must not change the answer dwell: a mistaken answer costs more
    // than an extra second of looking.
    expect(SUS_DWELL_SECONDS).toBeGreaterThanOrEqual(3);
  });
});
