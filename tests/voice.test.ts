import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SEQUENCES, expandSequence } from '../src/audio/voice';

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
