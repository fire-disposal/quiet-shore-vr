# quiet-shore-vr（静岸 · Quiet Shore VR）

面向卧床患者的引导想象与失重体验 WebXR 系统：患者佩戴 PICO G2 4K 仰卧观看定制虚拟场景，技术员使用 Android 平板控制台通过蓝牙与 WebSocket 远程控制场景切换、视角校准、姿态引导与声音播放。

**状态**：原型（v0.8.11，已实机跑通，状态机 v8 运转正常；自更新与双端发布签名待做）；**入口**：https://qs.205716.xyz；**仓库**：[fire-disposal/quiet-shore-vr](https://github.com/fire-disposal/quiet-shore-vr)

## 本质

把卧床病人的三维引导想象场景呈现与平板端远程 BLE/WebSocket 控制面解耦的沉浸式 WebXR 训练系统。

## 选型

基于 Three.js + WebXR 的双端协同架构，头显端以 Firefox Reality 10 为 WebXR 容器并运行 Android 伴生服务，控制端为 Kotlin Compose 原生平板应用。

- 运行时
  - Android 8.1 (SDK 27 / Snapdragon 835) + Node 22
- WebXR 渲染
  - Three.js 0.152
  - TypeScript + Vite
- Android 头显端 (`com.quietshore.portal`)
  - Kotlin + Android 前台服务 + BLE GATT 外设 + 本地回环 HTTP/WS 桥
- Android 控制端 (`com.quietshore.control`)
  - Jetpack Compose + Nordic BLE + WebView 镜像
- 外部服务与通信
  - BLE GATT（20 字节二进制 state v8 与序号回执）
  - 本地 WebSocket（`/ws?since=<seq>` 单一双向通道）
- 部署
  - 双 APK GitHub Actions 自动构建与发布签名

## 功能

- 3DoF 一步快速校准：患者舒适卧姿看向前方静止 1.2 秒自动对齐站立中立参考系，无需二次重映射。
- 平板端控制面：偏航（±180°）与俯仰（±90°）滑动条精准调校、上仰/下俯/回正固定预设与呼吸辅助。
- 多场景渲染引擎：`landscape`（湖畔风景）、`ward`（病房环境）、`bathroom`（卫生间）与 `lab`（直立光室参照系）。
- 注视交互：6 秒悬停注视选择目标，暗色底环与高亮进度弧引导，头显内无悬浮遮挡菜单。
- 双 APK 同步通信：头显端前台服务广播 BLE 外设，平板端自动扫描连接、握手（`HELLO 1` / `WELCOME 1`）与心跳存活检测（5s PING）。
- 平板端三维画布录像：控制端支持直接抓取 WebView 画布录制为 MP4/WebM 用于演示评估。
- 未完成：端上安全自更新机制；PICO G2 4K 上的 OpenXR 原生迁移（经评估无法支持）。

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

- 设备限制：PICO G2 4K 仅支持 3DoF 姿态追踪（无位置位移），起身与仰卧位移均为纯视觉渲染偏移。
- 浏览器绑定：WebXR 能力仅在内置 Firefox Reality 10 中可用，系统自带 Chromium 67 内核浏览器无法创建 WebXR 会话。
- 认证边界：本地回环 HTTP 与 BLE GATT 均无应用层密码认证，设计为受控医疗环境下的单头显对单平板使用。
- 录像约束：平板镜像录制仅捕获渲染画布，无环境音频流，页面崩溃或刷新会导致当前未完成录像丢弃。
- 签名状态：当前 Actions 构建产物采用 debug 签名，生产化前需建立持久化 Release Keystore。

## 文档索引

- [docs/core.md](docs/core.md) — 目标、场景接口与核心设计规范
- [docs/control-plane.md](docs/control-plane.md) — BLE 与 WebSocket 控制面通信契约
- [docs/rotation-contract.md](docs/rotation-contract.md) — 姿态角度契约与 state v8 编解码
- [docs/pico-g2.md](docs/pico-g2.md) — PICO G2 4K 硬件能力与踩坑记录
- [TODO.md](TODO.md) — 迭代演进与重构路线
