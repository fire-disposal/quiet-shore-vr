import { describe, expect, it } from 'vitest';
import { parseRemoteCommand } from '../src/app/commands';

describe('remote command grammar', () => {
  it('turns the float channel into typed commands', () => {
    expect(parseRemoteCommand('float:level:2')).toEqual({ kind: 'floatLevel', level: 2 });
    expect(parseRemoteCommand('float:profile:c')).toEqual({ kind: 'floatProfile', id: 'c' });
    expect(parseRemoteCommand('float:breath:off')).toEqual({ kind: 'floatBreath', on: false });
  });

  it('rejects out-of-range or mistyped values whole', () => {
    for (const raw of ['float:level:4', 'float:level:-1', 'float:level:1.5', 'float:level:x']) {
      expect(parseRemoteCommand(raw)).toEqual({ kind: 'invalid', message: '漂浮强度无效' });
    }
    expect(parseRemoteCommand('float:profile:z')).toEqual({
      kind: 'invalid',
      message: '未知漂浮档位'
    });
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

  it('routes the view channel through the strict orient parser', () => {
    expect(parseRemoteCommand('view:orient:0,12')).toEqual({
      kind: 'viewOrient',
      lookYawDeg: 0,
      upGazeDeg: 12
    });
    expect(parseRemoteCommand('view:orient:0,120')?.kind).toBe('invalid');
    expect(parseRemoteCommand('view:anim:up')).toEqual({ kind: 'viewAnim', name: 'up' });
    expect(parseRemoteCommand('view:anim:loop')?.kind).toBe('invalid');
    expect(parseRemoteCommand('view:stop')).toEqual({ kind: 'viewStop' });
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
    expect(parseRemoteCommand('sus:next')).toEqual({ kind: 'susMove', delta: 1 });
    expect(parseRemoteCommand('sus:prev')).toEqual({ kind: 'susMove', delta: -1 });
  });

  it('maps the discrete verbs', () => {
    const cases: Array<[string, string]> = [
      ['mode:posture', 'mode'],
      ['scene:shore', 'scene'],
      ['preview', 'preview'],
      ['calibrate', 'calibrate'],
      ['stop', 'exit'],
      ['exit', 'exit'],
      ['audio:toggle', 'audio'],
      ['posture:rise', 'posture'],
      ['posture:stop', 'posture'],
      ['cue:on', 'cue'],
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
    expect(parseRemoteCommand('Float:Profile:A')).toEqual({ kind: 'floatProfile', id: 'a' });
  });
});
