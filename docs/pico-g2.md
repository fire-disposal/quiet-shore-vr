# PICO G2 4K 实机约束与操作

本文把草稿阶段的实机结论迁入正式库，作为发布/调试的唯一设备基线。代码侧对应实现：

- `src/core/xr/renderer.ts`：`xrCompatible: true` 上下文、WebGL2 优先、参考空间 `local`、帧缓冲缩放。
- `src/app/App.ts`：`immersive-vr` 会话、`select` 确认键、`-eyeHeight` 地面偏移、校准/退出流程。
- `android/headset/`：`127.0.0.1:8130` 静态服务与控制桥、BLE 外设、常驻通知/快捷磁贴、显式 Intent 拉起 Firefox Reality。
- `android/control/`：平板控制台（BLE 中心 + Compose 单屏）。
- `scripts/pico-adb.sh`：设备/日志/截图等设备级辅助命令；它仍按旧单 APK 流程编写，安装/启动命令见第 5 节。

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

由“开始训练”按钮、右侧确认键，或点按开始页空白处触发即可；XR 内相机由 pose 驱动，不再需要拖拽。

当前流程只要求患者在头显内做这一次手势。之后由平板通过 BLE 控制场景、校准、声音和结束；远程 `start` 不能替代浏览器要求的手势，只会提示“请在头显内启动一次”。

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

已有记录：XR 退出约 26s。属于 Firefox Reality/Gecko 生命周期问题，不在内容层强行修复；用通知栏打开控制台，再点“进入训练”。不要在退出过程中销毁场景资源，`onSessionEnd` 之后才重置。

## 4. 分发与入口

```
PICO 应用图标 / 下拉通知栏 / 快捷磁贴
  → com.quietshore.portal/.PortalActivity（头显控制台）
  → PortalService：127.0.0.1:8130 + BLE 外设 "QuietShore"
  → 控制台“进入训练”（3 秒冷却）
  → 显式 Intent: org.mozilla.vrbrowser/.VRBrowserActivity
  → http://127.0.0.1:8130/?t=<时间戳>
  → APK assets/index.html（构建自 dist/standalone.html）
```

- 不修改厂家 HOME，不卸载/改写厂家应用，不 root。
- `PortalService` 只监听 `127.0.0.1:8130`，提供 `/`、`/index.html`、`/ws`、`/status`、`/command`。
- 头显端有可到达的 `PortalActivity` 控制台；应用图标、通知正文和快捷磁贴先打开控制台，不会直接拉起 Firefox。“进入训练”是唯一拉起 Firefox 的按钮，带 3 秒冷却。
- `BootReceiver` 恢复服务/通知，并延迟打开头显控制台；不自动拉起 Firefox。
- 平板 `com.quietshore.control` 通过 BLE 接管；没有控制码，先连接并 `CLAIM` 的平板获得控制权。协议见 `docs/control-plane.md`。
- 旧草稿包 `com.stillwater.portal` 如仍在设备上，可用 `scripts/pico-adb.sh clean-draft` 卸载（不影响厂家数据）。

## 5. ADB 工作流

双 APK 的构建与安装：

```bash
# 先构建 Web 资产，再构建两个 APK（见根 README）
npm ci && npm run build && npm run standalone
cd android && ./gradlew :headset:assembleDebug :control:assembleDebug
cd ..

adb install -r android/headset/build/outputs/apk/debug/headset-debug.apk
adb install -r android/control/build/outputs/apk/debug/control-debug.apk

# 头显：打开 PortalActivity 控制台（再点“进入训练”拉起 Firefox）
adb shell am start -n com.quietshore.portal/.PortalActivity
# 平板：打开控制台
adb shell am start -n com.quietshore.control/.MainActivity
```

手动打开头显页面 / 开发服务器：

```bash
adb shell am start -a android.intent.action.VIEW \
  -d 'http://127.0.0.1:8130/' \
  -n org.mozilla.vrbrowser/.VRBrowserActivity

npm run dev
adb reverse tcp:8125 tcp:8125
adb shell am start -a android.intent.action.VIEW \
  -d http://127.0.0.1:8125/ \
  -n org.mozilla.vrbrowser/.VRBrowserActivity
```

`scripts/pico-adb.sh` 仍按旧单 APK 编写：`fetch` / `deploy` / `launch` 指向旧的 `quiet-shore.apk` 和已不存在的 `.MainActivity`，不要用于双 APK 流程。设备级命令仍可用（脚本默认查找 `$ANDROID_SDK_ROOT`/`$ANDROID_HOME`、`/opt/android-sdk`、`$HOME/Android/Sdk` 下的 `platform-tools/adb`，可用 `ADB=` 覆盖，多设备时设 `PICO_SERIAL`）：

```bash
./scripts/pico-adb.sh devices
./scripts/pico-adb.sh status
./scripts/pico-adb.sh open          # 头显页面已在运行时直接打开 :8130
./scripts/pico-adb.sh reverse       # 开发服务器 reverse 8125
./scripts/pico-adb.sh logs
./scripts/pico-adb.sh screenshot
```

