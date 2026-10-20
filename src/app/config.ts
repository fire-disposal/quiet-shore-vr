import { normalizeSceneId, type SceneId } from '../ui/scene-select';

interface Bootstrap {
  scene?: string | null;
  skipCalibration?: boolean;
  quality?: string | null;
  showHud?: boolean;
}

export interface AppConfig {
  highQuality: boolean;
  aa: boolean;
  skipCalibration: boolean;
  showPerf: boolean;
  lang: 'zh' | 'en';
  initialScene: SceneId | null;
  spin: boolean;
}

export function readConfig(search: string): AppConfig {
  const params = new URLSearchParams(search);
  const injected = (window as unknown as { __QS_BOOTSTRAP__?: Bootstrap }).__QS_BOOTSTRAP__;
  const bootstrap: Bootstrap = injected ?? {};
  const quality = bootstrap.quality ?? params.get('quality');
  const lang = params.get('lang') === 'en' ? 'en' : 'zh';
  const scene = bootstrap.scene ?? params.get('scene');
  return {
    highQuality: quality !== 'low',
    aa: quality !== 'low' && params.get('aa') !== '0',
    skipCalibration: bootstrap.skipCalibration ?? params.get('nocal') === '1',
    showPerf: bootstrap.showHud ?? (params.get('hud') === '1' || params.get('debug') === '1'),
    lang,
    initialScene: normalizeSceneId(scene),
    spin: params.get('spin') === '1'
  };
}
