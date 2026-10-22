# KISS 审查（v0.8.3 基线）

目标不是“代码少”，而是**每条协议只有一个解释、每个失败只有一个结果、每个高频路径不产生隐藏状态**。

## 现在做得好的地方

- 协议只有一个来源：`android/protocol/.../ControlProtocol.kt`，头显和平板共用命令、限制与编解码。
- 控制权只有一个事实源：BLE `BluetoothControl.controller`；首个 `CLAIM` 胜出，断链释放。
- 页面命令只有一条主通道：BLE → `PortalService` → `/ws` WebSocket → 患者页面；没有 SSE/轮询回退。
- 高频运动有明确边界：`view:orient` 10 Hz、无 TTL、俯仰 ±90° / 偏航 ±180°、15 与 30 °/s 速率上限；页面旋转世界而不是 XR 相机。
- 离散命令带 `#<seq>` 与 `ACK`，`view:orient` 免 ack 只保留最新；stop 在平板队列中优先。
- 舒适度层没有把相机位置当成可随意改写的状态；posture 只在 comfort 包装层内组合。
- 粒子层固定 28 个粒子，不逐帧分配；只挂 `landscape`，边界明确。
- BLE 回执现在在语义路由之后返回；宿主命令失败不再伪装成 `OK`。

## 仍然复杂/应继续收口的地方

| 优先级 | 位置 | 问题 | 建议 |
| --- | --- | --- | --- |
| P0 | `PortalService.kt` | 约 1300 行，HTTP/WebSocket/GATT/设置/命令路由混在一个类 | 拆成 `LoopbackHttpServer`、`WsEventHub`、`CommandRouter`；先拆纯函数，不动线程模型 |
| P1 | 平板眼高 | state 已是 13 字节 v5；旧帧直接丢弃 | 仍需实机确认 GATT 通知长度、MTU 与解析 |
| P1 | 能力清单 | `WELCOME` 已带 capability mask，但 HTTP `CAPABILITIES` 仍是字符串 | 让两端只依赖 mask；诊断清单保留为展示 |
| P1 | 页面命令 | `start` 只提示，不是真正启动；`cue` 只在 landscape 生效 | 返回明确的 `NOT_READY` / `UNSUPPORTED`，不要静默成功 |
| P2 | `Comfort` | 重映射、posture、减速、状态查询都集中在一个闭包对象 | 保留 API，内部拆纯计算模块；先加测试再拆 |
| P2 | `App.ts` | 会话、XR、控制命令、HUD、手势仍集中；传输/视角/快照已独立 | 继续按“会话生命周期 / 控制命令 / 渲染管线”拆，不要引入框架 |

## 已经删除/收紧的假承诺

- 移除未实现的 `menu`、`pause`、`resume` 从白名单与能力清单。
- 移除 `launch` 别名，只保留 `enter`。
- `cue:*` 在非 landscape 场景直接拒绝；越界 intensity 直接拒绝。
- BLE 写回执改为 `dispatchControl` 返回成功才回 `OK`；失败回 `COMMAND_REJECTED`。
- 删除未使用的 `PortalStatus.description()` 和 `PortalActions.chooseHome()`。

## 判断标准

以后新增一个控制点前必须回答：

1. 它是宿主命令还是页面命令？
2. 它的语法、范围、场景/会话前置条件分别由谁校验？
3. 失败时 BLE、WS、平板分别看到什么？
4. 高频路径是否固定分配、是否有 TTL/停止语义？
5. 是否真的需要新抽象，还是现有命令可以表达？
