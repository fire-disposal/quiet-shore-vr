/**
 * Scheduling policy for the ambience bed.
 *
 * The shipped clips are 16 s (stream) and 25 s (lake/rain). Looping one clip
 * is audibly short: the ear locks onto the loop point and the whole session
 * starts to feel repetitive. The bed therefore runs two looping lanes at
 * slightly different rates and cross-fades between them at random intervals,
 * with short overlapping "detail" passes on top so no two minutes sound alike.
 *
 * Pure math on a random source, so the ranges are testable without Web Audio.
 */

export interface BedPlan {
  /** Seconds until the next lane swap. */
  swapAfterS: number;
  /** Cross-fade length of that swap. */
  fadeS: number;
  /** Where a restarted lane begins inside the clip. */
  offsetS: number;
  /** Playback-rate jitter; the two lanes drift apart so the sum never repeats. */
  rate: number;
}

export interface DetailPlan {
  /** Seconds until the next detail pass. */
  afterS: number;
  /** Length of the pass itself. */
  lengthS: number;
  /** Offset inside the clip. */
  offsetS: number;
  /** Level relative to the bed (0..1). */
  gain: number;
}

/** Ranges, all in seconds unless noted. Tuned for a 16–25 s source. */
const SWAP_RANGE: readonly [number, number] = [0.7, 1.2];
const FADE_RANGE: readonly [number, number] = [3, 5.5];
const RATE_RANGE: readonly [number, number] = [0.994, 1.006];
const DETAIL_GAP: readonly [number, number] = [6, 15];
const DETAIL_LENGTH: readonly [number, number] = [1.6, 4.2];
const DETAIL_GAIN: readonly [number, number] = [0.14, 0.28];

function between(random: () => number, range: readonly [number, number]): number {
  const value = random();
  const bounded = value >= 0 && value < 1 ? value : 0.5;
  return range[0] + (range[1] - range[0]) * bounded;
}

/**
 * One lane swap: how long to play before crossing, how long the cross-fade is,
 * and where/at what rate the freed lane restarts.
 */
export function planSwap(random: () => number, clipSeconds: number): BedPlan {
  const clip = clipSeconds > 1 ? clipSeconds : 1;
  const gap = between(random, SWAP_RANGE) * clip;
  const offset = between(random, [0, 1]);
  return {
    // A swap must not arrive before the fade can complete, and should not be
    // longer than the clip or the "short" feeling comes back.
    swapAfterS: Math.max(FADE_RANGE[1], gap),
    fadeS: Math.min(between(random, FADE_RANGE), clip / 3),
    offsetS: offset * clip,
    rate: between(random, RATE_RANGE)
  };
}

/**
 * A detail pass: a short slice of the same clip, quietly, so the bed gains
 * texture (a ripple, a shift in the stream) without a second asset.
 */
export function planDetail(random: () => number, clipSeconds: number): DetailPlan {
  const clip = clipSeconds > 1 ? clipSeconds : 1;
  const lengthS = Math.min(between(random, DETAIL_LENGTH), clip / 4);
  // Leave room for the slice: an offset near the end would be cut short.
  const offset = between(random, [0, 1]) * Math.max(0, clip - lengthS);
  return {
    afterS: between(random, DETAIL_GAP),
    lengthS,
    offsetS: offset,
    gain: between(random, DETAIL_GAIN)
  };
}
