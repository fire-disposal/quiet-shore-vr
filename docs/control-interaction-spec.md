# 控制交互规格（v0.8）

本文是 v0.8 的**交互与安全契约**，不是实现说明。协议字段、范围、停止语义以本文为准；实现落点见各节末尾的代码归属。现有链路背景见 `docs/control-plane.md`，虚拟体位的变换设计见 `docs/virtual-posture.md`。

设计底线：**患者随时能停；操作员永远不能直接操纵相机；任何连续运动都会自己过期。**

## 1. 需求分组与优先级

| 组 | 内容 | 优先级 | 发布判据 |
| --- | --- | --- | --- |
| P0 | 停止优先权、单租约授权、命令白名单、范围校验、运动 TTL、故障禁用 | 必须随 v0.8 首发 | 任一安全用例失败即阻塞发布 |
| P1 | 眼高输入（1.2–1.9 m）、只读角度呈现 | 与 P0 同版 | 眼高经 bootstrap 到页面；角度只读 |
| P2 | 舒适重映射优化：置信度门限、失败不覆盖旧校准、操作员可见结果 | 与 P0 同版 | 低置信度重映射被拒绝 |
| P3 | 平板系统级视角运动（绝对俯仰 + 固定预设动画） | 同版但可独立回退 | 断链/失控保持当前角度；`view:stop` 立即冻结 |
| P4 | 审计持久化、眼高回读、姿态字段上链路 | 不承诺 | 需要协议扩展，另开切片 |

冲突裁决顺序：P0 > P1 > P2 > P3。P1–P3 各自失败时，关闭该组命令（从 `ControlProtocol.CAPABILITIES` 移除）即可退回 v0.7 行为，不得让 P0 语义退化。

## 2. 角色与权限矩阵

| 角色 | 载体 | 身份边界 |
| --- | --- | --- |
| 患者 | 头显（右侧确认键、XR 菜单、摘下头显） | 无租约、无命令；拥有**无条件停止权** |
| 照护者 / 治疗师（操作员） | 平板 `ControlScreen` | 持有 BLE 租约的任意平板；邻近即授权，不区分权限层级 |

| 干预 | 患者 | 操作员（租约持有者） |
| --- | --- | --- |
| 停止训练 / 冻结运动 | 始终可用 | 可用 |
| 开始、预览、结束会话 | 仅头显手势可启动 WebXR | 可用 |
| 场景、声音 | — | 可用（会话中拒绝换场景） |
| 眼高 | — | 1.20–1.90 m，0.05 步进 |
| 视角俯仰（滑动条 + 上仰/下俯/回正/呼吸/停止） | — | 可用 |
| 姿态预设（起身 / 回躺 / 停止） | 停止可用 | 可用 |
| 视角动画（`view:anim:*`，四个预设） | — | 可用（系统级预设，与场景无关） |
| 方向校准 | 可用（头显内） | 触发校准 |
| 释放租约 / 断开 | — | 可用 |

硬规则：

1. **患者停止永远赢。** 不询问、不确认、不被任何平板操作覆盖；停止后平板所有连续命令立即失效，直到患者重新进入会话且租约仍在。
2. **先到先得。** 第一台 `CLAIM` 的平板持有租约（`BluetoothControl` 内的控制器地址）；第二台只看到配对页与 `CONTROL_BUSY`，永远拿不到干预按钮。
3. 租约丢失（`CONTROL_REQUIRED`、断链、`RELEASE`、服务重启）等同于一次停止事件：头显入队一条 `posture:stop` 冻结姿态、平板禁用视角与姿态按钮。视角俯仰按契约**保持当前角度**，不回正。
4. 没有独立的操作员权限层级：租约持有者直接看到视角与姿态控件，不存在开关或解锁步骤。患者停止仍然覆盖一切。
5. 平板端没有身份认证，因此权限矩阵是**防误触**，不是安全边界；不要把它写进宣传材料。

代码归属：`BlePermissions.kt`（权限申请，无新增权限）、`ControlViewModel.kt`（租约与命令闸门）、`BleController.kt`、`QuietShoreBleManager.kt`。

