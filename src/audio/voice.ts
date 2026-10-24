import { duckScene, getVoiceBus } from './audio';

/**
 * Pre-generated voice cues.
 *
 * Clips are synthesized offline (`scripts/voice/build.py`), shipped inside the
 * headset APK and served by the loopback at `/voice/<set>/<id>.mp3`. Nothing
 * here synthesizes speech: the page only fetches, decodes and mixes, so a line
 * starts in well under a second and the patient never hears a robotic fallback.
 *
 * The scene bed is ducked while a cue speaks, never muted: the water is a
 * self-motion cue (see `audio.ts`), and silence would remove the very thing the
 * voice is supposed to explain.
 */

export type VoiceSet = 'male' | 'female';

export interface VoiceFile {
  id: string;
  group: string;
  file: string;
  ms: number;
  bytes: number;
  sha256: string;
  textHash: string;
}

export interface VoiceManifest {
  version: number;
  voices: Record<VoiceSet, {
    speaker: string;
    label: string;
    totalMs: number;
    files: VoiceFile[];
  }>;
}

export type SequenceName = 'start' | 'imagine' | 'relax' | 'close';

export interface SequenceStep {
  readonly id: string;
  /** Silence after the clip before the next one, in ms. */
  readonly gapMs: number;
}

/**
 * Sequences are measured in *gaps after a clip ends*, not absolute times: a
 * regenerated voice with different pacing must not overlap the next line.
 * `v-cal-2` and the 渐入 lines deliberately sit close together — calibration
 * is driven by the headset's own state, the gaps only cover the hand-off.
 */
export const SEQUENCES: Readonly<Record<SequenceName, readonly SequenceStep[]>> = {
  start: [
    { id: 'v-arrive-1', gapMs: 4000 },
    { id: 'v-arrive-2', gapMs: 5000 },
    { id: 'v-wear-1', gapMs: 4000 },
    { id: 'v-wear-2', gapMs: 6000 },
    { id: 'v-cal-1', gapMs: 2500 },
    { id: 'v-cal-2', gapMs: 3000 },
    { id: 'v-enter-1', gapMs: 4500 },
    { id: 'v-enter-2', gapMs: 0 }
  ],
  imagine: [
    { id: 'v-imagine-1', gapMs: 15000 },
    { id: 'v-imagine-2', gapMs: 15000 },
    { id: 'v-imagine-3', gapMs: 15000 },
    { id: 'v-imagine-4', gapMs: 15000 },
    { id: 'v-imagine-5', gapMs: 15000 },
    { id: 'v-imagine-6', gapMs: 0 }
  ],
  relax: [
    { id: 'v-relax-1', gapMs: 12000 },
    { id: 'v-relax-2', gapMs: 12000 },
    { id: 'v-relax-3', gapMs: 12000 },
    { id: 'v-relax-4', gapMs: 0 }
  ],
  close: [
    { id: 'v-close-1', gapMs: 6000 },
    { id: 'v-close-2', gapMs: 0 }
  ]
};

/** Absolute times for a session planner, derived from the clip lengths. */
export function expandSequence(
  name: SequenceName,
  durationOf: (id: string) => number
): { id: string; atMs: number }[] {
  const out: { id: string; atMs: number }[] = [];
  let cursor = 0;
  for (const step of SEQUENCES[name]) {
    out.push({ id: step.id, atMs: cursor });
    cursor += durationOf(step.id) + step.gapMs;
  }
  return out;
}

/**
 * Auto mode plan for a session of [sessionMs].
 *
 * One start sequence, imagery once the scene has settled, the relax guidance at
 * the midpoint (only when the session is long enough for it to make sense), and
 * a close sequence one minute before the planned end.
 */
export function autoPlan(
  sessionMs: number
): { atMs: number; seq: SequenceName }[] {
  if (!(sessionMs > 0)) {
    return [{ atMs: 0, seq: 'start' }];
  }
  const plan: { atMs: number; seq: SequenceName }[] = [{ atMs: 0, seq: 'start' }];
  const imagine = Math.min(90_000, Math.round(sessionMs * 0.15));
  plan.push({ atMs: imagine, seq: 'imagine' });
  if (sessionMs >= 240_000) {
    plan.push({ atMs: Math.round(sessionMs / 2), seq: 'relax' });
  }
  plan.push({ atMs: Math.max(0, sessionMs - 60_000), seq: 'close' });
  return plan;
}

export interface VoicePlayerApi {
  load(): Promise<boolean>;
  /** Manifest index of a cue id, or -1; the wire carries this byte. */
  indexOf(id: string): number;
  isReady(): boolean;
  setSet(set: VoiceSet): void;
  getSet(): VoiceSet;
  setVolume(percent: number): void;
  play(id: string): Promise<boolean>;
  playSequence(name: SequenceName): boolean;
  stop(): void;
  nowPlaying(): { id: string | null; sequence: SequenceName | null };
}

const BASE = '/voice';
const MANIFEST_URL = `${BASE}/manifest.json`;

