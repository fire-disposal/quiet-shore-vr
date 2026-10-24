import * as THREE from 'three';
import { SpatialAnchor } from '../core/spatial/anchor';
import type { HeadPose } from '../core/xr/types';
import type { SpatialTheme } from '../core/spatial/theme';
import { SpatialSurface } from './spatial/surface';

/**
 * The calibration step, as app chrome.
 *
 * It is a head-locked overlay — an opaque cover plus one card — and it knows
 * nothing about the mounted scene: no background swap, no visibility toggles,
 * no scene-specific copy. That is what makes it general (any scene), visible
 * (it covers the frame) and fail-safe (hiding it cannot leave the scene in a
 * half-mutated state).
 *
 * Recording is manual: the bar appears only after a trigger and fills for the
 * short stable window that follows.
 */
export interface CalibrationOverlayOptions {
  scene: THREE.Scene;
  theme: SpatialTheme;
}

export interface CalibrationOverlayApi {
  show(): void;
  hide(): void;
  isVisible(): boolean;
  update(dt: number, now: number, head: HeadPose | null): void;
  /** 0..1 while the stable window runs; null hides the bar. */
  setProgress(progress: number | null): void;
  /** Extra line under the body: waiting / retry. */
  setHint(text: string): void;
  dispose(): void;
}

const PANEL_WIDTH = 0.84;
const PANEL_HEIGHT = 0.54;
const BODY =
  '保持现在的姿势，看向前方。\n将以您面向的方向生成场景。\n按头显右侧按钮开始记录。';

export function createCalibrationOverlay(
  options: CalibrationOverlayOptions
): CalibrationOverlayApi {
  const anchor = new SpatialAnchor({
    mode: 'head-locked',
    distance: 0.85,
    dampingSeconds: 0
  });

  const surface = new SpatialSurface({
    width: PANEL_WIDTH,
    height: PANEL_HEIGHT,
    theme: options.theme,
    title: '记录起始朝向',
    body: BODY,
    renderOrder: 1400
  });
  anchor.object.add(surface.object);

  // Opaque cover, closer than the card, in the same head-locked frame. It
  // hides whatever scene is mounted without the app touching scene state.
  const cloakGeometry = new THREE.PlaneGeometry(1.7, 1.1);
  const cloakMaterial = new THREE.MeshBasicMaterial({
    // Near-black, not the panel colour: the card has to read as a card.
    color: new THREE.Color(0x0b0d0f),
    transparent: false,
    depthTest: false,
    depthWrite: false,
    toneMapped: false
  });
  const cloak = new THREE.Mesh(cloakGeometry, cloakMaterial);
  cloak.position.set(0, 0, 0.4);
  cloak.renderOrder = 1200;
  anchor.object.add(cloak);

  const barWidth = PANEL_WIDTH * 0.78;
  const barHeight = 0.018;
  const barGeometry = new THREE.PlaneGeometry(barWidth, barHeight);
  const barTrackMaterial = new THREE.MeshBasicMaterial({
    color: new THREE.Color(options.theme.border),
    transparent: true,
    opacity: 0.6,
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
  const barY = -PANEL_HEIGHT / 2 + 0.05;
  const barTrack = new THREE.Mesh(barGeometry, barTrackMaterial);
  barTrack.position.set(0, barY, 0.006);
  barTrack.renderOrder = 1405;
  anchor.object.add(barTrack);
  const barFill = new THREE.Mesh(barGeometry, barFillMaterial);
  barFill.position.set(-barWidth / 2, barY, 0.007);
  barFill.scale.x = 0.001;
  barFill.renderOrder = 1406;
  anchor.object.add(barFill);

  let visible = false;
  let hint = '';

  function applyBody(): void {
    surface.setBody(hint ? `${BODY}\n${hint}` : BODY);
  }

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

  anchor.setVisible(false);
  options.scene.add(anchor.object);
  setBar(null);

  return {
    show(): void {
      visible = true;
      setBar(null);
      anchor.setVisible(true);
    },
    hide(): void {
      visible = false;
      setBar(null);
      anchor.setVisible(false);
    },
    isVisible: () => visible,
    update(dt: number, now: number, head: HeadPose | null): void {
      if (!visible || !head) {
        return;
      }
      anchor.update(head, dt, now);
    },
    setProgress: setBar,
    setHint(text: string): void {
      if (text === hint) {
        return;
      }
      hint = text;
      applyBody();
    },
    dispose(): void {
      options.scene.remove(anchor.object);
      anchor.object.remove(surface.object);
      surface.dispose();
      anchor.object.remove(cloak);
      cloakGeometry.dispose();
      cloakMaterial.dispose();
      anchor.object.remove(barTrack);
      anchor.object.remove(barFill);
      barGeometry.dispose();
      barTrackMaterial.dispose();
      barFillMaterial.dispose();
      anchor.dispose();
    }
  };
}