## 3. 会话状态机

状态由两端共同推导：平板用 `BlePhase` + `ControlState`，页面用 `session` / `calibration.isActive()` 为权威。

```text
idle ──扫描/连接──▶ paired ──CLAIM/CONTROL_OK──▶ claimed
claimed ──场景已加载且会话未开始──▶ scene-confirmed
scene-confirmed ──患者确认键（WebXR）──▶ active
active ──calibrate──▶ calibrating ──成功/失败──▶ active
active ──pause/stop/患者停止/租约丢失──▶ paused-stopped
任意 ──断链/ERROR/遥测过期/渲染进程崩溃──▶ fault
fault/paused-stopped ──重新接管且患者重新进入──▶ claimed/active
```

| 状态 | 平板映射 | 页面映射 | 允许的干预 | 必须为 0 的量 |
| --- | --- | --- | --- | --- |
| `idle` | `BlePhase.IDLE / DISCONNECTED / SCANNING` | 未启动 | 无 | 视角俯仰回 0° |
| `paired` | `CONNECTING / AUTHENTICATING` | — | 无（只显示连接进度） | 同上 |
| `claimed` | `READY && controlGranted` | `controlMode = true` | 场景、声音、预览、眼高、结束 | 同上 |
| `scene-confirmed` | `READY` + `control.scene ∈ SCENE_IDS` | `handle != null` | 同 `claimed`；页面已加载场景 | 同上 |
| `active` | `control.session == true` | `session != null && xr.isPresenting` | 全部（姿态需已校准；视角俯仰需会话进行中；校准可再次触发） | — |
| `calibrating` | `control.calibrating == true` | `calibration.isActive()` | 仅停止、结束 | **视角俯仰回 0°；姿态目标 neutral（≤1 s 到位）** |
| `paused-stopped` | `control.session == false` | 会话结束 / 预览 | 场景、声音、眼高、预览；校准需重新进入会话 | 视角俯仰回 0°、姿态回到 neutral |
| `fault` | `BlePhase.ERROR`、`poseStale`、`CONTROL_REQUIRED` | 页面重载、渲染进程重启 | 仅重新连接/重新接管 | 全部运动立即冻结 |

前置条件（不满足即按钮禁用，而不是点击后报错）：

- 视角俯仰：`READY` + `controlGranted` + `active` + 未在校准中；不依赖遥测新鲜度（目标是绝对量，不是速度）。
- 姿态：`active` + 已校准；`POSTURE_LIMITS` 硬限。
- 眼高：`claimed` 及以上；`calibrating` 时禁用。
- 校准：`active`；开始时立即把视角俯仰归 0，并把姿态重定向到 neutral（受 `POSTURE_LIMITS.minDurationMs` 约束，≤1 s 到位）；期间拒绝姿态、眼高与视角命令。

故障判定：姿态超过 1.5 s 未更新（沿用现有 `poseStale`）、`ERROR`、`onRenderProcessGone`、页面重载（WS 重连后重新同步状态）。`/ws` 断开等同控制通道故障：页面立即冻结运动、显示故障并指数退避重连；没有 SSE/轮询回退。任何故障都**冻结当前俯仰**，不做自动回中，避免二次运动。

## 4. 干预目录

