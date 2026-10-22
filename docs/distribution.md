# 分发与运行壳：取舍与决策

## 1. 不变事实

来自草稿 `README.md` 的实机调查，作为新库的硬约束：

| 项 | 事实 |
| --- | --- |
| 设备 | PICO G2 4K，Snapdragon 835 / Adreno 540，4 GB，Android 8.1 / SDK 27 |
| 追踪 | 3DoF 头显 + 3DoF 手柄，无位置追踪 |
| WebXR | 仅预装 Firefox Reality 10（Gecko 78）`immersive-vr = true` |
| 系统 WebVR 浏览器 | Chromium 67，只有 WebVR 1.1，1 个显示器，`canPresent = true`，`hasPosition = false` |
| WebView | Chromium 74，无 WebXR/WebVR |
| 其他浏览器 | InnerWeb 等 WebView 壳，无 XR |
| root | 无；`ro.debuggable=0`，production build |
| 已稳定入口 | PICO 下拉通知栏/快捷磁贴 → 静岸控制台 → “进入训练” → Firefox Reality |
| 已禁用 | 修改厂家 HOME、卸载/改写厂家应用、默认浏览器劫持 |

实机细节、浏览器矩阵、WebXR 坑与 ADB 操作见 `docs/pico-g2.md`。

## 2. 当前分发形态：两个 APK

现状不再是单 APK。头显壳仍然很薄，但多了一个控制平面；平板端是独立应用。

### 2.1 头显端 `com.quietshore.portal`（`:headset`）

1. 在 `127.0.0.1:8130` 起一个本地 HTTP 服务：静态页面来自 APK `assets/index.html`（由 `dist/standalone.html` 在构建时复制），另提供控制桥接口。
2. 同一服务提供 `/ws`、`/status`、`/command` 回环接口，作为患者页面与 BLE 之间的桥。
3. 作为 BLE 外设广播 `QuietShore`，向平板提供 `command` / `status` / `telemetry` / `state` 四个特征。
4. `PortalActivity` 是可见控制台；应用图标、通知正文和快捷磁贴都先打开它，显示服务、蓝牙和接管状态。
5. 控制台的“进入训练”是唯一拉起 Firefox Reality 的按钮（3 秒冷却），用显式 Intent 打开 `http://127.0.0.1:8130/?t=<时间戳>`；通知另有“打开控制台/全部应用/返回桌面”。
6. `BootReceiver` 在重启/更新后恢复服务与通知，并延迟打开头显控制台；不自动拉起 Firefox。
7. 不修改默认 HOME，不碰厂家数据；卸载 APK 后系统恢复原状。

头显端入口是可见的 `PortalActivity` 控制台；应用图标、通知正文和快捷磁贴都先到这里，不直接跳 Firefox（通知的“全部应用/返回桌面”是直达动作）。业务内容仍在 Web 层；壳负责控制台、离线资产、BLE 外设和回环桥。

### 2.2 平板端 `com.quietshore.control`（`:control`）

Kotlin + Compose 操作台，职责是“中心 + 镜像”，不承载 XR：

1. 以 BLE 中心扫描服务 UUID，连接头显，启用通知后写 `CLAIM` 接管。
2. 第一台 `CLAIM` 成功；后续平板收到 `CONTROL_BUSY`，只能在配对页等待。
3. 通过 `command` 特征发送场景、校准、声音、预览、结束等命令；接收 5 Hz 头姿态和 1 Hz 状态。
4. 用 WebView 加载 `assets/controller.html`，复用 `src/core`、`src/scenes` 渲染同一批场景，显示患者位置/朝向和场景状态。
5. “断开”先写 `RELEASE` 再断链；头显随即释放控制权。

### 2.3 共享契约 `:protocol`

纯 Kotlin JVM 模块，没有 Android 依赖。UUID、`CLAIM`/`RELEASE`、`HELLO`/`WELCOME`/`ACK`、命令白名单、20 字节遥测编解码、15 字节 state v7 都定义在这里，头显与平板共用。协议细节见 `docs/control-plane.md`。

## 3. 方案矩阵

> 本节是单 APK 时代的选型记录，保留用于解释为什么生产 WebXR 仍走 Firefox Reality。当前实现是在方案 A 之上增加 BLE 控制平面，并新增平板端 `:control`；矩阵中的“入口/成本”按当时单 APK 口径阅读。

