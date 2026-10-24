# 控制平面：BLE 与本地回环

本文描述头显端和平板端之间唯一的控制通道，以及头显页面与头显服务之间的本地桥。协议实现以 `android/protocol/src/main/kotlin/com/quietshore/control/protocol/ControlProtocol.kt` 为准；头显侧在 `android/headset/src/main/kotlin/com/quietshore/portal/BluetoothControl.kt`，平板侧在 `android/control/src/main/kotlin/com/quietshore/control/ble/`。

## 1. 拓扑

```
平板 静岸控制台
  │  BLE GATT（中心）
  ▼
头显 BLE 外设 "QuietShore"（PortalService）
  │  同进程调用
  ▼
127.0.0.1:8130  ←→  Firefox Reality 中的患者页面
```

- 平板不直接访问头显的 HTTP 端口；它只通过 BLE 收发。
- 头显服务是唯一同时接触 BLE 和回环 HTTP 的组件。
- 患者页面只与同源 `127.0.0.1:8130` 通信，不感知 BLE。

## 2. GATT 服务

外设名 `QuietShore`，广播中包含服务 UUID。所有特征都在同一个主服务下：

| 用途 | UUID | 属性 |
| --- | --- | --- |
| 服务 | `7a1e0001-6f3c-4f9a-9d2b-2f6a1c000001` | Primary |
| 命令 `command` | `7a1e0001-6f3c-4f9a-9d2b-2f6a1c000002` | Write / Write No Response |
| 状态 `status` | `7a1e0001-6f3c-4f9a-9d2b-2f6a1c000003` | Read / Notify |
| 遥测 `telemetry` | `7a1e0001-6f3c-4f9a-9d2b-2f6a1c000004` | Read / Notify |
| 状态快照 `state` | `7a1e0001-6f3c-4f9a-9d2b-2f6a1c000005` | Read / Notify |

平板广泛扫描，在回调里按服务 UUID 或设备名 `QuietShore` 匹配（部分协议栈的扫描记录不带 128-bit UUID）；匹配到第一台就自动连接——没有设备列表、没有选择步骤，也没有“上次设备”快捷卡。BLE 外设创建失败时，通知会显示 `蓝牙不可用` / `蓝牙未开启`，不会进入“等待平板连接”。

### 2.1 command

UTF-8 字符串，去掉首尾空白后解释：

| 写入值 | 行为 |
| --- | --- |
| `CLAIM` | 申请控制权；重复写入刷新 20 s 租约看门狗 |
| `RELEASE` | 释放控制权 |
| `HELLO <version>` | 协议握手；成功回 `WELCOME <v> <capMask>` |
| `PING` | 存活探测；控制者回 `PONG` |
| `#<seq> <command>` | 带序号与 `ACK` 的离散命令；头显对 seq 去重 |
| `view:orient:<yaw>,<pitch>` | 连续朝向，Write Without Response，免序号/回执 |
| 其他白名单字符串 | 旧式无序号命令，仅当前控制者可发；不在白名单内直接拒绝 |

命令白名单由 `ControlProtocol.isAllowedCommand` 与 `CAPABILITIES` 共同维护，可通过 `GET /capabilities` 读取。

头显对每次写入回复 `status` 通知；需要响应时同时通过 GATT write response 返回同样的字符串。

### 2.2 status

ASCII 字符串。命令回复只通知发起写入的设备；遥测/state 只发给当前控制者；租约超时通知被释放的控制者：

