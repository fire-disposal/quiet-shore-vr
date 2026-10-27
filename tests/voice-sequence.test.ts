import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A sequence must play every line, and the bed must stay ducked from the first
 * line to the last — including the silent gaps between them.
 *
 * Both used to fail for the same reason: `play()` bumps the cancellation token,
 * so a sequence that captured it aborted after its first clip (one sentence,
 * then the bed came back up). This drives the player against a fake Web Audio
 * graph so the ordering is asserted rather than listened to.
 */

const fetched: string[] = [];
const duckCalls: boolean[] = [];
const started: { at: number }[] = [];
/** Every source the player created, so the test can end a clip on demand. */
const sources: { onended: null | (() => void) }[] = [];

const MANIFEST = {
  version: 1,
  voices: {
    male: {
      speaker: 'x',
      label: 'x',
      totalMs: 0,
      files: [
        { id: 'v-close-1', group: '收束', file: 'male/v-close-1.mp3', ms: 3000, bytes: 1, sha256: '', textHash: '' },
        { id: 'v-close-2', group: '收束', file: 'male/v-close-2.mp3', ms: 2000, bytes: 1, sha256: '', textHash: '' }
      ]
    },
    // The default set is female; the fixture carries the same two cues there so
    // the sequence test does not depend on which set is the default.
    female: {
      speaker: 'x',
      label: 'x',
      totalMs: 0,
      files: [
        { id: 'v-close-1', group: '收束', file: 'female/v-close-1.mp3', ms: 3000, bytes: 1, sha256: '', textHash: '' },
        { id: 'v-close-2', group: '收束', file: 'female/v-close-2.mp3', ms: 2000, bytes: 1, sha256: '', textHash: '' }
      ]
    }
  }
};

function fakeContext(): AudioContext {
  const createGain = () => {
    const gain = {
      gain: {
        value: 1,
        setValueAtTime: () => undefined,
        linearRampToValueAtTime: () => undefined,
        setTargetAtTime: () => undefined,
        cancelScheduledValues: () => undefined
      },
      connect: () => undefined,
      disconnect: () => undefined
    };
    return gain as unknown as GainNode;
  };

  return {
    state: 'running',
    currentTime: 0,
    sampleRate: 24000,
    destination: {},
    resume: async () => undefined,
    createGain,
    // Only the members the voice player touches.
    decodeAudioData: async () => ({ duration: 3 }) as unknown as AudioBuffer,
    createBufferSource: () => {
      const node = {
        buffer: null as AudioBuffer | null,
        playbackRate: { value: 1 },
        connect: () => undefined,
        disconnect: () => undefined,
        stop: () => undefined,
        start: () => {
          started.push({ at: 0 });
          // A real source fires `onended` when its buffer runs out; without
          // that, the clip's own duck hold would never be released and the
          // sequence would look correct while leaking holds.
          const ms = Math.max(1, (node.buffer?.duration ?? 3) * 1000);
          globalThis.setTimeout(() => node.onended?.(), ms);
        },
        onended: null as null | (() => void)
      };
      sources.push(node);
      return node as unknown as AudioBufferSourceNode;
    }
  } as unknown as AudioContext;
}

vi.mock('../src/audio/audio', () => ({
  getAudioContext: () => fakeContext(),
  getVoiceBus: () => ({ connect: () => undefined }) as unknown as GainNode,
  duckScene: (on: boolean) => {
    duckCalls.push(on);
  }
}));

import { createVoicePlayer } from '../src/audio/voice';

beforeEach(() => {
  fetched.length = 0;
  duckCalls.length = 0;
  started.length = 0;
  sources.length = 0;
  vi.stubGlobal('fetch', (url: string) => {
    fetched.push(String(url));
    return Promise.resolve({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(8),
      json: async () => MANIFEST
    });
  });
  vi.stubGlobal('window', {
    // Delegate at call time: the test installs fake timers *after* this stub,
    // so capturing the real ones here left the sequence scheduler out of the
    // clock the assertions advance.
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

describe('voice sequences', () => {
  it('starts on the female set', () => {
    const player = createVoicePlayer();
    expect(player.getSet()).toBe('female');
  });

  it('duck once at the start and release once at the end', async () => {
    vi.useFakeTimers();
    const player = createVoicePlayer();
    await player.load();
    // `load()` reads the manifest as text in some paths; the stub answers both.
    expect(fetched.some((url) => url.includes('manifest.json'))).toBe(true);

    player.playSequence('close');
    await vi.advanceTimersByTimeAsync(0);

    // First clip is playing. The leading `false` is `stop()` clearing a duck
    // that was not there; the bed is then held down.
    expect(duckCalls).toEqual([false, true]);

    await vi.advanceTimersByTimeAsync(3000 + 6000 + 50);
    // The gap is over and the second line started; the bed never came back up
    // in between, which is exactly what the old token bug caused.
    expect(duckCalls).toEqual([false, true]);

    // The last sentence ends: only now may the bed come back up. A sequence
    // that aborted after its first line released it mid-gap instead.
    await vi.advanceTimersByTimeAsync(5000);
    expect(duckCalls).toEqual([false, true, false]);
  });
});
