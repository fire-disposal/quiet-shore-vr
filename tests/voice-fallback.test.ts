import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `HTMLAudioElement` fallback contract (audit M5).
 *
 * When `decodeAudioData` refuses a clip, the player plays it through an
 * `<audio>` element instead. That path used to report success the instant it
 * called `play()`, and a sequence scheduled its next line off that answer, so a
 * headset that refused autoplay produced a silent, perfectly timed sequence.
 *
 * Each case here drives the deferred `play()` promise by hand: the deferred
 * rejects, resolves late, or settles after the clip was already replaced. The
 * assertions are about ordering, so nothing depends on real time or on the
 * browser's own media stack.
 */

interface FakeElement {
  src: string;
  volume: number;
  paused: boolean;
  onended: null | (() => void);
  play(): Promise<void>;
  pause(): void;
}

const elements: FakeElement[] = [];
const duckCalls: boolean[] = [];
/** Every `play()` call in creation order, so a case can settle them by index. */
const pending: { resolve: () => void; reject: (error: Error) => void }[] = [];

const files = (prefix: string) =>
  ['v-close-1', 'v-close-2', 'v-safe-1', 'v-wear-1', 'v-cal-1', 'v-rise-1', 'v-relax-1'].map((id, index) => ({
    id,
    group: index < 2 ? '收束' : '前置',
    file: `${prefix}/${id}.mp3`,
    ms: index === 0 ? 3000 : 2000,
    bytes: 1,
    sha256: '',
    textHash: ''
  }));

const MANIFEST = {
  version: 1,
  voices: {
    male: { speaker: 'x', label: 'x', totalMs: 0, files: files('male') },
    // The default set is female, so the fixture carries the cues there too.
    female: { speaker: 'x', label: 'x', totalMs: 0, files: files('female') }
  }
};

/**
 * A context that cannot decode: `decodeAudioData` throws the way Gecko on
 * Android does, which is the only way the fallback is reached.
 */
function fakeContext(): AudioContext {
  return {
    state: 'running',
    currentTime: 0,
    sampleRate: 24000,
    destination: {},
    resume: async () => undefined,
    createGain: () =>
      ({
        gain: {
          value: 1,
          setValueAtTime: () => undefined,
          linearRampToValueAtTime: () => undefined,
          setTargetAtTime: () => undefined,
          cancelScheduledValues: () => undefined
        },
        connect: () => undefined,
        disconnect: () => undefined
      }) as unknown as GainNode,
    decodeAudioData: async () => {
      throw new Error('decode refused');
    },
    createBufferSource: () => {
      throw new Error('no decoded clip can reach a buffer source');
    }
  } as unknown as AudioContext;
}

function fakeAudio(this: unknown, src: string): FakeElement {
  const element: FakeElement = {
    src,
    volume: 1,
    paused: true,
    onended: null,
    play: () => {
      const deferredPlay = Promise.withResolvers<void>();
      pending.push({
        resolve: () => {
          element.paused = false;
          deferredPlay.resolve();
        },
        reject: deferredPlay.reject
      });
      return deferredPlay.promise;
    },
    pause() {
      element.paused = true;
    }
  };
  elements.push(element);
  return element;
}

function recorder() {
  return {
    connect: () => undefined,
    disconnect: () => undefined
  };
}

vi.mock('../src/audio/audio', () => ({
  getAudioContext: () => fakeContext(),
  getVoiceBus: () => recorder() as unknown as GainNode,
  duckScene: (on: boolean) => {
    duckCalls.push(on);
  }
}));

import { createVoicePlayer } from '../src/audio/voice';

