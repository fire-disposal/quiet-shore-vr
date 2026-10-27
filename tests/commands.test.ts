import { describe, expect, it } from 'vitest';
import { parseRemoteCommand } from '../src/app/commands';

describe('remote command grammar', () => {
  it('turns the float channel into typed commands', () => {
    expect(parseRemoteCommand('float:level:2')).toEqual({ kind: 'floatLevel', level: 2 });
    // The profile and breathing-layer presets were deleted: the only choice
    // left is on/off, expressed as level 3 / 0.
    expect(parseRemoteCommand('float:profile:c')?.kind).toBe('unknown');
    expect(parseRemoteCommand('float:breath:off')?.kind).toBe('unknown');
  });

  it('rejects out-of-range or mistyped values whole', () => {
    for (const raw of ['float:level:4', 'float:level:-1', 'float:level:1.5', 'float:level:x']) {
      expect(parseRemoteCommand(raw)).toEqual({ kind: 'invalid', message: '漂浮强度无效' });
    }
  });

  it('keeps the eye height strict', () => {
    expect(parseRemoteCommand('settings:eyeheight:1.55')).toEqual({
      kind: 'eyeHeight',
      meters: 1.55
    });
    expect(parseRemoteCommand('settings:eyeheight:1.700')).toEqual({
      kind: 'eyeHeight',
      meters: 1.7
    });
    for (const raw of [
      'settings:eyeheight:1.',
      'settings:eyeheight:2.0',
      'settings:eyeheight:11.7',
      'settings:eyeheight:1.7m',
      'settings:eyeheight:1,7'
    ]) {
      expect(parseRemoteCommand(raw)?.kind).toBe('invalid');
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
    expect(parseRemoteCommand('sus:next')).toEqual({ kind: 'susMove', delta: 1 });
    expect(parseRemoteCommand('sus:prev')).toEqual({ kind: 'susMove', delta: -1 });
  });

  it('maps the discrete verbs', () => {
    const cases: Array<[string, string]> = [
      ['scene:shore', 'scene'],
      ['preview', 'preview'],
      ['calibrate', 'calibrate'],
      ['stop', 'exit'],
      ['exit', 'exit'],
      ['audio:toggle', 'audio'],
      ['posture:rise', 'posture'],
      ['posture:stop', 'posture'],
      ['gaze:dwell:off', 'gazeDwell'],
      ['status', 'status'],
      ['start', 'start']
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
    expect(parseRemoteCommand('  PREVIEW  ')).toEqual({ kind: 'preview' });
  });
});