| 值 | 含义 |
| --- | --- |
| `CONNECTED` | 有设备连上外设 |
| `CONTROL_OK` | `CLAIM` 成功；本设备是控制者 |
| `CONTROL_BUSY` | 已有其他控制者 |
| `CONTROL_RELEASED` | 控制者已释放 / 租约超时 |
| `CONTROL_REQUIRED` | 当前设备不是控制者，命令被拒绝 |
| `WELCOME <v> <capMask>` | `HELLO` 成功；返回头显协议版本与能力位 |
| `ACK <seq> <OK\|REJECTED\|BUSY>` | 离散命令的序号回执 |
| `PROTOCOL_REQUIRED` | 未完成 `HELLO` 就发送 Discrete 命令 |
| `PROTOCOL_MISMATCH <v>` | 头显协议版本与平板不一致 |
| `COMMAND_REJECTED` | 白名单、语法或语义校验失败 |
| `OK:<cmd>` | 旧式无序号命令已转交患者页面 |
| `PONG` | `PING` 的存活回复 |
| `ready` | 服务启动后的初始值 |

`status` 不包含姿态或状态数据，只表示连接与接管结果。`PING` 是内部存活探测，头显响应 `PONG`，不进入页面命令队列。`OK:<cmd>` 只会在头显语义路由接受命令后返回；白名单外或语义失败返回 `COMMAND_REJECTED`。

### 2.3 telemetry

固定 20 字节，小端 `float32` × 5：

| 偏移 | 字段 | 含义 |
| --- | --- | --- |
| 0 | `x` | 头显位置（米，场景坐标） |
| 4 | `y` | 头显高度 |
| 8 | `z` | 头显位置 |
| 12 | `yaw` | 绕 Y 轴朝向（弧度） |
| 16 | `pitch` | 俯仰（弧度） |

20 字节正好落在默认 ATT 负载内，不需要 MTU 协商。无人接管时，头显直接丢弃遥测，不缓存。

### 2.4 state

固定 20 字节二进制，小端；第一字节是版本号 `10`：

| 偏移 | 字段 | 编码 |
| --- | --- | --- |
| 0 | version | `10` |
| 1 | floatLevel | 0–3 |
| 2 | flags | bit0 session, bit1 calibrating, bit2 audioMuted, bit3 cueEnabled, bit4 sitUpActive, bit5 postureMode, bit6–7 float profile (0=a, 1=b, 2=c) |
| 3 | eyeHeight | 厘米，120–190 |
| 4 | posturePitch | **有符号**整数度：测得的世界倾角（0 → +90 为起身） |
| 5 | postureRoll | **有符号**整数度：测得的世界横滚 |
| 6 | postureRise | 厘米，0–120 |
| 7 | postureProgress | 0–100 |
| 8 | viewPitch | **有符号**整数度，−90–+90（页面是唯一夹紧点）；正值 = 上仰（患者看到更多天空） |
| 9 | viewAnim | 0 idle / 1 playing / 2 held；其他值按 idle 处理 |
| 10 | cueIntensity | 0–100 |
| 11 | sceneIndex | `SCENE_IDS` 索引：0 = `washroom`，1 = `shore`，255 = unknown |
| 12 | viewPreset | 0 none / 1 up / 2 down / 3 recenter / 4 breathe；其他值按 none 处理 |
| 13–14 | viewYaw | **有符号** int16 小端，度；+ = 患者视线左转 |
| 15–16 | worldYaw | **有符号** int16 小端：实际写入场景内容的世界偏航（外壳 × 基座） |
| 17–18 | worldPitch | **有符号** int16 小端：实际世界俯仰 |
| 19 | worldRoll | **有符号** int8：实际世界横滚 |

- 页面通过 WS `{"type":"state","data":...}` 提供这些字段；头显编码后通知控制者。
- `viewPitch` 是**当前已应用**的角度，不是目标：平滑重定向或动画播放中会看到中间值。平板把它作为回读显示，拖动期间的目标值只保留在本机 `viewPitchRequested` / `viewYawRequested`，收到回读后清空。
- `viewAnim` 只表示页面动画播放器的粗粒度相位（`idle` / `playing` / `held`），页面通过 WS `state` 的 `viewAnim` 字符串上报；未知值按 `idle` 处理。
- `viewPreset` 是页面最近播放/正在播放的预设 id（`none|up|down|recenter|breathe`），未知值按 `none` 处理；平板只回显，不自行推断。
- 20 字节仍落在默认 ATT 负载（20 字节）内；版本不等于 10 或长度不为 20 的帧直接丢弃。
- 所有角度字段（byte 4 / 5 / 8 / 13–18 / 19）只做位宽检查：越界值不会被静默夹紧，口径见 `docs/rotation-contract.md`。
- 场景可切换，但只在会话开始前：平板发 `scene:<id>`，头显校验后存入启动参数并转发页面；`CAP_SCENE`（bit 1）声明该能力。byte 11 是 `SCENE_IDS` 的索引（`washroom`=0、`shore`=1，255 = unknown），顺序只增不改。
- 旧文本格式与 v6 及更早的二进制帧均已删除，没有兼容层。

