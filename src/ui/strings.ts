export interface Strings {
  entering: string;
  checking: string;
  xrFailed: string;

  recalibrate: string;
  sessionEnded: string;
  enterFailed: string;
  skippedCalibration: string;
  recalibrateNeedsSession: string;
  close: string;
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
  patientStop: string;
}

export const ZH: Strings = {
  entering: '正在进入场景',
  checking: '正在检测设备',
  xrFailed: '设备检测失败，请重试',

  recalibrate: '重新校准',
  sessionEnded: '训练已结束',
  enterFailed: '进入失败，请再按一次',
  skippedCalibration: '已跳过记录',
  recalibrateNeedsSession: '请在体验中重新记录体位',
  close: '关闭',
  modeIdle: '待机',
  modePreview: '预览',
  dwellHint: '保持注视，即可选择',
  remoteUnknown: '未知蓝牙命令',
  controlModeOn: '平板控制中，按一次确认键开始',
  controlModeOff: '平板已断开，恢复患者界面',
  linkLostGrace: '连接中断，5 秒后退出',
  linkLostExit: '与平板断开，已退出画面',
  patientStop: '已由患者停止训练'
};

export const EN: Strings = {
  entering: 'Entering VR',
  checking: 'Checking device…',
  xrFailed: 'Device check failed. Try again.',

  recalibrate: 'Recalibrate',
  sessionEnded: 'Training ended',
  enterFailed: 'Could not start. Press again.',
  skippedCalibration: 'Recording skipped',
  recalibrateNeedsSession: 'Recalibrate during the session',
  close: 'Close',
  modeIdle: 'Idle',
  modePreview: 'Preview',
  dwellHint: 'Keep looking to select',
  remoteUnknown: 'Unknown Bluetooth command',
  controlModeOn: 'Tablet control on, press confirm once to start',
  controlModeOff: 'Tablet disconnected, patient UI restored',
  linkLostGrace: 'Connection lost. Exiting in 5 s',
  linkLostExit: 'Disconnected from the tablet; scene closed',
  patientStop: 'Session stopped by patient'
};

export function getStrings(lang: 'zh' | 'en'): Strings {
  return lang === 'en' ? EN : ZH;
}
