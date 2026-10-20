import type { SceneId } from '../ui/scene-select';

export interface AppConfig {
  highQuality: boolean;
  aa: boolean;
  skipCalibration: boolean;
  debug: boolean;
  lang: 'zh' | 'en';
  initialScene: SceneId | null;
  spin: boolean;
}

export function readConfig(search: string): AppConfig {
  const params = new URLSearchParams(search);
  const quality = params.get('quality');
  const lang = params.get('lang') === 'en' ? 'en' : 'zh';
  const scene = params.get('scene');
  return {
    highQuality: quality !== 'low',
    aa: quality !== 'low' && params.get('aa') !== '0',
    skipCalibration: params.get('nocal') === '1',
    debug: params.get('debug') === '1',
    lang,
    initialScene: scene === 'landscape' || scene === 'ward' ? scene : null,
    spin: params.get('spin') === '1'
  };
}