## 3. 第一台接管

控制权是头显侧的单值状态，不落盘：

```
无控制者 ──CLAIM(A)──▶ 控制者=A，回 CONTROL_OK
控制者=A ──CLAIM(A)──▶ 仍是 A，回 CONTROL_OK（幂等）
控制者=A ──CLAIM(B)──▶ 仍是 A，回 CONTROL_BUSY
控制者=A ──RELEASE(A)─▶ 无控制者，回 CONTROL_RELEASED
控制者=A ──A 断链──────▶ 无控制者（静默，不广播）
控制者=A ──RELEASE(B)─▶ 仍是 A，回 CONTROL_REQUIRED
控制者=A ──B 发命令───▶ 仍是 A，回 CONTROL_REQUIRED
```

- 控制者用 BLE 设备地址标识，保存在 `BluetoothControl` 的内存中。
- `CLAIM` 在通知启用后立即发送；平板等待 `CONTROL_OK` 最多 6 秒，超时断开并提示重新连接。
- 收到 `CONTROL_BUSY` 后平板主动断开，留在配对页；不会自动重试。
- 控制者 `RELEASE`、写入超时或断链都会清空控制者，下一台平板可以直接接管。
- 每次租约丢失（`RELEASE` / 20 s 写入超时 / 断链 / 停 BLE）头显只入队**一条** `posture:stop`，让页面冻结起身轨迹；视角朝向目标保持不变，动画停止但角度不回正。
- 服务重启同样清空控制权；平板必须重新连接并 `CLAIM`。
- 通知标题随之变化：“等待平板连接” → “平板控制中，按一次确认键开始”。

### 3.1 链路恢复

- 头显在链路断开、广告启动失败、蓝牙关闭后重新打开时都会恢复可连接广播；8 s 广播看门狗负责发现协议栈静默停播。
- 蓝牙关闭不退出服务：`ACTION_STATE_CHANGED` 收到 `STATE_ON` 后重建 GATT server 与广播，不需要重启头显应用。
- 平板保存上次头显地址（`quiet-shore-control/lastDeviceAddress`），冷启动直接尝试连接；失败后停在配对页，只能“搜索头显/重新搜索”。
- 非主动断链按 0.8 / 1.6 / 3.2 s 退避重连 3 次，期间 `BlePhase.RECONNECTING`、界面显示“重连中”；用尽后回到 `DISCONNECTED` 并提示重新搜索。`CONTROL_BUSY` 不重试，直接回配对页。
- 重复 `CLAIM` 会刷新头显侧的 20 s 租约看门狗，避免重连中的平板被旧计时器释放。

没有控制码、PIN、配对/绑定或应用层认证。**规则就是先到先得。**

## 4. 控制命令

平板发送前用 `ControlProtocol.isAllowedCommand` 校验，头显再次校验白名单；宿主命令在服务内执行，其余进入页面队列。页面按小写解释。

BLE 写入语法：

```text
HELLO <version>          # CONTROL_OK 后一次；头显回 WELCOME <version> <capMask>
#<seq> <command>         # 离散命令：单调 seq，头显回 ACK <seq> <OK|REJECTED|BUSY>
view:orient:<yaw>,<pitch> # 连续朝向：无 seq、无 ACK，只保留最新样本
PING / RELEASE / CLAIM   # 存活与租约
```

