# 控制交互规格（v0.8）

本文是 v0.8 的**交互与安全契约**，不是实现说明。协议字段、范围、停止语义以本文为准；实现落点见各节末尾的代码归属。现有链路背景见 `docs/control-plane.md`，虚拟体位的变换设计见 `docs/virtual-posture.md`。

设计底线：**患者随时能停；操作员永远不能直接操纵相机；任何连续运动都会自己过期。**

## 1. 需求分组与优先级

| 组 | 内容 | 优先级 | 发布判据 |
| --- | --- | --- | --- |
| P0 | 停止优先权、单租约授权、命令白名单、范围校验、运动 TTL、故障禁用 | 必须随 v0.8 首发 | 任一安全用例失败即阻塞发布 |
| P1 | 眼高输入（1.2–1.9 m）、只读角度呈现 | 与 P0 同版 | 眼高经 bootstrap 到页面；角度只读 |
| P2 | 一步舒适校准：正前方 + 静止即中立帧、失败不覆盖旧校准、操作员可见结果 | 与 P0 同版 | 采集失败保留旧校准；状态行不谎报成功 |
| P3 | 平板系统级视角运动（绝对偏航/俯仰 + 固定预设动画） | 同版但可独立回退 | 断链/失控保持当前角度；`view:stop` 立即冻结 |
| P4 | 审计持久化、眼高回读、姿态字段上链路 | 不承诺 | 需要协议扩展，另开切片 |

冲突裁决顺序：P0 > P1 > P2 > P3。P1–P3 各自失败时，关闭该组命令（从 `ControlProtocol.CAPABILITIES` 移除）即可退回 v0.7 行为，不得让 P0 语义退化。

## 2. 角色与权限矩阵

| 角色 | 载体 | 身份边界 |
| --- | --- | --- |
| 患者 | 头显（右侧确认键、退出 WebXR、摘下头显） | 无租约、无命令；拥有**无条件停止权** |
| 照护者 / 治疗师（操作员） | 平板 `ControlScreen` | 持有 BLE 租约的任意平板；邻近即授权，不区分权限层级 |

| 干预 | 患者 | 操作员（租约持有者） |
| --- | --- | --- |
| 停止训练 / 冻结运动 | 始终可用 | 可用 |
| 开始、预览、结束会话 | 仅头显手势可启动 WebXR | 可用 |
| 场景、声音 | — | 可用（会话中拒绝换场景） |
| 眼高 | — | 1.20–1.90 m，0.05 步进 |
| 视角朝向（偏航/俯仰滑动条 + 上仰/下俯/回正/呼吸/停止） | — | 可用 |
| 姿态预设（起身 / 回躺 / 停止并保持） | 短按确认键等价（仅已校准 + 会话中） | 可用（`posture:rise/lower/stop`） |
| 注视选择（场景目标，6 s 停留） | 可用 | — |
| 确认键 | 唯一动作：短按切换起身/回躺；其余情况无响应 | — |
| 视角动画（`view:anim:*`，四个预设） | — | 可用（系统级预设，与场景无关） |
| 方向校准（一步：正前方 + 保持静止） | —（进入会话即自动开始，除非设置跳过） | 可再次触发（`calibrate` / `recalibrate`） |
| 声音 / 结束训练 / 重新校准 | — | 仅平板（头显内没有菜单） |
| 释放租约 / 断开 | — | 可用 |

硬规则：

1. **患者停止永远赢。** 不询问、不确认、不被任何平板操作覆盖；停止后平板所有连续命令立即失效，直到患者重新进入会话且租约仍在。
2. **先到先得。** 第一台 `CLAIM` 的平板持有租约（`BluetoothControl` 内的控制器地址）；第二台只看到配对页与 `CONTROL_BUSY`，永远拿不到干预按钮。
3. 租约丢失（`CONTROL_REQUIRED`、断链、`RELEASE`、服务重启）等同于一次停止事件：头显入队一条 `posture:stop` 冻结姿态、平板禁用视角与姿态按钮。视角朝向按契约**保持当前角度**，不回正。
4. 没有独立的操作员权限层级：租约持有者直接看到视角与姿态控件，不存在开关或解锁步骤。患者停止仍然覆盖一切。
5. 平板端没有身份认证，因此权限矩阵是**防误触**，不是安全边界；不要把它写进宣传材料。

代码归属：`BlePermissions.kt`（权限申请，无新增权限）、`ControlViewModel.kt`（租约与命令闸门）、`BleController.kt`、`QuietShoreBleManager.kt`。

## 3. 会话状态机

状态由两端共同推导：平板用 `BlePhase` + `ControlState`，页面用 `session` / `calibration.isActive()` 为权威。

```text
idle ──扫描/连接──▶ paired ──CLAIM/CONTROL_OK──▶ claimed
claimed ──场景已加载且会话未开始──▶ scene-confirmed
scene-confirmed ──患者进入 WebXR（浏览器内确认/点按）──▶ active
active ──calibrate──▶ calibrating ──成功/失败──▶ active
active ──pause/stop/患者停止/租约丢失──▶ paused-stopped
任意 ──断链/ERROR/遥测过期/渲染进程崩溃──▶ fault
fault/paused-stopped ──重新接管且患者重新进入──▶ claimed/active
```

