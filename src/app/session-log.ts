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

/** One stretch of a session spent in one scene. */
export interface SessionSegment {
  /** Scene id, as the page knows it. */
  scene: string;
  /** Whole seconds spent in it. */
  seconds: number;
  /** 1-based program position; absent for a manually switched session. */
  index?: number;
  /** The program's planned seconds; 0 or absent means open-ended. */
  plannedSec?: number;
  /** Highest posture correction reached inside this one segment. */
  peakMix?: number;
  /** Highest up-gaze reached inside this one segment, degrees. */
  peakUpGazeDeg?: number;
}

export interface SessionSummary {
  /** Product face the record belongs to; the shared ledger field. */
  app: 'training' | 'questionnaire';
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
  /**
   * Highest posture correction reached, 0..1.
   *
   * This is the therapy's dose: the mother goal is the pitch offset that lets a
   * supine patient imagine standing, so "how far did the view get lifted" is the
   * one number that says whether a session did anything at all.
   */
  peakMix: number;
  /** Highest up-gaze applied, in degrees (`peakMix` in angle terms). */
  peakUpGazeDeg: number;
  /** Every stretch of the session, in order, one entry per scene. */
  segments: SessionSegment[];
  /** What the patient reported afterwards; null until the technician says. */
  outcome: SessionOutcome | null;
}

/**
 * The bedside question the operator asks after the headset comes off.
 *
 * Two facts, because they mean different things: an attempt that failed is a
 * different result from no attempt, and collapsing them loses the only signal
 * the therapy is being tried at all.
 */
export interface SessionOutcome {
  /** 1 tried, 0 did not try, null not answered. */
  attempted: boolean | null;
  /** 1 succeeded, 0 did not, null not answered or not attempted. */
  succeeded: boolean | null;
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
  peakMix: number;
  peakUpGazeDeg: number;
  segments: readonly SessionSegment[];
}

/** Normalise one finished session into the stored shape. */
export function summarize(input: SessionInput): SessionSummary {
  const clamp = (value: number, min: number, max: number): number =>
    Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : min;
  return {
    app: 'training',
    at: Number.isFinite(input.at) ? Math.round(input.at) : Date.now(),
    scene: typeof input.scene === 'string' ? input.scene : '',
    seconds: Math.max(0, Math.round(clamp(input.seconds, 0, 24 * 3600))),
    level: Math.round(clamp(input.level, 0, 3)),
    mix: Number(clamp(input.mix, 0, 1).toFixed(3)),
    stop: typeof input.stop === 'string' ? input.stop : '',
    confidence: Math.round(clamp(input.confidence, 0, 100)),
    peakMix: Number(clamp(input.peakMix, 0, 1).toFixed(3)),
    peakUpGazeDeg: Math.round(clamp(input.peakUpGazeDeg, 0, 180)),
    segments: summarizeSegments(input.segments),
    outcome: null
  };
}

/**
 * Keep the segments that carry time, in order, seconds rounded.
 *
 * Consecutive spans in the same scene merge only when they are the *same*
 * program segment: a three-segment plan may return to the lake twice, and those
 * are two ledger rows, not one.
 */
function summarizeSegments(list: readonly SessionSegment[]): SessionSegment[] {
  const out: SessionSegment[] = [];
  for (const span of Array.isArray(list) ? list : []) {
    if (!span || typeof span.scene !== 'string') {
      continue;
    }
    const seconds = Math.max(0, Math.round(span.seconds));
    if (seconds <= 0) {
      continue;
    }
    const index = Number.isFinite(span.index) ? Math.max(1, Math.round(span.index!)) : undefined;
    const plannedSec = Number.isFinite(span.plannedSec)
      ? Math.max(0, Math.round(span.plannedSec!))
      : undefined;
    const peakMix = Number.isFinite(span.peakMix)
      ? Number(Math.min(1, Math.max(0, span.peakMix!)).toFixed(3))
      : undefined;
    const peakUpGazeDeg = Number.isFinite(span.peakUpGazeDeg)
      ? Math.max(0, Math.round(span.peakUpGazeDeg!))
      : undefined;
    const last = out[out.length - 1];
    if (last && last.scene === span.scene && last.index === index && last.plannedSec === plannedSec) {
      last.seconds += seconds;
      if (peakMix !== undefined) {
        last.peakMix = Math.max(last.peakMix ?? 0, peakMix);
      }
      if (peakUpGazeDeg !== undefined) {
        last.peakUpGazeDeg = Math.max(last.peakUpGazeDeg ?? 0, peakUpGazeDeg);
      }
      continue;
    }
    const next: SessionSegment = { scene: span.scene, seconds };
    if (index !== undefined) next.index = index;
    if (plannedSec !== undefined) next.plannedSec = plannedSec;
    if (peakMix !== undefined) next.peakMix = peakMix;
    if (peakUpGazeDeg !== undefined) next.peakUpGazeDeg = peakUpGazeDeg;
    out.push(next);
  }
  return out;
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
    (entry.app === undefined || entry.app === 'training' || entry.app === 'questionnaire') &&
    typeof entry.at === 'number' &&
    typeof entry.scene === 'string' &&
    typeof entry.seconds === 'number' &&
    typeof entry.level === 'number' &&
    typeof entry.mix === 'number' &&
    typeof entry.stop === 'string' &&
    typeof entry.confidence === 'number' &&
    typeof entry.peakMix === 'number' &&
    typeof entry.peakUpGazeDeg === 'number' &&
    Array.isArray(entry.segments)
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

/**
 * Attach the bedside answer to the newest entry.
 *
 * The technician answers on the tablet after the headset comes off, so the
 * answer arrives *after* the session was written; this is the only mutation the
 * log allows — one field on the last row, never a rewrite of the history.
 */
export function annotateOutcome(
  storage: Storage | null,
  patch: Partial<SessionOutcome>
): SessionSummary[] {
  const list = readSummaries(storage);
  const last = list[list.length - 1];
  if (!last) {
    return list;
  }
  const previous: SessionOutcome = last.outcome ?? { attempted: null, succeeded: null };
  const next: SessionOutcome = {
    attempted: patch.attempted !== undefined ? patch.attempted : previous.attempted,
    succeeded: patch.succeeded !== undefined ? patch.succeeded : previous.succeeded
  };
  // "Succeeded" without "attempted" is not a state a person can be in: success
  // wins over a later "did not try", which can only be a mis-tap.
  if (next.succeeded === true) {
    next.attempted = true;
  }
  const updated: SessionSummary = { ...last, outcome: next };
  const nextList = [...list.slice(0, -1), updated];
  writeSummaries(storage, nextList);
  return nextList;
}

/** The browser's durable store, or null where access is blocked. */
export function sessionStorageSafe(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}
