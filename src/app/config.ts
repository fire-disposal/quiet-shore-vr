import { readStoredScale } from './quality-memory';

interface Bootstrap {
  scene?: string | null;
  skipCalibration?: boolean;
  quality?: string | null;
  showHud?: boolean;
  eyeHeight?: number | string | null;
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

export interface AppConfig {
  highQuality: boolean;
  aa: boolean;
  skipCalibration: boolean;
  showPerf: boolean;
  xrScale: number;
  eyeHeight: number;
  lang: 'zh' | 'en';
  /** Buoyancy profile from `?float=a|b|c`; the in-room choice overrides it. */
  floatProfile: string | null;
  /** Scene id from the launch bootstrap; falls back to the shipped scene. */
  initialScene: string | null;
}

export function readConfig(search: string): AppConfig {
  const params = new URLSearchParams(search);
  const injected = (window as unknown as { __QS_BOOTSTRAP__?: Bootstrap }).__QS_BOOTSTRAP__;
  const bootstrap: Bootstrap = injected ?? {};
  const quality = bootstrap.quality ?? params.get('quality');
  const lang = params.get('lang') === 'en' ? 'en' : 'zh';
  const scene = bootstrap.scene ?? params.get('scene');
  const scaleParam = params.get('scale');
  const requestedScale = scaleParam === null ? Number.NaN : Number(scaleParam);
  const explicitScale = Number.isFinite(requestedScale);
  // Presence beats sharpness on this headset: 2160x3840 at 1.0 keeps 72 Hz
  // reachable, and a dropped frame is far more noticeable than soft edges.
  const fallback = quality === 'low' ? 0.9 : 1.0;
  const stored = explicitScale ? null : readStoredScale();
  const xrScale = explicitScale
    ? Math.min(1.5, Math.max(0.6, requestedScale))
    : Math.min(fallback, stored ?? fallback);
  return {
    highQuality: quality !== 'low',
    // Visual-first default: keep XR AA and native scale. Performance profiles
    // are explicit A/B tools, not the default patient experience.
    aa: quality !== 'low' && params.get('aa') !== '0',
    xrScale,
    eyeHeight: readEyeHeight(bootstrap.eyeHeight),
    skipCalibration: bootstrap.skipCalibration ?? params.get('nocal') === '1',
    showPerf: bootstrap.showHud ?? (params.get('hud') === '1' || params.get('debug') === '1'),
    lang,
    floatProfile: params.get('float'),
    /** Scene the tablet picked; null means "whatever the registry ships". */
    initialScene: scene
  };
}
