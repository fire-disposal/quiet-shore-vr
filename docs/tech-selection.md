# 技术选型：R3F / Drei 与 Three.js 核心

## 1. 约束

- 设备：PICO G2 4K，Snapdragon 835 / Adreno 540，4 GB，Android 8.1。
- 唯一已验证的 WebXR 入口：Firefox Reality 10（Gecko 78，`immersive-vr=true`）。
- 系统 WebVR 浏览器：Chromium 67，只有 WebVR 1.1，无 WebXR；WebView 74 无 XR。
- 3DoF 头显 + 3DoF 手柄，无位置追踪；无 root。
- 现有场景预算（代码侧 stats，high / low）：landscape 24 / 43.8k · 21 / 10k，ward 20 / 5.7k · 20 / 4.9k，bathroom 17–18 / 2.7k · 16 / 1.9k；均无阴影贴图、无后处理。
- APK 在 GitHub Actions 构建；发布入口是通知栏/快捷磁贴 → 本地 HTTP → Firefox Reality。
- 内容层必须能在未来换成内嵌 WebXR 或原生渲染器时不重写空间/场景契约。

## 2. 候选

| 方案 | 组合 | 优点 | 风险 |
| --- | --- | --- | --- |
| A. 纯 Three.js + TS（草稿路线） | three 0.152 + esbuild | 已验证、包体小、老浏览器可控、场景迁移直接 | 组合/UI 需自己抽象 |
| B. R3F 8 + React 18 | fiber 8.18 + react 18.3 + three 0.152 | 声明式场景/UI、组件复用、状态驱动 | React/reconciler 运行时；老浏览器 API；XR 循环需自定义桥接；与原生迁移不通用 |
| C. R3F 8 + Drei 9 | B + drei 9.122 | Billboard/Html/Text 等现成组件 | Drei 依赖面大；Text/Html 重；老 GPU/Gecko 风险；四种空间模式仍需自写 |
| D. R3F 9 + React 19 | fiber 9 + react 19 | 新 API | React 19 与 Gecko 78 兼容风险最高；不适合当前硬件 |

## 3. R3F 能简化什么，不能简化什么

### 能简化

- 场景图的声明式组合：`<mesh>`, `<group>`, hooks，比手工 `scene.add` 易读。
- UI 状态与 React 状态同步：菜单开关、选中项、禁用态。
- 组件复用：按钮、面板、列表。
- 生态：Drei 的 `Billboard`、`Html`、`Text`、`useTexture` 等减少样板代码。

### 不能简化

- **渲染优化**：R3F 不改变 draw call、三角形、材质、纹理带宽；场景预算仍要靠几何合并、instancing、shader、LOD。
- **WebXR 会话**：Gecko 78 的 `xrCompatible` 上下文、`setSession`、`local` reference space、退出 26s 问题，仍要自定义。
- **3DoF 姿态与舒适性**：头锁定阻尼、召唤位姿、yaw clamp、recenter、校准，仍是自定义数学。
- **四种空间模式**：Drei 只有 `Billboard` 的一部分；`summoned`、`world-locked`、`head-locked` 的契约仍要自己设计。
- **输入统一**：R3F 的事件系统在 XR 下需要额外适配；3DoF 头 gaze + 确认键仍要自定义 raycaster/dwell。
- **老浏览器兼容**：React 18/R3F 8 的运行时 API、包体、启动解析成本需要额外 polyfill/验证。

## 4. 兼容性事实

- R3F 8.x 的 peer 范围是 `react >=18 <19`、`three >=0.133`；R3F 9 要求 React 19。要留在 React 18，只能选 R3F 8。
- Drei 9.122 的依赖包含 `three-stdlib`、`troika-three-text`、`stats-gl`、`detect-gpu`、`camera-controls`、`@mediapipe/tasks-vision`、`hls.js` 等；即使 tree-shaking 能删掉未用模块，安装面、类型面和升级风险仍然很大。
- Drei 的 `Text` 依赖 troika-three-text，涉及 worker/字体解析；在 Adreno 540 + Gecko 78 上需要实机验证，不能假定可用。
- R3F 的 `Canvas` 默认用 `requestAnimationFrame` 驱动；WebXR 需要 `renderer.setAnimationLoop` 与 XR frame 对齐。要么用 `@react-three/xr`（额外依赖、版本约束），要么自己把 `frameloop` 设为 `never` 并从 XR loop 调 `advance`。这是一层必须维护的桥接。
- R3F/React 会引入 `queueMicrotask`、`MessageChannel`、`ResizeObserver` 等运行时依赖；Gecko 78 基本具备，但 Chromium 67 的 2D 预览需要 polyfill 验证。

## 5. 决策

**生产内容层采用 A：纯 Three.js 0.152 + TypeScript + esbuild；不引入 R3F/Drei。**

理由：

1. 应用只有 3 个程序化场景 + 一套空间 UI；R3F 的组件化收益不足以抵消 React/reconciler 的运行时与兼容风险。
2. 真正的复杂度在 XR 会话、3DoF 姿态、四种空间模式、场景预算与旧浏览器，R3F/Drei 不解决这些；反而增加一层需要桥接的抽象。
3. 分发壳可能从 Firefox Reality 换成内嵌 WebXR 或原生 OpenGL ES；纯 Three.js 的核心数学/契约可直接复用，React 层则会被丢弃。
4. Drei 的依赖面与老 GPU 风险不符合“正式化基线”的保守原则。
5. 草稿已经证明 Three 0.128 的渲染路径；升级到 0.152 的改动面小于引入 React 生态。

**框架边界：**

- `src/core/**` 不依赖 DOM、React、R3F；只依赖 Three 的数学/对象类型（可替换为原生移植的等价实现）。
- `src/ui/**` 是 Three.js 空间 UI 与 DOM 启动页；不引入 React。
- 如果未来需要 R3F，可在 `src/app` 外包一层 React Canvas，复用 `core`；不把核心逻辑写进 hooks。

**什么情况下重新评估 R3F：**

- 团队规模 > 3 且 UI 组件数 > 20；或需要桌面编辑器/可视化编排。
- 目标设备升级到支持现代 Chromium/WebXR 的 Android 10+ 头显。
- 有实机证据表明 R3F 8 + React 18 在 Gecko 78 上启动、内存、帧率均无回归（需给出数据，不是“能跑”）。
- 需要 R3F 生态的 3D 资产管线（GLTF、材质编辑器）且收益大于迁移成本。

## 6. 兼容性评估状态

R3F 8 + React 18 + Three 0.152 的独立 spike **未完成**：

- `npm install` 因 R3F 的 `peerOptional`（expo/react-native）与 npm 11 的严格解析冲突，需要 `--legacy-peer-deps`；后续安装未在超时前完成。
- 因此没有可信的 bundle 体积、运行时 API 扫描或桌面启动数据。本文的决策**不建立在“R3F 能跑”之上**，而是基于依赖面、运行时成本、XR 桥接和原生移植风险。
- 若未来要重新评估，必须先完成：固定版本安装 → esbuild `target=chrome67` IIFE 构建 → 扫描 `queueMicrotask`/`ResizeObserver`/`globalThis` → 桌面 Chromium 启动 → 再上 Gecko 78 实机。只有给出这些数据，才能推翻当前决策。

> 不复制易过期的 bundle 数字；以上为当前事实状态。
