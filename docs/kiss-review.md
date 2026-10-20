# KISS 审查（v0.8.3 基线）

目标不是“代码少”，而是**每条协议只有一个解释、每个失败只有一个结果、每个高频路径不产生隐藏状态**。

## 现在做得好的地方

- 协议只有一个来源：`android/protocol/.../ControlProtocol.kt`，头显和平板共用命令、限制与编解码。
- 控制权只有一个事实源：BLE `BluetoothControl.controller`；首个 `CLAIM` 胜出，断链释放。
- 页面命令只有一条主通道：BLE → `PortalService` → `/events` SSE → 患者页面；`/control` 只做兼容回退。
- 高频运动有明确边界：`view:move` 10 Hz、300 ms TTL、0.3 m/s、径向 0.45 m；页面移动世界而不是 XR 相机。
- 舒适度层没有把相机位置当成可随意改写的状态；posture 只在 comfort 包装层内组合。
- 粒子层固定 28 个粒子，不逐帧分配；只挂 `landscape`，边界明确。
- BLE 回执现在在语义路由之后返回；宿主命令失败不再伪装成 `OK`。

## 仍然复杂/应继续收口的地方

| 优先级 | 位置 | 问题 | 建议 |
| --- | --- | --- | --- |
| P0 | `PortalService.kt` | 约千行，HTTP/SSE/GATT/设置/命令路由混在一个类 | 拆成 `LoopbackHttpServer`、`EventHub`、`CommandRouter`；先拆纯函数，不动线程模型 |
| P0 | `pendingControl` | 单槽 last-write-wins；`view:stop` 可能被后续 move 覆盖，靠 TTL 兜底 | 改为有界命令队列 + ack，或明确保留单槽但给 stop 优先级 |
| P1 | 平板眼高 | 已通过 state 第 5 段回读首个值；仍需确认旧客户端兼容与 MTU | 保留四段 fallback，后续若要更高频配置可独立特征 |
| P1 | 能力清单 | `CAPABILITIES` 是字符串，实际能力仍依赖场景/会话/页面 | 改成结构化 capability，返回 `supported/unsupported/not_ready` |
| P1 | 页面命令 | `start` 只提示，不是真正启动；`cue` 只在 landscape 生效 | 返回明确的 `NOT_READY` / `UNSUPPORTED`，不要静默成功 |
| P2 | `Comfort` | 重映射、posture、减速、状态查询都集中在一个闭包对象 | 保留 API，内部拆纯计算模块；先加测试再拆 |
| P2 | `App.ts` | 场景、XR、控制、遥测、HUD、手势集中 | 按“会话生命周期 / 控制命令 / 渲染管线”拆，不要引入框架 |

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
3. 失败时 BLE、HTTP、平板分别看到什么？
4. 高频路径是否固定分配、是否有 TTL/停止语义？
5. 是否真的需要新抽象，还是现有命令可以表达？
