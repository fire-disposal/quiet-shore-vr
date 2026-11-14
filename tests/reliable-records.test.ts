import { describe, expect, it } from 'vitest';
import { createReliableRecordOutbox } from '../src/app/reliable-records';

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length(): number { return this.values.size; }
  clear(): void { this.values.clear(); }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  key(index: number): string | null { return Array.from(this.values.keys())[index] ?? null; }
  removeItem(key: string): void { this.values.delete(key); }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

describe('reliable record outbox', () => {
  it('restores unacknowledged records after reload and removes only the acknowledged id', () => {
    const storage = new MemoryStorage();
    let nextId = 0;
    const ids = () => `record-${++nextId}`;
    const first = createReliableRecordOutbox(storage, ids);
    first.add({ type: 'session', data: { at: 100 } });
    first.add({ type: 'log', app: 'training', data: { kind: 'session.stopped' } });

    const restored = createReliableRecordOutbox(storage, ids);
    expect(restored.pending().map((record) => record.id)).toEqual(['record-1', 'record-2']);
    expect(restored.acknowledge('record-1')).toBe(true);
    expect(restored.acknowledge('record-1')).toBe(false);

    const afterAck = createReliableRecordOutbox(storage, ids);
    expect(afterAck.pending().map((record) => record.id)).toEqual(['record-2']);
    expect(afterAck.pending()[0].message.type).toBe('log');
  });

  it('drops corrupt storage entries without dropping valid pending records', () => {
    const storage = new MemoryStorage();
    storage.setItem('qs:record-outbox:v1', JSON.stringify([
      null,
      { id: '', message: { type: 'log' } },
      { id: 'bad-type', message: { type: 'notice' } },
      { id: 'valid', message: { type: 'sus', data: { filled: 1 } } },
      { id: 'valid', message: { type: 'log' } }
    ]));
    const outbox = createReliableRecordOutbox(storage, () => 'next');
    expect(outbox.pending().map((record) => record.id)).toEqual(['valid']);
  });
});
