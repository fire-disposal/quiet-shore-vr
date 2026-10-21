import { describe, expect, it } from 'vitest';
import { parseViewAnim, parseViewMove } from '../src/app/view-command';

describe('view:move parsing', () => {
  it('maps the absolute z target onto ±20°', () => {
    expect(parseViewMove('0,0')).toBe(0);
    expect(parseViewMove('0,1')).toBe(20);
    expect(parseViewMove('0,-1')).toBe(-20);
    expect(parseViewMove('0,0.5')).toBe(10);
    expect(parseViewMove('0,-0.35')).toBe(-7);
    expect(parseViewMove('-0,0.25')).toBe(5);
  });

  it('accepts only a numerically zero x, per the wire contract', () => {
    expect(parseViewMove('0.0000001,1')).toBe(20);
    expect(parseViewMove('0.5,1')).toBeNull();
    expect(parseViewMove('-0.5,-1')).toBeNull();
    expect(parseViewMove('1,0')).toBeNull();
  });

  it('rejects malformed or out-of-range frames whole', () => {
    expect(parseViewMove('0')).toBeNull();
    expect(parseViewMove('0,1,2')).toBeNull();
    expect(parseViewMove(',0')).toBeNull();
    expect(parseViewMove('0,')).toBeNull();
    expect(parseViewMove('0, 1')).toBeNull();
    expect(parseViewMove('0,+1')).toBeNull();
    expect(parseViewMove('0,1e0')).toBeNull();
    expect(parseViewMove('0,1.5')).toBeNull();
    expect(parseViewMove('0,-1.01')).toBeNull();
    expect(parseViewMove('0,NaN')).toBeNull();
    expect(parseViewMove('0,Infinity')).toBeNull();
  });
});

describe('view:anim parsing', () => {
  it('accepts every playable catalog preset', () => {
    expect(parseViewAnim('up')).toBe('up');
    expect(parseViewAnim('down')).toBe('down');
    expect(parseViewAnim('recenter')).toBe('recenter');
    expect(parseViewAnim('breathe')).toBe('breathe');
    expect(parseViewAnim(' Breathe ')).toBe('breathe');
  });

  it('rejects unknown names, the state-only code and extra parameters', () => {
    expect(parseViewAnim('')).toBeNull();
    expect(parseViewAnim('left')).toBeNull();
    // `none` is how /state reports "no preset"; it is not a playable id.
    expect(parseViewAnim('none')).toBeNull();
    expect(parseViewAnim('up,0')).toBeNull();
    expect(parseViewAnim('up:0.5')).toBeNull();
    expect(parseViewAnim('recenter0')).toBeNull();
    expect(parseViewAnim('breathe2')).toBeNull();
  });
});
