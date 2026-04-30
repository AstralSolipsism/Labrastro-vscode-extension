# Coding Agent Trace Graph 实施路线图 / Implementation Roadmap

## 目标 / Goal

在保持 **Kilocode v5 风格主对话界面** 的前提下，为 dogcode 落地一套双层可视化体系：

1. **对话内轻量轨迹 / In-Chat Lightweight Trace**
   - 在主聊天界面中，以最小空间成本展示当前任务的执行轨迹
   - 让消息、工具调用、执行节点在视觉上统一

2. **全局唯一深查页 / Global Singleton Deep-Investigation Page**
   - 提供一个类似 Kilocode v5 `AgentManager` 的独立页面
   - 用于展示完整纵向 DAG / 树感轨迹、节点详情、分支回溯、subagent drill-down

---

## 1. 产品形态 / Product Surfaces

## 1.1 最终产品形态 / Final Product Shape

| Surface | 中文定位 | English | 目标 |
|---------|----------|---------|------|
| Sidebar Chat | 主对话页 | Main Chat Surface | 保持 Kilocode v5 的聊天主界面，不被 DAG 侵占 |
| Trace Ribbon | 轻量轨迹带 | Lightweight Trace Ribbon | 在聊天页中提供持续可见的轨迹摘要 |
| AgentManager Page | 深查管理页 | Deep Investigation Page | 全局唯一实例，承载完整 DAG 和纵向详情 |

## 1.2 设计原则 / Design Principles

- 聊天是主轴，图谱不是主轴
- 轻量轨迹常驻，重型图谱只在 AgentManager 中打开
- 所有节点都必须有稳定 `id`
- 对话中的工具卡片必须能映射到图谱节点
- 深查页必须是**全局唯一实例**
- sidebar 与 panel 复用一套前端运行时，但允许显示模式不同

---

## 2. 为什么要两层界面 / Why Two Surfaces Are Required

## 2.1 对话页不能承担全部图谱职责

当前聊天主布局是：

```text
ChatView
├── TaskHeader
├── MessageList
└── PromptInput
```

这与现有实现一致，见：

- [ChatView.tsx](/g:/AboutDEV/AstralCode/AstralCode/webview-ui/src/components/ChatView.tsx)
- [TaskHeader.tsx](/g:/AboutDEV/AstralCode/AstralCode/webview-ui/src/components/chat/TaskHeader.tsx)
- [chat.css](/g:/AboutDEV/AstralCode/AstralCode/webview-ui/src/styles/chat.css)

如果把完整 DAG 常驻塞进主对话页，会直接带来这些问题：

- 压缩消息区宽度或高度
- 打断用户阅读对话的主节奏
- 在窄 sidebar 中造成信息过载
- 让“深度调试能力”反过来破坏“日常聊天体验”

## 2.2 AgentManager 页必须独立

深度排查场景下，用户需要：

- 看完整分支关系
- 看纵向节点内容
- 看某次 rollback 的来龙去脉
- 展开 subagent 子轨迹
- 从节点跳到 transcript，从 transcript 回跳节点

这些需求决定了必须有一个**独立的大画布页面**，而不是在聊天区里硬塞。

---

## 3. 最终 UI 方案 / Final UI Plan

## 3.1 主对话页 / Main Chat Surface

```text
ChatView
├── TaskHeader
│   ├── Title / Cost / Context
│   └── TraceRibbon
├── MessageList
│   ├── SessionTurn
│   ├── Assistant Text Part
│   └── Tool Card + Node Icon
└── PromptInput
```

### 中文说明

- `TraceRibbon` 替代或增强当前 `TaskTimeline`
- `MessageList` 内的工具卡片、命令输出、文件编辑都附带对应节点图标
- 用户在聊天中就能感知“这条内容属于 DAG 的哪类节点”
- 任何需要看局部 DAG、分支细节、rollback/fork 操作的场景，统一跳转到 `AgentManagerPage`

### English Summary

