import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readConfig } from '../src/app/config';

describe('buoyancy level config', () => {
  beforeEach(() => {
    // readConfig also reads the injected bootstrap object.
    vi.stubGlobal('window', {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('defaults to the full envelope', () => {
    // Level 1 (25 mm) read as "completely still" in the headset.
    expect(readConfig('').floatLevel).toBe(3);
  });

  it('accepts 0..3 from the query string and clamps the rest', () => {
    expect(readConfig('?level=0').floatLevel).toBe(0);
    expect(readConfig('?level=2').floatLevel).toBe(2);
    expect(readConfig('?level=9').floatLevel).toBe(3);
    expect(readConfig('?level=-4').floatLevel).toBe(0);
    expect(readConfig('?level=abc').floatLevel).toBe(3);
  });
});
