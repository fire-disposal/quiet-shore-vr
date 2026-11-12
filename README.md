# quiet-shore-vr（静岸 · Quiet Shore VR）

静岸是一套床边的场景体验。患者在躺卧的体位下，看见近似站立时的视野。节奏由技术员掌握。患者按一次头显上的按钮确认开始，随时可以说停。

**状态**：v2.0.0（三场景 `washroom` / `shore` / `ward`，按躺姿眼高重新构图；状态帧 v14；控制端只有一套运动学：体位 / 起伏 / 视线；平板界面为浅色 App 版式，双端 debug 签名）；**入口**：https://qs.205716.xyz；**仓库**：[fire-disposal/quiet-shore-vr](https://github.com/fire-disposal/quiet-shore-vr)

**烧录包**（同版本，必须一起升级）：`artifacts/flash/quiet-shore-headset-2.0.0.apk`、`artifacts/flash/quiet-shore-control-2.0.0.apk`，校验见同目录 `SHA256SUMS.txt`。

## 本质

卧床患者的三维引导想象场景呈现，与平板端远程 BLE/WebSocket 控制面解耦的 WebXR 训练系统。

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

- 会话：技术员启动页面、患者按一次确认后，先在**内置准备间**（空旷灰色房间）适应头显；技术员记录起始体位后，正式场景列表才在平板上解锁——先选卡，再按 `进入正式场景`，页面在已记录的校准下换内容。此后场景仍可热切换（校准帧、视角与漂浮不中断）。
- 漂浮：世界沿患者视觉竖直缓慢起伏（档位 a 55 mm / 16 s、b 75 mm / 13 s、c 100 mm / 9 s），**只平移不旋转**，地平线永不倾斜；近场微粒同相位上飘，强度 0–3；停止按 tau 0.25 s 渐出，1.2 s 内收住。
- 朝向记录：保持不动 1.8 s + 3 s 取样取平均（9 s 强制落地）；卡片期间世界完全静止。校准只取头部朝向与实测体位，**不要求患者看向任何方向**；世界静止的修正量由场景声明（`viewer`）：洁净立便间第一帧就是站立视角，仰卧场景从真实天花板开始、再由一次排定的起身转到站立视角。
- 入口：患者只需在头显上按一次（WebXR 强制的用户手势）。壳层监督这一次入口：页面 25 s 未上线或上线后 20 s 未进入会话，就带新地址重拉一次（最多 2 次），入口页同时显示"请看向画面中央，再按一下按钮"（`docs/control-plane.md` §6.1）。
- 场景：三个正式场景，由技术员在标定后选择（会话中也能换，见上）；另有内置准备间 `prep`，不作为场景卡出现，但同样有可用的患者视野镜像。`washroom` 洁净立便间（默认）：2.4 × 2.4 × 2.55 m 单间、立便器、木隔屏、天光；`shore` 仰望湖面：天穹、一层漂移云、水面与日光、4 m 内木桩与芦苇；`ward` 病房：床、被面、百叶窗与床旁监护仪。均无人物、无标牌。每个场景声明 `posture`（站立眼高、身下支撑、`viewer`），画面据此放置（见 `docs/animation.md`）。
- 双 APK 通信：头显前台服务广播 BLE 外设，平板自动扫描连接、`HELLO 2` / `WELCOME 2` 握手与 5 s PING 存活检测；state 为 28 字节 v14，另有独立的 `sus` 特征回传量表答卷。
- 音频：训练语音从面板手动播放，SUS 与结束语归问卷应用，不在训练语音里出现；播放时环境声自动压低 12 dB。环境声**默认关闭**，由平板开启；播放器双路交叉淡化 + 随机起点/速率（详见 `docs/core.md` §10）。
- 平板界面：顶栏应用选择器（训练 / 问卷，会话中锁定）、`i` 打开当前应用的说明书；
  训练侧有会话/场景/流程/语音/量表，问卷侧是独立的作答与归档面。问卷题目由页面
  `src/questionnaire/registry.ts` 单一来源下发，记录带完成时间，可按问卷与时间筛选后导出；
  训练记录与问卷记录写同一份本机文件，用 `app` 字段区分。
- 未完成：0.9.31 的实机验证（帧/s、SUS 目视作答）；端上自更新；PICO G2 4K 的 OpenXR 原生迁移（经评估无法支持）。

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
- [docs/animation.md](docs/animation.md) — 漂浮/起身/俯仰修正的分层、帧规则与验收
- [docs/scenes.md](docs/scenes.md) — 三场景的代码边界、画面/运动、用途与选择规则
- [docs/control-plane.md](docs/control-plane.md) — BLE 与 WebSocket 控制面通信契约
- [docs/protocol-conformance.md](docs/protocol-conformance.md) — 两侧实现（头显 / 页面）的命令语法与状态字段对照
- [docs/state-management.md](docs/state-management.md) — 双端状态容器核验：所有权、瞬时事件、是否引入状态库
- [docs/rotation-contract.md](docs/rotation-contract.md) — 姿态角度契约与 state 编解码
- [docs/state-v11.md](docs/state-v11.md) — state 帧的字段定义与协议推演（当前实现见 `ControlProtocol.encodeState`，v12 40 字节）
- [docs/pico-g2.md](docs/pico-g2.md) — PICO G2 4K 硬件能力与踩坑记录
- [docs/v2-architecture.md](docs/v2-architecture.md) — v2 代码架构：先删后加的四项结构性欠账与它们的顺序
- [docs/v2-roadmap.md](docs/v2-roadmap.md) — v2 路线：场景流程加长（阶段时间线）、场景质量、会话中切换的依赖顺序
- [docs/scene-switch.md](docs/scene-switch.md) — 会话中切换场景：现状（已能跑）与重设计要定的事
- [docs/handoff-next.md](docs/handoff-next.md) — **新开会话从这里开始**：goal 原文、已定决策、最新需求与代码现状
- [docs/releases.md](docs/releases.md) — 发布归档：v1.0.0 是旧界面的收尾（含校验值），界面重做后进入 v2.0
- [docs/ux-tree.md](docs/ux-tree.md) — UX 树：会话状态机、触发权限表、四个面的层级与组件清单
- [docs/ui-acceptance.md](docs/ui-acceptance.md) — 界面验收：五个面的判据与复现命令（`scripts/tablet-shots.sh`）
- [docs/ui-system.md](docs/ui-system.md) — 界面系统：变体卡、固定规则、三个表面的层级与字号（分支 `feat/ui-system`）
- [docs/ux-plan.md](docs/ux-plan.md) — UX/UI 现状评估、运动编排与四带控制台计划
- [docs/introduction.md](docs/introduction.md) — 系统名、口号与三档总介绍（起草版）
- [docs/copy-deck.md](docs/copy-deck.md) — 患者侧/技术员侧文案对照与术语决定
- [docs/manual.md](docs/manual.md) — 操作手册：床边流程、观察要点、故障处置（交付物）
- [docs/guide.qmd](docs/guide.qmd) / [docs/quiet-shore-guide.pdf](docs/quiet-shore-guide.pdf) — 使用说明 PDF：目的、上机流程、SUS、故障（交付物）
- [docs/voice-script.md](docs/voice-script.md) — 引导语音脚本（27 句）、控制端触发与 TTS 生成规范
- [TODO.md](TODO.md) — 迭代演进与重构路线
