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

  it('bounds the SUS channel', () => {
    expect(parseRemoteCommand('sus:show:3')).toEqual({ kind: 'susShow', index: 3 });
    expect(parseRemoteCommand('sus:answer:5')).toEqual({ kind: 'susAnswer', value: 5 });
    expect(parseRemoteCommand('sus:answer:6')?.kind).toBe('invalid');
    expect(parseRemoteCommand('sus:answer:0')?.kind).toBe('invalid');
    // One digit, one question: padding and out-of-range indices are frames of
    // the wrong shape, not values to coerce.
    expect(parseRemoteCommand('sus:answer:01')?.kind).toBe('invalid');
    expect(parseRemoteCommand('sus:show:0')?.kind).toBe('invalid');
    expect(parseRemoteCommand('sus:show:11')?.kind).toBe('invalid');
    // Paging is the headset's own prev/next: there is no tablet verb for it.
    expect(parseRemoteCommand('sus:next')?.kind).toBe('unknown');
    expect(parseRemoteCommand('sus:prev')?.kind).toBe('unknown');
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