| 状态 | 平板映射 | 页面映射 | 允许的干预 | 必须为 0 的量 |
| --- | --- | --- | --- | --- |
| `idle` | `BlePhase.IDLE / DISCONNECTED / SCANNING` | 未启动 | 无 | 视角朝向回 0°/0° |
| `paired` | `CONNECTING / AUTHENTICATING` | — | 无（只显示连接进度） | 同上 |
| `claimed` | `READY && controlGranted` | `controlMode = true` | 场景、声音、预览、眼高、结束 | 同上 |
| `scene-confirmed` | `READY` + `control.scene ∈ SCENE_IDS` | `handle != null` | 同 `claimed`；页面已加载场景 | 同上 |
| `active` | `control.session == true` | `session != null && xr.isPresenting` | 全部（姿态需已校准；视角朝向需会话进行中；校准可再次触发） | — |
| `calibrating` | `control.calibrating == true` | `calibration.isActive()` | 仅停止、结束 | **视角朝向回 0°/0°；姿态目标 neutral（≤1 s 到位）** |
| `paused-stopped` | `control.session == false` | 会话结束 / 预览 | 场景、声音、眼高、预览；校准需重新进入会话 | 视角朝向回 0°/0°、姿态回到 neutral |
| `fault` | `BlePhase.ERROR`、`poseStale`、`CONTROL_REQUIRED` | 页面重载、渲染进程重启 | 仅重新连接/重新接管 | 全部运动立即冻结 |

前置条件（不满足即按钮禁用，而不是点击后报错）：

- 视角朝向：`READY` + `controlGranted` + `active` + 未在校准中；不依赖遥测新鲜度（目标是绝对量，不是速度）。
- 姿态：`active` + 已校准；`POSTURE_LIMITS` 硬限。
- 眼高：`claimed` 及以上；`calibrating` 时禁用。
- 校准：`active`；开始时立即把视角朝向归 0°/0°，并把姿态重定向到 neutral（受 `POSTURE_LIMITS.minDurationMs` 约束，≤1 s 到位）；期间拒绝姿态、眼高与视角命令。一步采集：视线偏离 6° 内累计 1.2 s 稳定 + 2 s 倒计时后落一帧。

故障判定：姿态超过 1.5 s 未更新（沿用现有 `poseStale`）、`ERROR`、`onRenderProcessGone`、页面重载（WS 重连后重新同步状态）。`/ws` 断开等同控制通道故障：页面立即冻结运动、显示故障并指数退避重连；没有 SSE/轮询回退。任何故障都**冻结当前朝向**，不做自动回中，避免二次运动。

## 4. 干预目录

| 干预 | 命令 | 范围 / 粒度 | 过渡与限速 | 停止 / 异常行为 | 审计 |
| --- | --- | --- | --- | --- | --- |
| 场景 | `scene:<id>` | `landscape / ward / bathroom / lab` | 立即切换，无过渡 | 会话中拒绝并回显原场景 | 记录 id |
| 声音 | `audio:on / off / toggle` | 二值 | 立即 | 断开保持最后值 | 记录目标值 |
| 眼高 | `settings:eyeheight:<m>` | 1.20–1.90 m，0.05 m 步进，两位小数 | 会话中应用时 500 ms 缓动；`calibrating` 禁用 | 越界值整条命令拒绝，保留旧值 | 记录请求值与是否持久化 |
| 姿态预设 | `posture:rise / lower / stop` | 坐起轨迹（髋 0.45 m、躯干 0.55 m、站立眼高 1.70 m，6 s）；`worldFor(head)` 反演镜头→世界；患者短按确认键切换起身/回躺（仅已校准 + 会话中）；平板“视角”页签的 `缓慢起身` / `回躺` / `停止并保持` | 播放头线性推进，旋转段为 quintic（峰值 ≈40 °/s）；停止/失权立即冻结当前进度 | `stop` 冻结在当前值（不回弹） | 记录命令与完成进度 |
| 姿态自定义 | 映射到同一 `comfort.setPosture`（协议保留，平板 UI 不提供） | pitch ±20°、roll ±10°、rise 0–1.2 m、duration 1–30 s | 由 duration 与限速推导最小合法时长 | 同上 | 记录全部四项 |
| 校准 | `calibrate / recalibrate` | **一步**：患者保持舒适姿势看向正前方并静止；6° 门限内累计 1.2 s 稳定 → 2 s 倒计时 → 落一帧，该朝向即中立（站立）帧，成功后页面以仰卧为起点创建起身路径（t=0） | 隐藏场景；开始时俯仰归 0、姿态重定向 neutral（≤1 s） | 采集失败（无有效姿态）**保留旧校准**；姿态保持 neutral；患者不满足稳定性时一直等待（无超时），结束会话即取消 | 记录结果与是否成功 |
| 视角朝向 | `view:orient:<yaw>,<pitch>` | 绝对度数：yaw ∈ [−180,180]（+ = 视线左转）、pitch ∈ [−90,90]（+ = 上仰）；越界整条拒绝 | 页面从**当前**朝向平滑重定向（俯仰 ≤15 °/s、偏航 ≤30 °/s）；拖动时 ≤10 Hz；无 TTL | 断链、失控、患者停止 → 保持当前朝向，不回弹；会话结束/校准开始时归 0°/0° | 记录目标值 |
| 视角动画 | `view:anim:up\|down\|recenter\|breathe`、`view:stop` | 系统级预设，**无参数**：up/down 相对**当前**角度 ±10°，recenter 回 0°，breathe 为 6 s 回到起点的曲线；曲线与时长由页面定义 | 页面播放；`view:stop` 立即冻结在**当前**俯仰（不回正）；只有 `recenter` 回 0° | 优先级：患者停止 > 租约丢失 > 会话结束/校准 > 显式命令 | 记录预设名与结果 |

