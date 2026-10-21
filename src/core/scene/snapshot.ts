import type { PosturePhase, PostureState } from '../xr/comfort';
import { POSTURE_LIMITS } from '../xr/comfort';
import type { SitUpPath } from '../xr/situp-path';
import type { ViewAnimState, ViewPresetCode } from '../xr/view-motion';

/**
 * One collected view of the patient world, filled in place every time the
 * telemetry upload, the HUD or a command handler needs the facts. Callers
 * never re-derive posture numbers: the sit-up performance and the comfort
 * posture are merged here so both report the same shape.
 *
 * The snapshot itself allocates nothing (`capture` writes into `this`); the
 * input object is reused by the app so a per-frame call would still be free.
 */
export interface SceneSnapshotInput {
  sceneId: string;
  loaded: boolean;
  session: boolean;
  calibrating: boolean;
  calibrated: boolean;
  audioMuted: boolean;
  eyeHeight: number;
  confidence: number;
  /** Sit-up performance driving the world, or null when comfort owns it. */
  sitUp: SitUpPath | null;
  sitUpT: number;
  sitUpTarget: number;
  sitUpMoving: boolean;
  /** Comfort posture, or null when no comfort layer is bound. */
  posture: PostureState | null;
  viewPitchDeg: number;
  viewPitchTargetDeg: number;
  viewAnim: ViewAnimState;
  /** Active preset id, or `none` for idle / slider-driven. */
  viewPreset: ViewPresetCode;
  floorOffset: number;
  cueFlow: number;
  cueEnabled: boolean;
  cueIntensity: number;
}

export class SceneSnapshot {
  sceneId = '';
  loaded = false;
  session = false;
  calibrating = false;
  calibrated = false;
  audioMuted = false;
  eyeHeight = 0;
  sitUpActive = false;
  sitUpT = 0;
  sitUpMoving = false;
  posturePhase: PosturePhase = 'neutral';
  posturePitchDeg = 0;
  postureRollDeg = 0;
  postureRiseM = 0;
  postureProgress = 0;
  viewPitchDeg = 0;
  viewPitchTargetDeg = 0;
  viewAnim: ViewAnimState = 'idle';
  viewPreset: ViewPresetCode = 'none';
  floorOffset = 0;
  cueFlow = 0;
  cueEnabled = false;
  cueIntensity = 0;
  calibrationConfidence = 0;

  capture(input: SceneSnapshotInput): this {
    this.sceneId = input.sceneId;
    this.loaded = input.loaded;
    this.session = input.session;
    this.calibrating = input.calibrating;
    this.calibrated = input.calibrated;
    this.audioMuted = input.audioMuted;
    this.eyeHeight = input.eyeHeight;
    this.viewPitchDeg = input.viewPitchDeg;
    this.viewPitchTargetDeg = input.viewPitchTargetDeg;
    this.viewAnim = input.viewAnim;
    this.viewPreset = input.viewPreset;
    this.floorOffset = input.floorOffset;
    this.cueFlow = input.cueFlow;
    this.cueEnabled = input.cueEnabled;
    this.cueIntensity = input.cueIntensity;
    this.calibrationConfidence = input.confidence;

    const sitUp = input.sitUp;
    const posture = input.posture;
    if (sitUp) {
      const t = clamp01(input.sitUpT);
      this.sitUpActive = true;
      this.sitUpT = t;
      this.sitUpMoving = input.sitUpMoving;
      this.posturePhase = sitUpPhase(input.sitUpMoving, input.sitUpTarget, t);
      // Matches the previous App/telemetry derivation: the camera pitches from
      // looking at the ceiling to looking at the front wall over the rotation
      // portion of the timeline.
      this.posturePitchDeg = -90 * Math.min(1, t / sitUp.rotationPortion);
      this.postureRollDeg = 0;
      this.postureRiseM = Math.min(POSTURE_LIMITS.maxRiseM, sitUp.riseAt(t));
      this.postureProgress = t;
    } else {
      this.sitUpActive = false;
      this.sitUpT = 0;
      this.sitUpMoving = false;
      this.posturePhase = posture?.phase ?? 'neutral';
      this.posturePitchDeg = posture?.pitchDeg ?? 0;
      this.postureRollDeg = posture?.rollDeg ?? 0;
      this.postureRiseM = posture?.riseM ?? 0;
      this.postureProgress = posture?.progress ?? 0;
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
