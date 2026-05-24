/**
 * Trace Graph 领域模型与共享元数据。
 *
 * 这一层的目标是：
 * 1. 统一节点/边/状态的类型定义
 * 2. 提供中英标签与视觉元信息
 * 3. 为聊天页、TraceRibbon、AgentManager 复用同一套语义基础
 */

export const TRACE_LOCALES = ["zh-CN", "en-US"] as const
export type TraceLocale = (typeof TRACE_LOCALES)[number]

export const TRACE_NODE_CATEGORIES = [
  "reasoning",
  "conversation",
  "execution",
  "control",
] as const
export type TraceNodeCategory = (typeof TRACE_NODE_CATEGORIES)[number]

export const TRACE_NODE_KINDS = [
  "thought_summary",
  "plan_update",
  "decision",
  "user_message",
  "assistant_message",
  "tool_call",
  "tool_result",
  "command_run",
  "file_edit",
  "rollback",
  "fork",
  "delegated_run_spawn",
  "task_dispatch",
] as const
export type TraceNodeKind = (typeof TRACE_NODE_KINDS)[number]

export const TRACE_NODE_STATUSES = [
  "queued",
  "active",
  "streaming",
  "returned",
  "success",
  "error",
  "cancelled",
  "abandoned",
  "rewound",
] as const
export type TraceNodeStatus = (typeof TRACE_NODE_STATUSES)[number]

export const TRACE_INTERACTION_STATES = [
  "selected",
  "hovered",
  "dimmed",
] as const
export type TraceInteractionState = (typeof TRACE_INTERACTION_STATES)[number]

export const TRACE_EDGE_KINDS = [
  "sequential",
  "fork",
  "delegated_run",
  "rollback",
  "return",
  "abandoned",
  "focus",
] as const
export type TraceEdgeKind = (typeof TRACE_EDGE_KINDS)[number]

export const TRACE_BRANCH_KINDS = ["main", "fork", "delegated_run"] as const
export type TraceBranchKind = (typeof TRACE_BRANCH_KINDS)[number]

export const TRACE_BRANCH_STATES = [
  "active",
  "idle",
  "abandoned",
  "merged",
] as const
export type TraceBranchState = (typeof TRACE_BRANCH_STATES)[number]

export const TRACE_VIEW_MODES = ["compact", "expanded"] as const
export type TraceViewMode = (typeof TRACE_VIEW_MODES)[number]

export const TRACE_NAVIGATION_INTENTS = [
  "inspect",
  "fork",
  "rollback",
  "delegated_run",
] as const
export type TraceNavigationIntent = (typeof TRACE_NAVIGATION_INTENTS)[number]

export const TOOL_EXECUTION_STATUSES = [
  "preparing",
  "pending",
  "running",
  "awaiting_approval",
  "approved",
  "denied",
  "returned",
  "protocol_error",
  "error",
  "cancelled",
] as const
export type ToolExecutionStatus = (typeof TOOL_EXECUTION_STATUSES)[number]

export type TraceNodeShape =
  | "circle"
  | "rounded-rect"
  | "square"
  | "diamond"
  | "double-circle"
  | "hexagon"
  | "octagon"

export type TraceMotionPreset =
  | "idle"
  | "queued"
  | "active"
  | "streaming"
  | "returned"
  | "success"
  | "error"
  | "cancelled"
  | "abandoned"
  | "rewound"

export interface TraceSession {
  id: string
  title: string
  workspaceDirectory?: string
  mode: "sidebar" | "panel"
}

export interface TraceGraphUIState {
  activeNodeId: string | null
  selectedNodeId: string | null
  focusedBranchId: string | null
  showInspector: boolean
  showMiniMap: boolean
  viewMode: TraceViewMode
}

export interface TraceNavigationPayload {
  branchId?: string
  nodeId?: string
  sessionId?: string
  intent?: TraceNavigationIntent
}

export interface TraceBranch {
  id: string
  parentBranchId?: string
  forkNodeId?: string
  lane: number
  depth: number
  kind: TraceBranchKind
  state: TraceBranchState
  labelKey: string
}

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
  parallelGroupId?: string
  dispatchNodeId?: string
  returnToNodeId?: string
  concurrencyIndex?: number
  concurrencyTotal?: number
  transcriptAnchorId?: string
  title: string
  summary?: string
  meta?: Record<string, unknown>
}

export interface TraceEdge {
  id: string
  kind: TraceEdgeKind
  source: string
  target: string
  branchId: string
  emphasis?: "normal" | "strong" | "muted"
}

