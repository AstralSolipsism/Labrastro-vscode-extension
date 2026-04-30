# Coding Agent Trace Graph 前端规格 / Front-End Spec

## 目标 / Goal

为 dogcode 的前端提供一套**可实施**的 Trace Graph 规格，用于可视化 coding agent 的思考、发言、操作、工具调用、执行、subagent 分发、task 派发、rollback 与 fork。

这套图不是严格意义上的 Tree，而是**执行轨迹 DAG（Directed Acyclic Graph）**：

- 时间顺序由 `step` 表达
- 分支归属由 `branchId` 表达
- 祖先关系由 `edges` 表达
- fork / rollback / subagent 会形成跨分支引用，因此不能只用树结构

---

## 1. 术语对照 / Terminology i18n

### 1.1 一级类别 / Top-Level Categories

| Code | 中文 | English | 用途 |
|------|------|---------|------|
| `reasoning` | 思考 / 推理 | Reasoning | 分析、计划、判断、摘要 |
| `conversation` | 对话 / 发言 | Conversation | 用户消息、助手回复、说明性输出 |
| `execution` | 执行 / 操作 | Execution | 工具调用、命令执行、文件修改 |
| `control` | 控制流 / 分支控制 | Control Flow | rollback、fork、subagent、task |

### 1.2 业务状态 / Business States

| Code | 中文 | English | 含义 |
|------|------|---------|------|
| `queued` | 待执行 / 排队中 | Queued | 已创建，尚未开始 |
| `active` | 进行中 / 当前活跃 | Active | 当前正在处理 |
| `streaming` | 流式输出中 | Streaming | 正在持续输出内容 |
| `success` | 已完成 | Success | 正常结束 |
| `error` | 异常 / 失败 | Error | 执行失败或中断 |
| `cancelled` | 已取消 | Cancelled | 被用户或系统取消 |
| `abandoned` | 已废弃 / 已放弃 | Abandoned | 分支保留但不再继续 |
| `rewound` | 已回退 | Rewound | 已作为回退目标或被回退覆盖 |

### 1.3 交互状态 / Interaction States

> 交互状态不建议存入业务状态枚举，建议单独由 UI 层维护。

| Code | 中文 | English | 含义 |
|------|------|---------|------|
| `selected` | 已选中 | Selected | 当前在 Inspector 中查看 |
| `hovered` | 悬停中 | Hovered | 当前鼠标悬停 |
| `dimmed` | 已降噪 | Dimmed | 被非焦点分支压暗 |

---

## 2. 数据契约 / Data Contract

## 2.1 顶层 Payload / Top-Level Payload

```ts
export interface TraceGraphPayload {
  version: "1.0.0"
  locale: "zh-CN" | "en-US"
  session: TraceSession
  ui: TraceGraphUIState
  i18n: TraceGraphI18n
  branches: TraceBranch[]
  nodes: TraceNode[]
  edges: TraceEdge[]
}
```

## 2.2 Session / 会话信息

```ts
export interface TraceSession {
  id: string
  title: string
  workspaceDirectory?: string
  mode: "sidebar" | "panel"
}
```

## 2.3 UI State / 视图状态

```ts
export interface TraceGraphUIState {
  activeNodeId: string | null
  selectedNodeId: string | null
  focusedBranchId: string | null
  showInspector: boolean
  showMiniMap: boolean
  viewMode: "compact" | "expanded"
}
```

`showInspector` 与 `showMiniMap` 只在 `session.mode === "panel"` 时生效；Sidebar 中只保留 `TraceRibbon` 摘要，不展开重型详情。

## 2.3.1 Navigation Intent / 导航意图

```ts
export type TraceNavigationIntent =
  | "inspect"
  | "fork"
  | "rollback"
  | "subagent"
```

- `inspect`：普通查看，默认高亮并定位节点
- `fork`：从聊天页带着“从此 Fork”意图进入管理页
- `rollback`：从聊天页带着“回退到此”意图进入管理页
- `subagent`：从聊天页或详情区带着“派发子代理”意图进入管理页

