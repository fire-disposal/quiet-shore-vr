# PICO G2 4K 实机约束与操作

本文把草稿阶段的实机结论迁入正式库，作为发布/调试的唯一设备基线。代码侧对应实现：

- `src/core/xr/renderer.ts`：`xrCompatible: true` 上下文、WebGL2 优先、参考空间 `local`、帧缓冲缩放。
- `src/app/App.ts`：`immersive-vr` 会话、`select` 确认键、`-eyeHeight` 地面偏移、校准/退出流程。
- `shell/android/`：`127.0.0.1:8130` 静态服务、常驻通知/快捷磁贴、显式 Intent 拉起 Firefox Reality。
- `scripts/pico-adb.sh`：设备/安装/启动/日志/截图/CI 产物下载。

## 1. 设备基线

| 项 | 值 |
| --- | --- |
| 型号 | Pico G2 4K |
| 序列号 | `PA7910RGG1020100B` |
| Android | 8.1.0 / SDK 27 |
| 构建 | `Pico/A7910/PICOA7910:8.1.0/OPM1.171019.026/eng.scmbui.20211019.215441:user/test-keys` |
| SoC | `msm8998`（Snapdragon 835），`arm64-v8a` |
| GPU | Adreno 540 |
| 内存 | 4 GB |
| 屏幕 | 2160×3840，density 720 |
| 追踪 | 3DoF 头显 + 3DoF 手柄，无位置追踪 |
| ADB | 已授权；无 root（`ro.debuggable=0`，production build） |
| USB | `2d40:0091 Pico APQ8098-MTP` |

## 2. 浏览器/XR 能力矩阵

| 入口 | 内核 | WebGL | WebXR | WebVR 1.1 |
| --- | --- | --- | --- | --- |
| Firefox Reality 10 `org.mozilla.vrbrowser` | Gecko 78 | WebGL2；MAX_TEXTURE_SIZE 16384 | `navigator.xr`；`immersive-vr = true`；`inline = true` | `getVRDisplays` 报 “Failed to find attached VR displays” |
| 系统“WebVR” `org.chromium.chrome` | Chromium 67.0.3396.123 | WebGL2；MAX_TEXTURE_SIZE 4096 | 无 | 1 个显示器 `Pico, Inc. VR & AR Viewer`；`canPresent = true`；`hasPosition = false` |
| WebView `com.android.webview` | Chromium 74.0.3729.186 | 可用 | 无 | 无 |
| InnerWeb `com.pvr.innerweb` | WebView 壳 | - | 无 | 无 |

结论：**唯一可用的 WebXR 入口是 Firefox Reality 10**。系统 WebVR 浏览器只有 3DoF WebVR 1.1，不作为生产路径。

## 3. 已踩过的 WebXR 坑

### 3.1 用户手势

`requestSession('immersive-vr')` 必须由可信用户手势触发。自动调用会失败：

```
A user gesture is required.
```

由“进入训练”按钮/触摸触发即可；XR 内相机由 pose 驱动，不再需要拖拽。

### 3.2 Gecko 78 的 `xrCompatible`

`WebGLRenderingContext.makeXRCompatible()` 会 resolve，但没有真正把上下文标记为兼容，随后 `XRWebGLLayer` 构造抛错：

```
XRWebGLLayer constructor: Can not create an XRWebGLLayer without first calling
makeXRCompatible on the WebGLRenderingContext or WebGL2RenderingContext.
```

有效解法：**创建上下文时就带 `xrCompatible: true`**，再交给 Three.js。见 `src/core/xr/renderer.ts`。

### 3.3 参考空间与地面

使用 `local` reference space；会话开始时原点约在头部高度。场景根节点的地面偏移由 `SceneHost.setFloorOffset()` 统一应用：XR 为 `-eyeHeight`，2D 预览为 `0`。场景模块自身不位移。

### 3.4 退出耗时

