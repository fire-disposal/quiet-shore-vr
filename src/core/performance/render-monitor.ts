/**
 * Small, dependency-free frame-time monitor. It deliberately keeps
 * percentiles in a fixed ring buffer: no array growth or per-frame
 * allocations, and no reactive state for 60 Hz data.
 */
export interface RenderSnapshot {
  p50Ms: number;
  p95Ms: number;
}

export class RenderMonitor {
  private readonly samples: Float32Array;
  private cursor = 0;
  private count = 0;

  constructor(capacity = 120) {
    this.samples = new Float32Array(Math.max(8, capacity));
  }

  push(frameMs: number): void {
    if (!Number.isFinite(frameMs) || frameMs <= 0) {
      return;
    }
    this.samples[this.cursor] = frameMs;
    this.cursor = (this.cursor + 1) % this.samples.length;
    this.count = Math.min(this.count + 1, this.samples.length);
  }

  snapshot(): RenderSnapshot {
    if (this.count === 0) {
      return { p50Ms: 0, p95Ms: 0 };
    }
    const values = Array.from(this.samples.subarray(0, this.count));
    values.sort((a, b) => a - b);
    return {
      p50Ms: values[Math.min(values.length - 1, Math.floor(values.length * 0.5))],
      p95Ms: values[Math.min(values.length - 1, Math.floor(values.length * 0.95))]
    };
  }
}
