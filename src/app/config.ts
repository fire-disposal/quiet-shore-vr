import { isAppId, type AppId } from './apps';

interface Bootstrap {
  scene?: string | null;
  app?: string | null;
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
  /** Scene id from the launch bootstrap; the operator picks it on the tablet. */
  initialScene: string | null;
  /** Product face the launch opens in; the tablet can switch it later. */
  initialApp: AppId;
  skipCalibration: boolean;
  showPerf: boolean;
  eyeHeight: number;
  lang: 'zh' | 'en';
  /**
   * How many times the shell has already relaunched this entry.
   *
   * `0` is the operator's own launch; anything else means the page sat on its
   * entry screen without a press long enough for the portal to hand it a fresh
   * window, so the page must tell the patient what to do differently.
   */
  entryRetry: number;
  /** Buoyancy profile from `?float=a|b|c`; the in-room choice overrides it. */
  /**
   * Buoyancy level 0..3 from `?level=N`.
   *
   * Defaults to the full envelope: the heave is the scene's main self-motion
   * cue, and at level 1 (25 mm) it read as "the world is completely still".
   */
  floatLevel: number;
}

function readFloatLevel(raw: string | null): number {
  const parsed = Number.parseInt(raw ?? '', 10);
  if (!Number.isFinite(parsed)) {
    return 3;
  }
  return Math.min(3, Math.max(0, parsed));
}

/** Relaunch count from the shell; anything unusable means the first launch. */
function readEntryRetry(raw: string | null): number {
  const parsed = Number.parseInt(raw ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(9, parsed) : 0;
}

export function readConfig(search: string): AppConfig {
  const params = new URLSearchParams(search);
  const bootstrap: Bootstrap = window.__QS_BOOTSTRAP__ ?? {};
  const lang = params.get('lang') === 'en' ? 'en' : 'zh';
  const app = bootstrap.app ?? params.get('app') ?? 'training';
  return {
    initialScene: bootstrap.scene ?? params.get('scene'),
    initialApp: isAppId(app) ? app : 'training',
    skipCalibration: bootstrap.skipCalibration ?? params.get('nocal') === '1',
    showPerf: bootstrap.showHud ?? (params.get('hud') === '1' || params.get('debug') === '1'),
    eyeHeight: readEyeHeight(bootstrap.eyeHeight),
    lang,
    entryRetry: readEntryRetry(params.get('retry')),
    floatLevel: readFloatLevel(params.get('level'))
  };
}
