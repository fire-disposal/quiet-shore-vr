import * as THREE from 'three';
import {
  floatAmplitude,
  easeAmplitude,

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
    /** Base offset for the sky: same frame, no bob. */
    setBackdropOffset(y: number): void;
    /** Content-space offset for the whole art. */
    setContentPosition(x: number, y: number, z: number): void;
  };
  handle(): SceneHandle | null;
  gate(): BuoyancyGate;
  /** World up in content space; the heave follows this fixed axis. */
  axis(out: THREE.Vector3): THREE.Vector3;
}

export interface FloatingState {
  /** Intensity as a fraction of the full envelope, 0–1. */
  amount: number;
  /** The breathing switch, eased: 1 = the heave breathes, 0 = plain sine. */
  breath: number;
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
  /** Clamped to 0–1 and to the scene's own ceiling. */
  setAmount(amount: number, sceneCap?: number): number;
  /**
   * The breathing switch: the slow swell of the heave and the millimetre
   * wobble on top. Off keeps the same envelope and period as a plain sine, so
   * the patient still floats — it just stops breathing.
   */
  setBreath(on: boolean): void;
  getBreath(): boolean;
  /** The active frame moves the world; buoyancy keeps its own delta. */
  setBaseOffset(y: number): void;
  /** Zero the envelope and the applied motion (scene switch, session end). */
  reset(): void;
  getState(out?: FloatingState): FloatingState;
  getAmount(): number;
}

export function createFloating(
  deps: FloatingDeps & { amount?: number; breath?: boolean }
): FloatingApi {
  const { host, handle, gate, axis } = deps;
  const up = new THREE.Vector3(0, 1, 0);

  let amount = clampAmount(deps.amount ?? 1);

  let amplitudeM = 0;
  /** Eased breathing switch, so toggling it never steps the amplitude. */
  let breath = deps.breath === false ? 0 : 1;
  let breathTarget = breath;
  /** Seconds of continuous drift; kept while fading so the phase never jumps. */
  let seconds = 0;
  let offsetM = 0;
  let baseOffset = 0;

  function clampAmount(value: number): number {
    return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
  }

  function apply(): void {
    axis(up);
    // The weather never moves: the backdrop takes the floor offset and stays
    // put, whatever the scene is. There is one buoyancy implementation for
    // every scene, and a scene's only say in it is which nodes are sky.
    host.setBackdropOffset(baseOffset);
    // The frame owns the base Y; the heave is one vector along world up, so
    // the whole scene rises and falls vertically no matter where the patient
    // looks. The Y component must be scaled by the axis too — adding the full
    // offset to Y and the rest to X/Z made a tilted frame heave 19% too far.
    host.setContentPosition(
      up.x * offsetM,
      baseOffset + up.y * offsetM,
      up.z * offsetM
    );
  }

  function update(dt: number): void {
    const allowed = buoyancyAllowed(gate());
    const levelAmplitude = allowed ? floatAmplitude(amount) : 0;
    const target = levelAmplitude;
    amplitudeM = easeAmplitude(amplitudeM, target, dt, FADE_TAU_S);
    // A closed gate or a zero amount settles exactly once, so an idle scene pays
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
    // Same ease as the envelope: a switch is a fade, not a cut.
    breath = easeAmplitude(breath, breathTarget, dt, FADE_TAU_S);
    offsetM = amplitudeM > 0 ? floatOffsetAt(seconds, amplitudeM, breath) : 0;
    if (offsetM !== 0) {
      apply();
    }
  }

  function setBreath(on: boolean): void {
    breathTarget = on ? 1 : 0;
  }

  function setAmount(next: number, sceneCap = 1): number {
    amount = clampAmount(next);
    if (amount > sceneCap) {
      amount = sceneCap;
    }
    return amount;
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
    setAmount,
    setBaseOffset,
    reset,
    getAmount: () => amount,
    setBreath,
    getBreath: () => breathTarget === 1,
    getState: (out) => {
      const state: FloatingState = out ?? {
        amount: 1,
        breath: 1,
        amplitudeM: 0,
        offsetM: 0,
        baseOffset: 0
      };
      state.amount = amount;
      state.breath = breath;
      state.amplitudeM = amplitudeM;
      state.offsetM = offsetM;
      state.baseOffset = baseOffset;
      return state;
    }
  };
}