| 干预 | 命令 | 范围 / 粒度 | 过渡与限速 | 停止 / 异常行为 | 审计 |
| --- | --- | --- | --- | --- | --- |
| 场景 | `scene:<id>` | `landscape / ward / bathroom / lab` | 立即切换，无过渡 | 会话中拒绝并回显原场景 | 记录 id |
| 声音 | `audio:on / off / toggle` | 二值 | 立即 | 断开保持最后值 | 记录目标值 |
| 眼高 | `settings:eyeheight:<m>` | 1.20–1.90 m，0.05 m 步进，两位小数 | 会话中应用时 500 ms 缓动；`calibrating` 禁用 | 越界值整条命令拒绝，保留旧值 | 记录请求值与是否持久化 |
| 姿态预设 | `posture:rise / lower / stop` | 坐起轨迹（髋 0.45 m、躯干 0.55 m、站立眼高 1.70 m，12 s）；`worldFor(head)` 反演镜头→世界；确认键短按坐起/回躺，长按菜单 | 缓入缓出；停止/失权立即冻结当前进度 | `stop` 冻结在当前值（不回弹） | 记录命令与完成进度 |
| 姿态自定义 | 映射到同一 `comfort.setPosture`（协议保留，平板 UI 不提供） | pitch ±20°、roll ±10°、rise 0–1.2 m、duration 1–30 s | 由 duration 与限速推导最小合法时长 | 同上 | 记录全部四项 |
| 校准 | `calibrate / recalibrate` | 两姿态：天花板、脚尖 | 采集稳定后倒计时；隐藏场景；开始时俯仰归 0、姿态重定向 neutral（≤1 s） | 失败**保留旧校准**；姿态保持 neutral | 记录结果、角度、置信度 |
| 视角修正 | `view:move:0,<z>` | x 必须为 0；z ∈ [−1,1] 是**绝对**俯仰目标，`viewPitchDeg = z × 20`，正值上仰 | 页面从**当前**角度平滑重定向；拖动时 ≤10 Hz；无 TTL | 断链、失控、患者停止 → 保持当前角度，不回弹；会话结束/校准开始时回到 0° | 记录目标值 |
| 视角动画 | `view:anim:up\|down\|recenter\|breathe`、`view:stop` | 系统级预设，**无参数**：up/down 相对**当前**角度 ±10°，recenter 回 0°，breathe 为 6 s 回到起点的曲线；曲线与时长由页面定义 | 页面播放；`view:stop` 立即冻结在**当前**俯仰（不回正）；只有 `recenter` 回 0° | 优先级：患者停止 > 租约丢失 > 会话结束/校准 > 显式命令 | 记录预设名与结果 |

命令语义约定：

- 所有命令小写、无换行、≤64 字符（`ControlProtocol.normalize`）。
- 平板在发送前校验，页面再次校验并独立 clamp；任何一侧都不能把越界值直接写进变换。
- 离散命令（场景、眼高、姿态、校准）由操作员明确点击触发，不做连发。
- 连续命令只有 `view:move`，它携带绝对目标而非速度或增量，因此不存在“按住即无限加速”。

重映射门限（P2，`REMAP_LIMITS`）：`remapFromPoses` 按顺序执行——

1. 夹角 <15° 或 >165°，或 pivot 间距 <0.005 m（两次采样几乎同一点）→ `poses-too-similar`；
2. `confidence = sin(angle) < 0.35` → `low-confidence`；
3. 通过后按 `weight = clamp(strength × confidence, 0, 0.85)` 向 identity 混合，并用 `appliedWeight = min(weight, 120° / rawAngle)` 封顶，保证世界永不翻转。