## 2.4 Branch / 分支

```ts
export interface TraceBranch {
  id: string
  parentBranchId?: string
  forkNodeId?: string
  lane: number
  depth: number
  kind: "main" | "fork" | "subagent"
  state: "active" | "idle" | "abandoned" | "merged"
  labelKey: string
}
```

## 2.5 Node / 节点

```ts
export type TraceNodeCategory =
  | "reasoning"
  | "conversation"
  | "execution"
  | "control"

export type TraceNodeKind =
  | "thought_summary"
  | "plan_update"
  | "decision"
  | "user_message"
  | "assistant_message"
  | "tool_call"
  | "tool_result"
  | "command_run"
  | "file_edit"
  | "rollback"
  | "fork"
  | "subagent_spawn"
  | "task_dispatch"

export type TraceNodeStatus =
  | "queued"
  | "active"
  | "streaming"
  | "success"
  | "error"
  | "cancelled"
  | "abandoned"
  | "rewound"

export interface TraceNode {
  id: string
  category: TraceNodeCategory
  kind: TraceNodeKind
  status: TraceNodeStatus
  branchId: string
  lane: number
  step: number
  startedAt: string
  endedAt?: string
  parentId?: string
  rollbackTo?: string
  forkFrom?: string
  transcriptAnchorId?: string
  title: string
  summary?: string
  meta?: Record<string, unknown>
}
```

## 2.6 Edge / 边

```ts
export type TraceEdgeKind =
  | "sequential"
  | "fork"
  | "subagent"
  | "rollback"
  | "return"
  | "abandoned"
  | "focus"

export interface TraceEdge {
  id: string
  kind: TraceEdgeKind
  source: string
  target: string
  branchId: string
  emphasis?: "normal" | "strong" | "muted"
}
```

---

## 3. 节点类型表 / Node Type Table

| Kind | 中文 | English | Category | 推荐形状 | 语义说明 | Inspector 主操作 |
|------|------|---------|----------|----------|----------|------------------|
| `thought_summary` | 思考摘要 | Thought Summary | `reasoning` | 小圆 | 一次可见的思考摘要，不展示原始 CoT | 查看摘要、跳转上下文 |
| `plan_update` | 计划更新 | Plan Update | `reasoning` | 圆角矩形 | 计划新增、调整、完成 | 查看计划 diff |
| `decision` | 决策点 | Decision | `reasoning` | 菱形 | 表示一次关键判断或路线选择 | 查看为什么选这条路 |
| `user_message` | 用户消息 | User Message | `conversation` | 左对齐胶囊 | 用户输入事件 | 跳转到消息 |
| `assistant_message` | 助手回复 | Assistant Message | `conversation` | 右对齐胶囊 | 助手输出或阶段总结 | 跳转到回复 |
| `tool_call` | 工具调用 | Tool Call | `execution` | 方形 | 请求调用工具 | 查看入参 |
| `tool_result` | 工具结果 | Tool Result | `execution` | 方形 + 实心底色 | 工具调用完成后的结果 | 查看结果与耗时 |
| `command_run` | 命令执行 | Command Run | `execution` | 方形 + 终端角标 | shell / task 执行 | 查看 stdout / stderr |
| `file_edit` | 文件修改 | File Edit | `execution` | 方形 + 铅笔角标 | 写文件、补丁、重命名 | 打开文件或 diff |
| `rollback` | 回退 | Rollback | `control` | 回退箭头菱形 | 从当前分支回退到一个已有稳定节点 | 查看源头和目标 |
| `fork` | 分叉 | Fork | `control` | 空心菱形 | 从当前稳定节点开新分支 | 比较分支 |
| `subagent_spawn` | 子代理分发 | Subagent Spawn | `control` | 六边形 | 将子任务派给 subagent | 查看子代理轨迹 |
| `task_dispatch` | 任务派发 | Task Dispatch | `control` | 八边形 | 将动作提交给独立任务单元 | 查看任务输入输出 |

