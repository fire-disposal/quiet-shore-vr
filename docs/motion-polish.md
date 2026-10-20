# 动效收束：场景内“相机感”运动与失重感

范围：患者端 XR 会话中的运动动机（motion）。目标是把“像在移动”的表达收束成**世界动、相机不动**，并把失重粒子从“效果”降级为**可中止的过渡提示**。本文只描述当前事实与可实施的下一步；不回写历史方案。

## 0. 结论

1. **XR 相机由会话拥有，应用永不写它。** three r152 在每帧渲染前把 XR 视图位姿覆写进 `camera`，并据投影矩阵反推 `camera.fov`（`node_modules/three/src/renderers/webxr/WebXRManager.js:552-590`）。写相机或被覆盖，或造成视图与投影不一致。
2. **“相机感”只能通过世界变换 + 近场光流表达**：`Comfort.group`、`host.content`、`PostureCue` 三处，全部有界、可停。
3. **粒子只服务 posture 过渡**，不做常驻环境流；停止、回躺、断链、校准都必须收敛到不可见（指数淡出 τ=0.28 s：95% / 0.84 s，完全不可见 ≈1.2 s，不硬切）。
4. 双带粒子已落地并收口（近 17 / 远 11；角速度 ≤8.9°/s；近亮度 0.34；静止淡出；无横向重生跳变）。仍缺一项根因：`update(dt, progress, head)` 没有方向/停止信号，因此回躺仍向下流、`posture:stop` 后进度冻结会让粒子持续下落。
5. posture 缓动改为 quintic smootherstep 后，峰值速度是平均值的 1.875×（`POSTURE_EASE_PEAK`）：起身 0.45 m/14 s 的峰值 0.060 m/s、回躺 0.45 m/12 s 的峰值 0.070 m/s，都超过 `POSTURE_RATE` 的 0.05 m/s。合规修法是拉长 App 预设（≥ `travel × 1.875 / 0.05`），不是改 comfort 内部。
6. `docs/virtual-posture.md §8` 的“轻微视野扩张 1–2°”在 XR 中**不可实现**，应从该文档删除，不进入实现。

## 1. 现状清单

### 1.1 场景层级

```text
scene
├── comfort.group            q_total = q_posture * q_calibration；position = pivot - q_total*pivot - (0,riseM,0)
│   └── host.content         floorOffset(-eyeHeight)、viewOffset(-x, z)
│       └── handle.root      场景自有内容（landscape / ward / ...）
├── posture-cue (2×Points)  近/远两层直接挂在 scene 根上：不受 comfort / content 任何变换影响
└── spatial anchors          XR 菜单、HUD、校准卡
```

`posture-cue` 挂在根节点是**必须保持的不变量**：一旦移进 `comfort` 或 `content`，会与世界变换叠加成双重运动，且 comfort 的 pitch 会让近场点云倾斜。

### 1.2 运动机制清单