- 离散命令在头显侧按控制器维护有界去重窗口；重复 seq 只重发原 ACK，不重复执行。
- `view:orient` 使用 no-response 写，离散命令使用 response 写；平板一次只写一条，stop 优先并丢弃待发朝向。
- 未完成 HELLO 的控制器发命令会得到 `PROTOCOL_REQUIRED` / ACK `REJECTED`，不会静默执行。

| 命令 | 页面行为 |
| --- | --- |
| `enter` | 头显服务直接拉起 Firefox Reality 训练页（仍需患者按一次确认键进入 WebXR） |
| `sus:open` / `sus:close` | 打开/关闭头显端 SUS 量表页 |
| `sus:next` / `sus:prev` | 控制端覆写 SUS 当前题页 |
| `sus:answer:<1-5>` | 操作员对头显当前 SUS 题代答；SUS 页未打开时自动打开 |
| `home` | 头显回到系统桌面 |
| `allapps` | 打开系统全部应用页 |
| `settings:skipcalibration:on\|off` | 持久化下一次训练的校准跳过设置 |
| `settings:hud:on\|off` | 持久化下一次训练的性能面板设置 |
| `mode:float\|posture` | 会话前选择模式；会话中拒绝。起身为备选分支 |
| `float:level:0-3` | 漂浮强度；0 为停用，停止时按 tau 0.25 s 渐出 |
| `float:profile:a\|b\|c` | 漂浮档位：a 温和（22 mm / 14 s）、b 标准（35 mm / 11 s）、c 沉浸（45 mm / 9 s + 1.5° 地平线微摆）。实机选型用 |
| `preview` | 进入 2D 预览（不请求 WebXR） |
| `calibrate` / `recalibrate` | 记录当前朝向为新中立帧（无倒计时、无稳定检测）；训练中可用 |
| `audio:on` / `audio:off` / `audio:toggle` | 设置/切换静音 |
| `exit` / `stop` | 结束训练、退出会话 |
| `posture:rise` / `posture:lower` / `posture:stop` | 备选模式下由平板驱动起身/回落/保持在当前进度；患者确认键只做开始/停止，不触发起身 |
| `cue:on` / `cue:off` / `cue:intensity:<0..1>` | 近场粒子层开关与强度（应用级；`flow` 由漂浮振幅或起身上升驱动） |
| `start` | 不启动 WebXR，只提示“请在头显内启动一次，之后由平板控制” |
| `view:orient:<yaw>,<pitch>` | 绝对朝向（度）：yaw ±180（+ = 左转）、pitch ±90（+ = 上仰），无 TTL；免回执 |
| `view:stop` | 停止动画并**保持**当前朝向，不回正 |
| `view:anim:up\|down\|recenter\|breathe` | 播放页面的固定预设：up/down 相对当前角度 ±10°，recenter 回 0°，breathe 为 6 s 回到起点的曲线；无参数，作为一次性离散命令回 `ACK <seq> OK`，不跨重连重放 |
| `status` | 协议允许，当前平板 UI 不发送 |

`enter`、`home`、`allapps`、`sus:*`、`settings:*` 由头显服务执行；其余离散命令进入 `/ws` 保留区，立即推给页面，直到页面 `ack`。`view:orient` 只保留最新样本，不等待 ack。

非白名单命令在头显服务层直接拒绝，既不入队也不显示。

## 5. 本地回环 HTTP 与 WebSocket

`PortalService` 在 `127.0.0.1:8130` 提供页面、诊断接口和一个 WebSocket 控制通道。HTTP 响应带 `Cache-Control: no-store`，`Connection: close`。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/ws?since=<seq>` | RFC 6455 控制通道；同源 `http://127.0.0.1:8130`，仅文本帧、JSON、≤8 KiB，无分片/二进制 |
| GET / HEAD | `/`、`/index.html` | `text/html`，APK `assets/index.html` |
| GET / HEAD | `/status` | 蓝牙、接管、`pendingSeq`、当前 state 摘要 |
| GET / HEAD | `/capabilities` | 命令清单与当前控制权 |
| POST | `/command` | 本地诊断/调试用的命令注入；非白名单返回 400 |

