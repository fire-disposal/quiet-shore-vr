import lakeUrl from './lake.mp3';
import streamUrl from './stream.mp3';
import rainUrl from './rain.mp3';
import type { AudioTrack } from './types';
import type { SceneAudio } from './types';

export type { AudioTrack } from './types';

const URLS: Record<AudioTrack, string> = {
  lake: lakeUrl,
  stream: streamUrl,
  rain: rainUrl
};

const VOLUME = 0.6;
const FADE_SECONDS = 1.2;

let context: AudioContext | null = null;
let master: GainNode | null = null;
/** Buoyancy swell: LFO -> depth -> this gain -> master. One node, no per-frame work. */
let swell: GainNode | null = null;
let swellDepth: GainNode | null = null;
let swellLfo: OscillatorNode | null = null;
let current: { source: AudioBufferSourceNode; gain: GainNode } | null = null;
const buffers: Partial<Record<AudioTrack, AudioBuffer>> = {};
let muted = false;
let playing = false;
let token = 0;
let currentTrack: AudioTrack | null = null;
let requestedTrack: AudioTrack | null = null;

function ensureContext(): AudioContext | null {
  if (!context) {
    const Ctor = window.AudioContext;
    if (!Ctor) {
      return null;
    }
    context = new Ctor();
    master = context.createGain();
    master.gain.value = muted ? 0 : VOLUME;
    master.connect(context.destination);
    // Tracks feed the swell bus, which breathes with the buoyancy.
    swell = context.createGain();
    swell.gain.value = 1;
    swell.connect(master);
    swellDepth = context.createGain();
    swellDepth.gain.value = 0;
    swellLfo = context.createOscillator();
    swellLfo.type = 'sine';
    swellLfo.frequency.value = 1 / 12;
    swellLfo.connect(swellDepth);
    swellDepth.connect(swell.gain);
    swellLfo.start();
  }
  if (context.state === 'suspended') {
    void context.resume();
  }
  return context;
}

async function bufferFor(track: AudioTrack): Promise<AudioBuffer | null> {
  const ctx = ensureContext();
  if (!ctx) {
    return null;
  }
  const cached = buffers[track];
  if (cached) {
    return cached;
  }
  const response = await fetch(URLS[track]);
  const data = await response.arrayBuffer();
  const buffer = await ctx.decodeAudioData(data);
  buffers[track] = buffer;
  return buffer;
}

export async function unlockAudio(): Promise<void> {
  const ctx = ensureContext();
  if (ctx && ctx.state === 'suspended') {
    await ctx.resume();
  }
}

export function preloadTrack(track: AudioTrack): void {
  if (buffers[track]) {
    return;
  }
  void bufferFor(track).catch(() => undefined);
}

export interface PlayOptions {
  volume?: number;
  fadeMs?: number;
  loop?: boolean;
}

export function playTrack(track: AudioTrack, options: PlayOptions = {}): void {
  if (playing && (requestedTrack === track || currentTrack === track)) {
    return;
  }
  playing = true;
  requestedTrack = track;
  const myToken = ++token;
  void bufferFor(track).then((buffer) => {
    if (!buffer || !playing || myToken !== token || !context || !master) {
      return;
    }
    currentTrack = track;
    requestedTrack = null;
    const now = context.currentTime;
    const fade = Math.max(0, (options.fadeMs ?? FADE_SECONDS * 1000) / 1000);
    const volume = Math.max(0, options.volume ?? 1);
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.loop = options.loop ?? true;
    const gain = context.createGain();
    gain.gain.value = 0;
    source.connect(gain);
    gain.connect(swell ?? master);
    source.start();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(volume, now + fade);

    const old = current;
    current = { source, gain };
    if (old) {
      old.gain.gain.cancelScheduledValues(now);
      old.gain.gain.setValueAtTime(old.gain.gain.value, now);
      old.gain.gain.linearRampToValueAtTime(0, now + fade);
      try {
        old.source.stop(now + fade + 0.05);
      } catch {
        // already stopped
      }
    }
  }).catch(() => {
    requestedTrack = null;
  });
}

export function stopAudio(): void {
  playing = false;
  requestedTrack = null;
  currentTrack = null;
  token += 1;
  if (current && context) {
    const now = context.currentTime;
    current.gain.gain.cancelScheduledValues(now);
    current.gain.gain.setValueAtTime(current.gain.gain.value, now);
    current.gain.gain.linearRampToValueAtTime(0, now + 0.4);
    try {
      current.source.stop(now + 0.5);
    } catch {
      // already stopped
    }
  }
  current = null;
}

export function preloadSceneAudio(audio: SceneAudio): void {
  preloadTrack(audio.track);
}

/**
 * Low-frequency gain swell used as a self-motion cue.
 *
 * Auditory stimuli produce weak vection on their own but add significantly to
 * it when paired with visual motion (Sci Rep 2020, water-immersion vection).
 * The swell follows the buoyancy phase instead of running free, so what the
 * patient hears rises and falls with what they see. [depth] 0 disables it.
 */
export function setBuoyancySwell(depth: number, periodSeconds: number): void {
  if (!swellDepth || !swellLfo || !context) {
    return;
  }
  const now = context.currentTime;
  swellDepth.gain.setTargetAtTime(Math.max(0, Math.min(0.2, depth)), now, 0.4);
  if (periodSeconds > 0) {
    swellLfo.frequency.setTargetAtTime(1 / periodSeconds, now, 0.6);
  }
}

export function playSceneAudio(audio: SceneAudio): void {
  playTrack(audio.track, {
    volume: audio.volume,
    fadeMs: audio.fadeMs,
    loop: audio.loop
  });
}

function setMuted(next: boolean): void {
  muted = next;
  if (master && context) {
    const now = context.currentTime;
    master.gain.cancelScheduledValues(now);
    master.gain.setValueAtTime(master.gain.value, now);
    master.gain.linearRampToValueAtTime(muted ? 0 : VOLUME, now + 0.2);
  }
}

export function setAudioMuted(next: boolean): void {
  setMuted(next);
}

export function toggleMuted(): boolean {
  setMuted(!muted);
  return muted;
}

export function disposeAudio(): void {
  stopAudio();
  if (context) {
    void context.close();
    context = null;
    master = null;
  }
}
