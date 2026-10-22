import { describe, expect, it } from 'vitest';
import { parseViewAnim, parseViewOrient } from '../src/app/view-command';

describe('view:orient parsing', () => {
  it('reads the absolute yaw and pitch in degrees', () => {
    expect(parseViewOrient('0,0')).toEqual({ lookYawDeg: 0, upGazeDeg: 0 });
    expect(parseViewOrient('0,45')).toEqual({ lookYawDeg: 0, upGazeDeg: 45 });
    expect(parseViewOrient('-90,90')).toEqual({ lookYawDeg: -90, upGazeDeg: 90 });
    expect(parseViewOrient('179.5,-89.5')).toEqual({ lookYawDeg: 179.5, upGazeDeg: -89.5 });
  });

  it('accepts the full envelope and rejects one degree past it', () => {
    expect(parseViewOrient('180,90')).not.toBeNull();
    expect(parseViewOrient('-180,-90')).not.toBeNull();
    expect(parseViewOrient('180.1,0')).toBeNull();
    expect(parseViewOrient('-180.1,0')).toBeNull();
    expect(parseViewOrient('0,90.1')).toBeNull();
    expect(parseViewOrient('0,-90.1')).toBeNull();
  });

  it('rejects malformed frames whole', () => {
    expect(parseViewOrient('0')).toBeNull();
    expect(parseViewOrient('0,1,2')).toBeNull();
    expect(parseViewOrient(',0')).toBeNull();
    expect(parseViewOrient('0,')).toBeNull();
    expect(parseViewOrient('0, 1')).toBeNull();
    expect(parseViewOrient('0,+1')).toBeNull();
    expect(parseViewOrient('0,1e0')).toBeNull();
    expect(parseViewOrient('0,1.')).toBeNull();
    expect(parseViewOrient('0,.5')).toBeNull();
    expect(parseViewOrient('0,NaN')).toBeNull();
    expect(parseViewOrient('0,Infinity')).toBeNull();
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