| 机制 | 文件 · 符号 | 当前行为 / 参数 | 动到什么 | 备注 |
| --- | --- | --- | --- | --- |
| XR 相机归属 | `core/xr/renderer.ts:createRenderer`、`core/xr/pose.ts:readHeadPose` | `xr.enabled`、`setReferenceSpaceType('local')`；每帧从 `xr.getCamera()` 读世界位姿到 `headPose` | 相机 | 3DoF，位置近似恒定；`camera.position.set(0, eyeHeight, 3.2)` 只服务 2D 预览 |
| 世界变换外壳 | `app/App.ts:loadScene`、`core/scene/host.ts` | comfort 包住 `host.content`；`content.y = -eyeHeight` | 世界 | 相机不入场，层级即安全边界 |
| 校准重映射 | `core/xr/comfort.ts:calibrateTwo/updatePosture` | `remapDurationMs` 200–4000，默认 900；smoothstep；`weight ≤0.85`、旋转 ≤120° | 世界旋转/位移 | 失败保留旧帧 |
| 姿态过渡 | `core/xr/situp-path.ts:SitUpPath` + `App.updateSitUp` | 髋部 0.45 m、躯干 0.55 m、站立眼高 1.70 m；前 70% 时间躯干旋转 90°，后 30% 抬升到眼高；`worldFor(head)` 自动反演镜头→世界；确认键短按坐起/回躺，长按菜单；会话内总时长 12 s | 世界 | `App.setVirtualPosture`：起身/回躺/停止；`sitUpT` 与姿态进度/俯仰/起身高度一致 |
| 平板视角修正 | `App.ts:viewPitchDeg`、`ControlViewModel.setPitchOffset` | `view:move:<x>,<z>` 暂复用：z 轴为 [-1,1] 俯仰修正目标，±20°；方向摇杆已移除，改为滑动条 | 世界 | 待实现为新的 `视角` TAB；当前代码仍保留平移实现 |
| 空间 UI | `core/spatial/anchor.ts`、`placement.ts` | 菜单 `summoned`（1.25 m，世界锁定，仅召唤时计算）；HUD `head-locked`（1.5 m，damping 0.06 s）；校准 `head-locked`（0.8 m，damping 0） | UI | 头锁只用于短时面板 |
| 场景环境循环 | `scenes/*/…js:update` | landscape：水面/天空/风/泡沫 `uTime`，云/雾/鸟 `InstancedMesh`；ward：心电纹理 0.09/s、屏幕 2.6 s 切换、秒针；bathroom：叶片 ±0.028 rad、水面 ±0.0012 m；lab：0.35 rad/s | 世界内容 | 全部 `dt ≤0.1` |
| 重力粒子 | `core/xr/posture-cue.ts:createPostureCue` | 双 `Points`：近 17（r 0.22–0.46 m、size 0.0095、opacity 0.34、0.020–0.034 m/s），远 11（r 0.40–1.10 m、size 0.0075、opacity 0.18、0.010–0.018 m/s）；横向摆动 ±0.045 rad；`depth`/`spread` 缩放；`sin^p × skew` 包络；静止淡出 τ=0.28 s；种子 PRNG；`dt ≤0.05` | 近场点云（2 draw call） | 仅 `landscape` 安装；`scene` 根下的两层；`dt=0` 时硬复位；`spread` 无越界联动 |
| 调试自旋 | `App.ts` pipeline `scene-update` | `?spin=1` 时聚焦物体以 1.6 rad/s 绕 Y 旋转 | 物体 | 仅调试，不面向患者 |

### 1.3 每帧顺序（`App.onFrame` + `FramePipeline`）

```text
readHeadPose()                       // XR 相机世界位姿（只读）
simulation 0  scene.update(dt)       // 场景环境循环
simulation 5  sit-up path / view tilt // 确认键或 view:move 俯仰修正
layout   0    menu / lab / hud / calibration anchors
render   0    sitUpPath → postureCue.update → input.update
render  10    renderer.render(scene, camera)
```

粒子在 `render` 阶段读取的是同一帧的 `headPose`，与世界变换同帧生效；这个顺序必须保持，否则粒子会比世界晚一帧，形成“拖影”。

## 2. “场景相机动画”在本应用里能指什么

| 含义 | 谁在动 | 实现 / 可行性 | 3DoF 一致性 | 裁决 |
| --- | --- | --- | --- | --- |
| A. 真·相机动画（平移/旋转/震动） | 相机 | 被 XR 视图位姿每帧覆写；写 `camera.matrix` 只会被覆盖或打架 | 不一致：患者本体不动，前庭无输入 | **禁止** |
| B. 世界变换 | 场景内容 | `Comfort.group`（pitch/rise/校准）、`host.content`（floor、view offset） | 一致：人不动、世界动，是唯一可解释的运动 | **唯一允许的“相机感”** |
| C. 投影变化（FOV / zoom / 透视畸变） | 投影矩阵 | `camera.projectionMatrix` 与 `camera.fov` 每帧由 XR 视图重算 | 属于相机层，且与真实前庭不符 | **禁止**（同时删除 `virtual-posture.md §8` 的 FOV 行） |
| D. 近场视差（点云相对头部反向/滞后位移） | 近场层 | 可用，但位移本身会“泳动”（swim） | 部分一致：由患者自己的头动驱动 | 本切片**不做**；要做须 ≤0.015 m、仅过渡期、≥0.8 m |
| E. 头锁 UI | 面板 | `SpatialAnchor` head-locked + damping | 不是运动错觉，但近距离拖拽感明显 | 限 1.5 m 内、短时；菜单保持 `summoned` 世界锁定 |

### 2.1 3DoF 边界

