import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SEQUENCES, autoPlan, expandSequence } from '../src/audio/voice';

const lines = JSON.parse(
  readFileSync(join(process.cwd(), 'voice/lines.json'), 'utf8')
) as { lines: { id: string; group: string }[] };
const knownIds = new Set(lines.lines.map((line) => line.id));

describe('voice sequences', () => {
  it('only references lines that exist in the script', () => {
    for (const [name, steps] of Object.entries(SEQUENCES)) {
      for (const step of steps) {
        expect(knownIds.has(step.id), `${name} -> ${step.id}`).toBe(true);
      }
    }
  });

  it('schedules clips back to back, with the gap after each clip', () => {
    const at = expandSequence('close', () => 4000);
    expect(at).toEqual([
      { id: 'v-close-1', atMs: 0 },
      { id: 'v-close-2', atMs: 10000 }
    ]);
  });

  it('leaves gaps at zero on the last step so a sequence cannot trail silence', () => {
    for (const steps of Object.values(SEQUENCES)) {
      expect(steps[steps.length - 1].gapMs).toBe(0);
    }
  });
});

describe('voice auto plan', () => {
  it('starts the cue script immediately', () => {
    expect(autoPlan(0)).toEqual([{ atMs: 0, seq: 'start' }]);
    expect(autoPlan(600_000)[0]).toEqual({ atMs: 0, seq: 'start' });
  });

  it('places imagery once the scene has settled and closes a minute early', () => {
    const plan = autoPlan(600_000);
    expect(plan.map((entry) => entry.seq)).toEqual(['start', 'imagine', 'relax', 'close']);
    expect(plan[1].atMs).toBe(90_000);
    expect(plan[2].atMs).toBe(300_000);
    expect(plan[3].atMs).toBe(540_000);
  });

  it('skips the relax guidance on short sessions and never schedules in the past', () => {
    const plan = autoPlan(180_000);
    expect(plan.map((entry) => entry.seq)).toEqual(['start', 'imagine', 'close']);
    expect(plan[1].atMs).toBe(27_000);
    expect(plan[2].atMs).toBe(120_000);

    for (const entry of autoPlan(30_000)) {
      expect(entry.atMs).toBeGreaterThanOrEqual(0);
    }
  });
});
