# 角度契约与分层收束（Rotation Contract）

只描述当前事实。数值调参（±90°/±180°、6 s、各预设时长）不在本文范围。实现状态见 §7。

## 0 解离的定义

**基础功能** = 给定一个旋转，确定性地施加到指定变换上，并能从该变换精确测量回来。
**业务目的** = 决定施加什么、何时、多快、失败时怎样。

本文把前者钉成 L0，把后者上移，并禁止任何一层同时承担两件事。已落地的模块：

| 层 | 文件 | 职责 |
| --- | --- | --- |
| L0 基础 | `src/core/xr/angle.ts` | 唯一的度↔弧度转换；有符号夹紧 |
| L0 基础 | `src/core/xr/frame.ts` | `WorldRotation` → 四元数、绕支点合成、`writeWorld` / `writeBase` |
| L0 基础 | `src/core/xr/measure.ts` | `measureEuler` / `measureRelativeEuler` / `measurePitchDeg` |
| L1 驱动 | `src/core/xr/drivers/curve.ts` | smoothstep / smootherstep / cycle / 制动位移 |
| L1 驱动 | `src/core/xr/drivers/track.ts` | 限速一阶跟踪（滑动条） |
| L2 业务 | `view-motion.ts`、`comfort.ts`、`remap.ts`、`situp-path.ts`、`situp-run.ts` | 视角通道、体位、校准几何、起身路径与进度 |
| L3 呈现 | `snapshot.ts`、`portal-link.ts`、`ControlProtocol`、平板 UI、`controller/main.ts` | 只测量、序列化、显示 |

L0/L1 不含时间、缓动策略、业务名词、世界对象；时间线由 L2 持有，只通过 L1 原语推进。

当前患者流程的口径：校准是一步（`Comfort.calibrate(pose)`，单帧即中立帧），没有 pivot 重映射；校准成功后以仰卧为起点创建 `SitUpPath`，起身/回躺是 6 s 的逆变换，由 `situp-run.ts` 推进、`WorldShell.setBasePose` 写入底座。

## 1 收束前的三条病变

| # | 病变 | 实例 | 后果 |
| --- | --- | --- | --- |
| 1 | 同一物理量多处口径 | `viewPitch`（+ = 看天，世界层取负）、`posture.pitchDeg`（+ = 世界上扬）、起身遥测硬编码 0 → **−90** | 起身到位时镜像视线指向上/后；编码层再把 −90 夹成 −20 |
| 2 | 隐式自动应用 | `viewMotion.update`、`comfort.updatePosture`、`worldShell.update`、`App.updateSitUp` 各自每帧推进并写入 | 曲线、时长、制动与符号约定散落在四个模块，无法单独替换 |
| 3 | 并行真相 | 起身 pitch 由 `−90 × min(1, t/rotationPortion)` 推导，而不是测量实际写入的基变换 | 上报值既不是意图也不是实际值；平板显示 `−20.0°` |

**根因不是镜像的减法。** 世界层是父级旋转 R，患者感知方向是 R⁻¹·head，所以「感知 = 头俯仰 − 世界俯仰」本身正确。错的是那条 `−90` 公式（正确符号应为 +90），以及编码层把越界值静默夹紧。

## 2 不变式

- **R1 单一真相**：一个角度要么是「被写入的变换」，要么是「从该变换测得的数」；没有第三条推导。
- **R2 单写者**：世界旋转每帧至多写一次（`world-shell`）；基变换只有一个写者（`comfort` 或 `setBasePose`）。
- **R3 基础层无时间**：`angle/frame/measure` 不含 `dt`、缓动、保持、归零、业务夹紧、业务名词。
- **R4 单位一次转换**：内部标量全是度；弧度只出现在 `angle.ts` 与 three 边界。
- **R5 符号带名**：裸 `pitchDeg` 只存在于具名类型内（`WorldRotation`、`EulerDeg`、`PostureState`）；跨模块用 `lookYawDeg` / `upGazeDeg` / `worldPitchDeg` / `headPitchDeg` / `worldRollDeg`。
- **R6 解离 ≠ 取消安全**：缓动、限速、制动、冻结全部保留，由 L1 原语 + L2 策略显式驱动，并由测试锁定。

## 3 唯一口径

