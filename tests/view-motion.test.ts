import { describe, expect, it } from 'vitest';
import {
  createViewMotionController,
  isViewPresetId,
  presetCode,
  UP_GAZE_LIMIT_DEG,
  VIEW_PRESET_CODES,
  VIEW_PRESETS,
  VIEW_PITCH_MAX_DEG_PER_S,
  LOOK_YAW_LIMIT_DEG,
  type ViewMotionControllerApi
} from '../src/core/xr/view-motion';

function createHarness(): {
  controller: ViewMotionControllerApi;
  pushed: number[];
  last(): number;
  step(seconds: number, fps?: number): void;
} {
  const pushed: number[] = [];
  const controller = createViewMotionController({
    sink: { setOrientation: (_yaw, pitch) => pushed.push(pitch) }
  });
  return {
    controller,
    pushed,
    last: () => pushed[pushed.length - 1],
    step: (seconds, fps = 60) => {
      const frames = Math.max(1, Math.round(seconds * fps));
      for (let i = 0; i < frames; i += 1) {
        controller.update(1 / fps);
      }
    }
  };
}

/** Bring a harness to an exact angle through the slider, then settle. */
function placeAt(controller: ViewMotionControllerApi, deg: number): void {
  controller.setTarget(0, deg);
  for (let i = 0; i < 1200; i += 1) {
    controller.update(1 / 60);
  }
}

describe('view preset catalog', () => {
  it('declares ids, codes, labels, durations and curve semantics', () => {
    expect(Object.keys(VIEW_PRESETS).sort()).toEqual(['breathe', 'down', 'recenter', 'up']);

    expect(VIEW_PRESETS.up.motion).toBe('relative');
    expect(VIEW_PRESETS.up.excursionDeg).toBe(10);
    expect(VIEW_PRESETS.up.durationMs).toBe(3000);
    expect(VIEW_PRESETS.up.curve).toBe('smootherstep');
    expect(VIEW_PRESETS.up.label).toEqual({ zh: '上仰', en: 'Up' });

    expect(VIEW_PRESETS.down.motion).toBe('relative');
    expect(VIEW_PRESETS.down.excursionDeg).toBe(-10);
    expect(VIEW_PRESETS.down.durationMs).toBe(3000);

    expect(VIEW_PRESETS.recenter.motion).toBe('absolute');
    expect(VIEW_PRESETS.recenter.excursionDeg).toBe(0);
    expect(VIEW_PRESETS.recenter.durationMs).toBe(2400);

    expect(VIEW_PRESETS.breathe.motion).toBe('round-trip');
    expect(VIEW_PRESETS.breathe.excursionDeg).toBe(6);
    expect(VIEW_PRESETS.breathe.durationMs).toBe(6000);
    expect(VIEW_PRESETS.breathe.curve).toBe('cycle');

    for (const preset of Object.values(VIEW_PRESETS)) {
      expect(preset.id).toBe(preset.id.toLowerCase());
      expect(preset.curveLabel.length).toBeGreaterThan(0);
      expect(VIEW_PRESET_CODES[preset.id]).toBeGreaterThan(0);
    }

    expect(VIEW_PRESET_CODES).toEqual({ none: 0, up: 1, down: 2, recenter: 3, breathe: 4 });
    expect(presetCode(null)).toBe('none');
    expect(presetCode('breathe')).toBe('breathe');
  });

  it('lets the whole catalog play and only its ids be playable', () => {
    for (const id of Object.keys(VIEW_PRESETS)) {
      const harness = createHarness();
      expect(harness.controller.play(id)).toBe(true);
      expect(['playing', 'idle']).toContain(harness.controller.getStateName());
    }
    const harness = createHarness();
    expect(harness.controller.play('none')).toBe(false);
    expect(harness.controller.play('sideways')).toBe(false);
    expect(harness.controller.play('up,0')).toBe(false);
    expect(isViewPresetId('up')).toBe(true);
    expect(isViewPresetId('none')).toBe(false);
    expect(isViewPresetId('UP')).toBe(false);
  });
});

