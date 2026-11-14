# quiet-shore-vr（静岸 Quiet Shore VR）

卧床男性患者的床边三维引导想象：躺着戴上头显，看到近似站立时的卫生间视野，配合环境声与引导语音。技术员在平板上控制场景、体位、强度与语音。产品假设，不做疗效宣称，不替代护理评估。

## 组成

- 患者端页面：Three.js + WebXR，运行在头显内置 Firefox Reality 10 里；由头显 APK 的 `assets/index.html` 提供。
- 头显服务 `com.quietshore.portal`：BLE GATT 外设、本地回环 `127.0.0.1:8130`、拉起并监督 Firefox Reality。
- 平板端 `com.quietshore.control`：Jetpack Compose，BLE 中心，经 `ControlProtocol` 与头显通信。

唯一控制链路：平板 BLE 中心 → 头显 BLE 外设 → 头显回环 WebSocket `/ws` → 页面。平板不直连 HTTP。

## 运行

```bash
npm ci
npm run check        # tsc 类型检查
npm test             # vitest
npm run build        # 输出 dist/（含 catalog.json、voice/）
npm run standalone   # 单文件离线页
npm run android      # 构建配对的两个 APK
```

真机调试：`adb reverse tcp:8130 tcp:8130`，在头显内打开 `http://localhost:8130`。

前置：Node 20+、JDK 17+、Android SDK 36。设备为 PICO G2 4K（Android 8.1 / Snapdragon 835），仅 3DoF。

## 目录

| 路径 | 内容 |
| --- | --- |
| `src/app` | 会话生命周期、命令执行、世界与渲染 |
| `src/core` | 场景契约、解剖与眼高、校准、XR 设置 |
| `src/scenes` | `washroom` / `shore` / `ward` 三个正式场景，加 `prep`、`survey` 两个内置房间 |
| `src/audio` `src/mirror` `src/ui` `src/questionnaire` | 环境声与语音、患者视角镜像、界面、问卷题库 |
| `android/protocol` | 双端共用的 QS2 契约（`ControlProtocol`） |
| `android/headset` `android/control` | 头显服务、平板应用 |
| `scripts` `tests` `site` `docs` | 工具脚本、单测、落地页、文档 |

## 会话

技术员启动，患者按一次头显按钮进入 WebXR，落在内置准备间 `prep`（无陈设、无声音、无运动）。患者适应 60 秒窗口，技术员记录起始体位后正式场景解锁。此后由技术员手动选场景、调体位与强度、说停就停。没有分段、没有自动推进、没有计划时长。

会话中可热切换场景（`scene:<id>`），校准帧与视线偏移保留。场景只有三个：`washroom` 洁净立便间（默认）、`shore` 仰望湖面、`ward` 病房，外加问卷面自己的空房间 `survey` 与准备间 `prep`，后两者不作为场景卡出现。

## 关键边界

- 姿态：PICO G2 4K 只有 3DoF，无位置位移。漂浮与起身都是纯视觉偏移，画面只平移，地平线永不倾斜。
- 浏览器：WebXR 仅在内置 Firefox Reality 10 可用，系统 Chromium 67 无法创建会话。
- 认证：回环 HTTP 与 BLE 均无应用层密码，设计为受控环境下一台头显对一台平板。
- 协议：`QS2` generation，state schema `1`，28 字节，不向后兼容；没有 QS1 旧客户端，也没有已部署的旧包。头显与平板必须同批升级。
- 记录：训练会话、问卷答卷与行为事件写同一份本机 JSON，系统分享导出，默认不上传，不做 OTA。
- 签名：当前 APK 为 debug 签名，生产化前需建持久化 Release Keystore。

## 文档

- [docs/core.md](docs/core.md) — 范围、场景接口、功能与验收（权威口径）
- [docs/protocol.md](docs/protocol.md) — QS2 协议：GATT、命令、state 帧、JSON 通道、入口监督
- [docs/session-flow.md](docs/session-flow.md) — 一次会话从准备间到场景再到问卷的流程
- [docs/scenes.md](docs/scenes.md) — 三场景的边界、画面、用途与选择规则
- [docs/animation.md](docs/animation.md) — 漂浮、起身、俯仰修正的分层与帧规则
- [docs/README.md](docs/README.md) — 全部文档分类入口
- [TODO.md](TODO.md) — 唯一待办与排期
