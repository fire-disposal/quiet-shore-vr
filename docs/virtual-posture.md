# 远程虚拟体位注入

## 1. 现有链路

```text
头显 pose
  -> Calibration 采集天花板/脚尖两个方向
  -> remapFromPoses 生成校准四元数与 pivot
  -> Comfort.group 变换世界内容
  -> 场景内容随 group 旋转/位移
```

关键点：`Comfort` 变换的是 `world` 容器，不是 XR 相机。相机始终使用真实头显 pose，这对患者安全很重要。

## 2. 注入位置

不要改相机，也不要把偏移写进场景坐标。给 `Comfort` 增加一个**虚拟体位层**：

```ts
interface VirtualPosture {
  pitchDeg: number;
  rollDeg: number;
  riseM: number;
}

interface ComfortApi {
  /** Quintic smootherstep; `durationMs` is clamped to POSTURE_LIMITS. */
  setPosture(target: VirtualPosture, durationMs: number, maxPitchDeg?: number): void;
  updatePosture(dt: number): void;
  /** Brake to rest from the exact current speed; never snaps, never passes the target. */
  stopPosture(): void;
  getPostureState(): PostureState;
  getPosturePhase(): 'neutral' | 'rising' | 'standing' | 'lowering';
  getPostureProgress(): number;
  isPostureMoving(): boolean;
}
```

世界变换组合：

```text
q_total = q_posture * q_calibration
position = pivot - q_total * pivot + (0, -riseM, 0)
```

- `pitchDeg` 让世界围绕视线方向的横向轴缓慢倾斜。
- `riseM` 让世界向下移动，等效患者在虚拟空间里“升高”。
- 旋转与位移都围绕校准得到的 pivot，避免患者被瞬移到场景外。
- 校准开始与会话结束时，体位层回到 neutral（立即重置）。控制断开（租约丢失）**不回 neutral**：`stopPosture()` 刹车到当前行程的稳定点并保持，避免患者在世界倾斜中途被推回。
- 世界变换分三层，各有唯一写者（`src/core/xr/world-shell.ts`）：`world-shell`（视角俯仰，绕眼部）→ `comfort.group`（校准 + 体位，或起身逆变换）→ `host.content`（地板偏移）。场景内容不参与。

符号和轴需要在 PICO 上实测定标；不要凭桌面截图猜正负。

## 3. 控制协议

命令必须白名单化，建议高层语义，不开放任意角度：

| 命令 | 行为 |
| --- | --- |
| `posture:rise` | 缓慢进入站立视角 |
| `posture:lower` | 缓慢回到卧床视角 |
| `posture:stop` | 立即停止插值并保持当前值 |

不要把 `posture:set:<任意角度>` 暴露给操作员。需要调试时走本地查询参数，不进入患者控制通道。

状态扩展（页面 WS `state` → BLE state v5，见 `docs/control-plane.md §2.4`）：

```text
scene / session / calibrating / audio / eyeHeight
posturePitch / postureRoll / postureRise / postureProgress
viewPitch（当前角度）/ viewAnim（idle|playing|held）/ viewPreset（none|up|down|recenter|breathe）
cueEnabled / cueIntensity / calibrationConfidence
```

`postureProgress` 为 0–1，controller 显示进度和停止按钮。

## 4. 控制侧 UX

- 只在控制权已接管、会话进行中、校准完成后启用。
- 使用按住/长按或明确的两段式按钮，不做一次点击瞬间起身。
- 默认时长 10 到 20 秒，最大角速度受限。
- 松开按钮默认是停止，不是自动回躺；回躺需要单独操作。
- 始终显示“虚拟起身视角”而不是“起身”，避免暗示患者真的站起来了。
- 显示患者当前真实状态：卧床、头显佩戴、校准已完成。
- 任何异常断开立即停止插值。

## 5. 安全与体验

- 患者卧床，前庭觉与视觉可能冲突；运动必须慢、可中止、默认不可用。
- 不使用快速俯仰或瞬移。
- 起身过程中保留地平线和地面参照物，避免失去空间定位。
- 首次使用建议从 0.3 到 0.5 的 riseM 和较小 pitch 开始，再逐步增加。
- 不能在未校准、未进入 XR 或患者未佩戴头显时运行。

## 6. 代码落点

| 层 | 文件 | 改动 |
| --- | --- | --- |
| 变换 | `src/core/xr/comfort.ts` | 保存校准 q/pivot，增加 posture 插值和组合 |
| 应用 | `src/app/App.ts` | 每帧调用 `comfort.updatePosture(dt)`；重置时机 |
| 协议 | `android/protocol` | 增加 posture 命令与 state 字段 |
| 头显 | `BluetoothControl` / `PortalService` | 转发高层命令 |
| Web | `App.handleRemoteCommand` | 调用 comfort API，不直接改相机 |
| 平板 | `ControlRail` | 按住/停止/回躺，显示进度 |
| 测试 | `tests/comfort` | 组合顺序、easing、reset、校准后取消 |

