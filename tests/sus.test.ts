import { describe, expect, it } from 'vitest';
import { SUS_ITEMS, buildSusPayload } from '../src/app/sus';

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
