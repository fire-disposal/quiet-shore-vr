import * as THREE from 'three';
import { smootherstep } from '../core/xr/drivers/curve';
import { createTrackState, stepTrack, type TrackLimits, type TrackState } from '../core/xr/drivers/track';
import type { ComfortApi } from '../core/xr/comfort';
import type { WorldShellApi } from '../core/xr/world-shell';
import type { PoseLike } from '../core/xr/types';

/**
 * Owner of the world's base pose and of the **pitch-correction ramp**.
 *
 * The session starts in the state a lying body actually sees: the ceiling is
 * the real ceiling, and the room only turns to the patient's heading (yaw).
 * The rise animation is no longer a scripted 90° tumble — it is a ramp of the
 * correction mix from 0 (uncorrected) to 1 (the patient's comfortable posture
 * faces the front wall); lying back ramps it the other way. `comfort` owns the
 * quaternion, this owns *how much* of it is applied and when.
 *
 * ```text
 * mix 0   q = qYaw                       ceiling overhead, room on the heading
 * mix 1   q = qYaw · qCorrection         facing the front wall, as if standing
 * ramp    mix eased with smootherstep over the operator's duration
 * ```
 */

export interface WorldRuntimeDeps {
  comfort(): ComfortApi | null;
  /** The frame's residual offset, owned by the buoyancy module. */
  setBaseOffset(y: number): void;
}

/** What telemetry, the HUD and the cue read back. */
export interface WorldRuntimeState {
  /** Correction applied, 0 = real ceiling, 1 = facing the wall. */
  mix: number;
  target: number;
  moving: boolean;
  /** A calibration exists; the ramp and the rise command need one. */
  ready: boolean;
  /** Ramp length the operator set, in milliseconds. */
  durationMs: number;
  /** Content Y the frame places the art at (the buoyancy delta adds to it). */
  offsetY: number;
  /** Applied eye height (lying..standing by mix); what the mirror places by. */
  eyeY: number;
}

/** Manual ramp (the operator's rise / lie-back), milliseconds. */
const DEFAULT_RAMP_MS = 10000;

/**
 * Slider tracking for the correction itself.
 *
 * The same follower the view channel uses (`VIEW_TRACK_TAU_S` in
 * `core/xr/view-motion`), deliberately: one follower, one feel under the hand.
 * The speed cap is the loose end of the operator's own band — 2.5 s from
 * ceiling to full correction — and the acceleration cap is what keeps the onset
 * from tugging the world. Units are fractions of full travel per second.
 */
const MIX_TRACK_TAU_S = 0.25;
const MIX_MAX_PER_S = 0.4;
const MIX_ACCEL_MAX_PER_S2 = 1.6;
const MIX_SNAP = 0.002;

/** One limit set for both tracks: the mix, and the end eye it drags along. */
const SLIDER_LIMITS: TrackLimits = {
  tauS: MIX_TRACK_TAU_S,
  maxDegPerS: MIX_MAX_PER_S,
  maxDegPerS2: MIX_ACCEL_MAX_PER_S2,
  snapDeg: MIX_SNAP
};


export interface WorldRuntimeApi {
  /**
   * A new scene: both eye heights come from its `posture` — the lying one is
   * derived by `core/anatomy.ts`, the standing one is the art's authoring
   * height. The placement follows from them and the current mix.
   *
   * `restMix` is the correction the scene's art was drawn for (see
   * `core/anatomy.restMixOf`): a supine scene rests uncorrected, a standing
   * scene rests corrected. Absent means 0, the historical behaviour.
   */
  setScene(eyes: { lyingEyeY: number; standingEyeY: number; restMix?: number }): void;
  /**
   * Adopt the orientation the patient is holding as the calibration frame, and
   * land on the scene's rest correction: the ceiling stays the real ceiling for
   * a supine scene, a standing room is already upright when it appears.
   */
  calibrate(
    orientation: { x: number; y: number; z: number; w: number },
    position: THREE.Vector3
  ): boolean;
  /** Drop the calibration and the mix; the world is unrotated again. */
  clearBase(): void;
  /** Advance the ramp (or the comfort posture) and re-apply the frame. */
  update(dt: number): void;
  /**
   * Freeze every world motion. The calibration card asks the patient to hold
   * still, so nothing may move the world underneath it.
   */
  hold(frozen: boolean): void;
  /** 1 = correct (face the wall), 0 = uncorrected (real ceiling). */
  rise(target: 0 | 1): boolean;
  /**
   * Operator slider target, 0–1. The first call freezes any timed ramp where it
   * stands (the manual override) and the applied mix then follows under a speed
   * and acceleration cap, so no drag can step the world.
   */
  setMixTarget(next: number): boolean;
  stopRise(): void;
  setDuration(ms: number): void;
  /** True while the correction ramp is moving; the cue and the cadence read this. */
  isRising(): boolean;
  /** Re-place the art from the current scene / eye height. */
  apply(): void;
  state(out?: WorldRuntimeState): WorldRuntimeState;
}