命令语义约定：

- 患者侧注视选择不进协议：**只有场景可注视目标**走 6 s 停留（暗色底环 + 亮色进度弧，下方提示 `保持注视 6 秒以选择`），视线离开立即清零。头显内没有 WebXR 菜单，确认键也不承担选择职责——它唯一的作用是在已校准且会话中时切换起身/回躺。3DoF 视线噪声大，因此不在 1–2 s 量级做选择。
- 所有命令小写、无换行、≤64 字符（`ControlProtocol.normalize`）。
- 平板在发送前校验，页面再次校验并独立 clamp；任何一侧都不能把越界值直接写进变换。
- 离散命令（场景、眼高、姿态、校准）由操作员明确点击触发，不做连发。
- 连续命令只有 `view:orient`，它携带绝对朝向而非速度或增量，因此不存在“按住即无限加速”。

两步重映射（历史，仅 `comfort.calibrateTwo` / `remapFromPoses` 保留，患者流程不使用）：3DoF 上头显位置不变，两次采样几乎落在同一点，`pivot` 与夹角都不可靠，因此患者校准已改为一步。以下 `REMAP_LIMITS` 门限只对显式调用 `calibrateTwo` 的调试路径有效——

1. 夹角 <15° 或 >165°，或 pivot 间距 <0.005 m（两次采样几乎同一点）→ `poses-too-similar`；
2. `confidence = sin(angle) < 0.35` → `low-confidence`；
3. 通过后按 `weight = clamp(strength × confidence, 0, 0.85)` 向 identity 混合，并用 `appliedWeight = min(weight, 120° / rawAngle)` 封顶，保证世界永不翻转。

任一失败都**不得**写入 `q0` / `p0` / `calibrated`，旧校准继续生效。默认 `strength = 1.0`；调试时可在 0.7–1.0 调整，但最终权重仍受 0.85 与 120° 上限约束。置信度只在头显状态行与校准结果里显示；平板从 state byte 11 只看到 0 或 100 的粗粒度值（见 §7.3）。

### 4.1 可审计性

每次**离散**干预（含被拒绝的）由头显服务写一条结构化事件；连续流只在开始/结束/异常时各写一条：

| 字段 | 来源 | 说明 |
| --- | --- | --- |
| `t` | `SystemClock.elapsedRealtime()` | 单调时间，配合开机时间换算墙钟 |
| `controller` | 租约 MAC | 只存后 4 位，避免完整地址渗入日志分享 |
| `command` | 原始字符串 | 截断到 64 字符 |
| `result` | `accepted / rejected:<reason> / applied / failed:<reason>` | 拒绝也必须留痕 |
| `value` | 解析后的数值（眼高、角度、时长、向量） | 便于复现 |
| `phase` | 状态机当前态 | 解释“为什么当时允许/不允许” |

v0.8 只做内存环形缓冲（≥256 条）+ `Log.i`（TAG `QuietShorePortal`），不落盘、不上传；持久化列入 P4。没有身份认证的链路，审计只能证明“发生了什么”，不能证明“谁做的”。

代码归属：页面 `src/app/App.ts` 的 `handleRemoteCommand` / `setVirtualPosture`；变换 `src/core/xr/comfort.ts`；头显路由 `PortalService.dispatchControl`（`settings:*` 宿主命令）；平板 `ControlActions.kt`、`ControlRail.kt`。

## 5. 安全包络

