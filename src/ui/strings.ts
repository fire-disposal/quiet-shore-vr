export interface Strings {
  appName: string;
  appNameEn: string;
  entering: string;
  checking: string;
  xrReady: string;
  xrFailed: string;
  sceneTitle: string;
  debug: string;

  recalibrate: string;
  exit: string;
  calibrationDone: string;
  calibrationFailed: string;
  sessionEnded: string;
  enterFailed: string;
  skippedCalibration: string;
  recalibrateNeedsSession: string;
  close: string;
  modeIdle: string;
  modePreview: string;
  modeXR: string;
  hudCalibration: string;
  hudFps: string;
  dwellHint: string;
  hudQuality: string;
  hudAudio: string;
  hudTriangles: string;
  hudDrawCalls: string;
  remoteStartNeedsGesture: string;
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
  appName: '静岸',
  appNameEn: 'Quiet Shore VR',
  entering: '正在进入场景',
  checking: '正在检测设备',
  xrReady: '设备已就绪',
  xrFailed: '设备检测失败，请重试',
  sceneTitle: '场景',
  debug: '显示诊断信息',

  recalibrate: '重新校准',
  exit: '退出',
  calibrationDone: '已记录，请看向场景',
  calibrationFailed: '记录失败，请重试',
  sessionEnded: '训练已结束',
  enterFailed: '进入失败，请再按一次',
  skippedCalibration: '已跳过记录',
  recalibrateNeedsSession: '请在体验中重新记录体位',
  close: '关闭',
  modeIdle: '待机',
  modePreview: '预览',
  modeXR: '头显',
  hudCalibration: '体位',
  hudFps: '帧率',
  dwellHint: '保持注视，即可选择',
  hudQuality: '画质',
  hudAudio: '声音',
  hudTriangles: '面数',
  hudDrawCalls: '批次',
  remoteStartNeedsGesture: '请在头显内启动一次，之后由平板控制',
  remoteUnknown: '未知蓝牙命令',
  controlModeOn: '平板控制中，按一次确认键开始',
  controlModeOff: '平板已断开，恢复患者界面',
  linkLostGrace: '连接中断，5 秒后退出',
  linkLostExit: '与平板断开，已退出画面',
  patientStop: '已由患者停止训练'
};

export const EN: Strings = {
  appName: 'Quiet Shore',
  appNameEn: 'Quiet Shore VR',
  entering: 'Entering VR',
  checking: 'Checking device…',
  xrReady: 'Ready, put on the headset and start',
  xrFailed: 'Device check failed. Try again.',
  sceneTitle: 'Scenes',
  debug: 'Show diagnostics',

  recalibrate: 'Recalibrate',
  exit: 'Exit',
  calibrationDone: 'Recorded. Look at the scene.',
  calibrationFailed: 'Recording failed. Try again.',
  sessionEnded: 'Training ended',
  enterFailed: 'Could not start. Press again.',
  skippedCalibration: 'Recording skipped',
  recalibrateNeedsSession: 'Recalibrate during the session',
  close: 'Close',
  modeIdle: 'Idle',
  modePreview: 'Preview',
  modeXR: 'Headset',
  hudCalibration: 'Posture',
  hudFps: 'FPS',
  dwellHint: 'Keep looking to select',
  hudQuality: 'Quality',
  hudAudio: 'Sound',
  hudTriangles: 'Tris',
  hudDrawCalls: 'Batches',
  remoteStartNeedsGesture: 'Start once in the headset; the tablet controls after that',
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
