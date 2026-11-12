import { optional } from './dom';

/**
 * The button's position, drawn twice: the headset's right side, and the
 * controller in the patient's hand.
 *
 * ```text
 *   (⌐▭▭⌐)  ●        (o)        these are the same press
 *                       |
 * ```
 *
 * The geometry is frozen. It is not a scale drawing of a product and must not
 * start following one: the numbers are the entry sentence's argument, and they
 * were settled against the real device once. Nothing here reads state — the
 * whole block is `aria-hidden` and quieted by a disabled target through CSS,
 * so it can never become a second thing to act on.
 */
export class DevicePictogram {
  private readonly node: HTMLElement | null = optional<HTMLElement>('controller-guide');

  /** Present so the entry screen can hide it where a build ships no art. */
  exists(): boolean {
    return this.node !== null;
  }
}
