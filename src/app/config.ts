interface Bootstrap {
  skipCalibration?: boolean;
  showHud?: boolean;
  eyeHeight?: number | string | null;
}

declare global {
  interface Window {
    /** Injected by the headset service before the bundle runs. */
    __QS_BOOTSTRAP__?: Bootstrap;
  }
}

export const EYE_HEIGHT_DEFAULT = 1.7;
export const EYE_HEIGHT_MIN = 1.2;
export const EYE_HEIGHT_MAX = 1.9;

function readEyeHeight(value: unknown): number {
  const numeric = typeof value === 'number'
    ? value
    : typeof value === 'string' && value.trim() !== ''
      ? Number(value)
      : Number.NaN;
  if (!Number.isFinite(numeric)) {
    return EYE_HEIGHT_DEFAULT;
  }
  return Math.min(EYE_HEIGHT_MAX, Math.max(EYE_HEIGHT_MIN, numeric));
}

/**
 * Launch parameters. Deliberately tiny: one device, one scene, one renderer
 * profile. What is left is the comfort eye height, the language and two debug
 * switches. Quality and scene selection are not parameters anymore.
 */
export interface AppConfig {
  skipCalibration: boolean;
  showPerf: boolean;
  eyeHeight: number;
  lang: 'zh' | 'en';
  /** Buoyancy profile from `?float=a|b|c`; the in-room choice overrides it. */
  floatProfile: string | null;
}

export function readConfig(search: string): AppConfig {
  const params = new URLSearchParams(search);
  const bootstrap: Bootstrap = window.__QS_BOOTSTRAP__ ?? {};
  const lang = params.get('lang') === 'en' ? 'en' : 'zh';
  return {
    skipCalibration: bootstrap.skipCalibration ?? params.get('nocal') === '1',
    showPerf: bootstrap.showHud ?? (params.get('hud') === '1' || params.get('debug') === '1'),
    eyeHeight: readEyeHeight(bootstrap.eyeHeight),
    lang,
    floatProfile: params.get('float')
  };
}
