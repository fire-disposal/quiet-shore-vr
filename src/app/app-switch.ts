import type { SusAnswers } from '../ui/sus-panel';
import type { SessionPhase } from './session';

/**
 * Whether the operator may switch product face right now.
 *
 * The whole lifecycle has to be `idle`, not merely "not running". The wait
 * before the first capture is already `calibrating` while `capturePending` is
 * still false, so a guard that only refused running sessions and live captures
 * let the questionnaire open underneath the hold-still card — with
 * `awaitingCalibration` still set, so the patient's confirm started a training
 * calibration from inside the questionnaire.
 */
export function canSwitchApp(phase: SessionPhase, capturePending: boolean): boolean {
  return phase === 'idle' && !capturePending;
}

/**
 * Whether the sheet on screen has answers that have not been filed yet.
 *
 * Filing is once per sheet: the last answer files it, and closing files a
 * partial one, but a sheet that was already handed over must not be handed
 * over again — the tablet would hold two copies of the same ten answers for
 * one respondent.
 */
export function shouldFileSusSheet(answers: SusAnswers, filed: boolean): boolean {
  if (filed) {
    return false;
  }
  return answers.some((answer) => answer !== null);
}
