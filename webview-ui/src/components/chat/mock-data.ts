import type {
  TraceEdge,
  TraceGraphUIState,
  TraceNode,
  TraceNodeKind,
  TraceNodeStatus,
  ToolExecutionStatus,
} from "../../types/trace"
import type { TimelineEvent } from "./TaskTimeline"

export type MockSessionKind = "main" | "fork" | "subagent"
export type MockSessionState = "active" | "success" | "streaming" | "abandoned" | "cancelled" | "error"

export interface MockPart {
  id: string
  type: "text" | "tool" | "trace" | "session" | "remote_status" | "terminal" | "view" | "context_event" | "ui_event" | "parallel_tools" | "parallel_sessions"
  text?: string
  textFormat?: "plain" | "markdown"
  textStreamKey?: string
  tool?: string
  toolCallId?: string
  toolSource?: string
  toolInput?: Record<string, unknown>
  toolOutput?: string
  toolOutputFormat?: "plain" | "markdown" | "terminal" | "json"
  toolStream?: string
  toolResultMeta?: Record<string, unknown>
  toolStartedAt?: number
  toolEndedAt?: number
  approvalId?: string
  approvalReason?: string
  approvalDecision?: string
  approvalSections?: Record<string, unknown>[]
  approvalContent?: string
  status?: ToolExecutionStatus
  remotePeerId?: string
  remoteSessionId?: string
  remoteFingerprint?: string
  remoteMode?: string
  remoteModel?: string
  remoteWorkspaceRoot?: string
  terminalTitle?: string
  terminalContent?: string
  viewTitle?: string
  viewType?: string
  viewLevel?: string
  viewPayload?: Record<string, unknown>
  contextTitle?: string
  contextPayload?: Record<string, unknown>
  uiEventKind?: string
  uiEventLevel?: string
  uiEventTitle?: string
  uiEventPayload?: Record<string, unknown>
  parallelTitle?: string
  parallelSummary?: string
  parallelItems?: MockPart[]
  parallelGroupId?: string
  traceNodeId?: string
  traceNodeKind?: TraceNodeKind
  traceNodeStatus?: TraceNodeStatus
  traceTitle?: string
  sessionId?: string
  sessionTitle?: string
  sessionKind?: MockSessionKind
  sessionState?: MockSessionState
  sessionSummary?: string
}

export interface MockMessage {
  id: string
  role: "user" | "assistant"
  text: string
  parts: MockPart[]
  timestamp: number
  traceNodeId?: string
  traceNodeKind?: TraceNodeKind
  traceNodeStatus?: TraceNodeStatus
}

export interface MockTurn {
  userMessage: MockMessage
  assistantMessages: MockMessage[]
}

export interface MockSession {
  id: string
  title: string
  updatedAt: string
  kind?: MockSessionKind
  state?: MockSessionState
  parentSessionId?: string
  sourceSessionId?: string
  sourceNodeId?: string
  returnNodeId?: string
  summary?: string
}

export interface MockTaskStats {
  taskText: string
  tokensIn: number
  tokensOut: number
  cacheReads: number | null
  cacheWrites: number | null
  totalCost: number | null
  costStatus?: "available" | "unavailable" | "unknown"
  contextTokens: number
  contextWindow: number
  maxOutputTokens: number
  model?: string
  mode?: string
  runStatus?: "idle" | "running" | "stopping" | "cancelled" | "done" | "error"
}

export interface MockSessionBundle {
  session: MockSession
  stats: MockTaskStats
  turns: MockTurn[]
  traceNodes: TraceNode[]
  traceEdges: TraceEdge[]
  traceUI: TraceGraphUIState
}

const now = new Date("2026-04-26T08:00:00.000Z").toISOString()

export const mockRecentSessions: MockSession[] = [
  {
    id: "s1",
    title: "验证 dogcode 侧边栏 MVP",
    updatedAt: now,
    kind: "main",
    state: "active",
    summary: "保留聊天主路径，DAG 只作为轻量轨迹摘要展示。",
  },
]

export const mockStats: MockTaskStats = {
  taskText: "精简 dogcode 前端侧边栏，去掉重型 DAG 和冗余装饰。",
  tokensIn: 18240,
  tokensOut: 4120,
  cacheReads: 32000,
  cacheWrites: 8400,
  totalCost: 0.083,
  contextTokens: 62800,
  contextWindow: 200000,
  maxOutputTokens: 16000,
}

export const mockTimelineEvents: TimelineEvent[] = [
  { id: "timeline-1", type: "user", label: "需求", contentLength: 96, durationMs: 120 },
  { id: "timeline-2", type: "tool", label: "检查", contentLength: 180, durationMs: 480 },
  { id: "timeline-3", type: "write_file", label: "修改", contentLength: 260, durationMs: 720 },
]

