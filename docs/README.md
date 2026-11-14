# 文档索引

四类，不混放。旧文档从 git 取回。

## 当前权威

与其他文档冲突时以这几份为准。

| 文档 | 内容 |
| --- | --- |
| `core.md` | 目标与非目标、使用方式、场景接口、功能、决策记录、验收 |
| `protocol.md` | QS2 generation 与 state schema 1：GATT、控制权、命令族、28 字节 state 帧、遥测、JSON 通道、WebSocket、入口监督、HTTP、不变式 |
| `session-flow.md` | 一次会话从准备间到正式场景，再到问卷与结束 |
| `scenes.md` | 三个正式场景的边界、画面、用途与选择规则 |

## 当前现状

描述已实现的系统面貌，供接手与维护阅读。

| 文档 | 内容 |
| --- | --- |
| `animation.md` | 漂浮、起身、俯仰修正的分层与帧规则 |
| `apps.md` | 两个应用面（训练 / 问卷）的层级与切换 |
| `pico-g2.md` | PICO G2 4K 硬件能力、WebXR 入口与已知坑 |
| `distribution.md` | 双 APK 构建、分发与运行壳 |
| `home-switch.md` | 桌面切换与恢复 |
| `rotation-contract.md` | 姿态角度契约与分层 |
| `voice-script.md` | 引导语音脚本、触发与 TTS 生成规范 |
| `copy-deck.md` | 患者侧与技术员侧文案对照 |
| `ui-system.md` | 界面结构、字号与状态规则 |

## 交付物

给上机的人用，不是设计文档。

| 交付物 | 内容 |
| --- | --- |
| `manual-v2/manual.md`、`manual-v2/manual.pdf` | 当前操作说明书：两个应用面、连接、会话、问卷归档、班前检查 |

## 归档

删除的旧文档从 git 历史取回，不设二级归档目录。

## 维护规则

- 决策与场景约定只写 `core.md`，其他文档引用它，不复述。
- 只写当前事实，不写流水账；功能删减时同步精简或删除对应文档。
- 待办只写在根目录 `TODO.md`，不写进文档。
