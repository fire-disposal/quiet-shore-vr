# 蓝牙协议 v3：把「应用面」提到协议里

状态：2026-11-13 设计稿，**未实现**。起因：`app:training|questionnaire` 这个应用层出现后，
现有协议（GATT 语法 2、帧 v14）把三个层级压进了一条扁平通道，几处已经不成立了。

## 1. 现在为什么不成立

| 症状 | 证据 |
| --- | --- |
| 命令面是一个扁平白名单，三个层级混在一起 | `ControlProtocol.kt:115`：`enter/exit/stop`（壳层）、`scene:/float:/posture:/view:`（页面核心）、`sus:*`（问卷面）并列 |
| 应用面没有权限边界 | 平板对问卷面也放行 `float:level:`；拦截只在页面 `refuse()` 里，即**已经被发出的命令**才被拒 |
| 二进制状态帧依赖 JSON 文档才可解 | 帧第 2 字节是 4-bit 场景索引（`ControlProtocol.kt:510`），index→id 由页面 `catalog` 文档决定；问卷面根本不产生场景，索引无意义 |
| 「当前状态」有两个来源 | `session/calibrating/audio/moving/hold/voiceAuto` 在帧 flags 里；`adaptationDone`/`rampMs`/`app`/`scene` 在 flags JSON 里；两套陈旧判定（`stateStale` 与 `flags` 心跳各自为政） |
| flags 位已用尽 | 6/8 位已占用（`ControlProtocol.kt:502-508`），每加一个布尔就要么走私 JSON、要么升帧 |
| JSON 通道没有信封 | `sus`/`catalog`/`session`/`segment`/`log`/`questionnaire`/`flags`/`notice` 八个并列 topic，无 id、无 ack、无 TTL；`session`/`log` 发出即忘，断链即丢 |
| 协商只覆盖三分之一 | `HELLO 2`/`WELCOME 2` 只协商 GATT 语法，不协商帧版本，也不协商文档 schema |

结论：应用层加进来以后，**「谁在跑哪个应用、它能命令什么、它的记录归谁」这三件事在协议里都没有位置。**

## 2. 设计目标

1. 应用面是协议的一等公民：每个面自己声明命令集与文档集。
2. 一条不变式：**平板渲染什么，协议就允许什么**。前端不再发送会被后端拒绝的命令。
3. 离线优先不退化：不依赖网络，重连后未确认的记录必须还在。
4. 状态只有一处真相：连续量在帧里，离散量在文档里，且**帧自己带版本与相位**。
5. 帧不再需要 JSON 才能解码。

## 3. 分层

```
L0 GATT      5 个特征：cmd / status / telemetry / state / doc
L1 Doc       JSON 信封：{v,id,topic,ack,ttl,d}，单表重组 + 保留区 + ACK
L2 Frame     二进制状态帧 v15（32 B）：只放连续量与相位，不放 id 索引
L3 Semantics 命令命名空间 sys.* / core.* / app.<app>.*
```

### 3.1 握手：一次协商三件事

```
平板 → HELLO 3
头显 → WELCOME 3 <frameVersion> <capMask> <appsJson>
```

`appsJson` 是**应用清单**，每个面自报：

```json
[
  {"id":"training","since":3,
   "cmds":["core.scene","core.float","core.posture","core.view","core.audio","app.training.outcome"],
   "docs":["state.delta","state.full","session.recorded","log.event","notice"]},
  {"id":"questionnaire","since":3,
   "cmds":["app.questionnaire.sus.open","app.questionnaire.sus.show"],
   "docs":["questionnaire.catalog","sheet.recorded","log.event","notice"]}
]
```

平板只渲染 `cmds` 里有的键；`app` 不在清单里时，顶栏选择器不显示它。
这样 `sus:*` 永远不会在训练面被发出——拦截从"事后拒绝"变成"前端不存在"。

### 3.2 命令语法

```
<seq> <namespace>.<verb>[:<args>]        seq 由平板分配，与现在一致
```

