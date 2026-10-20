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
  sceneSelected: string;
  sceneSelectedStatus: string;
  sceneSwitchBlocked: string;
  operator: string;
  debug: string;
  lab: string;
  audioOn: string;
  audioOff: string;
  recalibrate: string;
  exit: string;
  menuTitle: string;
  menuContinue: string;
  menuRecalibrate: string;
  menuAudio: string;
  menuExit: string;
  calibrationCeiling: string;
  calibrationToes: string;
  calibrationHold: string;
  calibrationStable: string;
  calibrationRecording: string;
  calibrationDone: string;
  calibrationFailed: string;
  sessionEnded: string;
  enterFailed: string;
  skippedCalibration: string;
  recalibrateNeedsSession: string;
  waitingHead: string;
  labTitle: string;
  labSummoned: string;
  labHeadLocked: string;
  labWorldLocked: string;
  labBillboard: string;
  close: string;
  modeIdle: string;
  modePreview: string;
  modeXR: string;
  hudCalibration: string;
  hudFps: string;
  hudSelect: string;
  hudQuality: string;
  hudAudio: string;
  hudTriangles: string;
  hudDrawCalls: string;
  remoteStartNeedsGesture: string;
  remoteUnknown: string;
  controlModeOn: string;
  controlModeOff: string;
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
  sceneSelected: '已选',
  sceneSelectedStatus: '已选择：',
  sceneSwitchBlocked: '请先退出 VR 会话再切换场景',
  operator: '操作员',
  debug: '显示诊断信息',
  lab: '空间 UI 实验',
  audioOn: '声音: 开',
  audioOff: '声音: 关',
  recalibrate: '重新校准',
  exit: '退出',
  menuTitle: '菜单',
  menuContinue: '继续训练',
  menuRecalibrate: '重新校准',
  menuAudio: '声音开关',
  menuExit: '结束训练',
  calibrationCeiling: '① 看向天花板',
  calibrationToes: '② 看向脚尖方向',
  calibrationHold: '保持不动，等待记录',
  calibrationStable: '很好，保持住…',
  calibrationRecording: '正在记录',
  calibrationDone: '校准完成，慢慢看向场景',
  calibrationFailed: '方向校准失败',
  sessionEnded: '训练已结束',
  enterFailed: '进入失败，请重试',
  skippedCalibration: '已跳过方向校准',
  recalibrateNeedsSession: '请在训练中重新校准',
  waitingHead: '等待头显姿态…',
  labTitle: '空间 UI 实验',
  labSummoned: '召唤后锁定',
  labHeadLocked: '跟随视角',
  labWorldLocked: '锁定世界',
  labBillboard: '世界 + 朝向用户',
  close: '关闭',
  modeIdle: '待机',
  modePreview: '2D 预览',
  modeXR: 'WebXR',
  hudCalibration: '校准',
  hudFps: 'FPS',
  hudSelect: '注视选择',
  hudQuality: '画质',
  hudAudio: '声音',
  hudTriangles: '三角面',
  hudDrawCalls: 'Draw call',
  remoteStartNeedsGesture: '请在头显内启动一次，之后由平板控制',
  remoteUnknown: '未知蓝牙命令',
  controlModeOn: '平板控制中，患者无需操作',
  controlModeOff: '平板已断开，恢复患者界面'
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
  sceneSelected: 'Selected',
  sceneSelectedStatus: 'Selected: ',
  sceneSwitchBlocked: 'Exit the VR session before switching scenes',
  operator: 'Operator',
  debug: 'Show diagnostics',
  lab: 'Spatial UI lab',
  audioOn: 'Sound: on',
  audioOff: 'Sound: off',
  recalibrate: 'Recalibrate',
  exit: 'Exit',
  menuTitle: 'Menu',
  menuContinue: 'Continue training',
  menuRecalibrate: 'Recalibrate',
  menuAudio: 'Toggle sound',
  menuExit: 'End training',
  calibrationCeiling: '① Look at the ceiling',
  calibrationToes: '② Look toward your toes',
  calibrationHold: 'Hold still until recorded',
  calibrationStable: 'Good, keep still…',
  calibrationRecording: 'Recording',
  calibrationDone: 'Calibration complete. Look at the scene.',
  calibrationFailed: 'Direction calibration failed',
  sessionEnded: 'Training ended',
  enterFailed: 'Could not start. Try again.',
  skippedCalibration: 'Direction calibration skipped',
  recalibrateNeedsSession: 'Recalibrate during training',
  waitingHead: 'Waiting for head pose…',
  labTitle: 'Spatial UI lab',
  labSummoned: 'Summoned, then locked',
  labHeadLocked: 'Head-locked',
  labWorldLocked: 'World-locked',
  labBillboard: 'World + billboard',
  close: 'Close',
  modeIdle: 'Idle',
  modePreview: '2D preview',
  modeXR: 'WebXR',
  hudCalibration: 'Calibration',
  hudFps: 'FPS',
  hudSelect: 'Selections',
  hudQuality: 'Quality',
  hudAudio: 'Sound',
  hudTriangles: 'Triangles',
  hudDrawCalls: 'Draw calls',
  remoteStartNeedsGesture: 'Start once in the headset; the tablet controls after that',
  remoteUnknown: 'Unknown Bluetooth command',
  controlModeOn: 'Tablet control on, no patient input needed',
  controlModeOff: 'Tablet disconnected, patient UI restored'
};

export function getStrings(lang: 'zh' | 'en'): Strings {
  return lang === 'en' ? EN : ZH;
}
