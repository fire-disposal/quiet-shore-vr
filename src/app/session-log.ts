/**
 * One line per finished session, kept on the device.
 *
 * The tablet is the record of care, but it only sees what the page told it over
 * a 1 Hz state frame; if that link drops mid-session the operator is left with a
 * duration nobody wrote down. This module is the page's own ledger: what ran,
 * how long, at which intensity, and why it stopped. It is local to the headset
 * origin (Firefox Reality's profile), so it survives reloads and does not need
 * the network or the tablet.
 *
 * Kept deliberately small: seven fields, no free text, no personal data.
 */

export interface SessionSummary {
  /** Epoch milliseconds when the session ended. */
  at: number;
  /** Scene that was loaded at the end. */
  scene: string;
  /** Whole seconds between "running" and the stop. */
  seconds: number;
  /** Buoyancy level the page was applying. */
  level: number;
  /** Posture correction (mix) at the end, 0..1. */
  mix: number;
  /** Why it stopped: the reducer's reason. */
  stop: string;
  /** Calibration confidence the session started with, 0..100. */
  confidence: number;
}

export const SESSION_LOG_KEY = 'qs:sessions:v1';
/** Old entries fall off the front; the log is for the last few shifts. */
export const SESSION_LOG_CAP = 50;

export interface SessionInput {
  at: number;
  scene: string;
  seconds: number;
  level: number;
  mix: number;
  stop: string;
  confidence: number;
}

/** Normalise one finished session into the stored shape. */
export function summarize(input: SessionInput): SessionSummary {
  const clamp = (value: number, min: number, max: number): number =>
    Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : min;
  return {
    at: Number.isFinite(input.at) ? Math.round(input.at) : Date.now(),
    scene: typeof input.scene === 'string' ? input.scene : '',
    seconds: Math.max(0, Math.round(clamp(input.seconds, 0, 24 * 3600))),
    level: Math.round(clamp(input.level, 0, 3)),
    mix: Number(clamp(input.mix, 0, 1).toFixed(3)),
    stop: typeof input.stop === 'string' ? input.stop : '',
    confidence: Math.round(clamp(input.confidence, 0, 100))
  };
}

/** Append, keeping only the newest `cap` entries. Never mutates the input. */
export function appendSummary(
  list: readonly SessionSummary[],
  next: SessionSummary,
  cap: number = SESSION_LOG_CAP
): SessionSummary[] {
  const limit = Math.max(1, Math.floor(cap));
  const kept = list.slice(-(limit - 1));
  return [...kept, next];
}

function isSummary(value: unknown): value is SessionSummary {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.at === 'number' &&
    typeof entry.scene === 'string' &&
    typeof entry.seconds === 'number' &&
    typeof entry.level === 'number' &&
    typeof entry.mix === 'number' &&
    typeof entry.stop === 'string' &&
    typeof entry.confidence === 'number'
  );
}

/** Read what is stored; a corrupt or foreign entry is dropped, not fatal. */
export function readSummaries(storage: Storage | null): SessionSummary[] {
  if (!storage) {
    return [];
  }
  let raw: string | null;
  try {
    raw = storage.getItem(SESSION_LOG_KEY);
  } catch {
    return [];
  }
  if (!raw) {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) {
    return [];
  }
  return parsed.filter(isSummary).slice(-SESSION_LOG_CAP);
}

/** @return false when the storage refused the write (private mode, full). */
export function writeSummaries(
  storage: Storage | null,
  list: readonly SessionSummary[]
): boolean {
  if (!storage) {
    return false;
  }
  try {
    storage.setItem(SESSION_LOG_KEY, JSON.stringify(list.slice(-SESSION_LOG_CAP)));
    return true;
  } catch {
    return false;
  }
}

/** Append one summary to whatever is stored; returns the new list. */
export function recordSession(
  storage: Storage | null,
  input: SessionInput
): SessionSummary[] {
  const next = appendSummary(readSummaries(storage), summarize(input));
  writeSummaries(storage, next);
  return next;
}

/** The browser's durable store, or null where access is blocked. */
export function sessionStorageSafe(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}