安装单个头显 APK 可用 `./scripts/pico-adb.sh install android/headset/build/outputs/apk/debug/headset-debug.apk`。

## 6. 性能与画质

一台设备，一套参数：`src/core/xr/renderer.ts` 写死 `antialias: true`、`XR_SCALE = 1.25`、2D 预览 `pixelRatio = 1`。没有 `?quality`、`?aa`、`?scale`，也没有跨会话自适应降档——降档只会在一次慢会话后永久把画面变糊，而这个 GPU 的余量应该花在超采样上。

### 6.1 预算（由 `tests/scenes.test.ts` 断言）

| 项 | 上限 | 实测（`washroom`） |
| --- | --- | --- |
| draw calls | 10 | 10（墙/地/顶、隔屏、立便器、碗沿、喉部、背板、冲水面板、天光） |
| 三角形 | 3 k | 568 |
| 纹理 | 6 | 5 |
| 透明网格 | 3 | 0 |
| 满屏 pass / 眼 | 1 | 房间本身 1 |

### 6.2 为什么这条预算是对的

Adreno 540 在这个分辨率上**不是几何瓶颈**：旧场景 21–24 次绘制、39.5 k 三角形，帧率同样接近刷新率上限，说明成本在填充率。旧场景每眼要付：两套满屏天穹（其中一个逐像素 noise + dither）、三张云幕、两层实例化云、雾片、增光片、水面与透明植被，合计约 6–8 次满屏等价的混合。

卫生间场景只有**一次**满屏填充：四面墙/顶合批成一次绘制，其余都是小面积不透明几何；没有透明网格，因此没有排序、没有混合、没有 overdraw 叠加。省下的填充预算直接给了 1.25× 超采样（1.56× 像素），画质与帧时间同时改善。

### 6.3 抗锯齿的边界

- three r152 走 `XRWebGLLayer` 时把上下文属性里的 `antialias` 交给浏览器（`WebXRManager.js` 中 `layers` 分支才会用 `samples: 4`）。Gecko 78 没有 WebXR Layers，所以实时 MSAA 很可能实际不生效；`gl.getParameter(gl.SAMPLES)` 在会话里可确认。
- 因此抗锯齿靠**超采样**（`XR_SCALE`），而不是后处理。`postprocessing` / FXAA / SMAA / TAA 都要求先把场景渲到离屏 RT 再全屏合成，WebXR base layer 下拿不到，且 4K×2 上多一次全屏 pass 比它省下的锯齿更贵。
- 几何上避免硬边透明：芦苇用 `transparent` 混合而不是 `alphaTest`，云与水用带 mipmap 的贴图，天穹渐变不带 dither。剩下真正的边缘（木桩、地平线交界）交给 1.25 倍超采样。

### 6.4 掉帧时的顺序

1. 先看 HUD 的 `p95`，不是 fps 均值：XR 的 rAF 被 vsync 锁在刷新率，80–90 往往就是 90 Hz 的上限。
2. 确认 `XR_SCALE` 是否被改过（HUD 显示 `1.25x`）。
3. 再考虑降 `XR_SCALE` 到 1.1；不要关闭 AA（无效果但会让 MSAA 路径彻底消失）。
4. 不要加后处理"补偿"，也不要重新引入第二层云或第二套天穹。

## 7. 头显控制台、通知与磁贴

头显 APK 有一个轻量 `PortalActivity` 控制台；品牌资产也用于通知和磁贴：

- 控制台显示当前场景、服务/蓝牙/接管状态；顶栏退出弹窗提供“原训练系统 / 全部应用 / 默认桌面”。只有“进入训练”拉起 Firefox Reality，并带 3 秒冷却。
- `BrandAssets.kt` 用 Canvas 绘制通知图标、磁贴图标与动作图标；没有位图资源。
- `res/drawable/ic_launcher.xml` 是启动图标；`res/values/styles.xml` 是壳主题，`PortalActivity` 使用 `PortalTheme`。
- 常驻通知只保留“打开控制台”入口，不再播报等待状态；退出/全部应用/默认桌面统一在控制台或顶栏退出弹窗中处理。
- 快捷磁贴标签“静岸”，点击打开控制台，不直接进入训练。

## 8. 代码侧与实机侧边界

- CI 验证 TypeScript/单测/Web bundle/两个 APK 的 debug 构建；不验证头显姿态、镜头畸变、实际帧率、通知栏可见性、BLE 接管。
- 实机验证项：进入会话、3DoF 头动、右侧确认手势、一次朝向记录、确认键开始/停止、漂浮遮挡感与致晕、停止渐出、场景仰视构图、退出、通知/磁贴、音频解锁、平板接管/释放/自动连接/第二台 busy、平板单屏可读性。
- 本文只记录已调查事实；新增实机结论应更新本文件，而不是散落在提交说明里。
