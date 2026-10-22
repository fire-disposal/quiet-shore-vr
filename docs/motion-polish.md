# 动效收束：场景内“相机感”运动与失重感

范围：患者端 XR 会话中的运动动机（motion）。目标是把“像在移动”的表达收束成**世界动、相机不动**，并把失重粒子从“效果”降级为**可中止的过渡提示**。本文只描述当前事实与可实施的下一步；不回写历史方案。

当前落地状态：校准是一步（正前方 + 静止，直接落一帧），成功后页面以仰卧为起点进入 6 s 起身路径；头显确认键只有一个动作——已校准且会话中短按切换起身/回躺，其余状态不响应。头显内没有 WebXR 菜单，场景目标仍由 6 s 注视停留选中。

## 0. 结论

1. **XR 相机由会话拥有，应用永不写它。** three r152 在每帧渲染前把 XR 视图位姿覆写进 `camera`，并据投影矩阵反推 `camera.fov`（`node_modules/three/src/renderers/webxr/WebXRManager.js:552-590`）。写相机或被覆盖，或造成视图与投影不一致。
2. **“相机感”只能通过世界变换 + 近场光流表达**：`world-shell`（视角俯仰）、`Comfort.group`（校准/体位）、`host.content`（地板）、`PostureCue` 四处，全部有界、可停。
3. **粒子只服务 posture 过渡**，不做常驻环境流；停止、回躺、断链、校准都必须收敛到不可见（指数淡出：近带 τ=0.28 s、远带 τ=0.45 s，完全不可见 ≈2 s，不硬切）。
4. 双带粒子已落地并收口（近 17 / 远 11；角速度 ≤8.9°/s；近亮度 0.34；静止淡出；无横向重生跳变）。**已修**：`update(dt, head, flow)` 取代了进度驱动，`flow = +1` 只在起身过渡真实移动时成立；停止/回躺/断链当帧冻结位置并按既有 τ 淡出，回躺不再产生向下流（见 §3.4、§4 S1）。
5. posture 缓动改为 quintic smootherstep 后，峰值速度是平均值的 1.875×（`POSTURE_EASE_PEAK`）：起身 0.45 m/14 s 的峰值 0.060 m/s、回躺 0.45 m/12 s 的峰值 0.070 m/s，都超过 `POSTURE_RATE` 的 0.05 m/s。合规修法是拉长 App 预设（≥ `travel × 1.875 / 0.05`），不是改 comfort 内部。
6. 旧版 `virtual-posture.md` 的“轻微视野扩张 1–2°”在 XR 中**不可实现**，已从该文档删除，不进入实现。
7. 视角修正从“世界平移”改为**世界俯仰**，并收进一个系统级控制器：`ViewMotionController` 拥有预设目录（`up/down/recenter/breathe`）、目标、缓动、播放状态、保持与重置；`WorldShell` 只把角度组合成变换。App 里不再有逐帧视角数学，也没有模块直接写 `comfort.group`（见 §1.4）。

## 1. 现状清单

### 1.1 场景层级

```text
scene
├── world-shell              view pitch：绕眼部（head position）旋转，pos = eye - R*eye；由 ViewMotionController 给角度
│   └── comfort.group        q_total = q_posture * q_calibration；position = aroundPivot(q_total, p0) - (0,riseM,0)
│       │                    单帧校准：p0/q0 就是采集点；起身期间改由 shell.setBasePose(worldFor(head, camera)) 写同一槽位
│       └── host.content     floorOffset(-eyeHeight)；不再有 viewOffset
│           └── handle.root  场景自有内容（landscape / ward / ...）
├── posture-cue (2×Points)  近/远两层直接挂在 scene 根上：不受 shell / comfort / content 任何变换影响
└── spatial anchors          HUD、校准卡
```

`posture-cue` 挂在根节点是**必须保持的不变量**：一旦移进 `comfort` 或 `content`，会与世界变换叠加成双重运动，且 comfort 的 pitch 会让近场点云倾斜。

三个变换层各有唯一写者（`src/core/xr/world-shell.ts`）：

| 层 | 写者 | 变换内容 |
| --- | --- | --- |
| `world-shell.group` | `WorldShell.update(eye)` | 视角俯仰，绕眼部；0° 时严格 identity |
| `world-shell.base`（= `comfort.group`） | `Comfort.applyTransform`，或起身时 `setBasePose` | 校准重映射 + 姿态，或起身世界逆变换（二选一） |
| `host.content` | `SceneHost.setFloorOffset` | 地板偏移 |