- PICO G2 4K 只有 3DoF：头显只报告朝向，`local` 空间里位置近似为原点。患者**无法**通过自己的位移获得视差，所以“相机平移”既不会被追踪，也不会被前庭验证。
- 因此“像在移动”的合法来源只有两种：**世界相对患者的位移**（rise / pull-back）和**近场光流**（粒子、视差梯度）。
- 世界变换必须绕校准 pivot 进行（已实现），否则患者会被“瞬移”出场景。
- 地平线必须保持水平：landscape 中 `rollDeg` 应恒为 0。高级模式的 ±10° roll 只适合有明确重力参照的 ward，不要用在开阔风景。

### 2.2 Firefox Reality 10 / Gecko 78 约束

- 唯一可用的 WebXR 入口；`xrCompatible` 必须在上下文创建时设置（`renderer.ts` 已处理）。
- 会话退出约 26 s，退出过程中不要销毁场景或改运动状态。
- XR 内没有滚动与浮层；任何“运动提示”文案只能走 HUD/菜单/平板。
- `prefers-reduced-motion` 在 2D 入口可用（`ui/gaze-guide.ts`、`styles.css`），但**不能**假定 XR 会话里可靠；降低动效必须走显式开关（`?motion=low` 或 `cue:off`）。
- Adreno 540 + 双 eye：粒子的每帧 buffer 上传是可用预算内的小项（28×3 floats）；两层各 1 draw call，不要再加第三层或逐粒子 sprite。

### 2.3 坐标框架取舍

| 框架 | 允许的对象 | 当前实现 | 约束 |
| --- | --- | --- | --- |
| 头锁（head-locked） | 短时面板：HUD、校准卡 | `SpatialAnchor` mode `head-locked`，damping 0–0.06 s | 距离 ≤1.5 m；不得承载场景内容；不得常驻 |
| 召唤后世界锁定（summoned） | XR 菜单 | 召唤时算一次位姿，之后冻结 | 患者转头再回来看仍在原处 |
| 世界锁定（world-locked） | 场景、粒子、投影面 | `handle.root`、`PostureCue` | 只能被 comfort/content 的有界变换移动 |
| 近场视差层 | 粒子（已存在） | 位置跟随头部，朝向不跟随 | 只允许低速下落，不允许按头动反向位移 |

“世界锁定的视差”不是把某个物体钉在相机前，而是**近远层以不同速度相对移动**：相机静止时，视差只能由世界运动（rise / view offset）或近场光流制造，不存在第三种来源。

## 3. 失重感可用性

### 3.1 设计判定

粒子是**上升提示（hint）**，不是“漂浮”玩法。判据：患者能随时停下、能看见稳定参照、粒子不主导中央视野、总时长不超过一次 posture 过渡。任何“持续漂浮感”都不做（会变成持续光流，长期暴露更容易累积不适）。

### 3.2 现存缺陷（按严重度）

| # | 问题 | 证据 | 影响 |
| --- | --- | --- | --- |
| P1 | `posture:stop` 后粒子**继续下落** | `active` 仍为 true，alpha 取 `envelope(冻结的 progress)`；`stepLayer` 继续推进，直到下一条 posture 命令 | 停止不等于停止：患者停在前倾中途时，近场仍在流 |
| P2 | 回躺时**反向流** | `update(dt, progress, head)` 没有方向参数；回躺时世界向上、粒子仍向下 | 方向矛盾，削弱可信度且增加不适 |
| P3 | API 没有方向/停止信号（P1/P2 的根因） | 只有 `progress`，`phase` 留在 App | 模块内无法收敛停止语义 |
| P4 | `spread` / `depth` 无越界联动 | `spread=2` 时远带 2.2 m，`depth=1` 再乘 1.3 后到 2.86 m | 超出近场 1.5 m 的界，粒子穿过栏杆/背景 |
| P5 | 无降低动效路径 | 只有 intensity；XR 内不可依赖 media query | 对敏感患者缺少一键“更安静” |
| P6 | 密度感知不对称 | additive 在亮天空背景下对比度低、在暗地面偏亮（需实机确认） | 同一套参数在不同视线方向观感差异大 |

### 3.3 参数表

近/远双带已存在（两个 `Points`，同一 `scene` 根），速度、亮度、尺寸与重生已按上限收口。下表把“当前常量”与“不得越过的界”并列，后续调参只允许在界内：

```text
当前：近带 2.5–8.9°/s，远带 0.9–2.6°/s；横向摆动叠加 ≤0.9°/s
目标：99 分位 ω ≤ 10°/s，保留 ≈2:1 的线速度比
```