### 3.1 形状规范 / Shape Rules

- `reasoning` 默认使用圆形体系
- `conversation` 默认使用胶囊体系，但 `user_message` 与 `assistant_message` 必须在基色上直接区分
- `execution` 默认使用方形体系
- `control` 默认使用菱形 / 六边形 / 八边形体系
- 任何具有稳定 `id` 的 `conversation` / `execution` / `control` 节点，都可以作为 fork 或 rollback 的目标，不需要独立 `checkpoint` 节点

### 3.2 颜色建议 / Color Tokens

| Category | 中文 | Token 建议 |
|----------|------|-----------|
| `reasoning` | 思考 / 推理 | `--trace-reasoning` |
| `conversation` | 对话 / 发言 | `--trace-conversation` |
| `user_message` override | 用户行为 | `--trace-user` |
| `execution` | 执行 / 操作 | `--trace-execution` |
| `control` | 控制流 / 分支控制 | `--trace-control` |
| `error` override | 错误强调色 | `--vscode-errorForeground` |
| `warning` override | 回退/警告强调色 | `--vscode-editorWarning-foreground` |

---

## 4. 状态到动画映射表 / Status-to-Animation Mapping

> 原则：形状表达类型，描边表达状态，动画表达活性。持续动画只给当前焦点路径。

| Status | 中文 | English | 节点表现 | 边表现 | 入场动画 | 持续动画 | 退出动画 |
|--------|------|---------|----------|--------|----------|----------|----------|
| `queued` | 待执行 | Queued | 低饱和、50% 透明 | 点状虚线 | `fade-in 120ms` | 无 | 无 |
| `active` | 进行中 | Active | 高亮描边 + 外环 | 当前路径提亮 | `scale-in 140ms` | 慢速呼吸光晕 `2s infinite` | 切到 success/error 时停止 |
| `streaming` | 流式输出中 | Streaming | 外环高亮 | 边上流光 sweep | `scale-in 140ms` | 文本/描边扫光 `1.4s infinite` | 输出结束后收束 |
| `success` | 已完成 | Success | 稳定实色 | 恢复普通实线 | 无 | 无 | `ring-expand 180ms` |
| `error` | 失败 | Error | 红描边 + glow | 边变红并断裂 | 无 | 仅一次 `shake-x 180ms` | 静止红色 |
| `cancelled` | 已取消 | Cancelled | 灰化 + 斜杠角标 | 灰色中断边 | `fade-in 80ms` | 无 | 无 |
| `abandoned` | 已废弃 | Abandoned | 40% 透明 | 低透明灰边 | 无 | 无 | `fade-to-dim 120ms` |
| `rewound` | 已回退 | Rewound | 冷色轮廓 | 反向高亮回退线 | `flash-outline 120ms` | 无 | `reverse-sweep 260ms` |

### 4.1 交互态动画 / Interaction Motion

| Interaction State | 中文 | English | 表现 |
|-------------------|------|---------|------|
| `selected` | 已选中 | Selected | 外层 focus ring + Inspector 打开 |
| `hovered` | 悬停中 | Hovered | 提亮当前节点和相邻边 |
| `dimmed` | 降噪 | Dimmed | 非焦点分支透明度降到 0.3 - 0.5 |

### 4.2 动画实施规则 / Motion Rules

- 任何时刻持续动画节点数不超过 2 个
- 完成态节点必须静止，避免整图“发光污染”
- 优先使用 `transform`、`opacity`、`filter`
- 避免动画 `top` / `left` / `width` / `height`
- Sidebar 模式默认降低动画强度，Panel 模式允许完整动画

---

## 5. 边类型表 / Edge Type Table

