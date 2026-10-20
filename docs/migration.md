# 场景迁移：草稿 → 正式库

## 1. 源与目标

| 草稿 | 新库 | 处理 |
| --- | --- | --- |
| `src/scene/landscape.js` | `src/scenes/landscape/landscape.js` + `index.ts` | 去 IIFE，导出 `createWorld`，包装成 `SceneDefinition`；画质 4.0 |
| `src/scene/ward.js` | `src/scenes/ward/ward.js` + `index.ts` | 同上；画质 2.0 |
| 新增 | `src/scenes/bathroom/bathroom.js` + `index.ts` | 新场景 1.0：暖石浴室，`stream` 水声 |
| 新增 | `src/scenes/lab/lab.js` + `index.ts` | 新场景 1.0：空间实验，四种空间 UI + 控制台 |
| `src/audio/*.mp3` | `src/audio/*.mp3` | 直接复用；`audio.ts` 适配类型 |
| `src/vr/comfort.ts` | `src/core/xr/comfort.ts` | 数学层复用 |
| `src/ui/xr-menu.ts` | `src/ui/xr-menu.ts` | 重写为 `SpatialAnchor/Surface/Input` |
| `src/vr/calibration.ts` | `src/ui/calibration.ts` | 校准逻辑复用，卡片改为 head-locked surface |
| `src/main.ts` | `src/app/App.ts` | 状态机/管线/场景 host 重写 |

## 2. legacy 包装规则

legacy 场景内部仍是命令式 ES5，保持视觉算法不变：

1. 去掉外层 `(function (root) { ... }(window))`，改为 ES module，导出 `createWorld`、`VERSION`。
2. 保留 `createWorld(THREE, opts)` 的返回结构：`{ scene, world, update, selectables, dispose }`。
3. 新 `SceneHandle` 适配器：
   - `root = new THREE.Group()`；把 legacy `scene.children`（world、灯光等）逐个移入 `root`。
   - `settings.background/fog` 从 legacy `scene` 读取。
   - `update` 直接调用 legacy `update`。
   - `dispose` 遍历 `root` 去重释放 geometry/material/texture，清空 `selectables`；**不要**调用 legacy `dispose()`（它遍历 legacy scene，可能误删 host/UI 对象）。
4. `ward.js` 的 `tex.encoding = THREE.sRGBEncoding` 改为 `tex.colorSpace = THREE.SRGBColorSpace`（Three 0.152）。
5. `world.userData.eyeHeight` 保留；floor offset 由 host 统一应用，场景本身不位移。

## 3. 所有权

- 场景拥有 `root` 及其内部所有 geometry/material/texture。
- host 拥有 host scene、background/fog 的恢复、floor offset。
- comfort 拥有包裹 `root` 的 `comfort.group`；场景切换前先 `comfort.reset()`、移除 group，再 `host.unload()`。
- UI 资源（surface/button/input/reticle）不由场景释放。

## 4. 视觉与色彩

- 草稿为 Three r128；新库升到 0.152。颜色管理默认 `SRGBColorSpace`，纹理需显式 `colorSpace`。
- 如果真机对比发现草稿更暗/更亮，优先调整纹理 `colorSpace` 和灯光强度，不要回退 Three 版本。
- 场景预算（代码侧 stats，high / low）：landscape 24 / 43.8k · 21 / 10k；ward 20 / 5.7k · 20 / 4.9k；bathroom 17–18 / 2.7k · 16 / 1.9k。均无阴影贴图、无后处理。

## 5. 验证

- `npm run check`：legacy JS 不参与 `checkJs`，适配器 TS 必须过。
- `npm run build` / `standalone`：bundle 能产出，legacy 模块被打包。
- 桌面 2D 预览：场景可见、场景切换、音频、菜单、四种空间模式 lab。
- 真机（需设备）：WebXR 进入、3DoF 头动、确认键、校准、通知栏入口。
- 场景切换 20 次：registry stats 回到基线，无 WebGL 资源泄漏警告。

## 6. 已知限制

- legacy 场景不拆分为模块化部件；它们被隔离在契约后面，后续可逐步拆 terrain/water/sky 等。
- 草稿的 `gaze-spin` 测试辅助默认启用；新库只在 `?spin=1`+debug 时启用。
- 校准卡仍会隐藏世界并置黑背景；正式版应改为渐进遮罩/暗角，需真机评估。
- 音频以 data URL 打包进 standalone，体积较大；后续改为 APK 内独立资源并用相对 URL。
