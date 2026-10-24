import * as THREE from 'three';
import { smootherstep } from '../core/xr/drivers/curve';
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
}

/** Manual ramp (the operator's rise / lie-back); settable 4–14 s. */
const DEFAULT_RAMP_MS = 6000;


export interface WorldRuntimeApi {
  /** A new scene: its authored eye decides the placement from now on. */
  setScene(placement: { eyeY: number }): void;
  /**
   * Adopt the orientation the patient is holding as the calibration frame, and
   * start **uncorrected**: the ceiling stays the real ceiling until the rise
   * animation is asked for.
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

  let eyeY = 1.7;
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
   * Scene art is authored with its eye at the content origin, so the frame
   * lowers it by exactly that eye height. The buoyancy delta rides on top.
   */
  function apply(): void {
    offsetY = Number.isFinite(eyeY) ? -eyeY : 0;
    setBaseOffset(offsetY);
  }

  function pushMix(next: number): void {
    mix = next;
    comfort()?.setCorrectionMix(mix);
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
    // Enter the session the way the room actually looks and stay there. The
    // ramp is the operator's alone: an automatic 8 s rise fought the 起身 /
    // 停止 buttons (a stop pressed inside it froze a half-corrected world) and
    // made "起身" look dead because the world had already risen by itself.
    pushMix(0);
    ready = true;
    apply();
    from = 0;
    target = 0;
    elapsedMs = 0;
    moving = false;
    return true;
  }

  function clearBase(): void {
    // A stop during calibration must not leave the world frozen for the next
    // session: releasing the base releases the hold too.
    held = false;
    moving = false;
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
    if (moving) {
      elapsedMs += dt * 1000;
      const t = rampMs > 0 ? Math.min(1, elapsedMs / rampMs) : 1;
      pushMix(from + (target - from) * smootherstep(t));
      if (t >= 1) {
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
    if (next === mix) {
      return true;
    }
    from = mix;
    target = next;
    elapsedMs = 0;
    rampMs = durationMs;
    moving = true;
    return true;
  }

  function stopRise(): void {
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

  function state(out?: WorldRuntimeState): WorldRuntimeState {
    const result =
      out ?? { mix: 0, target: 0, moving: false, ready: false, durationMs: DEFAULT_RAMP_MS, offsetY: 0 };
    result.mix = mix;
    result.target = target;
    result.moving = moving;
    result.ready = ready;
    result.durationMs = durationMs;
    result.offsetY = offsetY;
    return result;
  }

  return {
    setScene: (placement) => {
      eyeY = placement.eyeY;
      apply();
    },
    calibrate,
    clearBase,
    update,
    hold: (frozen) => {
      held = frozen;
    },
    rise,
    stopRise,
    setDuration,
    isRising: () => moving,
    apply,
    state
  };
}