已有记录：XR 退出约 26s。属于 Firefox Reality/Gecko 生命周期问题，不在内容层强行修复；用通知栏重新进入。不要在退出过程中销毁场景资源，`onSessionEnd` 之后才重置。

## 4. 分发与入口

```
PICO 下拉通知栏
  → 静岸 Portal 通知/快捷磁贴
  → 显式 Intent: org.mozilla.vrbrowser/.VRBrowserActivity
  → http://127.0.0.1:8130/
  → APK assets/standalone.html
```

- 不修改厂家 HOME，不卸载/改写厂家应用，不 root。
- `PortalService` 只监听 `127.0.0.1:8130`，只服务 `/` 与 `/index.html`。
- `BootReceiver` 只恢复服务/通知，不自动拉起 Firefox。
- 旧草稿包 `com.stillwater.portal` 如仍在设备上，可用 `scripts/pico-adb.sh clean-draft` 卸载（不影响厂家数据）。

## 5. ADB 工作流

脚本默认查找 `$HOME/Android/Sdk/platform-tools/adb`，也可用 `ADB=/path/to/adb` 覆盖；多设备时设 `PICO_SERIAL=PA7910RGG1020100B`。

```bash
# 设备
./scripts/pico-adb.sh devices
./scripts/pico-adb.sh status

# 拉取最新成功 CI 的 APK、安装、启动
./scripts/pico-adb.sh deploy

# 只拉取/只安装
./scripts/pico-adb.sh fetch
./scripts/pico-adb.sh install
./scripts/pico-adb.sh launch

# 直接从 Firefox Reality 打开本地页面（调试）
./scripts/pico-adb.sh open

# 开发服务器：PC 起 npm run dev（8125），reverse 到设备后打开
npm run dev
./scripts/pico-adb.sh reverse
./scripts/pico-adb.sh open-dev

# 日志/截图
./scripts/pico-adb.sh logs
./scripts/pico-adb.sh screenshot
```

手动等价命令：

```bash
adb install -r -d artifacts/quiet-shore.apk
adb shell am start -n com.quietshore.portal/.MainActivity
adb shell am start -a android.intent.action.VIEW \
  -d http://127.0.0.1:8130/ \
  -n org.mozilla.vrbrowser/.VRBrowserActivity
adb reverse tcp:8125 tcp:8125
```

## 6. 性能与画质

- 默认高画质：`?quality=high`；低画质：`?quality=low`，同时关闭 AA、降低帧缓冲缩放。
- 无阴影贴图、无后处理；landscape/ward/bathroom 的预算见 `docs/geometry-contracts.md`。
- 若真机掉帧：先 `?quality=low&aa=0`，再降低场景细节；不要引入后处理来“补偿”。
- Firefox Reality 的 `MAX_TEXTURE_SIZE` 16384；程序化纹理均为 POT。

## 7. 壳 UI

`MainActivity` 不再使用默认 Android Button：

- 程序化布局：品牌标记、`静岸 / QUIET SHORE VR`、状态卡、暖金主按钮、次级操作、版本页脚。
- 颜色与 Web 空间 UI 共用暖石/深青底色；圆角、描边、Ripple 按压反馈。
- `BrandAssets.java` 用 Canvas 绘制启动图标、通知大/小图标、磁贴图标与三个动作图标；没有位图资源。
- `res/drawable/ic_launcher.xml` 是启动图标；`res/values/styles.xml` 是壳主题（深色状态栏/导航栏、暖金 accent）。
- 通知使用 `BigTextStyle`、暖金 `setColor`、大图标与自定义动作图标；磁贴使用同一品牌标记。

## 8. 代码侧与实机侧边界

- CI 只验证 TypeScript/单测/Web bundle/APK 构建与签名；不验证头显姿态、镜头畸变、实际帧率、通知栏可见性。
- 实机验证项：进入会话、3DoF 头动、确认键、校准、退出、通知/磁贴、音频解锁、三种场景切换、空间 UI 四种模式。
- 本文只记录已调查事实；新增实机结论应更新本文件，而不是散落在提交说明里。
