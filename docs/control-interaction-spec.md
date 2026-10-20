# 控制交互规格（v0.8）

本文是 v0.8 的**交互与安全契约**，不是实现说明。协议字段、范围、停止语义以本文为准；实现落点见各节末尾的代码归属。现有链路背景见 `docs/control-plane.md`，虚拟体位的变换设计见 `docs/virtual-posture.md`。

设计底线：**患者随时能停；操作员永远不能直接操纵相机；任何连续运动都会自己过期。**

## 1. 需求分组与优先级

| 组 | 内容 | 优先级 | 发布判据 |
| --- | --- | --- | --- |
| P0 | 停止优先权、单租约授权、命令白名单、范围校验、运动 TTL、故障禁用 | 必须随 v0.8 首发 | 任一安全用例失败即阻塞发布 |
| P1 | 眼高输入（1.2–1.9 m）、只读角度呈现 | 与 P0 同版 | 眼高经 bootstrap 到页面；角度只读 |
| P2 | 舒适重映射优化：置信度门限、失败不覆盖旧校准、操作员可见结果 | 与 P0 同版 | 低置信度重映射被拒绝 |
| P3 | 平板摇杆虚拟视角平移（世界位移，非相机位移） | 同版但可独立回退 | 松开/断链/失控 300 ms 内停 |
| P4 | 审计持久化、眼高回读、`view:center`、姿态字段上链路 | 不承诺 | 需要协议扩展，另开切片 |

冲突裁决顺序：P0 > P1 > P2 > P3。P1–P3 各自失败时，关闭该组命令（从 `ControlProtocol.CAPABILITIES` 移除）即可退回 v0.7 行为，不得让 P0 语义退化。

## 2. 角色与权限矩阵

| 角色 | 载体 | 身份边界 |
| --- | --- | --- |
| 患者 | 头显（右侧确认键、XR 菜单、摘下头显） | 无租约、无命令；拥有**无条件停止权** |
| 照护者 / 操作员 | 平板 `ControlScreen`，默认模式 | 持有 BLE 租约的任意平板；邻近即授权 |
| 治疗师 / 高级模式 | 平板，`AdvancedModeGate` 解锁后 | 仅放宽到姿态自定义与重映射参数；不获得停止豁免 |

| 干预 | 患者 | 照护者 | 治疗师（高级） |
| --- | --- | --- | --- |
| 停止训练 / 冻结运动 | 始终可用 | 可用 | 可用 |
| 开始、预览、结束会话 | 仅头显手势可启动 WebXR | 可用 | 可用 |
| 场景、声音 | — | 可用（会话中拒绝换场景） | 可用 |
| 眼高 | — | 1.20–1.90 m，0.05 步进 | 同左 |
| 视角平移（摇杆） | — | 可用 | 可用 |
| 姿态预设（起身 / 回躺 / 停止） | 停止可用 | 可用 | 可用 |
| 姿态自定义（pitch / roll / rise / duration） | — | 不可见 | 硬限内可用 |
| 方向校准 | 可用（头显内） | 触发校准 | 触发校准 |
| 重映射强度 / 柔和校准 | — | 不可见 | 0.7–1.0，仅调试 |
| 释放租约 / 断开 | — | 可用 | 可用 |

硬规则：

