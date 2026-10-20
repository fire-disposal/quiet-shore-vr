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

扫描过滤条件就是服务 UUID；平板只显示广播该服务的设备。BLE 外设创建失败时，通知会显示 `蓝牙不可用` / `蓝牙未开启`，不会进入“等待平板连接”。

### 2.1 command

UTF-8 字符串，去掉首尾空白后解释：

| 写入值 | 行为 |
| --- | --- |
| `CLAIM` | 申请控制权 |
| `RELEASE` | 释放控制权 |
| 其他白名单字符串 | 视为控制命令，仅当前控制者可发；不在白名单内直接拒绝 |

命令白名单由 `ControlProtocol.isAllowedCommand` 与 `CAPABILITIES` 共同维护，可通过 `GET /capabilities` 读取。

头显对每次写入回复 `status` 通知；需要响应时同时通过 GATT write response 返回同样的字符串。

### 2.2 status

ASCII 字符串，通知给所有已连接设备：

| 值 | 含义 |
| --- | --- |
| `CONNECTED` | 有设备连上外设 |
| `CONTROL_OK` | `CLAIM` 成功；本设备是控制者 |
| `CONTROL_BUSY` | 已有其他控制者 |
| `CONTROL_RELEASED` | 控制者已释放 |
| `CONTROL_REQUIRED` | 当前设备不是控制者，命令被拒绝 |
| `OK:<cmd>` | 控制者的命令已转交患者页面 |
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

固定 12 字节二进制，小端；第一字节是版本号 `3`：

| 偏移 | 字段 | 编码 |
| --- | --- | --- |
| 0 | version | `3` |
| 1 | scene | `0` landscape / `1` ward / `2` bathroom / `3` lab / `255` unknown |
| 2 | flags | bit0 session, bit1 calibrating, bit2 audioMuted, bit3 cueEnabled |
| 3 | eyeHeight | 厘米，120–190 |
| 4 | posturePitch | 度，字节值减 20 |
| 5 | postureRoll | 度，字节值减 10 |
| 6 | postureRise | 厘米，0–120 |
| 7 | postureProgress | 0–100 |
| 8 | viewX | 厘米偏移 +45，范围 −0.45–0.45 m |
| 9 | viewZ | 同上 |
| 10 | cueIntensity | 0–100 |
| 11 | calibrationConfidence | 0–100 |

- 页面通过 `/state` JSON 提供这些字段；头显编码后通知控制者。
- 旧文本四/五段格式已删除；版本不匹配或长度不为 12 的 state 直接丢弃。
- 12 字节落在默认 ATT 负载内，不需要 MTU 协商。

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
- 控制者断链或调用 `stop()` 会清空控制者，下一台平板可以直接接管。
- 服务重启同样清空控制权；平板必须重新连接并 `CLAIM`。
- 通知标题随之变化：“等待平板连接” → “平板控制中，按一次确认键开始”。

没有控制码、PIN、配对/绑定或应用层认证。**规则就是先到先得。**

## 4. 控制命令

平板发送前用 `ControlProtocol.isAllowedCommand` 校验，头显再次校验白名单；宿主命令在服务内执行，其余进入页面队列。页面按小写解释：

| 命令 | 页面行为 |
| --- | --- |
| `enter` / `launch` | 头显服务直接拉起 Firefox Reality 训练页（仍需患者按一次确认键进入 WebXR） |
| `home` | 头显回到系统桌面 |
| `allapps` | 打开系统全部应用页 |
| `settings:skipcalibration:on\|off` | 持久化下一次训练的校准跳过设置 |
| `settings:hud:on\|off` | 持久化下一次训练的性能面板设置 |
| `scene:<id>` | 持久化场景；页面在线时同步切换（会话中仍拒绝） |
| `preview` | 进入 2D 预览（不请求 WebXR） |
| `calibrate` / `recalibrate` | 重新校准；训练中可用 |
| `audio:on` / `audio:off` / `audio:toggle` | 设置/切换静音 |
| `exit` / `stop` | 结束训练、退出会话 |
| `pause` / `resume` | 预留给页面级暂停 |
| `posture:rise` / `posture:lower` / `posture:stop` | 虚拟起身/回落/停止 |
| `cue:on` / `cue:off` / `cue:intensity:<0..1>` | 近场重力粒子引导开关与强度（当前仅 landscape 场景生效） |
| `menu` | 预留给头显内菜单 |
| `start` | 不启动 WebXR，只提示“请在头显内启动一次，之后由平板控制” |
| `status` | 协议允许，当前平板 UI 不发送 |

`enter`、`home`、`allapps`、`settings:*`、`scene:<id>` 由头显服务执行；其余命令进入页面队列，并通过 `/events` SSE 立即推送。EventSource 不可用时页面退回 100 ms `/control` 轮询。

非白名单命令在头显服务层直接拒绝，既不入队也不显示。

## 5. 本地回环 HTTP

`PortalService` 在 `127.0.0.1:8130` 提供只读页面与一个小型控制接口。所有响应都带 `Cache-Control: no-store`，`Connection: close`。