- Keep chat as the primary reading flow
- Add a thin trace summary inside the header
- Keep deep graph investigation out of the sidebar
- Unify tool/message rendering with DAG node semantics

## 3.2 AgentManager 深查页 / AgentManager Deep View

```text
AgentManagerPage
├── AgentManagerHeader
│   ├── Session Selector
│   ├── Branch Filter
│   ├── View Mode
│   └── Locate Active Node
├── AgentGraphWorkspace
│   ├── Branch Tree / DAG Canvas
│   ├── MiniMap
│   └── Focus Overlay
└── NodeDetailPane
    ├── Node Summary
    ├── Transcript Excerpt
    ├── Tool I/O / Command Output / Diff
    └── Rollback / Fork / Jump Actions
```

### 关键要求 / Key Requirement

`AgentManagerPage` 必须是：

- 单独的 `WebviewPanel`
- 全局唯一实例
- 支持 serializer 恢复
- 能从聊天页跳转进入
- 能根据 `nodeId` 或 `branchId` 定位初始焦点

---

## 4. 架构落点 / Architecture Mapping

## 4.1 Extension Host 侧 / Extension Host Side

当前已有可复用模式：

- `SidebarProvider` 负责主侧边栏
- `SettingsPanelProvider` 已支持单例面板 + serializer

对应文件：

- [SidebarProvider.ts](/g:/AboutDEV/AstralCode/AstralCode/src/SidebarProvider.ts)
- [SettingsPanelProvider.ts](/g:/AboutDEV/AstralCode/AstralCode/src/SettingsPanelProvider.ts)
- [extension.ts](/g:/AboutDEV/AstralCode/AstralCode/src/extension.ts)

### 建议新增 / Recommended Additions

| 项目 | 中文 | 说明 |
|------|------|------|
| `AgentManagerPanelProvider` | AgentManager 面板提供器 | 复用 `SettingsPanelProvider` 的单例 panel 模式 |
| `dogcode.openAgentManager` | 打开管理页命令 | 支持从 sidebar、聊天节点、工具卡片跳转 |
| `dogcode.agentManagerPanel` | serializer viewType | 支持 VS Code 重启后恢复 |

## 4.2 Webview Front-End 侧 / Front-End Side

当前 `App.tsx` 通过 `navigate` 消息切换：

- `chat`
- `settings`
- `about`

建议新增：

- `agentManager`

这样可以继续复用同一套 `webview.js`，但在 panel 模式下渲染不同页面。

---

## 5. 状态流规划 / Trace State Flow

## 5.1 单一事实源 / Single Source of Truth

建议新增 `TraceStore` 或 `TraceProvider`，统一管理：

- `sessions`
- `branches`
- `nodes`
- `edges`
- `selectedNodeId`
- `focusedBranchId`
- `viewportState`

### 中文原则

- 对话页和 AgentManager 页都不各自维护独立 trace 副本
- 一切 trace 数据都从同一个 store 派生
- 对话中的工具卡片只持有 `traceNodeId`

### English Principle

- One trace store
- Multiple derived views
- Chat content links back to trace graph through stable IDs

## 5.2 事件流 / Event Flow

```text
Extension Host Event
  -> Trace Event Normalizer
  -> TraceStore
  -> ChatView derivation
  -> AgentManager derivation
```

### 事件类型建议 / Suggested Event Types

| Event | 中文 | 用途 |
|------|------|------|
| `trace/sessionCreated` | 会话创建 | 初始化 session |
| `trace/nodeAdded` | 节点新增 | 创建 DAG 节点 |
| `trace/nodeUpdated` | 节点更新 | 状态变化、补充输出 |
| `trace/edgeAdded` | 边新增 | 连接顺序、fork、rollback |
| `trace/focusNode` | 聚焦节点 | 从聊天跳图、从图跳聊天 |
| `trace/openAgentManager` | 打开管理页 | 带初始定位参数 |

---

## 6. 对话内统一映射 / In-Chat Visual Unification

## 6.1 现状 / Current State

