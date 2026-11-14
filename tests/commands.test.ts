import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseRemoteCommand } from '../src/app/commands';

interface CommandFixture {
  readonly sharedAccepted: readonly string[];
  readonly sharedRejected: readonly string[];
}
const fixture = JSON.parse(
  readFileSync(new URL('./fixtures/command-grammar.json', import.meta.url), 'utf8')
) as CommandFixture;

describe('remote command grammar', () => {
  it('matches the shared page/headset contract fixture', () => {
    for (const command of fixture.sharedAccepted) {
      expect(parseRemoteCommand(command)?.kind, command).not.toBe('unknown');
      expect(parseRemoteCommand(command)?.kind, command).not.toBe('invalid');
    }
    for (const command of fixture.sharedRejected) {
      expect(['unknown', 'invalid'], command).toContain(parseRemoteCommand(command)?.kind);
    }
  });

  it('turns the float channel into typed commands', () => {
    expect(parseRemoteCommand('float:level:60')).toEqual({ kind: 'floatLevel', percent: 60 });
    // The profile and breathing-layer presets were deleted: the only choice
    // left is on/off, expressed as level 3 / 0.
    expect(parseRemoteCommand('float:profile:c')?.kind).toBe('unknown');
    expect(parseRemoteCommand('float:direction:down')?.kind).toBe('unknown');
  });

  it('takes the breathing switch as a named pair, nothing else', () => {
    expect(parseRemoteCommand('float:breath:on')).toEqual({ kind: 'floatBreath', on: true });
    expect(parseRemoteCommand('float:breath:off')).toEqual({ kind: 'floatBreath', on: false });
    for (const raw of ['float:breath:1', 'float:breath', 'float:breath:']) {
      expect(parseRemoteCommand(raw)?.kind).toBe('unknown');
    }
  });

  it('rejects out-of-range or mistyped values whole', () => {
    for (const raw of ['float:level:101', 'float:level:-1', 'float:level:1.5', 'float:level:x']) {
      expect(parseRemoteCommand(raw)).toEqual({ kind: 'invalid', message: '漂浮强度无效' });
    }
  });

  it('no longer accepts the retired particle-cue commands', () => {
    // The near-field cue was removed; both ends drop its grammar together.
    for (const raw of ['cue:on', 'cue:off', 'cue:intensity:0.5', 'cue:intensity:1']) {
      expect(parseRemoteCommand(raw)?.kind).toBe('unknown');
    }
  });

  it('bounds the rise duration to what the ramp can do', () => {
    expect(parseRemoteCommand('anim:duration:6000')).toEqual({ kind: 'riseDuration', ms: 6000 });
    expect(parseRemoteCommand('anim:duration:3000')?.kind).toBe('invalid');
    expect(parseRemoteCommand('anim:duration:21000')?.kind).toBe('invalid');
  });

  it('names the loaded instrument, not a shipped one', () => {
    // Every questionnaire verb is instrument-agnostic: the grammar bounds the
    // argument, the page or the headset's catalogue bounds the real value.
    expect(parseRemoteCommand('questionnaire:open')).toEqual({ kind: 'questionnaireOpen' });
    expect(parseRemoteCommand('questionnaire:close')).toEqual({ kind: 'questionnaireClose' });
    expect(parseRemoteCommand('questionnaire:replay')).toEqual({ kind: 'questionnaireReplay' });
    expect(parseRemoteCommand('questionnaire:voice:on')).toEqual({
      kind: 'questionnaireVoice',
      on: true
    });
    expect(parseRemoteCommand('questionnaire:voice:off')).toEqual({
      kind: 'questionnaireVoice',
      on: false
    });
    // No verb names a specific instrument.
    expect(parseRemoteCommand('sus:open')?.kind).toBe('unknown');
    expect(parseRemoteCommand('sus:answer:2')?.kind).toBe('unknown');
  });

  it('accepts a question number the grammar can express', () => {
    // 1..100 is the grammar's ceiling; a three-question instrument refuses the
    // rest itself, because only the page knows its own length.
    expect(parseRemoteCommand('questionnaire:show:1')).toEqual({
      kind: 'questionnaireShow',
      index: 1
    });
    expect(parseRemoteCommand('questionnaire:show:100')).toEqual({
      kind: 'questionnaireShow',
      index: 100
    });
    expect(parseRemoteCommand('questionnaire:show:0')?.kind).toBe('invalid');
    expect(parseRemoteCommand('questionnaire:show:101')?.kind).toBe('invalid');
    expect(parseRemoteCommand('questionnaire:show:x')?.kind).toBe('invalid');
  });

  it('accepts an answer value the grammar can express, one digit wide', () => {
    expect(parseRemoteCommand('questionnaire:answer:1')).toEqual({
      kind: 'questionnaireAnswer',
      value: 1
    });
    expect(parseRemoteCommand('questionnaire:answer:9')).toEqual({
      kind: 'questionnaireAnswer',
      value: 9
    });
    // One digit: padding and zero are frames of the wrong shape, not values to
    // coerce.
    expect(parseRemoteCommand('questionnaire:answer:0')?.kind).toBe('invalid');
    expect(parseRemoteCommand('questionnaire:answer:01')?.kind).toBe('invalid');
    expect(parseRemoteCommand('questionnaire:answer:10')?.kind).toBe('invalid');
    // Paging is the headset's own prev/next: there is no tablet verb for it.
    expect(parseRemoteCommand('questionnaire:next')?.kind).toBe('unknown');
    expect(parseRemoteCommand('questionnaire:prev')?.kind).toBe('unknown');
  });

  it('takes a selectable id and refuses anything the catalogue could not publish', () => {
    expect(parseRemoteCommand('questionnaire:select:feedback')).toEqual({
      kind: 'questionnaireSelect',
      id: 'feedback'
    });
    expect(parseRemoteCommand('questionnaire:select:pain-3')?.kind).toBe('questionnaireSelect');
    // The whole frame is lowercased before parsing, like every other command, so
    // a shouted id is the same id rather than a rejection.
    expect(parseRemoteCommand('questionnaire:select:SUS')).toEqual({
      kind: 'questionnaireSelect',
      id: 'sus'
    });
    for (const raw of [
      'questionnaire:select:',
      'questionnaire:select:two words',
      'questionnaire:select:1abc',
      `questionnaire:select:${'a'.repeat(33)}`
    ]) {
      expect(parseRemoteCommand(raw)?.kind, raw).toBe('invalid');
    }
  });

  it('maps the discrete verbs', () => {
    const cases: Array<[string, string]> = [
      ['scene:shore', 'scene'],
      ['calibrate', 'calibrate'],
      ['stop', 'exit'],
      ['exit', 'exit'],
      ['audio:toggle', 'audio'],
      ['posture:rise', 'posture'],
      ['posture:stop', 'posture'],
      ['gaze:dwell:off', 'gazeDwell']
    ];
    for (const [raw, kind] of cases) {
      expect(parseRemoteCommand(raw)?.kind).toBe(kind);
    }
  });

  it('separates blank input from unknown commands', () => {
    expect(parseRemoteCommand('   ')).toBeNull();
    expect(parseRemoteCommand('')).toBeNull();
    expect(parseRemoteCommand('launch:the:missiles')).toEqual({ kind: 'unknown' });
  });

  it('normalises case and padding before parsing', () => {
    expect(parseRemoteCommand('  EXIT  ')).toEqual({ kind: 'exit' });
  });
});
