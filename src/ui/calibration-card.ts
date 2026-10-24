import * as THREE from 'three';
import { SpatialAnchor } from '../core/spatial/anchor';
import type { HeadPose } from '../core/xr/types';
import type { SpatialTheme } from '../core/spatial/theme';
import { SpatialSurface } from './spatial/surface';

/**
 * The one moment before a session: the heading the patient is holding becomes
 * the world's "up".
 *
 * Recording is started by the operator (tablet) or the patient (headset
 * button); the bar fills only for the short stable window that follows, so a
 * patient being positioned never has a heading baked in unannounced.
 */
export interface CalibrationCardOptions {
  scene: THREE.Scene;
  theme: SpatialTheme;
}

export interface CalibrationCardApi {
  show(): void;
  hide(): void;
  update(dt: number, now: number, head: HeadPose | null): void;
  /** 0..1 while the stable window runs; null hides the bar. */
  setProgress(progress: number | null): void;
  /** One line under the body: waiting / retry. */
  setHint(text: string): void;
  dispose(): void;
}

export function createCalibrationCard(options: CalibrationCardOptions): CalibrationCardApi {
  const anchor = new SpatialAnchor({
    mode: 'head-locked',
    distance: 0.8,
    dampingSeconds: 0
  });
  const surface = new SpatialSurface({
    width: 0.72,
    height: 0.34,
    theme: options.theme,
    title: '记录起始朝向',
    body: '保持现在的姿势，看向前方。\n将以您面向的方向生成场景。\n按头显右侧按钮开始记录。',
    renderOrder: 1400
  });
  anchor.object.add(surface.object);

  // Progress bar: the old calibration told the patient how long was left, and
  // without it "a few seconds" reads as "nothing is happening".
  const barWidth = 0.6;
  const barHeight = 0.016;
  const barGeometry = new THREE.PlaneGeometry(barWidth, barHeight);
  const barTrackMaterial = new THREE.MeshBasicMaterial({
    color: new THREE.Color(options.theme.border),
    transparent: true,
    opacity: 0.55,
    depthTest: false,
    depthWrite: false,
    toneMapped: false
  });
  const barFillMaterial = new THREE.MeshBasicMaterial({
    color: new THREE.Color(options.theme.success),
    transparent: true,
    depthTest: false,
    depthWrite: false,
    toneMapped: false
  });
  const barTrack = new THREE.Mesh(barGeometry, barTrackMaterial);
  barTrack.position.set(0, -0.135, 0.004);
  barTrack.renderOrder = 1405;
  anchor.object.add(barTrack);
  const barFill = new THREE.Mesh(barGeometry, barFillMaterial);
  barFill.position.set(-barWidth / 2, -0.135, 0.005);
  barFill.scale.x = 0.001;
  barFill.renderOrder = 1406;
  anchor.object.add(barFill);

  anchor.setVisible(false);
  options.scene.add(anchor.object);

  let visible = false;
  barTrack.visible = false;
  barFill.visible = false;

  function setBar(progress: number | null): void {
    if (progress === null) {
      barTrack.visible = false;
      barFill.visible = false;
      return;
    }
    barTrack.visible = true;
    barFill.visible = true;
    const p = Math.max(0, Math.min(1, progress));
    barFill.scale.x = Math.max(0.001, p);
    barFill.position.x = -barWidth / 2 + (barWidth * p) / 2;
  }

  return {
    show(): void {
      visible = true;
      setBar(null);
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
    setProgress(progress: number | null): void {
      setBar(progress);
    },
    setHint(text: string): void {
      surface.setBody(
        text
          ? `请保持仰卧，平视前方。\n按下头显右侧的按钮开始记录。\n${text}`
          : '保持现在的姿势，看向前方。\n将以您面向的方向生成场景。\n按头显右侧按钮开始记录。'
      );
    },
    dispose(): void {
      options.scene.remove(anchor.object);
      anchor.object.remove(surface.object);
      surface.dispose();
      anchor.object.remove(barTrack);
      anchor.object.remove(barFill);
      barGeometry.dispose();
      barTrackMaterial.dispose();
      barFillMaterial.dispose();
      anchor.dispose();
    }
  };
}
