import type { Questionnaire } from '../questionnaire/contract';

/**
 * How a sheet becomes a number.
 *
 * The page owns this, not the tablet: the tablet files whatever score arrives
 * and never derives one, so an instrument with no scoring rule files `null` and
 * nobody downstream has to know what a score means.
 *
 * This module owns instrument-specific scoring. Everything else — the panel,
 * the commands, the app — reads the registry and stays instrument-agnostic; a
 * new scored instrument is one branch here plus one `scoring` entry in the data.
 */
export type ScoringType = 'sus' | 'gad7';

/**
 * The SUS score: 0–100, from a complete sheet only.
 *
 * Standard scoring: odd items count `value - 1`, even items `5 - value`, and the
 * ten contributions sum to 0–40, scaled by 2.5. The result is rounded because
 * the tablet stores an integer and a half point of SUS is noise.
 *
 * An incomplete sheet has no score: a partial sum scaled to 0–100 would read as
 * a real measurement of a respondent who never finished.
 */
export function susScore(
  options: readonly number[],
  answers: ReadonlyArray<number | null>
): number | null {
  if (answers.length === 0 || answers.some((answer) => answer == null)) {
    return null;
  }
  // The scale is 1..5 even when the instrument publishes its options out of
  // order; map each answered value onto its rank so a reordered row still scores
  // the way the standard describes.
  const sorted = [...options].sort((left, right) => left - right);
  let sum = 0;
  for (let index = 0; index < answers.length; index += 1) {
    const answer = answers[index] as number;
    const rank = sorted.indexOf(answer);
    if (rank < 0) {
      return null;
    }
    // A five-point scale: the low end contributes 0, the high end 4.
    const normalised = rank / Math.max(1, sorted.length - 1);
    sum += (index % 2 === 0 ? normalised : 1 - normalised) * 4;
  }
  return Math.round((sum / answers.length) * 25);
}

/** GAD-7: seven 0–3 responses, summed to 0–21. Wire values 1–4 become ranks 0–3. */
export function gad7Score(
  options: readonly number[],
  answers: ReadonlyArray<number | null>
): number | null {
  if (answers.length !== 7 || answers.some((answer) => answer == null)) {
    return null;
  }
  const sorted = [...options].sort((left, right) => left - right);
  let score = 0;
  for (const answer of answers as readonly number[]) {
    const rank = sorted.indexOf(answer);
    if (rank < 0 || rank > 3) {
      return null;
    }
    score += rank;
  }
  return score;
}

/**
 * The score for a sheet of `questionnaire`, or null when it declares none.
 *
 * The declaration lives in the registry (`scoring: {type: 'sus'}`); this
 * function is the only reader of it, so adding a rule means adding a case here
 * and nothing anywhere else.
 */
export function scoreSheet(
  questionnaire: Questionnaire,
  answers: ReadonlyArray<number | null>
): number | null {
  const type = questionnaire.scoring?.type;
  if (!type) {
    return null;
  }
  switch (type) {
    case 'sus':
      return susScore(
        questionnaire.options.map((option) => option.value),
        answers
      );
    case 'gad7':
      return gad7Score(
        questionnaire.options.map((option) => option.value),
        answers
      );
    default:
      // A rule this build does not know is not a zero: the sheet is filed with
      // no score rather than with a made-up one.
      return null;
  }
}
