const SHOW_PERF_KEY = 'quietshore.debug.showPerf';

export function readStoredShowPerf(): boolean {
  try {
    return window.localStorage.getItem(SHOW_PERF_KEY) === '1';
  } catch {
    return false;
  }
}

export function storeShowPerf(enabled: boolean): void {
  try {
    window.localStorage.setItem(SHOW_PERF_KEY, enabled ? '1' : '0');
  } catch {
    // Storage can be unavailable in private/embedded contexts.
  }
}
