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
  rawEventRefs?: RawEventRef[]
}

export interface RawEventRef {
  agent_run_id?: string
  seq?: number
  type?: string
  id?: string
  [key: string]: unknown
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
  toolId?: string
  risk?: string
  exposure?: string
  capabilityName?: string
  source?: string
  input?: Record<string, unknown>
  output?: string
  outputFormat?: TranscriptOutputFormat
  stream?: string
  outputChunks?: ShellOutputChunk[]
  finalOutput?: string
  outputTruncated?: boolean
  resultMeta?: Record<string, unknown>
  searchTrace?: Record<string, unknown>
  executeTrace?: Record<string, unknown>
  preparingIndex?: number
  startedAt?: number
  endedAt?: number
  approvalId?: string
  approvalReason?: string
  approvalIntent?: string
  approvalResultReason?: string
  approvalDecision?: string
  approvalSections?: Record<string, unknown>[]
  approvalContent?: string
}

export type FileChangeStatus = "in_progress" | "completed" | "failed" | "declined" | "cancelled"

export interface FileChangeEntry {
  path?: string
  kind?: "add" | "update" | "delete" | "move" | string
  diff?: string
  move_path?: string
  movePath?: string
}

export interface FileChangeItem extends TranscriptMeta {
  type: "file_change"
  itemId: string
  toolCallId?: string
  status: FileChangeStatus
  changes: FileChangeEntry[]
  diff?: string
  path?: string
  addedLines?: number
  removedLines?: number
  patchPreview?: string
  approvalId?: string
  approvalReason?: string
  approvalDecision?: string
  approvalResultReason?: string
  durationMs?: number
  error?: string
}

export type DocumentDraftStatus =
  | "declared"
  | "streaming"
  | "stalled"
  | "recoverable"
  | "committing"
  | "committed"
  | "cancelled"
  | "failed"

export interface DocumentDraftItem extends TranscriptMeta {
  type: "document_draft"
  draftId: string
  targetPath?: string
  title?: string
  format?: "markdown" | string
  status: DocumentDraftStatus
  itemId?: string
  approvalId?: string
  contentLength?: number
  contentSha256?: string
  lastChunkSeq?: number
  snapshotKind?: string
  snapshotFinal?: boolean
  error?: string
  reason?: string
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

export type TranscriptLane = "primary" | "process" | "reasoning" | "diagnostic"
export type WorkflowItemStatus = "running" | "done" | "warning" | "error" | "cancelled"

export interface WorkflowStepItem extends TranscriptMeta {
  type: "workflow_step"
  lane: "process"
  workflow: string
  stage: string
  status: WorkflowItemStatus
  title?: string
  summary?: string
  details?: Record<string, unknown>
  payload?: Record<string, unknown>
}

export interface WorkflowArtifactItem extends TranscriptMeta {
  type: "workflow_artifact"
  lane: "primary"
  workflow: string
  artifactType: string
  title?: string
  summary?: string
  artifact: Record<string, unknown>
  payload?: Record<string, unknown>
}

export interface WorkflowDecisionAction {
  id: string
  label: string
  tone?: "primary" | "danger" | "secondary"
}

export interface WorkflowDecisionItem extends TranscriptMeta {
  type: "workflow_decision"
  lane: "primary"
  workflow: string
  decisionType: string
  status: WorkflowItemStatus | "pending" | "approved" | "denied"
  title?: string
  summary?: string
  review: Record<string, unknown>
  actions?: WorkflowDecisionAction[]
  approvalId?: string
  toolCallId?: string
  decision?: string
  resultReason?: string
  payload?: Record<string, unknown>
}

export interface WorkflowResultItem extends TranscriptMeta {
  type: "workflow_result"
  lane: "primary"
  workflow: string
  resultType?: string
  status: WorkflowItemStatus
  title?: string
  summary?: string
  result?: Record<string, unknown>
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
  | FileChangeItem
  | DocumentDraftItem
  | NoticeItem
  | TraceItem
  | SessionItem
  | TerminalItem
  | ViewItem
  | ContextEventItem
  | WorkflowStepItem
  | WorkflowArtifactItem
  | WorkflowDecisionItem
  | WorkflowResultItem
  | MemoryContextItem
  | UiEventItem
  | ParallelTranscriptItem