| Kind | 中文 | English | 语义 | 视觉建议 | 动画建议 |
|------|------|---------|------|----------|----------|
| `sequential` | 顺序边 | Sequential | 同一分支上的前后步骤 | 垂直或折线实线 | active 时可提亮 |
| `fork` | 分叉边 | Fork | 从已有稳定节点生出新分支 | 90 度转角实线 | 创建时短暂 outward sweep |
| `subagent` | 子代理边 | Subagent | 主 agent 到 subagent 分支 | 细虚线 | 生成时短暂脉冲 |
| `rollback` | 回退边 | Rollback | 从失败点回退到既有节点 | 反向 90 度虚线 | reverse sweep |
| `return` | 返回边 | Return | 子代理结果返回父分支 | 点划线 | 成功时轻微 sweep |
| `abandoned` | 废弃边 | Abandoned | 已放弃分支的残留路径 | 灰色低透明线 | 无 |
| `focus` | 聚焦边 | Focus | Inspector 或 hover 临时高亮的关联边 | 高亮描边 | 仅交互时短暂出现 |

---

## 6. Solid 组件拆分 / Solid Component Breakdown

## 6.1 推荐目录 / Recommended File Structure

```text
webview-ui/src/
├── types/
│   └── trace.ts
├── context/
│   └── trace.tsx
├── hooks/
│   └── useTraceLayout.ts
├── components/
│   ├── AgentManagerView.tsx
│   └── trace/
│       ├── AgentBranchBreadcrumb.tsx
│       ├── AgentManagerToolbar.tsx
│       ├── AgentManagerDetailPane.tsx
│       ├── AgentTranscriptExcerpt.tsx
│       ├── TraceRibbon.tsx
│       └── TraceGraphCanvas.tsx
├── styles/
│   └── trace-graph.css
└── mock/
    └── traceGraph.mock.json
```

## 6.2 组件职责 / Responsibilities

| 组件 | 中文职责 | English Responsibility | 输入 |
|------|----------|------------------------|------|
| `TraceRibbon` | 侧边栏摘要轨迹带，只做简要路线感知 | Compact summary ribbon | `nodes`, `edges`, `selection` |
| `AgentManagerView` | 深查页面总容器 | Deep investigation page shell | `payload`, `mode` |
| `AgentBranchBreadcrumb` | 显示当前 branch 谱系和意图状态 | Branch lineage and current intent | `breadcrumb`, `intent`, `callbacks` |
| `AgentManagerToolbar` | 会话切换、分支过滤、活跃节点定位 | Session/branch controls | `sessions`, `branches`, `callbacks` |
| `AgentManagerDetailPane` | 节点详情与前端 mock 动作区 | Detail pane and mock actions | `selectedNode`, `callbacks` |
| `AgentTranscriptExcerpt` | 根据 `transcriptAnchorId` 展示消息或工具摘录 | Transcript excerpt by anchor | `selectedNode`, `turns` |
| `TraceGraphCanvas` | 组织 SVG 和节点层，处理全量图与局部图的共享渲染 | Shared graph canvas for ribbon and manager | `layout`, `viewport` |
| `TraceInspector` | AgentManager 页内节点详情区 | Detail pane inside AgentManager | `selectedNode` |
| `TraceMiniMap` | 缩略图和可视窗口 | Mini-map and viewport frame | `nodes`, `viewport` |
| `TraceLegend` | 图例与筛选 | Legend and filters | `filters` |
| `TraceToolbar` | 聚焦、回退、fork 等快捷操作 | Toolbar actions | `selection`, `callbacks` |

## 6.3 Provider 与 Hook / State Layer

| 文件 | 中文说明 | English |
|------|----------|---------|
| `trace.ts` | 定义所有 Trace 类型 | Trace types |
| `context/trace.tsx` | 统一管理 payload、选中态、焦点分支、过滤器 | Trace graph context |
| `useTraceLayout.ts` | 根据 `lane + step + branch depth` 计算坐标 | Layout computation |
| `AgentManager` 局部状态 | 管理缩放、平移、居中、分支过滤 | Viewport and panel-local state |

