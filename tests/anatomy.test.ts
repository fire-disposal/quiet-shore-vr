import { describe, expect, it } from 'vitest';
import {
  MATTRESS_TOP_M,
  PILLOW_LIFT_M,
  SUPINE_EYE_ABOVE_SUPPORT_M,
  WATER_EYE_M,
  eyeYAt,
  lyingEyeY,
  type ScenePosture
} from '../src/core/anatomy';

const bed: ScenePosture = { standingEyeY: 1.7, supine: 'mattress' };
const bedWithPillow: ScenePosture = { standingEyeY: 1.7, supine: 'mattress', pillow: true };
const water: ScenePosture = { standingEyeY: 1.7, supine: 'water' };

describe('anatomy', () => {
  it('derives the lying eye from the support, never from a typed number', () => {
    expect(lyingEyeY(bed)).toBeCloseTo(MATTRESS_TOP_M + SUPINE_EYE_ABOVE_SUPPORT_M, 6);
    expect(lyingEyeY(bedWithPillow)).toBeCloseTo(lyingEyeY(bed) + PILLOW_LIFT_M, 6);
    expect(lyingEyeY(water)).toBeCloseTo(WATER_EYE_M, 6);
    // A body lying on a bed is far above one floating on its back.
    expect(lyingEyeY(bed)).toBeGreaterThan(lyingEyeY(water));
  });

  it('interpolates the eye between lying and standing with the mix', () => {
    expect(eyeYAt(bed, 0)).toBeCloseTo(0.66, 2);
    expect(eyeYAt(bed, 1)).toBeCloseTo(1.7, 6);
    expect(eyeYAt(bed, 0.5)).toBeCloseTo((0.66 + 1.7) / 2, 2);
    // Out-of-range and non-finite mixes clamp instead of throwing the eye away.
    expect(eyeYAt(bed, -3)).toBeCloseTo(0.66, 2);
    expect(eyeYAt(bed, 9)).toBeCloseTo(1.7, 6);
    expect(eyeYAt(bed, Number.NaN)).toBeCloseTo(0.66, 2);
  });

  it('never lets a scene stand below its own lying height', () => {
    // A scene whose art is drawn from lower than the bed would make the rise
    // push the patient down; the scenes must keep standing above lying.
    for (const posture of [bed, bedWithPillow, water]) {
      expect(eyeYAt(posture, 1)).toBeGreaterThan(eyeYAt(posture, 0));
    }
  });
});