当前 `SessionTurn.tsx` 已有工具卡片和节点形状映射，并已补齐用户消息、助手消息、工具块的基础 transcript anchor：

- [SessionTurn.tsx](/g:/AboutDEV/AstralCode/AstralCode/webview-ui/src/components/chat/SessionTurn.tsx)

下一步不再是“补有没有 anchor”，而是把这些 anchor 从 mock 数据切到真实 trace 事件流。

## 6.2 目标 / Target

把对话中的可执行内容全部统一成“节点化内容块”：

| 对话内容 | 对应节点类型 |
|----------|--------------|
| 用户消息 | `user_message` |
| 助手文本摘要 | `assistant_message` 或 `thought_summary` |
| 工具调用卡片 | `tool_call` / `tool_result` |
| 命令执行卡片 | `command_run` |
| 文件修改卡片 | `file_edit` |
| fork / rollback 系统提示 | `fork` / `rollback` |

## 6.3 具体做法 / Concrete Plan

### 第一层

给 `MockPart` 和真实业务 part 新增：

```ts
traceNodeId?: string
traceNodeKind?: TraceNodeKind
traceNodeStatus?: TraceNodeStatus
```

### 第二层

把现在的工具卡片语义升级为“节点形状映射”，例如：

```ts
NODE_ICONS = {
  user_message: "...",
  assistant_message: "...",
  thought_summary: "...",
  tool_call: "...",
  command_run: "...",
  file_edit: "...",
  fork: "...",
  rollback: "...",
}
```

### 第三层

点击卡片时触发：

- 聚焦聊天节点
- 或直接打开 `AgentManagerPage`

---

## 7. AgentManager 页结构 / AgentManager Page Structure

## 7.1 页面职责 / Responsibilities

| 区域 | 中文职责 | English |
|------|----------|---------|
| Header | 切 session / branch / mode | Session and branch controls |
| Graph Workspace | 展示完整 DAG | Full graph workspace |
| Detail Pane | 展示节点细节 | Detailed node inspector |

## 7.2 纵向信息结构 / Vertical Information Layout

推荐用“双列联动”而不是单纯一整张图：

```text
┌ 左：纵向 DAG / 分支树感视图
└ 右：当前节点详细内容
```

这样用户可以：

- 左边看路线
- 右边看具体执行内容
- 不需要每次点击节点都弹抽屉覆盖全屏

## 7.3 Node Detail Pane 内容

| 区块 | 中文 | 内容 |
|------|------|------|
| Summary | 摘要 | 标题、状态、时间、branch、step |
| Transcript | 对话对应 | 与消息区的文本锚点 |
| Payload | 输入输出 | tool input/output、命令输出、文件 diff |
| Actions | 操作区 | rollback、fork、jump to transcript |

---

## 8. 分阶段实施计划 / Phased Delivery Plan

## Phase 1 — Trace Domain 基础层

### 目标

先让“节点身份”和“对话映射”成立。

### 交付

- `types/trace.ts`
- `context/trace.tsx`
- `mock/traceGraph.mock.json`
- 给聊天 mock 数据补 `traceNodeId`
- 为工具卡片增加节点图标与状态显示

### 文件清单

- `webview-ui/src/types/trace.ts`
- `webview-ui/src/context/trace.tsx`
- `webview-ui/src/mock/traceGraph.mock.json`
- `webview-ui/src/components/chat/mock-data.ts`
- `webview-ui/src/components/chat/SessionTurn.tsx`

## Phase 2 — 对话页轻量轨迹

### 目标

在不破坏 Kilocode v5 聊天主界面的前提下，只保留轨迹摘要与节点映射，不在 sidebar 中承载重型 DAG。

### 交付

- `TraceRibbon`
- 聊天内容点击后聚焦节点
- TaskHeader 与 trace 数据联动

### 文件清单

- `webview-ui/src/components/trace/TraceRibbon.tsx`
- `webview-ui/src/components/chat/TaskHeader.tsx`
- `webview-ui/src/components/ChatView.tsx`
- `webview-ui/src/styles/trace-graph.css`

