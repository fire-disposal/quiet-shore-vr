# 性能证据：自研 Three 核心 vs R3F / Drei

目标不是证明“手写一定更快”，而是回答一个具体问题：**R3F/Drei 的便捷封装是否带来了可测量的性能收益，足以抵消运行时与兼容成本？**

结论：在这组同几何、同分辨率的合成基准里，**没有**。R3F/Drei 没有减少 draw call 或三角形；它们增加了 bundle、挂载时间和 React 堆内存。我们自己的 `InstancedMesh` 与 Drei `Instances` 在 GPU 侧等价（都是 1 draw call / 60k 三角形）。

## 1. 方法

- 主机：Linux x64，omptest 管理的 headless Chromium；**不是** PICO G2 4K / Gecko 78 / Adreno 540。
- 分辨率 640×480，`antialias:false`、`dpr=1`、无阴影、无后处理、`MeshBasicMaterial`。
- 两个场景：
  1. **1000 个独立 Mesh**：共享 `BoxGeometry`/`MeshBasicMaterial`，1000 draw call，12k 三角形。
  2. **5000 个实例**：共享几何/材质，1 draw call，60k 三角形。
- 测点：
  - `mountMs`：从页面脚本开始到 React/Three 完成首次渲染（R3F 包含 React commit；Drei 包含 5000 个 `<Instance>` 组件 commit）。
  - `frameMs`：预热 5 帧后连续 120 次 `renderer.render` / `gl.render` 的平均值。
  - `drawCalls` / `triangles`：`renderer.info.render`。
  - `heapMB`：`performance.memory.usedJSHeapSize`（Chromium 近似值）。
- 源码与可复现构建在 `bench/`；每页把结果写到 `window.__bench`。

```bash
cd bench
npm install --legacy-peer-deps --omit=optional
npm run build
cd dist && python3 -m http.server 8131
# 打开 vanilla-mesh.html / vanilla-inst.html / r3f.html / drei.html
```

Drei 只从 `@react-three/drei/core/Instances` 直接导入，避免 barrel 把无关模块带进 bundle；`frameloop="always"` + `frames={1}` 让实例矩阵真正被填充后再测量。

## 2. 结果

| case | count | bundle | mount | frame | draw calls | triangles | heap |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| vanilla mesh | 1000 | 427.7 KB | 59.8 ms | 14.21 ms | 1000 | 12,000 | 5.67 MB |
| R3F mesh | 1000 | 884.5 KB | 288.0 ms | 23.35 ms | 1000 | 12,000 | 7.36 MB |
| vanilla instanced | 5000 | 430.0 KB | 234.7 ms | 0.077 ms | 1 | 60,000 | 5.28 MB |
| Drei `Instances` | 5000 | 889.1 KB | 370.8 ms | 1.26 ms | 1 | 60,000 | 28.39 MB |

比率（同一 case 对比）：

| 指标 | R3F / vanilla mesh | Drei / vanilla instanced |
| --- | ---: | ---: |
| bundle | 2.07× | 2.07× |
| mount | 4.82× | 1.58× |
| heap | 1.30× | 5.38× |
| draw calls / triangles | 1.00× | 1.00× |

## 3. 解读

1. **渲染成本由场景图决定，不由封装决定。** 1000 个独立 Mesh 在两种实现里都是 1000 draw call；5000 个实例都是 1 draw call。R3F/Drei 不会自动合并你的几何，Drei 的便利只在它提供的 `Instances` 等组件里；我们直接写 `InstancedMesh` 得到同样的 GPU 结果。
2. **挂载成本是 React 的成本。** 1000 个 `<mesh>` 的 commit 让 R3F 挂载约为 vanilla 的 4.8×；5000 个 `<Instance>` 让 Drei 挂载约为 vanilla 的 1.6×，堆内存约为 5.4×。
3. **bundle 约 2×。** React + R3F + Three 的最小组合已经 884 KB（minified），vanilla + Three 427 KB。Drei 直接导入 Instances 只增加约 4.6 KB，但 React/R3F 的底座已经在。
4. **帧时间不是“R3F 更快”。** 这组数据里 R3F mesh 反而更慢；Drei 实例帧时间高于 vanilla 实例。差异可能来自 R3F 的 renderer/场景状态、headless GPU 波动与测量方式，不能据此断言“R3F 一定慢 16 倍”；但可以确定：**没有看到 R3F/Drei 带来的帧时间收益**。
5. **我们的优势来自“少一层运行时 + 直接使用实例化/合批”，不是手写 API 本身。** 如果我们的场景用了 1000 个独立 Mesh，同样会被 draw call 拖慢；所以正式代码坚持 `InstancedMesh`、合批、共享材质与明确的资源预算。

## 4. 不能从这组数据推出的结论

- 不能外推到 PICO G2 4K：Adreno 540、Gecko 78、3DoF 双目渲染、热降频都未测。
- 不能证明我们的空间 UI 比 Drei `<Html>`/`<Billboard>` 更快；那是 DOM/文本/布局的不同实现，需另做 UI 专项基准。
- 不能证明 R3F 在开发者体验、复杂状态管理上没有价值；它在这些维度仍可能更优。
- Drei 的 `Instances` 基准使用 `frameloop="always"` 填充实例；如果产品使用 `frameloop="never"` + 手动 `advance`，挂载/帧数据会不同。

## 5. 对正式库的决策

- 生产内容层保持纯 Three.js；不引入 React/R3F/Drei。
- 场景必须显式实例化/合批；预算由 `measureObject`/`SceneBudget` 守住。
- 空间 UI 使用 `SpatialAnchor`/`SpatialSurface`/`SpatialInput` 的轻量对象，不引入 reconciler。
- 如果未来团队/组件规模显著增长，再按 `docs/tech-selection.md` 的门槛重新评估 R3F；届时用本基准的同一场景、同一设备复测，而不是只看“能跑”。
