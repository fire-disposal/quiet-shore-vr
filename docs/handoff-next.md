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

goal 进度：**第 1 项已完成**（`37b09bf`）；第 2 项进行中（见 §4）；第 3 项未开始。

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

---

## 3 最新需求与状态（靠后这几批）

| # | 需求 | 状态 |
| --- | --- | --- |
| 1 | 母目标与机制链固化 | ✅ `docs/business-goal.md` |
| 2 | 校准由技术员显式触发（患者按下后等待「记录起始体位」） | ✅ `18b1e34` |
| 3 | 台账记 `peakMix` / `peakUpGazeDeg` / 每段停留 + 床边自评（尝试/成功） | ✅ `37b09bf` |
| 4 | 题面文字重绘残留（画布缩小导致纹理残留） | ✅ `src/ui/spatial/text.ts` 只增不减 |
| 5 | 场景目录外置为单一来源（加场景 Kotlin 零改动） | 🚧 见 §4 |
| 6 | 会话按段编排（单段默认 = v1 行为）+「第 n/N 段 · 剩余时间」 | ⬜ 树 G / G2 |
| 7 | 应用层级：顶栏应用选择器（`i` 左边，电量左让位）、下拉切换、VR 同步 | ⬜ 树 H / H1–H3 |
| 8 | `i` 指向当前应用的说明书 | ⬜ 树 H / H2（`GuideScreen` 现为 598 行全局字面量，需按 app 取内容） |
| 9 | 问卷产品线：题目配置化加载、作答存储、控制侧按次查看（含时间）、按问卷与时间筛选导出 | ⬜ 树 H / H4；未动 |
| 10 | 更长流程、在控制下依次体验场景；FxR 窗口面向、减少手动点击 | ⬜ 与第 6 项同源；窗口朝向需真机 |

真机卡住的三项（本批无设备）：场景切换实机验证、控制台占高复核、`dispatchGesture`
落在 FxR 的 2D 面板。脚本已备：`scripts/device-regression.sh`。

---

## 4 代码现状与"在飞"的事

- 分支 `main`，最近提交：`14361dd`（docs/apps）、`37b09bf`（台账+自评）、`18b1e34`（显式校准）。
- **在飞（未完成）**：需求 5。已做：页面在链路建立时下发 `catalog`（`PortalLink.sendCatalog`，
  `App.handleLinkStatus` 里调用）→ 头显 `PortalService` 用 JSON 通道转发 `{"t":"catalog"}` →
  平板 `ControlViewModel.handleCatalog` 解出 `ControlUiState.scenes`；`SceneChooser` 已参数化
  `scenes: List<SceneCatalog.Scene> = SceneCatalog.ALL`。**未做：`ControlScreen.kt:641` 的
  `SceneChooser(...)` 还没传 `scenes = state.scenes`**；`PortalActivity` 的入口卡仍是硬编码两份文案。
- 校验现状：`tsc` 干净；TS 测试 236 项通过；`:protocol:test` 与 `:control:testDebugUnitTest` 通过。

### 本轮次的验证命令

```bash
cd /home/firedisposal/dev/quiet-shore-vr
npm run check && npm test                      # 236 项
./android/gradlew -p android --offline :control:assembleDebug
(cd android && ./gradlew --offline :protocol:test :control:testDebugUnitTest)
# 模拟器（唯一可用设备）
adb -s emulator-5554 install -r android/control/build/outputs/apk/debug/control-debug.apk
adb -s emulator-5554 shell am force-stop com.quietshore.control
adb -s emulator-5554 shell am start -W -n com.quietshore.control/.MainActivity \
  --es preview idle|entry|calibrating|running|stopping [--ez elapsed true] [--ei battery 12]
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

1. 收口需求 5（一处调用点 + 一轮构建/测试），让"加场景只改一处"成立；
2. H1 + H2：应用选择器与 `i` 指向当前应用说明书（问卷的入口依赖它们）；
3. 需求 6：分段编排（与母目标最相关：渐进适应比场景数量重要）；
4. H4：问卷产品线（工作量最大，不阻塞训练主线）。
