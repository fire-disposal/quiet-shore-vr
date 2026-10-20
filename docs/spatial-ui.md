# 空间 UI 契约

## 1. 目标

菜单、校准卡、场景标签、调试面板不再各自计算 pose/raycast/renderOrder。所有空间面板共享：

- 一个 `SpatialAnchor`（只拥有 transform）
- 一个 `SpatialSurface`（面板/文本/按钮）
- 一个 `SpatialInput`（唯一 raycaster、焦点、dwell、准星）
- 一套 `SpatialTheme`（颜色/字体/圆角/间距）

## 2. 四种模式

| 模式 | 行为 | 适用 | 不适用 |
| --- | --- | --- | --- |
| `summoned` | 召唤时按头部朝向计算一次位置，随后冻结在世界 | 菜单、对话框、短任务 | 需要持续跟随的提示 |
| `head-locked` | 每帧跟随头部；可阻尼 | 校准卡、瞬时 toast | 长期常驻、阅读任务 |
| `world-locked` | 固定世界 pose | 场景锚点、固定标签 | 用户移动后需要重新阅读的内容 |
| `world-billboard` | 固定世界位置，绕 Y 轴朝向用户（默认） | 场景热点标签 | 需要保持空间朝向的物体 |

`world-billboard` 默认只做 yaw。full billboard 会产生俯仰/滚转，长文本更难读；只有短标签且明确需要时才用。

## 3. 数学契约

`src/core/spatial/placement.ts`：

- `computeSummonedPose(head, options, out)`：取头部 forward，`y` 夹在 `minPitchDeg..maxPitchDeg`（默认 -12°..28°），位置 = head + direction × distance；面板 +Z 朝向头部。
- `computeHeadLockedPose`：位置 = head + forward × distance；面板朝向头部；阻尼由 anchor 施加。
- `computeWorldBillboardPose`：位置固定；yaw 用 `atan2(head.x - pos.x, head.z - pos.z)`；full 用 `Object3D.lookAt`。
- `dampSpatialPose`：`alpha = 1 - exp(-dt / seconds)`；位置 lerp、四元数 slerp；`seconds <= 0` 直接 snap。
- 所有函数写入调用者提供的 `out`，每帧不分配。

## 4. `SpatialAnchor`

`src/core/spatial/anchor.ts`：

- 只拥有一个 `THREE.Group`，不创建几何。
- `summon(head)`：`summoned` 模式的唯一入口；重复调用重新定位。
- `setWorldPose(pos, quat)`：`world-locked` / `world-billboard` 的固定位置。
- `update(head, dt, now)`：
  - `summoned`：不更新（冻结）。
  - `head-locked`：首次 update 自放置；之后每帧跟随并阻尼（默认 0.08s）。
  - `world-billboard`：位置固定，朝向用户并阻尼（默认 0.12s）。
  - `world-locked`：不更新。
- 可选 `autoHideMs`、`hideDistance`；`setVisible(false)` 立即隐藏。
- `dispose()` 只清空 group，不释放子对象资源（surface 负责）。

## 5. `SpatialSurface`

`src/ui/spatial/surface.ts`：

- 面板背景：CanvasTexture（圆角、边框、阴影），plane 尺寸 = 调用者给的米制宽高。
- 标题/正文：`TextTexture`，512×128 / 512×256，POT，CJK sans，2x 字号；只在文案变化时重绘。
- 按钮：`SpatialButton`，每个按钮一张 512×128 canvas；焦点/按下/禁用三态。
- 所有材质 `depthTest:false`、`depthWrite:false`、`toneMapped:false`；`renderOrder` 递增。
- `dispose()` 释放面板/文本/按钮的 geometry/material/texture。

## 6. `SpatialInput`

`src/ui/spatial/input.ts`：

- 构造时创建唯一 reticle（RingGeometry）。
- `register(interactable)`：`layer: 'ui' | 'scene'`；UI 优先，未命中 UI 再命中 scene；返回取消函数。
- `update(dt, now, head)`：
  - 从 head（或 camera）生成 ray；一次 `intersectObjects`；
  - 命中第一个 `enabled` 的 interactable；
  - 焦点变化调用 `onFocus`；
  - `dwellTime > 0` 时推进 `onProgress`，满 1 调用 `onSelect` 并 latch；
  - reticle 跟随命中点并朝向 head。
- `select()`：确认键；立即触发当前焦点项。
- `setLayers(ui, scene)`：菜单打开时 UI 开、scene 关；关闭恢复。
- `dispose()`：移除 reticle，释放 geometry/material，取消所有焦点。

**禁止**：每个菜单/标签自建 Raycaster；每个面板自建 reticle；在 `update` 里 new 数组/对象。

## 7. 菜单

`src/ui/xr-menu.ts`：

- `SpatialAnchor('summoned', distance 1.25, minPitch -12, maxPitch 28)`。
- `SpatialSurface` 标题 + 四个按钮：继续、重新校准、声音开关、退出训练。
- 打开时 `input.setLayers(true, false)`；关闭恢复。
- 按钮 `dwellTime=0`，用确认键；场景 selectable 用 1.2s dwell。
- 2D 键盘：`m` 切换，`Esc` 关闭，`Enter/Space` 确认。

## 8. 舒适性规则

- `head-locked` 只用于短时、低交互内容；默认阻尼 0.08s；禁止长期常驻。
- `summoned` 距离 1.15–1.35m；`y` 夹紧，避免头顶/脚下。
- 面板进场/退场应使用 120–180ms 缩放/透明度；减少动效模式下只做透明度。
- 不使用 full billboard 承载长文本。
- 准星/焦点颜色对比 ≥ 4.5:1；按钮命中区至少 2° 视角。
- 校准卡距离 0.8m；若真机辐辏不适，提高到 1.0m 并减小面板。

## 9. 验收

- 菜单、校准、lab 四种模式均通过 `SpatialAnchor`，没有复制 pose 代码。
- 同一帧只有一个 raycaster；菜单打开时场景不被重复命中。
- 面板开关 50 次后 geometry/material/texture 计数回到基线。
- 2D 预览键盘可用；XR 确认键可打开/关闭菜单。
