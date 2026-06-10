# Labrastro VS Code 前端开发宪法

本文件为通用 agent 入口；Codex 主入口是 `AGENTS.md`。
二者必须保持同一套前端开发约束。
Webview 安全与 VS Code 运行机制细则见 `docs/FRONTEND_RULES.md`。

## 1. 本仓库负责什么

本仓库负责 Labrastro 的 VS Code 入口和用户界面。

- `src/`：VS Code extension host、命令注册、panel/provider、remote client、协议协调。
- `src/LabrastroRemoteClient.ts`：后端 remote HTTP API 的主要客户端。
- `src/protocol/messages.ts`：前后端共享的消息和协议类型。
- `webview-ui/src/`：ChatView、Settings、Taskflow、Trace/Agent 管理等 webview UI。
- `assets/`、`dist/`、`scripts/`：资源、构建产物和构建脚本。

本仓库负责展示和交互，不负责创造后端业务事实。

## 2. 前端事实边界

前端只能消费后端事实、提交用户操作、维护纯 UI 状态。
业务事实必须来自后端 API、event 或 projection。

| 领域 | 后端事实来源 | 前端职责 |
| --- | --- | --- |
| ChatView | `SessionRun` transcript | 渲染 transcript，提交用户输入和审批回复 |
| 工具过程 | SessionRun tool events | 渲染工具卡片、状态、输出和错误 |
| Taskflow | Taskflow projection | 展示计划、TaskRun、liveness、追踪关系 |
| AgentRun | AgentRun detail / events / artifacts | 展示运行状态、事件、产物和终态 |
| Settings | 后端 settings API | 展示配置，提交保存请求，显示保存结果 |
| 能力包 | 后端 review / install API | 展示评审结果和风险，提交用户决策 |
| 权限审批 | 后端 approval event / reply API | 展示审批请求，提交 approve / deny |
| 连接状态 | remote features / diagnostics API | 展示连接、版本、能力和错误 |

可以本地保存的内容：

- 当前 tab
- 展开/折叠状态
- 输入框草稿
- 滚动位置
- 临时 loading 状态

不能本地伪造的内容：

- SessionRun 终态
- AgentRun 运行状态
- Taskflow 真实进度
- 能力包是否合法
- 服务端配置是否保存成功
- 审批是否已通过

## 3. 禁止事项

- 不允许在前端伪造 SessionRun、AgentRun、Taskflow 或能力包事实。
- 不允许为了界面显示方便，新增一套和后端不一致的业务状态机。
- 不允许只改 UI 文案或样式，就声称修复了后端流程问题。
- 不允许吞掉后端错误，让用户看到假成功。
- 不允许协议字段变化只改 TypeScript 类型，不改 reducer、组件和测试。
- 不允许用 loading、fallback、optional chaining 掩盖协议缺失或后端失败。

## 4. 协议修改规则

改 remote API、SessionRun event、AgentRun event、Taskflow projection 或 Settings payload 时，必须同步检查：

- `src/LabrastroRemoteClient.ts`
- `src/protocol/messages.ts`
- 相关 coordinator
- webview reducer
- webview component
- 对应测试

如果后端字段新增、删除或改语义，前端必须有对应测试证明旧状态不会误渲染。

## 5. 验收要求

没有证据不能声称完成。
没有运行相关验证，只能说明已修改，不能说明行为已验证。
不得把无关 dirty 文件混入交付范围。

常用验证：

```bash
npm run typecheck
npm run typecheck:webview
npm run test:chat
npm run test:settings
npm run package:vsix
```
