# 系统边界与控制集成点

本文固定三层的职责、禁止依赖，以及 BLE/回环的控制集成点。实现细节见
[`control-plane.md`](control-plane.md)、[`motion-polish.md`](motion-polish.md) 与
[`control-interaction-spec.md`](control-interaction-spec.md)；若有冲突，以本文的层级边界为准。

## 1. 分层

```text
PICO / Firefox Reality
  patient page (Web)          App = 会话监督者
    ├── ViewMotionController   视角动画策略、状态、预设目录
    ├── WorldShell             变换组合：pitch → 校准/起身 → 地板
    ├── SceneSnapshot          状态收集（telemetry / state / HUD）
    └── PortalLink            单一 WebSocket 传输（cmd/state/telemetry/ack）

Android headset (PortalService)
  本机 WebSocket + HTTP 诊断 + BLE GATT 外设 + 宿主命令
Android tablet (ControlScreen)
  BLE 中心 + Compose 遥控 UI + WebView 镜像 + 本地患者视角录像

Scene modules (three.js)
  纯内容：美术、材质、局部环境循环、可注视目标、释放
```

校准只有一步：`Comfort.calibrate(pose)` 把采集到的那一帧朝向当作中立（站立）帧，场景随之直立。世界变换因此是 `q_total = q_posture * q_calibration`，绕采集点旋转；没有两姿态 pivot 重映射（`comfort.calibrateTwo` 仅为历史/调试保留，患者流程不调用）。校准成功后，起身路径 `SitUpPath` 以仰卧为起点接管 `comfort.group` 所在的 base 槽位，由 `WorldShell.setBasePose` 写入逆变换；起身/回躺结束或 `posture:stop` 后回到 comfort 帧。

场景只提供内容：`landscape` / `ward` / `bathroom`，以及站立参照场景 `lab`（直立光室）——地面网格与雾、垂直光柱与顶晕、缓慢上升的远近尘埃、3 个可注视碑体。

### 1.1 职责与禁止依赖

| 层 | 负责 | 不得负责 / 不得依赖 |
| --- | --- | --- |
| Scene | 场景内容、材质、环境动画、selectables、`dispose` | 视角/相机动画、会话/租约、BLE、命令名、状态字节、运动优先级 |
| Web system (`App`) | 会话/租约门控、患者停止、校准生命周期（一步采集）、起身过渡调度（`SitUpPath`/`situp-run`）、命令解析与路由、快照收集、患者侧注视选择（6 s） | 具体缓动/动画状态机（交给 `ViewMotionController`）、场景 id 分支 |
| `ViewMotionController` | 预设目录、当前/目标俯仰、播放/保持/复位、`viewAnim`/`viewPreset` 状态 | three.js、场景模块、BLE 字节、会话/租约判断 |
| `WorldShell` | 每层唯一写者、变换顺序、绕眼点的俯仰组合 | 缓动、状态机、优先级、场景内容 |
| Android headset | BLE/回环传输、白名单与语法校验、宿主命令、state 编码、租约存活 | 动画曲线/时长/幅度、场景知识、替代页面做运动决策 |
| Android tablet | 连接/接管、命令发送、state 回读、遥控 UI、画布录制与本地文件 | 第二套运动状态机、按按钮推断播放状态；录像不得反向驱动会话/租约 |

### 1.2 单写者规则

- `WorldShell.group`：只由 `WorldShell` 写（pitch）。
- `comfort.group`：只由 `Comfort` 写；起身时由 `WorldShell.setBasePose` 接管，二者互斥。
- `host.content`：只由 `SceneHost.setFloorOffset` 写（y 轴）。
- `handle.root`：场景内容；除调试自旋外不写变换。
- 相机：任何代码都不写 XR 相机位姿；2D 预览除外。

头显确认键只有一个动作：已校准且会话中短按切换起身/回躺，其余状态（未校准、校准中、无会话、2D 预览）直接忽略。头显内没有 WebXR 菜单，也没有长按行为；场景目标仍由 6 s 注视停留选中，重新校准/声音/结束训练全部来自平板。

## 2. 视角动画（系统级能力）

`view:anim` 是**页面播放的系统级视角动画**，不是场景动画。Android 只转发白名单 id，并回读状态；
曲线、时长、幅度全部在 `src/core/xr/view-motion.ts` 的目录里。

### 2.1 预设目录

