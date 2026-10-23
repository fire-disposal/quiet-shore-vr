import * as THREE from 'three';
import { SpatialAnchor } from '../core/spatial/anchor';
import type { HeadPose } from '../core/xr/types';
import type { SpatialTheme } from '../core/spatial/theme';
import { SpatialSurface } from './spatial/surface';

/**
 * The one moment before a session: the heading the patient is holding becomes
 * the world's "up".
 *
 * Deliberately not a countdown or a stability gate — those failed whenever a
 * patient shifted. The card states what will happen, records on the confirm key,
 * and as a fallback records by itself after [autoRecordMs] so a patient who does
 * nothing still gets a calibrated scene instead of a tilted one.
 */
export interface CalibrationCardOptions {
  scene: THREE.Scene;
  theme: SpatialTheme;
  autoRecordMs: number;
  onRecord: () => void;
}

export interface CalibrationCardApi {
  show(): void;
  hide(): void;
  update(dt: number, now: number, head: HeadPose | null): void;
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
    body: '请用最舒适的姿势平视前方。\n系统会把你现在的朝向当作起始参考，几秒后自动记录；也可以按右侧确认键立即记录。',
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
  let shownAt = 0;
  let recorded = false;

  return {
    show(): void {
      visible = true;
      shownAt = 0;
      recorded = false;
      anchor.setVisible(true);
    },
    hide(): void {
      visible = false;
      anchor.setVisible(false);
    },
    update(dt: number, now: number, head: HeadPose | null): void {
      if (!visible || !head || recorded) {
        return;
      }
      anchor.update(head, dt, now);
      if (shownAt === 0) {
        shownAt = now;
        return;
      }
      const progress = Math.min(1, (now - shownAt) / options.autoRecordMs);
      barFill.scale.x = Math.max(0.001, progress);
      barFill.position.x = -barWidth / 2 + (barWidth * progress) / 2;
      if (progress >= 1) {
        recorded = true;
        options.onRecord();
      }
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
