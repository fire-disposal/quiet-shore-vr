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

interface PostureOptions {
  durationMs: number;
  easing?: 'linear' | 'ease-in-out';
}

interface ComfortApi {
  setPosture(target: VirtualPosture, options: PostureOptions): void;
  updatePosture(dt: number): VirtualPosture;
  stopPosture(): void;
  getPostureState(): PostureState;
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
- 校准重置、会话结束、控制断开时，体位层必须回到 neutral。

符号和轴需要在 PICO 上实测定标；不要凭桌面截图猜正负。

## 3. 控制协议

命令必须白名单化，建议高层语义，不开放任意角度：

| 命令 | 行为 |
| --- | --- |
| `posture:rise` | 缓慢进入站立视角 |
| `posture:lower` | 缓慢回到卧床视角 |
| `posture:stop` | 立即停止插值并保持当前值 |

不要把 `posture:set:<任意角度>` 暴露给操作员。需要调试时走本地查询参数，不进入患者控制通道。

状态扩展：

```text
scene|session|calib|audio|posture
```

`posture` 取值 `neutral / rising / standing / lowering`，controller 显示进度和停止按钮。

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

本文是设计裁定，尚未实现。实现前需要先在 PICO 上确认：

1. 正交/俯仰符号与坐卧基准。
2. riseM 与场景地面的视觉比例。
3. 10 到 20 秒速度下的眩晕反馈。
4. 校准 pivot 与站立偏移组合后是否出现边缘穿帮。


## 8. 视觉方向错觉与失重感

不要用快速相机位移制造“站起来”。采用**光流 + 视差 + 地平线**的视觉前庭暗示：

| 线索 | 做法 | 目的 |
| --- | --- | --- |
| 近场光流 | 20-40 个低透明度尘埃/叶片粒子，围绕头部缓慢向下漂 | 让身体感觉在上升 |
| 世界下沉 | `Comfort` 的 riseM 让地面参照缓慢下移 | 产生站立高度变化 |
| 轻微俯仰 | 世界 pitch 缓慢增加，中心焦点保持稳定 | 从卧床视角过渡到直立视角 |
| 视差 | 近处粒子/芦苇移动快，远处山脊几乎不动 | 强化深度和上升感 |
| 地面参照 | 保留地面线、床边或栈桥边缘，不要全部消失 | 防止失去空间定位 |
| 轻微视野扩张 | FOV 只在 1-2 度内变化，且与进度同步 | 产生“空间打开”的感觉 |
| 声音 | 很轻的风声/水声上扬，不做强烈音效 | 辅助方向感 |

不建议：

- 快速俯仰、突然抬高、镜头抖动。
- 中心视野剧烈流动或旋转。
- 全屏暗角、闪光、强 FOV 变化。
- 用“失重”暗示患者真的离开床面。
- 在患者未校准、未进入 XR 或未佩戴头显时运行。

### 视觉引导层

建议新增一个应用级 `PostureCue`，不属于任何具体场景：

```ts
interface PostureCue {
  update(progress: number, dt: number): void;
  setVisible(visible: boolean): void;
  dispose(): void;
}
```

- 粒子使用 `InstancedMesh` 或 `Points`，总量固定，避免每帧分配。
- 粒子附着在头部参考系附近，透明度随 `progress` 淡入淡出。
- 不修改患者真实 head pose，只改变视觉流和世界变换。
- 起身完成后粒子淡出，保留稳定的站立视角；回躺时反向播放。
- 控制侧提供“视觉引导”开关，默认开启但可关闭。

### 安全节奏

建议分三段：

1. 0-20%：确认阶段，几乎不动，只淡入视觉提示。
2. 20-80%：主过渡，10-20 秒，缓慢 pitch + riseM + 向下粒子流。
3. 80-100%：稳定阶段，粒子淡出，保留轻微悬浮感。

任何断开、停止、校准重置都立即中止并保持当前姿态，不自动回弹。