| 常量 | 值 | 含义 |
| --- | --- | --- |
| `VIEW_PITCH_MAX` | ±90° | 绝对俯仰上限；两端口径一致 |
| `VIEW_YAW_MAX` | ±180° | 绝对偏航上限（+ = 视线左转） |
| `VIEW_STEP` | 1° | 两条滑动条通用步进；线上直接是整数度 |
| `VIEW_SEND_HZ` | ≤10 | 拖动时发送频率（70 ms 防抖，只发最新一对值） |
| `VIEW_RATE` | 俯仰 ≤15 °/s、偏航 ≤30 °/s | 页面跟踪上限；预设与 recenter 走固定时长曲线 |
| `VIEW_ANIM_RECENTER_MS` | 2400 | `view:anim:recenter` 的固定时长（页面定义，不过线） |
| `VIEW_PRESETS` | `up`(1) / `down`(2) / `recenter`(3) / `breathe`(4)；`none`(0) 仅出现在状态帧 | 唯一允许的预设目录；带参数或未知名称整条拒绝 |
| `VIEW_PRESET_UP_DOWN` | 相对当前俯仰 ±10° | up/down 的幅度，页面实现；recenter 同时把偏航归零 |
| `VIEW_BREATHE_MS` | 6000 | breathe 曲线时长，页面实现 |
| `VIEW_TRANSPORT` | `GET /ws?since=<seq>` | 单一 WebSocket：服务端推 `ready/cmd/control`，页面推 `state/telemetry/ack`；无 SSE/轮询回退 |
| `EYE_HEIGHT` | 1.20–1.90 m，默认 1.70，步进 0.05 | 虚拟眼高 |
| `POSTURE` | 默认 pitch ±20°、roll ±10°、rise 0–1.2 m、1–30 s；`setPosture` 可显式放宽到 90° | 沿用 `POSTURE_LIMITS`；完整起身由 sit-up 路径（6 s 逆变换）承担，体位层用于微调与归位 |
| `POSTURE_RATE` | 小角度微调 pitch/roll ≤ 2°/s、rise ≤ 0.05 m/s | 代码只夹幅值与时长，速率由调用方按 `SMOOTHERSTEP_PEAK`（1.875×）反推；sit-up 路径 90°/4.2 s（旋转段）峰值约 40°/s，实机耐受待验证（TODO P0） |
| `REMAP` | 夹角 15–165°、`confidence ≥ 0.35`、`weight ≤ 0.85`、旋转 ≤ 120° | 仅对历史的 `calibrateTwo` 生效；一步校准不经过这组门限 |

不动式约束：

1. **不碰相机。** 不改 `XRCamera`、`renderer.xr.getCamera`、session pose；俯仰修正作用在世界朝向容器上。
2. **无自由飞行、无平移。** `view:orient` 只写世界朝向（偏航 + 俯仰），无平移、无速度、无瞬移。
3. **有界朝向。** 俯仰 ±90°、偏航 ±180°，不允许 roll；越界命令整条拒绝，不先饱和再继续推送。
4. **单一 WS，无回退。** 页面只通过 `/ws?since=<seq>` 接收 `cmd`。离散命令保留到页面 `ack`，`view:orient` 只保留最新样本；重连按 `since` 补发。没有 `/control` 轮询或 `/events` SSE。
5. **写类型与序号。** 连续 `view:orient` 走 Write Without Response，离散命令走 Write With Response 并带 `#<seq>`，头显回 `ACK <seq> <OK|REJECTED|BUSY>`；stop 优先并丢弃待发朝向。头显对 `view:orient:*` 不回执。
6. 眼高只改变“页面假设的头显眼高”，用于场景构建上下文与地板偏移（`host.setFloorOffset(-eyeHeight)`）；它**不是**让患者坐起，UI 文案必须写“视角高度”，不写“抬高患者”。

禁用矩阵（任一成立即拒绝或立即冻结）：

| 事件 | 视角朝向 | 姿态 | 眼高 |
| --- | --- | --- | --- |
| 未接管 / `CONTROL_REQUIRED` | 拒绝 | 拒绝 | 拒绝 |
| 未进入 XR 或会话已结束 | 拒绝 | 拒绝 | 允许 |
| 校准进行中 | 冻结 + 拒绝 | 重定向 neutral（≤1 s）后冻结并拒绝 | 拒绝 |
| 遥测过期 >1.5 s | 冻结 | 冻结 | 允许 |
| 断链 / 页面重载 / 渲染进程崩溃 | 冻结 | 冻结 | 拒绝 |
| 患者停止 | 冻结 | 冻结 | 允许 |

## 6. 控制 UI 组件图（Compose）

| 组件 | 文件 | 职责 | 启用条件 |
| --- | --- | --- | --- |
| `ControlTopBar` | `ControlScreen.kt` | 浮动浅色顶栏：连接、信号、接管、录制入口、打开/收起控制栏与信息面板、断开；只读状态，不做运动决策 | 始终 |
| `StatusPanel` | `ui/components/StatusPanel.kt` | 场景、训练状态、声音、视点高度、校准置信度、姿态进度/起身高度/姿态俯仰、视角朝向、姿态新鲜度 | 信息条展开 |
| `DisconnectedBanner` | `ControlScreen.kt` | 断链/错误提示与重连/离开 | `DISCONNECTED` / `ERROR` / `IDLE` |
| `ReconnectingBanner` | `ControlScreen.kt` | 退避重连进度（`reconnectAttempt`/`reconnectMax`）与“返回配对” | `RECONNECTING`，或重连期间经过 `SCANNING`/`CONNECTING` |
| `AngleGauge` | `ui/components/AngleGauge.kt` | **只读**显示 `yaw`（±180°）与 `pitch`（±90°），整数度、1° 分辨率，`Canvas` 绘制，无点击区域与手势；5 Hz 更新，过期时降低不透明度并显示“无数据”；固定在左下角、`ViewportControls` 上方 | `pose != null` |
| `ViewportControls` | `ControlScreen.kt` | 左下角底栏：`ViewModeToggle`（患者/全局视角）与进入全屏；全屏内保留同一组切换 | 控制页 |
| `ControlRail` | `ui/components/ControlRail.kt` | 右侧控制栏：场景、声音、视角、SUS 等页签；视角页签内含“虚拟起身”区块（`缓慢起身` / `回躺` / `停止并保持`，门控为已连接 + 租约 + 会话中 + 未校准中 + `calibrationConfidence > 0`）；宽屏常驻，窄屏（<1000 dp）默认收起、从顶栏展开 | `controlsOpen` |
| `RecordingChip` | `ui/components/RecordingControls.kt` | 顶栏与全屏的录制入口；录制中显示 `● mm:ss` 与“停止”；`SAVING` 显示保存中 | 三维页面就绪 |
| `RecordingNotice` | `ui/components/RecordingControls.kt` | 已保存（时长/大小/分享）或失败原因；可用“分享”拉起系统分享面板 | `SAVED` / `FAILED` |
| `EyeHeightStepper` | `ui/components/EyeHeightStepper.kt` | 1.20–1.90、0.05 步进；本地立即回显请求值，收到 `OK:settings:eyeheight:*` 后标记“已生效”；300 ms 防抖合并连点 | `READY` + 已取得租约 + 未在校准中 |
| `ViewOrientationControls` | `ui/components/ViewOrientationControls.kt` | 两条 1° 步进滑动条（偏航 ±180°、俯仰 ±90°）与 `上仰` / `下俯` / `回正` / `呼吸`（`view:anim:*`）；`停止（保持）` 发 `view:stop`；显示 `viewPreset`、`viewAnim` 相位与当前角度 | `READY` + 已取得租约 + 会话中 + 未在校准 |
| `SessionAction` | `ui/components/ControlRail.kt` | 训练页签中的红色全宽按钮：会话中发 `stop`（结束训练），否则发 `enter`；患者摘下头显或退出 WebXR 优先 | 已连接 |

