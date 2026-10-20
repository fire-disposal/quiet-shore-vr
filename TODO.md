# TODO · v0.8.6

只保留当前优先级；完成项直接删除，不写流水账。

## P0 · 实机验证

- [ ] 在 PICO + 平板上验证 12 字节 state v3、PING/PONG 心跳与 `CONTROL_RELEASED` 收口。
- [ ] 验证开机默认 HOME、退出三选一、通知入口与 Firefox 首次引导/离线提示。
- [ ] 确认平板摇杆、眼高回读、landscape 重力粒子在真实会话中的眩晕与性能。

## P0 · 控制面收口

- [ ] 拆 `PortalService`：`LoopbackHttpServer`、`EventHub`、`CommandRouter`，先拆纯逻辑不动线程模型。
- [ ] 处理 `pendingControl` 单槽：给 `view:stop`/`stop` 优先级，或改为有界队列 + ack。
- [ ] 能力清单结构化：`supported / unsupported / not_ready`，让场景、会话、页面能力可查询。

## P1 · 体验与场景

- [ ] 统一 motion language：入口/页面/弹窗转场、posture 缓动、停止减速。
- [ ] landscape 与 ward 场景质量复审：构图、材质、灯光、环境生命感、地面接触。
- [ ] 平板 UI 打磨：角度仪表、参数步进、摇杆反馈、错误/空状态。
- [ ] 评估重力粒子是否推广到 ward；先保留单场景对照。

## P1 · 分发

- [ ] 建立稳定 release keystore + 证书指纹；否则自更新不可用。
- [ ] 在 release workflow 增加稳定文件名别名和 `update.json`。
- [ ] 平板更新器 P1；头显空闲更新器 P2。方案见 `docs/self-update-spike.md`。

## P2 · 架构

- [ ] `App.ts` 按会话生命周期 / 控制命令 / 渲染管线拆分。
- [ ] `Comfort` 内部拆纯计算模块，保留现有 API 与测试。
- [ ] 移除历史 `legacy-handle` 命名或完成场景模块化；先做 A/B，不一次性重写。

## 规则

1. 新控制点先定义语法、范围、前置条件、失败结果。
2. 高频路径必须固定分配，必须有 TTL/停止语义。
3. 旧格式兼容只保留一个版本周期；默认删，不默认加 fallback。
4. 文档只更新当前事实；历史方案放 `docs/` 并在索引标注“历史”。
