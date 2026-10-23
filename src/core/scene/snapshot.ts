import * as THREE from 'three';
import type { PosturePhase, PostureState } from '../xr/comfort';
import { POSTURE_LIMITS } from '../xr/comfort';
import type { SitUpPath } from '../xr/situp-path';
import { measureRelativeEuler, type EulerDeg } from '../xr/measure';
import type { ViewAnimState, ViewPresetCode } from '../xr/view-motion';

/**
 * One collected view of the patient world, filled in place every time the
 * telemetry upload, the HUD or a command handler needs the facts.
 *
 * Angles are **measured from the transforms that were applied**: the reported
 * world tilt is the base layer's rotation relative to the frame the posture or
 * sit-up started from. Nothing here re-derives an angle from progress, so a
 * sign error has exactly one place to live.
 *
 * Progress, phase and rise are business facts, not angles, and still come from
 * their drivers. The snapshot allocates nothing (`capture` writes into `this`);
 * the input object is reused by the app so a per-frame call would still be free.
 */
export interface SceneSnapshotInput {
  sceneId: string;
  loaded: boolean;
  session: boolean;
  calibrating: boolean;
  calibrated: boolean;
  postureMode: boolean;
  audioMuted: boolean;
  eyeHeight: number;
  /** Applied world rotation (shell x base), Euler XYZ degrees. */
  worldYawDeg: number;
  worldPitchDeg: number;
  worldRollDeg: number;
  confidence: number;
  /** Sit-up performance driving the world, or null when comfort owns it. */
  sitUp: SitUpPath | null;
  sitUpT: number;
  sitUpTarget: number;
  sitUpMoving: boolean;
  /**
   * Comfort posture, or null when no comfort layer is bound. Only phase, rise
   * and progress are read: the angles come from the base transform.
   */
  posture: PostureState | null;
  /** Base layer as applied this frame (`shell.base.quaternion`). */
  baseQuaternion: THREE.Quaternion;
  /** Frame the posture / sit-up started from. */
  baseReferenceQuaternion: THREE.Quaternion;
  lookYawDeg: number;
  lookYawTargetDeg: number;
  upGazeDeg: number;
  upGazeTargetDeg: number;
  viewAnim: ViewAnimState;
  /** Active preset id, or `none` for idle / slider-driven. */
  viewPreset: ViewPresetCode;
  floorOffset: number;
  cueFlow: number;
  cueEnabled: boolean;
  cueIntensity: number;
  /** Buoyancy actually applied, so the tablet never has to guess. */
  floatLevel: number;
  floatProfile: string;
}

export class SceneSnapshot {
  sceneId = '';
  loaded = false;
  session = false;
  calibrating = false;
  calibrated = false;
  audioMuted = false;
  eyeHeight = 0;
  /** Total world rotation as applied to scene content, Euler XYZ degrees. */
  appliedWorldYawDeg = 0;
  appliedWorldPitchDeg = 0;
  appliedWorldRollDeg = 0;
  sitUpActive = false;
  postureMode = false;
  sitUpT = 0;
  sitUpMoving = false;
  posturePhase: PosturePhase = 'neutral';
  /** Measured world tilt of the base, relative to the motion's start frame. */
  worldPitchDeg = 0;
  worldRollDeg = 0;
  postureRiseM = 0;
  postureProgress = 0;
  lookYawDeg = 0;
  lookYawTargetDeg = 0;
  upGazeDeg = 0;
  upGazeTargetDeg = 0;
  viewAnim: ViewAnimState = 'idle';
  viewPreset: ViewPresetCode = 'none';
  floorOffset = 0;
  cueFlow = 0;
  cueEnabled = false;
  cueIntensity = 0;
  floatLevel = 1;
  floatProfile = 'b';
  calibrationConfidence = 0;

  private readonly euler: EulerDeg = { yawDeg: 0, pitchDeg: 0, rollDeg: 0 };

  capture(input: SceneSnapshotInput): this {
    this.sceneId = input.sceneId;
    this.loaded = input.loaded;
    this.session = input.session;
    this.calibrating = input.calibrating;
    this.calibrated = input.calibrated;
    this.postureMode = input.postureMode;
    this.audioMuted = input.audioMuted;
    this.eyeHeight = input.eyeHeight;
    this.appliedWorldYawDeg = input.worldYawDeg;
    this.appliedWorldPitchDeg = input.worldPitchDeg;
    this.appliedWorldRollDeg = input.worldRollDeg;
    this.lookYawDeg = input.lookYawDeg;
    this.lookYawTargetDeg = input.lookYawTargetDeg;
    this.upGazeDeg = input.upGazeDeg;
    this.upGazeTargetDeg = input.upGazeTargetDeg;
    this.viewAnim = input.viewAnim;
    this.viewPreset = input.viewPreset;
    this.floorOffset = input.floorOffset;
    this.cueFlow = input.cueFlow;
    this.cueEnabled = input.cueEnabled;
    this.cueIntensity = input.cueIntensity;
    this.floatLevel = input.floatLevel;
    this.floatProfile = input.floatProfile;
    this.calibrationConfidence = input.confidence;

    const measured = measureRelativeEuler(
      input.baseQuaternion,
      input.baseReferenceQuaternion,
      this.euler
    );
    this.worldPitchDeg = measured.pitchDeg;
    this.worldRollDeg = measured.rollDeg;

    const sitUp = input.sitUp;
    if (sitUp) {
      const t = clamp01(input.sitUpT);
      this.sitUpActive = true;
      this.sitUpT = t;
      this.sitUpMoving = input.sitUpMoving;
      this.posturePhase = sitUpPhase(input.sitUpMoving, input.sitUpTarget, t);
      this.postureRiseM = Math.min(POSTURE_LIMITS.maxRiseM, sitUp.riseAt(t));
      this.postureProgress = t;
    } else {
      this.sitUpActive = false;
      this.sitUpT = 0;
      this.sitUpMoving = false;
      this.posturePhase = input.posture?.phase ?? 'neutral';
      this.postureRiseM = input.posture?.riseM ?? 0;
      this.postureProgress = input.posture?.progress ?? 0;
    }
    return this;
  }
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/** Sit-up phase from intent + progress; the unit has no PostureState. */
function sitUpPhase(moving: boolean, target: number, t: number): PosturePhase {
  if (moving) {
    return target > t ? 'rising' : 'lowering';
  }
  if (t <= 0) {
    return 'neutral';
  }
  return 'standing';
}
