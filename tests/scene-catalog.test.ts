import { describe, expect, it } from 'vitest';
import { catalogEntries } from '../src/scenes/catalog';
import { SCENES } from '../src/scenes/registry';

describe('scene catalogue', () => {
  const entries = catalogEntries();

  it('lists every registered scene in registry order', () => {
    // The state frame still carries a 4-bit scene index, so this order is the
    // wire contract: append only, never reorder. The first four are the v1
    // table every deployed tablet already knows.
    expect(entries.map((entry) => entry.id)).toEqual(
      SCENES.map((scene) => scene.id)
    );
    expect(entries.map((entry) => entry.id)).toEqual([
      'washroom',
      'shore',
      'ward',
      'prep'
    ]);
  });

  it('carries the copy and the cap both consumers render', () => {
    for (const entry of entries) {
      expect(entry.id).toMatch(/^[a-z][a-z0-9-]*$/);
      expect(entry.name.zh.trim()).not.toBe('');
      expect(entry.name.en.trim()).not.toBe('');
      expect(entry.tagline.zh.trim()).not.toBe('');
      expect(entry.tagline.en.trim()).not.toBe('');
      expect(entry.comfortLevel === null || entry.comfortLevel >= 1).toBe(true);
    }
    // No shipped scene caps itself now; the field still has to survive the
    // mapping, because the tablet and the headset read it for the ones that do.
    expect(entries.every((entry) => entry.comfortLevel === null)).toBe(true);
    // The preparation room is built in: the picker filters it, the page and
    // the headset still need its name.
    expect(entries.filter((entry) => entry.special).map((entry) => entry.id)).toEqual([
      'prep'
    ]);
  });

  it('is plain JSON, so the APK asset and the socket share one shape', () => {
    const round = JSON.parse(JSON.stringify({ scenes: entries })) as {
      scenes: typeof entries;
    };
    expect(round.scenes).toEqual(entries);
  });
});
