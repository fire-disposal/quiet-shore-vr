# UI 下一阶段交接（给新接手的代理）

写于 2026-11-12。目的：换一个没有前几十轮对话包袱的执行者，让它只凭这一页 + 仓库文档就能
把剩下的界面工作做对。**先读 `skill://endfield-ui`，再读本页。**

## 1. 产品与使用现场

静岸（Quiet Shore VR）：卧床患者戴 PICO G2 4K 头显看场景，床边的技术员拿 10" 平板控制。
平板是白天、手持、单手、可能要看病人而不是看屏幕；界面因此是**操作台**，不是网页、不是阅读页。

设备本批次**不可用**（用户回家了），一切验收在 Android 模拟器上做。

## 2. 设计规则（产品决定 > skill 默认值）

`skill://endfield-ui` 的固定规则必须遵守：单一强调色只做填充、切角=可按、细线分区、
不用圆角/阴影/渐变、编号与计数用真实数据、短硬机械动效、英文眉标宽体大写 + 中文黑体。

本产品已定的偏离与决定：

| 决定 | 内容 |
| --- | --- |
| 浅色 | 只有浅色。纸色底 + 墨色字，深色命令栏不做 |
| 形状语义 | **实心 = 可按**（每屏至多一个主行动），**描边/冰色左条 = 当前状态** |
| 文字 | 不用分割点 `·`；并列用顿号、主从用冒号；不写"系统会自动…"这类废话；空态只有"对象未状态 + 一行原因" |
| 术语 | `docs/copy-deck.md` §7/§8 为准：会话、启动训练、接管、校准、体位、视高、朝向、语音提示、连续播放、打开量表；不出现 BLE/链路/混音/序列/控制权/记录体位 |
| 急停 | **已废弃**（2026-11-12）。界面上不再有急停；停止会话用 `结束`，设备脱手用 `断开连接`。协议里的 `stop` 命令保留——它是结束/断链/丢控制权的共用路径 |
| 会话中切场景 | **已开放**。点选即换，无确认弹窗；校准中与结束淡出中不可点 |
| 电量 | 唯一颜色例外：色带用绿 >40% / 黄 20–40% / 红 ≤20%（设备电量的传统语义），**不共用界面色板**；文字一律墨色。状态标签 `[充电中]` 优先于 `[低电量]`，互斥 |
| 顶栏 | 永远同一几何：蓝信号条 + `[状态] 设备号` ｜ 两条电量条（文字在条内）｜ `i` ｜ `断开连接` |

## 3. 代码现状

- 仓库 `fire-disposal/quiet-shore-vr`，worktree `/home/firedisposal/dev/quiet-shore-vr-ui`，分支 `feat/ui-system`。
- 当前 base：合并 main 后的最新提交（含浅色版式、四页底部导航、电量条、VR 断链 5 秒退出）。
- 平板 UI 全在 `android/control/src/main/kotlin/com/quietshore/control/ui/`；共享块在 `ui/components/`（`MirrorSlot`、`SessionReadout`、`PostureGauges`、`StepLine`、`DurationRow`、`VoiceSummaryRow`）。
- 页面（VR 网页）在 `src/`，入口页 `src/index.html` + `src/styles.css`，空间 UI 字阶在 `src/core/spatial/theme.ts`。
- 协议与状态帧在 `android/protocol/`，**不要改**。

## 4. 下阶段任务（按优先级）

1. **主区域三态**：初始态（左 = `静岸控制台` + 一句连接说明；右 = 蓝牙扫描设备列表，设备名/信号/每台一个「连接」，**手动点连接**）／控制台／操作说明。
2. **删除底部导航栏**。语音与量表改为控制台内展开块（`全部语音`、`打开量表`），不是一级目的地。
3. **说明页复用统一顶栏**（去掉自己的 AppBar），点 `i` 在主区域显示，返回即回控制台。
4. **急停文案清理**：说明页故障表「按急停，再摘头显」→「点结束，再摘头显」；配对页安全句同理。
5. **断开不自动重连的日志验证**：代码已改（`lastAddress = null` + `manualClose = true`），要抓一次 logcat 证明断开后没被拉回。
6. **会话右栏 `体位` 行被钉住的 `校准`/`结束` 压掉一行**：把可长内容放滚动区（底部渐隐），钉住区不滚；`停止`/`下一句` 必须留在会话页。

## 5. 怎么做、怎么算完

```bash
cd /home/firedisposal/dev/quiet-shore-vr-ui
./android/gradlew -p android --offline :control:assembleDebug
adb -s emulator-5554 install -r android/control/build/outputs/apk/debug/control-debug.apk
adb -s emulator-5554 shell am force-stop com.quietshore.control
adb -s emulator-5554 shell am start -W -n com.quietshore.control/.MainActivity --es preview idle|entry|calibrating|running|stopping
adb -s emulator-5554 exec-out screencap -p > /tmp/ui2/<名>.png
```

- **必须真的用 `read` 看图**，不许只读代码就判过。每改一处结构就重拍，别攒着。
- 需要低电/充电样本：`adb shell dumpsys battery set level 12`（验完 `dumpsys battery reset`）。
- 主区域切换用 `adb shell input tap` 或 `uiautomator dump` 取坐标点，别只看静态截图。
- 窄屏：`wm size 1280x900 && wm density 240`，验完 `wm size reset && wm density reset`。
- 构建与 `tsc --noEmit` 都要绿；改 `src/` 时还要 `npm test`。
- 交卷：每状态一张截图 + 逐项说明四条规则（浅色/实心=可按/术语/无分割点）落在哪。
- 归属：`android/control/**` 与 `src/`（页面）；不碰 `android/headset/`、`android/protocol/`、`docs/`（除 `docs/ui-acceptance.md` 的记录行）。
- 工作中只有你会往 `emulator-5554` 装包；验收时由主代理统一装一次，不要互相覆盖。