## 6.4 与现有 ChatView 的集成 / Integration with Current ChatView

Sidebar 中不再承载可展开的重型 DAG。当前产品方向是：`TaskHeader` 内只保留 `TraceRibbon`，详细图谱与节点详情统一放入独立的 `AgentManager` 页面。

`AgentManager` 的默认视图必须是**全局总览**。`branch` 与 `subagent` 只作为临时聚焦预设存在，用户需要始终能一键返回全局总览。

```text
ChatView
├── TaskHeader
│   └── TraceRibbon
├── MessageList
└── PromptInput
```

### 6.5 必要回调 / Required Callbacks

```ts
interface TraceGraphCallbacks {
  onNodeClick(nodeId: string): void
  onJumpToTranscript(anchorId: string): void
  onOpenAgentManager(nodeId?: string, branchId?: string, intent?: TraceNavigationIntent): void
  onFocusBranch(branchId: string): void
}
```

### 6.6 当前前端 Mock 动作 / Current Front-End Mock Actions

- `fork`：从当前节点创建新 branch，并追加占位摘要节点
- `subagent_spawn`：从当前节点派发子代理 branch，并自动聚焦该 branch
- `rollback`：从当前节点回退到 `rollbackTo / forkFrom / parentId` 指向的来源节点
- 聊天页中的用户消息现在可以直接带 `fork / rollback` intent 打开 `AgentManager`
- 这些动作目前只修改前端 `TraceStore`，不触发真实后端执行

---

## 7. 布局规则 / Layout Rules

- `lane = 0` 为主干
- `lane = 1` 为主分叉或修复分支
- `lane = 2+` 为更深层 fork 或 subagent 分支
- `step` 单调递增，表示时间顺序
- `branch.depth` 用于控制水平层级
- 同一 `step` 允许多节点，但必须属于不同 branch

### 7.1 坐标建议 / Position Formula

```ts
const X_START = 24
const X_GAP = 56
const Y_START = 32
const Y_GAP = 72

x = X_START + lane * X_GAP
y = Y_START + step * Y_GAP
```

---

## 8. 交互验收标准 / Interaction Acceptance Criteria

- 点击任意可回退或可 fork 的稳定节点，必须能进入 `AgentManager` 并看到对应操作
- 点击任意消息、工具、命令节点，必须能跳到 transcript / output
- 点击 `subagent_spawn` 必须能切换或聚焦子代理分支
- hover 任一分支头时，当前分支高亮，其他分支降噪
- 回退后，旧分支必须以 `abandoned` 或 `rewound` 视觉保留，不可直接消失
- fork 后，路线必须像 git graph 一样一眼能看出来源和走向

---

## 9. Mock JSON 文件 / Mock JSON Source

已提供一个可直接喂给 UI 的 mock 数据文件：

- `webview-ui/src/mock/traceGraph.mock.json`

这个文件包含：

- `i18n`：中英对照
- `branches`：主分支、探索分支、subagent 分支、修复分支
- `nodes`：消息、思考、工具、fork、rollback、subagent、task
- `edges`：顺序边、分叉边、子代理边、回退边、废弃边

---

## 10. 实施顺序 / Suggested Implementation Order

1. 锁定 `types/trace.ts` 的节点与边语义
2. 完成 `TraceRibbon` 与 `ChatView` 的轻量接入
3. 完成 `AgentManagerView` 单例入口
4. 完成共享 `TraceStore`
5. 完成 `TraceGraphCanvas` 与 `TraceInspector`
6. 最后再做 `MiniMap`、深链和高级动画

---

## 11. 非目标 / Non-Goals

- 本规格不要求实现自动图布局算法
- 本规格不要求实现真实 git merge 语义
- 本规格不要求暴露模型的原始 chain-of-thought
- 本规格不要求在第一阶段实现拖拽改线

第一阶段目标是：**看得清、点得准、追得回、fork 得动**。