场景内容（`handle.root`）只负责美术与环境循环，不参与任何视角/运动优先级判断。

### 1.2 运动机制清单

| 机制 | 文件 · 符号 | 当前行为 / 参数 | 动到什么 | 备注 |
| --- | --- | --- | --- | --- |
| XR 相机归属 | `core/xr/renderer.ts:createRenderer`、`core/xr/pose.ts:readHeadPose` | `xr.enabled`、`setReferenceSpaceType('local')`；每帧从 `xr.getCamera()` 读世界位姿到 `headPose` | 相机 | 3DoF，位置近似恒定；`camera.position.set(0, eyeHeight, 3.2)` 只服务 2D 预览 |
| 世界变换外壳 | `core/xr/world-shell.ts`、`App.loadScene`、`core/scene/host.ts` | shell 包住 `comfort.group`，comfort 包住 `host.content`；`content.y = -eyeHeight`；换场景时重建 shell 并重贴当前角度，不重新动画 | 世界 | 相机不入场，层级即安全边界；App 不再直接写任何 group |
| 一步校准 | `ui/calibration.ts:Calibration`、`core/xr/comfort.ts:calibrate` | 6° 容差、1.2 s 稳定、2 s 倒计时 → `comfort.calibrate(pose)` 把该帧设为中立帧；无过渡、直接落帧；`q_total = q_posture * q0`，绕采集点旋转 | 世界旋转 | 失败（无有效姿态）保留旧帧；`calibrateTwo` / `remapFromPoses` 保留但不再被调用 |
| 姿态过渡 | `core/xr/situp-path.ts:SitUpPath` + `core/xr/situp-run.ts` | 髋部 0.45 m、躯干 0.55 m、站立眼高 1.70 m；旋转段占 70%（90°，峰值 ≈40 °/s），后 30% 抬升到眼高；`worldFor(head)` 自动反演镜头→世界；播放头 6 s；患者短按确认键（已校准 + 会话中）或平板虚拟起身区块触发 | 世界 | `situp-run` 持有进度/目标/停止；`App.setVirtualPosture` 只转发命令 |
| 平板视角朝向 | `core/xr/view-motion.ts:ViewMotionController`、`core/xr/world-shell.ts` | `view:orient:<yaw>,<pitch>` = 绝对朝向（±180°/±90°）；滑动条重定向用 0.25 s 时间常数 + 俯仰 15 °/s、偏航 30 °/s 上限；预设 `up\|down\|recenter\|breathe` 固定曲线，recenter 同时归零偏航；`view:stop` 立即冻结 | 世界（shell 层，两轴取负） | 无平移、无 TTL、无 roll；App 只解析命令并转发 |
| 空间 UI | `core/spatial/anchor.ts`、`placement.ts` | 校准卡 `head-locked`（0.8 m，damping 0）；HUD `head-locked`（1.5 m，damping 0.06 s）；头显内没有菜单面板 | UI | 头锁只用于短时面板 |
| 场景环境循环 | `scenes/*/…js:update` | landscape：水面/天空/风/泡沫 `uTime`，云/雾/鸟 `InstancedMesh`；ward：心电纹理 0.09/s、屏幕 2.6 s 切换、秒针；bathroom：叶片 ±0.028 rad、水面 ±0.0012 m；lab（直立光室）：地面环 0.02–0.05 rad/s、顶晕 0.04 rad/s、光柱与碑体光晕正弦呼吸、暖/冷/近三层尘埃沿 y 缓慢上浮 | 世界内容 | 全部 `dt ≤0.1` |
| 重力粒子 | `core/xr/posture-cue.ts:createPostureCue` | 双 `Points`：近 17（r 0.22–0.46 m、size 0.0095、opacity 0.34、0.020–0.034 m/s、`growTau` 0.5 / `fadeTau` 0.28），远 11（r 0.40–1.10 m、size 0.0075、opacity 0.18、0.010–0.018 m/s、`growTau` 1.0 / `fadeTau` 0.45）；横向摆动 ±0.045 rad；`depth`/`spread` 缩放；`flow` 门控；种子 PRNG；`dt ≤0.05` | 近场点云（2 draw call） | 应用级，四个场景共用；`flow=+1` 只在上行起身过渡；`flow=0` 当帧冻结位置 |
| 调试自旋 | `App.ts` pipeline `scene-update` | `?spin=1` 时聚焦物体以 1.6 rad/s 绕 Y 旋转 | 物体 | 仅调试，不面向患者 |

### 1.3 每帧顺序（`App.onFrame` + `FramePipeline`）