| id | code | 语义 | 时长 | 峰值（约） |
| --- | ---: | --- | ---: | ---: |
| `none` | 0 | 无预设（仅状态） | — | — |
| `up` | 1 | 相对当前 +10°，整体钳制 ±90° | 3.0 s | 6.25 °/s |
| `down` | 2 | 相对当前 −10°，整体钳制 ±90° | 3.0 s | 6.25 °/s |
| `recenter` | 3 | 绝对回 0°；偏航同时以 40 °/s 均速归零（0.7–5 s） | 2.4 s | 约 70 °/s（从 ±90°） |
| `breathe` | 4 | 当前 → +6° → 当前 | 6.0 s | 3.75 °/s |

滑动条 `view:orient:<yaw>,<pitch>` 是连续绝对朝向（度），0.25 s 时间常数 + 俯仰 15 °/s、偏航 30 °/s 速率上限；
它清除当前预设。`view:stop` 立即冻结当前角度（`held`），不回正。

### 2.2 状态机与优先级

```text
idle --play / slider--> playing --完成--> idle
playing --view:stop / 租约丢失--> held     （冻结，不缓动）
held --play / slider--> playing            （从当前角度继续）
任意 --校准开始 / 会话结束--> idle @ 0°    （复位）
```

优先级：**患者停止 > 租约丢失 > 会话结束/校准复位 > 显式视角命令 > 动画完成**。
`view:stop` 与失权是急停语义（当帧冻结）；`view:anim:recenter` 才是缓动回正。

### 2.3 状态回报

- `viewPitch`：**当前已应用**上仰角（有符号度，±90），不是目标。
- `viewYaw`：**当前已应用**偏航（有符号度，±180，+ = 视线左转）。
- `viewAnim`：`idle | playing | held`。
- `viewPreset`：`none | up | down | recenter | breathe`。
- 平板只显示回读；本地 `viewPitchRequested` / `viewYawRequested` 仅是拖动期间的 UI 缓冲，收到对应回读后清空。
- 场景切换：`ViewMotionController` 保留角度/状态，`WorldShell` 重建后重贴当前角度，不重播。

## 3. BLE 与回环集成点

服务 UUID：`7a1e0001-6f3c-4f9a-9d2b-2f6a1c000001`
命令 `…0002`、状态 `…0003`、遥测 `…0004`、state `…0005`。

### 3.1 命令特征（平板 → 头显）

握手：`CONTROL_OK` 后平板发 `HELLO <version>`，头显回 `WELCOME <version> <capMask>`；不匹配时平板进入错误态并拒绝驱动。

| 类型 | 命令 | 路由 | 回执 |
| --- | --- | --- | --- |
| 宿主 | `enter/home/allapps/settings:*/scene:*` | 头显服务执行 | 成功 `ACK <seq> OK`；失败 `ACK <seq> REJECTED` |
| 页面离散 | `posture:*`、`cue:*`、`view:anim:*`、`view:stop`、`sus:*` | `/ws` 保留区 → 页面 | `ACK <seq> <OK\|REJECTED\|BUSY>`；同 seq 去重 |
| 页面连续 | `view:orient:<yaw>,<pitch>` | `/ws` 最新样本槽 | **免 seq/回执**，no-response 写 |

- 离散命令线格式 `#<seq> <command>`；`view:orient` 保持原样。白名单在 `ControlProtocol.isAllowedCommand`。
- `posture:rise/lower/stop` 是患者/平板都在用的干预：页面把它们映射到 `setVirtualPosture`，`posture:stop` 也用于租约丢失时的冻结。
- 平板一次只写一条：stop 优先并丢弃待发的 `view:orient`，离散 FIFO 不丢；朝向只保留最新样本。
- `view:orient:<yaw>,<pitch>` 恰好两个整度分量；偏航 ±180°、俯仰 ±90°，任一分量越界整条拒绝。
- `view:anim` 只接受 `up|down|recenter|breathe`；`none` 仅用于状态，不接受播放；不跨重连重放。
- 平板发送频率上限 10 Hz；页面侧无 TTL，目标持续有效。

### 3.2 状态特征（头显 → 平板）

页面 WS `state`（静止 1 Hz / 运动中 5 Hz）→ 头显 `ControlState` → state v8（20 字节）：

