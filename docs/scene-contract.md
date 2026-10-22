# 场景契约

场景是内容单元，不是应用状态机。应用负责会话、头显姿态、控制权和音频引擎；场景只声明自己需要什么并构建自己的内容。

## 1. 标准接口

```ts
interface SceneDefinition extends SceneSummary {
  audio: SceneAudio;
  build(ctx: SceneBuildContext): SceneHandle;
}

interface SceneSummary {
  id: string;
  name: LocalizedText;
  tagline: LocalizedText;
  description: LocalizedText;
  audio: SceneAudio;
}

interface SceneAudio {
  track: 'lake' | 'stream' | 'rain';
  volume?: number;
  fadeMs?: number;
  loop?: boolean;
}
```

`SceneSummary` 是平板场景卡与控制台可见的轻量元数据；`build` 只在真正加载场景时调用。

## 2. 音频归属

音频在场景定义中声明：

```ts
audio: { track: 'stream', volume: 0.8, fadeMs: 1200, loop: true }
```

约束：

- 场景构建器不直接调用音频 API。
- App 不根据场景 ID 选择音频。
- 音频引擎负责加载、交叉淡入淡出、循环和静音。
- 音量是相对环境音量，不是设备音量。
- 新增音轨只在音频目录注册资源，场景只引用 track。

`App` 只做：

```ts
preloadSceneAudio(definition.audio);
playSceneAudio(definition.audio);
```

## 3. 渲染句柄

`SceneHandle` 是场景拥有的全部运行时资源：

```ts
interface SceneHandle {
  root: THREE.Object3D;
  selectables: THREE.Object3D[];
  settings: SceneSettings;
  update(dt: number, elapsed: number): void;
  dispose(): void;
  budget?: SceneBudget;
}
```

边界：

- `root` 只包含场景内容，不包含 App 的相机、HUD、准星或控制对象。
- 场景可以返回 selectables，但不能决定注视逻辑、命中优先级或会话流程。
- `settings` 只描述 background/fog。
- `dispose` 只释放场景拥有的资源。
- `update` 不读写 App 的会话状态，不做网络或 BLE。

## 4. 生命周期

```text
registry -> SceneDefinition
             |
             +-- metadata/audio (平板场景卡与控制台可直接读取)
             |
             +-- build(ctx) -> SceneHandle -> SceneHost
                                      |
                                      +-- root/selectables
                                      +-- update/dispose
```

`SceneHost` 负责切换和释放；`SceneRegistry` 负责组合。App 只通过 `getSceneDefinition` 和 `SceneHost` 读场景，不写 `switch (sceneId)` 的业务分支。

## 5. 新场景接入

1. 在 `src/scenes/<id>/` 创建内容构建器。
2. 在 `index.ts` 导出 `SceneDefinition`。
3. 声明本地化元数据、场景级音频、build。
4. 在 `src/scenes/registry.ts` 注册。
5. 如需要，增加场景预算和测试。
6. 不在 `App` 增加场景专属判断。

## 6. 未来扩展点

以下字段属于候选扩展，当前不强制实现，避免空抽象：

- `capabilities`：是否支持注视选择、校准、远程场景切换等。
- `interaction`：场景自有交互描述，但不接管 App 的准星与注视判定。
- `telemetry`：场景特有的只读指标，仍通过统一遥测通道上报。
- `preload`：在进入前加载资源，不执行渲染。

任何扩展都必须保持：场景可独立构建，App 不需要知道具体场景 ID，音频由声明驱动。