```text
readHeadPose()                        // XR 相机世界位姿（只读）
simulation 0  handle.update(dt)       // 场景环境循环（只动美术，不参与视角）
layout   0    menu / lab / hud / calibration anchors
render   0    sitUpPath | comfort.updatePosture → cueFlow → postureCue.update(dt, head, flow) → input.update
render   1    viewMotion.update(dt) → shell.update(eye)   // 缓动在控制器，组合在 shell
render  10    renderer.render(scene, camera)
```

粒子在 `render` 阶段读取的是同一帧的 `headPose`，与世界变换同帧生效；这个顺序必须保持，否则粒子会比世界晚一帧，形成“拖影”。

### 1.4 视角运动：系统级控制器 + 场景无关的组合层

视角俯仰是**系统能力**，不属于任何场景。它被拆成两半，各自单一职责：

| 模块 | 位置 | 拥有什么 | 明确不做什么 |
| --- | --- | --- | --- |
| `ViewMotionController` | `src/core/xr/view-motion.ts` | 当前角度、目标、播放状态、缓动、保持、重置 | 不 import 任何场景模块，不认识 scene id，不碰 three 场景图；只把角度推给 `setPitch` sink |
| `WorldShell` | `src/core/xr/world-shell.ts` | 变换组合（pitch → 校准/起身 → 地板）与唯一写者规则 | 不做缓动、不做状态机、不决定优先级；换场景时重建并重贴当前角度 |
| `App`（会话监督） | `src/app/App.ts` | 命令解析、禁用闸门、租约、患者停止、会话/校准生命周期 | 不写任何 group、不做逐帧视角数学 |

状态机（单一事实来源）：

```text
idle    --play / view:orient-->  playing --到达目标--> idle
playing --view:stop / 租约丢失--> held        （冻结当前角度，不缓动、不回正）
held    --play / view:orient-->  playing        （从当前角度继续，不跳变）
any     --会话结束 / 校准开始--> idle @ 0°    （reset，无缓动）
```

优先级由监督者保证：**患者停止 > 租约丢失 > 会话结束/校准重置 > 显式视角命令 > 动画完成**。控制器本身只保证 `stop()` 当帧生效、永不缓动。

预设目录（`VIEW_PRESETS`，新增预设=加一条目录项；控制器只按 `motion`/`curve` 分支，不按 id 分支）：

| 命令 | id / 编码 | 目标解析 | 时长 | 曲线 | 峰值角速度 |
| --- | --- | --- | --- | --- | --- |
| `view:anim:up` | `up` / 1 | 相对 +10°，整体 clamp ±90° | 3.0 s | smootherstep | 6.25°/s |
| `view:anim:down` | `down` / 2 | 相对 −10°，整体 clamp ±90° | 3.0 s | smootherstep | 6.25°/s |
| `view:anim:recenter` | `recenter` / 3 | 绝对 0°（偏航同时归零） | 2.4 s | smootherstep | 俯仰 ±90° 全程时 ≈70 °/s；偏航按 40 °/s 均速展开 |
| `view:anim:breathe` | `breathe` / 4 | 当前 → +6° → 当前（往返） | 6.0 s | smootherstep 去、镜像 smootherstep 回（`cycle`） | 峰值 3.75°/s，末态=初态 |
| —（无预设） | `none` / 0 | 仅状态回报，不可播放 | — | — | — |

- `up`/`down` 是**相对**目标：在 +90° 再按 `up` 是无运动（`idle`，`viewPreset=none`），不再出现“按上仰却在向下”的矛盾。
- `recenter` 是唯一绝对目标，也是唯一能回到 0° 的预设；`view:stop` 只保持。
- `breathe` 在一次播放里改变方向：前半程 smootherstep 到 +6°，后半程镜像回落，结束时精确回到起始角度；若峰值越过 ±90° 会先 clamp（例如 88° 起播 → 90° → 88°）。
- 目录项带 `label.zh/en` 与 `curveLabel`，供平板镜像/文档使用；页面不接受任意时长或振幅（`view:anim:<id>` 只有 id，多余参数整条拒绝）。
- 每条预设首末速率为 0；in-play 保持 `playing`，到达后 `idle`。`view:stop` 冻结并保留 `preset` 供回读，`setTarget`（滑动条）会清空预设。

滑动条 `view:orient:<yaw>,<pitch>`（绝对度数，±180°/±90°）是**连续重定向**：每次重定向都从当前朝向继续，采用 0.25 s 时间常数 + 俯仰 15 °/s、偏航 30 °/s 硬速率上限的指数逼近，因此 10 Hz 拖动不会因为“每帧重启一次固定时长缓动”而迟滞，也不会因为把滑动条点到端点而甩动世界。

