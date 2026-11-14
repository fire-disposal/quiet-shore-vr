# 待办

唯一排期入口。范围与决策见 `docs/core.md`，协议见 `docs/protocol.md`。完成项直接删除。

## 实机回归

- [ ] 校准时画面完全静止，卡片 1.8 秒稳定窗、3 秒取样、9 秒强制落地都在预期内。
- [ ] 准备间到正式场景的第一帧：`washroom` 不按起身即为站立视角，仰卧场景从真实天花板起步，自动起身首秒观感可接受。
- [ ] 场景构图定稿：立便器与眼的距离（当前 0.85 m）、口沿高度、墙面明度、天光强度。
- [ ] 新立便器的开口深度、椭圆轮廓与视线取景，需在 PICO 实机上确认。
- [ ] 环境声默认开启，三场景基准音量减半后的掩蔽效果可接受，语音能清楚压过。
- [ ] 强度百分比与体位滑条在真手上的手感，回读是否与实际运动一致。
- [ ] 蓝牙自动连接、断链恢复、`CONTROL_BUSY` 不重试、停止优先。
- [ ] 患者确认键的停止语义：本地停止不依赖 BLE，1 秒内收住。
- [ ] 入口监督两条时限各自重拉一次：页面 25 秒未上线、上线后 20 秒未进会话；确认重拉后窗口是否回到视线前方，是否出现重复窗口。
- [ ] 平板在 10 英寸以下设备上的可读性与触控尺寸。

## 记录与问卷

- [ ] 平板 SUS 历史在系统字体放大下的截断。
- [ ] `SceneSummary.description` 两端界面都没用，决定展开显示或删除。

## 结构清理

- [ ] 页面删除无发送方的命令语法：`settings:eyeheight`、`sus:next|prev`、`preview`、`status`、`start`，并删对应测试。
- [ ] 平板删除仅测试使用的访问器与单实现抽象：`ReconnectPlan`、`CommandQueue.pendingMoves/newestMove/pendingDiscrete`、`WriteTokens.written`。
- [ ] 页面删除无人引用文案、`DevicePictogram` 空壳与 `optional()` 静默降级。
- [ ] 让 `tests/**` 进入类型检查，先修 `tests/portal-link.test.ts` 的旧 state 夹具。
- [ ] 抽出 JSON 信封 helper，消除头显 5 处手写 `{"t","d"}`；共享 prefs 读写只在重复继续增加时再抽象。
- [ ] 拆分 `src/app/App.ts`：会话生命周期、命令执行、渲染管线。
- [ ] 拆分 `PortalService.kt`：回环服务、WebSocket 事件、命令路由。
- [ ] `BluetoothControl.kt` 与 `PortalService.kt` 状态机补单测：重连退避、`CONTROL_BUSY` 不重试、停止优先。
- [ ] 文案来源统一：`src/ui/strings.ts` 与 Android 字符串的 key 映射。

## 志愿者与合规

- [ ] 志愿者测试方案：纳入与排除、问卷、停止条件，取得内部同意。
- [ ] 5 名健康志愿者各 10 分钟：头晕、恶心、主观漂的程度、前后 0 到 10 分、上机到开始耗时。
- [ ] 据结果定强度上限与云层方案取舍。
- [ ] 伦理与护理主管审批，患者使用前必需。

## 分发

- [ ] 稳定 release keystore 与证书指纹。
- [ ] release workflow 生成 `update.json`。
- [ ] 自更新方案重写。

## 规则

1. 新功能先在 `docs/core.md` 写明目标与非目标。
2. 高频路径必须有速率上限与停止语义，离散命令必须有回执。
3. 不保留兼容 fallback，除非有明确版本周期。
