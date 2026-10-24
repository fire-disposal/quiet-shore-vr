# 双端状态管理核验：状态机、页面状态与"要不要引入库"

结论先说：**不引入新的状态库**。三端的问题都不是"缺一个库"，而是**同一份状态有多个所有者**、
**瞬时事件混进持久状态**、以及**一个类承担了太多职责**。这些用现有容器（reducer + `StateFlow`/`SharedFlow` + 模块拆分）
就能解决，换库只会把既有测试和协议契约一起重写一遍。

## 1 现状清单

| 端 | 容器 | 行数 | 状态形态 | 写入点 |
| --- | --- | --- | --- | --- |
| 页面 | `app/App.ts` | 1552 | 类字段 + 模块（`session` / `viewMotion` / `floating` / `worldRuntime` / `calibration`） | 40 处 `start.setStatus`，其余经模块 API |
| 页面 | `app/session.ts` | 103 | 纯 reducer，6 个相位 | 只经 `dispatch` |
| 页面 | `app/portal-link.ts` | 483 | 套接字 + seq/ack 队列 + 状态 JSON | 内部 |
| 平板 | `ControlViewModel` | 690 | `MutableStateFlow<ControlUiState>` | **43 处** `_uiState.update` |
| 平板 | `model/ControlUiState.kt` | 91 | 一个 data class，**35 个字段** | 见下 |
| 平板 | `ble/BleController` | 944 | 连接/租约/扫描状态机（枚举） | 内部 |
| 平板 | `ble/CommandQueue` | 73 | 三条车道（运动/离散/停止） | 内部 |
| 头显 | `PortalService` | 1415 | 服务字段 + `lastState` + 命令日志 | 大量 |
| 头显 | `BluetoothControl` | 941 | GATT 外设 + 控制者租约 | 内部 |

页面与平板的**协议侧**已经有金向量测试（`StateFrameTest`、`protocol-conformance.md`），
这部分不是状态管理的短板。

## 2 真正的三个问题

### 2.1 平板的 `ControlUiState` 混了三个所有者

| 所有者 | 字段 | 权威来源 |
| --- | --- | --- |
| 镜像（头显说了算） | `control`（整个 `ControlState`）、`sessionElapsedMs`、`voiceId` | state 帧 |
| 操作员意图（本机说了算） | `sessionMode`（会话前）、`breathEnabled`、`gazeDwell`、`animDurationMs`、`viewPitchTarget`、`susOpen/susIndex/susAnswers` | 本机 + 回执 |
| 瞬时事件 | `notice`、`error`、`startPending`、`scanAttempted`、`reconnectAttempt/Max`、`poseStale`、`stateStale` | 链路事件 |

具体冲突（有代码位置）：

- `floatLevel` **两边都写**：`setFloatLevel()` 本地乐观写入，`onControlState()` 又用镜像覆盖
  （`ControlViewModel.kt:233` 与 `:618`）。命令被页面拒绝时，面板会先亮后被改回，属于"两个真相"。
- `sessionMode` 有**条件权威**：会话中听头显、会话外听本机（`:609`）。规则写在一个 `if` 里，
  读代码的人不知道还有没有第三种情况。
- `breathEnabled` **没有回读位**：协议 flags 里没有呼吸位，所以命令丢了 UI 仍然显示"已开启"。
- `notice/error` 是字符串状态：一条新消息覆盖旧消息，界面没有"事件"的概念（`StatusPanel.kt:49`）。
  同一句提示出现两次时，Compose 认为状态没变，不会重绘。

### 2.2 页面的状态行是旁路写入

页面是一台明确的状态机（`session.ts`，6 相位，全测试覆盖），但**操作员可见的每一句话**走的是
`this.start.setStatus(...)`——40 个调用点，从命令处理、校准、模式切换里直接写 DOM。
它不是状态机的一部分，因此：

- 没有"这条消息属于哪个相位"的约束，停止后残留的提示只能靠下一条覆盖；
- 无法测试（DOM 写入）；也无法合并（同一帧里两次 setStatus 只有最后一条可见）。

### 2.3 `App` 与 `PortalService` 是"协调器+服务+路由"三合一

`App` 1552 行、`PortalService` 1415 行。前者已经被拆走了 `commands`（语法）、`floating`（漂浮）、
`world-runtime`（帧）、`calibration`（窗口）；后者还留着 WS 服务器、命令路由、状态编码、设置持久化、
启动活动。这是唯一值得继续"拆"的地方，但拆的是**职责**，不是引入框架。

## 3 库的取舍

