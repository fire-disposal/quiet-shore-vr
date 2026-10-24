import * as THREE from 'three';
import {
  FLOAT_LEVEL_CAP,
  FLOAT_MAX_LEVEL,
  FLOAT_PROFILES,
  easeAmplitude,
  floatAmplitudeForLevel,
  floatOffsetAt,
  floatPitchAt,
  type FloatProfile,
  type FloatProfileId
} from '../core/xr/float';
import {
  buoyancyAllowed,
  contentOffsetFor,
  type BuoyancyGate,
  type BuoyancyFrame
} from '../core/xr/buoyancy-frame';
import type { SceneHandle } from '../core/scene/contract';

/**
 * Owner of everything buoyancy: the technician's choice, the eased envelope,
 * the applied heave and sway, and the two writes that put them in the scene.
 *
 * It owns the content Y too, because a heave is meaningless without knowing
 * which transform it is a delta of: the frame (calibration or sit-up) sets the
 * base height, buoyancy only adds to it. App supplies the session facts
 * through `gate()` and never touches the offset itself.
 *
 * ```text
 * base offset  (frame)  ─┐
 *                         ├─> content.position.y  (+ scene.applyBuoyancy)
 * heave        (bob)   ─┘
 * sway         ──> content.rotation.x  (or the scene's near layers)
 * ```
 */

/**
 * Fade in and out. Sub-millimetre in ~1 s; the state settles (and stops
 * writing) in ~1.6 s, so a stopped scene pays nothing per frame.
 */
const FADE_TAU_S = 0.25;
/** Audio LFO depth at full amplitude; the swell rides the same period. */
const SWELL_AUDIO_DEPTH = 0.12;

export interface FloatingDeps {
  /** Scene host; owns the content group the offset is written to. */
  host: { setFloorOffset(y: number): void; content: THREE.Object3D };
  handle(): SceneHandle | null;
  gate(): BuoyancyGate;
  /** Audio buoyancy LFO: depth 0..1, period in seconds. */
  swell(depth: number, periodS: number): void;
}

export interface FloatingState {
  level: number;
  profile: FloatProfileId;
  breath: boolean;
  /** Eased amplitude in metres; 0 when settled. */
  amplitudeM: number;
  /** Applied heave, in metres. */
  offsetM: number;
  /** Applied horizon sway, in degrees. */
  swayDeg: number;
  /** Content Y owned by the frame, before the heave. */
  baseOffset: number;
}

export interface FloatingApi {
  /** Advance one frame; the only writer of the heave. */
  update(dt: number): void;
  /** Clamped to the level range and the profile's near-field cap. */
  setLevel(level: number): number;
  /** Switching profile pulls the level down to its cap; returns the new level. */
  setProfile(id: FloatProfileId): number;
  setBreath(on: boolean): void;
  /** The active frame moves the world; buoyancy keeps its own delta. */
  setBaseOffset(y: number): void;
  /** Zero the envelope and the applied motion (scene switch, session end). */
  reset(): void;
  getState(out?: FloatingState): FloatingState;
  getLevel(): number;
  getProfile(): FloatProfile;
  /** Amplitude over the envelope, 0..1: what the motes and the swell track. */
  getFlow(): number;
}

export function createFloating(
  deps: FloatingDeps & {
    level?: number;
    profile?: FloatProfileId;
    breath?: boolean;
  }
): FloatingApi {
  const { host, handle, gate, swell } = deps;

  let profile = FLOAT_PROFILES[deps.profile ?? 'b'] ?? FLOAT_PROFILES.b;
  let level = clampLevel(deps.level ?? 1, FLOAT_LEVEL_CAP[profile.id]);
  let breath = deps.breath ?? true;

  let amplitudeM = 0;
  /** Seconds of continuous drift; kept while fading so the phase never jumps. */
  let seconds = 0;
  let offsetM = 0;
  let swayDeg = 0;
  let baseOffset = 0;

  function clampLevel(value: number, cap: number): number {
    if (!Number.isFinite(value)) {
      return 0;
    }
    const rounded = Math.round(value);
    const bounded = Math.min(FLOAT_MAX_LEVEL, Math.max(0, rounded));
    return Math.min(bounded, cap);
  }

  function apply(): void {
    const scene = handle();
    const splits = typeof scene?.applyBuoyancy === 'function';
    host.setFloorOffset(contentOffsetFor(baseOffset, offsetM, splits));
    if (splits && scene?.applyBuoyancy) {
      scene.applyBuoyancy({ amountM: offsetM, swayDeg });
    } else {
      host.content.rotation.x = THREE.MathUtils.degToRad(swayDeg);
    }
  }

  function update(dt: number): void {
    const target = buoyancyAllowed(gate())
      ? floatAmplitudeForLevel(profile, level)
      : 0;
    amplitudeM = easeAmplitude(amplitudeM, target, dt, FADE_TAU_S);
    if (amplitudeM <= 0 && target === 0) {
      // Settle exactly once, so an idle scene pays nothing per frame. The frame
      // offset is not touched here: it belongs to the calibration/sit-up layer.
      amplitudeM = 0;
      if (offsetM !== 0 || swayDeg !== 0) {
        offsetM = 0;
        swayDeg = 0;
        apply();
      }
      swell(0, profile.periodS);
      return;
    }
    seconds += dt;
    // The swell follows the visible heave: same period, depth scaled by how
    // much of the envelope is currently in use.
    swell((amplitudeM / profile.amplitudeM) * SWELL_AUDIO_DEPTH, profile.periodS);
    offsetM = floatOffsetAt(profile, seconds, amplitudeM, breath);
    // Horizon sway: a couple of degrees of world pitch, in phase with the
    // drift, is what makes the horizon feel unmoored rather than the floor.
    swayDeg = floatPitchAt(profile, seconds, amplitudeM);
    apply();
  }

  function setLevel(next: number): number {
    level = clampLevel(next, FLOAT_LEVEL_CAP[profile.id]);
    return level;
  }

  function setProfile(id: FloatProfileId): number {
    profile = FLOAT_PROFILES[id];
    level = Math.min(level, FLOAT_LEVEL_CAP[id]);
    return level;
  }

  function setBaseOffset(next: number): void {
    baseOffset = Number.isFinite(next) ? next : 0;
    apply();
  }

  function reset(): void {
    amplitudeM = 0;
    seconds = 0;
    offsetM = 0;
    swayDeg = 0;
    apply();
  }

  return {
    update,
    setLevel,
    setProfile,
    setBreath: (on) => {
      breath = on;
    },
    setBaseOffset,
    reset,
    getLevel: () => level,
    getProfile: () => profile,
    getFlow: () => (amplitudeM > 0 ? Math.min(1, amplitudeM / profile.amplitudeM) : 0),
    getState: (out) => {
      const state: FloatingState = out ?? {
        level: 0,
        profile: 'b',
        breath: true,
        amplitudeM: 0,
        offsetM: 0,
        swayDeg: 0,
        baseOffset: 0
      };
      state.level = level;
      state.profile = profile.id;
      state.breath = breath;
      state.amplitudeM = amplitudeM;
      state.offsetM = offsetM;
      state.swayDeg = swayDeg;
      state.baseOffset = baseOffset;
      return state;
    }
  };
}

/** Frame labels, kept next to the gate so callers cannot invent a third one. */
export function frameOf(posturePosesBase: boolean): BuoyancyFrame {
  return posturePosesBase ? 'posture' : 'calibrated';
}