状态回报：WS `state` 的 `viewPitch` / `viewYaw` 是**当前已生效角度**（有符号度），`viewAnim` 为 `idle|playing|held`，`viewPreset` 为 `none|up|down|recenter|breathe`。state v8（Android 编码，20 字节）携带两个角度、相位与预设 id；页面只发送字符串，不参与字节布局。`viewX`/`viewZ` 已删除。

## 2. “场景相机动画”在本应用里能指什么

| 含义 | 谁在动 | 实现 / 可行性 | 3DoF 一致性 | 裁决 |
| --- | --- | --- | --- | --- |
| A. 真·相机动画（平移/旋转/震动） | 相机 | 被 XR 视图位姿每帧覆写；写 `camera.matrix` 只会被覆盖或打架 | 不一致：患者本体不动，前庭无输入 | **禁止** |
| B. 世界变换 | 场景内容 | `world-shell`（视角俯仰）、`Comfort.group`（pitch/rise/校准）、`host.content`（floor） | 一致：人不动、世界动，是唯一可解释的运动 | **唯一允许的“相机感”** |
| C. 投影变化（FOV / zoom / 透视畸变） | 投影矩阵 | `camera.projectionMatrix` 与 `camera.fov` 每帧由 XR 视图重算 | 属于相机层，且与真实前庭不符 | **禁止**（旧版 `virtual-posture.md` 的 FOV 行已删除） |
| D. 近场视差（点云相对头部反向/滞后位移） | 近场层 | 可用，但位移本身会“泳动”（swim） | 部分一致：由患者自己的头动驱动 | 本切片**不做**；要做须 ≤0.015 m、仅过渡期、≥0.8 m |
| E. 头锁 UI | 面板 | `SpatialAnchor` head-locked + damping | 不是运动错觉，但近距离拖拽感明显 | 限 1.5 m 内、短时；头显内没有菜单面板 |

### 2.1 3DoF 边界

- PICO G2 4K 只有 3DoF：头显只报告朝向，`local` 空间里位置近似为原点。患者**无法**通过自己的位移获得视差，所以“相机平移”既不会被追踪，也不会被前庭验证。
- 因此“像在移动”的合法来源只有两种：**世界相对患者的位移**（rise / pull-back）和**近场光流**（粒子、视差梯度）。
- 世界变换必须绕校准帧的采集点进行（已实现，`aroundPivot` 用单帧 `p0`），否则患者会被“瞬移”出场景。
- 地平线必须保持水平：landscape 中 `rollDeg` 应恒为 0。±10° roll 只适合有明确重力参照的 ward，作为场景实验参数，不在平板暴露。

### 2.2 Firefox Reality 10 / Gecko 78 约束

- 唯一可用的 WebXR 入口；`xrCompatible` 必须在上下文创建时设置（`renderer.ts` 已处理）。
- 会话退出约 26 s，退出过程中不要销毁场景或改运动状态。
- XR 内没有滚动与浮层；任何“运动提示”文案只能走 HUD/平板（头显内没有菜单）。
- `prefers-reduced-motion` 在 2D 入口可用（`ui/gaze-guide.ts`、`styles.css`），但**不能**假定 XR 会话里可靠；降低动效必须走显式开关（`?motion=low` 或 `cue:off`）。
- Adreno 540 + 双 eye：粒子的每帧 buffer 上传是可用预算内的小项（28×3 floats）；两层各 1 draw call，不要再加第三层或逐粒子 sprite。

### 2.3 坐标框架取舍

| 框架 | 允许的对象 | 当前实现 | 约束 |
| --- | --- | --- | --- |
| 头锁（head-locked） | 短时面板：HUD、校准卡 | `SpatialAnchor` mode `head-locked`，damping 0–0.06 s | 距离 ≤1.5 m；不得承载场景内容；不得常驻 |
| 召唤后世界锁定（summoned） | 目前无对象（原 XR 菜单已移除） | `SpatialAnchor` 保留该模式 | 仅当将来需要“召唤一次、之后停在原处”的面板时使用 |
| 世界锁定（world-locked） | 场景、粒子、投影面 | `handle.root`、`PostureCue` | 只能被 comfort/content 的有界变换移动 |
| 近场视差层 | 粒子（已存在） | 位置跟随头部，朝向不跟随 | 只允许低速下落，不允许按头动反向位移 |

“世界锁定的视差”不是把某个物体钉在相机前，而是**近远层以不同速度相对移动**：相机静止时，视差只能由世界运动（rise / view pitch）或近场光流制造，不存在第三种来源。

