# 静岸 · Quiet Shore VR

静岸是面向引导想象训练的 WebXR 应用：患者戴 PICO G2 4K 头显进入三维场景，操作员用一台 Android 平板控制场景、声音和校准，并查看患者的实时姿态。本仓是正式化基线仓，草稿仓 `~/dev/VR` 不再直接改功能。

当前分发形态是**两个 APK**：

| APK | 包名 | 角色 |
| --- | --- | --- |
| 静岸（头显端） | `com.quietshore.portal` | 头显控制台（服务/BLE/接管状态）+ BLE 外设 + 本机回环桥；通知正文/快捷磁贴只打开控制台 |
| 静岸控制台（平板端） | `com.quietshore.control` | Compose 操作台 + BLE 中心 + WebView 三维视图 |

## 谁控制什么

| 阶段 | 头显 | 平板 |
| --- | --- | --- |
| 进入 | 点应用图标、常驻通知或快捷磁贴打开头显控制台；控制台里的“进入训练”才拉起 Firefox Reality，并有 3 秒冷却 | — |
| 开始训练 | 患者按头显右侧确认键，或点按开始页空白处，触发一次 WebXR 会话 | 不能远程开始；`start` 命令只会提示“请在头显内启动一次” |
| 训练中 | 渲染场景、播放声音、上传姿态；患者无需再操作 | 选择场景（会话外）、校准、声音开关、预览、结束训练；显示患者视角或环绕视图 |
| 结束/断开 | 平板断开后恢复患者界面；也可由患者退出 | 发送 `RELEASE` 并断开；控制权回到“无人接管” |

应用图标、通知正文和快捷磁贴只打开 `PortalActivity` 控制台，不会直接进入训练；唯一拉起 Firefox Reality 的是控制台的“进入训练”按钮。

平板和头显之间没有控制码、PIN 或蓝牙配对流程。**先连接并发送 `CLAIM` 的平板获得控制权**，第二台平板收到 `CONTROL_BUSY`，只能留在配对页。

## 架构

```
┌─────────────── PICO G2 4K ─────────────────┐        ┌────────── Android 平板 ──────────┐
│ Firefox Reality 10 (Gecko 78)              │        │ 静岸控制台 (Kotlin + Compose)     │
│   http://127.0.0.1:8130/  ← 患者 WebXR 页面 │        │  ├─ WebView: controller.html     │
│        │ fetch /control、POST /telemetry    │        │  │    同一套 Three.js 场景模块   │
│        ▼                                    │        │  └─ Nordic BLE central           │
│ 静岸 headset (Kotlin 前台服务)               │        └───────────────┬──────────────────┘
│  ├─ 静态页面 + 控制桥 127.0.0.1:8130         │                        │ BLE GATT
│  ├─ BLE 外设 "QuietShore"                   │◀───────────────────────┘
│  └─ 通知 / 快捷磁贴 / PortalActivity         │   CLAIM、命令 ↓
└─────────────────────────────────────────────┘   telemetry、state ↑
```

### 组件

- **患者 Web 应用**（`src/`）：Three.js 0.152 + TypeScript + esbuild，纯 Three.js 核心，不引入 React/R3F/Drei。`src/app/App.ts` 管理开始页、WebXR 会话、校准、场景与远控命令；`src/app/remote-control.ts` 每 400 ms 轮询同源 `/control`；`src/app/telemetry.ts` 以 5 Hz 上报头姿态、1 Hz 上报状态。
- **`:protocol`**：纯 Kotlin JVM 模块，不依赖 Android。定义 GATT 服务/特征 UUID、`CLAIM`/`RELEASE` 语义、遥测与状态的编解码。头显外设和平板中心共用这一份契约，避免两端漂移。
- **`:headset`**（`com.quietshore.portal`）：Kotlin，无 Compose。`PortalActivity` 是可达的头显控制台，显示服务、蓝牙和接管状态；“进入训练”显式拉起 Firefox，并带 3 秒冷却。`PortalService` 是前台服务，负责 `127.0.0.1:8130` 静态页面、控制/遥测回环接口、BLE 外设、常驻通知；`PortalTileService` 打开控制台；`BootReceiver` 只恢复服务与通知，不自动拉起浏览器。
- **`:control`**（`com.quietshore.control`）：Kotlin + Compose（BOM 2025.06.01）。Nordic BLE 2.11.0 作为中心扫描、连接并接管头显；WebView 通过 `WebViewAssetLoader` 加载 `https://appassets.androidplatform.net/assets/controller.html`，用 `window.QuietShoreBridge.send()` 发命令、用 `window.qsControl.*` 接收状态与姿态。
- **共享场景**：平板 WebView 和头显页面复用 `src/core/scene`、`src/core/spatial`、`src/scenes`。平板端没有 WebXR，只做三维镜像；真实头姿态来自头显 BLE 遥测。