| 方法 | 路径 | 请求 | 响应 |
| --- | --- | --- | --- |
| GET / HEAD | `/`、`/index.html` | — | `text/html`，APK `assets/index.html` |
| GET / HEAD | `/control` | — | `{"seq":number,"command":string|null,"control":boolean,"controller":string|null}`；兼容/回退 |
| GET / HEAD | `/status` | — | `{"bluetooth":string,"control":boolean,"controller":string|null,"scene":string,"pendingSeq":number}` |
| GET / HEAD | `/capabilities` | — | `{"version":1,"commands":[...],"control":boolean}` |
| GET | `/events` | — | `text/event-stream`；`control` 帧含 seq/command/control/controller，`state` 帧单独推送 CLAIM/RELEASE |
| POST | `/command` | `{"command":string}` | `{"accepted":true,"seq":number}`；非白名单返回 400 |
| POST | `/telemetry` | `{"x":n,"y":n,"z":n,"yaw":n,"pitch":n}` | `{"ok":true}` |
| POST | `/state` | `{"scene":s,"session":b,"calibrating":b,"audio":b}` | `{"ok":true}` |

细节：

- `/control` 的 `seq` 每收到一条 BLE 命令加一；`command` 保留最后一条。页面优先订阅 `/events`，按 `seq` 去重；SSE 断线时才改为 100 ms 轮询 `/control`。
- `control` 直接反映当前是否有平板持有控制权。
- `/telemetry` 的字段缺失时按 `0` 处理；非数字或非有限值返回 400。头显服务把它编码成 20 字节并通知控制者。
- `/state` 的 `audio` 字段表示“是否静音”，不是“声音是否开启”。
- 请求体上限 64 KiB，必须带 `Content-Length`；不支持 `Transfer-Encoding`。
- 其他方法返回 405；未知路径返回 404。
- 页面读取失败时返回占位 HTML，而不是连接错误。

`/control`、`/events`、`/command`、`/capabilities`、`/telemetry`、`/state` 没有认证。它们只绑定 loopback，适用于单设备环境。`/command` 只接受白名单命令，不提供任意 Intent、路径或 shell。

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
2. 按服务 UUID 扫描 12 秒；列表按 RSSI 排序。
3. 连接所选设备，超时 15 秒，失败重试 2 次。
4. 启用 `status`、`telemetry`、`state` 的通知，然后写 `CLAIM`。
5. 收到 `CONTROL_OK` 进入控制页；收到 `CONTROL_BUSY` 关闭连接并停留在配对页。
6. 控制页每 3 秒读一次 RSSI；姿态超过 1.5 秒未更新会标记为过期。
7. “断开”先写 `RELEASE` 再断链；直接退出应用让链路断开，头显同样会释放控制。

平板 WebView 加载 `https://appassets.androidplatform.net/assets/controller.html`，不加载头显的 loopback 页面。页面命令通过 `QuietShoreBridge.send(command)` 回到原生层，再由 BLE 发出；原生层通过 `window.qsControl` 注入姿态、状态、连接阶段和授权结果。

## 8. 边界与已知问题

- **邻近即授权。** 没有身份校验，任何能运行控制台 APK 且在范围内的平板都能在空闲时接管。当前只适合一台头显配一台平板的专用环境。
- **单控制者。** 不支持多平板协作或观察者模式；第二台平板只能等待。
- **无持久化。** 控制权、最后场景和控制状态都只存在于进程内存；服务重启后平板需重新接管。
- **遥测是 3DoF。** 位置分量不随头部平移变化，`yaw`/`pitch` 才是有效姿态；平板视图不是逐帧镜像。
- **状态可能超出默认 ATT 负载。** 场景名 16 字符时 `state` 最长 23 字节；如更换长场景名，应缩短或改用更紧凑编码。
- **回环接口无认证。** 只监听 `127.0.0.1`，但本机其他应用理论上可访问；不要把它当作安全边界。

## 9. 排障

| 现象 | 排查 |
| --- | --- |
| 平板扫描不到设备 | 头显服务是否在跑、蓝牙是否开启、是否在 12 秒扫描窗口内、平板是否有扫描权限 |
| 连接后一直“正在接管控制” | 6 秒内未收到 `CONTROL_OK`；查看头显通知是否显示“等待平板连接”，检查另一台平板是否占用 |
| `CONTROL_BUSY` | 另一台平板持有控制权；在它上面断开，或等待其断链 |
| 控制页能连但命令无效 | 查看 `status` 是否为 `CONTROL_REQUIRED`；重新 `CLAIM` |
| 没有姿态数据 | 患者尚未在头显内开始 WebXR；页面只在开始后上报 |
| 场景切换被拒绝 | WebXR 会话进行中；先结束训练再切换 |
| 头显通知显示 `蓝牙未开启` | 打开头显蓝牙；服务会自动重试广播 |
| 头显通知显示 `蓝牙不可用` | 适配器不支持多广播、GATT server 打开失败或广播失败；重启蓝牙和服务 |
| 页面打不开 | 检查 Firefox Reality 是否安装、`:8130` 是否被占用；`adb logcat -s QuietShorePortal` |
