# 空间 UI 契约

## 1. 目标

校准卡、HUD、场景标签与注视准星不再各自计算 pose/raycast/renderOrder。所有空间面板共享：

- 一个 `SpatialAnchor`（只拥有 transform）
- 一个 `SpatialSurface`（面板/文本/按钮）
- 一个 `SpatialInput`（唯一 raycaster、焦点、dwell、准星）
- 一套 `SpatialTheme`（颜色/字体/圆角/间距）

头显内**没有 WebXR 菜单**：没有菜单面板、没有长按手势、没有 `m` 快捷键。患者界面只剩校准卡、性能 HUD 与场景可注视目标；重新校准、声音、结束训练都由平板操作。确认键只有一个动作——已校准且会话中短按切换起身/回躺。

## 2. 四种模式

| 模式 | 行为 | 适用 | 不适用 |
| --- | --- | --- | --- |
| `summoned` | 召唤时按头部朝向计算一次位置，随后冻结在世界 | “召唤一次、停在原处”的面板（当前无使用者） | 需要持续跟随的提示 |
| `head-locked` | 每帧跟随头部；可阻尼 | 校准卡、HUD、瞬时 toast | 长期常驻、阅读任务 |
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
- 按钮：`SpatialButton`，每个按钮一张 512×128 canvas；焦点/按下/禁用三态。当前只有 `Calibration` 使用 surface，且不添加按钮。
- 所有材质 `depthTest:false`、`depthWrite:false`、`toneMapped:false`；`renderOrder` 递增。
- `dispose()` 释放面板/文本/按钮的 geometry/material/texture。

## 6. `SpatialInput`

`src/ui/spatial/input.ts`：

- 构造时创建唯一 reticle（RingGeometry），以及暗色 dwell 底环与亮色进度弧。
- `register(interactable)`：`layer: 'ui' | 'scene'`；UI 优先，未命中 UI 再命中 scene；返回取消函数。当前唯一的调用者是场景可注视目标（`layer: 'scene'`，`dwellTime = 6`），UI 层没有注册对象。
- `update(dt, now, head)`：
  - 从 head（或 camera）生成 ray；一次 `intersectObjects`；
  - 命中第一个 `enabled` 的 interactable；
  - 焦点变化调用 `onFocus`；
  - `dwellTime > 0` 时推进 `onProgress`，满 1 调用 `onSelect` 并 latch；
  - reticle 跟随命中点并朝向 head；底环 + 进度弧同步显示停留进度，提示 `保持注视 6 秒以选择`。
- `select()`：保留的“立即触发当前焦点项”入口；菜单移除后当前没有调用者（确认键只切起身）。
- `setLayers(ui, scene)`：按会话/控制状态整层开关（校准与 2D 预览会同时关掉两层）。
- `dispose()`：移除 reticle 与弧，释放 geometry/material，取消所有焦点。

**禁止**：每个标签自建 Raycaster；每个面板自建 reticle；在 `update` 里 new 数组/对象。

## 7. 已移除：头显内菜单

早期 `src/ui/xr-menu.ts` 提供的“继续 / 重新校准 / 声音 / 退出训练”面板、`m` 键切换、`Esc` 关闭与长按召唤已全部删除，代码不再引用。原因：3DoF 下用视线+确认键在菜单里做多步选择误触率高，而这些动作本来就是操作员的职责。

替代路径：

| 原来在头显菜单里 | 现在 |
| --- | --- |
| 重新校准 | 平板发 `calibrate` / `recalibrate` |
| 声音开关 | 平板发 `audio:on/off/toggle` |
| 退出训练 | 平板发 `exit` / `stop`，或患者退出 WebXR / 摘下头显 |
| 继续 / 关闭菜单 | 不存在这个概念；确认键只切起身 |

## 8. 舒适性规则

- `head-locked` 只用于短时、低交互内容；默认阻尼 0.08s；禁止长期常驻。
- `summoned` 距离 1.15–1.35m；`y` 夹紧，避免头顶/脚下。
- 面板进场/退场应使用 120–180ms 缩放/透明度；减少动效模式下只做透明度。
- 不使用 full billboard 承载长文本。
- 准星/焦点颜色对比 ≥ 4.5:1；命中区至少 2° 视角。
- 校准卡距离 0.8m；若真机辐辏不适，提高到 1.0m 并减小面板。

## 9. 性能信息栏与场景

- `SpatialHud` 是 head-locked 横条，位于视角上方（distance 1.5 / heightOffset 0.56），只在 2D 预览/XR 中显示。
- 进入场景前勾选“显示性能面板”才显示；校准采集期间自动隐藏，避免遮挡。
- 内容：FPS + 模式/场景/校准/画质/三角形/draw call/声音；用 CanvasTexture 低频率更新。
- `lab` 当前是站立参照场景（`直立光室` / Upright Light Chamber）：地面网格与雾、垂直光柱与顶晕、缓慢上升的远近尘埃、3 个可注视碑体；早期“四模式面板 + 控制台”的实验界面已移除。

## 10. 验收

- 校准卡与 HUD 都通过 `SpatialAnchor`，没有复制 pose 代码；`lab` 不提供面板交互。
- 同一帧只有一个 raycaster；没有 UI 层目标时场景目标仍可命中。
- 场景目标在 6 s 连续注视后触发一次，视线离开立即清零且不重复触发。
- 2D 预览键盘可用；头显确认键不再打开任何面板，只切换起身/回躺。
