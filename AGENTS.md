# Labrastro VS Code 前端开发宪法

本文件是 Codex 处理 `AstralSolipsism/Labrastro-vscode-extension` 前端仓库时的最高开发约束。
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

## 4. ChatView 修改规则

ChatView 必须渲染后端 transcript。

修改 ChatView 时必须按影响范围检查：

- transcript reducer
- transcript presentation
- `SessionTurn` 渲染
- 工具卡片状态
- approval 状态
- lifecycle hook 事件展示
- 失败、中断、取消、完成状态

如果后端事件不完整，应修后端合同，不能在 ChatView 里猜。

## 5. Settings 修改规则

Settings 可以提交配置、展示配置、触发流程。

Settings 不得：

- 自己维护能力安装进度事实。
- 自己判断能力包是否有效。
- 自己判断服务端运行状态是否成功。
- 保存后不检查后端返回结果。

Settings 发起的交互式流程，必须能回到 ChatView 或对应后端运行投影。

## 6. Taskflow 修改规则

Taskflow 面板展示后端 Taskflow 状态。

它可以展示：

- task run
- agent run
- pending review
- blocked / needs attention
- artifacts
- liveness
- 与 ChatView 的跳转关系

它不能把长期后台任务的真实状态只存在本地 UI。

## 7. 协议修改规则

改 remote API、SessionRun event、AgentRun event、Taskflow projection 或 Settings payload 时，必须同步检查：

- `src/LabrastroRemoteClient.ts`
- `src/protocol/messages.ts`
- 相关 coordinator
- webview reducer
- webview component
- 对应测试

如果后端字段新增、删除或改语义，前端必须有对应测试证明旧状态不会误渲染。

## 8. UI 与 Webview 规则

UI 修改必须服务工作流，不做装饰性堆叠。

必须保证：

- 状态清楚。
- 错误可见。
- 用户知道是否等待审批、运行中、失败、取消或完成。
- 文案和后端状态一致。
- 不用“成功”掩盖后端失败。
- 不用 loading 态掩盖协议缺失。

Webview 安全、CSP、message handshake、资源路径、主题变量、打包规则遵守 `docs/FRONTEND_RULES.md`。

## 9. 验收要求

没有证据不能声称完成。
没有运行相关验证，只能说明已修改，不能说明行为已验证。
不得把无关 dirty 文件混入交付范围。

交付说明必须包含：

- 变更范围
- 影响到的视图、协议和状态来源
- 验证命令和结果
- 未验证项及原因
- 如已打包，给出 VSIX 构建结果

## 10. 常用验证

前端类型检查：

```bash
npm run typecheck
```

webview 类型检查：

```bash
npm run typecheck:webview
```

按范围运行测试：

```bash
npm run test:chat
npm run test:settings
```

打包 VSIX：

```bash
npm run package:vsix
```

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **Labrastro-vscode-extension** (5307 symbols, 16690 relationships, 300 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> Index stale? Run `node .gitnexus/run.cjs analyze` from the project root — it auto-selects an available runner. No `.gitnexus/run.cjs` yet? `npx gitnexus analyze` (npm 11 crash → `npm i -g gitnexus`; #1939).

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows. For regression review, compare against the default branch: `detect_changes({scope: "compare", base_ref: "main"})`.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `context({name: "symbolName"})`.

## Never Do

- NEVER edit a function, class, or method without first running `impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `rename` which understands the call graph.
- NEVER commit changes without running `detect_changes()` to check affected scope.

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/Labrastro-vscode-extension/context` | Codebase overview, check index freshness |
| `gitnexus://repo/Labrastro-vscode-extension/clusters` | All functional areas |
| `gitnexus://repo/Labrastro-vscode-extension/processes` | All execution flows |
| `gitnexus://repo/Labrastro-vscode-extension/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->