| 通道 | 规范名 | 正方向 | 单位 | 写入者 | 读出者 |
| --- | --- | --- | --- | --- | --- |
| 操作员偏航 | `lookYawDeg` | + = 患者视线左转 | 度 | `viewToWorld()` → `shell.setWorldRotation`（世界为 **−** 角） | state `viewYaw`（int16） |
| 操作员俯仰 | `upGazeDeg` | + = 患者看到更多天空 | 度 | 同上（世界为 **−** 角） | state `viewPitch` |
| 体位 | `worldPitchDeg` / `worldRollDeg` | +pitch = 世界绕 +X 上倾（患者看到更多地面）；+roll = 绕 +Z | 度 | `comfort` 写 `q_posture · q_cal`（XYZ：`Rx·Rz`） | state `posturePitch` / `postureRoll` |
| 起身基 | `baseQuaternion` | 由 `worldFor(head, cam)` 决定 | 四元数 | `shell.setBasePose` | **测量**：`measureRelativeEuler(base, base₀)` |
| 头部朝向 | `headYawDeg` / `headPitchDeg` | yaw + = 俯视逆时针；pitch + = 抬头 | 度（线上弧度） | 物理量 | 遥测 20 B |
| 校准 | `remapAngleDeg` / `confidence` | 两姿态前向夹角 / `sin(夹角)` | 度 / 0–1 | 只计算 | 状态行、校准结果 |

合成顺序固定：`q_total = q_world · q_cal`；世界层绕眼点旋转，基变换绕校准支点旋转。姿态与视角不得互换顺序。

**感知投影**（只在呈现层使用）：`perceivedPitch = headPitch − worldPitch`。镜像页的虚拟视线箭头就是这一条，数据来自测量值。

## 4 L0 接口

```ts
// angle.ts — 纯函数
degToRad(deg), radToDeg(rad), clampSigned(value, limit)

// frame.ts — 世界系旋转的唯一构造与唯一写入
interface WorldRotation { pitchDeg; rollDeg; yawDeg }   // +pitch = 世界绕 +X 右旋
worldQuaternion(out, rotation)                          // XYZ 顺序
aroundPivot(outPos, q, pivot)                           // p = pivot − q·pivot
writeWorld(target, q, pivot)                            // 世界层
writeBase(target, q, position)                          // 基变换层

// measure.ts — 唯一读出
measureEuler(q, out)                                    // YXZ
measureRelativeEuler(q, reference, out)                 // q · reference⁻¹
measurePitchDeg(q)
```

`world-shell` 只保存 `WorldRotation` 并调用 `writeWorld`；它不再有 `setPitch`，也没有内部符号翻转。`viewToWorld(lookYawDeg, upGazeDeg)` 是唯一把患者视角意图转成世界旋转的地方：两个轴都取负。

## 5 业务通道落点

| 业务 | L2 | L1 | L0 | L3 |
| --- | --- | --- | --- | --- |
| 视角拖动 | `view-motion.setTarget(yaw, pitch)` | `approachGap(τ=0.25 s；俯仰 ≤15 °/s、偏航 ≤30 °/s)` | `writeWorld` | state `viewYaw` / `viewPitch` |
| 视角预设 | 目录 + 计时播放（`smootherstep` / `cycle`） | `smootherstep`、`cycle` | 同上 | 同上 |
| 体位 | `comfort`（限幅、重定向、制动、进度） | `smootherstep`、`smootherstepRate`、`brakeTravel` | `writeBase` | 测量 |
| 起身 | `situp-path` 逆变换；`situp-run` 推进 12 s 线性进度 | — | `writeBase`（`setBasePose`） | `measureRelativeEuler(base, base₀)` |
| 校准 | `remap.ts` 门限/置信度/封顶；`comfort` 缓入 | `smoothstep` | `writeBase` | 置信度、夹角 |

## 6 已删除的第二真相

| 原位置 | 原行为 | 现状 |
| --- | --- | --- |
| `snapshot.ts` | `−90 × min(1, t/rotationPortion)` | 删；改为 `measureRelativeEuler(base, ref)` |
| `world-shell.ts` | `setPitch` + `R_x(−pitch)` 内联 | 删；只接受 `WorldRotation`，符号在 `viewToWorld` |
| `comfort.ts` | 内联 `postureEase`/`postureEaseRate`/制动积分/Euler 组合 | 迁到 `drivers/curve.ts` + `frame.ts`；`applyTransform` 只做合成与写入 |
| `remapFromPoses` / `REMAP_*` | 住在 `comfort.ts` | 迁到 `remap.ts`（comfort 不再导出） |
| `ControlProtocol.encodeState` | `posturePitch + 20`、`[0,40]` 夹紧 | 有符号整度；只保留位宽检查 |
| `PortalService.applyState` | `viewPitch` 再夹 ±20 | 删；页面是唯一夹紧点（现为 ±90 / ±180） |
| `ControlProtocol.NORMALIZED_AXIS` | 接受 `.5` / `5.` | 与页面同一语法 `^-?\d+(?:\.\d+)?$` |
| `StatusPanel` | `%.1f°` 显示整度值 | 整数度 |

