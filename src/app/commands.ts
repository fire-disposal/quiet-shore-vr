import { isViewPresetId, type ViewPresetId } from '../core/xr/view-motion';
import { SUS_ITEMS } from './sus';

/**
 * The remote command grammar, as data.
 *
 * Tablet → page is a flat string channel over WebSocket: `scene:shore`,
 * `float:level:60`, `posture:mix:37`. While this lived inside the app it read
 * as one 330-line function with the validation, the status text and the side
 * effects interleaved. Here the string becomes a typed command or an error, and
 * nothing else; `App` decides what each kind does. Every rule below is
 * therefore testable without a DOM, an XR session or a socket.
 */

export type RemoteCommand =
  | { kind: 'viewAnim'; name: ViewPresetId }
  | { kind: 'viewStop' }
  | { kind: 'scene'; id: string }
  | { kind: 'voice'; command: string }
  /** `float:level:<0-100>`: the heave as a percentage of the envelope. */
  | { kind: 'floatLevel'; percent: number }
  /** `float:breath:on|off`: the organic texture on the heave. */
  | { kind: 'floatBreath'; on: boolean }
  | { kind: 'riseDuration'; ms: number }
  | { kind: 'gazeDwell'; on: boolean }
  | { kind: 'susOpen' }
  | { kind: 'susClose' }
  | { kind: 'susShow'; index: number }
  | { kind: 'susAnswer'; value: number }
  | { kind: 'susVoice'; on: boolean }
  | { kind: 'calibrate' }
  | { kind: 'exit' }
  | { kind: 'audio'; state: 'on' | 'off' | 'toggle' }
  | { kind: 'audioVolume'; percent: number }
  | { kind: 'posture'; target: 'rise' | 'lower' | 'stop' }
  | { kind: 'postureMix'; percent: number }
  /** Recognised prefix, invalid payload; the message is operator-facing. */
  | { kind: 'invalid'; message: string }
  | { kind: 'unknown' };

/**
 * Strict wire form for `posture:mix:<0-100>`: whole percent only. `07`, `1.5`,
 * `101` and `-1` are rejected whole — a value the page would clamp is a value
 * the tablet should never have sent.
 */
export const POSTURE_MIX_ARG = /^(?:100|[1-9]?\d)$/;
/** Operator-selectable ramp range, in milliseconds. */
export const RISE_MS_MIN = 4000;
export const RISE_MS_MAX = 20000;

/**
 * Parse one command. Returns `null` for blank input (nothing to report) and
 * `{kind:'unknown'}` for an unrecognised command, so the caller can choose its
 * own wording.
 */
export function parseRemoteCommand(raw: string): RemoteCommand | null {
  const command = raw.trim().toLowerCase();
  if (!command) {
    return null;
  }

  if (command.startsWith('posture:mix:')) {
    const payload = command.slice('posture:mix:'.length);
    if (!POSTURE_MIX_ARG.test(payload)) {
      return { kind: 'invalid', message: `体位比例无效：${payload}` };
    }
    return { kind: 'postureMix', percent: Number(payload) };
  }
  if (command.startsWith('view:anim:')) {
    const payload = command.slice('view:anim:'.length);
    return isViewPresetId(payload)
      ? { kind: 'viewAnim', name: payload }
      : { kind: 'invalid', message: `未知视角动画：${payload}` };
  }
  if (command === 'view:stop') {
    return { kind: 'viewStop' };
  }
  if (command.startsWith('scene:')) {
    return { kind: 'scene', id: command.slice('scene:'.length) };
  }
  if (command.startsWith('audio:volume:')) {
    const percent = Number(command.slice('audio:volume:'.length));
    return Number.isInteger(percent) && percent >= 0 && percent <= 100
      ? { kind: 'audioVolume', percent }
      : { kind: 'invalid', message: '水声音量无效' };
  }
  if (command.startsWith('voice:')) {
    return { kind: 'voice', command };
  }
  if (command === 'float:breath:on' || command === 'float:breath:off') {
    return { kind: 'floatBreath', on: command.endsWith(':on') };
  }
  if (command.startsWith('float:level:')) {
    const payload = command.slice('float:level:'.length);
    const percent = Number(payload);
    return Number.isInteger(percent) && percent >= 0 && percent <= 100
      ? { kind: 'floatLevel', percent }
      : { kind: 'invalid', message: '漂浮强度无效' };
  }
  if (command.startsWith('anim:duration:')) {
    const payload = command.slice('anim:duration:'.length);
    const ms = Number(payload);
    return Number.isFinite(ms) && ms >= RISE_MS_MIN && ms <= RISE_MS_MAX
      ? { kind: 'riseDuration', ms: Math.round(ms) }
      : { kind: 'invalid', message: '时长超出范围' };
  }
  if (command === 'gaze:dwell:on' || command === 'gaze:dwell:off') {
    return { kind: 'gazeDwell', on: command.endsWith(':on') };
  }
  if (command === 'sus:voice:on' || command === 'sus:voice:off') {
    return { kind: 'susVoice', on: command.endsWith(':on') };
  }
  if (command === 'sus:open') {
    return { kind: 'susOpen' };
  }
  if (command === 'sus:close') {
    return { kind: 'susClose' };
  }
  if (command.startsWith('sus:show:')) {
    // 1..10, the shipped item count; the headset's allowlist uses the same range.
    const index = Number(command.slice('sus:show:'.length));
    return Number.isInteger(index) && index >= 1 && index <= SUS_ITEMS
      ? { kind: 'susShow', index }
      : { kind: 'invalid', message: 'SUS 题号无效' };
  }
  if (command.startsWith('sus:answer:')) {
    // Exactly one digit: "sus:answer:01" is a malformed frame, not a 1.
    const payload = command.slice('sus:answer:'.length);
    return /^[1-5]$/.test(payload)
      ? { kind: 'susAnswer', value: Number(payload) }
      : { kind: 'invalid', message: 'SUS 分值无效' };
  }

  switch (command) {
    case 'calibrate':
      return { kind: 'calibrate' };
    case 'exit':
    case 'stop':
      return { kind: 'exit' };
    case 'audio:on':
      return { kind: 'audio', state: 'on' };
    case 'audio:off':
      return { kind: 'audio', state: 'off' };
    case 'audio:toggle':
      return { kind: 'audio', state: 'toggle' };
    case 'posture:rise':
      return { kind: 'posture', target: 'rise' };
    case 'posture:lower':
      return { kind: 'posture', target: 'lower' };
    case 'posture:stop':
      return { kind: 'posture', target: 'stop' };
    default:
      return { kind: 'unknown' };
  }
}
