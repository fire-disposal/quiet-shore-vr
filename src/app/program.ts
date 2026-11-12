import type { SequenceName } from '../audio/voice';
import { getSceneDefinition } from '../scenes/registry';

/**
 * A session as a short program of segments.
 *
 * The tablet owns the plan; the page only executes it. The wire form is one
 * BLE command so it needs no new channel and no state-frame version:
 *
 *   program:<auto 0|1>:<scene>,<seconds>,<voice>,<cap>;<scene>,...
 *
 * `seconds = 0` means "until the operator ends it" (the single-segment default
 * is exactly that, so v1 behaviour is unchanged). `voice = none` leaves the
 * soundscape alone; `cap = 0` means the scene's own comfort ceiling.
 */
export type ProgramVoice = 'none' | SequenceName;

export interface ProgramSegment {
  readonly scene: string;
  readonly seconds: number;
  readonly voice: ProgramVoice;
  /** Highest buoyancy level for this stretch; 0 = the scene's ceiling. */
  readonly cap: number;
}

export interface SessionProgram {
  readonly auto: boolean;
  readonly segments: readonly ProgramSegment[];
}

export const PROGRAM_PREFIX = 'program:';
export const PROGRAM_MAX_SEGMENTS = 8;
export const PROGRAM_MAX_SECONDS = 3600;
/** The table both ends share; the tablet cycles through it in the editor. */
export const PROGRAM_VOICES: readonly ProgramVoice[] = [
  'none',
  'start',
  'imagine',
  'relax',
  'close'
];

const SCENE_ID = /^[a-z][a-z0-9-]*$/;

/** True when the raw string is a program payload rather than a control verb. */
export function isProgramCommand(raw: string): boolean {
  return raw.startsWith(PROGRAM_PREFIX);
}

/**
 * Parse `program:<auto>:<segments>`. Returns null for anything the page would
 * not execute, so a malformed plan cannot half-start a session.
 */
export function parseProgram(raw: string): SessionProgram | null {
  if (!isProgramCommand(raw)) {
    return null;
  }
  const rest = raw.slice(PROGRAM_PREFIX.length);
  const colon = rest.indexOf(':');
  if (colon <= 0) {
    return null;
  }
  const auto = rest.slice(0, colon);
  if (auto !== '0' && auto !== '1') {
    return null;
  }
  const body = rest.slice(colon + 1);
  const parts = body.split(';');
  if (parts.length < 1 || parts.length > PROGRAM_MAX_SEGMENTS) {
    return null;
  }
  const segments: ProgramSegment[] = [];
  for (const part of parts) {
    const fields = part.split(',');
    if (fields.length !== 4) {
      return null;
    }
    const [scene, secondsRaw, voiceRaw, capRaw] = fields;
    if (!SCENE_ID.test(scene) || !getSceneDefinition(scene)) {
      return null;
    }
    if (!/^\d{1,4}$/.test(secondsRaw) || !/^\d$/.test(capRaw)) {
      return null;
    }
    const seconds = Number(secondsRaw);
    const cap = Number(capRaw);
    if (seconds > PROGRAM_MAX_SECONDS || cap > 3) {
      return null;
    }
    if (!PROGRAM_VOICES.includes(voiceRaw as ProgramVoice)) {
      return null;
    }
    segments.push({ scene, seconds, voice: voiceRaw as ProgramVoice, cap });
  }
  return { auto: auto === '1', segments };
}

/** The exact wire form; the tablet builds the same string in Kotlin. */
export function formatProgram(program: SessionProgram): string {
  const body = program.segments
    .map((segment) => `${segment.scene},${segment.seconds},${segment.voice},${segment.cap}`)
    .join(';');
  return `${PROGRAM_PREFIX}${program.auto ? '1' : '0'}:${body}`;
}

/** Seconds left in [segment], or null when it is open-ended. */
export function remainingSeconds(segment: ProgramSegment, elapsedSec: number): number | null {
  if (segment.seconds <= 0) {
    return null;
  }
  return Math.max(0, Math.ceil(segment.seconds - elapsedSec));
}