export interface TraceI18nDictionary {
  categories: Record<TraceNodeCategory, string>
  statuses: Record<TraceNodeStatus, string>
  interactionStates: Record<TraceInteractionState, string>
  edgeKinds: Record<TraceEdgeKind, string>
  nodeKinds: Record<TraceNodeKind, string>
  toolStatuses: Record<ToolExecutionStatus, string>
}

export type TraceGraphI18n = Record<TraceLocale, TraceI18nDictionary>

export interface TraceGraphPayload {
  version: "1.0.0"
  locale: TraceLocale
  session: TraceSession
  ui: TraceGraphUIState
  i18n: TraceGraphI18n
  branches: TraceBranch[]
  nodes: TraceNode[]
  edges: TraceEdge[]
}

export interface TraceCategoryMeta {
  colorToken: string
  className: string
}

export interface TraceKindMeta {
  category: TraceNodeCategory
  shape: TraceNodeShape
  className: string
  shortLabel: Record<TraceLocale, string>
}

export interface TraceStatusMeta {
  motion: TraceMotionPreset
  className: string
  isTerminal: boolean
}

export interface TraceNodeClassInput {
  category?: TraceNodeCategory
  kind: TraceNodeKind
  status: TraceNodeStatus
}

export interface TraceNodeClassOptions {
  selected?: boolean
  hovered?: boolean
  dimmed?: boolean
}

export const TRACE_I18N: TraceGraphI18n = {
  "zh-CN": {
    categories: {
      reasoning: "思考 / 推理",
      conversation: "对话 / 发言",
      execution: "执行 / 操作",
      control: "控制流 / 分支控制",
    },
    statuses: {
      queued: "待执行 / 排队中",
      active: "进行中 / 当前活跃",
      streaming: "流式输出中",
      returned: "已返回",
      success: "已完成",
      error: "异常 / 失败",
      cancelled: "已取消",
      abandoned: "已废弃 / 已放弃",
      rewound: "已回退",
    },
    interactionStates: {
      selected: "已选中",
      hovered: "悬停中",
      dimmed: "已降噪",
    },
    edgeKinds: {
      sequential: "顺序边",
      fork: "分叉边",
      delegated_run: "委托运行边",
      rollback: "回退边",
      return: "返回边",
      abandoned: "废弃边",
      focus: "聚焦边",
    },
    nodeKinds: {
      thought_summary: "思考摘要",
      plan_update: "计划更新",
      decision: "决策点",
      user_message: "用户消息",
      assistant_message: "助手回复",
      tool_call: "工具调用",
      tool_result: "工具结果",
      command_run: "命令执行",
      file_edit: "文件修改",
      rollback: "回退",
      fork: "分叉",
      delegated_run_spawn: "委托运行分发",
      task_dispatch: "任务派发",
    },
    toolStatuses: {
      preparing: "准备中",
      pending: "等待中",
      running: "执行中",
      awaiting_approval: "等待批准",
      approved: "已批准",
      denied: "已拒绝",
      returned: "已返回",
      protocol_error: "协议错误",
      error: "失败",
      cancelled: "已取消",
    },
  },
  "en-US": {
    categories: {
      reasoning: "Reasoning",
      conversation: "Conversation",
      execution: "Execution",
      control: "Control Flow",
    },
    statuses: {
      queued: "Queued",
      active: "Active",
      streaming: "Streaming",
      returned: "Returned",
      success: "Success",
      error: "Error",
      cancelled: "Cancelled",
      abandoned: "Abandoned",
      rewound: "Rewound",
    },
    interactionStates: {
      selected: "Selected",
      hovered: "Hovered",
      dimmed: "Dimmed",
    },
    edgeKinds: {
      sequential: "Sequential",
      fork: "Fork",
      delegated_run: "Delegated Run",
      rollback: "Rollback",
      return: "Return",
      abandoned: "Abandoned",
      focus: "Focus",
    },
    nodeKinds: {
      thought_summary: "Thought Summary",
      plan_update: "Plan Update",
      decision: "Decision",
      user_message: "User Message",
      assistant_message: "Assistant Message",
      tool_call: "Tool Call",
      tool_result: "Tool Result",
      command_run: "Command Run",
      file_edit: "File Edit",
      rollback: "Rollback",
      fork: "Fork",
      delegated_run_spawn: "Delegated Run Spawn",
      task_dispatch: "Task Dispatch",
    },
    toolStatuses: {
      preparing: "Preparing",
      pending: "Pending",
      running: "Running",
      awaiting_approval: "Awaiting approval",
      approved: "Approved",
      denied: "Denied",
      returned: "Returned",
      protocol_error: "Protocol error",
      error: "Error",
      cancelled: "Cancelled",
    },
  },
}

