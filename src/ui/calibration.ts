import * as THREE from 'three';
import type { HeadPose, PoseLike } from '../core/xr/types';
import type { ComfortApi } from '../core/xr/comfort';
import type { RemapResult } from '../core/xr/remap';
import { SpatialAnchor } from '../core/spatial/anchor';
import type { SpatialTheme } from '../core/spatial/theme';
import { SpatialSurface } from './spatial/surface';
import type { Strings } from './strings';

const TOLERANCE_DEG = 6;
const HOLD_MS = 1200;
const COUNTDOWN_MS = 2000;

export interface CalibrationOptions {
  scene: THREE.Scene;
  comfort: ComfortApi;
  strings: Strings;
  theme: SpatialTheme;
  onResult: (result: RemapResult) => void;
}

function toPoseLike(head: HeadPose): PoseLike {
  const p = head.position;
  const q = head.quaternion;
  return {
    transform: {
      position: { x: p.x, y: p.y, z: p.z },
      orientation: { x: q.x, y: q.y, z: q.z, w: q.w }
    }
  };
}

/**
 * One-step comfort calibration.
 *
 * 3DoF headsets have no usable translation, so a two-pose (ceiling + toes)
 * basis is both unreachable and ill-conditioned. Instead capture the current
 * comfortable forward orientation and make that the neutral world frame:
 * the patient looks straight ahead, holds still, and the scene becomes
 * upright relative to the posture they will actually stay in.
 *
 * The card is head-locked at 0.8 m; the stability gate uses the same pose.
 */
export class Calibration {
  private readonly options: CalibrationOptions;
  private readonly anchor: SpatialAnchor;
  private readonly surface: SpatialSurface;
  private readonly barBackground: THREE.Mesh;
  private readonly barFill: THREE.Mesh;
  private readonly barGeometry: THREE.PlaneGeometry;
  private readonly barBackgroundMaterial: THREE.MeshBasicMaterial;
  private readonly barFillMaterial: THREE.MeshBasicMaterial;

  private active = false;
  private stableMs = 0;
  private countdownStart = 0;
  private readonly forward = new THREE.Vector3();
  private filtered: THREE.Vector3 | null = null;

  constructor(options: CalibrationOptions) {
    this.options = options;
    this.anchor = new SpatialAnchor({
      mode: 'head-locked',
      distance: 0.8,
      dampingSeconds: 0
    });
    this.surface = new SpatialSurface({
      width: 0.72,
      height: 0.46,
      theme: options.theme,
      title: options.strings.calibrationForward,
      body: options.strings.calibrationHold,
      renderOrder: 1200
    });
    this.anchor.object.add(this.surface.object);
    this.anchor.setVisible(false);
    options.scene.add(this.anchor.object);

    this.barGeometry = new THREE.PlaneGeometry(0.56, 0.014);
    this.barBackgroundMaterial = new THREE.MeshBasicMaterial({
      color: new THREE.Color(options.theme.border),
      transparent: true,
      opacity: 0.7,
      depthTest: false,
      depthWrite: false,
      toneMapped: false
    });
    this.barFillMaterial = new THREE.MeshBasicMaterial({
      color: new THREE.Color(options.theme.success),
      transparent: true,
      depthTest: false,
      depthWrite: false,
      toneMapped: false
    });
    this.barBackground = new THREE.Mesh(this.barGeometry, this.barBackgroundMaterial);
    this.barBackground.position.set(0, -0.205, 0.014);
    this.barBackground.renderOrder = 1205;
    this.barFill = new THREE.Mesh(this.barGeometry, this.barFillMaterial);
    this.barFill.position.set(-0.28, -0.205, 0.015);
    this.barFill.scale.x = 0.001;
    this.barFill.renderOrder = 1206;
    this.anchor.object.add(this.barBackground);
    this.anchor.object.add(this.barFill);
  }

  start(): void {
    this.active = true;
    this.stableMs = 0;
    this.countdownStart = 0;
    this.filtered = null;
    this.anchor.setVisible(true);
    this.surface.setTitle(this.options.strings.calibrationForward);
    this.surface.setBody(this.options.strings.calibrationHold);
    this.setProgress(0);
  }

  stop(): void {
    this.active = false;
    this.anchor.setVisible(false);
    this.resetStability();
  }

  isActive(): boolean {
    return this.active;
  }

  update(dt: number, now: number, head: HeadPose | null): void {
    if (!this.active) {
      return;
    }
    if (!head) {
      this.surface.setBody(this.options.strings.waitingHead);
      return;
    }

    this.anchor.update(head, dt, now);

    this.forward.set(0, 0, -1).applyQuaternion(head.quaternion);
    if (!this.filtered) {
      this.filtered = this.forward.clone();
    } else {
      const alpha = 1 - Math.exp(-dt / 0.18);
      this.filtered.lerp(this.forward, alpha).normalize();
    }
    const deviation = (this.forward.angleTo(this.filtered) * 180) / Math.PI;

    if (deviation <= TOLERANCE_DEG) {
      this.stableMs += dt * 1000;
    } else {
      this.stableMs = deviation > TOLERANCE_DEG * 1.4
        ? 0
        : Math.max(0, this.stableMs - dt * 1000 * 1.5);
      this.countdownStart = 0;
    }

    if (this.stableMs >= HOLD_MS && this.countdownStart === 0) {
      this.countdownStart = now;
    }

    let progress = 0;
    let status = this.options.strings.calibrationHold;
    if (this.countdownStart > 0) {
      progress = Math.min((now - this.countdownStart) / COUNTDOWN_MS, 1);
      const left = Math.max(0, Math.ceil((COUNTDOWN_MS - (now - this.countdownStart)) / 1000));
      status = `${this.options.strings.calibrationRecording} ${left}s`;
    } else if (this.stableMs > 0) {
      progress = Math.min(this.stableMs / HOLD_MS, 1);
      status = this.options.strings.calibrationStable;
    }

    this.surface.setBody(status);
    this.setProgress(progress);

    if (this.countdownStart > 0 && now - this.countdownStart >= COUNTDOWN_MS) {
      this.capture(toPoseLike(head));
    }
  }

  private setProgress(progress: number): void {
    const clamped = Math.max(0, Math.min(1, progress));
    this.barFill.scale.x = Math.max(0.001, clamped);
    this.barFill.position.x = -0.28 + (0.56 * clamped) / 2;
  }

  private resetStability(): void {
    this.filtered = null;
    this.stableMs = 0;
    this.countdownStart = 0;
  }

  private capture(pose: PoseLike): void {
    const ok = this.options.comfort.calibrate(pose);
    this.active = false;
    this.anchor.setVisible(false);
    this.resetStability();
    this.options.onResult(
      ok ? { ok: true, confidence: 1 } : { ok: false, reason: 'invalid-pose', confidence: 0 }
    );
  }

  dispose(): void {
    this.options.scene.remove(this.anchor.object);
    this.anchor.object.remove(this.surface.object);
    this.surface.dispose();
    this.anchor.object.remove(this.barBackground);
    this.anchor.object.remove(this.barFill);
    this.barGeometry.dispose();
    this.barBackgroundMaterial.dispose();
    this.barFillMaterial.dispose();
    this.anchor.dispose();
  }
}
