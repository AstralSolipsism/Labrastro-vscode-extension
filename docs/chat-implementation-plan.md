# 复刻 Kilocode v5 主对话区域 — 视觉实现计划

## 目标

将 dogcode 的主对话区域（ChatView）从当前的基础演示升级为 **Kilocode v5 的完整视觉复刻**。仅实现前端视觉层和交互骨架，后端数据源使用模拟数据驱动。

## 当前状态 vs 目标状态

| 维度 | 当前 dogcode | 目标（Kilocode v5） |
|------|----------------|-------------------|
| 消息气泡 | 简单左右布局 + emoji头像 | Turn-based 布局：用户消息卡片 + 助手扁平内容流 |
| 输入框 | 基础 textarea + 发送按钮 | 圆角容器 + ghost text + 文件@提及高亮 + 底部选择器栏（模式/模型/思维链） |
| 空态 | 简单文字 | Logo + 欢迎文案 + 最近会话列表 + 反馈按钮 |
| 头部 | 静态标题 + 状态点 | TaskHeader：会话标题 + 费用 + Token用量 + 压缩按钮 |
| 滚动 | 基础 scrollIntoView | 自动滚动 + "跳到底部" 浮动按钮 |
| 工作指示器 | 无 | WorkingIndicator：旋转器 + 当前操作 + 计时 |
| 工具调用展示 | 无 | 可折叠的工具卡片（读取文件/执行命令/写入文件等） |

## 组件层次结构（Kilocode v5 对照）

```
ChatView                        ← 主容器（flex column 布局）
├── TaskHeader                  ← 粘性头部（标题 + 统计 + 压缩按钮）
├── chat-messages-wrapper       ← flex: 1 滚动区域包装
│   └── MessageList             ← 可滚动消息列表
│       ├── (空态) WelcomeState ← Logo + 欢迎文案 + 最近会话 + 反馈
│       ├── SessionTurn[]       ← 每个用户消息为一个 Turn
│       │   ├── UserMessage     ← 用户消息卡片（头像 + 文本 + 附件 + 撤回按钮）
│       │   └── AssistantBlock  ← 助手回复（多Part渲染）
│       │       ├── TextPart    ← Markdown 文本
│       │       └── ToolPart    ← 工具调用卡片
│       └── WorkingIndicator    ← "正在思考..." + 旋转器 + 计时
├── chat-input                  ← 底部输入区域
│   ├── NewTaskButton           ← "新对话" 按钮行
│   └── PromptInput             ← 核心输入组件
│       ├── textarea            ← 自适应高度文本框
│       └── hint-bar            ← 底部选择器（模式 + 模型 + 发送按钮）
└── scroll-to-bottom-button     ← 浮动按钮
```

## 分阶段实施方案

> [!IMPORTANT]
> 所有组件使用**模拟数据**驱动，不依赖真实后端。通过 `createSignal` 创建假数据用于展示，确保视觉层完整可交互。

---

### Phase 1：布局骨架 + 样式系统

重建 CSS 基础，从 Kilocode 的 `chat.css` 中提取核心布局和组件样式。

#### [MODIFY] [chat.css](file:///g:/AboutDEV/dogcode/dogcode/webview-ui/src/styles/chat.css)

新建独立的 `chat.css`，从 `main.css` 中分离聊天相关样式。内容包括：

- **布局层**：`.chat-view` / `.chat-messages-wrapper` / `.chat-messages` / `.chat-input` 的 flex 布局
- **TaskHeader**：`[data-component="task-header"]` 粘性头部样式
- **消息列表**：`.message-list-container` / `.message-list` 滚动区域
- **空态**：`.message-list-empty` / `.kilo-logo` / `.recent-sessions`
- **SessionTurn**：`.vscode-session-turn` / `.vscode-session-turn-user` / `.vscode-session-turn-assistant`
- **输入框**：`.prompt-input-container` / `.prompt-input` / `.prompt-input-hint`
- **工作指示器**：`.working-indicator`
- **浮动按钮**：`.scroll-to-bottom-button`

---

### Phase 2：核心组件

#### [NEW] `webview-ui/src/components/chat/TaskHeader.tsx`

粘性头部组件，显示：
- 会话标题（ellipsis 溢出）
- 统计数据栏（费用 / Token 用量 / 压缩按钮）
- 使用模拟数据（`$0.05` / `1.2k tokens (8%)` ）

#### [NEW] `webview-ui/src/components/chat/MessageList.tsx`

核心消息列表，实现：
- 自动滚动逻辑（`createAutoScroll` hook）
- 空态渲染（Logo + 欢迎文案 + 最近会话按钮列表）
- 消息遍历：`For each={userMessages} → <SessionTurn>`
- WorkingIndicator 渲染
- "跳到底部" 浮动按钮

#### [NEW] `webview-ui/src/components/chat/SessionTurn.tsx`