### 数据流

1. 平板 → 头显：BLE `command` 特征写入 `CLAIM`、`RELEASE` 或控制命令。
2. 头显 → 平板：`status` 广播连接/接管结果；`telemetry` 和 `state` 只发给当前控制者。
3. 头显页面 → 头显服务：同源 `GET /control` 取命令，`POST /telemetry`、`POST /state` 回传姿态与状态。
4. 头显服务只把遥测/状态转发给已接管的平板；无人接管时丢弃。

## 构建

### 环境

| 项 | 要求 |
| --- | --- |
| Node.js | 20 或更新（CI 用 20） |
| JDK | 17 或更新（CI 用 21） |
| Android SDK | Platform 36、Build-Tools；`compileSdk = 36`、`minSdk = 26`、`targetSdk = 33` |
| Gradle | 使用仓库内 wrapper（9.8.1），不用系统 Gradle |
| Android Gradle Plugin | 9.4.1；Android 模块用 AGP 内置 Kotlin，`:protocol` 用 Kotlin JVM 插件 |

`android/local.properties` 是机器本地配置，不要提交到仓库；它必须指向 SDK：

```properties
sdk.dir=/path/to/Android/Sdk
```

也可以用 `ANDROID_HOME` / `ANDROID_SDK_ROOT`。首次构建会下载 Gradle 9.8.1 与依赖。

### 命令

```bash
npm ci
npm run check        # tsc --noEmit
npm test             # vitest
npm run build        # dist/index.html + dist/controller.html
npm run standalone   # dist/standalone.html（头显单文件页面）

cd android
./gradlew :headset:assembleDebug :control:assembleDebug
```

顺序不能颠倒：`:headset` 和 `:control` 的 `preBuild` 会把 `dist/standalone.html`、`dist/controller.html` 复制进各自 `src/main/assets/`。先跑 `npm run build` 与 `npm run standalone`，Gradle 才能打包到最新页面。

`npm run build` 会先清空 `dist/`，因此它必须排在 `npm run standalone` 之前。

开发时可用：

```bash
npm run dev          # http://127.0.0.1:8125/ 与 /controller.html
```

### APK 输出

| 产物 | 路径 |
| --- | --- |
| 头显 APK | `android/headset/build/outputs/apk/debug/headset-debug.apk` |
| 平板 APK | `android/control/build/outputs/apk/debug/control-debug.apk` |

### 安装

```bash
adb install -r android/headset/build/outputs/apk/debug/headset-debug.apk
adb install -r android/control/build/outputs/apk/debug/control-debug.apk
```

也可以直接让 Gradle 安装：`./gradlew :headset:installDebug :control:installDebug`。

启动：

```bash
# 头显：打开控制台（再点“进入训练”才拉起 Firefox Reality）
adb shell am start -n com.quietshore.portal/.PortalActivity

# 平板：打开平板控制台
adb shell am start -n com.quietshore.control/.MainActivity
```

头显端入口是 `PortalActivity` 头显控制台，不会直接跳转 Firefox。日常使用不需要 adb：点应用图标、下拉通知栏里的“静岸”通知，或快捷磁贴打开控制台；再点“进入训练”。该按钮有 3 秒冷却，防止连点重复拉起 Firefox；冷却期间点击只提示稍候。

平板首次启动需要授予“附近的设备”权限（Android 12+）或位置权限（Android 11 及以下），否则无法扫描。

## 运行流程

