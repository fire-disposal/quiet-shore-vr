export type ReliableRecordMessage = Record<string, unknown> & {
  type: 'session' | 'sus' | 'log';
};

export interface ReliableRecord {
  readonly id: string;
  readonly message: ReliableRecordMessage;
}

export interface ReliableRecordOutbox {
  add(message: ReliableRecordMessage): ReliableRecord;
  acknowledge(id: string): boolean;
  pending(): readonly ReliableRecord[];
}

const STORAGE_KEY = 'qs:record-outbox:v1';

function isRecordType(value: unknown): value is ReliableRecordMessage['type'] {
  return value === 'session' || value === 'sus' || value === 'log';
}

function readStored(storage: Storage | null): ReliableRecord[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const records: ReliableRecord[] = [];
    const seen = new Set<string>();
    for (const value of parsed) {
      if (!value || typeof value !== 'object') continue;
      const candidate = value as Record<string, unknown>;
      const id = candidate.id;
      const message = candidate.message;
      if (typeof id !== 'string' || !id || seen.has(id) || !message || typeof message !== 'object') {
        continue;
      }
      const body = message as Record<string, unknown>;
      if (!isRecordType(body.type)) continue;
      seen.add(id);
      records.push({ id, message: body as ReliableRecordMessage });
    }
    return records;
  } catch {
    return [];
  }
}

export function createReliableRecordOutbox(
  storage: Storage | null,
  idFactory: () => string
): ReliableRecordOutbox {
  const records = readStored(storage);

  function write(): void {
    if (!storage) return;
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify(records));
    } catch {
      // The in-memory copy still survives this connection and retries on open.
    }
  }

  return {
    add(message) {
      let id = idFactory();
      while (!id || records.some((record) => record.id === id)) {
        id = idFactory();
      }
      const record = { id, message };
      records.push(record);
      write();
      return record;
    },
    acknowledge(id) {
      const index = records.findIndex((record) => record.id === id);
      if (index < 0) return false;
      records.splice(index, 1);
      write();
      return true;
    },
    pending: () => records
  };
}
