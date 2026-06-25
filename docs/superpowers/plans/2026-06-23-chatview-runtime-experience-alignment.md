# ChatView 运行体验对齐文档归档说明

本文档已归档，不再作为 SessionRun / AgentRun / Activation / ChatView 修复的执行依据。

当前唯一执行依据是：

- `D:/AboutDEV/Labrastro/docs/superpowers/plans/2026-06-23-sessionrun-history-runtime-contract.md`

执行者必须以该权威文档为准，不得从本文档、历史提交、旧测试名或旧代码注释恢复以下语义：

- 每条普通用户输入都创建新的运行主线。
- Activation 完成后关闭 SessionRunBinding。
- 使用 running-only `activeRun`、`idle activeRun` 或 `isWorking()` 作为提交路由事实源。
- 用 transport reconnecting、local peer readiness 或 projection unavailable 推导 working / queue。
- 把普通 server-owned chat 的连接状态与 local peer 等待状态混用。

ChatView 体验修复范围、验收标准、禁止项和扫描项全部以权威文档为准。
