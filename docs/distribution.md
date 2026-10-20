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
| 已稳定入口 | PICO 下拉通知栏 → 本应用常驻通知/快捷磁贴 → 进入页面 |
| 已禁用 | 修改厂家 HOME、卸载/改写厂家应用、默认浏览器劫持 |

## 2. 当前壳的真实职责

当前“原生 APK”不是后端，也不承载业务逻辑：

1. 在 `127.0.0.1:8130` 起一个只读静态 HTTP 服务，内容来自 APK `assets/index.html`。
2. 常驻通知 + 快捷磁贴提供“进入训练/全部应用/返回桌面”。
3. “进入训练”用显式 Intent 拉起 Firefox Reality，打开 `http://127.0.0.1:8130/`。
4. `BootReceiver` 在重启/更新后恢复服务与通知，但不自动拉起 Firefox。
5. 不修改默认 HOME，不碰厂家数据；卸载 APK 后系统恢复原状。

这个职责很小，应该继续保持“薄壳”。业务内容全部在 Web 层，壳只做入口与离线资产。

## 3. 方案矩阵

| 方案 | WebXR/姿态来源 | 入口 | 开发/CI 成本 | 风险 | 结论 |
| --- | --- | --- | --- | --- | --- |
| A. Portal APK + Firefox Reality（现状） | Firefox Reality 的 Gecko VR 后端 | 通知栏/磁贴 → 本地 HTTP | 低；现有流水线可复用 | 依赖预装 Firefox；26s 退出问题；浏览器生命周期不可控 | **基线** |
| B. Portal APK + 系统 WebVR Chromium 67 | WebVR 1.1，3DoF，`hasPosition=false` | 同上，改拉起系统浏览器 | 中；需要 WebVR 渲染路径/兼容层 | 无 WebXR；Three 现代版本已移除 WebVR；交互/渲染能力受限 | 仅作 fallback 研究 |
| C. 内嵌 GeckoView + 自建 VR 胶水 | 需要 Gecko VR backend + PICO 显示/姿态集成 | APK 内 | 高；Gecko 构建、NDK、VR 后端、包体 | 原生 GeckoView 通常不暴露 `immersive-vr`；等同于重做 Firefox Reality 的 VR 层 | 高风险，暂不做 |
| D. 内嵌 Wolvic（GeckoView 系） | Wolvic 的 WebXR + 设备集成 | APK 内或外部 | 中高；需验证 Android 8.1 / 3DoF / PICO 运行时 | 对 G2 4K 无实机证据；可能依赖 OpenXR runtime；仍是浏览器依赖 | 2 周 spike，门槛严格 |
| E. WebView + WebXR polyfill | WebView 74 无 XR；polyfill 需要姿态数据 | APK 内 | 中 | 无法从 WebView 获取 PICO 3DoF 姿态；不是真 WebXR | 不可行 |
| F. 原生 OpenGL ES + PICO SDK | 厂商 SDK/传感器融合/镜头畸变 | APK 内 | 很高；NDK、SDK、渲染/文本/输入全部重写 | SDK 可得性/许可；3DoF 质量；CI；内容迁移 | 战略备选，独立立项 |
| G. Unity/Unreal + PICO SDK | 厂商 SDK | APK 内 | 高；编辑器/许可/CI | 与 Web 内容不通用；包体大 | 不优先 |
| H. PWA/Service Worker | 仍依赖 Firefox Reality | 仍需通知栏入口 | 低 | 不解决入口与浏览器依赖 | 仅离线缓存优化 |

## 4. 决策

### 4.1 基线：A（Portal APK + Firefox Reality）

- 继续用通知栏/快捷磁贴作为稳定入口；不修改 HOME，不自动拉起 Firefox。
- APK 只做薄壳：静态资源服务、入口、版本信息、崩溃/日志（可选）。
- Web 内容独立构建为 `standalone.html`，APK 构建时复制，避免网络依赖。
- 保留 `adb reverse` 开发路径；生产走 APK 内置资产。
- 26s 退出问题是已知限制；用通知栏重新进入，不在本轮解决。

### 4.2 内容层与壳解耦

- `src/core/**` 不依赖 Android、Firefox、DOM；只依赖 Three 数学/场景对象。
- Web 入口只约定：`http://127.0.0.1:8130/` + 静态资产 + 可选 query 参数。
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

## 5. CI/CD（新库）

- GitHub Actions，push `main` / `workflow_dispatch` 触发。
- 步骤：`npm ci` → `npm run check` → `npm test` → `npm run build` → `npm run standalone` → Android SDK → `shell/android/build.sh` → 上传 APK artifact。
- 签名：仓库不提交 keystore；CI 从 Secrets 读取 `ANDROID_KEYSTORE_BASE64`、`ANDROID_KEYSTORE_PASSWORD`、`ANDROID_KEY_ALIAS`、`ANDROID_KEY_PASSWORD`。缺失时生成一次性 debug keystore，artifact 明确标注 `unsigned-debug`。
- 版本：`versionCode` 取 `GITHUB_RUN_NUMBER`，`versionName` 取 `package.json` 版本；本地构建可覆盖。
- 产物：`quiet-shore.apk` + `quiet-shore-standalone.html` + source maps（可选）。
- 旧库 `fire-disposal/stillwater-vr` 在新库首次 CI 通过后从 GitHub 删除；本地草稿 `~/dev/VR` 保留。

## 6. 安全与运维边界

- 只监听 `127.0.0.1`；不暴露局域网。
- 不申请不必要的权限；保留 `INTERNET`（本地 socket）、`FOREGROUND_SERVICE`、`RECEIVE_BOOT_COMPLETED`。
- 不修改厂家 HOME、不卸载/清数据、不 root。
- 通知/磁贴是唯一稳定入口；`BootReceiver` 只恢复通知，不自动拉起 Firefox。
- 卸载 APK 后系统状态不变。
