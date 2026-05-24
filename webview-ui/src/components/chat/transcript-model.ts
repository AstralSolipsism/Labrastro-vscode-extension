import type { TraceNodeKind, TraceNodeStatus, ToolExecutionStatus } from "../../types/trace"
import type { ShellOutputChunk } from "../../utils/shell-tool-output"
import type { MockSessionKind, MockSessionState } from "./mock-data"

export type TranscriptTextFormat = "plain" | "markdown"
export type TranscriptOutputFormat = TranscriptTextFormat | "terminal" | "json"
export type NoticeLevel = "info" | "warning" | "error"

export interface TranscriptMeta {
  id: string
  eventKey?: string
  sessionEventSeq?: number
  historyCutIndex?: number
  traceNodeId?: string
  traceNodeKind?: TraceNodeKind
  traceNodeStatus?: TraceNodeStatus
}

export interface AssistantTextItem extends TranscriptMeta {
  type: "assistant_text"
  markdown: string
  format?: TranscriptTextFormat
  streaming?: boolean
  streamKey?: string
}

export interface ThinkingItem extends TranscriptMeta {
  type: "thinking"
  title: string
  detail?: string
  active?: boolean
  raw?: string
  streamKey?: string
}

export interface ReasoningItem extends TranscriptMeta {
  type: "reasoning"
  summary?: string
  raw?: string
  format?: TranscriptTextFormat
}

export interface ToolActivityItem extends TranscriptMeta {
  type: "tool"
  tool: string
  status?: ToolExecutionStatus
  title?: string
  subtitle?: string
  toolCallId?: string
  source?: string
  input?: Record<string, unknown>
  output?: string
  outputFormat?: TranscriptOutputFormat
  stream?: string
  outputChunks?: ShellOutputChunk[]
  finalOutput?: string
  outputTruncated?: boolean
  resultMeta?: Record<string, unknown>
  preparingIndex?: number
  startedAt?: number
  endedAt?: number
  approvalId?: string
  approvalReason?: string
  approvalResultReason?: string
  approvalDecision?: string
  approvalSections?: Record<string, unknown>[]
  approvalContent?: string
}

export interface NoticeItem extends TranscriptMeta {
  type: "notice"
  level: NoticeLevel
  text: string
  format?: TranscriptTextFormat
}

export interface TraceItem extends TranscriptMeta {
  type: "trace"
  title?: string
  text?: string
}

export interface SessionItem extends TranscriptMeta {
  type: "session"
  sessionId?: string
  title?: string
  kind?: MockSessionKind
  state?: MockSessionState
  summary?: string
}

export interface TerminalItem extends TranscriptMeta {
  type: "terminal"
  title?: string
  content?: string
}

export interface ViewItem extends TranscriptMeta {
  type: "view"
  title?: string
  viewType?: string
  level?: string
  payload?: Record<string, unknown>
}

export interface ContextEventItem extends TranscriptMeta {
  type: "context_event"
  title?: string
  payload?: Record<string, unknown>
}

export interface MemoryContextItem extends TranscriptMeta {
  type: "memory_context"
  title?: string
  payload?: Record<string, unknown>
}

export interface UiEventItem extends TranscriptMeta {
  type: "ui_event"
  kind?: string
  level?: string
  title?: string
  payload?: Record<string, unknown>
}

export interface ParallelTranscriptItem extends TranscriptMeta {
  type: "parallel_tools" | "parallel_sessions"
  title?: string
  summary?: string
  groupId?: string
  items?: TranscriptItem[]
}

export type TranscriptItem =
  | AssistantTextItem
  | ThinkingItem
  | ReasoningItem
  | ToolActivityItem
  | NoticeItem
  | TraceItem
  | SessionItem
  | TerminalItem
  | ViewItem
  | ContextEventItem
  | MemoryContextItem
  | UiEventItem
  | ParallelTranscriptItem