## 7. 当前状态

Posture 变换、限幅、缓动和停止减速已实现；近场重力粒子（`src/core/xr/posture-cue.ts`）先只安装在 `landscape` 场景，作为体验验证。控制柄已预留：

- 代码：`window.__app.postureCue`（`setEnabled` / `setIntensity` / `update` / `getState`）。
- BLE：`cue:on`、`cue:off`、`cue:intensity:<0..1>`。

视角俯仰已改由系统级控制器承担（`src/core/xr/view-motion.ts` + `src/core/xr/world-shell.ts`）：

- `view:move:0,<z>`：绝对目标（`z × 20°`），从当前角度平滑重定向，无 TTL。
- `view:anim:<id>`：目录预设 `up`/`down`（相对 ±10°，clamp ±20°，3.0 s）、`recenter`（绝对 0°，2.4 s）、`breathe`（当前 → +6° → 当前，6.0 s 往返）。
- `view:stop`：立即保持当前角度（不回正）；校准开始与会话结束归零。
- WS `state` 回报当前 `viewPitch`（度）、`viewAnim`（`idle|playing|held`）与 `viewPreset`（`none|up|down|recenter|breathe`）。

仍需在 PICO 上确认：

1. 粒子密度、亮度和下方流速是否造成眩晕。
2. riseM 与场景地面的视觉比例。
3. 10 到 20 秒速度下的眩晕反馈。
4. 校准 pivot 与站立偏移组合后是否出现边缘穿帮。
5. 粒子是否只在 `landscape` 保留，或推广到 `ward`；推广前先保持单一场景对照。


## 8. 视觉方向错觉与失重感

不要用快速相机位移制造“站起来”。采用**光流 + 视差 + 地平线**的视觉前庭暗示：

| 线索 | 做法 | 目的 |
| --- | --- | --- |
| 近场光流 | 20-40 个低透明度尘埃/叶片粒子，围绕头部缓慢向下漂 | 让身体感觉在上升 |
| 世界下沉 | `Comfort` 的 riseM 让地面参照缓慢下移 | 产生站立高度变化 |
| 轻微俯仰 | 世界 pitch 缓慢增加，中心焦点保持稳定 | 从卧床视角过渡到直立视角 |
| 视差 | 近处粒子/芦苇移动快，远处山脊几乎不动 | 强化深度和上升感 |
| 地面参照 | 保留地面线、床边或栈桥边缘，不要全部消失 | 防止失去空间定位 |
| 声音 | 很轻的风声/水声上扬，不做强烈音效 | 辅助方向感 |

不建议：

- 快速俯仰、突然抬高、镜头抖动。
- 中心视野剧烈流动或旋转。
- 全屏暗角、闪光、强 FOV 变化。
- 用“失重”暗示患者真的离开床面。
- 在患者未校准、未进入 XR 或未佩戴头显时运行。

### 视觉引导层

`PostureCue` 是应用级模块，当前只挂到 `landscape` 场景验证；实际接口（`src/core/xr/posture-cue.ts`）：

```ts
interface PostureCueApi {
  readonly object: THREE.Points;            // 近层
  readonly layers: readonly THREE.Points[]; // [近层, 远层]
  setEnabled(enabled: boolean): void;
  setIntensity(intensity: number): void;    // 0..1
  setDepth(depth: number): void;            // 0..1，默认 0.5
  setSpread(spread: number): void;          // 0.5..2
  update(dt: number, head: THREE.Vector3, flow: number): void;
  getState(): PostureCueState;              // enabled/flow/intensity/visible/count/depth/spread
  dispose(): void;
}
```

- `flow = +1` 只在**起身过渡真实移动**时由 App 传入；停止、回躺、校准、断链一律 0。`flow <= 0` 当帧冻结粒子位置（不推进、不摆动），亮度按既有 τ 淡出；不存在反向播放。
- 粒子使用两个 `Points`（近 17 / 远 11），总量固定、种子确定性布局、每帧零分配，每层 1 draw call。
- 粒子挂在 `scene` 根节点并跟随头部位置，不受世界 shell（视角俯仰 / 校准 / 起身）与地板偏移影响。
- 不修改患者真实 head pose，只改变视觉流和世界变换。
- 起身完成、停止或断链后粒子淡出，保留稳定的世界视角；不会为“回躺”再播放一次。
- 控制侧提供“视觉引导”开关，默认开启但可关闭（`cue:on` / `cue:off` / `cue:intensity:<0..1>`），尚未加入平板 UI。

### 安全节奏

建议分三段：

1. 0-20%：确认阶段，几乎不动，只淡入视觉提示。
2. 20-80%：主过渡，10-20 秒，缓慢 pitch + riseM + 向下粒子流。
3. 80-100%：稳定阶段，粒子淡出，保留轻微悬浮感。

任何断开、停止、校准重置都立即中止并保持当前姿态，不自动回弹。