## 3. 失重感可用性

### 3.1 设计判定

粒子是**上升提示（hint）**，不是“漂浮”玩法。判据：患者能随时停下、能看见稳定参照、粒子不主导中央视野、总时长不超过一次 posture 过渡。任何“持续漂浮感”都不做（会变成持续光流，长期暴露更容易累积不适）。

### 3.2 现存缺陷（按严重度）

| # | 问题 | 证据 | 影响 |
| --- | --- | --- | --- |
| P1 | `posture:stop` 后粒子**继续下落** | `active` 仍为 true，alpha 取 `envelope(冻结的 progress)`；`stepLayer` 继续推进，直到下一条 posture 命令 | 停止不等于停止：患者停在前倾中途时，近场仍在流。**已修**：`flow=0` 当帧 `return`，位置冻结 |
| P2 | 回躺时**反向流** | `update(dt, progress, head)` 没有方向参数；回躺时世界向上、粒子仍向下 | 方向矛盾，削弱可信度且增加不适。**已修**：只有 `flow>0` 才推进，回躺恒为 0 |
| P3 | API 没有方向/停止信号（P1/P2 的根因） | 只有 `progress`，`phase` 留在 App | 模块内无法收敛停止语义。**已修**：`update(dt, head, flow)`，App 用 `isPostureMoving()+getPosturePhase()` 派生 |
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
| 淡入（近 / 远） | 指数 τ=0.5 s / 1.0 s | 保持 | 首 0.5 s 不透明度 ≤50% | 由 `flow` 触发，不再依赖 progress；近带先到、远带后到 |
| 淡出（近 / 远） | 指数 τ=0.28 s / 0.45 s（95%：0.84 s / 1.35 s） | 保持 | ≥0.6 s 可见衰减 | `dt=0` 时硬复位；`flow=0` 当帧冻结位置 |
| 完成时 | `flow=0` → 淡出 | 保持 | — | 与 `phase=standing` / 起身到达目标一致 |
| 垂直跨度 | 近 0.95 / 远 1.6 m | 保持 | — | 与速度匹配 |
| 重生 | 只 `y += span`，x/z 连续摆动 | 保持 | 单帧 `\|Δx\|,\|Δz\| < 0.005 m` | 已无横向跳变 |
| dt 上限 | 0.05 s | 0.05 s | 0.05 s | 掉帧不得加速 |

### 3.4 触发 / 停止语义

`flow` 由 App 在每帧计算后传给 `update(dt, head, flow)`，模块不猜方向：

```ts
// App.computeCueFlow()
if (calibration.active) return 0;
if (sitUpMode) return sitUpMoving && sitUpTarget > sitUpT ? 1 : 0;
if (!comfort?.isPostureMoving()) return 0;
return comfort.getPosturePhase() === 'rising' ? 1 : 0;
```

`flow = +1` 只在**起身过渡真实移动**时成立；其余一律 0。粒子模块把 `flow` clamp 到 0–1（负值按 0 处理，为将来的下降提示预留），只有 `flow > 0` 才推进位置，停止当帧 `return`，位置与摆动一起冻结。

| 事件 | 实现 | 结果 |
| --- | --- | --- |
| `posture:rise` | `flow=+1` | 近带 ~0.5 s、远带 ~1 s 淡入，随后匀速下落 |
| 过渡完成（`phase=standing`） | `flow=0` | 位置冻结，按 τ 淡出到不可见 |
| `posture:lower` | `flow=0`（`phase='lowering'`） | **无向下流**，静止淡出；不反向播放 |
| `posture:stop` | `isPostureMoving()` 在刹车期仍在，但 `phase` 已是 `standing` → `flow=0` | 当帧冻结，τ 淡出 |
| 校准开始 | `flow=0` | 场景隐藏，粒子随场景不可见 |
| `cue:off` / `cue:intensity:0` | 指数淡出 | 保持；`dt=0` 时才硬复位 |
| 会话结束 / 场景切换 | `update(0, head, 0)` / `dispose()` | 硬复位 / 直接释放 |
| 租约丢失（`control:false`） | `viewMotion.stop()` + `comfort.stopPosture()` + `stopSitUp()` → `flow=0` | 冻结 posture 与起身、保持当前俯仰（不回正）、粒子冻结后淡出 |

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
| 关闭 | `cue:off` | 指数淡出（近 τ=0.28、远 τ=0.45，≈2 s 完全不可见），posture 过渡照常（功能性运动不可关） |
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
12. **A12 停止不靠进度**：`flow` 从 +1 置 0 后，`tests/posture-cue.test.ts` 断言位置数组逐帧不变（冻结），且 3 s 内两层不可见。
13. **A13 方向**：`flow=0`（含回躺与 `flow<0`）时整个缓冲区与上一帧完全相同，不存在向下推进。
14. **A14 视角目录与状态机**（`tests/view-motion.test.ts`）：目录 id/编码/时长/曲线/标签齐全；`up`/`down` 相对并在 ±90° 处 clamp；`breathe` 中途达峰、结束回到初值；`recenter` 首帧不等于 0；`stop()` 后两轴冻结且 `preset` 保留，`setTarget` 清空 `preset`，完成/重置回到 `idle` 且 `preset=null`；越界目标与未知 id 整条拒绝。
15. **A15 变换组合**（`tests/world-shell.test.ts`）：`pitch>0` 时前方点下移、眼部点不动；起身各 `t` 下 base 姿态不被 pitch 覆写，且 `shell × base` 把虚拟相机映回真实头部。

