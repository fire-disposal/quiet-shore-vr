import * as THREE from 'three';
import { SpatialAnchor } from '../core/spatial/anchor';
import type { HeadPose } from '../core/xr/types';
import type { SpatialTheme } from '../core/spatial/theme';
import { SpatialSurface } from './spatial/surface';

/**
 * The one card before a session: the heading the patient is holding becomes
 * the world's "up".
 *
 * Recording is operator-triggered — the tablet's calibrate button or the
 * headset button, whichever comes first — and the window itself is a short
 * stable sample (see `core/xr/calibration-sample.ts`). There is no countdown
 * and no silent auto-capture: a patient who is still being positioned must not
 * have a heading baked in behind the operator's back.
 */
export interface CalibrationCardOptions {
  scene: THREE.Scene;
  theme: SpatialTheme;
}

export interface CalibrationCardApi {
  show(): void;
  hide(): void;
  update(dt: number, now: number, head: HeadPose | null): void;
  /** One line under the body: waiting / recording / retry. */
  setHint(text: string): void;
  dispose(): void;
}

const BODY = '请保持仰卧，平视前方。\n按下头显右侧的按钮开始记录，或由操作员在平板上开始。';

export function createCalibrationCard(options: CalibrationCardOptions): CalibrationCardApi {
  const anchor = new SpatialAnchor({
    mode: 'head-locked',
    distance: 0.8,
    dampingSeconds: 0
  });
  const surface = new SpatialSurface({
    width: 0.72,
    height: 0.3,
    theme: options.theme,
    title: '记录起始朝向',
    body: BODY,
    renderOrder: 1400
  });
  anchor.object.add(surface.object);
  anchor.setVisible(false);
  options.scene.add(anchor.object);

  let visible = false;

  return {
    show(): void {
      visible = true;
      anchor.setVisible(true);
    },
    hide(): void {
      visible = false;
      anchor.setVisible(false);
    },
    update(dt: number, now: number, head: HeadPose | null): void {
      if (!visible || !head) {
        return;
      }
      anchor.update(head, dt, now);
    },
    setHint(text: string): void {
      surface.setBody(text ? `${BODY}\n${text}` : BODY);
    },
    dispose(): void {
      options.scene.remove(anchor.object);
      anchor.object.remove(surface.object);
      surface.dispose();
      anchor.dispose();
    }
  };
}