| 字节 | 字段 | 编码 |
| ---: | --- | --- |
| 0 | version | `8` |
| 1 | scene | 0 landscape / 1 ward / 2 bathroom / 3 lab / 255 unknown |
| 2 | flags | bit0 session, bit1 calibrating, bit2 audioMuted, bit3 cueEnabled |
| 3 | eyeHeight | 厘米，120–190 |
| 4 | posturePitch | **有符号度**（测得的世界俯仰；起身到位约 +90） |
| 5 | postureRoll | **有符号度**（测得的世界横滚） |
| 6 | postureRise | 厘米，0–120 |
| 7 | postureProgress | 0–100 |
| 8 | viewPitch | **有符号度**，−90–+90（当前已应用上仰角） |
| 9 | viewAnim | 0 idle / 1 playing / 2 held |
| 10 | cueIntensity | 0–100 |
| 11 | calibrationConfidence | 0–100 |
| 12 | viewPreset | 0 none / 1 up / 2 down / 3 recenter / 4 breathe |
| 13–14 | viewYaw | **有符号 int16** 小端，−180–+180（+ = 视线左转） |
| 15–16 | worldYaw | **有符号 int16**：实际世界偏航（外壳 × 基座） |
| 17–18 | worldPitch | **有符号 int16**：实际世界俯仰 |
| 19 | worldRoll | **有符号 int8**：实际世界横滚 |

- 版本不等于 8、长度不为 20 的帧直接丢弃；所有角度字段只做位宽检查，不静默夹紧。
- `viewAnim` / `viewPreset` 的未知值按 idle / none 处理（字段容错）。
- 平板不自行推断状态；按钮只发命令，显示只读 state。
- `viewX`/`viewZ` 已删除，不提供旧版本兼容层。

### 3.3 遥测特征（页面 → 平板）

页面 WS `telemetry` 5 Hz，20 字节 `x,y,z,yaw,pitch`（小端 float32）。3DoF 下位置近似固定，姿态才是有效信息。

### 3.4 租约与存活

- 首个 `CLAIM` 胜出；第二台 `CONTROL_BUSY`。
- 平板 5 s `PING`，15 s 无 `PONG` 断开；头显 20 s 无控制者写入释放。
- 头显在断链、广告失败或蓝牙关开后恢复 GATT/广播；8 s 广播看门狗兜底，重复 `CLAIM` 刷新租约看门狗。
- 平板保存上次头显地址；非主动断链按 0.8 / 1.6 / 3.2 s 退避重连 3 次，`CONTROL_BUSY` 直接回配对页。
- 失权（RELEASE / 超时 / 断链）是一次**停止事件**：
  - 头显只入队一条 `posture:stop`（幂等），并发布 `control:false`；
  - 页面 `ViewMotionController.stop()` 冻结视角、`stopSitUp()`、`comfort.stopPosture()`；
  - 俯仰保持当前角度，不回正；平板禁用视角/起身控件，重连后以 state 回读为准。
- 这是双端 fail-safe，不是第二套状态机；页面仍是运动语义的唯一所有者。

### 3.5 回环

- `/ws?since=<seq>` 是页面唯一实时通道：服务端推 `ready`/`cmd`/`control`，页面推 `state`/`telemetry`/`ack`。
- 离散命令保留到 ack（≤64）；`view:orient` 只保留最新；`view:anim` 不跨重连重放；每订阅者队列有界并优先淘汰连续帧。
- 页面断线指数退避重连并带 `since=lastSeq`；没有 SSE、轮询或 HTTP state/telemetry 回退。
- `/status`、`/capabilities`、`/command` 仅诊断；`/` 提供页面。

## 4. 变更规则

1. 新增视角预设 = 三层同改：`view-motion.ts` 目录、`ControlProtocol` 白名单/`ViewPreset`、平板 UI；state v8 的 preset code / 新增 `viewYaw` 需要新版本号；同版本 APK 一起升级。
2. 新增场景只实现 `SceneDefinition`/`SceneHandle`；不得引入视角/会话/BLE 依赖。
3. Android 不新增动画参数命令；需要新曲线时先改目录与协议，不接受任意 duration/amplitude。
4. 旧 state/命令格式不保留兼容层；版本不匹配直接拒绝。
5. 任何“急停/失权/复位”改动必须同时检查：患者停止、租约丢失、会话结束、校准开始、场景切换五条路径。
6. 录像只在平板本地：读取 WebGL 画布、写应用外部目录、经 FileProvider 分享；不得新增 BLE 命令、不得依赖租约，也不得让页面为录制改变渲染状态。
7. 改动 BLE 生命周期必须检查：断链、广告失败、蓝牙关开、服务重启、重复 `CLAIM` 五种恢复路径。
