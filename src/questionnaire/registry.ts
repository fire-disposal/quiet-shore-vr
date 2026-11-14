import { GENERATED_QUESTIONNAIRES } from './generated';
import type { Questionnaire } from './contract';

export type {
  Questionnaire,
  QuestionnaireOption,
  QuestionnaireQuestion,
  QuestionnaireScoring
} from './contract';

/** Generated from questionnaires/*.json; never edited per application screen. */
export const QUESTIONNAIRES: readonly Questionnaire[] = GENERATED_QUESTIONNAIRES;
export const DEFAULT_QUESTIONNAIRE: Questionnaire = QUESTIONNAIRES[0];

export function getQuestionnaire(id: string): Questionnaire | undefined {
  return QUESTIONNAIRES.find((questionnaire) => questionnaire.id === id);
}