export const mockTraceNodes: TraceNode[] = [
  {
    id: "trace-user-1",
    category: "conversation",
    kind: "user_message",
    status: "success",
    branchId: "main",
    lane: 0,
    step: 1,
    startedAt: now,
    transcriptAnchorId: "user-1",
    title: "用户提出前端治理需求",
  },
  {
    id: "trace-plan-1",
    category: "reasoning",
    kind: "plan_update",
    status: "success",
    branchId: "main",
    lane: 0,
    step: 2,
    startedAt: now,
    parentId: "trace-user-1",
    transcriptAnchorId: "part-plan",
    title: "确认 MVP 精简边界",
  },
  {
    id: "trace-tool-1",
    category: "execution",
    kind: "tool_call",
    status: "success",
    branchId: "main",
    lane: 0,
    step: 3,
    startedAt: now,
    parentId: "trace-plan-1",
    transcriptAnchorId: "part-tool-1",
    title: "检查前端目录",
  },
  {
    id: "trace-edit-1",
    category: "execution",
    kind: "file_edit",
    status: "active",
    branchId: "main",
    lane: 0,
    step: 4,
    startedAt: now,
    parentId: "trace-tool-1",
    transcriptAnchorId: "part-tool-2",
    title: "收敛 UI 与样式",
  },
]

export const mockTraceEdges: TraceEdge[] = [
  {
    id: "trace-edge-1",
    kind: "sequential",
    source: "trace-user-1",
    target: "trace-plan-1",
    branchId: "main",
  },
  {
    id: "trace-edge-2",
    kind: "sequential",
    source: "trace-plan-1",
    target: "trace-tool-1",
    branchId: "main",
  },
  {
    id: "trace-edge-3",
    kind: "sequential",
    source: "trace-tool-1",
    target: "trace-edit-1",
    branchId: "main",
    emphasis: "strong",
  },
]

export const mockTraceUI: TraceGraphUIState = {
  activeNodeId: "trace-edit-1",
  selectedNodeId: "trace-edit-1",
  focusedBranchId: "main",
  showInspector: false,
  showMiniMap: false,
  viewMode: "compact",
}

export const mockTurns: MockTurn[] = [
  {
    userMessage: {
      id: "user-1",
      role: "user",
      text: "把 dogcode 前端侧边栏收敛成 MVP，布局和样式对齐 Kilo v5。",
      parts: [],
      timestamp: Date.now() - 120000,
      traceNodeId: "trace-user-1",
      traceNodeKind: "user_message",
      traceNodeStatus: "success",
    },
    assistantMessages: [
      {
        id: "assistant-1",
        role: "assistant",
        text: "",
        parts: [
          {
            id: "part-plan",
            type: "trace",
            traceTitle: "MVP 方向",
            text: "侧边栏保持聊天主路径，完整 DAG 延后到独立深查页。",
            traceNodeId: "trace-plan-1",
            traceNodeKind: "plan_update",
            traceNodeStatus: "success",
          },
          {
            id: "part-tool-1",
            type: "tool",
            tool: "list_directory",
            toolInput: { path: "dogcode-frontend" },
            toolOutput: "已确认 Solid Webview、mock 数据和 Trace 组件位置。",
            status: "complete",
            traceNodeId: "trace-tool-1",
            traceNodeKind: "tool_call",
            traceNodeStatus: "success",
          },
          {
            id: "part-tool-2",
            type: "tool",
            tool: "apply_patch",
            toolInput: { files: ["ChatView.tsx", "chat.css"] },
            toolOutput: "正在收敛布局、图标和轻量轨迹条。",
            status: "running",
            traceNodeId: "trace-edit-1",
            traceNodeKind: "file_edit",
            traceNodeStatus: "active",
          },
          {
            id: "part-text",
            type: "text",
            text: "主对话区会保持紧凑：任务头、消息流、批准条、输入框和底部控制行。",
          },
        ],
        timestamp: Date.now() - 90000,
        traceNodeId: "trace-plan-1",
        traceNodeKind: "assistant_message",
        traceNodeStatus: "success",
      },
    ],
  },
]

export const mockDefaultSessionId = "s1"

export const mockSessionBundles: Record<string, MockSessionBundle> = {
  s1: {
    session: mockRecentSessions[0],
    stats: mockStats,
    turns: mockTurns,
    traceNodes: mockTraceNodes,
    traceEdges: mockTraceEdges,
    traceUI: mockTraceUI,
  },
}

export const mockAllSessions: MockSession[] = [...mockRecentSessions]

export const mockWorkingState = {
  isWorking: false,
  text: "正在处理",
  elapsed: "0:00",
}
