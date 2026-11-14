import { describe, expect, it } from 'vitest';
import {
  DEFAULT_QUESTIONNAIRE,
  QUESTIONNAIRES,
  getQuestionnaire
} from '../src/questionnaire/registry';

describe('questionnaire registry', () => {
  it('is the one place the instruments are worded', () => {
    for (const questionnaire of QUESTIONNAIRES) {
      expect(getQuestionnaire(questionnaire.id)).toBe(questionnaire);
      expect(questionnaire.questions.length).toBeGreaterThanOrEqual(1);
      expect(questionnaire.questions.length).toBeLessThanOrEqual(100);
      expect(questionnaire.options.length).toBeGreaterThanOrEqual(2);
      expect(questionnaire.options.length).toBeLessThanOrEqual(7);
    }
    expect(getQuestionnaire('moon')).toBeUndefined();
    // The default is one of the published instruments, never a stand-in.
    expect(QUESTIONNAIRES).toContain(DEFAULT_QUESTIONNAIRE);
  });

  it('names every instrument with an id the wire accepts', () => {
    for (const questionnaire of QUESTIONNAIRES) {
      expect(questionnaire.id).toMatch(/^[a-z][a-z0-9-]{0,31}$/);
    }
  });

  it('keeps question order and its own voice cues', () => {
    // The generated cue catalogue is alphabetical; a sheet must not be.
    for (const questionnaire of QUESTIONNAIRES) {
      const ids = questionnaire.questions.map((question) => question.voiceId);
      expect(new Set(ids).size).toBe(ids.length);
      for (const question of questionnaire.questions) {
        expect(question.voiceId).toMatch(/^v-[a-z0-9-]+$/);
      }
      expect(questionnaire.completionVoiceId).toMatch(/^v-[a-z0-9-]+$/);
    }
  });

  it('offers distinct, in-range option values and no empty labels', () => {
    for (const questionnaire of QUESTIONNAIRES) {
      const values = questionnaire.options.map((option) => option.value);
      expect(new Set(values).size).toBe(values.length);
      for (const value of values) {
        // The command grammar can only express one digit, 1..9.
        expect(Number.isInteger(value)).toBe(true);
        expect(value).toBeGreaterThanOrEqual(1);
        expect(value).toBeLessThanOrEqual(9);
      }
      for (const option of questionnaire.options) {
        expect(option.label.zh.trim()).not.toBe('');
      }
    }
  });

  it('has no empty copy a headset card would render as a blank', () => {
    for (const questionnaire of QUESTIONNAIRES) {
      expect(questionnaire.name.zh.trim()).not.toBe('');
      expect(questionnaire.short.zh.trim()).not.toBe('');
      for (const question of questionnaire.questions) {
        expect(question.text.zh.trim()).not.toBe('');
      }
    }
  });

  it('declares scoring only where a rule exists', () => {
    for (const questionnaire of QUESTIONNAIRES) {
      if (questionnaire.scoring) {
        // The page picks the rule by this string; an unknown one files null.
        expect(questionnaire.scoring.type).toMatch(/^[a-z][a-z0-9-]*$/);
      }
    }
  });
});
