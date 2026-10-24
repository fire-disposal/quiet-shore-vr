import lakeUrl from './lake.mp3';
import streamUrl from './stream.mp3';
import rainUrl from './rain.mp3';
import type { AudioTrack } from './types';
import type { SceneAudio } from './types';
import { planDetail, planSwap } from './bed-schedule';

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
/**
 * One ambience lane: a looping source with its own cross-fade gain and panner.
 * Two lanes exist per bed; exactly one is open at a time.
 */
interface Lane {
  gain: GainNode;
  panner: StereoPannerNode | null;
  source: AudioBufferSourceNode | null;
}

interface Bed {
  lanes: Lane[];
  gain: GainNode;
  /** Which lane is audible; the other is being re-seeded behind the fade. */
  active: number;
  /** Lane-swap and detail timers, cleared on stop. */
  timers: number[];
  stopped: boolean;
}
let current: Bed | null = null;
/** Identity of the running bed; a width or volume change rebuilds it. */
let currentKey = '';
const buffers: Partial<Record<AudioTrack, AudioBuffer>> = {};
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
    master.gain.value = VOLUME;
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

    // The bed's own envelope. Everything below fades with it, so a lane swap
    // is invisible from outside.
    const ctx = context;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.connect(swell ?? master);

    const stereo = width > 0.02 && typeof ctx.createStereoPanner === 'function';
    const lanes: Lane[] = [0, 1].map((index) => {
      const laneGain = ctx.createGain();
      laneGain.gain.value = index === 0 ? 1 : 0;
      let panner: StereoPannerNode | null = null;
      if (stereo) {
        panner = ctx.createStereoPanner();
        // The two lanes sit on opposite sides so a swap also widens the image
        // instead of collapsing it to the centre.
        panner.pan.value = index === 0 ? -width : width;
        laneGain.connect(panner);
        panner.connect(gain);
      } else {
        laneGain.connect(gain);
      }
      return { gain: laneGain, panner, source: null };
    });

    const bed: Bed = {
      lanes,
      gain,
      active: 0,
      timers: [],
      stopped: false
    };

    /** (Re)start one lane at a random point and rate, at its current level. */
    const seed = (lane: Lane): void => {
      if (!context || bed.stopped) {
        return;
      }
      const plan = planSwap(Math.random, buffer.duration);
      if (lane.source) {
        try {
          lane.source.stop();
        } catch {
          // already stopped
        }
        lane.source.disconnect();
      }
      const source = ctxSource(context, buffer, true);
      source.playbackRate.value = plan.rate;
      source.connect(lane.gain);
      try {
        source.start(context.currentTime, plan.offsetS);
      } catch {
        // context closing
      }
      lane.source = source;
    };

    const scheduleSwap = (): void => {
      const plan = planSwap(Math.random, buffer.duration);
      const timer = window.setTimeout(() => {
        if (bed.stopped || !context) {
          return;
        }
        const from = bed.lanes[bed.active];
        const to = bed.lanes[1 - bed.active];
        const at = context.currentTime;
        // Cross-fade: the outgoing lane falls while the incoming rises, so the
        // sum stays at unit level and no loop point is ever bare.
        from.gain.gain.cancelScheduledValues(at);
        from.gain.gain.setValueAtTime(from.gain.gain.value, at);
        from.gain.gain.linearRampToValueAtTime(0, at + plan.fadeS);
        to.gain.gain.cancelScheduledValues(at);
        to.gain.gain.setValueAtTime(to.gain.gain.value, at);
        to.gain.gain.linearRampToValueAtTime(1, at + plan.fadeS);
        bed.active = 1 - bed.active;
        // Re-seed the now-silent lane after the fade, at a new point and rate.
        const reseed = window.setTimeout(() => seed(from), plan.fadeS * 1000 + 150);
        bed.timers.push(reseed);
        scheduleSwap();
      }, plan.swapAfterS * 1000);
      bed.timers.push(timer);
    };

    /**
     * Short, quiet overlapping passes: a ripple or a shift in the stream. They
     * are what stops a two-lane bed from reading as one steady hiss.
     */
    const scheduleDetail = (): void => {
      const plan = planDetail(Math.random, buffer.duration);
      const timer = window.setTimeout(() => {
        if (bed.stopped || !context) {
          return;
        }
        const at = context.currentTime;
        const envelope = context.createGain();
        envelope.gain.value = 0;
        envelope.connect(gain);
        const source = ctxSource(context, buffer, false);
        source.playbackRate.value = 1 + (Math.random() - 0.5) * 0.01;
        source.connect(envelope);
        const attack = Math.min(1.2, plan.lengthS / 3);
        envelope.gain.setValueAtTime(0, at);
        envelope.gain.linearRampToValueAtTime(plan.gain, at + attack);
        envelope.gain.setValueAtTime(plan.gain, at + plan.lengthS - attack);
        envelope.gain.linearRampToValueAtTime(0, at + plan.lengthS);
        try {
          source.start(at, plan.offsetS, plan.lengthS);
          source.stop(at + plan.lengthS + 0.05);
        } catch {
          // context closing
        }
        source.onended = () => {
          source.disconnect();
          envelope.disconnect();
        };
        scheduleDetail();
      }, plan.afterS * 1000);
      bed.timers.push(timer);
    };

    seed(lanes[0]);
    seed(lanes[1]);
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(volume, now + fade);
    scheduleSwap();
    scheduleDetail();

    const old = current;
    current = bed;
    currentKey = key;
    if (old) {
      fadeOutBed(old, now, fade);
    }
  }).catch(() => {
    requestedTrack = null;
  });
}

/** Fade a bed out and stop its sources and timers. */
function fadeOutBed(bed: Bed, now: number, fade: number): void {
  bed.stopped = true;
  for (const timer of bed.timers) {
    window.clearTimeout(timer);
  }
  bed.timers.length = 0;
  bed.gain.gain.cancelScheduledValues(now);
  bed.gain.gain.setValueAtTime(bed.gain.gain.value, now);
  bed.gain.gain.linearRampToValueAtTime(0, now + fade);
  for (const lane of bed.lanes) {
    const source = lane.source;
    if (source) {
      try {
        source.stop(now + fade + 0.05);
      } catch {
        // already stopped
      }
    }
  }
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
    fadeOutBed(current, context.currentTime, 0.4);
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