/** Flush the pending microtask chain of the player (fetch, decode, settle). */
const settle = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => {
  elements.length = 0;
  pending.length = 0;
  duckCalls.length = 0;
  vi.stubGlobal('fetch', () =>
    Promise.resolve({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(8),
      json: async () => MANIFEST
    })
  );
  vi.stubGlobal('Audio', fakeAudio);
  vi.stubGlobal('window', {
    // Delegate at call time: the sequence cases install fake timers after this
    // stub, so capturing the real ones here would leave the scheduler out of
    // the clock the assertions advance.
    setTimeout: (...args: Parameters<typeof setTimeout>) => globalThis.setTimeout(...args),
    clearTimeout: (...args: Parameters<typeof clearTimeout>) => globalThis.clearTimeout(...args),
    AudioContext: undefined,
    Audio: undefined
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('voice element fallback', () => {
  it('does not report success until the platform accepts the clip', async () => {
    vi.useFakeTimers();
    const player = createVoicePlayer();
    await player.load();

    let played: boolean | null = null;
    void player.play('v-close-1').then((result) => {
      played = result;
    });
    await settle();

    // The clip was requested, but nothing has been accepted yet: the answer
    // stays open, which is the whole point of the fix.
    expect(elements.length).toBe(1);
    expect(played).toBeNull();
    expect(player.nowPlaying().id).toBeNull();

    pending[0].resolve();
    await settle();
    expect(played).toBe(true);
    expect(player.nowPlaying().id).toBe('v-close-1');
    expect(player.lastError()).toBe('');
  });

  it('reports failure when the platform refuses to play', async () => {
    vi.useFakeTimers();
    const player = createVoicePlayer();
    await player.load();

    let played: boolean | null = null;
    void player.play('v-close-1').then((result) => {
      played = result;
    });
    await settle();

    pending[0].reject(new Error('NotAllowedError'));
    await settle();

    expect(played).toBe(false);
    expect(player.lastError()).toBe('播放被拒绝');
    expect(player.nowPlaying().id).toBeNull();
    // The attempted clip never sounded, so the bed must not stay ducked: the
    // hold this attempt took is released again.
    expect(duckCalls).toEqual([true, false]);
  });

  it('keeps a newer clip alive when the replaced clip settles late', async () => {
    vi.useFakeTimers();
    const player = createVoicePlayer();
    await player.load();

    let first: boolean | null = null;
    let second: boolean | null = null;
    void player.play('v-close-1').then((result) => {
      first = result;
    });
    await settle();
    void player.play('v-close-2').then((result) => {
      second = result;
    });
    await settle();

    // The second clip is accepted first, then the replaced one resolves.
    pending[1].resolve();
    await settle();
    expect(second).toBe(true);
    expect(player.nowPlaying().id).toBe('v-close-2');
    expect(elements[1].paused).toBe(false);

    pending[0].resolve();
    await settle();

    // The late resolve must not claim the state, pause the newer clip or
    // report the old clip as the one playing.
    expect(first).toBe(false);
    expect(player.nowPlaying().id).toBe('v-close-2');
    expect(elements[1].paused).toBe(false);
    expect(player.lastError()).toBe('');
  });

  it('does not let a replaced clip publish after a stop', async () => {
    vi.useFakeTimers();
    const player = createVoicePlayer();
    await player.load();

    let played: boolean | null = null;
    void player.play('v-close-1').then((result) => {
      played = result;
    });
    await settle();

    player.stop();
    pending[0].resolve();
    await settle();

    expect(played).toBe(false);
    expect(player.nowPlaying().id).toBeNull();
    // Nothing was ever audible, so the stop's release is the last word.
    expect(duckCalls).toEqual([true, false]);
  });

  it('does not let a pre-stop settle release a newer clip duck hold', async () => {
    vi.useFakeTimers();
    const player = createVoicePlayer();
    await player.load();

    void player.play('v-close-1');
    await settle();
    player.stop();

    void player.play('v-close-2');
    await settle();
    pending[1].resolve();
    await settle();
    expect(player.nowPlaying().id).toBe('v-close-2');
    expect(duckCalls).toEqual([true, false, true]);

    pending[0].reject(new Error('late refusal'));
    await settle();
    expect(duckCalls).toEqual([true, false, true]);

    elements[1].onended?.();
    expect(duckCalls).toEqual([true, false, true, false]);
  });

  it('stops the sequence instead of scheduling the next line on refusal', async () => {
    vi.useFakeTimers();
    const player = createVoicePlayer();
    await player.load();

    const started = player.playSequence('close');
    expect(started).toBe(true);
    await settle();
    expect(elements.length).toBe(1);

    pending[0].reject(new Error('NotAllowedError'));
    await settle();

    expect(player.nowPlaying()).toEqual({ id: null, sequence: null });
    expect(player.lastError()).toBe('播放被拒绝');

    // The old code kept the sequence alive and fired the next sentence 9 s on.
    await vi.advanceTimersByTimeAsync(3000 + 6000 + 50);
    expect(elements.length).toBe(1);
    expect(player.nowPlaying()).toEqual({ id: null, sequence: null });
  });

  it('schedules the next line only once the first one is actually playing', async () => {
    vi.useFakeTimers();
    const player = createVoicePlayer();
    await player.load();

    player.playSequence('close');
    await settle();
    expect(elements.length).toBe(1);

    // Nothing is playing yet, so no gap timer may be running in the player's
    // name: advancing the clock must not skip a line.
    await vi.advanceTimersByTimeAsync(3000 + 6000 + 50);
    expect(elements.length).toBe(1);

    pending[0].resolve();
    await settle();
    expect(player.nowPlaying()).toEqual({ id: 'v-close-1', sequence: 'close' });

    // From the accepted start, the clip length plus its gap leads to line two.
    await vi.advanceTimersByTimeAsync(3000 + 6000 + 50);
    expect(elements.length).toBe(2);
    expect(player.nowPlaying()).toEqual({ id: null, sequence: 'close' });
    pending[1].resolve();
    await settle();
    // The final line is playing; the sequence itself has no next step.
    expect(player.nowPlaying()).toEqual({ id: 'v-close-2', sequence: null });
  });

  it('keeps a newer sequence when the replaced one settles late', async () => {
    vi.useFakeTimers();
    const player = createVoicePlayer();
    await player.load();

    player.playSequence('close');
    await settle();
    // Line one is accepted, so this sequence is mid-walk when it is cancelled.
    pending[0].resolve();
    await settle();
    expect(player.nowPlaying()).toEqual({ id: 'v-close-1', sequence: 'close' });

    // A second sequence cancels the first and starts its own first line.
    player.playSequence('close');
    await settle();
    expect(elements.length).toBe(2);

    // No line is published until it is accepted. The cancelled sequence's
    // callback settles first and must not clear or claim this new sequence.
    expect(player.nowPlaying()).toEqual({ id: null, sequence: 'close' });
    pending[1].resolve();
    await settle();
    expect(player.nowPlaying()).toEqual({ id: 'v-close-1', sequence: 'close' });

    await vi.advanceTimersByTimeAsync(3000 + 6000 + 50);
    expect(elements.length).toBe(3);
    expect(player.nowPlaying()).toEqual({ id: null, sequence: 'close' });
    pending[2].resolve();
    await settle();
    expect(player.nowPlaying()).toEqual({ id: 'v-close-2', sequence: null });
  });
});