| 命名空间 | 例 | 谁执行 |
| --- | --- | --- |
| `sys.` | `sys.enter` `sys.exit` `sys.stop` | 头显前台服务 |
| `core.` | `core.scene:shore` `core.float:2` `core.posture.rise` `core.anim:8000` | 页面（与面无关） |
| `app.<id>.` | `app.questionnaire.sus.open` `app.training.outcome:attempt:yes` | 页面，且仅当该面在前台 |

规则：
- `core.*` 在任何面都合法，因为它是「这个世界」的控制，不是某个面的功能。
- `app.<id>.*` 只在该面为当前面时合法；否则 `REJECTED APP_NOT_FOREGROUND`。
- 未在 `WELCOME.appsJson` 中声明的动词，整条拒绝，不猜。

### 3.3 文档信封

```json
{"v":1,"id":4119,"topic":"session.recorded","ack":true,"ttl":3,"d":{...}}
```

- `id`：头显侧分配、单调递增，重连时按 `since=<lastAck>` 重放未确认文档（复用现有 `ControlLog` 的保留区语义）。
- `topic` 用点号分段，与命令对称：`session.recorded`、`sheet.recorded`、`log.event`、`state.delta`、`state.full`、`catalog.scenes`、`catalog.questionnaires`、`notice`。
- `ack`：记录类一律 true；遥测类（`state.*`）false，不进保留区。
- `ttl`：保留 3 次重连后丢弃，避免一条坏文档堵住队列。

**替换的两个病**：
- `flags` 每秒重发整份 → 拆成 `state.delta`（只发变更字段）与 `state.full`（1 s 心跳）。
- `session`/`log` 发出即忘 → 进保留区，平板 ACK 后回收。

### 3.4 帧 v15（32 B）

| 字节 | 字段 | 变化 |
| --- | --- | --- |
| 0 | version = 15 | |
| 1 | phase 3b │ floatLevel 2b │ viewAnim 3b | 新增显式相位：idle/adapting/calibrating/running/stopping |
| 2 | **appIndex 2b** │ flags 6b | 应用面进入帧；场景索引移到文档 |
| 3 | 应用眼高 cm | |
| 4 | mix 0..250 | |
| 5 | 浮沉 mm（有符号） | |
| 6 | 视线 pitch | |
| 7 | 视线 yaw ×2 | |
| 8 | 语音 id | |
| 9 | 校准置信度 | |
| 10–11 | 已运行秒 | |
| 12–13 | rampMs/16 | 体位时长回读进帧，不再走 flags |
| 14–15 | docSeq 高水位（u16） | 平板据此判断文档是否漏收 |
| 16–17 | seq | |
| 18–23 | world 四元数 xyz | |
| 24–29 | world 平移 xyz（cm） | |
| 30–31 | 保留 | 给下一个字段留 2 字节，够用两次 |

场景 id 不再进帧：`core.scene:<id>` 是命令，`state.delta{"scene":"shore"}` 是回读。
这解决了「index 需要 catalog 才能解」的耦合——帧自足。

## 4. 迁移

- 不兼容共存：帧长度与命令语法都变，整帧拒收 + `PROTOCOL_MISMATCH 3`；双端同版本已是既有要求。
- 顺序：协议模块 → 页面 `commands.ts` 解析与文档发送 → 头显转发 → 平板 VM/UI → 测试。
- 每一步都保持 `npm run verify` 与两个 APK 可构建；帧与语法各留一个「旧字段仍可解析」的过渡断言，直到平板切换完成。

## 5. 验收

1. `WELCOME` 里的 `appsJson` 与两端界面一一对应：训练面看不到任何 `sus` 键。
2. 断链 30 s 后重连，未 ACK 的 `session.recorded` 与 `log.event` 全部补齐，且不重复。
3. 帧可独立解码：把 `catalog` 文档整条丢弃，平板仍能显示相位、应用面与全部连续量。
4. 每条命令的命名空间与执行者一致，未声明的动词在两端都不可达。
5. `:protocol:test` 覆盖：命名空间解析、清单裁剪、文档保留与重放、v15 编解码边界。

## 6. 不做

- 不做多平板并发控制（仍是一平板一面接管）。
- 不做云端中转、不做账号。
- 不做命令的动态子集协商（清单即全集，重启才变）。