1. **患者停止永远赢。** 不询问、不确认、不被高级模式覆盖；停止后平板所有连续命令立即失效，直到患者重新进入会话且租约仍在。
2. **先到先得。** 第一台 `CLAIM` 的平板持有租约（`BluetoothControl` 内的控制器地址）；第二台只看到配对页与 `CONTROL_BUSY`，永远拿不到干预按钮。
3. 租约丢失（`CONTROL_REQUIRED`、断链、`RELEASE`、服务重启）等同于一次停止事件：冻结运动、禁用摇杆与姿态按钮、隐藏高级模式。
4. 高级模式是**会话级内存状态**，解锁需要长按 1.5 s 并在二次确认中点击；断链、失控、退出应用即失效，不写入 SharedPreferences。
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
| `idle` | `BlePhase.IDLE / DISCONNECTED / SCANNING` | 未启动 | 无 | 速度、视角偏移 |
| `paired` | `CONNECTING / AUTHENTICATING` | — | 无（只显示连接进度） | 同上 |
| `claimed` | `READY && controlGranted` | `controlMode = true` | 场景、声音、预览、眼高、结束 | 同上 |
| `scene-confirmed` | `READY` + `control.scene ∈ SCENE_IDS` | `handle != null` | 同 `claimed`；页面已加载场景 | 同上 |
| `active` | `control.session == true` | `session != null && xr.isPresenting` | 全部（姿态需已校准；摇杆需已校准；校准可再次触发） | — |
| `calibrating` | `control.calibrating == true` | `calibration.isActive()` | 仅停止、结束 | **速度、视角偏移；姿态目标 neutral（≤1 s 到位）** |
| `paused-stopped` | `control.session == false` | 会话结束 / 预览 | 场景、声音、眼高、预览；校准需重新进入会话 | 速度、视角偏移、姿态回到 neutral |
| `fault` | `BlePhase.ERROR`、`poseStale`、`CONTROL_REQUIRED` | 页面重载、渲染进程重启 | 仅重新连接/重新接管 | 全部运动立即冻结 |

前置条件（不满足即按钮禁用，而不是点击后报错）：

- 摇杆：`active` + `controlGranted` + 已校准 + 未在校准中 + 遥测未过期。
- 姿态：`active` + 已校准；`POSTURE_LIMITS` 硬限。
- 眼高：`claimed` 及以上；`calibrating` 时禁用。
- 校准：`active`；开始时立即清零视角偏移，并把姿态重定向到 neutral（受 `POSTURE_LIMITS.minDurationMs` 约束，≤1 s 到位）；期间拒绝姿态、眼高与视角命令。

故障判定：姿态超过 1.5 s 未更新（沿用现有 `poseStale`）、`ERROR`、`onRenderProcessGone`、页面重载（`window.qsControl` 重放快照后必须重新同步状态）。`/events` 断开只是传输降级：页面立即改用 100 ms 轮询，不进入 `fault`；只有轮询也失败且姿态过期才升级。任何故障都**冻结当前偏移**，不做自动回中，避免二次运动。

## 4. 干预目录

| 干预 | 命令 | 范围 / 粒度 | 过渡与限速 | 停止 / 异常行为 | 审计 |
| --- | --- | --- | --- | --- | --- |
| 场景 | `scene:<id>` | `landscape / ward / bathroom / lab` | 立即切换，无过渡 | 会话中拒绝并回显原场景 | 记录 id |
| 声音 | `audio:on / off / toggle` | 二值 | 立即 | 断开保持最后值 | 记录目标值 |
| 眼高 | `settings:eyeheight:<m>` | 1.20–1.90 m，0.05 m 步进，两位小数 | 会话中应用时 500 ms 缓动；`calibrating` 禁用 | 越界值整条命令拒绝，保留旧值 | 记录请求值与是否持久化 |
| 姿态预设 | `posture:rise / lower / stop` | 起身：pitch −8°、rise 0.45 m、14 s；回躺：0°/0 m、12 s | 缓入缓出，匀速上限见 §5 | `stop` 冻结在当前值（不回弹） | 记录命令与完成进度 |
| 姿态自定义 | 高级模式，映射到同一 `comfort.setPosture` | pitch ±20°、roll ±10°、rise 0–1.2 m、duration 1–30 s | 由 duration 与限速推导最小合法时长 | 同上 | 记录全部四项 |
| 校准 | `calibrate / recalibrate` | 两姿态：天花板、脚尖 | 采集稳定后倒计时；隐藏场景；开始时偏移清零、姿态重定向 neutral（≤1 s） | 失败**保留旧校准**；姿态保持 neutral | 记录结果、角度、置信度 |
| 视角平移 | `view:move:<x>,<z>`、`view:stop` | x,z ∈ [−1,1]，死区 0.08，输出最大 0.3 m/s | 500 ms 加速、200 ms 减速；偏移总量 ≤0.45 m | 300 ms 无更新、松开、断链、失控、患者停止 → 速度归零并冻结偏移 | 只记录流开始/结束、峰值速度与偏移 |
| 回中（提案） | `view:center` | 偏移 → 0 | 1.5 s 缓动 | 只清偏移，不动姿态 | 记录触发者与耗时 |