Compose 实现要点：

- `ControlUiState` 只增加低频字段：`eyeHeightRequested`、`eyeHeightConfirmed`、`viewPitchRequested`、`viewYawRequested`。**滑动条的实时位置不进 `ControlUiState` 的高频路径**：拖动期间两个 `*Requested` 承载本地请求值，收到 `state.viewPitch` / `state.viewYaw` 回读并落在半度以内后清空，滑动条重新跟随头显。
- 发送用防抖而不是循环：`ControlViewModel` 持有 `viewJob`，70 ms 内只发最新一对 `yaw,pitch`（≤10 Hz）。`onCleared`、`DISCONNECTED`、`CONTROL_REQUIRED`、`onControlLost` 取消该任务但**不**发 `view:stop`——冻结帧由页面/租约语义保证；平板只在用户点 `停止（保持）` 时发 `view:stop`，点 `回正` 时发 `view:anim:recenter`。
- 录制状态（`RecordingPhase`、时长、大小、路径）放在 `ControlUiState`；`ControllerWebViewHost` 实现 `ControllerRecorder`，由视口在组合期挂到 ViewModel，页面重建时发送失败事件而不是静默丢弃。
- 所有禁用都是“组件禁用 + 命令闸门”双保险，不能只靠 `enabled`。
- 沿用现有 `QuietPalette`、`ControlRail` 分区与按钮尺寸；不新增可滚动长页（`requirements.md §9.1`）。

## 7. 协议演进

### 7.1 眼高：bootstrap 注入，不改状态帧

```
HeadsetSettings.eyeHeight  (SharedPreferences "settings.eyeHeight", 1.20–1.90, 默认 1.70)
  → LaunchOptions.eyeHeight
  → PortalSession.toJson() 增加 "eyeHeight": 1.35
  → PortalService 注入 window.__QS_BOOTSTRAP__
  → src/app/config.ts readConfig: bootstrap.eyeHeight，clamp 1.2–1.9，默认 1.7
  → src/app/App.ts: 替换常量 EYE_HEIGHT，用于相机初始高度、SceneBuildContext.eyeHeight、setFloorOffset(-eyeHeight)
```

命令（宿主执行，同时转发页面以便会话中即时生效）：

```
settings:eyeheight:<m>
<m> ::= 1.2 … 1.9，1–3 位小数，无符号、无指数、无千分位
合法：settings:eyeheight:1.35   settings:eyeheight:1.6   settings:eyeheight:1.90
非法：settings:eyeheight:2.4    settings:eyeheight:NaN    settings:eyeheight:+1.35   settings:eyeheight:1,35
```

校验：前缀匹配后取十进制数，必须 `isFinite` 且落在闭区间；不合法整条拒绝，不 clamp、不落盘。头显侧用 `ControlProtocol.SETTINGS_EYE_HEIGHT` / `parseEyeHeight()` 完成前缀 + 解析校验，范围常量是 `EYE_HEIGHT_MIN = 1.2f`、`EYE_HEIGHT_MAX = 1.9f`、`EYE_HEIGHT_DEFAULT = 1.6f`，并在 `BluetoothControl.handleWrite` 回执前调用白名单，避免“先回 OK 再拒绝”。平板步进器只产生 0.05 的整数倍（两位小数），协议层保留 3 位小数只是为了让手写命令也能被严格校验。

### 7.2 视角运动：系统级能力

视角运动是**系统级**能力，不属于任何场景：平板只负责播放/打断/停止/复位，头显只负责路由命令并回报状态，页面持有唯一的运动控制器与固定时长。两端都不得按场景分支。