describe('view motion controller', () => {
  it('moves up by +10° relative to the current angle over 3 s', () => {
    const harness = createHarness();
    placeAt(harness.controller, 4);
    expect(harness.controller.getStateName()).toBe('idle');

    expect(harness.controller.play('up')).toBe(true);
    expect(harness.controller.getStateName()).toBe('playing');
    expect(harness.controller.getPresetId()).toBe('up');
    expect(harness.controller.getTargetUpGazeDeg()).toBe(14);

    harness.controller.update(1 / 60);
    expect(harness.controller.getUpGazeDeg()).toBeLessThan(4.05);

    harness.step(1.5 - 1 / 60);
    expect(harness.controller.getUpGazeDeg()).toBeCloseTo(9, 1);
    harness.step(1.6);
    expect(harness.controller.getUpGazeDeg()).toBeCloseTo(14, 6);
    expect(harness.controller.getStateName()).toBe('idle');
  });

  it('clamps relative up and down at the ±90° envelope', () => {
    const nearTop = createHarness();
    placeAt(nearTop.controller, 85);
    nearTop.controller.play('up');
    expect(nearTop.controller.getTargetUpGazeDeg()).toBe(UP_GAZE_LIMIT_DEG);
    nearTop.step(3.1);
    expect(nearTop.controller.getUpGazeDeg()).toBe(UP_GAZE_LIMIT_DEG);

    const atTop = createHarness();
    placeAt(atTop.controller, UP_GAZE_LIMIT_DEG);
    expect(atTop.controller.play('up')).toBe(true);
    // Already at the clamp: no playback, no fake preset.
    expect(atTop.controller.getStateName()).toBe('idle');
    expect(atTop.controller.getPresetId()).toBeNull();
    atTop.step(1);
    expect(atTop.controller.getUpGazeDeg()).toBe(UP_GAZE_LIMIT_DEG);

    const nearBottom = createHarness();
    placeAt(nearBottom.controller, -85);
    nearBottom.controller.play('down');
    expect(nearBottom.controller.getTargetUpGazeDeg()).toBe(-UP_GAZE_LIMIT_DEG);
    nearBottom.step(3.1);
    expect(nearBottom.controller.getUpGazeDeg()).toBe(-UP_GAZE_LIMIT_DEG);

    const middle = createHarness();
    placeAt(middle.controller, 6);
    middle.controller.play('down');
    middle.step(3.1);
    expect(middle.controller.getUpGazeDeg()).toBeCloseTo(-4, 6);
  });

  it('recenters to 0° with an animation, not a snap', () => {
    const harness = createHarness();
    placeAt(harness.controller, -12);
    expect(harness.controller.getUpGazeDeg()).toBeCloseTo(-12, 6);

    expect(harness.controller.play('recenter')).toBe(true);
    expect(harness.controller.getPresetId()).toBe('recenter');
    harness.controller.update(1 / 60);
    expect(harness.controller.getUpGazeDeg()).toBeGreaterThan(-12);
    expect(harness.controller.getUpGazeDeg()).toBeLessThan(-11.5);

    harness.step(VIEW_PRESETS.recenter.durationMs / 1000 + 0.1);
    expect(harness.controller.getUpGazeDeg()).toBeCloseTo(0, 6);
    expect(harness.controller.getStateName()).toBe('idle');
    expect(harness.controller.getPresetId()).toBeNull();
  });

  it('breathes out and back to the angle it started from', () => {
    const harness = createHarness();
    placeAt(harness.controller, 5);

    harness.controller.play('breathe');
    expect(harness.controller.getPresetId()).toBe('breathe');

    // Quarter cycle: half the excursion; half cycle: the peak; end: back home.
    harness.step(1.5);
    expect(harness.controller.getUpGazeDeg()).toBeCloseTo(8, 1);
    harness.step(1.5);
    expect(harness.controller.getUpGazeDeg()).toBeCloseTo(11, 1);
    harness.step(3.1);
    expect(harness.controller.getUpGazeDeg()).toBeCloseTo(5, 6);
    expect(harness.controller.getStateName()).toBe('idle');
    expect(harness.controller.getPresetId()).toBeNull();
    expect(harness.controller.getTargetUpGazeDeg()).toBe(5);
  });

  it('clamps the breathe excursion at the envelope and still returns home', () => {
    const harness = createHarness();
    placeAt(harness.controller, 88);
    harness.controller.play('breathe');
    harness.step(3);
    expect(harness.controller.getUpGazeDeg()).toBeCloseTo(UP_GAZE_LIMIT_DEG, 6);
    harness.step(3.1);
    expect(harness.controller.getUpGazeDeg()).toBeCloseTo(88, 6);
  });

  it('reports the preset through playing and held, then clears it', () => {
    const harness = createHarness();
    harness.controller.play('up');
    harness.step(1);
    const playing = harness.controller.getState();
    expect(playing.state).toBe('playing');
    expect(playing.preset).toBe('up');

    harness.controller.stop();
    const held = harness.controller.getState();
    expect(held.state).toBe('held');
    expect(held.preset).toBe('up');
    const frozen = held.upGazeDeg;
    harness.step(3);
    expect(harness.controller.getUpGazeDeg()).toBe(frozen);

    // A slider command is not a preset.
    expect(harness.controller.setTarget(0, 2)).toBe(true);
    expect(harness.controller.getPresetId()).toBeNull();
    expect(harness.controller.getStateName()).toBe('playing');
    harness.step(5);
    expect(harness.controller.getUpGazeDeg()).toBeCloseTo(2, 6);
    expect(harness.controller.getStateName()).toBe('idle');
    expect(harness.controller.getPresetId()).toBeNull();
  });

  it('resumes a held preset from the current angle, not from zero', () => {
    const harness = createHarness();
    harness.controller.play('up');
    harness.step(1);
    const held = harness.controller.getUpGazeDeg();
    harness.controller.stop();
    harness.step(1);

    expect(harness.controller.play('up')).toBe(true);
    harness.step(3.1);
    // Relative semantics: one more +10 from where it froze.
    expect(harness.controller.getUpGazeDeg()).toBeCloseTo(held + 10, 6);
  });

  it('resets to idle at 0° without easing and clears the preset', () => {
    const harness = createHarness();
    harness.controller.play('breathe');
    harness.step(1);
    harness.controller.reset();
    expect(harness.controller.getStateName()).toBe('idle');
    expect(harness.controller.getPresetId()).toBeNull();
    expect(harness.controller.getUpGazeDeg()).toBe(0);
    expect(harness.controller.getTargetUpGazeDeg()).toBe(0);
    expect(harness.last()).toBe(0);
  });

  it('retargets the slider from the current angle without a snap', () => {
    const harness = createHarness();
    expect(harness.controller.setTarget(0, UP_GAZE_LIMIT_DEG)).toBe(true);
    expect(harness.controller.getStateName()).toBe('playing');

    harness.step(0.5);
    const midpoint = harness.controller.getUpGazeDeg();
    expect(midpoint).toBeGreaterThan(0);
    expect(midpoint).toBeLessThan(UP_GAZE_LIMIT_DEG);

    // Reverse mid-flight: the next frame must move by a bounded step only.
    expect(harness.controller.setTarget(0, -UP_GAZE_LIMIT_DEG)).toBe(true);
    const before = harness.controller.getUpGazeDeg();
    harness.controller.update(1 / 60);
    expect(Math.abs(harness.controller.getUpGazeDeg() - before)).toBeLessThanOrEqual(
      VIEW_PITCH_MAX_DEG_PER_S / 60 + 1e-9
    );

    harness.step(20);
    expect(harness.controller.getUpGazeDeg()).toBeCloseTo(-UP_GAZE_LIMIT_DEG, 6);
    expect(harness.controller.getStateName()).toBe('idle');
  });

  it('rejects out-of-envelope, non-finite and unknown input whole', () => {
    const harness = createHarness();
    expect(harness.controller.setTarget(0, 90.5)).toBe(false);
    expect(harness.controller.setTarget(0, -91)).toBe(false);
    expect(harness.controller.setTarget(0, Number.NaN)).toBe(false);
    expect(harness.controller.setTarget(180.5, 0)).toBe(false);
    expect(harness.controller.setTarget(Number.NaN, 0)).toBe(false);
    expect(harness.controller.play('')).toBe(false);
    expect(harness.controller.getStateName()).toBe('idle');
    expect(harness.controller.getTargetUpGazeDeg()).toBe(0);

    expect(harness.controller.setTarget(0, UP_GAZE_LIMIT_DEG)).toBe(true);
    expect(harness.controller.getTargetUpGazeDeg()).toBe(UP_GAZE_LIMIT_DEG);
  });

  it('drives yaw and pitch independently under their own rate caps', () => {
    const harness = createHarness();
    expect(harness.controller.setTarget(LOOK_YAW_LIMIT_DEG, 0)).toBe(true);
    expect(harness.controller.getTargetLookYawDeg()).toBe(LOOK_YAW_LIMIT_DEG);
    expect(harness.controller.getTargetUpGazeDeg()).toBe(0);

    harness.controller.update(1 / 60);
    expect(harness.controller.getLookYawDeg()).toBeGreaterThan(0);
    expect(harness.controller.getLookYawDeg()).toBeLessThanOrEqual(
      30 / 60 + 1e-9
    );
    expect(harness.controller.getUpGazeDeg()).toBe(0);

    // Pitch keeps its own, gentler cap while yaw is still moving.
    harness.controller.setTarget(LOOK_YAW_LIMIT_DEG, 90);
    const pitchBefore = harness.controller.getUpGazeDeg();
    harness.controller.update(1 / 60);
    expect(harness.controller.getUpGazeDeg() - pitchBefore).toBeLessThanOrEqual(
      VIEW_PITCH_MAX_DEG_PER_S / 60 + 1e-9
    );

    // A stop freezes both channels.
    harness.controller.stop();
    const frozenYaw = harness.controller.getLookYawDeg();
    const frozenPitch = harness.controller.getUpGazeDeg();
    harness.step(2);
    expect(harness.controller.getLookYawDeg()).toBe(frozenYaw);
    expect(harness.controller.getUpGazeDeg()).toBe(frozenPitch);
  });

  it('recenter also unwinds yaw to zero', () => {
    const harness = createHarness();
    harness.controller.setTarget(-120, 10);
    harness.step(30);
    expect(harness.controller.getLookYawDeg()).toBeCloseTo(-120, 6);

    harness.controller.play('recenter');
    harness.step(8);
    expect(harness.controller.getLookYawDeg()).toBeCloseTo(0, 6);
    expect(harness.controller.getUpGazeDeg()).toBeCloseTo(0, 6);
    expect(harness.controller.getStateName()).toBe('idle');
  });

  it('writes state into a caller object so snapshotting does not allocate', () => {
    const harness = createHarness();
    const out = {
      state: 'idle' as const,
      lookYawDeg: 0,
      upGazeDeg: 0,
      targetLookYawDeg: 0,
      targetUpGazeDeg: 0,
      preset: null
    };
    const result = harness.controller.getState(out);
    expect(result).toBe(out);
    expect(out.state).toBe('idle');
    expect(out.preset).toBeNull();
  });
});
