# 文档索引

只维护当前事实；历史方案保留，但不再作为实现依据。

## 当前有效

| 文档 | 内容 |
| --- | --- |
| `../README.md` | 项目总览、构建、当前限制 |
| `../TODO.md` | 当前优先级与下一步 |
| `system-boundaries.md` | 场景/Web/Android 分层、单写者规则、视角动画状态机、BLE/回环集成点、本地录像边界 |
| `control-plane.md` | BLE GATT、命令、二进制 state v8、扫描即连接与链路恢复、回环 API |
| `control-interaction-spec.md` | 权限、状态机、干预目录（一步校准、6 s 注视）、安全包络、患者视角录像、验收 |
| `rotation-contract.md` | 唯一角度契约：L0–L3 分层、双通道口径（偏航/俯仰）、已删除的第二真相、迁移状态、双侧 golden vectors、state v8 编码 |
| `kiss-review.md` | 已收口项与剩余复杂度 |
| `virtual-posture.md` | 一步校准的世界帧、posture/comfort 当前数学与 6 s 起身逆变换；两姿态重映射标注为历史 |
| `motion-polish.md` | 镜头动画、失重感、粒子/停止安全审计（含起身过渡与确认键单一职责） |
| `spatial-ui.md` | 空间面板锚点、唯一准星、6 s 注视选择与视觉引导；头显内菜单已移除 |
| `home-switch.md` | 默认 HOME 切换、恢复命令 |
| `distribution.md` | 双 APK、签名、分发边界 |
| `pico-g2.md` | 设备勘测与实机结论 |
| `requirements.md` | 需求分类与变更检查 |
| `self-update-spike.md` | 自更新方案与签名前置条件（尚未实现） |

## 历史/参考

以下文档记录早期方案、实测或审计，部分数字已被现状取代；实现以当前有效文档为准。`ui-audit.md` 已加历史说明，其余文档仍可能写两步校准或 1.2 s 停留。

- `bedside-voiding.md`（产品概念；虚拟起身现由平板/确认键提供）
- `design-direction.md`
- `geometry-contracts.md`
- `migration.md`
- `performance-evidence.md`
- `performance-plan.md`
- `scene-contract.md`
- `tech-selection.md`
- `ui-audit.md`（已加历史说明：两步校准/1.2 s 停留为旧值）

## 维护规则

- 新决策写入当前有效文档；过程流水账不进入 README/TODO。
- 过期格式、旧命令、旧截图只保留在历史文档，并明确标注失效。
- TODO 只写未完成事项；完成即删除。