export function createVoicePlayer(): VoicePlayerApi {
  let manifest: VoiceManifest | null = null;
  let loading: Promise<boolean> | null = null;
  let set: VoiceSet = 'male';
  let volume = 0.9;

  const decoded = new Map<string, AudioBuffer>();
  let context: AudioContext | null = null;
  let source: AudioBufferSourceNode | null = null;
  let activeId: string | null = null;
  let activeSequence: SequenceName | null = null;
  let sequenceTimer: number | null = null;
  let stopToken = 0;

  function ensureContext(): AudioContext | null {
    if (!context) {
      const Ctor = window.AudioContext;
      if (!Ctor) {
        return null;
      }
      context = new Ctor();
    }
    if (context.state === 'suspended') {
      void context.resume();
    }
    return context;
  }

  function urlFor(file: VoiceFile): string {
    return `${BASE}/${file.file}`;
  }

  function fileById(id: string): VoiceFile | null {
    if (!manifest) {
      return null;
    }
    const bucket = manifest.voices[set];
    return bucket ? bucket.files.find((entry) => entry.id === id) ?? null : null;
  }

  async function bufferFor(id: string): Promise<AudioBuffer | null> {
    const ctx = ensureContext();
    if (!ctx) {
      return null;
    }
    const key = `${set}/${id}`;
    const cached = decoded.get(key);
    if (cached) {
      return cached;
    }
    const file = fileById(id);
    if (!file) {
      return null;
    }
    try {
      const response = await fetch(urlFor(file));
      if (!response.ok) {
        return null;
      }
      const buffer = await ctx.decodeAudioData(await response.arrayBuffer());
      decoded.set(key, buffer);
      return buffer;
    } catch {
      return null;
    }
  }

  function releaseDuck(): void {
    duckScene(false);
  }

  function stopSource(): void {
    if (source) {
      try {
        source.stop();
      } catch {
        // already stopped
      }
      source = null;
    }
    activeId = null;
  }

  async function play(id: string): Promise<boolean> {
    const ctx = ensureContext();
    const bus = getVoiceBus();
    if (!ctx || !bus) {
      return false;
    }
    const token = ++stopToken;
    const buffer = await bufferFor(id);
    if (!buffer || token !== stopToken) {
      return false;
    }
    stopSource();
    // Unity here: the bus already carries the cue level.
    const gain = ctx.createGain();
    gain.gain.value = 1;
    const next = ctx.createBufferSource();
    next.buffer = buffer;
    next.connect(gain);
    gain.connect(bus);
    duckScene(true);
    next.onended = () => {
      if (source === next) {
        source = null;
        activeId = null;
        releaseDuck();
      }
    };
    source = next;
    activeId = id;
    next.start();
    return true;
  }

  function clearSequenceTimer(): void {
    if (sequenceTimer !== null) {
      window.clearTimeout(sequenceTimer);
      sequenceTimer = null;
    }
  }

  function playSequence(name: SequenceName): boolean {
    const steps = SEQUENCES[name];
    if (!steps.length) {
      return false;
    }
    stop();
    activeSequence = name;
    const token = stopToken;
    let index = 0;

    const step = (): void => {
      const currentManifest = manifest;
      if (token !== stopToken || !currentManifest) {
        return;
      }
      const current = steps[index];
      if (!current) {
        activeSequence = null;
        return;
      }
      void play(current.id).then((played) => {
        if (!played || token !== stopToken) {
          activeSequence = null;
          return;
        }
        index += 1;
        if (index >= steps.length) {
          activeSequence = null;
          return;
        }
        const duration = currentManifest.voices[set]?.files.find((f) => f.id === current.id)?.ms ?? 3000;
        // Duck stays down across the gap so the bed does not pump between lines.
        sequenceTimer = window.setTimeout(step, duration + current.gapMs);
      });
    };
    step();
    return true;
  }

  function stop(): void {
    stopToken += 1;
    clearSequenceTimer();
    stopSource();
    activeSequence = null;
    releaseDuck();
  }

  async function load(): Promise<boolean> {
    if (manifest) {
      return true;
    }
    if (loading) {
      return loading;
    }
    loading = (async () => {
      try {
        const response = await fetch(MANIFEST_URL);
        if (!response.ok) {
          return false;
        }
        const parsed = (await response.json()) as VoiceManifest;
        if (!parsed?.voices?.male?.files?.length) {
          return false;
        }
        manifest = parsed;
        // Prime the lines a session reaches first; failures are cosmetic.
        const prime = ['v-safe-1', 'v-arrive-1', 'v-cal-1', 'v-enter-1', 'v-relax-1', 'v-close-1'];
        void Promise.all(prime.map((id) => bufferFor(id)));
        return true;
      } catch {
        return false;
      } finally {
        loading = null;
      }
    })();
    return loading;
  }

  return {
    load,
    indexOf: (id: string) => manifest?.voices[set]?.files.findIndex((f) => f.id === id) ?? -1,
    isReady: () => manifest !== null,
    setSet(next: VoiceSet): void {
      if (next !== set) {
        set = next;
        decoded.clear();
      }
    },
    getSet: () => set,
    setVolume(percent: number): void {
      volume = Math.max(0, Math.min(1, percent / 100));
      const bus = getVoiceBus();
      if (bus && context) {
        bus.gain.setTargetAtTime(volume, context.currentTime, 0.05);
      }
    },
    play,
    playSequence,
    stop,
    nowPlaying: () => ({ id: activeId, sequence: activeSequence })
  };
}