任一失败都**不得**写入 `q0` / `p0` / `calibrated`，旧校准继续生效。默认 `strength = 1.0`；调试时可在 0.7–1.0 调整，但最终权重仍受 0.85 与 120° 上限约束。置信度只在头显状态行与校准结果里显示，平板无法显示（见 §7.3）。

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
| `VIEW_PITCH_MAX` | ±20° | 绝对俯仰修正上限；两端口径一致 |
| `VIEW_PITCH_STEP` | 1° | 平板滑动条步进；线上 `z = 角度 / 20` |
| `VIEW_PITCH_SEND_HZ` | ≤10 | 拖动时发送频率（70 ms 防抖，只发最新值） |
| `VIEW_PITCH_X` | `0`（|x| < 1e-6） | 线上 x 分量；非 0 整条拒绝 |
| `VIEW_ANIM_RECENTER_MS` | 2400 | `view:anim:recenter` 的固定时长（页面定义，不过线） |
| `VIEW_PRESETS` | `up`(1) / `down`(2) / `recenter`(3) / `breathe`(4)；`none`(0) 仅出现在状态帧 | 唯一允许的预设目录；带参数或未知名称整条拒绝 |
| `VIEW_PRESET_UP_DOWN` | 相对当前角度 ±10° | up/down 的幅度，页面实现 |
| `VIEW_BREATHE_MS` | 6000 | breathe 曲线时长，页面实现 |
| `VIEW_TRANSPORT` | `GET /ws?since=<seq>` | 单一 WebSocket：服务端推 `ready/cmd/control`，页面推 `state/telemetry/ack`；无 SSE/轮询回退 |
| `EYE_HEIGHT` | 1.20–1.90 m，默认 1.70，步进 0.05 | 虚拟眼高 |
| `POSTURE` | 默认 pitch ±20°、roll ±10°、rise 0–1.2 m、1–30 s；起身预设显式传 90° | 沿用 `POSTURE_LIMITS`；90° 仅用于天花板→前墙的完整重定向 |
| `POSTURE_RATE` | 小角度微调 pitch/roll ≤ 2°/s、rise ≤ 0.05 m/s；完整起身 90°/30 s 峰值约 5.6°/s | 90° 预设不受微调速率限制，需实机耐受验证；小角度仍按 2°/s |
| `REMAP` | 夹角 15–165°、`confidence ≥ 0.35`、`weight ≤ 0.85`、旋转 ≤ 120° | 两姿态重映射的硬门限 |

不动式约束：

1. **不碰相机。** 不改 `XRCamera`、`renderer.xr.getCamera`、session pose；俯仰修正作用在世界朝向容器上。
2. **无自由飞行、无平移。** `view:move` 只写世界朝向的俯仰修正，x 必须为 0；无 y、无 yaw、无速度、无瞬移。
3. **有界修正。** 俯仰恒定在 ±20° 内，两侧独立 clamp；越界命令整条拒绝，不先饱和再继续推送。
4. **单一 WS，无回退。** 页面只通过 `/ws?since=<seq>` 接收 `cmd`。离散命令保留到页面 `ack`，`view:move` 只保留最新样本；重连按 `since` 补发。没有 `/control` 轮询或 `/events` SSE。
5. **写类型与序号。** 连续 `view:move` 走 Write Without Response，离散命令走 Write With Response 并带 `#<seq>`，头显回 `ACK <seq> <OK|REJECTED|BUSY>`；stop 优先并丢弃待发 pitch。头显对 `view:move:*` 不回执。
6. 眼高只改变“页面假设的头显眼高”，用于场景构建上下文与地板偏移（`host.setFloorOffset(-eyeHeight)`）；它**不是**让患者坐起，UI 文案必须写“视角高度”，不写“抬高患者”。

禁用矩阵（任一成立即拒绝或立即冻结）：

| 事件 | 视角俯仰 | 姿态 | 眼高 |
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
| `ControlTopBar` | `ControlScreen.kt` | 连接、信号、接管、打开/收起控制栏与断开；只读状态，不做运动决策 | 始终 |
| `StatusPanel` | `ui/components/StatusPanel.kt` | 场景、会话、眼高、校准置信度、姿态进度/俯仰/起身高度、姿态新鲜度 | 信息条展开 |
| `DisconnectedBanner` | `ControlScreen.kt` | 断链/错误提示与重连/离开 | `DISCONNECTED` / `ERROR` / `IDLE` |
| `AngleGauge` | `ui/components/AngleGauge.kt` | **只读**显示 `yaw`（±180°）与 `pitch`（±90°），整数度、1° 分辨率，`Canvas` 绘制，无点击区域与手势；5 Hz 更新，过期时降低不透明度并显示“无数据” | `pose != null` |
| `EyeHeightStepper` | `ui/components/EyeHeightStepper.kt` | 1.20–1.90、0.05 步进；本地立即回显请求值，收到 `OK:settings:eyeheight:*` 后标记“已生效”；300 ms 防抖合并连点 | `READY` + 已取得租约 + 未在校准中 |
| `ViewPitchSlider` | `ui/components/ViewPitchSlider.kt` | −20°–+20°、1° 步进的绝对俯仰滑动条；`上仰` / `下俯` / `回正` / `呼吸` 四个系统级预设（`view:anim:*`）；`停止（保持）` 发 `view:stop`；显示 `viewPreset`、`viewAnim` 相位与当前角度 | `READY` + 已取得租约 + 会话中 + 未在校准 |
| `SessionAction` | `ui/components/ControlRail.kt` | 训练页签中的红色全宽按钮：会话中发 `stop`（结束训练），否则发 `enter`；患者确认键/停止始终优先 | 已连接 |

