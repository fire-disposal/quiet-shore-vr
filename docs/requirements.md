# 需求与代码边界

本文把当前需求归到稳定的产品能力上，并标出代码归属。新增功能应先判断属于哪一层，避免继续把 UI、启动、BLE 和场景逻辑堆进同一个类。

## 1. 产品模式

| 模式 | 触发 | 行为 |
| --- | --- | --- |
| 独立使用 | 没有平板持有控制权 | 头显确认卡片；场景在头显控制台设置页预设，2D 预览仅作为调试入口 |
| 引导控制 | 平板成功 `CLAIM` | 头显只显示当前场景、进入按钮和确认键提示；场景、声音、校准由平板负责 |

控制释放或断开后，头显恢复独立模式，不要求重新打开 Firefox。

代码归属：`src/app/App.ts` 的 `setControlMode`，`src/ui/start-screen.ts` 的 `setMinimal`，`src/app/config.ts` 的显式 `minimal` 参数。

## 2. WebXR 入口

- WebXR 的 `requestSession` 必须由受信任的用户手势触发。
- 当前可靠入口是头显右侧确认键；蓝牙事件、定时器、合成 click 都不能替代。
- 启动页必须给出准星对准按钮的提示。
- 远程 `start` 只能提示，不应假装能启动会话。

代码归属：`src/app/App.ts`、`src/ui/start-screen.ts`、`docs/vr-runtime.md` 相关决策。

## 3. 头显 APK

- 应用图标、通知和快捷磁贴打开 `PortalActivity`，不直接跳 Firefox。
- `PortalActivity` 是多页控制台：控制台、设置、帮助。
- 设置包含跳过校准、性能面板、蓝牙设置和版本信息；场景选择独立成页。
- 进入训练使用 `LaunchOptions`，并带 3 秒冷却。
- 通知显示服务、蓝牙和接管状态；动作是打开控制台、全部应用、返回桌面。
- 缓存策略：每次入口带时间戳，服务响应禁用缓存，启动时重读 APK 资产。

代码归属：`android/headset`，`HeadsetSettings`、`LaunchOptions`、`PortalActivity`、`PortalService`、`PortalActions`。

## 4. 控制平面

- BLE GATT 是唯一控制通道；平板不直接访问头显 HTTP。
- 第一台发送 `CLAIM` 的平板获得控制权。
- 已被控制时，第二台收到 `CONTROL_BUSY`，不能抢夺。
- 当前控制者可 `RELEASE` 或断开，释放后其他平板可接管。
- 遥测和场景状态只发给当前控制者。
- 控制权是单租约，不是身份认证；BLE 邻近就是授权边界。

代码归属：`android/protocol`、`android/headset/BluetoothControl.kt`、`android/control/ble`。

## 5. 平板控制台

- PAD 横屏优先，左侧大三维视口，右侧固定控制栏。
- 配对、连接、接管、断开、被占用、超时都有明确状态。
- 三维视口复用头显同一套 Three.js 场景模块。
- 患者视角和全局视角可切换；全局视角显示患者标记与朝向。
- 姿态过期、断开、第二台占用都要可见。
- 加载态只用不确定的三点波动，不用假进度。

代码归属：`android/control`，`ControlViewModel`、`BleController`、`ControllerWebViewHost`、`ui/`。

## 6. 场景契约

- 场景是自描述单元，不依赖 App 的会话状态。
- 场景声明元数据、音频、构建函数和渲染句柄。
- 音频属于场景声明，不在 App 或场景构建器里硬编码。
- `SceneHost` 负责生命周期、资源释放和场景切换。
- 场景构建器只返回自己的 root、selectables、settings、update、dispose 和 budget。
- 注册表是组合根；新增场景只加定义并注册，不修改 App 的场景分支。

详细接口见 `docs/scene-contract.md`。

## 7. 世界镜像与遥测

- 头显上报 5 Hz 姿态，1 Hz 状态；平板渲染同一世界事实。
- 状态包含场景、会话、校准、声音，不包含任意业务脚本。
- 命令是白名单字符串，不接受任意代码。

## 8. 构建与发布

- Web：TypeScript、Three.js、esbuild；`npm run build`、`npm run standalone`。
- Android：Gradle 多模块，`:protocol`、`:headset`、`:control`。
- 头显与平板共享 BLE 契约，不共享 Android UI 代码。
- GitHub Actions 在 main 上传双 APK 工件；`v*` tag 创建带两个 APK 和校验文件的 Release。

## 9. 明确非目标

- 不在当前阶段替换 Web3D 栈。
- 不依赖 root、Device Owner 或无障碍注入来伪造 WebXR 手势。
- 不把具体业务场景写进控制平面。
- 不把平板做成第二套场景渲染实现。

## 9.1 无滚动

头显和 WebXR 的二维界面不得依赖纵向或横向滚动。设置、帮助必须分页；超长内容拆页，不用 ScrollView。平板端触摸滚动仅作为设备列表的兜底。

## 10. 变更检查

新增需求时逐项确认：

1. 属于场景声明、世界渲染、控制平面、头显壳还是平板 UI。
2. 是否破坏独立模式。
3. 是否要求 WebXR 用户手势。
4. 是否让第二台平板能绕过租约。
5. 是否新增场景专属分支到 `App`。
6. 是否需要同步更新协议、两端 UI、文档、测试和 Release。
