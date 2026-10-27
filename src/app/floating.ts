import * as THREE from 'three';
import {
  FLOAT_MAX_LEVEL,
  easeAmplitude,
  floatAmplitudeForLevel,
  floatOffsetAt
} from '../core/xr/float';
import { buoyancyAllowed, type BuoyancyGate } from '../core/xr/buoyancy-frame';
import type { SceneHandle } from '../core/scene/contract';

/**
 * Owner of everything buoyancy: the technician's choice, the eased envelope,
 * the applied heave, and the two writes that put it in the scene.
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
  };
  handle(): SceneHandle | null;
  gate(): BuoyancyGate;
  /** Visual up in content space; the heave runs along it, whatever the frame. */
  axis(out: THREE.Vector3): THREE.Vector3;
  /** 1 when the loaded scene takes the heave (the shore), 0 elsewhere. */
  heaveScale?(): number;
}

export interface FloatingState {
  level: number;
  /** Eased amplitude in metres; 0 when settled. */
  amplitudeM: number;
  /** Applied heave, in metres. */
  offsetM: number;
  /** Content Y owned by the frame, before the heave. */
  baseOffset: number;
}

export interface FloatingApi {
  /** Advance one frame; the only writer of the heave. */
  update(dt: number): void;
  /** Clamped to the level range and the scene's own comfort ceiling. */
  setLevel(level: number, sceneCap?: number): number;
  /** The active frame moves the world; buoyancy keeps its own delta. */
  setBaseOffset(y: number): void;
  /** Zero the envelope and the applied motion (scene switch, session end). */
  reset(): void;
  getState(out?: FloatingState): FloatingState;
  getLevel(): number;
}

export function createFloating(
  deps: FloatingDeps & { level?: number }
): FloatingApi {
  const { host, handle, gate, axis } = deps;
  const up = new THREE.Vector3(0, 1, 0);

  let level = clampLevel(deps.level ?? 1);

  let amplitudeM = 0;
  /** Seconds of continuous drift; kept while fading so the phase never jumps. */
  let seconds = 0;
  let offsetM = 0;
  let baseOffset = 0;

  function clampLevel(value: number): number {
    if (!Number.isFinite(value)) {
      return 0;
    }
    const rounded = Math.round(value);
    return Math.min(FLOAT_MAX_LEVEL, Math.max(0, rounded));
  }

  function apply(): void {
    const scene = handle();
    const splits = typeof scene?.applyBuoyancy === 'function';
    axis(up);
    if (splits && scene?.applyBuoyancy) {
      host.setFloorOffset(baseOffset);
      scene.applyBuoyancy({ amountM: offsetM, axis: { x: up.x, y: up.y, z: up.z } });
      return;
    }
    // The frame owns the base Y; the heave is one vector along the visual up,
    // so a supine frame lifts the world in view instead of pushing it along the
    // gaze. The Y component must be scaled by the axis too — adding the full
    // offset to Y and the rest to X/Z made a tilted frame heave 19% too far.
    host.setContentPosition(
      up.x * offsetM,
      baseOffset + up.y * offsetM,
      up.z * offsetM
    );
  }

  function update(dt: number): void {
    const allowed = buoyancyAllowed(gate());
    const levelAmplitude = allowed ? floatAmplitudeForLevel(level) : 0;
    const target = levelAmplitude * (deps.heaveScale?.() ?? 1);
    amplitudeM = easeAmplitude(amplitudeM, target, dt, FADE_TAU_S);
    // A closed gate or level 0 settles exactly once, so an idle scene pays
    // nothing per frame.
    if (amplitudeM <= 0 && target === 0) {
      amplitudeM = 0;
      if (offsetM !== 0) {
        offsetM = 0;
        apply();
      }
      return;
    }
    seconds += dt;
    offsetM = amplitudeM > 0 ? floatOffsetAt(seconds, amplitudeM) : 0;
    if (offsetM !== 0) {
      apply();
    }
  }

  function setLevel(next: number, sceneCap = FLOAT_MAX_LEVEL): number {
    level = clampLevel(next);
    if (level > sceneCap) {
      level = sceneCap;
    }
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
    apply();
  }

  return {
    update,
    setLevel,
    setBaseOffset,
    reset,
    getLevel: () => level,
    getState: (out) => {
      const state: FloatingState = out ?? {
        level: 0,
        amplitudeM: 0,
        offsetM: 0,
        baseOffset: 0
      };
      state.level = level;
      state.amplitudeM = amplitudeM;
      state.offsetM = offsetM;
      state.baseOffset = baseOffset;
      return state;
    }
  };
}
