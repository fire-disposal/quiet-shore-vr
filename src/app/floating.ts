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
import { buoyancyAllowed, contentOffsetFor, type BuoyancyGate } from '../core/xr/buoyancy-frame';
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

export interface FloatingDeps {
  /** Scene host; owns the content group the offset is written to. */
  host: {
    setFloorOffset(y: number): void;
    /** Content-space offset for the whole art, used when the scene has no split. */
    setContentPosition(x: number, y: number, z: number): void;
    /** The art group; the fallback sway tilts it. */
    content: THREE.Object3D;
  };
  handle(): SceneHandle | null;
  gate(): BuoyancyGate;
  /** Visual up in content space; the heave runs along it, whatever the frame. */
  axis(out: THREE.Vector3): THREE.Vector3;
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
  /**
   * Clamped to the level range, the profile's near-field cap and the scene's
   * own comfort ceiling (the light well cannot be pushed to full amplitude).
   */
  setLevel(level: number, sceneCap?: number): number;
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
  const { host, handle, gate, axis } = deps;
  const up = new THREE.Vector3(0, 1, 0);

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
    axis(up);
    if (splits && scene?.applyBuoyancy) {
      host.setFloorOffset(contentOffsetFor(baseOffset, offsetM, true));
      scene.applyBuoyancy({ amountM: offsetM, swayDeg, axis: { x: up.x, y: up.y, z: up.z } });
      return;
    }
    // The frame owns Y; the heave is a vector along the visual up, so a supine
    // frame lifts the world in view instead of pushing it along the gaze.
    host.setContentPosition(
      up.x * offsetM,
      contentOffsetFor(baseOffset, offsetM, false),
      up.z * offsetM
    );
    host.content.rotation.x = THREE.MathUtils.degToRad(swayDeg);
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
      return;
    }
    seconds += dt;
    offsetM = floatOffsetAt(profile, seconds, amplitudeM, breath);
    // Horizon sway: a couple of degrees of world pitch, in phase with the
    // drift, is what makes the horizon feel unmoored rather than the floor.
    // The sway is a horizon tilt; it only means that while the scene's up is
    // the visual up. A supine viewer would see it as a pitch of the world.
    axis(up);
    swayDeg = up.y > 0.7 ? floatPitchAt(profile, seconds, amplitudeM) : 0;
    apply();
  }

  function setLevel(next: number, sceneCap = FLOAT_MAX_LEVEL): number {
    level = clampLevel(next, Math.min(FLOAT_LEVEL_CAP[profile.id], sceneCap));
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
