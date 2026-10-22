# 校准帧与虚拟体位

本文描述患者端世界变换的当前实现：一步校准得到的中立（站立）帧、`Comfort` 的当前数学，以及校准成功后接管世界底座的 6 s 起身/回躺路径。协议字段以 `control-plane.md` 与 `control-interaction-spec.md` 为准。

## 1. 当前链路

```text
头显 pose（一帧）
  -> Calibration 采集“看向正前方 + 保持静止”
  -> Comfort.calibrate(pose) 把这一帧设为中立帧
  -> onCalibrationResult 以仰卧为起点创建 SitUpPath，sitUpMode/sitUpReady = true
  -> WorldShell.setBasePose(worldFor(head, path.at(t))) 接管 comfort.group 所在槽位
  -> 场景内容随底座旋转/位移；短按确认键在 t=0 与 t=1 之间切换
```

关键点：`Comfort` 变换的是 `world` 容器，不是 XR 相机。相机始终使用真实头显 pose，这对患者安全很重要。

一步校准的判据（`src/ui/calibration.ts`）：视线方向偏离 6° 以内累计 1.2 s → 2 s 倒计时 → 落一帧，调用 `comfort.calibrate(pose)` 并置 `mode = 'single'`、`calibrated = true`。患者在头显里看到的是头锁校准卡（0.8 m、标题“看向正前方，保持舒适”）与一条进度条；采集期间场景隐藏。校准成功后页面立刻进入起身模式并停在仰卧起点（`t = 0`），等患者按键。

为什么只有一步：PICO G2 4K 是 3DoF，位置分量不随头动变化。第二次采样（旧方案的“脚尖”）既难在卧床姿态下做到，两次采样的 `pivot` 距离又会远小于阈值，夹角也不可靠——两点基座在 3DoF 上不可辨识。一次性把患者当下的舒适朝向认作站立参考系，是唯一稳定且可复现的定义。

## 2. 当前数学

```text
q_total  = q_posture * q_calibration      （posture 在左，因为它在校准帧内表达）
position = aroundPivot(q_total, p0) - (0, riseM, 0)

起身期间：
base = worldFor(head, camera)             （SitUpPath 逆变换，不再走上面的 comfort 组合）
```

- `q_calibration`：`q0`，即校准那一帧的头显朝向；`p0` 是同一帧的位置。当前没有第二次采样，`p0` 就是患者头部当时的位置，世界绕这一点旋转——患者不会被瞬移出场景。
- `q_posture`：体位层（`worldPitchDeg` / `worldRollDeg`）。患者流程只在**校准开始**时把它归 neutral；起身由 `SitUpPath` 的逆变换承担，不经过体位层。
- `riseM`：世界向下移动的米数，等效患者“升高”。
- 校准开始与会话结束时底座回到 neutral / comfort 帧；控制断开（租约丢失）**不回 neutral**：`posture:stop` 把起身冻结在当前进度，避免患者在世界倾斜中途被推回。
- 世界变换分三层，各有唯一写者（`src/core/xr/world-shell.ts`）：`world-shell`（视角俯仰，绕眼部）→ `comfort.group`（校准 + 体位，或起身逆变换，二选一）→ `host.content`（地板偏移）。场景内容不参与。
- 平板 state 的 `posturePitch` / `postureRoll` 是**相对校准帧**测得的世界倾角：起身到位约 +90°/0°，`postureRise` 是当前起身高度。

### 2.1 体位层 API（保留；患者流程只在校准开始时归 neutral）