export function createWorldRuntime(deps: WorldRuntimeDeps): WorldRuntimeApi {
  const { comfort, setBaseOffset } = deps;

  /** Eye heights for the current scene; the lying one comes from anatomy. */
  let lyingEyeY = 0;
  /** The end eye the running (or last) ramp lands on. */
  let standingEyeY = 0;
  /** End eye where the running ramp started, and where it is now. */
  let standingFrom = 0;
  let standingNow = 0;
  /** A hot-set end eye, adopted when the next ramp begins. */
  /** True while the operator's slider owns `mix`; a key command takes it back. */
  let sliderDriven = false;
  let sliderTarget = 0;
  /** Where the slider has actually got to, and the end eye it drags along. */
  let mixTrack = createTrackState(0);
  let standingTrack = createTrackState(0);
  /** Correction the loaded scene's art was drawn for: 0 supine, 1 standing. */
  let restMix = 0;
  /** Applied eye height: the lying height with `mix` of the rise folded in. */
  let eyeY = 0;
  let offsetY = 0;

  /** Correction applied, and where it is heading. */
  let mix = 0;
  let target = 0;
  let from = 0;
  let elapsedMs = 0;
  let durationMs = DEFAULT_RAMP_MS;
  /** Length of the ramp currently running (auto ramp vs operator ramp). */
  let rampMs = DEFAULT_RAMP_MS;
  let moving = false;
  let ready = false;
  let held = false;

  /**
   * The eye rises with the correction. At mix 0 the patient's eye is where
   * their head really is (lying on the bed, or on the water); at mix 1 it is
   * where the art was authored from (standing). Content is lowered by that
   * height, so the art's eye line meets the patient's eye at every point of the
   * ramp — the rise is the same scalar as the rotation, not a second animation.
   * The buoyancy delta rides on top of the result.
   */
  function apply(): void {
    const t = Number.isFinite(mix) ? Math.min(1, Math.max(0, mix)) : 0;
    eyeY = lyingEyeY + (standingNow - lyingEyeY) * t;
    offsetY = Number.isFinite(eyeY) ? -eyeY : 0;
    setBaseOffset(offsetY);
  }

  function pushMix(next: number): void {
    mix = next;
    comfort()?.setCorrectionMix(mix);
    apply();
  }

  function calibrate(
    orientation: { x: number; y: number; z: number; w: number },
    position: THREE.Vector3
  ): boolean {
    const comfortApi = comfort();
    if (!comfortApi) {
      return false;
    }
    const pose: PoseLike = {
      transform: {
        position: { x: position.x, y: position.y, z: position.z },
        orientation: {
          x: orientation.x,
          y: orientation.y,
          z: orientation.z,
          w: orientation.w
        }
      }
    };
    if (!comfortApi.calibrate(pose)) {
      return false;
    }
    // Enter the session in the correction the art was drawn for and stay
    // there. The ramp is the operator's alone: an automatic 8 s rise fought the
    // 起身 / 停止 buttons (a stop pressed inside it froze a half-corrected
    // world) and made "起身" look dead because the world had already risen by
    // itself. A standing scene therefore *rests* at 1 instead of being ramped
    // there, so its first visible frame is already upright.
    pushMix(restMix);
    ready = true;
    apply();
    from = restMix;
    target = restMix;
    elapsedMs = 0;
    moving = false;
    sliderDriven = false;
    sliderTarget = restMix;
    mixTrack.value = restMix;
    mixTrack.velocity = 0;
    standingTrack.value = standingNow;
    standingTrack.velocity = 0;
    return true;
  }

  function clearBase(): void {
    // A stop during calibration must not leave the world frozen for the next
    // session: releasing the base releases the hold too.
    held = false;
    moving = false;
    sliderDriven = false;
    sliderTarget = 0;
    mixTrack.value = 0;
    mixTrack.velocity = 0;
    standingTrack.value = 0;
    standingTrack.velocity = 0;
    target = 0;
    from = 0;
    elapsedMs = 0;
    mix = 0;
    ready = false;
    comfort()?.reset();
    apply();
  }

  function update(dt: number): void {
    if (held) {
      return;
    }
    if (sliderDriven) {
      // The hand set a target; the world still moves on its own curve, capped
      // and acceleration-limited, so no drag can teleport a patient's view.
      standingNow = stepTrack(standingTrack, standingEyeY, dt, SLIDER_LIMITS);
      const next = stepTrack(mixTrack, sliderTarget, dt, SLIDER_LIMITS);
      if (next !== mix) {
        pushMix(next);
      }
      return;
    }
    if (moving) {
      elapsedMs += dt * 1000;
      const t = rampMs > 0 ? Math.min(1, elapsedMs / rampMs) : 1;
      const eased = smootherstep(t);
      // The end eye rides the same eased progress: a height set between ramps
      // arrives with the walk instead of as a step under the patient.
      standingNow = standingFrom + (standingEyeY - standingFrom) * eased;
      pushMix(from + (target - from) * eased);
      if (t >= 1) {
        standingNow = standingEyeY;
        pushMix(target);
        moving = false;
      }
      return;
    }
  }

  function rise(next: 0 | 1): boolean {
    if (!ready) {
      return false;
    }
    // "Already there" is about the *applied* mix and the direction of travel,
    // not the applied value alone: a ramp that has only just started still sits
    // on its starting end while heading away from it. Comparing `next` with
    // `mix` alone would read that as a no-op and leave the world moving the old
    // way, so a reversal issued at the endpoint must still restart the ramp.
    if (next === mix && !(moving && target !== next)) {
      return true;
    }
    from = mix;
    target = next;
    elapsedMs = 0;
    rampMs = durationMs;
    // A key command takes the correction back from the slider, starting from
    // what is applied, so the two inputs never write against each other.
    sliderDriven = false;
    standingFrom = standingNow;
    moving = true;
    return true;
  }

  /**
   * Operator slider: the target is wherever the hand is, and the applied mix
   * follows under the speed and acceleration caps above.
   *
   * The first call *is* the manual override — it stops any timed ramp where it
   * stands, exactly like `posture:stop`, and takes the correction back from it.
   */
  function setMixTarget(next: number): boolean {
    if (!ready || !Number.isFinite(next)) {
      return false;
    }
    if (!sliderDriven) {
      sliderDriven = true;
      moving = false;
      mixTrack.value = mix;
      mixTrack.velocity = 0;
      standingTrack.value = standingNow;
      standingTrack.velocity = 0;
    }
    sliderTarget = Math.min(1, Math.max(0, next));
    return true;
  }

  function stopRise(): void {
    if (sliderDriven) {
      // Freeze where the hand left it: the target becomes what is applied.
      sliderTarget = mix;
      mixTrack.value = mix;
      mixTrack.velocity = 0;
      return;
    }
    if (!moving) {
      return;
    }
    target = mix;
    moving = false;
  }

  function setDuration(ms: number): void {
    if (Number.isFinite(ms) && ms > 0) {
      durationMs = ms;
    }
  }

  /**
   * True while the correction is actually moving, whichever input owns it.
   *
   * The state-frame cadence and the mirror both key off this: a drag that left
   * `moving` false would drop the readback to 1 Hz, and the operator's thumb
   * would lag a second behind the world.
   */
  function movingNow(): boolean {
    if (moving) {
      return true;
    }
    return sliderDriven && Math.abs(sliderTarget - mix) > MIX_SNAP;
  }

  function state(out?: WorldRuntimeState): WorldRuntimeState {
    const result =
      out ?? {
        mix: 0,
        target: 0,
        moving: false,
        ready: false,
        durationMs: DEFAULT_RAMP_MS,
        offsetY: 0,
        eyeY: 0
      };
    result.mix = mix;
    // Whichever input owns the correction: a readback of "where it is heading"
    // is only honest if it names the live owner's target.
    result.target = sliderDriven ? sliderTarget : target;
    result.moving = movingNow();
    result.ready = ready;
    result.durationMs = durationMs;
    result.offsetY = offsetY;
    result.eyeY = eyeY;
    return result;
  }

  return {
    setScene: (eyes) => {
      lyingEyeY = Number.isFinite(eyes.lyingEyeY) ? eyes.lyingEyeY : 0;
      standingEyeY = Number.isFinite(eyes.standingEyeY) ? eyes.standingEyeY : lyingEyeY;
      // A scene switch places the art from scratch: no ramp is running, so the
      // end eye takes effect at once.
      standingFrom = standingEyeY;
      standingNow = standingEyeY;
      restMix = eyes.restMix === 1 ? 1 : 0;
      // With no calibration the mix has no frame to rotate: its only meaning is
      // where the art sits, so place it at the eye it was drawn from. That is
      // what the 2D preview shows, and it matches the first frame a session
      // will take (calibration pushes `restMix` again, from the measured pose).
      if (!ready) {
        mix = restMix;
      }
      // A fresh scene is a fresh hand-off: no slider, no ramp, tracks on the
      // value that is actually applied.
      sliderDriven = false;
      sliderTarget = mix;
      mixTrack.value = mix;
      mixTrack.velocity = 0;
      standingTrack.value = standingNow;
      standingTrack.velocity = 0;
      apply();
    },
    calibrate,
    clearBase,
    update,
    hold: (frozen) => {
      held = frozen;
    },
    rise,
    setMixTarget,
    stopRise,
    setDuration,
    isRising: movingNow,
    apply,
    state
  };
}