export const TRACE_CATEGORY_META: Record<TraceNodeCategory, TraceCategoryMeta> = {
  reasoning: {
    colorToken: "--trace-reasoning",
    className: "trace-category--reasoning",
  },
  conversation: {
    colorToken: "--trace-conversation",
    className: "trace-category--conversation",
  },
  execution: {
    colorToken: "--trace-execution",
    className: "trace-category--execution",
  },
  control: {
    colorToken: "--trace-control",
    className: "trace-category--control",
  },
}

export const TRACE_KIND_META: Record<TraceNodeKind, TraceKindMeta> = {
  thought_summary: {
    category: "reasoning",
    shape: "circle",
    className: "trace-node--shape-circle trace-node--kind-thought-summary",
    shortLabel: {
      "zh-CN": "思",
      "en-US": "TH",
    },
  },
  plan_update: {
    category: "reasoning",
    shape: "circle",
    className: "trace-node--shape-circle trace-node--kind-plan-update",
    shortLabel: {
      "zh-CN": "计",
      "en-US": "PL",
    },
  },
  decision: {
    category: "reasoning",
    shape: "diamond",
    className: "trace-node--shape-diamond trace-node--kind-decision",
    shortLabel: {
      "zh-CN": "决",
      "en-US": "DS",
    },
  },
  user_message: {
    category: "conversation",
    shape: "rounded-rect",
    className: "trace-node--shape-rounded-rect trace-node--kind-user-message",
    shortLabel: {
      "zh-CN": "问",
      "en-US": "U",
    },
  },
  assistant_message: {
    category: "conversation",
    shape: "rounded-rect",
    className: "trace-node--shape-rounded-rect trace-node--kind-assistant-message",
    shortLabel: {
      "zh-CN": "答",
      "en-US": "AI",
    },
  },
  tool_call: {
    category: "execution",
    shape: "square",
    className: "trace-node--shape-square trace-node--kind-tool-call",
    shortLabel: {
      "zh-CN": "调",
      "en-US": "TC",
    },
  },
  tool_result: {
    category: "execution",
    shape: "square",
    className: "trace-node--shape-square trace-node--kind-tool-result",
    shortLabel: {
      "zh-CN": "工",
      "en-US": "TR",
    },
  },
  command_run: {
    category: "execution",
    shape: "square",
    className: "trace-node--shape-square trace-node--kind-command-run",
    shortLabel: {
      "zh-CN": "命",
      "en-US": "CMD",
    },
  },
  file_edit: {
    category: "execution",
    shape: "square",
    className: "trace-node--shape-square trace-node--kind-file-edit",
    shortLabel: {
      "zh-CN": "改",
      "en-US": "ED",
    },
  },
  rollback: {
    category: "control",
    shape: "diamond",
    className: "trace-node--shape-diamond trace-node--kind-rollback",
    shortLabel: {
      "zh-CN": "回",
      "en-US": "RB",
    },
  },
  fork: {
    category: "control",
    shape: "diamond",
    className: "trace-node--shape-diamond trace-node--kind-fork",
    shortLabel: {
      "zh-CN": "叉",
      "en-US": "FK",
    },
  },
  delegated_run_spawn: {
    category: "control",
    shape: "hexagon",
    className: "trace-node--shape-hexagon trace-node--kind-delegated_run",
    shortLabel: {
      "zh-CN": "委",
      "en-US": "DR",
    },
  },
  task_dispatch: {
    category: "control",
    shape: "octagon",
    className: "trace-node--shape-octagon trace-node--kind-task-dispatch",
    shortLabel: {
      "zh-CN": "派",
      "en-US": "TD",
    },
  },
}

export const TRACE_STATUS_META: Record<TraceNodeStatus, TraceStatusMeta> = {
  queued: {
    motion: "queued",
    className: "trace-node--queued",
    isTerminal: false,
  },
  active: {
    motion: "active",
    className: "trace-node--active",
    isTerminal: false,
  },
  streaming: {
    motion: "streaming",
    className: "trace-node--streaming",
    isTerminal: false,
  },
  returned: {
    motion: "returned",
    className: "trace-node--returned",
    isTerminal: true,
  },
  success: {
    motion: "success",
    className: "trace-node--success",
    isTerminal: true,
  },
  error: {
    motion: "error",
    className: "trace-node--error",
    isTerminal: true,
  },
  cancelled: {
    motion: "cancelled",
    className: "trace-node--cancelled",
    isTerminal: true,
  },
  abandoned: {
    motion: "abandoned",
    className: "trace-node--abandoned",
    isTerminal: true,
  },
  rewound: {
    motion: "rewound",
    className: "trace-node--rewound",
    isTerminal: true,
  },
}

