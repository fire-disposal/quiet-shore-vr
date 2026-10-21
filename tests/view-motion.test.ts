import { describe, expect, it } from 'vitest';
import {
  createViewMotionController,
  isViewPresetId,
  presetCode,
  VIEW_PITCH_LIMIT_DEG,
  VIEW_PRESET_CODES,
  VIEW_PRESETS,
  VIEW_TRACK_MAX_DEG_PER_S,
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
    sink: { setPitch: (deg) => pushed.push(deg) }
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
  controller.setTarget(deg);
  for (let i = 0; i < 1200; i += 1) {
    controller.update(1 / 60);
  }
}

describe('view preset catalog', () => {
  it('declares ids, codes, labels, durations and curve semantics', () => {
    expect(Object.keys(VIEW_PRESETS).sort()).toEqual(['breathe', 'down', 'recenter', 'up']);

    expect(VIEW_PRESETS.up.motion).toBe('relative');
    expect(VIEW_PRESETS.up.degrees).toBe(10);
    expect(VIEW_PRESETS.up.durationMs).toBe(3000);
    expect(VIEW_PRESETS.up.curve).toBe('smootherstep');
    expect(VIEW_PRESETS.up.label).toEqual({ zh: '上仰', en: 'Up' });

    expect(VIEW_PRESETS.down.motion).toBe('relative');
    expect(VIEW_PRESETS.down.degrees).toBe(-10);
    expect(VIEW_PRESETS.down.durationMs).toBe(3000);

    expect(VIEW_PRESETS.recenter.motion).toBe('absolute');
    expect(VIEW_PRESETS.recenter.degrees).toBe(0);
    expect(VIEW_PRESETS.recenter.durationMs).toBe(2400);

    expect(VIEW_PRESETS.breathe.motion).toBe('round-trip');
    expect(VIEW_PRESETS.breathe.degrees).toBe(6);
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
    expect(harness.controller.getTargetDeg()).toBe(14);

    harness.controller.update(1 / 60);
    expect(harness.controller.getPitchDeg()).toBeLessThan(4.05);

    harness.step(1.5 - 1 / 60);
    expect(harness.controller.getPitchDeg()).toBeCloseTo(9, 1);
    harness.step(1.6);
    expect(harness.controller.getPitchDeg()).toBeCloseTo(14, 6);
    expect(harness.controller.getStateName()).toBe('idle');
  });

  it('clamps relative up and down at the ±20° envelope', () => {
    const nearTop = createHarness();
    placeAt(nearTop.controller, 15);
    nearTop.controller.play('up');
    expect(nearTop.controller.getTargetDeg()).toBe(VIEW_PITCH_LIMIT_DEG);
    nearTop.step(3.1);
    expect(nearTop.controller.getPitchDeg()).toBe(VIEW_PITCH_LIMIT_DEG);

    const atTop = createHarness();
    placeAt(atTop.controller, VIEW_PITCH_LIMIT_DEG);
    expect(atTop.controller.play('up')).toBe(true);
    // Already at the clamp: no playback, no fake preset.
    expect(atTop.controller.getStateName()).toBe('idle');
    expect(atTop.controller.getPresetId()).toBeNull();
    atTop.step(1);
    expect(atTop.controller.getPitchDeg()).toBe(VIEW_PITCH_LIMIT_DEG);

    const nearBottom = createHarness();
    placeAt(nearBottom.controller, -15);
    nearBottom.controller.play('down');
    expect(nearBottom.controller.getTargetDeg()).toBe(-VIEW_PITCH_LIMIT_DEG);
    nearBottom.step(3.1);
    expect(nearBottom.controller.getPitchDeg()).toBe(-VIEW_PITCH_LIMIT_DEG);

    const middle = createHarness();
    placeAt(middle.controller, 6);
    middle.controller.play('down');
    middle.step(3.1);
    expect(middle.controller.getPitchDeg()).toBeCloseTo(-4, 6);
  });

  it('recenters to 0° with an animation, not a snap', () => {
    const harness = createHarness();
    placeAt(harness.controller, -12);
    expect(harness.controller.getPitchDeg()).toBeCloseTo(-12, 6);

    expect(harness.controller.play('recenter')).toBe(true);
    expect(harness.controller.getPresetId()).toBe('recenter');
    harness.controller.update(1 / 60);
    expect(harness.controller.getPitchDeg()).toBeGreaterThan(-12);
    expect(harness.controller.getPitchDeg()).toBeLessThan(-11.5);

    harness.step(VIEW_PRESETS.recenter.durationMs / 1000 + 0.1);
    expect(harness.controller.getPitchDeg()).toBeCloseTo(0, 6);
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
    expect(harness.controller.getPitchDeg()).toBeCloseTo(8, 1);
    harness.step(1.5);
    expect(harness.controller.getPitchDeg()).toBeCloseTo(11, 1);
    harness.step(3.1);
    expect(harness.controller.getPitchDeg()).toBeCloseTo(5, 6);
    expect(harness.controller.getStateName()).toBe('idle');
    expect(harness.controller.getPresetId()).toBeNull();
    expect(harness.controller.getTargetDeg()).toBe(5);
  });

  it('clamps the breathe excursion at the envelope and still returns home', () => {
    const harness = createHarness();
    placeAt(harness.controller, 18);
    harness.controller.play('breathe');
    harness.step(3);
    expect(harness.controller.getPitchDeg()).toBeCloseTo(VIEW_PITCH_LIMIT_DEG, 6);
    harness.step(3.1);
    expect(harness.controller.getPitchDeg()).toBeCloseTo(18, 6);
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
    const frozen = held.pitchDeg;
    harness.step(3);
    expect(harness.controller.getPitchDeg()).toBe(frozen);

    // A slider command is not a preset.
    expect(harness.controller.setTarget(2)).toBe(true);
    expect(harness.controller.getPresetId()).toBeNull();
    expect(harness.controller.getStateName()).toBe('playing');
    harness.step(5);
    expect(harness.controller.getPitchDeg()).toBeCloseTo(2, 6);
    expect(harness.controller.getStateName()).toBe('idle');
    expect(harness.controller.getPresetId()).toBeNull();
  });

  it('resumes a held preset from the current angle, not from zero', () => {
    const harness = createHarness();
    harness.controller.play('up');
    harness.step(1);
    const held = harness.controller.getPitchDeg();
    harness.controller.stop();
    harness.step(1);

    expect(harness.controller.play('up')).toBe(true);
    harness.step(3.1);
    // Relative semantics: one more +10 from where it froze.
    expect(harness.controller.getPitchDeg()).toBeCloseTo(held + 10, 6);
  });

  it('resets to idle at 0° without easing and clears the preset', () => {
    const harness = createHarness();
    harness.controller.play('breathe');
    harness.step(1);
    harness.controller.reset();
    expect(harness.controller.getStateName()).toBe('idle');
    expect(harness.controller.getPresetId()).toBeNull();
    expect(harness.controller.getPitchDeg()).toBe(0);
    expect(harness.controller.getTargetDeg()).toBe(0);
    expect(harness.last()).toBe(0);
  });

  it('retargets the slider from the current angle without a snap', () => {
    const harness = createHarness();
    expect(harness.controller.setTarget(VIEW_PITCH_LIMIT_DEG)).toBe(true);
    expect(harness.controller.getStateName()).toBe('playing');

    harness.step(0.5);
    const midpoint = harness.controller.getPitchDeg();
    expect(midpoint).toBeGreaterThan(0);
    expect(midpoint).toBeLessThan(VIEW_PITCH_LIMIT_DEG);

    // Reverse mid-flight: the next frame must move by a bounded step only.
    expect(harness.controller.setTarget(-VIEW_PITCH_LIMIT_DEG)).toBe(true);
    const before = harness.controller.getPitchDeg();
    harness.controller.update(1 / 60);
    expect(Math.abs(harness.controller.getPitchDeg() - before)).toBeLessThanOrEqual(
      VIEW_TRACK_MAX_DEG_PER_S / 60 + 1e-9
    );

    harness.step(20);
    expect(harness.controller.getPitchDeg()).toBeCloseTo(-VIEW_PITCH_LIMIT_DEG, 6);
    expect(harness.controller.getStateName()).toBe('idle');
  });

  it('rejects out-of-envelope, non-finite and unknown input whole', () => {
    const harness = createHarness();
    expect(harness.controller.setTarget(20.5)).toBe(false);
    expect(harness.controller.setTarget(-21)).toBe(false);
    expect(harness.controller.setTarget(Number.NaN)).toBe(false);
    expect(harness.controller.play('')).toBe(false);
    expect(harness.controller.getStateName()).toBe('idle');
    expect(harness.controller.getTargetDeg()).toBe(0);

    expect(harness.controller.setTarget(VIEW_PITCH_LIMIT_DEG)).toBe(true);
    expect(harness.controller.getTargetDeg()).toBe(VIEW_PITCH_LIMIT_DEG);
  });

  it('writes state into a caller object so snapshotting does not allocate', () => {
    const harness = createHarness();
    const out = { state: 'idle' as const, pitchDeg: 0, targetDeg: 0, preset: null };
    const result = harness.controller.getState(out);
    expect(result).toBe(out);
    expect(out.state).toBe('idle');
    expect(out.preset).toBeNull();
  });
});
