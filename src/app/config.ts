import { normalizeSceneId, type SceneId } from '../ui/scene-select';

export interface AppConfig {
  highQuality: boolean;
  aa: boolean;
  skipCalibration: boolean;
  showPerf: boolean;
  lang: 'zh' | 'en';
  initialScene: SceneId | null;
  minimal: boolean;
  spin: boolean;
}

export function readConfig(search: string): AppConfig {
  const params = new URLSearchParams(search);
  const quality = params.get('quality');
  const lang = params.get('lang') === 'en' ? 'en' : 'zh';
  const scene = params.get('scene');
  const fromPortal = params.get('from') === 'portal';
  return {
    highQuality: quality !== 'low',
    aa: quality !== 'low' && params.get('aa') !== '0',
    skipCalibration: params.get('nocal') === '1',
    showPerf: params.get('hud') === '1' || params.get('debug') === '1',
    lang,
    initialScene: normalizeSceneId(scene),
    minimal: params.get('minimal') === '1' || fromPortal,
    spin: params.get('spin') === '1'
  };
}