Turn 组件（一个用户消息 + 其所有助手回复），包含：
- **UserMessage**：用户头像 + 消息文本 + 撤回按钮（hover显示）
- **AssistantBlock**：助手回复内容列表
  - `TextPart`：渲染 Markdown 文本
  - `ToolPart`：可折叠工具调用卡片

#### [NEW] `webview-ui/src/components/chat/PromptInput.tsx`

核心输入区域，包含：
- 自适应高度 textarea
- ghost text overlay 层（占位符 + 文件@提及高亮）
- 底部 hint bar：模式选择器 + 模型选择器 + 增强按钮 + 发送/停止按钮
- Enter 发送 / Shift+Enter 换行
- 拖拽区域样式（图片附件占位）

#### [NEW] `webview-ui/src/components/chat/WorkingIndicator.tsx`

工作指示器，显示：
- 旋转动画 Spinner
- 当前操作文本（"正在读取文件..."）
- 已用时间（tabular-nums 字体）

---

### Phase 3：自动滚动 Hook + 辅助组件

#### [NEW] `webview-ui/src/hooks/useAutoScroll.ts`

自动滚动逻辑（复刻 `createAutoScroll`）：
- 追踪用户是否手动滚动过
- 工作状态变化时自动滚到底部
- 暴露 `scrollRef` / `contentRef` / `userScrolled` / `resume()` / `handleScroll()`

#### [NEW] `webview-ui/src/components/chat/WelcomeState.tsx`

空态组件：Logo + 欢迎文案 + 最近会话（模拟 3 条）+ 反馈按钮

---

### Phase 4：整合到 ChatView

#### [MODIFY] `webview-ui/src/components/ChatView.tsx`

重写为：
```tsx
<div class="chat-view">
  <TaskHeader />
  <div class="chat-messages-wrapper">
    <div class="chat-messages">
      <MessageList />
    </div>
  </div>
  <div class="chat-input">
    <NewTaskButton />
    <PromptInput />
  </div>
</div>
```

使用模拟数据驱动所有状态（消息列表、工作状态、费用等）。

---

## 模拟数据设计

```typescript
// 模拟消息数据结构（对齐 Kilocode SDK 类型）
interface MockMessage {
  id: string
  role: "user" | "assistant"
  text: string
  parts: MockPart[]
  timestamp: number
}

interface MockPart {
  id: string
  type: "text" | "tool"
  text?: string           // type=text 时
  tool?: string           // type=tool 时（read_file / write_to_file / execute_command）
  toolInput?: Record<string, unknown>
  toolOutput?: string
  status?: "pending" | "running" | "complete" | "error"
}
```

预置一组模拟对话，包含：
1. 用户提问："分析项目结构"
2. 助手回复：文本 + read_file 工具调用 + 文本总结
3. 用户跟问："重构 utils.ts"
4. 助手回复：文本 + write_to_file 工具调用 + execute_command 工具调用

---

## 文件清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `webview-ui/src/styles/chat.css` | **NEW** | 聊天专用样式（从 Kilocode 适配） |
| `webview-ui/src/styles/main.css` | **MODIFY** | 引入 chat.css，移除旧聊天样式 |
| `webview-ui/src/hooks/useAutoScroll.ts` | **NEW** | 自动滚动 Hook |
| `webview-ui/src/components/chat/TaskHeader.tsx` | **NEW** | 头部组件 |
| `webview-ui/src/components/chat/MessageList.tsx` | **NEW** | 消息列表 |
| `webview-ui/src/components/chat/SessionTurn.tsx` | **NEW** | Turn 组件（用户 + 助手） |
| `webview-ui/src/components/chat/PromptInput.tsx` | **NEW** | 输入组件 |
| `webview-ui/src/components/chat/WorkingIndicator.tsx` | **NEW** | 工作指示器 |
| `webview-ui/src/components/chat/WelcomeState.tsx` | **NEW** | 空态 |
| `webview-ui/src/components/chat/mock-data.ts` | **NEW** | 模拟数据 |
| `webview-ui/src/components/ChatView.tsx` | **MODIFY** | 重写为组合所有子组件 |

## 验证计划

### 自动化
- `node esbuild.js` 编译通过，无错误

### 手动验证（F5 启动扩展调试）
1. 空态：Logo + 欢迎文案 + 最近会话列表正确渲染
2. 有消息：多组 Turn（用户卡片 + 助手文本 + 工具卡片）正确渲染
3. 输入框：自适应高度 + Enter发送 + 底部选择器栏正确显示
4. 自动滚动：消息滚到底部 + 浮动按钮正确出现/消失
5. 头部：标题 + 费用 + Token显示，压缩按钮可点击
6. 主题适配：深色/浅色主题下样式正确

## Open Questions

> [!IMPORTANT]
> 1. **Logo 资源**：dogcode 在 `assets/icons/` 下是否已有 SVG Logo？还是需要创建？当前使用 emoji `✦` 作为占位。
> 2. **工具卡片的图标**：是否使用 codicon（VS Code 内置图标），还是自行提供 SVG？