`/events`、`/control`、`/state`、`/telemetry` 已删除；页面不再使用 HTTP 轮询或 POST。

### 5.1 WebSocket 消息

服务端 → 页面：

```text
{"type":"ready","seq":N,"control":bool,"controller":string|null}
{"type":"cmd","seq":N,"command":"float:level:2","continuous":false}
{"type":"cmd","seq":N,"command":"view:orient:0,35","continuous":true}
{"type":"control","control":bool,"controller":string|null}
```

页面 → 服务端：

```text
{"type":"state","data":{session,calibrating,postureMode,audio,eyeHeight,posturePitch,postureRoll,postureRise,postureProgress,viewPitch,viewAnim,viewPreset,cueEnabled,cueIntensity,calibrationConfidence}}
{"type":"telemetry","data":{"x":n,"y":n,"z":n,"yaw":n,"pitch":n}}
{"type":"ack","seq":N}
```

- 连接建立先发 `ready`，随后补发 `seq > since` 的离散命令与最新 `view:orient`；`since` 缺失按 `-1`。
- 离散命令保留到页面 `ack`（≤64 条）；`view:orient` 免 ack、只保留最新；`view:anim:*` 只实时投递，不跨重连重放。
- 每个订阅者队列有界（96）；连续帧合并，满时按 continuous → ready/control → discrete 顺序淘汰，离散命令不会先被丢。
- 服务端每 15 s 发 ping，30 s 无 pong 关闭；页面断线后以指数退避重连并带 `since=lastSeq`。
- `state` / `telemetry` 由页面按 1 Hz / 5 Hz（运动中 state 5 Hz）发送，头显编码为 state v10 / 20 B 遥测后 BLE 通知平板。
- 页面不得再发送 `viewX`/`viewZ`；头显也不会解析它们。

`/ws`、`/command`、`/capabilities` 没有认证，只绑定 loopback，适用于单设备受控环境。`/command` 只接受白名单命令，不提供任意 Intent、路径或 shell。

## 6. 头显入口与生命周期

| 入口 | 行为 |
| --- | --- |
| 应用图标 / `PortalActivity` | 打开头显控制台；创建/恢复时启动前台服务，但**不**自动拉起 Firefox。控制台显示蓝牙、服务和接管状态 |
| 控制台“进入训练” | 唯一拉起 Firefox Reality 的按钮；显式 Intent，3 秒冷却，冷却期间点击只提示稍候 |
| 常驻通知 | 点击通知正文或“打开控制台”动作打开控制台；不再播报“等待平板连接”，也不重复提供“全部应用/返回桌面” |
| 快捷磁贴“静岸” | 打开控制台，不直接拉起 Firefox |
| `BootReceiver` | 开机或应用更新后恢复服务与通知，不自动拉起浏览器 |

`PortalActivity` 的“进入训练”通过显式 Intent 打开 `org.mozilla.vrbrowser/.VRBrowserActivity`，URL 为 `http://127.0.0.1:8130/?t=<时间戳>`。时间戳避免 Firefox 复用旧文档；拉起前会探测 `:8130` 是否可连接，避免 Firefox 冷启动把请求丢掉。未安装 Firefox Reality 时只做提示，不劫持默认浏览器。控制台另有“全部应用”和“返回桌面”；后者打开系统 HOME 设置，由用户确认。

`PortalService` 是 `START_STICKY` 前台服务。服务重启后会重新读取 APK 内的 `assets/index.html`，重新广播 BLE，并清空控制者。

## 7. 平板控制台流程

