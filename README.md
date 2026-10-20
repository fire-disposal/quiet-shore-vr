# 静岸 · Quiet Shore VR

PICO G2 4K 上的 WebXR 引导想象训练应用。正式化基线仓；草稿仓保留在 `~/dev/VR`，不再从草稿直接改功能。

## 当前架构

- **内容层**：Three.js 0.152 + TypeScript + esbuild；不引入 React/R3F/Drei。核心空间/场景/几何契约可移植到未来内嵌 WebXR 或原生渲染器。
- **空间 UI**：统一的 `SpatialAnchor` / `SpatialSurface` / `SpatialButton` / `SpatialInput`，四种模式：召唤后世界锁定、跟随视角、世界锁定、世界锁定+朝向用户。
- **场景**：`landscape`（湖畔日出）与 `ward`（训练病房）作为 `SceneDefinition`；legacy 程序化场景被隔离在 `src/scenes/*/landscape.legacy.js` / `ward.legacy.js`，由契约适配器包装。
- **分发壳**：`shell/android` 是薄 Portal APK：`127.0.0.1:8130` 只读静态服务 + 常驻通知/快捷磁贴 + 拉起 Firefox Reality。不修改 HOME，不 root。
- **CI/CD**：GitHub Actions 构建 Web bundle 与 APK；签名从 Secrets 读取，仓库不提交 keystore。

详细取舍见：

- `docs/ui-audit.md`：草稿 UI 的经验与局限、正式化设计方向。
- `docs/tech-selection.md`：R3F/Drei 评估与“纯 Three.js 核心”的决策。
- `docs/distribution.md`：Portal APK vs 内嵌 WebXR vs 原生渲染的矩阵与 go/no-go。
- `docs/spatial-ui.md`：四种空间模式契约。
- `docs/geometry-contracts.md`：变换/几何/帧管线的有序管理。
- `docs/migration.md`：场景迁移与 ownership 规则。

## 命令

```bash
npm ci
npm run dev          # http://127.0.0.1:8125/
npm run check        # tsc --noEmit
npm test             # vitest
npm run build
npm run standalone   # dist/standalone.html
npm run apk          # 需要 Android SDK；输出 shell/android/build/quiet-shore.apk
```

URL 参数：`?quality=low`、`?aa=0`、`?scene=landscape|ward`、`?nocal=1`、`?debug=1`、`?lang=en`、`?spin=1`。

## 发布

1. CI 生成 `dist/standalone.html`，复制进 APK assets。
2. `shell/android/build.sh` 用 `aapt2 + javac + d8 + zipalign + apksigner` 构建并签名。
3. 从 PICO 下拉通知栏点击“进入训练”；APK 启动本地 HTTP 服务并拉起 Firefox Reality。

旧 GitHub 仓 `stillwater-vr` 在新仓首次 CI 通过后删除；本地草稿 `~/dev/VR` 保留。