| 参数 | 当前 | 目标 | 硬界 | 说明 |
| --- | --- | --- | --- | --- |
| 数量 | 近 17 + 远 11（count 28） | 保持 | 20–40 | 总数固定，两层各自 buffer |
| 近带半径 | 0.22–0.46 m | 保持 | ≥0.22 m | 角速度由速度上限约束 |
| 远带半径 | 0.40–1.10 m | 保持 | `× spread × depthScale ≤ 1.5` | 见 spread / depth 行 |
| 近线速度 | 0.020–0.034 m/s | 保持 | ≤0.034 m/s | 0.034/0.22 = 8.9°/s |
| 远线速度 | 0.010–0.018 m/s | 保持 | ≤0.018 m/s | 近:远 ≈2:1 |
| 角速度 | 2.5–8.9°/s（含摆动 ≤9.1） | 保持 | ≤10°/s | 低于强 vection 光流 |
| 尺寸 | 0.0095 / 0.0075 m | 保持 | `size/r ≤ 3°` | 0.0095/0.22 ≈ 2.5° |
| 不透明度 | 近 0.34 / 远 0.18 | 保持 | 近 ≤0.35 / 远 ≤0.20 | additive；峰值即上限 |
| 横向摆动 | ±0.045 rad，0.15–0.35 rad/s | 保持 | 角速度 ≤1°/s | 连续、无 wrap 跳变 |
| `spread` | 0.5–2，无越界联动 | 0.5–1.2，或联合 clamp | 远带最外半径 ≤1.5 m | 2.0 + depth=1 时 2.86 m |
| `depth` | 0–1（远带缩放 0.7–1.3） | 0.4–0.7 | 同上 | 与 spread 联合限幅 |
| 淡入 | 随 progress 的 `sin^1.8` 起速 | 保持 | 首 1.5 s ≤10% 不透明度 | 不需要额外时间项 |
| 淡出 | 指数 τ=0.28 s（95% / 0.84 s） | 保持 | ≥0.6 s | `dt=0` 时硬复位 |
| 完成时 | progress→1 归零 | 保持 | — | 与 `phase=standing` 一致 |
| 垂直跨度 | 近 0.95 / 远 1.6 m | 保持 | — | 与速度匹配 |
| 重生 | 只 `y += span`，x/z 连续摆动 | 保持 | 单帧 `|Δx|,|Δz| < 0.005 m` | 已无横向跳变 |
| dt 上限 | 0.05 s | 0.05 s | 0.05 s | 掉帧不得加速 |

### 3.4 触发 / 停止语义

`flow ∈ {−1, 0, +1}` 由 App 从 `comfort.isPostureMoving()` + `getPostureState().phase` 派生（`phase` 在 320 ms 刹车内已是 `standing`，单独用会提前消失），模块不猜：

| 事件 | 现状 | 目标 |
| --- | --- | --- |
| `posture:rise` | `sin^p` 包络，峰值约在过渡中点 | `flow=+1`，包络即淡入；近层峰值 0.34 |
| 过渡完成（`phase=standing`） | progress=1 → 两层归零（正确） | `flow=0`，保持现行为 |
| `posture:lower` | progress 0→1，向下流（错误方向） | `flow=0`（如需提示，最多 0.4× 向上流，默认不做） |
| `posture:stop` | progress 冻结，粒子**继续下落** | `flow=0` 当帧；alpha 走已有的 τ=0.28 指数淡出 |
| 校准开始 | 场景隐藏 | `flow=0`，随场景一起不可见 |
| `cue:off` / `cue:intensity:0` | 指数淡出（已实现） | 保持；`dt=0` 时才硬复位 |
| 会话结束 / 场景切换 | 瞬隐 / dispose | 结束 `update(0, head, 0)`（`dt=0` 硬复位）；切换直接 dispose |
| 租约丢失（`control:false`） | **只停 view，未停 posture** | 冻结 posture + `flow=0`，保持当前值不回弹（与 `control-interaction-spec.md §5` 一致） |

### 3.5 视觉锚点与构图

- 远参照：山脊、天空渐变、水面反光——过渡期间几乎不动，提供“世界没变”的底。
- 中参照：栈桥栏杆、灯笼、芦苇（2–5 m）——随 rise 下沉，是主要深度线索。
- 近参照：landscape 粒子（0.20–1.10 m，`spread` 后最远 1.5 m）——只补充“近处也在动”。
- 中央视野必须保留一个低对比、近似静止的元素（水面或天空），避免整屏同向流动。
- 粒子的落点不要进入地面/栈桥内部；landscape 开放场景天然满足，ward 不安装。