export const TRACE_EDGE_CLASS_MAP: Record<TraceEdgeKind, string> = {
  sequential: "trace-edge--sequential",
  fork: "trace-edge--fork",
  delegated_run: "trace-edge--delegated_run",
  rollback: "trace-edge--rollback",
  return: "trace-edge--return",
  abandoned: "trace-edge--abandoned",
  focus: "trace-edge--focus",
}

export const TOOL_STATUS_TO_TRACE_STATUS: Record<ToolExecutionStatus, TraceNodeStatus> = {
  preparing: "active",
  pending: "queued",
  running: "active",
  awaiting_approval: "active",
  approved: "active",
  denied: "cancelled",
  returned: "returned",
  protocol_error: "error",
  error: "error",
  cancelled: "cancelled",
}

export function getTraceDictionary(locale: TraceLocale = "zh-CN"): TraceI18nDictionary {
  return TRACE_I18N[locale]
}

export function getTraceNodeKindLabel(
  kind: TraceNodeKind,
  locale: TraceLocale = "zh-CN"
): string {
  return TRACE_I18N[locale].nodeKinds[kind]
}

export function getTraceNodeCategory(kind: TraceNodeKind): TraceNodeCategory {
  return TRACE_KIND_META[kind].category
}

export function getTraceNodeShortLabel(
  kind: TraceNodeKind,
  locale: TraceLocale = "zh-CN"
): string {
  return TRACE_KIND_META[kind].shortLabel[locale]
}

export function getTraceStatusLabel(
  status: TraceNodeStatus,
  locale: TraceLocale = "zh-CN"
): string {
  return TRACE_I18N[locale].statuses[status]
}

export function getToolExecutionStatusLabel(
  status: ToolExecutionStatus,
  locale: TraceLocale = "zh-CN"
): string {
  return TRACE_I18N[locale].toolStatuses[status]
}

export function getTraceNavigationIntentLabel(
  intent: TraceNavigationIntent,
  locale: TraceLocale = "zh-CN"
): string {
  const labels: Record<TraceLocale, Record<TraceNavigationIntent, string>> = {
    "zh-CN": {
      inspect: "查看节点",
      fork: "从此 Fork",
      rollback: "回退到此",
      delegated_run: "派发委托运行",
    },
    "en-US": {
      inspect: "Inspect",
      fork: "Fork From Here",
      rollback: "Rollback To Here",
      delegated_run: "Spawn Delegated Run",
    },
  }

  return labels[locale][intent]
}

export function inferTraceNodeKindFromToolName(toolName?: string): TraceNodeKind {
  switch (toolName) {
    case "read_file":
    case "list_directory":
    case "search_files":
      return "tool_call"
    case "execute_command":
    case "run_terminal_cmd":
      return "command_run"
    case "write_to_file":
    case "replace_in_file":
    case "apply_patch":
      return "file_edit"
    case "delegate_agent":
      return "delegated_run_spawn"
    case "fork_task":
    case "fork_session":
      return "fork"
    case "rollback_to_checkpoint":
    case "revert_to_checkpoint":
      return "rollback"
    default:
      return "tool_call"
  }
}

export function getTraceNodeClassName(
  descriptor: TraceNodeClassInput,
  options: TraceNodeClassOptions = {}
): string {
  const category = descriptor.category ?? getTraceNodeCategory(descriptor.kind)
  const classes = [
    "trace-node",
    TRACE_CATEGORY_META[category].className,
    TRACE_KIND_META[descriptor.kind].className,
    TRACE_STATUS_META[descriptor.status].className,
  ]

  if (options.selected) classes.push("trace-node--selected")
  if (options.hovered) classes.push("trace-node--hovered")
  if (options.dimmed) classes.push("trace-node--dimmed")

  return classes.join(" ")
}

export function isTerminalTraceStatus(status: TraceNodeStatus): boolean {
  return TRACE_STATUS_META[status].isTerminal
}

export function isActiveTraceStatus(status: TraceNodeStatus): boolean {
  return status === "active" || status === "streaming"
}
