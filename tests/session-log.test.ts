import { describe, expect, it } from 'vitest';
import {
  SESSION_LOG_CAP,
  SESSION_LOG_KEY,
  appendSummary,
  readSummaries,
  recordSession,
  summarize,
  writeSummaries,
  type SessionSummary
} from '../src/app/session-log';

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key: string) => map.get(key) ?? null,
    key: (index: number) => Array.from(map.keys())[index] ?? null,
    removeItem: (key: string) => void map.delete(key),
    setItem: (key: string, value: string) => void map.set(key, value)
  } as Storage;
}

function entry(at: number): SessionSummary {
  return { at, scene: 'shore', seconds: 60, level: 2, mix: 0.5, stop: 'patient', confidence: 80 };
}

describe('session log', () => {
  it('rounds and clamps what a session can claim', () => {
    const summary = summarize({
      at: 1000.6,
      scene: 'washroom',
      seconds: 61.4,
      level: 9,
      mix: 1.7,
      stop: 'technician',
      confidence: -4
    });
    expect(summary).toEqual({
      at: 1001,
      scene: 'washroom',
      seconds: 61,
      level: 3,
      mix: 1,
      stop: 'technician',
      confidence: 0
    });
    expect(Number.isFinite(summarize({ ...summary, at: Number.NaN }).at)).toBe(true);
  });

  it('keeps only the newest entries', () => {
    let list: SessionSummary[] = [];
    for (let i = 0; i < SESSION_LOG_CAP + 5; i += 1) {
      list = appendSummary(list, entry(i));
    }
    expect(list).toHaveLength(SESSION_LOG_CAP);
    expect(list.at(-1)?.at).toBe(SESSION_LOG_CAP + 4);
    expect(list[0]?.at).toBe(5);
  });

  it('drops corrupt storage instead of throwing', () => {
    const storage = memoryStorage();
    expect(readSummaries(storage)).toEqual([]);
    storage.setItem(SESSION_LOG_KEY, 'not json');
    expect(readSummaries(storage)).toEqual([]);
    storage.setItem(SESSION_LOG_KEY, JSON.stringify([{ at: 1 }, entry(2)]));
    expect(readSummaries(storage)).toEqual([entry(2)]);
    expect(readSummaries(null)).toEqual([]);
  });

  it('survives a storage that refuses to write', () => {
    const storage = {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota');
      }
    } as unknown as Storage;
    expect(writeSummaries(storage, [entry(1)])).toBe(false);
    expect(recordSession(storage, {
      at: 2,
      scene: 'ward',
      seconds: 10,
      level: 1,
      mix: 0,
      stop: 'patient',
      confidence: 50
    })).toHaveLength(1);
  });
});