### 3.6 降低动效

| 层级 | 手段 | 行为 |
| --- | --- | --- |
| 默认 | intensity 1 | 上述参数 |
| 敏感 | `cue:intensity:0.3` | 速度不变、亮度约降到 0.10（近）/ 0.05（远）；保留方向线索 |
| 关闭 | `cue:off` | 指数淡出（τ=0.28，≈1.2 s 不可见），posture 过渡照常（功能性运动不可关） |
| 开发/评估 | `?motion=low` | 等价于 intensity 0；仅本地参数，不进控制面、不做持久化 |
| 2D 入口 | `prefers-reduced-motion` | 已有（gaze guide / CSS），与 XR 无关 |

不要在 3DoF 里用“缩短过渡时长”来降低动效——那会提高角速度/线速度，适得其反。

### 3.7 晕动风险

| 因素 | 机制 | 约束 |
| --- | --- | --- |
| 中央视野光流 | 诱发 vection 的主因 | 角速度 99 分位 ≤10°/s；中央保留静止参照 |
| 近眼大目标 | 视差过大、扫视负担 | 半径 ≥0.28 m，视直径 ≤3° |
| 方向矛盾 | 世界与粒子反向 | 回躺不产生向下流 |
| 无预警启动/停止 | 视觉跳变 | 淡入 ≥1.0 s、淡出 ≥0.6 s |
| 长时间暴露 | 累积不适 | 仅在 posture 过渡期间出现，≤30 s |
| 地平线倾斜 | 强烈空间失配 | landscape `roll=0` |
| 无法中止 | 失控感 | `posture:stop`、`cue:off`、患者确认键都立即生效 |
| 过渡峰值速度 | `postureEase` 峰值 1.875×平均；起身 14 s = 0.060 m/s、回躺 12 s = 0.070 m/s | 峰值 ≤0.05 m/s、pitch/roll ≤2°/s；预设时长 ≥ `travel × 1.875 / 0.05`（0.45 m ≈ 16.9 s）；1.2 m/30 s 在 1–30 s 包络内不可达，需另设上限 |

### 3.8 验收标准

自动（vitest，`tests/posture-cue.test.ts`）：

1. **A1 相机不动**：模块不持有相机、不读写 `camera.*`；两层只挂在传入的 `scene` 根上。
2. **A2 角速度**：99 分位 `v_i / r_i ≤ 0.175`（10°/s），单点 ≤0.21（12°/s）。
3. **A3 距离**：近层 ≥0.22 m；远层在 `spread`/`depth` 取极值时仍 ≤1.50 m。
4. **A4 亮度**：`intensity=1` 时近层 opacity ≤0.35、远层 ≤0.20；`intensity=0.3` 时 ≤0.11 / 0.06。
5. **A5 停止**：`flow` 从 +1 置 0 后，1.0 s 内两层 opacity ≤0.02；单帧 opacity 变化 ≤0.06。
6. **A6 方向**：`flow=0` / 负值时粒子不向下推进（位置冻结）。
7. **A7 淡出**：`setEnabled(false)` 后仍有 ≥0.6 s 的可见衰减，不出现同帧 `visible=false`。
8. **A8 稳定**：粒子数固定；`positions` 数组引用与长度在 `update` 前后不变（零分配）。
9. **A9 重生连续**：长跑 1500 帧，任一帧 `|Δx|, |Δz| < 0.005 m`；`y` wrap 时 x/z 不跳变。
10. **A10 关闭**：`intensity=0` 或 `flow=0` 且淡出结束后两层 `visible=false`。
11. **A11 缓动峰值**：按 `POSTURE_EASE_PEAK` 采样 App 的两个预设（0.45 m/30 s、90°/30 s）。rise 峰值约 0.028 m/s，满足 ≤0.05 m/s；pitch 峰值约 5.6°/s，属于完整起身重定向，已超出小角度微调的 2°/s 指南，必须在 PICO 上单独验证耐受，不能按微调预算宣称合规。
12. **A12 停止不靠 progress**：`progress` 冻结在 0.4 时，`flow=0` 仍能让两层在 0.8 s 内归零。

