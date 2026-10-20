# 几何与变换契约

## 1. 坐标与单位

- 单位：米；Y 向上；-Z 为前；右手系。
- 世界原点：场景地面中心；站立眼高默认 1.6m。
- API 边界用角度（度），内部用弧度；四元数顺序 `x,y,z,w`。
- Euler 使用 `YXZ`；需要精确朝向时优先四元数。

## 2. `TransformSpec`

`src/core/geometry/types.ts`：

```ts
interface TransformSpec {
  position?: [number, number, number];
  rotationDeg?: [number, number, number]; // YXZ
  quaternion?: [number, number, number, number];
  scale?: [number, number, number] | number;
  order?: number;
}
```

规则：

- `quaternion` 优先于 `rotationDeg`。
- `order` 只影响同一父节点下的应用顺序；父先于子。
- 不得在每帧构造新 `Euler`/`Vector3`/`Quaternion`；`applyTransform` 使用模块级临时对象。
- 变换组件不隐式改变材质/几何；只写 `position/quaternion/scale`。

## 3. 帧管线

`src/core/geometry/pipeline.ts`：

```
input → simulation → animation → layout → render
```

- 每个任务有 `id`、`phase`、`order`、`run(dt, now)`。
- 同 phase 先按 `order`，再按插入顺序稳定排序。
- `add` 返回取消函数；排序只在 dirty 时发生。
- 每帧不分配数组；任务列表复用。
- 空间 UI 的 raycast 放在 `render` phase 的 order 0，确保在 layout 之后、实际渲染之前。
- 渲染任务放 `render` phase 的 order 10。

## 4. 资源注册表

`src/core/geometry/registry.ts`：

- `ResourceRegistry` 对 geometry/material/texture 按 key 做引用计数。
- `acquire*` 返回 `{ value, release }`；归零时 `dispose()` 并删除。
- 相同 key 的重复 acquire 返回同一实例；release 必须成对。
- `disposeAll()` 用于应用退出/测试清理。
- `stats()` 返回当前 geometry/material/texture 数量。

规则：

- 共享资源必须走 registry；场景私有资源可以在 `SceneHandle.dispose()` 里直接释放。
- 禁止在每帧 acquire/release；只在 build/unmount 时做。
- 纹理 key 要包含尺寸/编码/源，避免不同用途误共享。

## 5. 场景预算

`src/core/geometry/budget.ts`：

- `measureObject(root)`：遍历可见 mesh，统计 draw call、三角形、去重 geometry/material/texture。
- `SceneBudget`：`drawCalls`、`triangles`、`geometries`、`materials`、`textures` 上限；`check(stats)` 返回违规列表。
- 预算检查在开发/CI 可用；生产不阻断渲染，只记录。

现有基线（实测）：landscape 约 24 draw call / 44k 三角形（`?quality=low` 约 21 / 10k）。新场景不得无理由超过；超预算需在 PR 说明。

## 6. 场景生命周期

`src/core/scene/contract.ts`：

```ts
interface SceneDefinition {
  id: string;
  name: LocalizedText;
  tagline: LocalizedText;
  description: LocalizedText;
  audio: AudioTrack;
  build(ctx: SceneBuildContext): SceneHandle;
}

interface SceneHandle {
  root: THREE.Object3D;
  selectables: THREE.Object3D[];
  settings: SceneSettings;
  update(dt, elapsed): void;
  dispose(): void;
  budget?: SceneBudget;
}
```

- `root` 只包含本场景拥有的对象；**不是** host scene。
- `settings.background/fog` 由 host 应用到 host scene；卸载时恢复。
- `dispose()` 只释放本场景资源；不得遍历 host scene 或 UI。
- 场景不得修改 `root.position.y` 来适配 XR；floor offset 由 `SceneHost.setFloorOffset()` 统一应用（XR `-eyeHeight`，2D `0`）。
- 场景切换：`SceneHost.load` 先构建新 handle，成功后再替换旧 handle；构建失败保留旧场景。

## 7. 释放规则

`src/core/geometry/dispose.ts`：

- `disposeObject3D(root)` 去重释放 geometry/material/texture；幂等。
- 处理 material 数组；释放 `map/alphaMap/normalMap/roughnessMap/metalnessMap/emissiveMap` 等常见槽。
- 不释放 `root` 之外的资源；不调用 `scene.dispose()`（不存在）。
- 释放后清空 `selectables`/事件引用；避免闭包持有旧对象。

## 8. 顺序与所有权矩阵

| 对象 | 拥有者 | 释放者 | 顺序 |
| --- | --- | --- | --- |
| host `THREE.Scene` | App | App | 最后 |
| `SceneHandle.root` | Scene | Scene | 先于 host scene |
| 场景 geometry/material/texture | Scene 或 Registry | Scene/Registry | 子先父后 |
| `SpatialAnchor.object` | UI | UI | 先于 scene |
| `SpatialSurface` 资源 | Surface | Surface | 先于 anchor |
| `SpatialInput` reticle | Input | Input | 先于 scene |
| 音频 buffer/context | Audio | Audio | 应用退出 |

## 9. 验收

- `FramePipeline` 顺序/取消/稳定排序有测试。
- `ResourceRegistry` 引用计数/重复 key/disposeAll 有测试。
- `SceneHost` 构建失败保留旧场景、卸载恢复 background/fog、floor offset 有测试。
- `disposeObject3D` 对共享材质/纹理幂等。
- 场景切换 20 次后 registry stats 回到基线（手动或自动化）。