1. **头显启动服务**：打开静岸控制台（应用图标、通知或快捷磁贴）后，控制台会启动 `PortalService`；服务绑定 `127.0.0.1:8130`，并开始以 `QuietShore` 为名广播 GATT 服务。通知显示“等待平板连接”；蓝牙关闭时显示“蓝牙未开启”。
2. **打开患者页面**：在控制台点“进入训练”。显式 Intent 拉起 Firefox Reality，打开 `http://127.0.0.1:8130/?minimal=1&from=portal&t=<时间戳>`；时间戳避免 Firefox 复用旧文档。loopback 是安全上下文，不需要 HTTPS。
3. **患者开始一次**：患者按头显右侧确认键，或点按开始页空白处。WebXR 的 `requestSession('immersive-vr')` 必须由可信用户手势触发，这是整个流程中患者唯一必须做的操作。随后进入方向校准，除非 URL 带 `nocal=1`。
4. **平板接管**：平板端“搜索头显” → 选择 `QuietShore` → 连接。启用通知后平板写入 `CLAIM`；头显把第一台平板记为控制者并回 `CONTROL_OK`。第二台得到 `CONTROL_BUSY`，连接被关闭，停留在配对页。
5. **训练中**：平板发命令并接收姿态（5 Hz）与状态（1 Hz）。平板 WebView 复用头显的场景模块，显示患者位置、朝向和当前场景。
6. **释放**：平板点“断开”会先写 `RELEASE` 再断开；直接断链也会让头显清除控制者。头显恢复患者界面，通知回到“等待平板连接”。

### 第一台接管规则

- 同一时刻只有一个控制者；没有控制码，没有配对/PIN。
- 同一台平板重复 `CLAIM` 是幂等的，仍返回 `CONTROL_OK`。
- 非控制者发送命令或 `RELEASE` 会得到 `CONTROL_REQUIRED`，控制权不变。
- 控制者断开连接后，控制权立即释放；下一台平板可以重新接管。
- 头显服务重启会清空控制者，平板需要重新连接并 `CLAIM`。

### 控制命令

| 命令 | 作用 | 说明 |
| --- | --- | --- |
| `scene:<id>` | 切换场景 | `landscape` / `ward` / `bathroom` / `lab`；WebXR 会话进行中会被拒绝，需先结束会话 |
| `preview` | 头显端 2D 预览 | 不进入 WebXR |
| `calibrate` | 重新校准 | 会话中可用 |
| `audio:on` / `audio:off` / `audio:toggle` | 声音 | 立即生效 |
| `exit` / `stop` | 结束训练并退出 | 清理会话 |
| `start` | 不远程启动 | 患者页面提示“请在头显内启动一次，之后由平板控制” |

平板只发送上述允许列表中的命令；头显把控制者的非空命令原样转给页面，页面忽略无法识别的字符串并显示提示。

## 约束与已知限制

- **蓝牙邻近就是授权边界。** 当前设计没有控制码或配对，任何在无线电范围内、装了控制台 APK 的平板都能在无人占用时接管。它只适用于“一台头显 + 一台平板”的专用演示/治疗环境；不要在多患者共用空间里依赖它做身份隔离。
- **回环 HTTP 只监听 `127.0.0.1`。** 不向局域网暴露，但本机其他应用理论上可以访问 `:8130`；接口没有认证，不要把它当作安全边界。
- **WebXR 只支持 Firefox Reality 10（Gecko 78）。** PICO G2 4K 上这是唯一 `immersive-vr = true` 的入口；系统 WebVR 浏览器只有 WebVR 1.1，WebView 74 没有 XR。平板 WebView 只做镜像，不能发起 XR。
- **必须有一次头显手势。** 远程 `start` 不能绕过浏览器的手势要求；页面重载或会话结束后，需要再次在头显内确认。
- **退出慢。** Firefox Reality 退出约 26 秒属于已知运行时问题；用通知栏打开控制台，再点“进入训练”，不要在此期间销毁场景资源。
- **遥测是 3DoF 头姿态。** `x/y/z` 位置在设备上基本固定，平板视图只是近似姿态；姿态 5 Hz、状态 1 Hz，不是逐帧镜像。
- **场景切换只在会话外。** 训练进行中平板改场景会被头显拒绝并提示先结束会话。
- **不 root、不改 HOME、不碰厂家数据。** 所有 Intent 都是显式的；卸载两个 APK 后设备行为恢复原状。

## URL 参数

头显页面支持的查询参数：