Compose 实现要点：

- `ControlUiState` 只增加低频字段：`eyeHeightRequested`、`eyeHeightConfirmed`、`viewPitchRequested`。**滑动条的实时位置不进 `ControlUiState` 的高频路径**：拖动期间 `viewPitchRequested` 承载本地请求值，收到 `state.viewPitch` 回读并落在半度以内后清空，滑动条重新跟随头显。
- 发送用防抖而不是循环：`ControlViewModel` 持有 `viewPitchJob`，70 ms 内只发最新值（≤10 Hz）。`onCleared`、`DISCONNECTED`、`CONTROL_REQUIRED`、`onControlLost` 取消该任务但**不**发 `view:stop`——冻结帧由页面/租约语义保证；平板只在用户点 `停止（保持）` 时发 `view:stop`，点 `回正` 时发 `view:anim:recenter`。
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
view:move:0,<z>        x 必须为 0；z 为十进制浮点 ∈[-1,1]；viewPitchDeg = z × 20
view:anim:up           预设：相对当前角度 +10°
view:anim:down         预设：相对当前角度 -10°
view:anim:recenter     预设：缓动回到 0°
view:anim:breathe      预设：6 s 回到起点的呼吸曲线
view:stop              立即冻结在当前角度（打断语义），不回正
```

- 解析入口：`ControlProtocol.VIEW_MOVE` / `VIEW_STOP` / `VIEW_ANIM` / `parseViewMove()` / `parseViewAnim()`。
- `view:anim:<name>` 的 name 只能是 `up`、`down`、`recenter`、`breathe`；带参数、未知名称或多余字符整条拒绝。头显把 id 当作不透明值转发，不解释曲线。离散命令回 `OK:<cmd>`，`view:move` 仍然免回执。
- `view:move` 恰好两个分量，`,` 分隔，无空格；`|x| ≥ 1e-6`、任一分量非有限或越界即整条拒绝。
- `z` 是**绝对**俯仰目标，不是速度或增量；没有 TTL，目标保持到下一次 `view:move`。页面从**当前**角度平滑重定向。
- 符号约定：正值 = 上仰（患者看到更多天空，世界相对向下倾斜）；页面若内部俯仰方向相反，只在世界变换内取反，线上语义不变。
- 平板拖动时最多 10 Hz（70 ms 防抖），空闲时不重复发送；预设动画不发送任何时长。
- 状态帧回报**当前已应用**的俯仰（不是目标）、动画相位 `viewAnim`（`idle` / `playing` / `held`）与当前预设 id `viewPreset`（`none|up|down|recenter|breathe`）。平板只回显，不从按钮推断运动状态。
- 优先级由页面/会话拥有：患者停止 > 租约丢失 > 会话结束/校准重置 > 显式命令。头显不重新实现状态机，只转发与回报。
- 租约丢失时保持当前角度，`view:stop` 不回正；只有 `view:anim:recenter` 才回到 0°。

#### 7.2.1 页面下行传输

```text
GET /ws?since=42   （RFC 6455，文本帧 JSON）
{"type":"ready","seq":42,"control":true}
{"type":"cmd","seq":43,"command":"view:move:0,0.4","continuous":true}
{"type":"cmd","seq":44,"command":"scene:ward","continuous":false}
```

- 连接建立先发 `ready`，随后补发 `seq > since` 的离散命令与最新 `view:move`；页面按 `seq` 去重/合并。
- 离散命令保留到页面 `ack`；`view:move` 免 ack、只留最新；`view:anim:*` 不跨重连重放。
- 每个订阅有界队列，连续帧合并、离散帧优先保留；服务停止/断线时关闭连接，客户端指数退避重连。
- 页面通过同一 WS 发 `state`、`telemetry`、`ack`；没有 `/state`、`/telemetry` POST 或 `/control` 轮询。

### 7.3 保持不变

- **`ControlState` 为 13 字节二进制 v5**：`[8]` 是**当前已应用**的 `viewPitch` 有符号整数度（−20..20），`[9]` 是 `viewAnim`（0 idle / 1 playing / 2 held），`[12]` 是 `viewPreset`（0 none / 1 up / 2 down / 3 recenter / 4 breathe）；`viewX`/`viewZ` 已删除。版本不等于 5 或长度不是 13 的帧直接丢弃，不提供旧版本兼容层。
- `telemetry` 仍是 20 字节 `x,y,z,yaw,pitch`；因此平板**无法**显示 roll，也不显示重映射置信度——这两个数字只在头显页面状态行与校准结果里出现。
- `status` 语义不变：`OK:<cmd>` 只表示“头显服务已接收”，`view:move` 免回执。
- 已知缺口：平板无法回读持久化眼高，重连后 `EyeHeightStepper` 只能显示进程内最后确认值或默认 1.70（标注“未确认”）。回读需要新增特性或状态字段，列入 P4。
- `ControlProtocol.stateMaxBytes = 13`、`stateVersion = 5`；13 字节仍落在默认 ATT 负载（20 字节）内。新增字段需要新版本号，并同步两端。

## 8. 验收用例

| # | 场景 | 操作 | 期望 |
| --- | --- | --- | --- |
| A1 | 松手保持 | 把滑动条拖到 `view:move:0,0.6`（+12°）后松手 | 拖动期间 ≤10 Hz 只发最新值；页面从当前角度平滑重定向到 +12° 并保持（无 TTL、不回弹）；平板回读当前角度 +12° |
| A2 | 断链 | 拖动滑动条时关闭平板蓝牙或远离 | 本地立即停止发送；页面保持当前角度（不回正、动画停止），头显因租约丢失入队一条 `posture:stop`；平板进入 `DISCONNECTED`；重连后滑动条显示头显回读值，不会自动续发 |
| A3 | 患者停止优先 | 俯仰修正中 + 姿态上升中，患者按确认键、从 XR 菜单退出或摘下头显 | 当帧冻结姿态插值与俯仰缓动；会话结束并把俯仰归 0°；平板所有运动控件禁用，直至重新进入 |
| A4 | 越界拒绝 | 依次发送 `settings:eyeheight:2.4`、`settings:eyeheight:NaN`、`view:move:1.5,0`、`view:move:0.5,0`（x≠0）、`view:move:0.2` | 全部拒绝，不落盘、不改变当前值、页面不改变俯仰；日志记录原始命令 |
| A5 | 低置信度重映射 | 两次校准方向夹角约 20°（或约 160°） | 返回 `low-confidence`；**旧校准保留**；姿态与俯仰仍为 neutral；状态行显示失败原因。夹角约 10° 时返回 `poses-too-similar` |
| A6 | 重连恢复眼高 | 设 1.35 → 释放租约 → 重新进入训练（或刷新页面） | bootstrap 携带 `eyeHeight: 1.35`；页面初始高度与地板偏移使用 1.35；平板步进器显示“未确认”（见 §7.3）。仅重连 BLE 而不刷新页面时 bootstrap 不更新，属已知缺口 |
| A7 | 俯仰上限 | 把滑动条推到两端并反复来回 | 目标始终在 ±20° 内，x 恒为 0；无累积漂移、无抖动、来回不放大 |
| A8 | 校准中禁用 | 校准倒计时期间拖滑动条、改眼高、点起身 | 全部拒绝；俯仰目标为 0°，姿态 ≤1 s 内到 neutral 并保持；校准不被中断 |
| A9 | 第二台平板 | 租约被占时第二台连接并 `CLAIM` | `CONTROL_BUSY`；第二台停留在配对页，无任何干预入口 |
| A10 | 异常页面 | 控制中重载页面或渲染进程崩溃 | 页面重放快照后状态一致；运动立即失效；`DisconnectedBanner` / `StatusPanel` 显示故障原因 |
| A11 | 租约丢失冻结姿态 | 起身过程中第二台平板抢到租约（或本机断链） | 头显每次租约丢失只入队**一条** `posture:stop`，姿态冻结在当前进度；视角俯仰保持当前角度，不回正；平板视角与姿态控件禁用并给出原因 |
| A12 | 推送中断 | 控制中关闭头显 `/ws` 连接（服务仍在）并持续拖动滑动条 | 页面立即冻结运动并显示故障；指数退避重连后带 `since=lastSeq` 补发；`seq` 去重保证命令不重复执行；停手后目标保持；不出现 SSE/轮询回退 |

验收以“命令是否被接受 + 观测量是否在界内”为准，不依赖动画观感；眩晕相关的观感在 PICO 上单独实测并记录（`docs/performance-evidence.md` 的方式）。

## 9. 实现落点

| 层 | 文件 | 需要的变化 |
| --- | --- | --- |
| 协议 | `android/protocol/.../ControlProtocol.kt` | `SETTINGS_EYE_HEIGHT`、`EYE_HEIGHT_MIN/MAX/DEFAULT`、`parseEyeHeight()`；`VIEW_MOVE`、`VIEW_STOP`、`VIEW_ANIM`、`VIEW_PITCH_MAX_DEG`、`parseViewMove()`（要求 x≈0）、`parseViewAnim()`；`ViewAnim` / `ViewPreset` 枚举；`HELLO/WELCOME/ACK` 与 `#<seq>` 语法；`stateVersion = 5`、13 字节，`viewPitch`/`viewAnim`/`viewPreset` 编解码 |
| 头显 | `HeadsetSettings.kt`、`PortalActions.kt`（LaunchOptions）、`PortalSession.kt` | `eyeHeight` 持久化（`settings.eyeHeight`）与 bootstrap 注入 |
| 头显 | `PortalService.kt`、`ControlLog.kt`、`WsFrameCodec.kt` | `/ws` 服务端；ack 保留区（离散 ≤64、最新 continuous）；WS `state`/`telemetry` 解码；`/status` 暴露 state 摘要；租约丢失入队一条 `posture:stop` |
| 头显 | `BluetoothControl.kt` | `HELLO/WELCOME` 门控；`#<seq>` 解析、有界去重、`ACK <seq> <result>`；`view:move` 免回执 |
| 页面 | `src/app/config.ts`、`src/app/App.ts`、`src/app/portal-link.ts` | 读取 `bootstrap.eyeHeight`；单一 WS 的 cmd/state/telemetry/ack；断线退避 + `since` 续传 |
| 变换 | `src/core/xr/comfort.ts`、`src/core/scene/host.ts` | 俯仰写入世界朝向容器（`content.rotation.x` 一类）；**不得**写 `comfort.group.position`，该值每帧被 `applyTransform` 覆盖；不再做位置平移 |
| 校准 | `src/ui/calibration.ts`、`src/core/xr/comfort.ts`、`App.beginCalibration/onCalibrationResult` | `REMAP_LIMITS` 门限与封顶；开始采集立即把俯仰目标归 0、把姿态重定向 neutral（≤1 s）；失败不覆盖旧校准 |
| 平板 | `ControlUiState.kt`、`ControlActions.kt`、`ControlViewModel.kt`、`ui/components/ViewPitchSlider.kt` | 第四页签“视角”：滑动条 70 ms 防抖发送；四个 `view:anim:*` 预设、`停止（保持）` 发 `view:stop`；显示 `state.viewPreset`、`viewAnim` 相位与 `state.viewPitch` 当前角度；无摇杆、无额外权限开关 |

任何文件改动若超出本表，先回到本文补充契约，再动代码。
