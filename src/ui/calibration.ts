import * as THREE from 'three';
import type { HeadPose, PoseLike } from '../core/xr/types';
import type { ComfortApi, RemapResult } from '../core/xr/comfort';
import { SpatialAnchor } from '../core/spatial/anchor';
import type { SpatialTheme } from '../core/spatial/theme';
import { SpatialSurface } from './spatial/surface';
import type { Strings } from './strings';

const TOLERANCE_DEG = 6;
const CEILING_HOLD_MS = 1200;
const CEILING_COUNTDOWN_MS = 3000;
const TOES_HOLD_MS = 900;
const TOES_COUNTDOWN_MS = 2500;

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
 * Two-step head-direction calibration. The card is a head-locked spatial
 * surface at 0.8 m; the stability gate uses the same head pose. World
 * visibility/background are owned by the app.
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
  private step = 1;
  private stableMs = 0;
  private countdownStart = 0;
  private readonly forward = new THREE.Vector3();
  private filtered: THREE.Vector3 | null = null;
  private poseC: PoseLike | null = null;
  private poseT: PoseLike | null = null;
  private lastDeviation = 0;

  private get holdMs(): number {
    return this.step === 1 ? CEILING_HOLD_MS : TOES_HOLD_MS;
  }

  private get countdownMs(): number {
    return this.step === 1 ? CEILING_COUNTDOWN_MS : TOES_COUNTDOWN_MS;
  }

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
      title: options.strings.calibrationCeiling,
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
    this.step = 1;
    this.stableMs = 0;
    this.countdownStart = 0;
    this.filtered = null;
    this.poseC = null;
    this.poseT = null;
    this.lastDeviation = 0;
    this.anchor.setVisible(true);
    this.surface.setTitle(this.options.strings.calibrationCeiling);
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
    this.lastDeviation = deviation;

    if (deviation <= TOLERANCE_DEG) {
      this.stableMs += dt * 1000;
    } else {
      this.stableMs = deviation > TOLERANCE_DEG * 1.4
        ? 0
        : Math.max(0, this.stableMs - dt * 1000 * 1.5);
      this.countdownStart = 0;
    }

    if (this.stableMs >= this.holdMs && this.countdownStart === 0) {
      this.countdownStart = now;
    }

    let progress = 0;
    let status = this.options.strings.calibrationHold;
    if (this.countdownStart > 0) {
      progress = Math.min((now - this.countdownStart) / this.countdownMs, 1);
      const left = Math.max(0, Math.ceil((this.countdownMs - (now - this.countdownStart)) / 1000));
      status = `${this.options.strings.calibrationRecording} ${left}s`;
    } else if (this.stableMs > 0) {
      progress = Math.min(this.stableMs / this.holdMs, 1);
      status = this.options.strings.calibrationStable;
    }

    this.surface.setBody(status);
    this.setProgress(progress);

    if (this.countdownStart > 0 && now - this.countdownStart >= this.countdownMs) {
      this.captureStep(toPoseLike(head));
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

  private captureStep(pose: PoseLike): void {
    if (this.step === 1) {
      this.poseC = pose;
      this.step = 2;
      this.resetStability();
      this.surface.setTitle(this.options.strings.calibrationToes);
      this.surface.setBody(this.options.strings.calibrationHold);
      this.setProgress(0);
      return;
    }

    if (!this.poseC) {
      return;
    }
    this.poseT = pose;
    const result = this.options.comfort.calibrateTwo(this.poseC, this.poseT, { strength: 1 });
    this.active = false;
    this.anchor.setVisible(false);
    this.resetStability();
    this.options.onResult(result);
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