实机（PICO + Firefox Reality，记录到 `docs/performance-evidence.md` 的方式）：

13. 起身 30 s 全程无恶心、无“被推走”感；90° 重定向出现不适即延长时长或回退到小角度预设。
14. `posture:stop` 后近场在 ≤1 s 内静止并淡出；回躺无反向流。
15. 粒子不遮挡 HUD 文本，不穿过栈桥与地面，`spread` 拉满时仍不进入背景山体。
16. 帧率与关闭粒子时无差异（HUD p95 不上升）。
17. 患者中途摘戴头显、断链、校准重置后，粒子与姿态都在 1 s 内收口。

## 4. 实施记录

S1/S2/S4 已按下列形态落地（保留切片原文作为历史决策记录，括号内为实现差异）；S3 作废——`view` 通道已改为绝对俯仰，不再有平移、速度或 TTL。

### S1 `src/core/xr/posture-cue.ts`（已实现）

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
  getState(): PostureCueState;             // enabled/flow/intensity/visible/count/depth/spread
  dispose(): void;
}
```

- 双带、种子 PRNG、横向摆动、指数淡出、速度/亮度/尺寸/半径与重生都已收口，保留。
- **实现**：删除了 `setMoving` 与 `progress` 入参。每层各自维护一个 0–1 包络（近 `growTau` 0.5 / `fadeTau` 0.28，远 1.0 / 0.45），亮度 = 包络 × intensity × 层不透明度；`sin^p × skew` 包络随之删除，层间“先近后远、远带 linger”由两条 τ 复现。
- 只有 `flow > 0` 才执行 `stepLayer`（垂直推进 + 摆动）；`flow <= 0` 当帧返回，位置逐帧不变。
- `flow < 0` 按 0 处理（预留给将来的“下降提示”，不反转 y 速度）。
- `applyForm()` 保留联合限幅：`spread × (0.7 + depth × 0.6) × FAR_LAYER.radiusMax ≤ 1.5`。
- `dt = 0` 保留硬复位语义（teardown / 场景切换）。
- 保留：`frustumCulled=false`、`depthWrite=false`、additive、`dt ≤0.05`、vertexColors、`renderOrder` 3/4、圆点 sprite；每层各 1 draw call。

### S2 `src/app/App.ts`（已实现）

- `render` 阶段算 `flow`（`phase` 在 320 ms 刹车期间已经是 `standing`，不能单独用）：

  ```ts
  // App.computeCueFlow(): `phase` alone is 'standing' during the 320 ms brake,
  // so isPostureMoving() gates it and the phase picks the direction.
  const posture = this.comfort;
  const flow = posture && posture.isPostureMoving()
    && posture.getPosturePhase() === 'rising' ? 1 : 0;
  this.postureCueState?.update(dt, this.headPose.position, flow);
  ```

  `isPostureMoving()` 覆盖过渡与刹车两段，停止当帧即为 false，正好触发指数淡出；回躺（`phase='lowering'`）同样得到 0。`getPosturePhase()` 是为此新增的零分配访问器（`getPostureState()` 只给低频快照用）。

- `setControlMode(false)` 现在同时 `viewMotion.stop()` + `comfort.stopPosture()` + `stopSitUp()`（原先只停 view，与规范禁用矩阵不符）。
- 会话结束用 `update(0, head, 0)`（`dt=0` 硬复位；渲染循环即将停止）；场景切换继续 `dispose()`。
- `cue:*` 命令保持离散语义：不设 TTL，不参与 `view:` 通道。
- 把 `enabled` / `intensity` 存在 App 字段里，`loadScene` 重建粒子后重新应用；不写 localStorage（降低动效是会话内设置）。
- `src/app/config.ts` 增加 `motionLow: params.get('motion') === 'low'`，仅在创建粒子时把 intensity 置 0；不新增控制面命令。

### S3 视角俯仰系统（已实现，取代原“平移补齐”切片）

原切片计划给 `view:orient` 的平移补死区与加减速；控制面已改为绝对俯仰，该切片作废，相关常量 `VIEW_MAX_SPEED` / `VIEW_MAX_OFFSET` / `VIEW_TTL_MS` 与整条平移管线一并删除。

实现拆成两半（§1.4）：`ViewMotionController` 持状态与缓动，`WorldShell` 负责组合。要点：

- `setPitch` sink 由 App 注入为 `deg => this.shell?.setPitch(deg)`，所以控制器不 import three，也不认识场景；换场景时 shell 重建、控制器状态原样保留（`loadScene` 里重贴当前角度）。
- 预设与滑动条是两种运动语义：预设是**目录驱动的固定时长一次性**（`VIEW_PRESETS` 里的 `motion` 决定相对/绝对/往返，`curve` 决定 smootherstep 或单周期；零初末速），滑动条是**连续重定向**（0.35 s 时间常数 + 6°/s 上限）。控制器只 switch `motion` 与 `curve`，无逐预设分支。原因见 §1.4。
- 目录项同时带 `VIEW_PRESET_CODES`（0–4）与中英文标签，供平板镜像与状态编码对照。
- `stop()` 立即冻结（`held`）：不缓动、不回正，目标保留，后续 `play`/`view:orient` 从当前角度继续。
- `reset()` 仅由会话结束/校准开始调用，直接归零并回到 `idle`。
- 俯仰符号：正 = 上仰。世界变换为绕眼部的 `R_x(−pitch)`；`tests/world-shell.test.ts` 断言正角度让前方点下降、眼部点不动。
- 组合：shell 在最外层，`comfort` 或起身姿态在其下，`content`（地板）在最内层。起身期间 `shell.setBasePose(worldFor(head, camera))` 写 base 槽位，与 pitch 互不覆写。

### S4 场景状态快照（已实现）

`src/core/scene/snapshot.ts` 的 `SceneSnapshot.capture(input)` 把 `sceneId / loaded / session / calibrating / calibrated / audioMuted / eyeHeight / sitUpT / posturePhase / posturePitch|Roll|Rise|Progress / viewPitch(当前) / viewTarget / viewAnim / viewPreset / floorOffset / cueFlow / cue 参数 / confidence` 收进一个复用对象；App 只填一个复用的 input。WS `telemetry` / `state`、HUD 都从它取数，App 内不再重复推导起身姿态或视角值。

WS `state` 由 `stateFromSnapshot` 输出固定字段：`viewPitch`（当前角度）、`viewAnim`（`idle|playing|held`）、`viewPreset`（`none|up|down|recenter|breathe`）；`viewX`/`viewZ` 不再发送（`tests/scene-snapshot.test.ts` 断言键集合）。

### S5 测试与文档（已实现）

- `tests/posture-cue.test.ts`：双带数量/种子/速度/clamp 保留；新增 flow 门控、停止冻结位置、回躺与 `flow<0` 不推进、断链后淡出与恢复。
- `tests/view-motion.test.ts`：目录映射与编码、`up`/`down` 相对与 clamp、`breathe` 往返回到初值、recenter 不跳变、`preset` 生命周期（playing/held 保留、slide/完成/重置清空）、滑动条重定向与速率上限、越界与未知 id 拒绝。
- `tests/world-shell.test.ts`：pitch 符号与眼部不动点、与起身姿态在多个 `t` 的组合、dispose 解绑。
- `tests/scene-snapshot.test.ts`：快照复用、起身/舒适姿态派生、WS `state` 字段集合。
- `tests/view-command.test.ts`：`view:orient`/`view:anim` 的严格解析与拒绝。
- 不改 posture 数学与 `tests/comfort-posture.test.ts`；`docs/virtual-posture.md` 已删除 FOV 行、更新 PostureCue 接口、移除“回躺反向播放”。
- `docs/README.md` 索引未改（不在本次范围）。

### 不变量

| # | 不变量 |
| --- | --- |
| I1 | 任何代码路径都不写 `camera.position/rotation/quaternion/fov/projectionMatrix`，除非 `!xr.isPresenting` 的 2D 预览 |
| I2 | `PostureCue.object` 的父节点只能是 `scene` 根；不得进入 `world-shell`、`comfort.group` 或 `host.content` |
| I3 | 粒子更新零分配、固定 count、≤2 draw call、dt ≤0.05 |
| I4 | 视角有偏航 ±180° 与俯仰 ±90° 两个通道；无平移、无 roll、无速度加成。姿态仍是 `POSTURE_LIMITS` 的子集 |
| I5 | 停止优先：`view:stop`、`posture:stop`、`cue:off`、患者确认键、租约丢失都在当帧生效；`view:stop` 保持角度，只有 `reset` 归零 |
| I6 | 场景内容永不被头锁；只有 ≤1.5 m 的短时面板可以 head-locked |
| I7 | 三个变换层各有唯一写者；App 不直接写 `world-shell.group`、`comfort.group` 或 `content` |

### Fallback（场景级相机感过于冒险时）

1. **F1 只留世界变换**：`cue` 默认 intensity 0（仍保留命令），posture rise + 地平线独立承担提示；零新代码风险。
2. **F2 降级为静态锚点带**：去掉粒子推进，只在 `Comfort` 过渡期给地平线/栏杆加一层极低对比的高光（不移动），提供参照而不产生光流。
3. **F3 整体移除**：删除 `posture-cue.ts`、`App` 中的创建/更新/命令分支、`tests/posture-cue.test.ts`，并同步删除 `android/protocol` 的 `cue:*` 白名单（同一版本，不做兼容期）。删除比“留着但永久关闭”更干净。

## 5. 禁止清单

1. **不动相机**：不改 XR 相机、`renderer.xr.getCamera()`、reference space offset，不用 `getOffsetReferenceSpace` 伪造位移。
2. **无自由飞行**：不加平移、不加 roll、不做瞬移、不做速度加成。视角朝向只允许经 `view:orient` 一个通道（偏航 ±180°、俯仰 ±90°），且必须走 `ViewMotionController`（不许在 App 或场景里另写缓动）。
3. **不做 FOV/zoom/透视动画**：XR 每帧覆写投影，且属于相机层。
4. **不做相机震动、头部摆动（head bob）、运动模糊、全屏暗角、闪光**。
5. **不做地平线倾斜**：landscape `roll` 恒 0。
6. **不把头锁层当场景**：不新增跟随头部的世界元素（天空盒、粒子场跟随旋转也不行）；头显内没有菜单，也不需要 summoned 面板。
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
7. 视角朝向的耐受度：`up`/`down`（±10°/3 s）、±90° 俯仰与 ±180° 偏航的滑动条拖动是否引起前庭冲突；必要时拉长 `VIEW_PRESETS` 的 `durationMs`、调低 `VIEW_PITCH_MAX_DEG_PER_S` / `VIEW_YAW_MAX_DEG_PER_S`（常量集中在 `core/xr/view-motion.ts`）。
8. `breathe`（+6° 往返 / 6 s）在卧床患者上是否真的带来呼吸节律暗示，还是会与前庭冲突叠加；若不适，缩短为 4.5 s 或把振幅降到 4°（改目录条目即可，不动控制器）。
9. 俯仰绕“眼部”旋转的世界位移在 20° 时约 0.1 m 量级；若患者报告“世界被推开”，改为绕校准 pivot 旋转（数学等价性见 `tests/world-shell.test.ts`，改动只在 shell 的 pivot 选择）。
10. `view:stop` 保持角度后，患者看到的倾斜世界会一直保留到 `view:anim:recenter` 或会话结束；需实机确认护理者能否理解“保持”语义（平板文案已写“停止（保持）”，页面状态为 `viewAnim=held`）。

遗留风险（代码层）：

- 起身表演仍在 `App.ts`（`updateSitUp`/`setVirtualPosture`）而不是独立控制器；本次只把它的变换写入收进 `WorldShell.setBasePose`，状态机仍与 App 字段耦合。
- `SceneSnapshot.capture` 自身零分配，但它调用的 `Comfort.getPostureState()` / `Comfort.getState()` 会分配小对象；只在 1–2 Hz 的快照与 HUD 路径调用，未进入逐帧热路径。
- `up`/`down` 是相对目标，重复按会逐步逼近 ±90°；到达 clamp 后再按是无运动（`idle`/`none`），平板需要据此提示“已达上限”。`recenter` 仍是绝对 0°。
- 播放中的预设若被滑动条打断（`view:orient`），会话从当前角度继续但没有“恢复预设”的语义；平板不应把被打断的预设当作仍在播放（`viewPreset=none`）。
