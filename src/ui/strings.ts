export interface Strings {
  entering: string;
  checking: string;
  xrFailed: string;

  sessionEnded: string;
  enterFailed: string;
  skippedCalibration: string;
  recalibrateNeedsSession: string;
  modeIdle: string;
  modePreview: string;
  dwellHint: string;
  remoteUnknown: string;
  controlModeOn: string;
  controlModeOff: string;
  /** Shown while the tablet is gone and the five-second grace runs. */
  linkLostGrace: string;
  /** Shown when that grace expired and the session was unwound. */
  linkLostExit: string;
}

export const ZH: Strings = {
  entering: '正在进入场景',
  checking: '正在检测设备',
  xrFailed: '设备检测失败，请重试',

  sessionEnded: '训练已结束',
  enterFailed: '进入失败，请再按一次',
  skippedCalibration: '已跳过记录',
  recalibrateNeedsSession: '请在体验中重新记录体位',
  modeIdle: '待机',
  modePreview: '预览',
  dwellHint: '保持注视，即可选择',
  remoteUnknown: '未知蓝牙命令',
  controlModeOn: '平板控制中',
  controlModeOff: '平板已断开，等待重连',
  linkLostGrace: '连接中断，5 秒内未重连将退出',
  linkLostExit: '与平板断开，已退出画面'
};

export const EN: Strings = {
  entering: 'Entering VR',
  checking: 'Checking device…',
  xrFailed: 'Device check failed. Try again.',

  sessionEnded: 'Training ended',
  enterFailed: 'Could not start. Press again.',
  skippedCalibration: 'Recording skipped',
  recalibrateNeedsSession: 'Recalibrate during the session',
  modeIdle: 'Idle',
  modePreview: 'Preview',
  dwellHint: 'Keep looking to select',
  remoteUnknown: 'Unknown Bluetooth command',
  controlModeOn: 'Tablet in control',
  controlModeOff: 'Tablet disconnected, waiting to reconnect',
  linkLostGrace: 'Connection lost. Exiting in 5 s unless it returns',
  linkLostExit: 'Disconnected from the tablet; scene closed'
};

export function getStrings(lang: 'zh' | 'en'): Strings {
  return lang === 'en' ? EN : ZH;
}
