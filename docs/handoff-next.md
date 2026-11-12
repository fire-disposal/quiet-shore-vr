# 新开会话从这里开始（交接）

写于 2026-11-12。目的：把**目标、已定决策、最新需求与代码现状**落成一份可独立阅读的文件，
让下一个人（或下一次会话）不必回读整段对话。**先读这一页，再读它指向的文档。**

---

## 1 当前 goal（原文，新会话可原样置入）

```
推进静岸 v2，保住业务母目标不动：通过俯仰角偏移引导患者想象站立，降低床上排尿的
心理障碍。本轮只做三件能验证成果的事，做完即验收：

1. 疗效可证（优先级最高）
   - 会话台账新增 peakMix、peakPitchDeg、每段停留时长；
   - 增加一条床边自评：本次是否尝试在床上排尿、是否成功，与台账关联；
   - 验收：单测覆盖台账字段与损坏数据容错；模拟器跑一场会话后能在台账里读出上述数值。

2. 场景可扩展
   - 场景目录与文案（id/名称/一句话定位/上限）从 android/protocol 外置为单一来源，
     页面经 JSON 通道下发，平板与头显都渲染收到的列表；
   - 验收：新增一个占位场景只需改一处数据源 + 一处页面装配，Kotlin 侧零改动；
     现有 234 项 TS 测试与协议测试全绿。

3. 流程可编排
   - 会话按段编排，默认单段（行为与 v1 等价）；平板常驻“第 n/N 段 · 剩余时间”，
     技术员可下一段/结束/重校准；校准由技术员显式触发（已实现，接入编排）；
   - 验收：模拟器上单段与三段会话各跑一次并截图；页面端能按段推进（无设备时用预览验证）。

约束：
- 协议可以换代（v14 起），但业务母目标与“校准基准 → 抬到站立 → 适应 → 可撤回”这条链不改；
- 不接非 3D 内容，不同构的技术栈不进本系统；
- 不碰 android/headset 与校准策略常量，除非写明理由并单独提交；
- 每步落一个提交，带验证证据；不能验证的部分如实标注“需真机”。
```

goal 进度：**第 1 项已完成**（`37b09bf`）；**第 2 项已完成**（场景目录单一来源、内置准备间、Kotlin 零改动的占位场景验证）；第 3 项未开始。本轮另按现场反馈砍掉光井、把起身时长并入操作区、重排会话页空间。

---

## 2 母目标与不可重开的决策

母目标（`docs/business-goal.md`）：**通过施加俯仰角偏移，引导患者想象站立，降低床上
排尿的心理障碍。** 机制链：校准给基准 → 视野抬到站立 → 在场景里适应 → 可随时撤回。

| 决策 | 内容 |
| --- | --- |
| 兼容 v1 的含义 | 只兼容**思想与业务母目标**；协议、说明书、流程都可以换代 |
| 内容形态 | **不接非 3D 内容**；其他主题都是同构 VR 场景。因此 `SceneHandle` 门禁保留，"接视频/问答"的抽象不做 |
| 界面 | 浅色终端风；固定顶栏 + 主区域；左侧竖直导航（会话/场景/语音/量表）；不用分割点 `·` |
| 形状语义 | 实心 = 可按；描边/冰色左条 = 当前状态 |
| 颜色 | 单一强调色冰蓝；红只给删除/结束；**电量条是唯一例外**（绿 >40% / 黄 20–40% / 红 ≤20%，文字不变色） |
| 急停 | **已废弃**；停止会话用 `结束`，设备脱手用 `断开连接`；协议 `stop` 命令保留（结束/断链共用） |
| 顶栏布局 | `[信号] 状态 设备号 │ 两条电量条 │ [当前应用 ▾] │ (i) │ [断开连接]` |
| `i` 的语义 | 打开**当前应用**的说明书；不设全局说明书入口（`docs/apps.md`） |
| 光井 | **已砍**（2026-11-12）；实现、注册表与文案删除，状态帧升到 v14 |
| 准备间 | **内置特殊场景**（`prep`，空灰房间）：进 VR 的第一站，**不出现在场景卡列表**；镜像正常工作 |
| 场景解锁 | 患者进入 XR 并完成标定后，正式场景卡才可点；点卡只标记，再按 `进入正式场景/切换场景` 才发命令 |
| 起身时长 | 从独立「02」块移入按「起身」的位置（场景页与会话操作区各一份），不再占独立段落 |
| 会话页空间 | 主区域给镜像；「训练中」大卡片删除，只留标题行的已运行时间与姿态读数 |

---

## 3 最新需求与状态（靠后这几批）

| # | 需求 | 状态 |
| --- | --- | --- |
| 1 | 母目标与机制链固化 | ✅ `docs/business-goal.md` |
| 2 | 校准由技术员显式触发（患者按下后等待「记录起始体位」） | ✅ `18b1e34` |
| 3 | 台账记 `peakMix` / `peakUpGazeDeg` / 每段停留 + 床边自评（尝试/成功） | ✅ `37b09bf` |
| 4 | 题面文字重绘残留（画布缩小导致纹理残留） | ✅ `src/ui/spatial/text.ts` 只增不减 |
| 5 | 场景目录外置为单一来源（加场景 Kotlin 零改动） | ✅ 页面 `catalogEntries` → `dist/catalog.json` → BLE JSON；平板/头显只渲染收到的目录 |
| 6 | 会话按段编排（单段默认 = v1 行为）+「第 n/N 段 · 剩余时间」 | ✅ 本轮：`program:` 命令 + 流程带 + 段台账 |
| 7 | 应用层级：顶栏应用选择器（`i` 左边，电量左让位）、下拉切换、VR 同步 | ⬜ 树 H / H1–H3 |
| 8 | `i` 指向当前应用的说明书 | ⬜ 树 H / H2（`GuideScreen` 现为 598 行全局字面量，需按 app 取内容） |
| 9 | 问卷产品线：题目配置化加载、作答存储、控制侧按次查看（含时间）、按问卷与时间筛选导出 | ⬜ 树 H / H4；未动 |
| 10 | 更长流程、在控制下依次体验场景；FxR 窗口面向、减少手动点击 | ⬜ 与第 6 项同源；窗口朝向需真机 |
| 11 | 内置准备间：空灰房间、镜像可用、患者先适应，标定后再进入正式场景 | ✅ 本轮；真机待验 |
| 12 | 场景选择两步化 + 标定后才解锁；校准随时可重做且不清零台账 | ✅ 本轮；模拟器截图 |
| 13 | 光井下架、起身时长并入操作区、会话页去掉「训练中」大卡 | ✅ 本轮 |

