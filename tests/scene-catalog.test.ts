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
      'prep',
      'survey'
    ]);
  });

  it('keeps the questionnaire room out of the picker and out of the sound', () => {
    const survey = SCENES.find((scene) => scene.id === 'survey');
    expect(survey).toBeDefined();
    // The face owns it; the operator must never be offered a card for it.
    expect(survey?.special).toBe(true);
    // And it declares no ambience at all: the questionnaire face is silent.
    expect(survey?.audio).toBeUndefined();
  });

  it('carries the copy and the cap both consumers render', () => {
    for (const entry of entries) {
      expect(entry.id).toMatch(/^[a-z][a-z0-9-]*$/);
      expect(entry.name.zh.trim()).not.toBe('');
      expect(entry.name.en.trim()).not.toBe('');
      expect(entry.tagline.zh.trim()).not.toBe('');
      expect(entry.tagline.en.trim()).not.toBe('');
      // `0` is a real ceiling now: a room that does not move at all.
      expect(entry.comfort === null || entry.comfort >= 0).toBe(true);
    }
    // One shipped room caps itself at zero — the preparation room declares no
    // motion — and every other scene leaves the global maximum alone. The field
    // has to survive the mapping because the tablet and the headset read it.
    expect(
      entries.every((entry) =>
        entry.id === 'prep' ? entry.comfort === 0 : entry.comfort === null
      )
    ).toBe(true);
    // The preparation room is built in: the picker filters it, the page and
    // the headset still need its name.
    // Two built-in rooms the operator never picks: the preparation space and
    // the questionnaire's own.
    expect(entries.filter((entry) => entry.special).map((entry) => entry.id)).toEqual([
      'prep',
      'survey'
    ]);
  });

  it('is plain JSON, so the APK asset and the socket share one shape', () => {
    const round = JSON.parse(JSON.stringify({ scenes: entries })) as {
      scenes: typeof entries;
    };
    expect(round.scenes).toEqual(entries);
  });
});
