# quiet-shore-vr（静岸 · Quiet Shore VR）

面向站立排尿困难者的场景化 WebXR 系统：患者佩戴 PICO G2 4K，站在按真实尺度搭建的卫生间里，技术员使用 Android 平板通过蓝牙远程控制会话模式、强度与声音。

**状态**：v0.9.2（三场景 `washroom` / `shore` / `lightwell`，控制端切换；状态帧 v11；手动触发的稳定窗口校准；中英双语语音提示 27 句；双端 debug 签名，实机联调中）；**入口**：https://qs.205716.xyz；**仓库**：[fire-disposal/quiet-shore-vr](https://github.com/fire-disposal/quiet-shore-vr)

**烧录包**（同版本，必须一起升级）：`artifacts/flash/quiet-shore-headset-0.9.2.apk`、`artifacts/flash/quiet-shore-control-0.9.2.apk`，校验见同目录 `SHA256SUMS.txt`。

## 本质

把卧床病人的三维引导想象场景呈现与平板端远程 BLE/WebSocket 控制面解耦的沉浸式 WebXR 训练系统。

## 选型

基于 Three.js + WebXR 的双端协同架构，头显端以 Firefox Reality 10 为 WebXR 容器并运行 Android 伴生服务，控制端为 Kotlin Compose 原生平板应用。

- 运行时
  - Android 8.1 (SDK 27 / Snapdragon 835) + Node 22
- WebXR 渲染
  - Three.js 0.152（固定 `XR_SCALE 1.25`、`antialias: true`，无画质挡位）
  - TypeScript + esbuild
- Android 头显端 (`com.quietshore.portal`)
  - Kotlin + Android 前台服务 + BLE GATT 外设 + 本地回环 HTTP/WS 桥
- Android 控制端 (`com.quietshore.control`)
  - Jetpack Compose + Nordic BLE
- 外部服务与通信
  - BLE GATT（20 字节二进制 state v10 与序号回执）
  - 本地 WebSocket（`/ws?since=<seq>` 单一双向通道）
- 部署
  - 双 APK GitHub Actions 自动构建与发布签名

## 功能

- 会话：患者按确认键开始/停止；会话模式与场景都由技术员在平板选定，场景只在会话前切换。
- 漂浮：世界竖向缓慢漂移（周期 11 s，满强度 ±35 mm）+ 近场微粒上飘，强度 0–3；停止时按 tau 0.25 s 渐出，1 s 内收住。
- 朝向记录：会话开始后的第一帧取当前头部朝向作为站立中立帧，没有稳定检测与倒计时。
- 场景：两个，由技术员在平板选择（会话前可换）。`washroom` 洁净立便间（默认）：2.4 × 2.4 × 2.55 m 单间、立便器、木隔屏、天光；`shore` 仰望湖面：天穹、一层漂移云、水面与日光、4 m 内木桩与芦苇；`lightwell` 光井：18 m 直径、120 m 高竖井，二十道自发光环状构件向上掠过。均无人物、无标牌。
- 双 APK 通信：头显前台服务广播 BLE 外设，平板自动扫描连接、`HELLO 2` / `WELCOME 2` 握手与 5 s PING 存活检测；state 为 20 字节 v10。
- 平板界面：单屏——连接、会话时长、模式、开始/结束、漂浮强度、水声、常驻急停。
- 未完成：新场景的仰视构图实机定稿；端上自更新；PICO G2 4K 的 OpenXR 原生迁移（经评估无法支持）。

## 启动流程

```bash
npm ci
npm run check              # 类型检查
npm test                   # 运行 vitest 单元测试
npm run build              # 构建 WebXR 静态资源
npm run standalone         # 打包单文件离线网页
cd android && ./gradlew :protocol:test :headset:assembleDebug :control:assembleDebug # 编译头显与控制端 APK
```

前置：JDK 17、Android SDK 36、Node 20+；真机调试需通过 ADB 反向代理端口 `adb reverse tcp:8130 tcp:8130`，并在 PICO G2 4K 内启动 Firefox Reality 10 访问 `http://localhost:8130`。

## 边界与已知问题

- 设备限制：PICO G2 4K 仅支持 3DoF 姿态追踪（无位置位移），漂浮与起身均为纯视觉偏移。
- 浏览器绑定：WebXR 能力仅在内置 Firefox Reality 10 中可用，系统自带 Chromium 67 内核浏览器无法创建 WebXR 会话。
- 认证边界：本地回环 HTTP 与 BLE GATT 均无应用层密码认证，设计为受控医疗环境下的单头显对单平板使用。
- 场景观感：立便器与眼的距离、墙面明度、天光强度需在实机定稿。
- 签名状态：当前产物为 debug 签名，生产化前需建立持久化 Release Keystore。

## 文档索引

- [docs/core.md](docs/core.md) — 目标、场景接口与核心设计规范
- [docs/control-plane.md](docs/control-plane.md) — BLE 与 WebSocket 控制面通信契约
- [docs/rotation-contract.md](docs/rotation-contract.md) — 姿态角度契约与 state v10 编解码
- [docs/pico-g2.md](docs/pico-g2.md) — PICO G2 4K 硬件能力与踩坑记录
- [docs/ux-plan.md](docs/ux-plan.md) — UX/UI 现状评估、运动编排与四带控制台计划
- [docs/voice-script.md](docs/voice-script.md) — 引导语音脚本（40 句）、控制端触发与 TTS 生成规范
- [TODO.md](TODO.md) — 迭代演进与重构路线