1. 启动 `MainActivity`，请求蓝牙/位置权限。
2. 已存 `lastDeviceAddress` 时直接连接（冷启动一次尝试，失败即停在配对页）。
3. 否则扫描最多 12 秒；匹配到第一台广播 `QuietShore`（服务 UUID 或设备名）就自动连接，没有设备列表、没有选择步骤。
4. 连接超时 15 秒；启用 `status`、`telemetry`、`state` 的通知，然后写 `CLAIM`。
5. 收到 `CONTROL_OK` 进入控制页；收到 `CONTROL_BUSY` 关闭连接并停留在配对页（提示“头显正被另一台平板控制”，不重试）。
6. 控制页每 3 秒读一次 RSSI；姿态超过 1.5 秒未更新会标记为过期。
7. 非主动断链按 0.8 / 1.6 / 3.2 s 退避重连 3 次，界面显示“重连中 n/3”；用尽后回配对页，只能重新搜索。
8. “断开”先写 `RELEASE` 再断链；直接退出应用让链路断开，头显同样会释放控制。

平板不加载任何 WebView：控制页是原生 Compose 单屏，命令直接由 BLE 发出，状态从 `state` 通知回到界面。

## 8. 边界与已知问题

- **邻近即授权。** 没有身份校验，任何能运行控制台 APK 且在范围内的平板都能在空闲时接管。当前只适合一台头显配一台平板的专用环境。
- **单控制者。** 不支持多平板协作或观察者模式；第二台平板只能等待。
- **无持久化。** 控制权（租约）与状态都只存在于进程内存；服务重启后平板需重新接管。平板只在本地存上次头显地址，用于冷启动直连。
- **单头显假设。** 扫描不提供设备列表：屏幕上同时有第二台广播 `QuietShore` 的头显时，会连上先被扫描到的那台。
- **控制页布局。** 原生 Compose 单屏：顶部连接状态条，下方依次是会话（状态、计时、开始/结束、朝向）、模式、漂浮强度、声音，最底部常驻急停。底部保留只读角度仪表。
- **遥测是 3DoF。** 位置分量不随头部平移变化，`yaw`/`pitch` 才是有效姿态。
- **state 已固定为 20 字节二进制 v10**（flags bit5 为姿态模式、bit6–7 为漂浮档位，byte 1 为漂浮强度，见 `ControlProtocol.kt`；byte 4/5 为测得的世界俯仰/横滚有符号整度，byte 8 为当前已应用 `viewPitch`，byte 9 `viewAnim`：0 idle / 1 playing / 2 held，byte 12 `viewPreset`：0 none / 1 up / 2 down / 3 recenter / 4 breathe，byte 13–14 为当前已应用 `viewYaw` int16，byte 15–18 为实际世界 yaw/pitch int16、byte 19 为世界 roll int8；不再受场景名长度影响；版本不匹配或长度错误会被控制端丢弃，未知枚举值按 idle/none 处理。
- **回环接口无认证。** 只监听 `127.0.0.1`，但本机其他应用理论上可访问；不要把它当作安全边界。

## 9. 排障

| 现象 | 排查 |
| --- | --- |
| 平板扫描不到设备 | 头显服务是否在跑、蓝牙是否开启、是否在 12 秒扫描窗口内、平板是否有扫描权限 |
| 连接后一直“正在接管控制” | 6 秒内未收到 `CONTROL_OK`；查看头显通知是否显示“等待平板连接”，检查另一台平板是否占用 |
| `CONTROL_BUSY` | 另一台平板持有控制权；在它上面断开，或等待其断链 |
| 控制页能连但命令无效 | 查看 `status` 是否为 `CONTROL_REQUIRED`；重新 `CLAIM` |
| 没有姿态数据 | 患者尚未在头显内开始 WebXR；页面只在开始后上报 |
| 视角命令被拒绝 | `view:*` 命令已无平板入口；页面只在会话中接受 |
| 头显通知显示 `蓝牙未开启` | 打开头显蓝牙；服务会自动重试广播 |
| 头显通知显示 `蓝牙不可用` | 适配器不支持多广播、GATT server 打开失败或广播失败；重启蓝牙和服务 |
| 页面打不开 | 检查 Firefox Reality 是否安装、`:8130` 是否被占用；`adb logcat -s QuietShorePortal` |
