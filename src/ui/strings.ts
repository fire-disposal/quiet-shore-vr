export interface Strings {
  appName: string;
  appNameEn: string;
  enter: string;
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
}

export const ZH: Strings = {
  appName: '静岸',
  appNameEn: 'Quiet Shore VR',
  enter: '进入训练',
  preview: '2D 预览',
  checking: '正在检测设备…',
  xrReady: 'WebXR 可用',
  noXR: '此浏览器没有 WebXR，请使用 Firefox Reality',
  xrUnsupported: '此浏览器不支持 immersive-vr',
  xrFailed: 'WebXR 检测失败',
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
  menuContinue: '继续',
  menuRecalibrate: '重新校准',
  menuAudio: '声音开关',
  menuExit: '退出训练',
  calibrationCeiling: '看向天花板',
  calibrationToes: '看向脚尖方向',
  calibrationHold: '请保持不动',
  calibrationStable: '稳定中…',
  calibrationRecording: '记录中',
  calibrationDone: '方向校准完成',
  calibrationFailed: '方向校准失败',
  sessionEnded: '会话已结束',
  enterFailed: '进入失败',
  skippedCalibration: '已跳过方向校准',
  recalibrateNeedsSession: '重新校准仅在 VR 会话中可用',
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
  hudDrawCalls: 'Draw call'
};

export const EN: Strings = {
  appName: 'Quiet Shore',
  appNameEn: 'Quiet Shore VR',
  enter: 'Enter training',
  preview: '2D preview',
  checking: 'Checking device…',
  xrReady: 'WebXR available',
  noXR: 'No WebXR here. Open Firefox Reality.',
  xrUnsupported: 'immersive-vr is not supported',
  xrFailed: 'WebXR detection failed',
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
  menuContinue: 'Continue',
  menuRecalibrate: 'Recalibrate',
  menuAudio: 'Toggle sound',
  menuExit: 'Exit training',
  calibrationCeiling: 'Look at the ceiling',
  calibrationToes: 'Look toward your toes',
  calibrationHold: 'Hold still',
  calibrationStable: 'Stabilizing…',
  calibrationRecording: 'Recording',
  calibrationDone: 'Direction calibration complete',
  calibrationFailed: 'Direction calibration failed',
  sessionEnded: 'Session ended',
  enterFailed: 'Could not enter',
  skippedCalibration: 'Direction calibration skipped',
  recalibrateNeedsSession: 'Recalibration is only available inside a VR session',
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
  hudDrawCalls: 'Draw calls'
};

export function getStrings(lang: 'zh' | 'en'): Strings {
  return lang === 'en' ? EN : ZH;
}