实机（PICO + Firefox Reality，记录到 `docs/performance-evidence.md` 的方式）：

13. 起身 30 s 全程无恶心、无“被推走”感；90° 重定向出现不适即延长时长或回退到小角度预设。
14. `posture:stop` 后近场在 ≤1 s 内静止并淡出；回躺无反向流。
15. 粒子不遮挡菜单/HUD 文本，不穿过栈桥与地面，`spread` 拉满时仍不进入背景山体。
16. 帧率与关闭粒子时无差异（HUD p95 不上升）。
17. 患者中途摘戴头显、断链、校准重置后，粒子与姿态都在 1 s 内收口。

## 4. 推荐实施切片

### S1 `src/core/xr/posture-cue.ts`（核心改动）

双带结构、种子 PRNG、per-mote 亮度、`depth`/`spread` 已落地，保留。剩余改动集中在方向、淡出与上限：

```ts
interface PostureCueApi {
  readonly object: THREE.Points;           // 近层，兼容旧调用
  readonly layers: readonly THREE.Points[]; // [near, far]
  setEnabled(enabled: boolean): void;
  setIntensity(intensity: number): void;   // 0..1，clamp
  setDepth(depth: number): void;           // 0..1，默认 0.5
  setSpread(spread: number): void;         // 0.5..2，但与 depth 联合限幅
  update(dt: number, head: THREE.Vector3, flow: number): void; // flow ∈ [-1,1]
  getState(): PostureCueState;             // + flow
  dispose(): void;
}
```

- 双带、种子 PRNG、横向摆动、指数淡出、速度/亮度/尺寸/半径与重生都已收口，保留。
- 把 `active` 从“只看 enabled/intensity”改为 `enabled && intensity > 0.001 && flow > 0`；`progress` 只决定淡入形状，停止/回躺由 `flow` 关断。停止后即使 `progress` 冻结在 0.4，也会走指数淡出并停止推进。
- `flow < 0` 只用于将来的“下降提示”，当前按 0 处理（不反转 y 速度）。
- `applyForm()` 增加联合限幅：`spread × (0.7 + depth × 0.6) × FAR_LAYER.radiusMax ≤ 1.5`。
- `dt = 0` 保留硬复位语义（teardown / 场景切换）。
- 保留：`frustumCulled=false`、`depthWrite=false`、additive、`dt ≤0.05`、vertexColors、`renderOrder` 3/4、圆点 sprite；每层各 1 draw call。

### S2 `src/app/App.ts`（接线与安全收口）

- `render` 阶段算 `flow`（`phase` 在 320 ms 刹车期间已经是 `standing`，不能单独用）：

  ```ts
  const posture = this.comfort;
  const flow = posture && posture.isPostureMoving()
    && posture.getPostureState().phase === 'rising' ? 1 : 0;
  this.postureCueState?.update(dt, this.headPose.position, flow);
  ```

  `isPostureMoving()` 覆盖过渡与刹车两段，停止当帧即为 false，正好触发已有指数淡出；回躺（`phase='lowering'`）同样得到 0。

- `setControlMode(false)` 追加 `this.comfort?.stopPosture()`（当前只 `haltViewMovement()`，与规范禁用矩阵不符）。
- 会话结束用 `update(0, head, 0)`（`dt=0` 硬复位；渲染循环即将停止）；场景切换继续 `dispose()`。
- `cue:*` 命令保持离散语义：不设 TTL，不参与 `view:` 通道。
- 把 `enabled` / `intensity` 存在 App 字段里，`loadScene` 重建粒子后重新应用；不写 localStorage（降低动效是会话内设置）。
- `src/app/config.ts` 增加 `motionLow: params.get('motion') === 'low'`，仅在创建粒子时把 intensity 置 0；不新增控制面命令。

### S3 可选：view 平移补齐规范

`startViewMovement` 加 0.08 死区与 500 ms / 200 ms 加减速（`VIEW_MAX_SPEED` 与 `VIEW_MAX_OFFSET` 不变），仍以 TTL 为最高优先级。此项与失重感无关，是操作手感问题；如果本次不排期，需在规范里标注“页面侧尚未实现”，不要让它变成隐性偏差。

### S4 测试与文档