## 7 迁移状态

| 步 | 内容 | 状态 |
| --- | --- | --- |
| S1 | 遥测测量化（base 对 base₀） | **完成**：`scene-snapshot.test.ts` 断言「改四元数 → 上报随之改变」 |
| S2 | `world-shell` 去语义 | **完成**：`world-shell.test.ts` 覆盖任意旋转与枢轴不变式 |
| S3 | 曲线/制动/几何抽出 | **完成**：`comfort-posture` / `comfort-remap` 全部用例保持通过 |
| S4 | 起身时间线移出 `App` | **完成**：`situp-run.ts` 持有进度/目标/停止，`App.updateSitUp` 只转发 `dt` |
| S5 | state v7 有符号整度 + 偏航 int16 | **完成**：`android/protocol/.../StateFrameTest.kt`（−90 可往返，±180 可往返） |
| S6 | 单解析器 | **完成**：页面与 Kotlin 共用 §8 向量，`.5` / `5.` / `+0.5` 两侧同拒 |

S5 是协议断代：v5 帧被丢弃，两个 APK 必须同版本升级（与既有约束一致）。

## 8 Golden vectors

页面 `tests/rotation-contract.test.ts` 与 Kotlin `StateFrameTest.kt` 使用同一组期望。

| 用例 | 输入 | 期望 |
| --- | --- | --- |
| 视角正向 | `view:orient:0,60` | `upGazeDeg = +60`；世界 `pitchDeg = −60` |
| 视角左转 | `view:orient:90,0` | `lookYawDeg = +90`；世界 `yawDeg = −90` |
| 视角端点 | `view:orient:-180,90` | `lookYawDeg = −180`、`upGazeDeg = 90` |
| 语法拒绝 | `0,.5`、`0,5.`、`+0.5,0`、`0.001,0`、`0,1.05`、`0,0.5,0` | 两侧均拒绝，当前值不变 |
| 欧拉分解 | `q = R_y(30°)·R_x(−10°)` | yaw +30、pitch −10、roll 0 |
| 组合顺序 | `{pitch 12, roll −6}` | `R_x(12°)·R_z(−6°)` |
| 相对测量 | `base = R_pitch(18)·R_y(40)`，`ref = R_y(40)` | pitch 18、yaw 0 |
| 起身端态 | 世界 +90°、头 +90° | 前方内容与视线重合（感知 0°） |
| 重映射权重 | 夹角 60°、strength 1 | confidence 0.866、weight 0.85 |
| state 编码 | `viewPitch ±20` | byte 8 = `0x14` / `0xEC` |
| state 编码 | `viewYaw = 180` | bytes 13–14 = `B4 00`（int16 LE） |
| state 编码 | `posturePitch −90` | byte 4 = `0xA6`（−90），往返 −90 |
| 版本 | 首字节 5 | 整帧丢弃 |

## 9 默认决策（已采用）

| 编号 | 问题 | 结论 |
| --- | --- | --- |
| D1 | 内部单位 | 度（标量）/ 四元数（复合）；弧度只在 `angle.ts` |
| D2 | 度数字段编码 | byte 4/5/8 有符号整度；偏航另占 int16（byte 13–14），state v7、15 B |
| D3 | 缓动/制动 | 保留，改由 L1 原语 + L2 策略显式驱动 |
| D4 | 遥测 yaw/pitch | 线上仍是弧度，只在呈现层转度 |

## 10 完成判据（当前）

- `degToRad` / `radToDeg` 只定义在 `angle.ts`；其他模块的 `Math.PI / 180` 仅在 `frame.ts`（无）与 test 内出现。
- `shell.quaternion` 只由 `writeWorld` 写；`base` 只由 `writeBase` / `setBasePose` 写。
- `snapshot` 不再接收「业务进度 → 角度」参数，只接收两个四元数。
- `−90` 在 `src` 内只出现在文档注释与测试期望里，不再参与计算。
- 页面 156 项 vitest、Kotlin 4 项 state 向量、两端 Kotlin 编译均通过。

## 11 不做的事

- 不改 `view:orient` / `view:anim` / `view:stop` 的语法、不改 ±90°/±180°/6 s/预设时长与曲线（调参另行评审）。
- 不为旧口径保留兼容层：S5 直接断代，v5 帧丢弃。
- 不重构 `App` 会话生命周期、`PortalService` 线程模型、场景内容。