```
view:orient:<yaw>,<pitch>  绝对度数：yaw ∈[-180,180]（+ = 左转）、pitch ∈[-90,90]（+ = 上仰）
view:anim:up           预设：相对当前角度 +10°
view:anim:down         预设：相对当前角度 -10°
view:anim:recenter     预设：缓动回到 0°
view:anim:breathe      预设：6 s 回到起点的呼吸曲线
view:stop              立即冻结在当前角度（打断语义），不回正
```

- 解析入口：`ControlProtocol.VIEW_ORIENT` / `VIEW_STOP` / `VIEW_ANIM` / `parseViewOrient()` / `parseViewAnim()`。
- `view:anim:<name>` 的 name 只能是 `up`、`down`、`recenter`、`breathe`；带参数、未知名称或多余字符整条拒绝。头显把 id 当作不透明值转发，不解释曲线。离散命令回 `OK:<cmd>`，`view:orient` 仍然免回执。
- `view:orient` 恰好两个分量，`,` 分隔，无空格；任一分量非有限、超出量程或写成 `.5` / `5.` / 带正号即整条拒绝。
- 两个分量都是**绝对**朝向，不是速度或增量；没有 TTL，目标保持到下一次 `view:orient`。页面从**当前**朝向平滑重定向。
- 符号约定（患者视角）：+yaw = 视线左转，+pitch = 上仰（看到更多天空，世界相对向下倾斜）。世界层两个轴都取反，只在页面适配器里做一次。
- 平板拖动时最多 10 Hz（70 ms 防抖），空闲时不重复发送；预设动画不发送任何时长。
- 状态帧回报**当前已应用**的偏航与俯仰（不是目标）、动画相位 `viewAnim`（`idle` / `playing` / `held`）与当前预设 id `viewPreset`（`none|up|down|recenter|breathe`）。平板只回显，不从按钮推断运动状态。
- 优先级由页面/会话拥有：患者停止 > 租约丢失 > 会话结束/校准重置 > 显式命令。头显不重新实现状态机，只转发与回报。
- 租约丢失时保持当前朝向，`view:stop` 不回正；只有 `view:anim:recenter` 才把两个轴都归零。

#### 7.2.1 页面下行传输

```text
GET /ws?since=42   （RFC 6455，文本帧 JSON）
{"type":"ready","seq":42,"control":true}
{"type":"cmd","seq":43,"command":"view:orient:0,40","continuous":true}
{"type":"cmd","seq":44,"command":"scene:ward","continuous":false}
```

- 连接建立先发 `ready`，随后补发 `seq > since` 的离散命令与最新 `view:orient`；页面按 `seq` 去重/合并。
- 离散命令保留到页面 `ack`；`view:orient` 免 ack、只留最新；`view:anim:*` 不跨重连重放。
- 每个订阅有界队列，连续帧合并、离散帧优先保留；服务停止/断线时关闭连接，客户端指数退避重连。
- 页面通过同一 WS 发 `state`、`telemetry`、`ack`；没有 `/state`、`/telemetry` POST 或 `/control` 轮询。

### 7.3 保持不变

- **`ControlState` 为 15 字节二进制 v7**：`[4]`/`[5]` 是**测得**的世界俯仰/横滚有符号整度（起身到位为 +90），`[8]` 是**当前已应用**的 `viewPitch` 有符号整数度，`[9]` 是 `viewAnim`（0 idle / 1 playing / 2 held），`[12]` 是 `viewPreset`（0 none / 1 up / 2 down / 3 recenter / 4 breathe），`[13..14]` 是小端 int16 的 `viewYaw`（−180..180，+ = 左转）。`viewX`/`viewZ` 已删除。版本不等于 7 或长度不是 15 的帧直接丢弃，不提供旧版本兼容层。
- `telemetry` 仍是 20 字节 `x,y,z,yaw,pitch`；因此平板**无法**显示 roll（只在头显状态行）。
- 一步校准下 `calibrationConfidence`（state byte 11）只有两种取值：校准成功 `1`（100）、未校准 `0`；历史上的两姿态置信度不再产生。
- `status` 语义不变：`OK:<cmd>` 只表示“头显服务已接收”，`view:orient` 免回执。
- 已知缺口：平板无法回读持久化眼高，重连后 `EyeHeightStepper` 只能显示进程内最后确认值或默认 1.70（标注“未确认”）。回读需要新增特性或状态字段，列入 P4。
- `ControlProtocol.stateMaxBytes = 15`、`stateVersion = 7`；15 字节仍落在默认 ATT 负载（20 字节）内。新增字段需要新版本号，并同步两端。

### 7.4 患者视角录像（本地能力，不过 BLE）

录像不是控制命令，只发生在平板进程内：

```
renderer.domElement.captureStream(30)
  → MediaRecorder（优先 video/mp4;codecs=avc1，回退 webm/vp9、webm/vp8）
  → 1 s timeslice，结束后 Blob 按 256 KiB 切片
  → QuietShoreBridge.recordingChunk(<base64>)  → ViewportRecorder 单线程顺序落盘
  → recordingFinished() → Movies/recordings/QS-yyyyMMdd-HHmmss.mp4|webm
  → FileProvider 分享
```

