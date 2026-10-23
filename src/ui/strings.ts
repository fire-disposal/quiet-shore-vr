export interface Strings {
  appName: string;
  appNameEn: string;
  enter: string;
  entering: string;
  preview: string;
  checking: string;
  xrReady: string;
  noXR: string;
  xrUnsupported: string;
  xrFailed: string;
  sceneTitle: string;
  sceneHint: string;
  operator: string;
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
  hudSelect: string;
  dwellHint: string;
  hudQuality: string;
  hudAudio: string;
  hudTriangles: string;
  hudDrawCalls: string;
  remoteStartNeedsGesture: string;
  remoteUnknown: string;
  controlModeOn: string;
  controlModeOff: string;
  patientStop: string;
}

export const ZH: Strings = {
  appName: '静岸',
  appNameEn: 'Quiet Shore VR',
  enter: '开始训练',
  entering: '正在进入 VR',
  preview: '2D 预览',
  checking: '正在检测设备…',
  xrReady: '设备已就绪，戴上头显开始',
  noXR: '请用 Firefox Reality 打开本页',
  xrUnsupported: '当前浏览器不支持沉浸模式，请用 Firefox Reality',
  xrFailed: '设备检测失败，请重试',
  sceneTitle: '场景',
  sceneHint: '可稍后切换',
  operator: '操作员',
  debug: '显示诊断信息',

  recalibrate: '重新校准',
  exit: '退出',
  calibrationDone: '校准完成，慢慢看向场景',
  calibrationFailed: '方向校准失败',
  sessionEnded: '训练已结束',
  enterFailed: '进入失败，请重试',
  skippedCalibration: '已跳过方向校准',
  recalibrateNeedsSession: '请在训练中重新校准',
  close: '关闭',
  modeIdle: '待机',
  modePreview: '2D 预览',
  modeXR: 'WebXR',
  hudCalibration: '校准',
  hudFps: 'FPS',
  hudSelect: '注视选择',
  dwellHint: '保持注视 6 秒以选择',
  hudQuality: '画质',
  hudAudio: '声音',
  hudTriangles: '三角面',
  hudDrawCalls: 'Draw call',
  remoteStartNeedsGesture: '请在头显内启动一次，之后由平板控制',
  remoteUnknown: '未知蓝牙命令',
  controlModeOn: '平板控制中，按一次确认键开始',
  controlModeOff: '平板已断开，恢复患者界面',
  patientStop: '已由患者停止训练'
};

export const EN: Strings = {
  appName: 'Quiet Shore',
  appNameEn: 'Quiet Shore VR',
  enter: 'Start training',
  entering: 'Entering VR',
  preview: '2D preview',
  checking: 'Checking device…',
  xrReady: 'Ready, put on the headset and start',
  noXR: 'Open this page in Firefox Reality',
  xrUnsupported: 'Immersive mode is not available in this browser. Use Firefox Reality.',
  xrFailed: 'Device check failed. Try again.',
  sceneTitle: 'Scenes',
  sceneHint: 'Can switch later',
  operator: 'Operator',
  debug: 'Show diagnostics',

  recalibrate: 'Recalibrate',
  exit: 'Exit',
  calibrationDone: 'Calibration complete. Look at the scene.',
  calibrationFailed: 'Direction calibration failed',
  sessionEnded: 'Training ended',
  enterFailed: 'Could not start. Try again.',
  skippedCalibration: 'Direction calibration skipped',
  recalibrateNeedsSession: 'Recalibrate during training',
  close: 'Close',
  modeIdle: 'Idle',
  modePreview: '2D preview',
  modeXR: 'WebXR',
  hudCalibration: 'Calibration',
  hudFps: 'FPS',
  hudSelect: 'Selections',
  dwellHint: 'Keep looking for 6 s to select',
  hudQuality: 'Quality',
  hudAudio: 'Sound',
  hudTriangles: 'Triangles',
  hudDrawCalls: 'Draw calls',
  remoteStartNeedsGesture: 'Start once in the headset; the tablet controls after that',
  remoteUnknown: 'Unknown Bluetooth command',
  controlModeOn: 'Tablet control on, press confirm once to start',
  controlModeOff: 'Tablet disconnected, patient UI restored',
  patientStop: 'Session stopped by patient'
};

export function getStrings(lang: 'zh' | 'en'): Strings {
  return lang === 'en' ? EN : ZH;
}
