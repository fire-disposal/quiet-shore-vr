/**
 * Units at the wire boundary.
 *
 * The state frame, the JSON snapshot and the mirror's input are three different
 * unit spaces (metres, centimetres, degrees, radians), and mixing them has
 * shipped before: a translation sent in cm and read as m moved the mirror by
 * 100×, and a pitch read as radians pointed the view at the floor. Branding the
 * boundary turns each of those into a type error.
 *
 * Inside the renderer everything stays a plain `number` in three's own units;
 * the brands live where data crosses a boundary.
 */

declare const unit: unique symbol;

export type Metres = number & { readonly [unit]: 'm' };
export type Centimetres = number & { readonly [unit]: 'cm' };
export type Degrees = number & { readonly [unit]: 'deg' };
export type Radians = number & { readonly [unit]: 'rad' };
/** The posture scalar: 0 = lying with the real ceiling, 1 = standing. */
export type Mix01 = number & { readonly [unit]: 'mix' };

export const metres = (value: number): Metres => value as Metres;
export const centimetres = (value: number): Centimetres => value as Centimetres;
export const degrees = (value: number): Degrees => value as Degrees;
export const radians = (value: number): Radians => value as Radians;

/** Clamps (and rejects NaN) into the posture scalar's domain. */
export function mix01(value: number): Mix01 {
  if (!Number.isFinite(value)) {
    return 0 as Mix01;
  }
  return (value < 0 ? 0 : value > 1 ? 1 : value) as Mix01;
}

/** Degrees to radians, the one conversion the mirror needs. */
export const degToRad = (value: Degrees): Radians => ((value * Math.PI) / 180) as Radians;

export interface Vec3<T = number> {
  readonly x: T;
  readonly y: T;
  readonly z: T;
}

export interface Quat {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly w: number;
}

/** Quaternion without `w`: the frame sends three components, `w` is derived. */
export type QuatXyz = Readonly<Omit<Quat, 'w'>>;