真机卡住的三项（本批无设备）：场景切换实机验证、控制台占高复核、`dispatchGesture`
落在 FxR 的 2D 面板。脚本已备：`scripts/device-regression.sh`。

---

## 4 代码现状与"在飞"的事

- 分支 `main`；本轮提交见 `git log`（目录单一来源 / 准备间与流程 / 光井下架与布局）。
- **场景目录**：`src/scenes/registry.ts` 是唯一来源 → `catalogEntries()` → `dist/catalog.json`
  （`build.mjs` 生成）与链路 JSON。头显 APK 由 Gradle 把 `catalog.json` 打进 assets；
  平板 `QuietShoreBleManager` 在解码前缓存目录顺序；`SceneCatalogDocument` 是两端唯一的解析器。
- **准备间**：`src/scenes/prep/index.ts`（`special: true`，注册表末尾，状态帧索引 3）；
  每次 `PortalActions.enter` 都把启动场景重置为 `prep`；平板 `selectableScenes` 过滤特殊场景。
- **两步切场景**：`ControlViewModel.selectScene` 只写 `sceneIntent`，`applyScene` 才发
  `scene:<id>`；`ControlUiState.selectableScenes` / `inSpecialScene` 决定解锁与文案。
- **校准**：`App.dispatch` 只在第一次 `calibrating → running` 时开表；会话中重校准不清零。
- **段编排**：平板 `ProgramState`（空 = 单段）→ `program:<auto>:...` 一条 BLE 命令；
  页面 `startProgram/applyProgramSegment/tickProgram` 按墙钟推进，`program:next` 手动；
  段进度经 JSON `segment` 回传，平板流程带显示第 n/N 段与剩余；台账段带 index/planned/峰值。
- **镜像**：`prep` 的四面墙命名为 `prep-walls`，镜像全景会切开；镜像页本身在
  `dist/mirror.html`，平板通过 `MirrorView` 注入状态。
- **布局**：会话页删除 `MonitorPanel`（原「训练中」大卡），已运行时间移到镜像标题行；
  会话页左列不再滚动，镜像用 `weight(1f)` 吃掉剩余高度；起身时长在场景页和会话操作区
  都紧邻「起身」。
- 校验现状：`tsc` 干净；TS 244 项通过（新增 program 4 例、台账 1 例）；
  `:protocol:test`、`:control:testDebugUnitTest`（含 `ProgramCodecTest`）、
  `:control:assembleDebug`、`:headset:assembleDebug` 全绿。
  页面预览实测：2 秒×2 段自动推进、手动 `下一段`、台账写出两段（index/planned/峰值）。

### 本轮次的验证命令

```bash
cd /home/firedisposal/dev/quiet-shore-vr
npm run verify                                 # 239 项 + tsc + build + standalone
(cd android && ./gradlew --offline :protocol:test :control:testDebugUnitTest \
  :control:assembleDebug :headset:assembleDebug)
# 模拟器（唯一可用设备）
adb -s emulator-5554 install -r android/control/build/outputs/apk/debug/control-debug.apk
adb -s emulator-5554 shell am force-stop com.quietshore.control
adb -s emulator-5554 shell am start -W -n com.quietshore.control/.MainActivity \
  --es preview idle|entry|calibrating|running|stopping [--ez pose true] [--ez mirror true] \
  [--es current prep] [--es catalog '<json>'] [--es tapped washroom]
adb -s emulator-5554 exec-out screencap -p > /tmp/out.png
```

---

## 5 文档地图（谁说什么）

| 文件 | 内容 |
| --- | --- |
| `docs/business-goal.md` | 母目标、机制链、v2 约束 |
| `docs/apps.md` | 应用层级、顶栏依赖、`i` 的归属、同步方式 |
| `docs/session-flow.md` | 会话=段编排、校准显式化、头显入口收敛 |
| `docs/scene-switch.md` | 会话中切场景：已开放；过渡与朝向是已知缺陷 |
| `docs/v2-architecture.md` | v2 代码架构欠账（含"不要动"清单） |
| `docs/v2-roadmap.md` | 场景流程加长与场景质量 |
| `docs/ui-acceptance.md` | 五个面的验收判据（含电量/形状/文案规则） |
| `docs/copy-deck.md` | 术语、句式、空态规则（§7 控制端词、§8 空态与提示） |
| `docs/releases.md` | v1.0.0 归档与 v2.0.0 产物 |
| `todotree.md` | 里程碑树 A–H，**排期与验收的唯一入口** |

---

## 6 建议的下一步顺序

1. H1–H3：应用选择器、`i` 指向当前应用说明书、VR 侧 app id 同步；语音按应用拆分；
2. H4：问卷产品线（题目单一来源、VR 作答、平板按次查看与筛选导出）；
3. 准备间/段编排实机验证：切换是否保留校准帧、镜像在空房间里的构图、窗口朝向。