- 录制开始前页面强制切到患者视角；画布外的手势与操作层不会进入视频。
- 录像与 BLE 租约、会话状态解耦：断链不打断录制，会话结束也不自动停止（由操作员显式停止）。
- 不录音频、不做转码；容器取决于 WebView 的 `MediaRecorder.isTypeSupported`。
- MediaRecorder 的 1 s timeslice 不能各自独立播放（MP4 会在任意 box 边界切分），因此 stop 后先把 parts 合成一个 Blob，再按 256 KiB 切片过桥；整段视频在 WebView 内存中短暂持有，5 分钟量级约数 MB。Kotlin 侧 512 MB 上限只用于拦截失控录制。
- 页面重载、渲染进程退出、Activity 销毁：丢弃未完成文件并上报失败；单文件上限 512 MB。
- 桥接接口：`qsRecorder.start()/stop()/active()` 与 `recordingStarted/recordingChunk/recordingFinished/recordingFailed`。这些接口只在控制端 WebView 内使用，不进入 BLE 协议。

## 8. 验收用例

| # | 场景 | 操作 | 期望 |
| --- | --- | --- | --- |
| A1 | 松手保持 | 把滑动条拖到 `view:orient:-45,60` 后松手 | 拖动期间 ≤10 Hz 只发最新一对值；页面从当前朝向平滑重定向到 −45°/60° 并保持（无 TTL、不回弹）；平板回读一致 |
| A2 | 断链 | 拖动滑动条时关闭平板蓝牙或远离 | 本地立即停止发送；页面保持当前角度（不回正、动画停止），头显因租约丢失入队一条 `posture:stop`；平板进入 `DISCONNECTED`；重连后滑动条显示头显回读值，不会自动续发 |
| A3 | 患者停止优先 | 姿态上升中，患者从 Firefox Reality 退出 WebXR 或摘下头显 | 当帧冻结姿态插值与俯仰缓动；会话结束并把俯仰归 0°；平板所有运动控件禁用，直至重新进入 |
| A4 | 越界拒绝 | 依次发送 `settings:eyeheight:2.4`、`settings:eyeheight:NaN`、`view:orient:181,0`、`view:orient:0,91`、`view:orient:0` | 全部拒绝，不落盘、不改变当前值、页面不改变朝向；日志记录原始命令 |
| A5 | 一步校准 | 患者持续左右张望（不满足 6°/1.2 s 稳定），或头显掉姿态 | 不落帧、状态停在“保持不动”；**旧校准保留**；姿态与俯仰仍为 neutral。历史的 `calibrateTwo` 低置信度路径（`poses-too-similar` / `low-confidence`）只用于调试调用 |
| A6 | 重连恢复眼高 | 设 1.35 → 释放租约 → 重新进入训练（或刷新页面） | bootstrap 携带 `eyeHeight: 1.35`；页面初始高度与地板偏移使用 1.35；平板步进器显示“未确认”（见 §7.3）。仅重连 BLE 而不刷新页面时 bootstrap 不更新，属已知缺口 |
| A7 | 朝向上限 | 把两条滑动条推到两端并反复来回 | 俯仰恒在 ±90°、偏航恒在 ±180° 内；无累积漂移、无抖动、来回不放大 |
| A8 | 校准中禁用 | 校准稳定/倒计时期间拖滑动条、改眼高、点起身 | 全部拒绝；俯仰目标为 0°，姿态 ≤1 s 内到 neutral 并保持；校准不被中断，1.2 s 稳定判定不受影响 |
| A9 | 第二台平板 | 租约被占时第二台连接并 `CLAIM` | `CONTROL_BUSY`；第二台停留在配对页，无任何干预入口 |
| A10 | 异常页面 | 控制中重载页面或渲染进程崩溃 | 页面重放快照后状态一致；运动立即失效；`DisconnectedBanner` / `StatusPanel` 显示故障原因 |
| A11 | 租约丢失冻结姿态 | 起身过程中第二台平板抢到租约（或本机断链） | 头显每次租约丢失只入队**一条** `posture:stop`，姿态冻结在当前进度；视角朝向保持当前角度，不回正；平板视角与姿态控件禁用并给出原因 |
| A12 | 推送中断 | 控制中关闭头显 `/ws` 连接（服务仍在）并持续拖动滑动条 | 页面立即冻结运动并显示故障；指数退避重连后带 `since=lastSeq` 补发；`seq` 去重保证命令不重复执行；停手后目标保持；不出现 SSE/轮询回退 |
| A13 | 录像 | 在全局视角点“录制”，录 30 s 后停止并分享 | 页面立即切患者视角；顶栏计时；`Movies/recordings` 出现可播放文件；分享面板拿到 `video/*` URI；断链不影响录制 |
| A14 | 链路恢复 | 头显断链后关闭再打开平板蓝牙，或重启头显应用 | 头显重新可被搜索；平板自动重连 3 次（`重连中 n/3`）；成功后恢复遥测与租约；失败后回到配对页且可“直接连接” |

验收以“命令是否被接受 + 观测量是否在界内”为准，不依赖动画观感；眩晕相关的观感在 PICO 上单独实测并记录（`docs/performance-evidence.md` 的方式）。

## 9. 实现落点

