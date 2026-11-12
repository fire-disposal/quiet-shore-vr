import type { ViewAnimState } from '../xr/view-motion';
import type { MotionCapabilities } from '../../app/motion-plan';
import { mix01, type Degrees, type Metres, type Mix01, type Quat, type Vec3 } from '../units';

/**
 * One collected view of the patient world, filled in place whenever the link,
 * the HUD or a command handler needs the facts.
 *
 * v13 rule: **nothing is measured back out of a transform.** The posture is the
 * `mix` scalar that poses it, the eye is the height that scalar produced, and
 * the world transform is the quaternion + translation actually written. Units
 * are branded (`Metres`, `Degrees`, `Mix01`) so a centimetre/degree slip is a
 * compile error at the boundary rather than a 100× offset in the panel.
 *
 * `capture` writes into `this`: one object, no allocation per frame.
 */
export interface SceneSnapshotInput {
  readonly sceneId: string;
  readonly loaded: boolean;
  readonly session: boolean;
  readonly calibrating: boolean;
  readonly calibrated: boolean;
  readonly audioMuted: boolean;
  /** Applied eye height: lying..standing, the same height the page renders. */
  readonly eyeHeight: Metres;
  /** Applied world rotation (shell × base). */
  readonly worldQuat: Quat;
  /** Applied world translation (shell × base), device frame. */
  readonly worldT: Vec3<Metres>;
  readonly confidence: number;
  /** The one posture scalar: 0 lying, 1 standing. */
  readonly correctionMix: number;
  readonly correctionTarget: number;
  readonly correctionMoving: boolean;
  readonly lookYawDeg: Degrees;
  readonly lookYawTargetDeg: Degrees;
  readonly upGazeDeg: Degrees;
  readonly upGazeTargetDeg: Degrees;
  readonly viewAnim: ViewAnimState;
  readonly floorOffset: Metres;
  readonly floatLevel: number;
  /** Applied buoyancy offset, millimetres (signed). */
  readonly floatMm: number;
  readonly sessionSec: number;
  readonly voiceId: number;
  readonly caps: MotionCapabilities;
}

export class SceneSnapshot {
  sceneId = '';
  loaded = false;
  session = false;
  calibrating = false;
  calibrated = false;
  audioMuted = false;
  eyeHeight: Metres = 0 as Metres;
  /** Applied world rotation; the mirror inverts exactly this. */
  readonly worldQuat: { x: number; y: number; z: number; w: number } = {
    x: 0,
    y: 0,
    z: 0,
    w: 1
  };
  /** Applied world translation, metres, device frame. */
  readonly worldT: { x: number; y: number; z: number } = { x: 0, y: 0, z: 0 };
  mix: Mix01 = 0 as Mix01;
  correctionTarget = 0;
  correctionMoving = false;
  lookYawDeg: Degrees = 0 as Degrees;
  lookYawTargetDeg: Degrees = 0 as Degrees;
  upGazeDeg: Degrees = 0 as Degrees;
  upGazeTargetDeg: Degrees = 0 as Degrees;
  viewAnim: ViewAnimState = 'idle';
  floorOffset: Metres = 0 as Metres;
  floatLevel = 1;
  floatMm = 0;
  sessionSec = 0;
  voiceId = -1;
  calibrationConfidence = 0;
  caps: MotionCapabilities = {
    rise: false,
    lie: false,
    stop: false,
    float: false,
    view: false,
    blocked: '未开始会话',
    floatMax: 3
  };

  capture(input: SceneSnapshotInput): this {
    this.sceneId = input.sceneId;
    this.loaded = input.loaded;
    this.session = input.session;
    this.calibrating = input.calibrating;
    this.calibrated = input.calibrated;
    this.audioMuted = input.audioMuted;
    this.eyeHeight = input.eyeHeight;
    this.worldQuat.x = input.worldQuat.x;
    this.worldQuat.y = input.worldQuat.y;
    this.worldQuat.z = input.worldQuat.z;
    this.worldQuat.w = input.worldQuat.w;
    this.worldT.x = input.worldT.x;
    this.worldT.y = input.worldT.y;
    this.worldT.z = input.worldT.z;
    this.mix = mix01(input.correctionMix);
    this.correctionTarget = mix01(input.correctionTarget);
    this.correctionMoving = input.correctionMoving;
    this.lookYawDeg = input.lookYawDeg;
    this.lookYawTargetDeg = input.lookYawTargetDeg;
    this.upGazeDeg = input.upGazeDeg;
    this.upGazeTargetDeg = input.upGazeTargetDeg;
    this.viewAnim = input.viewAnim;
    this.floorOffset = input.floorOffset;
    this.floatLevel = input.floatLevel;
    this.floatMm = input.floatMm;
    this.sessionSec = input.sessionSec;
    this.voiceId = input.voiceId;
    this.calibrationConfidence = input.confidence;
    this.caps = input.caps;
    return this;
  }
}