- `tests/posture-cue.test.ts` 已覆盖双带数量、种子确定性、层间速度与调参 clamp；签名改成 `update(dt, head, flow)` 后同步 `hides at rest`、`respects the control handle` 两条，并新增：stop 后冻结/淡出、`flow` 方向、`spread × depth` 远界。
- 不改 posture 数学与 `tests/comfort-posture.test.ts`；A11 只需按 App 预设采样 `postureEaseRate` 断言峰值。
- `docs/virtual-posture.md §8`：删除“轻微视野扩张 1–2°”一行；粒子段落改为引用本文参数表，并注明缓动已换成 `postureEase` 及峰值约束。
- `docs/README.md` 索引在实施时补一行（本次不改）。

### 不变量

| # | 不变量 |
| --- | --- |
| I1 | 任何代码路径都不写 `camera.position/rotation/quaternion/fov/projectionMatrix`，除非 `!xr.isPresenting` 的 2D 预览 |
| I2 | `PostureCue.object` 的父节点只能是 `scene` 根；不得进入 `comfort.group` 或 `host.content` |
| I3 | 粒子更新零分配、固定 count、≤2 draw call、dt ≤0.05 |
| I4 | 所有世界运动仍是 `POSTURE_LIMITS` 与 `VIEW_*` 的子集；不新增轴向（y 视角平移、roll 自由、瞬移） |
| I5 | 停止优先：`posture:stop`、`cue:off`、患者确认键、租约丢失都在当帧生效，且不自动回弹 |
| I6 | 场景内容永不被头锁；只有 ≤1.5 m 的短时面板可以 head-locked |

### Fallback（场景级相机感过于冒险时）

1. **F1 只留世界变换**：`cue` 默认 intensity 0（仍保留命令），posture rise + 地平线独立承担提示；零新代码风险。
2. **F2 降级为静态锚点带**：去掉粒子推进，只在 `Comfort` 过渡期给地平线/栏杆加一层极低对比的高光（不移动），提供参照而不产生光流。
3. **F3 整体移除**：删除 `posture-cue.ts`、`App` 中的创建/更新/命令分支、`tests/posture-cue.test.ts`，并同步删除 `android/protocol` 的 `cue:*` 白名单（同一版本，不做兼容期）。删除比“留着但永久关闭”更干净。

## 5. 禁止清单

1. **不动相机**：不改 XR 相机、`renderer.xr.getCamera()`、reference space offset，不用 `getOffsetReferenceSpace` 伪造位移。
2. **无自由飞行**：不加 y 轴平移、不加旋转/俯仰、不做瞬移、不做速度加成。
3. **不做 FOV/zoom/透视动画**：XR 每帧覆写投影，且属于相机层。
4. **不做相机震动、头部摆动（head bob）、运动模糊、全屏暗角、闪光**。
5. **不做地平线倾斜**：landscape `roll` 恒 0。
6. **不把头锁层当场景**：菜单保持 `summoned`；不新增跟随头部的世界元素（天空盒、粒子场跟随旋转也不行）。
7. **不做常驻环境粒子/环境漂移**：粒子只在 posture 过渡出现。
8. **不为“更明显”而调高**：不加数量、不放大尺寸、不提 opacity、不在中央视野加密。
9. **不在运行时重写 x/z**：随机重排与绕轴旋转都是瞬移；重生只加 y。
10. **不把粒子挂进 comfort/content**，不改 `getPostureProgress()` 的语义去“凑”动画（它同时服务 telemetry 与 UI）。
11. **不在 ward 直接推广**：先保持单场景对照（见 `TODO.md`）。
12. **不新增 Android 侧命令**：降低动效只用已有 `cue:off` / `cue:intensity:*`；`?motion=low` 留在页面。

## 6. 待实机确认

1. 10°/s 上限的下落光流在 PICO 上是否“可感知但不推人”；若太弱，优先提高粒子数量而不是角速度。
2. 双带视差在 3DoF（无位移）下是否真的产生深度感，还是只像两层贴纸；近带 0.28 m 下限是否足够。
3. additive 在日间天空背景下是否对比过低；若不可见，改为 normal blending + 更暗的色值，而不是提高 opacity。
4. 14 s 起身全程的观感，以及 `posture:stop` 后 0.8 s 淡出、粒子立即停止推进是否足够。
5. 租赁丢失时冻结 posture 是否会让患者停在倾斜中途；若观感差，改用 320 ms 减速到最近稳定姿态（不回 neutral）。
6. `spread` 拉满时远带是否穿进山体/栏杆；若会，收紧 clamp 而不是移除调参。