命令语义约定：

- 所有命令小写、无换行、≤64 字符（`ControlProtocol.normalize`）。
- 平板在发送前校验，页面再次校验并独立 clamp；任何一侧都不能把越界值直接写进变换。
- 离散命令（场景、眼高、姿态、校准）由操作员明确点击触发，不做连发。
- 连续命令只有 `view:move`，永不进入“按住即无限加速”的模式。

重映射门限（P2，`REMAP_LIMITS`）：`remapFromPoses` 按顺序执行——

1. 夹角 <15° 或 >165°，或 pivot 间距 <0.005 m（两次采样几乎同一点）→ `poses-too-similar`；
2. `confidence = sin(angle) < 0.35` → `low-confidence`；
3. 通过后按 `weight = clamp(strength × confidence, 0, 0.85)` 向 identity 混合，并用 `appliedWeight = min(weight, 120° / rawAngle)` 封顶，保证世界永不翻转。

任一失败都**不得**写入 `q0` / `p0` / `calibrated`，旧校准继续生效。默认 `strength = 1.0`；高级模式可在 0.7–1.0 调整，但最终权重仍受 0.85 与 120° 上限约束。置信度只在头显状态行与校准结果里显示，平板无法显示（见 §7.3）。

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
| `VIEW_TTL_MS` | 300 | 最后一次 `view:move` 后允许继续运动的时间 |
| `VIEW_REPEAT_HZ` | 10 | 按住时发送频率 |
| `VIEW_MAX_SPEED` | 0.30 m/s | 合成速度上限（对角也按向量模长限速） |
| `VIEW_MAX_OFFSET` | 0.45 m | 水平偏移模长上限 |
| `VIEW_DEADZONE` | 0.08 | 归一化输入死区 |
| `VIEW_RAMP_IN / OUT` | 500 / 200 ms | 加减速时间 |
| `VIEW_TRANSPORT` | `GET /events`（SSE）优先；`GET /control` 轮询 100 ms 兜底 | `/events` 推送与 `/control` 同形的 control JSON；轮询只在 EventSource 不可用或断开时启用 |
| `EYE_HEIGHT` | 1.20–1.90 m，默认 1.60，步进 0.05 | 虚拟眼高 |
| `POSTURE` | pitch ±20°、roll ±10°、rise 0–1.2 m、1–30 s | 沿用 `POSTURE_LIMITS` |
| `POSTURE_RATE` | pitch/roll ≤ 2°/s，rise ≤ 0.05 m/s | 由时长下限强制 |
| `REMAP` | 夹角 15–165°、`confidence ≥ 0.35`、`weight ≤ 0.85`、旋转 ≤ 120° | 两姿态重映射的硬门限 |

不动式约束：

1. **不碰相机。** 不改 `XRCamera`、`renderer.xr.getCamera`、session pose；平移作用在世界内容容器上。
2. **无自由飞行。** 只有水平 (x, z) 平移，无 y、无旋转、无俯仰、无速度加成、无瞬移。
3. **有界偏移。** 到达 0.45 m 时，把“继续向外”的分量清零，允许沿边界滑动；不得越界后再弹回。
4. **推送优先，轮询兜底。** 页面通过 `/events`（SSE）接收与 `/control` 同形的快照，首帧即对齐 `seq` 与当前命令；EventSource 缺失、连接失败或流关闭时才退回 100 ms 轮询 `/control`。`pendingControl` 是单槽“最新值”，中间样本被覆盖是允许的，但任意两次可达样本的间隔必须 < 300 ms。SSE 只做传输优化，不改变 TTL、`seq` 去重或命令语义；订阅数有上限，超出返回 503 并继续走轮询。
5. **写类型。** 连续命令走 Write Without Response（`QuietShoreBleManager` 当前为 `WRITE_TYPE_DEFAULT`）；忙或需确认时退回默认写。头显对 `view:move:*` 不再回 `OK:` 通知，否则每秒 10 次的写回执 + 状态广播会挤占连接间隔；`view:stop` 仍回执。
6. 眼高只改变“页面假设的头显眼高”，用于场景构建上下文与地板偏移（`host.setFloorOffset(-eyeHeight)`）；它**不是**让患者坐起，UI 文案必须写“视角高度”，不写“抬高患者”。