| 方案 | WebXR/姿态来源 | 入口 | 开发/CI 成本 | 风险 | 结论 |
| --- | --- | --- | --- | --- | --- |
| A. Portal APK + Firefox Reality（当时基线） | Firefox Reality 的 Gecko VR 后端 | 通知栏/磁贴 → 本地 HTTP | 低；现有流水线可复用 | 依赖预装 Firefox；26s 退出问题；浏览器生命周期不可控 | **基线** |
| B. Portal APK + 系统 WebVR Chromium 67 | WebVR 1.1，3DoF，`hasPosition=false` | 同上，改拉起系统浏览器 | 中；需要 WebVR 渲染路径/兼容层 | 无 WebXR；Three 现代版本已移除 WebVR；交互/渲染能力受限 | 仅作 fallback 研究 |
| C. 内嵌 GeckoView + 自建 VR 胶水 | 需要 Gecko VR backend + PICO 显示/姿态集成 | APK 内 | 高；Gecko 构建、NDK、VR 后端、包体 | 原生 GeckoView 通常不暴露 `immersive-vr`；等同于重做 Firefox Reality 的 VR 层 | 高风险，暂不做 |
| D. 内嵌 Wolvic（GeckoView 系） | Wolvic 的 WebXR + 设备集成 | APK 内或外部 | 中高；需验证 Android 8.1 / 3DoF / PICO 运行时 | 对 G2 4K 无实机证据；可能依赖 OpenXR runtime；仍是浏览器依赖 | 2 周 spike，门槛严格 |
| E. WebView + WebXR polyfill | WebView 74 无 XR；polyfill 需要姿态数据 | APK 内 | 中 | 无法从 WebView 获取 PICO 3DoF 姿态；不是真 WebXR | 不可行 |
| F. 原生 OpenGL ES + PICO SDK | 厂商 SDK/传感器融合/镜头畸变 | APK 内 | 很高；NDK、SDK、渲染/文本/输入全部重写 | SDK 可得性/许可；3DoF 质量；CI；内容迁移 | 战略备选，独立立项 |
| G. Unity/Unreal + PICO SDK | 厂商 SDK | APK 内 | 高；编辑器/许可/CI | 与 Web 内容不通用；包体大 | 不优先 |
| H. PWA/Service Worker | 仍依赖 Firefox Reality | 仍需通知栏入口 | 低 | 不解决入口与浏览器依赖 | 仅离线缓存优化 |

## 4. 决策

### 4.1 基线：A + 双 APK（头显壳 + 平板控制台）

- 继续用应用图标/通知栏/快捷磁贴作为头显稳定入口；它们只打开 `PortalActivity` 控制台，不修改 HOME，不自动拉起 Firefox。
- 头显 APK 仍是薄壳，但承担四件事：轻量控制台、静态资源服务、BLE 外设、患者页面与 BLE 之间的回环桥。控制台只显示状态并提供“进入训练/全部应用/返回桌面”，不是完整 2D 主界面。
- 平板 APK 独立发布，负责操作台与三维镜像；它不承载 XR，只通过 BLE 控制和观察头显。
- Web 内容构建两次：`standalone.html` 给头显单文件页面，`controller.html` 给平板 WebView；两者复用同一套 `src/core` 与 `src/scenes`。
- 控制权先到先得，没有控制码；细节见 `docs/control-plane.md`。
- 保留 `adb reverse` 开发路径；生产走 APK 内置资产。
- 26s 退出问题是已知限制；用通知栏重新进入，不在本轮解决。

### 4.2 内容层与壳解耦

- `src/core/**` 不依赖 Android、Firefox、DOM；只依赖 Three 数学/场景对象。
- 头显入口只约定：`http://127.0.0.1:8130/` + 静态资产 + 可选 query 参数。
- 平板入口只约定：`assets/controller.html` + `window.QuietShoreBridge` / `window.qsControl` 桥；不依赖头显的 HTTP 端口。
- 壳通过 `launch(url)` 契约启动；未来换 Wolvic/原生渲染器时，内容层不感知。
- 存储键从草稿的 `stillwater.scene.v1` 迁移到 `quietshore.scene.v1`；同一 origin 下自动迁移。