| 参数 | 作用 |
| --- | --- |
| `?quality=low` | 低画质（同时关闭 AA） |
| `?aa=0` | 关闭抗锯齿 |
| `?scene=landscape\|ward\|bathroom\|lab` | 初始场景 |
| `?nocal=1` | 跳过方向校准 |
| `?minimal=1` | 精简开始页；头显入口默认带上 |
| `?from=portal` | 兼容旧入口，等价于精简模式 |
| `?hud=1` | 测试员性能面板 |
| `?lang=en` | 英文界面 |
| `?spin=1` | 测试用自动旋转 |

## 仓库结构

```
android/
  protocol/        纯 Kotlin JVM：GATT 契约、命令与编解码
  headset/         头显 APK：控制台、前台服务、BLE 外设、回环桥、通知/磁贴
  control/         平板 APK：Compose 控制台、Nordic BLE、WebView
src/
  app/             患者应用状态机、远控轮询、遥测上报
  controller/      平板 WebView 页面（复用场景模块）
  core/            场景、几何、空间 UI、XR 契约
  scenes/          landscape / ward / bathroom / lab
  ui/              开始页、空间 UI、校准、字符串
tests/             vitest 单元测试
docs/              架构、设备、分发与迁移文档
scripts/           旧单 APK 时代的 adb 辅助脚本
build.mjs          esbuild 构建：患者页面、standalone、controller
```

## 发布下载

- **GitHub Release v0.2.1**：<https://github.com/fire-disposal/quiet-shore-vr/releases/tag/v0.2.1>
- 头显 APK：`quiet-shore-headset-v0.2.1.apk`
- 平板 APK：`quiet-shore-control-v0.2.1.apk`
- 校验：同一 Release 内的 `SHA256SUMS.txt`

若 Release 尚未出现，可在 GitHub Actions 的 `build` 运行里下载 `quiet-shore-apk` 工件，内含 `headset-debug.apk`、`control-debug.apk` 与 `SHA256SUMS.txt`。未配置签名 secrets 时产物是 debug 签名，只用于侧载验收。

发布时在本节补充：

- 版本号与发布日期
- 两个 APK 的下载链接
- 两个文件的 sha256
- 签名证书指纹

## 文档

| 文档 | 内容 |
| --- | --- |
| `docs/control-plane.md` | BLE GATT 契约、第一台接管状态机、回环接口、入口与排障 |
| `docs/distribution.md` | 分发形态、方案矩阵与取舍、CI/CD、安全边界 |
| `docs/pico-g2.md` | PICO G2 4K 实机基线、WebXR 坑、ADB 工作流 |
| `docs/spatial-ui.md` | 四种空间 UI 模式契约 |
| `docs/geometry-contracts.md` | 变换、几何与帧管线约定 |
| `docs/migration.md` | 草稿场景迁移与资源 ownership |
| `docs/tech-selection.md` | 纯 Three.js 核心与 R3F/Drei 的取舍 |
| `docs/ui-audit.md` | 草稿 UI 的经验与正式化方向 |
| `docs/home-switch.md` | 设备 HOME 切换勘测（历史调查，当前 APK 不注册 HOME） |
| `docs/performance-evidence.md` | Three 核心与 R3F/Drei 的包体/帧时间对照 |

## 排障

| 现象 | 检查 |
| --- | --- |
| 头显通知“蓝牙未开启” | 在头显设置里打开蓝牙，服务会自动重试广播 |
| 头显通知“蓝牙不可用” | 适配器不支持多广播或 GATT server 打开失败；重启蓝牙/服务后重试 |
| 平板搜不到头显 | 确认头显服务在跑、在范围内；确认平板已授予扫描权限；确认服务未被其他进程占用 |
| 平板提示“头显正被另一台平板控制” | 另一台平板持有控制权；在其上点“断开”或直接关闭应用 |
| 平板连上但没有姿态 | 患者尚未进入 WebXR，或页面未上报；先完成头显内开始手势 |
| 头显页面打不开/一直转圈 | 确认已在控制台点“进入训练”；确认 Firefox Reality 已安装；确认 `:8130` 未被占用；查看 `adb logcat -s QuietShorePortal` |
| WebXR 不启动 | 必须由头显内的可信手势触发；确认使用 Firefox Reality，而非系统浏览器 |
| 平板三维区域空白 | 查看 WebView 加载错误；确认 `controller.html` 已打进 APK；必要时重装平板 APK |
