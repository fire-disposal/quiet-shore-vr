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
/** Scene ducking bus: voice cues pull the water bed down, never the reverse. */
let duck: GainNode | null = null;
/** Voice cues get their own bus so ducking cannot touch them. */
let voiceBus: GainNode | null = null;
let duckDepthDb = 12;
/** Buoyancy swell: LFO -> depth -> this gain -> master. One node, no per-frame work. */
let swell: GainNode | null = null;
let swellDepth: GainNode | null = null;
let swellLfo: OscillatorNode | null = null;
interface Bed {
  /** Two decorrelated copies when stereo width > 0, otherwise one. */
  sources: AudioBufferSourceNode[];
  gain: GainNode;
}
let current: Bed | null = null;
/** Identity of the running bed; a width or volume change rebuilds it. */
let currentKey = '';
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
    // Tracks feed the swell bus, which breathes with the buoyancy, then the
    // duck bus, which the voice player pulls down while a cue is speaking.
    swell = context.createGain();
    swell.gain.value = 1;
    duck = context.createGain();
    duck.gain.value = 1;
    swell.connect(duck);
    duck.connect(master);
    voiceBus = context.createGain();
    // Cue level lives here and only here: a per-clip gain would scale it twice.
    voiceBus.gain.value = 0.9;
    voiceBus.connect(master);
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

/** The one AudioContext the page owns: scene bed, cues and swell share it. */
export function getAudioContext(): AudioContext | null {
  return ensureContext();
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
  /** Stereo width 0..1: two decorrelated copies panned apart. */
  width?: number;
}

export function playTrack(track: AudioTrack, options: PlayOptions = {}): void {
  const volume = Math.max(0, options.volume ?? 1);
  const width = Math.max(0, Math.min(1, options.width ?? 0.3));
  const key = `${track}|${volume.toFixed(2)}|${width.toFixed(2)}`;
  if (playing && currentKey === key) {
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

    // The bed's own envelope. Sources sit below it so a two-source bed and a
    // one-source bed fade identically.
    const gain = context.createGain();
    gain.gain.value = 0;
    gain.connect(swell ?? master);

    // A dry mono loop reads as a point source in the middle of the head. Two
    // copies started at different points of the same loop, panned apart, give
    // a wide bed with no extra assets and no cancellation at the centre.
    const stereo = width > 0.02 && typeof context.createStereoPanner === 'function';
    const pans = stereo ? [-width, width] : [0];
    const sources: AudioBufferSourceNode[] = [];
    const share = pans.length > 1 ? 0.5 : 1;
    for (let i = 0; i < pans.length; i += 1) {
      const source = ctxSource(context, buffer, options.loop ?? true);
      const level = context.createGain();
      level.gain.value = share;
      source.connect(level);
      if (stereo) {
        const panner = context.createStereoPanner();
        panner.pan.value = pans[i];
        level.connect(panner);
        panner.connect(gain);
      } else {
        level.connect(gain);
      }
      const offset = pans.length > 1 ? (buffer.duration * 0.37 * i) % buffer.duration : 0;
      source.start(now, offset);
      sources.push(source);
    }
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(volume, now + fade);

    const old = current;
    current = { sources, gain };
    currentKey = key;
    if (old) {
      old.gain.gain.cancelScheduledValues(now);
      old.gain.gain.setValueAtTime(old.gain.gain.value, now);
      old.gain.gain.linearRampToValueAtTime(0, now + fade);
      for (const source of old.sources) {
        try {
          source.stop(now + fade + 0.05);
        } catch {
          // already stopped
        }
      }
    }
  }).catch(() => {
    requestedTrack = null;
  });
}

function ctxSource(
  ctx: AudioContext,
  buffer: AudioBuffer,
  loop: boolean
): AudioBufferSourceNode {
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.loop = loop;
  return source;
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
    for (const source of current.sources) {
      try {
        source.stop(now + 0.5);
      } catch {
        // already stopped
      }
    }
  }
  current = null;
  currentKey = '';
}

export function getVoiceBus(): GainNode | null {
  return voiceBus;
}

/** Duck depth used while a cue is speaking, in dB below the scene bed. */
export function setDuckDepth(db: number): void {
  duckDepthDb = Math.max(0, Math.min(18, db));
}

/**
 * Pull the scene bed down (or release it). Short attack so the first syllable
 * is never buried; the release is slower because a snap back is audible.
 */
export function duckScene(on: boolean): void {
  if (!duck || !context) {
    return;
  }
  const target = on ? Math.pow(10, -duckDepthDb / 20) : 1;
  duck.gain.setTargetAtTime(target, context.currentTime, on ? 0.08 : 0.2);
}

export function preloadSceneAudio(audio: SceneAudio | undefined): void {
  if (audio) {
    preloadTrack(audio.track);
  }
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

/** Scene ambience. `undefined` fades the current bed out instead of looping. */
export function playSceneAudio(audio: SceneAudio | undefined): void {
  if (!audio) {
    stopAudio();
    return;
  }
  playTrack(audio.track, {
    volume: audio.volume,
    fadeMs: audio.fadeMs,
    loop: audio.loop,
    width: audio.width
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
    duck = null;
    voiceBus = null;
  }
}
