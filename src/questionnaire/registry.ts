import type { LocalizedText } from '../core/scene/contract';

/**
 * Questionnaires are data, not screen code.
 *
 * One registry feeds the page (which draws the instrument in the headset), the
 * tablet (which renders the same questions and records the answers) and the
 * voice cue list. A new questionnaire is an entry here plus its clips; no
 * Kotlin map, no second copy of the wording.
 */
export interface QuestionnaireOption {
  readonly value: number;
  readonly label: LocalizedText;
}

export interface QuestionnaireQuestion {
  readonly id: string;
  readonly text: LocalizedText;
  /** Pre-generated cue read aloud when the question appears. */
  readonly voiceId: string;
}

export interface Questionnaire {
  readonly id: string;
  readonly name: LocalizedText;
  /** One phrase for the app card and the record list. */
  readonly short: LocalizedText;
  readonly questions: readonly QuestionnaireQuestion[];
  readonly options: readonly QuestionnaireOption[];
}

const OPTIONS: readonly QuestionnaireOption[] = [
  { value: 1, label: { zh: '非常不同意', en: 'Strongly disagree' } },
  { value: 2, label: { zh: '不同意', en: 'Disagree' } },
  { value: 3, label: { zh: '一般', en: 'Neutral' } },
  { value: 4, label: { zh: '同意', en: 'Agree' } },
  { value: 5, label: { zh: '非常同意', en: 'Strongly agree' } }
];

const SUS_TEXT: readonly string[] = [
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

export const SUS: Questionnaire = {
  id: 'sus',
  name: { zh: '系统可用性量表', en: 'System Usability Scale' },
  short: { zh: '十题，使用感受', en: 'Ten questions on usability' },
  questions: SUS_TEXT.map((zh, index) => ({
    id: `sus-${index + 1}`,
    text: { zh, en: zh },
    voiceId: `v-sus-${index + 1}`
  })),
  options: OPTIONS
};

export const QUESTIONNAIRES: readonly Questionnaire[] = [SUS];

export function getQuestionnaire(id: string): Questionnaire | undefined {
  return QUESTIONNAIRES.find((questionnaire) => questionnaire.id === id);
}
