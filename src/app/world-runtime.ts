import * as THREE from 'three';
import { SitUpPath, type CameraPose } from '../core/xr/situp-path';
import { createSitUpMotion, type SitUpMotionApi } from '../core/xr/situp-run';
import type { ComfortApi } from '../core/xr/comfort';
import type { WorldShellApi } from '../core/xr/world-shell';
import { planFrame, type FramePlan } from '../core/xr/world-frame';
import type { PoseLike } from '../core/xr/types';

/**
 * Owner of the world's base pose: the calibration frame, the sit-up path, and
 * the placement that goes with them.
 *
 * ```text
 * calibrate(pose)  comfort.calibrate  ->  q0
 *                  planFrame(mode, scene)  ->  base + offsetY
 * rise(1)          sit-up ramp  ->  worldFor(head, path.at(t))  ->  base
 * ```
 *
 * App used to hold this as six fields and five writers; a mode switch, a
 * calibration and an eye-height change could each re-derive the base and
 * disagree. Here there is one `apply()`, and every entry point goes through it.
 */

export interface WorldRuntimeDeps {
  shell(): WorldShellApi | null;
  comfort(): ComfortApi | null;
  /** The operator's standing eye height setting. */
  eyeHeight(): number;
  /** The frame's residual offset, owned by the buoyancy module. */
  setBaseOffset(y: number): void;
  /** Session mode; fixed for the session. */
  mode(): 'float' | 'posture';
}

/** What telemetry, the HUD and the cue need to read back. */
export interface WorldRuntimeState {
  posturePosesBase: boolean;
  plan: FramePlan;
  sitUpT: number;
  sitUpTarget: number;
  sitUpMoving: boolean;
  sitUpReady: boolean;
  path: SitUpPath | null;
  base0: THREE.Quaternion;
}

export interface WorldRuntimeApi {
  /** A new scene: its authored eye decides the frame from now on. */
  setScene(placement: { posture: 'standing' | 'supine'; eyeY: number }): void;
  /**
   * Adopt the orientation the patient is holding as the world frame, prepare
   * the sit-up path, and hand the world to the frame the mode calls for.
   */
  calibrate(orientation: { x: number; y: number; z: number; w: number }, position: THREE.Vector3): boolean;
  /** Drop the sit-up pose; the next `calibrate` (or frame apply) owns the base. */
  clearBase(): void;
  /** Advance the sit-up ramp (or the comfort posture) and write the base. */
  update(dt: number): void;
  /** 1 = rise, 0 = lie back; refuses (false) when no path is prepared. */
  rise(target: 0 | 1): boolean;
  stopRise(): void;
  setDuration(ms: number): void;
  /** Eye height changed: the path and the standing placement follow. */
  setEyeHeight(m: number): void;
  /** True while the sit-up ramp is moving; the cue and the cadence read this. */
  isRising(): boolean;
  /** Re-derive base and offset from the current mode and scene. */
  apply(): void;
  state(out?: WorldRuntimeState): WorldRuntimeState;
  path(): SitUpPath | null;
}

const DEFAULT_HIP = 0.45;

export function createWorldRuntime(deps: WorldRuntimeDeps): WorldRuntimeApi {
  const { shell, comfort, eyeHeight, setBaseOffset, mode } = deps;

  let posture: 'standing' | 'supine' = 'standing';
  let eyeY = 1.7;
  let plan: FramePlan = { base: 'calibrated', offsetY: 0 };

  /** Set by `setEyeHeight`; falls back to the app's setting until then. */
  let standOverride = Number.NaN;
  const standHeight = (): number => (Number.isFinite(standOverride) ? standOverride : eyeHeight());

  let sitUpPath: SitUpPath | null = null;
  let sitUpReference: CameraPose | null = null;
  const sitUpBase0 = new THREE.Quaternion();
  const motion: SitUpMotionApi = createSitUpMotion({ durationMs: 12000 });
  /** True while the sit-up path poses the base (mirrors `plan.base`). */
  let posed = false;

  function applyTransform(): void {
    const shellApi = shell();
    if (!posed || !sitUpPath || !sitUpReference || !shellApi) {
      return;
    }
    shellApi.setBasePose(sitUpPath.worldFor(sitUpReference, sitUpPath.at(motion.t)));
  }

  function apply(): void {
    plan = planFrame({
      posture,
      mode: mode(),
      eyeY,
      standEyeHeight: standHeight(),
      lyingEyeHeight: sitUpPath?.hipHeight ?? DEFAULT_HIP
    });
    posed = plan.base === 'situp';
    const shellApi = shell();
    if (posed) {
      applyTransform();
    } else {
      shellApi?.setBasePose(null);
    }
    setBaseOffset(plan.offsetY);
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
    sitUpPath = new SitUpPath({ standEyeHeight: standHeight() });
    sitUpReference = {
      position: position.clone(),
      quaternion: new THREE.Quaternion(orientation.x, orientation.y, orientation.z, orientation.w)
    };
    motion.reset();
    sitUpBase0.copy(sitUpPath.worldFor(sitUpReference, sitUpPath.at(0)).quaternion);
    apply();
    return true;
  }

  function clearBase(): void {
    posed = false;
    sitUpPath = null;
    sitUpReference = null;
    motion.reset();
    sitUpBase0.identity();
    shell()?.setBasePose(null);
  }

  function update(dt: number): void {
    if (posed) {
      if (motion.update(dt)) {
        applyTransform();
      }
      return;
    }
    comfort()?.updatePosture(dt);
  }

  function rise(target: 0 | 1): boolean {
    if (!sitUpPath || !sitUpReference) {
      return false;
    }
    motion.setTarget(target);
    return true;
  }

  function setEyeHeight(next: number): void {
    standOverride = Number.isFinite(next) && next > 0 ? next : Number.NaN;
    if (sitUpPath && sitUpReference) {
      sitUpPath = new SitUpPath({ standEyeHeight: next });
      applyTransform();
    }
    apply();
  }

  function state(out?: WorldRuntimeState): WorldRuntimeState {
    const result: WorldRuntimeState = out ?? {
      posturePosesBase: posed,
      plan,
      sitUpT: 0,
      sitUpTarget: 0,
      sitUpMoving: false,
      sitUpReady: false,
      path: null,
      base0: sitUpBase0
    };
    result.posturePosesBase = posed;
    result.plan = plan;
    result.sitUpT = motion.t;
    result.sitUpTarget = motion.target;
    result.sitUpMoving = motion.moving;
    result.sitUpReady = sitUpPath !== null;
    result.path = sitUpPath;
    return result;
  }

  return {
    setScene: (placement) => {
      posture = placement.posture;
      eyeY = placement.eyeY;
    },
    calibrate,
    clearBase,
    update,
    rise,
    stopRise: () => motion.stop(),
    setDuration: (ms) => motion.setDuration(ms),
    setEyeHeight,
    isRising: () => motion.moving,
    apply,
    state,
    path: () => sitUpPath
  };
}