| 候选 | 能解决什么 | 代价 | 结论 |
| --- | --- | --- | --- |
| XState（页面） | 把 `session.ts` 画成状态图、可视化 | +15–25 kB、异步 actor 模型、现有 6 相位测试全改；我们只有 6 个状态、无嵌套并发 | **不引入** |
| Redux Toolkit / Zustand / Valtio（页面） | 把 `App` 的字段搬到 store | 只是搬家；`App` 的问题是多职责，不是没 store | **不引入** |
| 自建 `StatusBus`（页面，<40 行） | 40 个 `setStatus` 收成一个发射点 + 一个订阅者 | 极小 | **建议做**（S） |
| Hilt / Koin（平板） | DI | 只有一个 VM + 两个协作者，服务定位器已经够用 | **不引入** |
| Orbit/MVIKotlin（平板） | 强制 intent→state 单向 | 会把 43 处直接 `update` 重写成 intent 集合，收益与风险不对称 | **不引入** |
| 拆分 `ControlUiState`（平板，纯类型） | 镜像/意图/事件三个容器 | 需要改 UI 读取处；无第三方依赖 | **建议做**（M） |
| `SharedFlow<UiEvent>`（平板） | `notice/error` 变成一次性事件 | 小；`StatusPanel` 改订阅 | **建议做**（S） |
| Room / DataStore（平板历史） | SUS 归档查询、导出 | 50 条以内的读写，SharedPreferences 足够 | 暂不 |
| kotlinx.serialization / protobuf（跨端） | 从一份 schema 生成两端编解码 | 28 字节手写帧是刻意的（MTU 约束），生成模型反而更重 | 暂不；保留金向量测试 |
| `sealed interface Command`（头显） | 命令路由从字符串 `when` 变成类型 | 需要迁移 `isAllowedCommand` 的白名单 | **建议做**（M），与页面 `commands.ts` 对齐 |

## 4 建议的目标形态

```text
平板
  BleGateway (BleController)  ──► RemoteFrame(ControlState)  镜像，只读
  CommandSender               ──► 意图（乐观写）            只写 Intent
  UiEvent (SharedFlow)        ◄── notice / error / toast    一次性
  ControlUiState = Remote ∪ Intent                          UI 只读这两块

页面
  session reducer (纯)  ← dispatch(SessionEvent)            仅状态
  view/floating/frame/calibration 模块（纯）                 各自的量
  StatusBus (单发射点)  → StartScreen                       操作员可见文案
```

三条所有权规则（可写成测试）：

1. **镜像字段不从本机写**；意图字段不被镜像覆盖，只被"收到回执"改写。
2. **瞬时事件不进状态**：进 `SharedFlow`，或带自增 id 的单槽。
3. **一个相位只允许一组命令**：在 `App` 的命令路由入口断言（已有 `viewCommandsAllowed` 等零散判断，
   收敛成一张表）。

## 5 优先级

| 顺序 | 改动 | 收益 | 风险 |
| --- | --- | --- | --- |
| 1 | 平板：`notice/error` → `SharedFlow<UiEvent>` | 提示不再"同句不重绘"，代码里少 24 处状态写入 | ✅ 0.9.39 |
| 2 | 平板：把合并规则抽成 `mergeRemoteFrame()` + 单测 | `floatLevel` / `sessionMode` 的双写变成一条有名字、有测试的契约 | ✅ 0.9.39（字段还没拆成两个容器） |
| 3 | 页面：`StatusBus` | — | **撤回**：`start.setStatus` 已经是唯一写入者，再加一层只是改名，不是修问题 |
| 4 | 头显：`sealed Command` + `CommandRouter` | 与页面 `commands.ts` 同一套形状 | 待做（需实机回归，风险最高） |
| — | XState / Redux / Hilt / Room | — | **不做** |

已落地部分的形状：

```kotlin
// 平板
val uiEvents: SharedFlow<UiEvent>          // Notice / Error，一次性，不进状态
mergeRemoteFrame(current, frame, sessionStartedAt, nowMs)  // 所有权契约，6 例单测
```

`ControlUiState` 目前仍是一个 data class；合并规则已经从 `onControlState` 里那 30 行 `copy(...)`
搬进 `model/RemoteMerge.kt`，因此"镜像不得覆盖意图"现在可以被断言。把它彻底拆成 `Remote`/`Intent`
两个容器仍列在 `TODO.md`（M 级，只影响 UI 读取处）。

## 6 现状缺口

- `breathEnabled` 没有回读位（协议 flags 已满 8 位）。若要闭环，只能在下一个协议版本把某个保留位给它；
  在此之前 UI 应标注"本机设置"。
- 页面的 `start.setStatus` 文案与 `docs/copy-deck.md` 没有机器校验，只有人工对照。
- 平板没有针对"镜像不得覆盖意图"的测试；这是本轮建议里唯一值得先补的测试形态。