| 层 | 文件 | 需要的变化 |
| --- | --- | --- |
| 协议 | `android/protocol/.../ControlProtocol.kt` | `SETTINGS_EYE_HEIGHT`、`EYE_HEIGHT_MIN/MAX/DEFAULT`、`parseEyeHeight()`；`VIEW_ORIENT`、`VIEW_STOP`、`VIEW_ANIM`、`VIEW_PITCH_MAX_DEG`、`VIEW_YAW_MAX_DEG`、`parseViewOrient()`、`parseViewAnim()`；`ViewAnim` / `ViewPreset` / `ViewOrientation`；`HELLO/WELCOME/ACK` 与 `#<seq>` 语法；`stateVersion = 7`、15 字节，`posturePitch`/`postureRoll`/`viewPitch`/`viewYaw`/`viewAnim`/`viewPreset` 编解码（度数字段为有符号整数，不做语义夹紧） |
| 头显 | `HeadsetSettings.kt`、`PortalActions.kt`（LaunchOptions）、`PortalSession.kt` | `eyeHeight` 持久化（`settings.eyeHeight`）与 bootstrap 注入 |
| 头显 | `PortalService.kt`、`ControlLog.kt`、`WsFrameCodec.kt` | `/ws` 服务端；ack 保留区（离散 ≤64、最新 continuous）；WS `state`/`telemetry` 解码；`/status` 暴露 state 摘要；租约丢失入队一条 `posture:stop` |
| 头显 | `BluetoothControl.kt` | `HELLO/WELCOME` 门控；`#<seq>` 解析、有界去重、`ACK <seq> <result>`；`view:orient` 免回执 |
| 页面 | `src/app/config.ts`、`src/app/App.ts`、`src/app/portal-link.ts` | 读取 `bootstrap.eyeHeight`；单一 WS 的 cmd/state/telemetry/ack；断线退避 + `since` 续传 |
| 变换 | `src/core/xr/comfort.ts`、`src/core/scene/host.ts` | 俯仰写入世界朝向容器（`content.rotation.x` 一类）；**不得**写 `comfort.group.position`，该值每帧被 `applyTransform` 覆盖；不再做位置平移 |
| 校准 | `src/ui/calibration.ts`、`src/core/xr/comfort.ts`、`App.beginCalibration/onCalibrationResult` | 单帧 `comfort.calibrate(pose)`：6° 容差、1.2 s 稳定、2 s 倒计时；开始采集立即把俯仰目标归 0、把姿态重定向 neutral（≤1 s）；失败不覆盖旧校准。成功后以仰卧为起点创建 `SitUpPath`、置 `sitUpMode` / `sitUpReady` 并写入 `setBasePose`。`calibrateTwo` / `remapFromPoses` 保留但不再被患者流程调用 |
| 起身 | `src/core/xr/situp-path.ts`、`situp-run.ts`、`App.setVirtualPosture/applySitUpTransform`、`src/core/xr/posture-cue.ts` | 6 s 逆变换（旋转段 4.2 s）；`posture:rise/lower/stop` 与患者短按确认键等价；`posture:stop` / 失权当帧冻结；`flow = +1` 只在上行过渡真实移动时成立 |
| 注视 | `src/ui/spatial/input.ts`、`App.registerSelectables` | 场景目标 6 s 停留；暗色底环 + 亮色进度弧；`dwellHint` 提示；视线离开即清零。确认键不参与选择，只用于头显内的起身开关 |
| 平板 | `ControlUiState.kt`、`ControlActions.kt`、`ControlViewModel.kt`、`ui/components/ViewOrientationControls.kt`、`ui/components/ControlRail.kt`、`ui/components/StatusPanel.kt` | 第四页签“视角”：两条滑动条 70 ms 防抖发送；四个 `view:anim:*` 预设、`停止（保持）` 发 `view:stop`；“虚拟起身”区块发 `posture:rise/lower/stop`；显示 `state.viewPreset`、`viewAnim` 相位、姿态进度/起身高度/姿态俯仰；无摇杆、无额外权限开关 |
| 平板 | `web/ControllerWebViewHost.kt`、`recording/ViewportRecorder.kt`、`ui/components/RecordingControls.kt`、`ControlScreen.kt`、`AndroidManifest.xml`、`res/xml/file_paths.xml` | 画布录制桥、分块落盘、FileProvider 分享、录制/计时/结果 UI、患者/全局视角与全屏入口 |
| 平板 | `BleController.kt`、`BlePhase.kt`、`ControlViewModel.kt`、`ui/PairingScreen.kt` | 扫描到第一台匹配设备即自动连接（无设备列表/快捷连接卡）；`lastDeviceAddress` 持久化并冷启动直连；`RECONNECTING` 阶段、0.8/1.6/3.2 s 退避；`CONTROL_BUSY` 不重试 |
| 平板 | `ControlScreen.kt`、`ui/components/ViewModeToggle.kt`、`ui/components/AngleGauge.kt`、`ui/components/ControlRail.kt` | 浮动浅色顶栏；左下角切换/全屏在角度仪表之下；宽屏常驻栏、窄屏（<1000 dp）抽屉；重连/录制提示条不遮挡操作 |

任何文件改动若超出本表，先回到本文补充契约，再动代码。
