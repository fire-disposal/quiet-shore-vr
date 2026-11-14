import { describe, expect, it } from 'vitest';
import { canSwitchApp, shouldFileQuestionnaireSheet } from '../src/app/app-switch';
import { INITIAL_SESSION, isActive, reduceSession, type SessionEvent } from '../src/app/session';

const empty = (length = 10): (number | null)[] =>
  new Array<number | null>(length).fill(null);

describe('app switch guard', () => {
  // The order the audit found: enter VR, the lifecycle reaches `calibrating`,
  // the technician has not started the capture yet.
  const waitingForTechnician = reduceSession(INITIAL_SESSION, { type: 'start' });

  it('refuses a switch while the first capture is not started yet', () => {
    expect(waitingForTechnician.phase).toBe('calibrating');
    // `capturePending` is still false here — that is exactly the gap.
    expect(canSwitchApp(waitingForTechnician.phase, false)).toBe(false);
  });

  it('refuses a switch while a session runs', () => {
    const running = reduceSession(waitingForTechnician, { type: 'calibrated' });
    expect(isActive(running)).toBe(true);
    expect(canSwitchApp(running.phase, false)).toBe(false);
  });

  it('refuses a switch during the stop fade, before the world is at rest', () => {
    const stopping = reduceSession(
      reduceSession(waitingForTechnician, { type: 'calibrated' }),
      { type: 'stop', reason: 'technician' }
    );
    expect(canSwitchApp(stopping.phase, false)).toBe(false);
  });

  it('refuses a switch while a capture is pending, whatever the phase says', () => {
    expect(canSwitchApp('idle', true)).toBe(false);
  });

  it('allows the switch once the lifecycle is idle again', () => {
    const faded = [
      { type: 'start' },
      { type: 'calibrated' },
      { type: 'stop', reason: 'technician' },
      { type: 'faded' }
    ] as const satisfies readonly SessionEvent[];
    const end = faded.reduce(reduceSession, INITIAL_SESSION);
    expect(end.phase).toBe('idle');
    expect(canSwitchApp(end.phase, false)).toBe(true);
  });

  it('allows the switch before the session ever starts', () => {
    expect(canSwitchApp(INITIAL_SESSION.phase, false)).toBe(true);
  });
});

describe('questionnaire sheet filing', () => {
  it('files nothing for an untouched sheet', () => {
    expect(shouldFileQuestionnaireSheet(empty(), false)).toBe(false);
  });

  it('files a partial sheet when it closes', () => {
    const answers = empty();
    answers[0] = 4;
    expect(shouldFileQuestionnaireSheet(answers, false)).toBe(true);
  });

  it('never files the same sheet twice', () => {
    // The sheet was filed by its last answer; closing it must not send a second
    // copy of the same answers to the tablet.
    const answers = new Array<number | null>(10).fill(5);
    expect(shouldFileQuestionnaireSheet(answers, false)).toBe(true);
    expect(shouldFileQuestionnaireSheet(answers, true)).toBe(false);
  });

  it('files again only after a new sheet has been started', () => {
    const filed = new Array<number | null>(10).fill(1);
    // A new respondent: the answers are cleared and the filing flag with them.
    const fresh = empty();
    expect(shouldFileQuestionnaireSheet(filed, true)).toBe(false);
    expect(shouldFileQuestionnaireSheet(fresh, false)).toBe(false);
    fresh[0] = 2;
    expect(shouldFileQuestionnaireSheet(fresh, false)).toBe(true);
  });

  it('is length-agnostic: a three-question sheet files like a ten-question one', () => {
    const short = empty(3);
    short[2] = 1;
    expect(shouldFileQuestionnaireSheet(short, false)).toBe(true);
    expect(shouldFileQuestionnaireSheet(empty(3), false)).toBe(false);
    // An instrument with no questions has nothing to file, answered or not.
    expect(shouldFileQuestionnaireSheet([], false)).toBe(false);
  });

  it('treats option value 0 as an answer, because only null is unanswered', () => {
    // The wire uses 0 for "unanswered", the sheet uses null. A bug that wrote 0
    // into the sheet would otherwise file an empty one.
    expect(shouldFileQuestionnaireSheet([0], false)).toBe(true);
  });
});
