/**
 * Timestamped sample buffer with a fixed render delay.
 *
 * The tablet receives world state at 1–5 Hz and draws at 60 fps, so it never
 * sees two samples at once. Buffering `delayMs` behind the present and
 * interpolating between the two surrounding samples turns those steps into
 * motion without guessing the future.
 *
 * Pure: no DOM, no three.js, no wall clock. The caller supplies timestamps in
 * milliseconds. `sampleAt` returns one scratch object owned by the buffer; read
 * it before the next call instead of retaining it.
 */

export interface PoseSample {
  headYaw: number;
  headPitch: number;
  headRoll: number;
  worldYaw: number;
  worldPitch: number;
  worldRoll: number;
  floatMm: number;
  swayDeg: number;
}

export interface SampleBufferOptions {
  delayMs?: number;
  capacity?: number;
  staleMs?: number;
}

export interface SampleBuffer {
  push(sample: PoseSample, atMs: number): void;
  sampleAt(nowMs: number): PoseSample | null;
  reset(): void;
  isStale(nowMs: number): boolean;
}

const DEFAULT_DELAY_MS = 100;
const DEFAULT_CAPACITY = 8;
const DEFAULT_STALE_MS = 1500;

/** Wrap a signed degree value into `[-180, 180)`. */
function wrap180(degrees: number): number {
  const wrapped = (((degrees + 180) % 360) + 360) % 360 - 180;
  return wrapped === 180 ? -180 : wrapped;
}

/** Interpolate along the shortest arc so ±180 does not spin a full turn. */
function lerpYaw(a: number, b: number, alpha: number): number {
  return wrap180(a + wrap180(b - a) * alpha);
}

function emptySample(): PoseSample {
  return {
    headYaw: 0,
    headPitch: 0,
    headRoll: 0,
    worldYaw: 0,
    worldPitch: 0,
    worldRoll: 0,
    floatMm: 0,
    swayDeg: 0
  };
}

function copyInto(target: PoseSample, source: PoseSample): void {
  target.headYaw = source.headYaw;
  target.headPitch = source.headPitch;
  target.headRoll = source.headRoll;
  target.worldYaw = source.worldYaw;
  target.worldPitch = source.worldPitch;
  target.worldRoll = source.worldRoll;
  target.floatMm = source.floatMm;
  target.swayDeg = source.swayDeg;
}

export function createSampleBuffer(options: SampleBufferOptions = {}): SampleBuffer {
  const delayMs = Math.max(0, options.delayMs ?? DEFAULT_DELAY_MS);
  const staleMs = Math.max(0, options.staleMs ?? DEFAULT_STALE_MS);
  const capacity = Math.max(1, Math.floor(options.capacity ?? DEFAULT_CAPACITY));

  const slots: PoseSample[] = [];
  for (let i = 0; i < capacity; i++) {
    slots.push(emptySample());
  }
  const times = new Float64Array(capacity);
  const scratch = emptySample();

  let start = 0;
  let count = 0;

  return {
    push(sample: PoseSample, atMs: number): void {
      if (!Number.isFinite(atMs)) {
        return;
      }
      if (count > 0) {
        const newest = (start + count - 1) % capacity;
        const newestAt = times[newest];
        if (atMs < newestAt) {
          return;
        }
        if (atMs === newestAt) {
          copyInto(slots[newest], sample);
          return;
        }
      }
      if (count === capacity) {
        start = (start + 1) % capacity;
        count -= 1;
      }
      const index = (start + count) % capacity;
      copyInto(slots[index], sample);
      times[index] = atMs;
      count += 1;
    },

    sampleAt(nowMs: number): PoseSample | null {
      if (count === 0) {
        return null;
      }
      const target = nowMs - delayMs;
      const newest = (start + count - 1) % capacity;
      if (target <= times[start]) {
        copyInto(scratch, slots[start]);
        return scratch;
      }
      if (target >= times[newest]) {
        copyInto(scratch, slots[newest]);
        return scratch;
      }

      let prev = start;
      let next = newest;
      for (let n = 1; n < count; n += 1) {
        const index = (start + n) % capacity;
        if (times[index] >= target) {
          prev = (start + n - 1) % capacity;
          next = index;
          break;
        }
      }

      const span = times[next] - times[prev];
      const alpha = span > 0 ? (target - times[prev]) / span : 0;
      const a = slots[prev];
      const b = slots[next];

      scratch.headYaw = lerpYaw(a.headYaw, b.headYaw, alpha);
      scratch.headPitch = a.headPitch + (b.headPitch - a.headPitch) * alpha;
      scratch.headRoll = a.headRoll + (b.headRoll - a.headRoll) * alpha;
      scratch.worldYaw = lerpYaw(a.worldYaw, b.worldYaw, alpha);
      scratch.worldPitch = a.worldPitch + (b.worldPitch - a.worldPitch) * alpha;
      scratch.worldRoll = a.worldRoll + (b.worldRoll - a.worldRoll) * alpha;
      scratch.floatMm = a.floatMm + (b.floatMm - a.floatMm) * alpha;
      scratch.swayDeg = a.swayDeg + (b.swayDeg - a.swayDeg) * alpha;
      return scratch;
    },

    reset(): void {
      start = 0;
      count = 0;
      times.fill(0);
    },

    isStale(nowMs: number): boolean {
      if (count === 0) {
        return true;
      }
      const newest = (start + count - 1) % capacity;
      return nowMs - times[newest] > staleMs;
    }
  };
}
