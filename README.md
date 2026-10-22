# 静岸 · Quiet Shore VR

面向引导想象训练的 WebXR 应用：患者戴 PICO G2 4K 进入三维场景，操作员用 Android 平板控制场景、声音、校准与虚拟起身。仓库有两个 APK，必须同版本升级。

| APK | 包名 | 角色 |
| --- | --- | --- |
| 静岸（头显端） | `com.quietshore.portal` | 控制台 + 前台服务 + BLE 外设 + 本机回环桥 |
| 静岸控制台（平板端） | `com.quietshore.control` | Compose 控制台 + BLE 中心 + WebView 三维镜像 |

当前版本：**v0.8.11**（未发布；state v8 / 视角偏航 / 病房卫生间）。项目站：<https://qs.205716.xyz>。下一步重点见根目录 [`TODO.md`](TODO.md)，文档索引见 [`docs/README.md`](docs/README.md)。

## 当前流程

1. 头显开机进入 `PortalActivity` 控制台；`PortalService` 绑定 `127.0.0.1:8130` 并广播 BLE 外设 `QuietShore`。
2. 控制台点“进入训练”拉起 Firefox Reality，打开本地页面；业务参数通过 `window.__QS_BOOTSTRAP__` 注入。
3. 患者按头显右侧确认键进入 WebXR；平板通过 BLE `CLAIM` 获得唯一控制权。
4. 会话开始即进入一步校准（看向正前方、保持静止）；成功后从仰卧起点开始，患者短按确认键起身，平板“视角”页签可做同样操作。
5. 平板命令经 BLE → `PortalService` → 本机 WebSocket → 患者页面；页面用同一 WS 回传状态与遥测。
6. 平板断开、心跳超时或患者停止都会释放控制权并停止虚拟起身；视角俯仰/偏航目标按契约保持，不回正。

## 控制面

- **BLE GATT**：命令、状态、20 字节遥测、20 字节二进制 state v8（第 4/5 字节是相对校准帧测得的世界俯仰/横滚，第 8 字节 `viewPitch`，第 9 字节 `viewAnim` 相位，第 12 字节 `viewPreset` 预设 id，第 13–14 字节 `viewYaw` int16 偏航）。
- **协议握手**：平板在 `CONTROL_OK` 后发 `HELLO 1`，头显回 `WELCOME 1 <caps>`；版本/能力不匹配时平板拒绝驱动并给出具体原因。
- **第一台接管**：首个 `CLAIM` 胜出；没有 PIN/配对/应用层认证，邻近即可申请控制。
- **重连**：平板扫描到第一台广播 `QuietShore` 的头显就自动连接，没有设备列表或配对卡；冷启动直接连上次地址。链路中断按 0.8/1.6/3.2 s 退避重连 3 次，期间显示“重连中”，失败后回到配对页；`CONTROL_BUSY` 不重试。头显在断开、广告失败或蓝牙重新打开后自动恢复广播。
- **存活检测**：平板每 5 s `PING`，15 s 无 `PONG` 断开；头显 20 s 无控制者写入则释放控制权。
- **命令边界**：离散命令带 `#<seq>`，头显按 `ACK <seq> <OK|REJECTED|BUSY>` 回执并去重；`view:orient` 免序号、免回执、只保留最新样本。宿主命令 `enter/home/allapps/settings:*/scene:*` 由服务执行；其余进入页面 WS 队列。
- **页面链路**：`/ws?since=<seq>` 是唯一页面通道；旧的 `/events` SSE、`/control` 轮询、`/state`、`/telemetry` POST 已删除。头显与平板必须同版本。
- 协议、命令和边界详见 [`docs/control-plane.md`](docs/control-plane.md)。

## 患者端能力

