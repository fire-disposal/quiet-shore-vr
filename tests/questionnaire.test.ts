import { describe, expect, it } from 'vitest';
import { QUESTIONNAIRES, SUS, getQuestionnaire } from '../src/questionnaire/registry';

describe('questionnaire registry', () => {
  it('is the one place the instrument is worded', () => {
    expect(QUESTIONNAIRES.map((questionnaire) => questionnaire.id)).toEqual(['sus']);
    expect(getQuestionnaire('sus')).toBe(SUS);
    expect(getQuestionnaire('moon')).toBeUndefined();
    expect(SUS.questions).toHaveLength(10);
    expect(SUS.options).toHaveLength(5);
  });

  it('keeps the instrument order and its voice cues', () => {
    // The generated cue catalogue is alphabetical; the sheet must not be.
    expect(SUS.questions.map((question) => question.voiceId)).toEqual(
      Array.from({ length: 10 }, (_, index) => `v-sus-${index + 1}`)
    );
    expect(SUS.questions[0].text.zh).toBe('我愿意经常使用这个系统。');
    expect(SUS.questions[9].text.zh).toContain('学习很多内容');
    expect(SUS.options.map((option) => option.value)).toEqual([1, 2, 3, 4, 5]);
  });

  it('has no empty copy a headset card would render as a blank', () => {
    for (const questionnaire of QUESTIONNAIRES) {
      expect(questionnaire.name.zh.trim()).not.toBe('');
      expect(questionnaire.short.zh.trim()).not.toBe('');
      for (const question of questionnaire.questions) {
        expect(question.text.zh.trim()).not.toBe('');
        expect(question.voiceId).toMatch(/^v-[a-z0-9-]+$/);
      }
    }
  });
});
