# 静岸 · Quiet Shore VR

面向引导想象训练的 WebXR 应用：患者戴 PICO G2 4K 进入三维场景，操作员用 Android 平板控制场景、声音、校准与虚拟姿态。仓库有两个 APK，必须同版本升级。

| APK | 包名 | 角色 |
| --- | --- | --- |
| 静岸（头显端） | `com.quietshore.portal` | 控制台 + 前台服务 + BLE 外设 + 本机回环桥 |
| 静岸控制台（平板端） | `com.quietshore.control` | Compose 控制台 + BLE 中心 + WebView 三维镜像 |

当前版本：**v0.8.6**。下一步重点见根目录 [`TODO.md`](TODO.md)，文档索引见 [`docs/README.md`](docs/README.md)。

## 当前流程

1. 头显开机进入 `PortalActivity` 控制台；`PortalService` 绑定 `127.0.0.1:8130` 并广播 BLE 外设 `QuietShore`。
2. 控制台点“进入训练”拉起 Firefox Reality，打开本地页面；业务参数通过 `window.__QS_BOOTSTRAP__` 注入。
3. 患者按头显右侧确认键进入 WebXR；平板通过 BLE `CLAIM` 获得唯一控制权。
4. 平板命令经 BLE → `PortalService` → `/events` SSE → 患者页面；页面用 `/telemetry`、`/state` 回传姿态和业务状态。
5. 平板断开、心跳超时或患者停止都会释放控制权并停止虚拟运动。

## 控制面

- **BLE GATT**：命令、状态、20 字节遥测、12 字节二进制 state v3。
- **第一台接管**：首个 `CLAIM` 胜出；没有 PIN/配对/应用层认证，邻近即可申请控制。
- **存活检测**：平板每 5 s `PING`，15 s 无 `PONG` 断开；头显 20 s 无控制者写入则释放控制权。
- **命令边界**：宿主命令 `enter/home/allapps/settings:*/scene:*` 由服务执行；其余进入页面队列。白名单外或语义失败返回 `COMMAND_REJECTED`。
- **兼容**：旧文本 state 已删除；头显与平板必须同版本。`/control` 100 ms 轮询仅作为 SSE 失败兜底。
- 协议、命令和边界详见 [`docs/control-plane.md`](docs/control-plane.md)。

## 患者端能力

- 简化入口：已选场景 + 单个“看向我”目标 + 按键线框引导。
- 方向校准、眼高 1.2–1.9 m、虚拟起身/回落、近场重力粒子（当前仅 landscape）。
- 治疗师模式：平板虚拟摇杆做世界平移，300 ms TTL、0.3 m/s、径向 0.45 m。
- 角度呈现：平板 yaw/pitch 仪表、姿态新鲜度与患者/全局视角。
- XR 默认 1.25× framebuffer 超采样；`?scale=` 可覆盖。

## 构建与验证

需要 Node 20+、JDK 17+、Android SDK 36。

```bash
npm ci
npm run check
npm test
npm run build
npm run standalone
cd android && ./gradlew :headset:assembleDebug :control:assembleDebug
```

实机侧仍需验证：Firefox Reality 会话、真实 GATT state/心跳、平板摇杆、通知/磁贴、PICO 安装确认页。

## 开机与桌面

- `PortalActivity` 同时提供 `LAUNCHER` 与 `HOME` 候选。
- 本受控设备已通过 ADB 设为默认 HOME；另一套系统保留，可切回。
- `BootReceiver` 恢复服务并在开机/更新后延迟打开控制台。
- APK 本身不会静默改写默认 HOME；切换命令见 [`docs/home-switch.md`](docs/home-switch.md)。

## 已知限制

- PICO G2 4K 是 3DoF：遥测位置基本固定，平板镜像只是近似姿态。
- WebXR 只支持 Firefox Reality 10；首次使用/无网络时 Firefox 自己可能显示离线或登录引导，网页无法关闭。
- 回环 HTTP 与 BLE 都没有应用层认证，只适合一台头显 + 一台平板的受控环境。
- 当前发布物仍是 debug 签名；自更新必须先建立稳定 release keystore，方案见 [`docs/self-update-spike.md`](docs/self-update-spike.md)。

## 发布

- Release：<https://github.com/fire-disposal/quiet-shore-vr/releases>
- tag 触发 `.github/workflows/release.yml`，产出两个 APK 与 `SHA256SUMS.txt`。
- 未配置签名 secrets 时为 debug 签名，仅用于侧载验收。

## 仓库结构

```
android/protocol   纯 Kotlin：GATT 契约、命令、遥测/state 编解码
android/headset    头显 APK：控制台、服务、BLE、回环、通知/磁贴
android/control    平板 APK：Compose、Nordic BLE、WebView
src/app            患者状态机、SSE/轮询、遥测
src/core           XR、comfort、spatial、性能
src/scenes         landscape / ward / bathroom / lab
src/ui             入口、菜单、校准、字符串
tests              vitest
docs               架构、设备、分发、方案与评审
```