### 4.3 备选轨道与 go/no-go

**轨道 E：内嵌 WebXR（Wolvic/GeckoView）**

2 周内只回答“能不能替代 Firefox Reality”：

- 在目标 APK 内，`navigator.xr.isSessionSupported('immersive-vr') === true`。
- 能拿到 3DoF 头 pose（position 固定、orientation 有效），帧率 ≥ 60Hz，无额外漂移。
- `select` 事件可用；镜头畸变/双眼渲染由运行时处理。
- APK 可离线安装、启动 < 10s、包体可接受、CI 可构建。
- 不修改 HOME、不 root、不依赖 Play Services。

任一失败即停止，不把正式 UI 绑到该路径。

**轨道 N：原生 OpenGL ES + PICO SDK**

4 周预研，只回答“是否值得重写渲染器”：

- 厂商 SDK/头显姿态/镜头畸变的许可与可得性。
- 3DoF 跟踪质量、延迟、漂移；与 Firefox Reality 对比。
- 文本渲染（中文）、空间 UI、输入、场景迁移成本。
- GitHub Actions NDK 构建可行性。
- 通过后再决定是否把 `core` 的场景/空间契约移植到原生；不通过则继续 A。

### 4.4 为什么现在不选 C/D

- “内嵌 WebXR”不是把 WebView 换成 GeckoView 就能得到 `immersive-vr`；Firefox Reality 的 VR 能力来自 Gecko 的 VR 后端与 PICO 显示/姿态集成，stock GeckoView 不保证暴露。
- Wolvic 是浏览器产品，不是可嵌入的 WebXR runtime；对 G2 4K 的 3DoF/Android 8.1 组合没有实机证据。
- 在唯一已验证路径上做正式化，风险最低；备选轨道用门槛控制，不阻塞内容开发。

## 5. CI/CD（双 APK）

- GitHub Actions，push `main` / `workflow_dispatch` 触发。
- 步骤：`npm ci` → `npm run check` → `npm test` → `npm run build` → `npm run standalone` → 安装 Android SDK Platform 36 → `cd android && ./gradlew :headset:assembleDebug :control:assembleDebug` → 上传两个 APK。
- Gradle 在 `preBuild` 复制 `dist/standalone.html`（头显 assets）与 `dist/controller.html`（平板 assets），所以 Web 构建必须排在 Gradle 之前。
- 签名：仓库不提交 keystore。常规 CI 产出 debug 签名 APK，仅用于侧载验证。Release workflow 在配置 `ANDROID_KEYSTORE_BASE64` 等 Secrets 时用 `apksigner` 重新签名；未配置时发布物仍是 debug 签名。构建变体仍是 debug，不能作为应用商店包。
- 版本：`versionCode` / `versionName` 分别写在 `android/headset/build.gradle.kts`、`android/control/build.gradle.kts`；两端独立发版。
- 产物：`:headset` 的 `headset-debug.apk`、`:control` 的 `control-debug.apk`，以及 `dist/standalone.html`、`dist/controller.html`。
- 旧库 `fire-disposal/stillwater-vr` 已在新库基线 CI 通过后从 GitHub 删除；本地草稿 `~/dev/VR` 保留。

## 6. 安全与运维边界

- **BLE 邻近即授权。** 没有控制码、配对或应用层认证；先 `CLAIM` 的平板获得控制。只适用于一台头显配一台平板的专用环境，不用于多租户或共享临床空间。
- 只监听 `127.0.0.1`；不暴露局域网。回环控制接口没有认证，只是同源页面的桥，不构成安全边界。
- 不申请不必要的权限；头显保留 `INTERNET`（本地 socket）、`FOREGROUND_SERVICE`、`RECEIVE_BOOT_COMPLETED`、蓝牙与通知权限；平板保留 BLE 扫描/连接与旧系统所需的位置权限。
- 不修改厂家 HOME、不卸载/清数据、不 root。
- 应用图标/通知/磁贴只打开 `PortalActivity` 控制台，由控制台的“进入训练”拉起 Firefox；`BootReceiver` 恢复服务/通知并打开头显控制台。
- 平板退出或链路断开时头显自动释放控制权；服务重启会清空控制者。
- 卸载 APK 后系统状态不变。
