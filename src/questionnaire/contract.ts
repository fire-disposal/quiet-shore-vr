import type { LocalizedText } from '../core/scene/contract';

export interface QuestionnaireOption {
  readonly value: number;
  readonly label: LocalizedText;
}

export interface QuestionnaireQuestion {
  readonly id: string;
  readonly text: LocalizedText;
  readonly voiceId: string;
}

export interface QuestionnaireScoring {
  readonly type: 'sus' | 'gad7';
}

/** A compile-time content unit shared by the headset and control APK. */
export interface Questionnaire {
  readonly id: string;
  readonly name: LocalizedText;
  readonly short: LocalizedText;
  readonly questions: readonly QuestionnaireQuestion[];
  readonly options: readonly QuestionnaireOption[];
  readonly completionVoiceId: string;
  readonly scoring?: QuestionnaireScoring;
}