- 简化入口：已选场景 + 单个“看向我”目标 + 按键线框引导。
- 一步校准：患者保持日常舒适姿势看向正前方、静止约 1.2 s，当前朝向即成为中立（站立）参考系；场景随之直立。没有第二步、没有 pivot 重映射；眼高 1.2–1.9 m。校准成功后从仰卧基准开始，由短按确认键起身。
- 虚拟起身/回躺：6 s 的旋转为主轨迹（站立眼高 1.70 m，旋转段峰值 ≈40 °/s），粒子流补失重感；头显确认键只有一个作用——已校准且会话中短按切换起身/回躺，其余情况不响应；平板“视角”页签的“缓慢起身 / 回躺 / 停止并保持”与患者按键等价。
- 注视选择：场景目标 6 s 停留即选中（暗色底环 + 亮色进度弧、`保持注视 6 秒以选择` 提示）。头显内没有 WebXR 菜单：重新校准、声音、结束训练都由平板操作。
- 场景：`landscape` / `ward` / `bathroom`，以及站立参照场景 `lab`（直立光室 / Upright Light Chamber）——地面网格与雾、垂直光柱与顶晕、缓慢上升的远近尘埃、3 个可注视碑体，用来在卧姿下读出直立参照。
- 近场粒子层（`PostureCue`）默认开启并覆盖所有场景；`flow` 只在起身过渡真实移动时为 +1，停止、回躺、校准、断链都冻结粒子并淡出。
- 设置页内置标准 SUS 量表，10 题分页，支持头显顶栏/页内与控制端翻页。
- 视角：系统级视角运动。平板“视角”页签两条滑动条——偏航 ±180°、俯仰 ±90°，均 1° 步进——加“上仰/下俯/回正/呼吸”四个固定预设（回正同时把偏航归零）与 `停止（保持）`；曲线与时长都在页面，只改世界朝向，不碰相机。
- 角度呈现：平板 yaw/pitch 仪表、姿态进度 / 起身高度 / 姿态俯仰、姿态新鲜度与患者/全局视角。
- 平板布局：浮动的浅色顶栏（操作始终压在视口上方可读）、左下角患者/全局切换与全屏入口（其上方是只读角度仪表）、宽屏常驻控制栏（窄屏收成抽屉）、重连/录制提示条；全屏内仍可切换视角、退出或停止录制。
- 患者视角录像：平板直接录制 WebView 的三维画布（优先 MP4，回退 WebM），不含操作层；文件落在 `Movies/recordings`，可经系统分享。录制不依赖蓝牙链路，用于产品展示。
- XR 默认 1.25× framebuffer 超采样；`?scale=` 可覆盖。

## 构建与验证

需要 Node 20+、JDK 17+、Android SDK 36。

```bash
npm ci
npm run check
npm test
npm run build
npm run standalone
cd android && ./gradlew :protocol:test :headset:assembleDebug :control:assembleDebug
```

实机侧仍需验证：Firefox Reality 会话、真实 GATT state/心跳、平板视角滑动条、6 s 注视选择、一步校准、起身/回躺轨迹与停止、站立光室构图、平板扫描自动连接与控制布局、通知/磁贴、PICO 安装确认页。

## 开机与桌面

- `PortalActivity` 同时提供 `LAUNCHER` 与 `HOME` 候选。
- 本受控设备已通过 ADB 设为默认 HOME；另一套系统保留，可切回。
- `BootReceiver` 恢复服务并在开机/更新后延迟打开控制台。
- APK 本身不会静默改写默认 HOME；切换命令见 [`docs/home-switch.md`](docs/home-switch.md)。

## 已知限制

- PICO G2 4K 是 3DoF：遥测位置基本固定，平板镜像只是近似姿态；因此校准只取一帧朝向，“向前看”即站立参考系，旧的两姿态（天花板/脚尖）采集与 pivot 重映射留在代码里但患者流程不再使用。
- 虚拟起身是纯视觉偏移：世界绕校准采集点旋转，患者本体不动；因此“起身高度”是呈现量，不是真实位移。
- WebXR 只支持 Firefox Reality 10；首次使用/无网络时 Firefox 自己可能显示离线或登录引导，网页无法关闭。
- 回环 HTTP 与 BLE 都没有应用层认证，只适合一台头显 + 一台平板的受控环境；扫描不提供设备列表，总是连接第一台广播 `QuietShore` 的头显。
- 录像只有画面、没有声音；容器取决于 WebView 编码器（优先 MP4，否则 WebM）。页面重载或渲染进程退出会丢弃未完成的录像。
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
src/app            患者状态机、WebSocket 链路、遥测
src/core           XR、comfort、spatial、性能
src/scenes         landscape / ward / bathroom / lab
src/ui             入口、校准、HUD、注视准星、字符串
tests              vitest
docs               架构、设备、分发、方案与评审
```
