import { describe, expect, it } from 'vitest';
import {
  PROGRAM_MAX_SEGMENTS,
  formatProgram,
  parseProgram,
  remainingSeconds,
  type SessionProgram
} from '../src/app/program';

describe('session program', () => {
  const single: SessionProgram = {
    auto: true,
    segments: [{ scene: 'washroom', seconds: 0, voice: 'none', cap: 0 }]
  };
  const three: SessionProgram = {
    auto: true,
    segments: [
      { scene: 'shore', seconds: 360, voice: 'start', cap: 3 },
      { scene: 'ward', seconds: 240, voice: 'imagine', cap: 2 },
      { scene: 'shore', seconds: 180, voice: 'close', cap: 1 }
    ]
  };

  it('round-trips one and three segments', () => {
    expect(parseProgram(formatProgram(single))).toEqual(single);
    expect(parseProgram(formatProgram(three))).toEqual(three);
    expect(formatProgram(three)).toBe(
      'program:1:shore,360,start,3;ward,240,imagine,2;shore,180,close,1'
    );
  });

  it('rejects a plan that would only half-run', () => {
    for (const raw of [
      'program:1:',
      'program:2:washroom,0,none,0',
      'program:1:washroom,0,none',
      'program:1:washroom,-1,none,0',
      'program:1:washroom,0,none,4',
      'program:1:washroom,0,shout,0',
      'program:1:moon,0,none,0',
      'program:1:Washroom,0,none,0',
      'program:1:washroom,0,none,0;',
      `program:1:${Array.from({ length: PROGRAM_MAX_SEGMENTS + 1 }, () => 'washroom,0,none,0').join(';')}`
    ]) {
      expect(parseProgram(raw)).toBeNull();
    }
  });

  it('distinguishes an open-ended segment from a timed one', () => {
    expect(remainingSeconds(single.segments[0], 42)).toBeNull();
    expect(remainingSeconds(three.segments[0], 100)).toBe(260);
    expect(remainingSeconds(three.segments[0], 360)).toBe(0);
    expect(remainingSeconds(three.segments[0], 999)).toBe(0);
  });

  it('accepts the verb forms separately, not as a plan', () => {
    expect(parseProgram('program:next')).toBeNull();
    expect(parseProgram('program:auto:on')).toBeNull();
  });
});