```ts
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

限幅、缓动（quintic smootherstep，峰值 1.875× 平均）、刹车到静止都已实现并有测试。完整的 90° 起身不走这一层，而是 `SitUpPath` 的逆变换；体位层用于小角度微调与归位。符号和轴仍需在 PICO 上实测定标；不要凭桌面截图猜正负。

## 3. 控制协议

| 命令 | 行为 |
| --- | --- |
| `posture:rise` | 缓慢进入站立视角（播放头推向 1） |
| `posture:lower` | 缓慢回到卧床视角（播放头推向 0） |
| `posture:stop` | 立即停止插值并保持当前值（不回弹） |

- 平板“视角”页签的 `缓慢起身` / `回躺` / `停止并保持` 与患者短按确认键等价（头显内没有菜单，确认键只有这一个动作）。平板的门控是已连接 + 已取得租约 + 会话中 + 未在校准中 + `calibrationConfidence > 0`。
- 不要把 `posture:set:<任意角度>` 暴露给操作员。需要调试时走本地查询参数，不进入患者控制通道。
- 头显在每次租约丢失时入队一条 `posture:stop`；`stop` 冻结在当前进度。
- 状态字段（页面 WS `state` → BLE state v8，见 `control-plane.md §2.4`）包含 `posturePitch / postureRoll / postureRise / postureProgress`，平板 StatusPanel 显示姿态进度、起身高度与姿态俯仰。

## 4. 历史：两姿态校准与 pivot 重映射

早期方案要求患者先看天花板、再看脚尖，用两次采样构造“上/前”基座，`remapFromPoses` 输出四元数与 pivot，再按门限混合：

- 夹角 <15° 或 >165°、或 pivot 间距 <0.005 m → `poses-too-similar`；
- `confidence = sin(angle) < 0.35` → `low-confidence`；
- 通过后按 `weight = clamp(strength × confidence, 0, 0.85)` 向 identity 混合，并用 `appliedWeight = min(weight, 120° / rawAngle)` 封顶。

这套代码（`calibrateTwo` / `remapFromPoses` / `REMAP_LIMITS`）仍在仓库里，只对显式调试调用有效；3DoF 上头显位置不变，痛点（第二步不可达、pivot 不可辨识）无法通过调参解决，因此已从患者流程移除。平板上的 `calibrationConfidence` 现在只有 1（成功）与 0（未校准）两种取值。

## 5. 起身过渡与视觉引导

起身/回躺是 6 s 的过渡，旋转为主、粒子流补失重感。**患者本体不动，世界动**：`SitUpPath` 让世界相对头部反向运动，视觉上从卧床过渡到站立高度。

| 线索 | 做法 | 目的 |
| --- | --- | --- |
| 近场光流 | 20-40 个低透明度尘埃/叶片粒子，围绕头部缓慢向下漂 | 让身体感觉在上升 |
| 世界下沉 | 逆变换让地面参照缓慢下移 | 产生站立高度变化 |
| 轻微俯仰 | 世界 pitch 缓慢增加，中心焦点保持稳定 | 从卧床视角过渡到直立视角 |
| 视差 | 近处粒子/芦苇移动快，远处山脊几乎不动 | 强化深度和上升感 |
| 地面参照 | 保留地面线、床边或栈桥边缘，不要全部消失 | 防止失去空间定位 |
| 声音 | 很轻的风声/水声上扬，不做强烈音效 | 辅助方向感 |

不建议：快速俯仰、突然抬高、镜头抖动；中心视野剧烈流动或旋转；全屏暗角/闪光/强 FOV 变化；用“失重”暗示患者真的离开床面；在患者未校准、未进入 XR 或未佩戴头显时运行。

节奏建议（重新调参时的基线）：0–20% 确认阶段几乎不动，只淡入提示；20–80% 主过渡；80–100% 粒子淡出、保留稳定视角。任何断开、停止、校准重置都立即中止并保持当前姿态，不自动回弹。

## 6. 近场粒子层（`PostureCue`）

`PostureCue` 是应用级模块（`src/core/xr/posture-cue.ts`），在四个场景共用，挂在 `scene` 根节点并跟随头部位置，不受世界 shell 与地板偏移影响：

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

- `flow` 只在**起身过渡真实移动**时由 App 传入 +1；停止、回躺、校准、断链一律 0。`flow <= 0` 当帧冻结粒子位置（不推进、不摆动），亮度按既有 τ 淡出（近 0.28 s / 远 0.45 s）；不存在反向播放。
- 两个 `Points`（近 17 / 远 11），总量固定、种子确定性布局、每帧零分配，每层 1 draw call。
- 控制柄：`window.__app.postureCue`（`setEnabled` / `setIntensity` / `update` / `getState`）与 BLE `cue:on`、`cue:off`、`cue:intensity:<0..1>`；平板 UI 不提供开关。

## 7. 代码落点

| 层 | 文件 | 当前行为 |
| --- | --- | --- |
| 变换 | `src/core/xr/comfort.ts` | 保存校准帧 `q0`/`p0`，`calibrate(pose)` 单帧生效；posture 插值与组合仍在 |
| 校准 UI | `src/ui/calibration.ts` | 6° / 1.2 s / 2 s 倒计时；头锁校准卡与进度条；失败不覆盖旧校准 |
| 起身 | `src/core/xr/situp-path.ts`、`situp-run.ts`、`App.setVirtualPosture/applySitUpTransform` | 校准成功后以仰卧为起点创建路径；6 s 播放头；停止/失权冻结 |
| 应用 | `src/app/App.ts` | 每帧推进起身与体位；校准开始归 neutral；租约丢失停止过渡；确认键短按切换起身/回躺 |
| 视觉引导 | `src/core/xr/posture-cue.ts` | 应用级粒子层；`flow` 门控 |
| 协议 | `android/protocol` | `posture:rise/lower/stop` 在白名单 |
| 平板 | `ControlRail.kt`、`StatusPanel.kt`、`ControlViewModel.kt` | 虚拟起身区块与姿态进度/起身高度/姿态俯仰读数 |

## 8. 仍需在 PICO 上确认

1. 一步校准在真实床旁的可复现性：患者能否在 1.2 s 内稳定到 6° 以内，场景是否读作“直立”。
2. 校准成功后从仰卧起点开始的观感：确认键短按起身是否自然，平板按钮与患者按键是否一致。
3. 起身 90°、6 s（旋转段 4.2 s，峰值 ≈40 °/s）的耐受；若嫌“太温和”或反胃，调 `SITUP_DURATION_MS`。
4. 粒子密度、亮度与下方流速是否造成眩晕；`CUE_IDLE_FLOW` / `CUE_FULL_DEG_PER_S` 按观感调。
5. 站立参照场景（`lab` / 直立光室）在地面网格、光柱与缓慢尘埃下的眩晕反馈。