禁用矩阵（任一成立即拒绝或立即冻结）：

| 事件 | 摇杆 | 姿态 | 眼高 |
| --- | --- | --- | --- |
| 未接管 / `CONTROL_REQUIRED` | 拒绝 | 拒绝 | 拒绝 |
| 未进入 XR 或会话已结束 | 拒绝 | 拒绝 | 允许 |
| 校准进行中 | 冻结 + 拒绝 | 重定向 neutral（≤1 s）后冻结并拒绝 | 拒绝 |
| 遥测过期 >1.5 s | 冻结 | 冻结 | 允许 |
| 断链 / 页面重载 / 渲染进程崩溃 | 冻结 | 冻结 | 拒绝 |
| 患者停止 | 冻结 | 冻结 | 允许 |

## 6. 控制 UI 组件图（Compose）

| 组件 | 文件（建议） | 职责 | 启用条件 |
| --- | --- | --- | --- |
| `SafetyStrip` | `ui/components/SafetyStrip.kt` | 顶部常驻：连接、租约持有者、会话阶段、遥测新鲜度、当前运动状态与眼高；异常时整条变琥珀/红并给出原因 | 始终 |
| `EmergencyStop` | 并入 `SafetyStrip` 与 `ControlRail` | 大号、全宽；不等待回执连续下发 `stop`、`view:stop`、`posture:stop`，`stop` 必须第一条 | 始终可点 |
| `AngleGauge` | `ui/components/AngleGauge.kt` | **只读**显示 `yaw`（±180°）与 `pitch`（±90°），整数度、1° 分辨率，`Canvas` 绘制，无点击区域与手势；5 Hz 更新，过期时降低不透明度并显示“无数据” | `pose != null` |
| `EyeHeightStepper` | `ui/components/EyeHeightStepper.kt` | 1.20–1.90、0.05 步进；本地立即回显请求值，收到 `OK:settings:eyeheight:*` 后标记“已生效”；300 ms 防抖合并连点 | `claimed` 及以上且未在校准中 |
| `JoystickPad` | `ui/components/JoystickPad.kt` | `pointerInput` 拖拽 → 归一化向量；死区、圆形边界、松手回弹；按住时 10 Hz 发送，抬起/取消发 `view:stop`；显示偏移预算条（0→0.45 m） | `active` + 已校准 |
| `AdvancedModeGate` | `ui/components/AdvancedModeGate.kt` | 长按 1.5 s + 二次确认；解锁后展开姿态自定义；断链自动收起 | `active` |
| `MotionNotice` | `ui/components/SafetyStrip.kt` | 运动中的文案：“患者视角正在水平移动”，不写“飞行/传送” | 运动中 |

Compose 实现要点：

- `ControlUiState` 只增加低频字段：`eyeHeightRequested`、`eyeHeightConfirmed`、`advancedUnlocked`、`motionActive`、`safetyReason`。**摇杆向量不进 `ControlUiState`**，用 `JoystickPad` 内部 `mutableStateOf(Offset.Zero)`，避免 10 Hz 触发整屏重组。
- 发送循环放在 `ControlViewModel` 或 `LaunchedEffect(isDragging)` 中，用 `withFrameNanos`/固定间隔合并；ViewModel 持有 `viewJob`，`onCleared`、`DISCONNECTED`、`CONTROL_REQUIRED`、`onControlLost` 一律 `view:stop` 并取消协程。
- 所有禁用都是“组件禁用 + 命令闸门”双保险，不能只靠 `enabled`。
- 沿用现有 `QuietPalette`、`ControlRail` 分区与按钮尺寸；不新增可滚动长页（`requirements.md §9.1`）。

