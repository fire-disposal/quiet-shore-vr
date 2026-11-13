import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readConfig } from '../src/app/config';

describe('buoyancy config', () => {
  beforeEach(() => {
    // readConfig also reads the injected bootstrap object.
    vi.stubGlobal('window', {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('defaults to the full envelope', () => {
    // A quarter of the envelope read as "completely still" in the headset.
    expect(readConfig('').floatAmount).toBe(1);
  });

  it('accepts a percentage from the query string and clamps the rest', () => {
    expect(readConfig('?level=0').floatAmount).toBe(0);
    expect(readConfig('?level=60').floatAmount).toBeCloseTo(0.6, 6);
    expect(readConfig('?level=250').floatAmount).toBe(1);
    expect(readConfig('?level=-4').floatAmount).toBe(0);
    expect(readConfig('?level=abc').floatAmount).toBe(1);
  });
});
