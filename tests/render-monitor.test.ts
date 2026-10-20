import { describe, expect, it } from 'vitest';
import { RenderMonitor } from '../src/core/performance/render-monitor';

describe('RenderMonitor', () => {
  it('returns zero before samples exist', () => {
    expect(new RenderMonitor().snapshot()).toEqual({ p50Ms: 0, p95Ms: 0 });
  });

  it('reports p50 and p95 from the fixed ring buffer', () => {
    const monitor = new RenderMonitor(10);
    for (let i = 1; i <= 20; i += 1) {
      monitor.push(i);
    }
    const result = monitor.snapshot();
    expect(result.p50Ms).toBeGreaterThan(0);
    expect(result.p95Ms).toBeGreaterThanOrEqual(result.p50Ms);
    expect(result.p95Ms).toBeLessThanOrEqual(20);
  });

  it('ignores invalid frame times', () => {
    const monitor = new RenderMonitor(4);
    monitor.push(0);
    monitor.push(Number.NaN);
    monitor.push(-2);
    expect(monitor.snapshot()).toEqual({ p50Ms: 0, p95Ms: 0 });
  });
});
