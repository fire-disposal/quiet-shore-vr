import {
  FLOAT_MAX_LEVEL,
  isFloatProfileId,
  type FloatProfileId
} from '../core/xr/float';
import { isViewPresetId, type ViewPresetId } from '../core/xr/view-motion';
import { parseViewOrient } from './view-command';
import { EYE_HEIGHT_MAX, EYE_HEIGHT_MIN } from './config';
import { SUS_ITEMS } from './sus';

/**
 * The remote command grammar, as data.
 *
 * Tablet → page is a flat string channel over WebSocket: `scene:shore`,
 * `float:level:2`, `view:orient:0,12`. While this lived inside the app it read
 * as one 330-line function with the validation, the status text and the side
 * effects interleaved. Here the string becomes a typed command or an error, and
 * nothing else; `App` decides what each kind does. Every rule below is
 * therefore testable without a DOM, an XR session or a socket.
 */

export type RemoteCommand =
  | { kind: 'eyeHeight'; meters: number }
  | { kind: 'viewOrient'; lookYawDeg: number; upGazeDeg: number }
  | { kind: 'viewAnim'; name: ViewPresetId }
  | { kind: 'viewStop' }
  | { kind: 'scene'; id: string }
  | { kind: 'mode'; mode: 'float' | 'posture' }
  | { kind: 'voice'; command: string }
  | { kind: 'floatLevel'; level: number }
  | { kind: 'floatProfile'; id: FloatProfileId }
  | { kind: 'floatBreath'; on: boolean }
  | { kind: 'riseDuration'; ms: number }
  | { kind: 'cueIntensity'; value: number }
  | { kind: 'gazeDwell'; on: boolean }
  | { kind: 'susOpen' }
  | { kind: 'susClose' }
  | { kind: 'susShow'; index: number }
  | { kind: 'susMove'; delta: 1 | -1 }
  | { kind: 'susAnswer'; value: number }
  | { kind: 'preview' }
  | { kind: 'calibrate' }
  | { kind: 'exit' }
  | { kind: 'audio'; state: 'on' | 'off' | 'toggle' }
  | { kind: 'posture'; target: 'rise' | 'lower' | 'stop' }
  | { kind: 'cue'; on: boolean }
  | { kind: 'status' }
  | { kind: 'start' }
  /** Recognised prefix, invalid payload; the message is operator-facing. */
  | { kind: 'invalid'; message: string }
  | { kind: 'unknown' };

/** Strict wire form for `settings:eyeheight:<m>`: no sign, exponent or padding. */
export const EYE_HEIGHT_ARG = /^1\.\d{1,3}$/;
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

  if (command.startsWith('settings:eyeheight:')) {
    return parseEyeHeight(command.slice('settings:eyeheight:'.length));
  }
  if (command.startsWith('view:orient:')) {
    const payload = command.slice('view:orient:'.length);
    const target = parseViewOrient(payload);
    return target
      ? { kind: 'viewOrient', lookYawDeg: target.lookYawDeg, upGazeDeg: target.upGazeDeg }
      : { kind: 'invalid', message: `视角参数无效：${payload}` };
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
  if (command.startsWith('mode:')) {
    const payload = command.slice('mode:'.length);
    return payload === 'float' || payload === 'posture'
      ? { kind: 'mode', mode: payload }
      : { kind: 'invalid', message: '未知模式' };
  }
  if (command.startsWith('voice:')) {
    return { kind: 'voice', command };
  }
  if (command.startsWith('float:level:')) {
    const payload = command.slice('float:level:'.length);
    const level = Number(payload);
    return Number.isInteger(level) && level >= 0 && level <= FLOAT_MAX_LEVEL
      ? { kind: 'floatLevel', level }
      : { kind: 'invalid', message: '漂浮强度无效' };
  }
  if (command.startsWith('float:profile:')) {
    const payload = command.slice('float:profile:'.length);
    return isFloatProfileId(payload)
      ? { kind: 'floatProfile', id: payload }
      : { kind: 'invalid', message: '未知漂浮档位' };
  }
  if (command === 'float:breath:on' || command === 'float:breath:off') {
    return { kind: 'floatBreath', on: command.endsWith(':on') };
  }
  if (command.startsWith('anim:duration:')) {
    const payload = command.slice('anim:duration:'.length);
    const ms = Number(payload);
    return Number.isFinite(ms) && ms >= RISE_MS_MIN && ms <= RISE_MS_MAX
      ? { kind: 'riseDuration', ms: Math.round(ms) }
      : { kind: 'invalid', message: '时长超出范围' };
  }
  if (command.startsWith('cue:intensity:')) {
    const payload = command.slice('cue:intensity:'.length);
    // Same decimal grammar as the Kotlin allowlist: no exponents, no padding.
    const value = /^-?\d+(?:\.\d+)?$/.test(payload) ? Number(payload) : Number.NaN;
    return Number.isFinite(value) && value >= 0 && value <= 1
      ? { kind: 'cueIntensity', value }
      : { kind: 'invalid', message: '提示强度无效' };
  }
  if (command === 'gaze:dwell:on' || command === 'gaze:dwell:off') {
    return { kind: 'gazeDwell', on: command.endsWith(':on') };
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
  if (command === 'sus:next' || command === 'sus:prev') {
    return { kind: 'susMove', delta: command === 'sus:next' ? 1 : -1 };
  }
  if (command.startsWith('sus:answer:')) {
    // Exactly one digit: "sus:answer:01" is a malformed frame, not a 1.
    const payload = command.slice('sus:answer:'.length);
    return /^[1-5]$/.test(payload)
      ? { kind: 'susAnswer', value: Number(payload) }
      : { kind: 'invalid', message: 'SUS 分值无效' };
  }

  switch (command) {
    case 'preview':
      return { kind: 'preview' };
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
    case 'cue:on':
      return { kind: 'cue', on: true };
    case 'cue:off':
      return { kind: 'cue', on: false };
    case 'status':
      return { kind: 'status' };
    case 'start':
      return { kind: 'start' };
    default:
      return { kind: 'unknown' };
  }
}

function parseEyeHeight(payload: string): RemoteCommand {
  if (!EYE_HEIGHT_ARG.test(payload)) {
    return { kind: 'invalid', message: `视点高度无效：${payload}` };
  }
  const meters = Number(payload);
  if (!Number.isFinite(meters) || meters < EYE_HEIGHT_MIN || meters > EYE_HEIGHT_MAX) {
    return { kind: 'invalid', message: `视点高度无效：${payload}` };
  }
  return { kind: 'eyeHeight', meters };
}