## 7. 协议演进

### 7.1 眼高：bootstrap 注入，不改状态帧

```
HeadsetSettings.eyeHeight  (SharedPreferences "settings.eyeHeight", 1.20–1.90, 默认 1.60)
  → LaunchOptions.eyeHeight
  → PortalSession.toJson() 增加 "eyeHeight": 1.35
  → PortalService 注入 window.__QS_BOOTSTRAP__
  → src/app/config.ts readConfig: bootstrap.eyeHeight，clamp 1.2–1.9，默认 1.6
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

### 7.2 视角平移

```
view:move:<x>,<z>      x,z 为十进制浮点，∈[-1,1]；例：view:move:0.4,-0.2
view:stop
view:center            （提案，未进入 v0.8 白名单）
```

- 解析入口：`ControlProtocol.VIEW_MOVE` / `VIEW_STOP` / `parseViewMove()`（返回 `ViewMove(x, z)`）。
- 恰好两个分量，`,` 分隔，无空格；任一分量非有限或越界即整条拒绝。
- 页面在收到时打单调时间戳；`now - lastMoveAt > 300 ms` 视为停止。
- 不允许在 `x` 或 `z` 中编码角度、速度或设备信息。

#### 7.2.1 页面下行传输

```
GET /events   text/event-stream
event: control
data: {"seq":42,"command":"view:move:0.4,-0.2","control":true}
```

- 帧内容与 `GET /control` 完全同形；订阅建立时先推一帧当前快照，随后的每个被接受命令各推一帧。
- 保留 `/control` 与 `seq` 去重：SSE 不可用、被代理截断或订阅数超限（503）时，页面退回 100 ms 轮询。
- SSE 是纯传输优化，不新增命令、不改变 TTL，也不进入 BLE 或 `ControlState`；平板端完全不受影响。
- 每个订阅有界队列，慢客户端只拖慢自己；服务停止时关闭流，客户端按退避重连。

### 7.3 保持不变

- **`ControlState` 线格式不变**：仍是 `scene|session|calibrating|audioMuted`。眼高、偏移、姿态进度都**不**进状态帧。
- `telemetry` 仍是 20 字节 `x,y,z,yaw,pitch`；因此平板**无法**显示 roll，也不显示重映射置信度——这两个数字只在头显页面状态行与校准结果里出现。
- `status` 语义不变：`OK:<cmd>` 只表示“头显服务已接收”，`view:move` 免回执。
- 已知缺口：平板无法回读持久化眼高，重连后 `EyeHeightStepper` 只能显示进程内最后确认值或默认 1.60（标注“未确认”）。回读需要新增特性或状态字段，列入 P4。
- `ControlProtocol.stateMaxBytes = 20` 的假设不变；新增字段留到 P4，届时需一并解决 ATT 负载与场景名截断。

## 8. 验收用例

| # | 场景 | 操作 | 期望 |
| --- | --- | --- | --- |
| A1 | 松开摇杆 | 按住 `view:move:0.8,0` 1 s 后松手 | 立即发 `view:stop`；300 ms 内速度归零；偏移**保持**当前位置，不回弹；平板上摇杆回中 |
| A2 | 断链 | 摇杆按住时关闭平板蓝牙或远离 | 页面 300 ms 内过期停住；平板进入 `DISCONNECTED`；重新连接后不会自动续走 |
| A3 | 患者停止优先 | 摇杆按住 + 姿态上升中，患者按确认键、从 XR 菜单退出或摘下头显 | 当帧冻结速度与姿态插值；会话结束；平板所有运动控件禁用，直至重新进入 |
| A4 | 越界拒绝 | 依次发送 `settings:eyeheight:2.4`、`settings:eyeheight:NaN`、`view:move:1.5,0`、`view:move:0.2` | 全部拒绝，不落盘、不改变当前值、页面不产生位移；日志记录原始命令 |
| A5 | 低置信度重映射 | 两次校准方向夹角约 20°（或约 160°） | 返回 `low-confidence`；**旧校准保留**；姿态与偏移仍为 neutral；状态行显示失败原因。夹角约 10° 时返回 `poses-too-similar` |
| A6 | 重连恢复眼高 | 设 1.35 → 释放租约 → 重新进入训练（或刷新页面） | bootstrap 携带 `eyeHeight: 1.35`；页面初始高度与地板偏移使用 1.35；平板步进器显示“未确认”（见 §7.3）。仅重连 BLE 而不刷新页面时 bootstrap 不更新，属已知缺口 |
| A7 | 偏移上限 | 满杆对角持续 30 s | 速度 ≤0.3 m/s，偏移模长 ≤0.45 m，到界后不抖动、不穿透、不加速 |
| A8 | 校准中禁用 | 校准倒计时期间拖摇杆、改眼高、点起身 | 全部拒绝；速度与偏移为 0，姿态 ≤1 s 内到 neutral 并保持；校准不被中断 |
| A9 | 第二台平板 | 租约被占时第二台连接并 `CLAIM` | `CONTROL_BUSY`；第二台停留在配对页，无任何干预入口 |
| A10 | 异常页面 | 控制中重载页面或渲染进程崩溃 | 页面重放快照后状态一致；运动立即失效；`SafetyStrip` 显示故障原因 |
| A11 | 高级模式失效 | 解锁高级模式后断开重连 | 高级模式自动关闭；姿态自定义参数恢复为只读隐藏 |
| A12 | 推送中断 | 控制中关闭头显 `/events` 订阅（服务仍在）并保持摇杆按住 | 页面在一个退避周期内退回 100 ms 轮询；运动连续不中断；`seq` 去重保证命令不重复执行；松开后 300 ms 内停；期间不出现 `fault` |

验收以“命令是否被接受 + 观测量是否在界内”为准，不依赖动画观感；眩晕相关的观感在 PICO 上单独实测并记录（`docs/performance-evidence.md` 的方式）。

## 9. 实现落点

| 层 | 文件 | 需要的变化 |
| --- | --- | --- |
| 协议 | `android/protocol/.../ControlProtocol.kt` | `SETTINGS_EYE_HEIGHT`、`EYE_HEIGHT_MIN/MAX/DEFAULT`、`parseEyeHeight()`；`VIEW_MOVE`、`VIEW_STOP`、`parseViewMove()`；`isAllowedCommand` 与 `CAPABILITIES` 同步；`stateMaxBytes` 不变 |
| 头显 | `HeadsetSettings.kt`、`PortalActions.kt`（LaunchOptions）、`PortalSession.kt` | `eyeHeight` 持久化（`settings.eyeHeight`）与 bootstrap 注入 |
| 头显 | `PortalService.kt` | 眼高解析/落盘/转发；`view:move` 单槽转发；状态广播 |
| 头显 | `BluetoothControl.kt` | 回执前白名单校验；`view:move` 免回执 |
| 页面 | `src/app/config.ts`、`src/app/App.ts`、`src/app/remote-control.ts` | 读取 `bootstrap.eyeHeight`；眼高与平移处理；`/events` SSE 优先、100 ms 轮询兜底 |
| 变换 | `src/core/xr/comfort.ts`、`src/core/scene/host.ts` | 平移写入 `SceneHost.content.position.x/z`（`y` 留给 `floorOffset`），或作为 `comfort.group` 的父级；**不得**写 `comfort.group.position`，该值每帧被 `applyTransform` 覆盖 |
| 校准 | `src/ui/calibration.ts`、`src/core/xr/comfort.ts`、`App.beginCalibration/onCalibrationResult` | `REMAP_LIMITS` 门限与封顶；开始采集立即清零视角偏移、把姿态重定向 neutral（≤1 s）；失败不覆盖旧校准 |
| 平板 | `ControlUiState.kt`、`ControlActions.kt`、`ControlViewModel.kt`、`ui/components/*` | 新组件与闸门；摇杆 10 Hz 发送与停止 |

任何文件改动若超出本表，先回到本文补充契约，再动代码。