## Phase 3 — Extension 命令与单例 Panel

### 目标

打通 AgentManager 页入口。

### 交付

- `AgentManagerPanelProvider`
- `openAgentManager` 命令
- serializer 恢复
- sidebar / chat 内节点触发打开管理页

### 文件清单

- `src/AgentManagerPanelProvider.ts`
- `src/extension.ts`
- `package.json`

## Phase 4 — AgentManager 深查页

### 目标

构建完整独立页面。

### 交付

- `AgentManagerView`
- `AgentGraphWorkspace`
- `NodeDetailPane`
- `MiniMap`
- branch filter / session switch / locate active node

### 文件清单

- `webview-ui/src/components/AgentManagerView.tsx`
- `webview-ui/src/components/trace/AgentGraphWorkspace.tsx`
- `webview-ui/src/components/trace/NodeDetailPane.tsx`
- `webview-ui/src/App.tsx`

## Phase 5 — 交互闭环

### 目标

让聊天页和管理页形成闭环导航。

### 交付

- chat -> graph -> detail -> transcript 跳转
- rollback / fork 快捷操作
- subagent 分支 drill-down
- branch dimming / focus / keyboard navigation

---

## 9. 执行顺序建议 / Recommended Execution Order

1. 先锁定 `TraceNode` / `TraceEdge` 语义和 mock 数据契约
2. 再做对话内节点形状统一与 transcript anchor
3. 再做 `TraceRibbon`
4. 然后打通 `AgentManagerPanelProvider`
5. 再实现 `AgentManagerView`
6. 再接共享 `TraceStore`
7. 最后完善 deep-link、rollback、fork、subagent drill-down

原因很简单：

- 先统一数据和语义，后做画布
- 先做聊天内映射，马上能看到价值
- 深查页先打通入口，再逐步填内容，避免 sidebar 再长出临时详情面板

---

## 10. 第一轮实现范围 / First Implementation Slice

第一轮不要试图一次做完整系统，建议只做以下最小闭环：

### 必做

- Trace 类型定义
- 对话工具卡片挂上 `traceNodeId`
- TaskHeader 中增加 `TraceRibbon`
- 新增 `openAgentManager` 命令
- 新增全局唯一 `AgentManagerPage`
- 管理页先用 mock 数据渲染

### 暂缓

- rollback 真正执行
- fork 真正执行
- subagent 实时联动
- 自动布局算法
- 超复杂动画

---

## 11. 实施后验收标准 / Acceptance Criteria

- 主聊天页仍然保留 Kilocode v5 风格主轴
- 用户无需离开聊天页也能感知当前执行轨迹
- 工具卡片和图谱节点在视觉语义上统一
- 点击聊天中的用户消息、助手消息或工具卡片都可以定位到对应图谱节点
- `AgentManagerPage` 只能打开一个实例
- 从聊天页可进入管理页，从管理页可跳回 transcript

---

## 12. 下一步 / Immediate Next Step

当前已经完成的前端 mock 闭环包括：

1. `AgentManager` 单例入口与独立页面
2. 会话切换、分支过滤、节点详情和 transcript 摘录
3. `fork / subagent / rollback` 的本地 mock 行为回放
4. 聊天页中的用户消息、助手消息、工具块可直接带节点进入 `AgentManager`
5. `AgentManager` 已具备 branch breadcrumb、意图提示和子代理 drill-down 入口
6. `AgentManager` 默认保持全局总览，branch / subagent 仅作为临时聚焦模式

下一批高优先级切片是：

1. 给聊天页中的助手消息和工具块补更完整的 fork / subagent 入口策略
2. 让 `AgentManager` 支持 breadcrumb 内的父子 branch 返回和固定 subagent 视角
3. 补齐 `traceGraph.mock.json` 与 sidebar mock 数据的更多动作字段示例
4. 最后再决定是否冻结协议并接入 Extension Host 真实 trace 事件
