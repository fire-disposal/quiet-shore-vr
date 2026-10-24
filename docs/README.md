# 文档索引

仅保留当前有效文档。删除的旧文档可从 git 取回：`git show 39ca6d6:docs/<文件名>`。

| 文档 | 状态 | 内容 |
| --- | --- | --- |
| `core.md` | 权威 | 目标、非目标、使用方式、模式（漂浮 / 起身备选）、场景与场景接口、功能、决策、验收、现状事实 |
| `control-plane.md` | 现状 | BLE / 回环 / WebSocket 协议；待 A4 协议冻结后重写 |
| `rotation-contract.md` | 现状 | 角度契约与 state v10 编码；待起身分支隔离后精简 |
| `ux-plan.md` | 草案 | 患者端/平板/控制台/落地页的交互与协议改进计划；场景常量以 `core.md` 为准 |
| `research-standing-sensation.md` | 参考 | 站立感/失重感的检索记录、阅读深度与推断边界 |
| `pico-g2.md` | 有效 | 设备基线、WebXR 入口与已知坑 |
| `home-switch.md` | 有效 | 默认 HOME 切换与恢复 |
| `distribution.md` | 有效 | 双 APK 分发与 CI |

维护规则：

- 决策与场景约定只写 `core.md`；其他文档引用它，不复述。
- 文档只写当前事实，不写流水账。
- 待删减功能的文档在删减完成时同步精简或删除。
- 待办只写在根目录 `TODO.md`。
