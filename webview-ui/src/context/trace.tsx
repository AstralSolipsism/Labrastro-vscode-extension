import { createContext, useContext, ParentComponent, createMemo, createSignal, onCleanup, onMount } from "solid-js"
import type {
  TraceEdge,
  TraceNavigationIntent,
  TraceNavigationPayload,
  TraceNode,
  ToolExecutionStatus,
} from "../types/trace"
import type {
  MockMessage,
  MockSession,
  MockSessionBundle,
  MockTaskStats,
  MockTurn,
} from "../components/chat/mock-data"
import type {
  TranscriptItem,
  TranscriptOutputFormat,
  TranscriptTextFormat,
} from "../components/chat/transcript-model"
import {
  isLocalDraftSessionId,
  mergeRemoteBundlePreservingLocalContent,
  sessionBundleHasContent,
  shouldIgnoreInitialSessionLoad,
  shouldPreserveExistingSessionContent,
} from "../utils/session-history"
import { buildOrchestrationGraph, getRootSessionId } from "../utils/trace-orchestration"
import { useVSCode, type ExtensionMessage } from "./vscode"

function cloneValue<T>(value: T): T {
  if (typeof structuredClone === "function") {
    return structuredClone(value)
  }

  return JSON.parse(JSON.stringify(value)) as T
}

function buildMockId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

function appendAssistantMessageNearAnchor(
  turns: MockTurn[],
  anchorId: string | undefined,
  message: MockMessage
): MockTurn[] {
  if (!anchorId) {
    if (turns.length === 0) return turns
    const updated = [...turns]
    const lastTurn = updated[updated.length - 1]
    updated[updated.length - 1] = {
      ...lastTurn,
      assistantMessages: [...lastTurn.assistantMessages, message],
    }
    return updated
  }

  const updated = turns.map((turn) => ({
    ...turn,
    assistantMessages: [...turn.assistantMessages],
  }))

  for (let index = 0; index < updated.length; index += 1) {
    const turn = updated[index]
    if (turn.userMessage.id === anchorId) {
      updated[index] = {
        ...turn,
        assistantMessages: [...turn.assistantMessages, message],
      }
      return updated
    }

    const messageMatched = turn.assistantMessages.some((assistantMessage) => {
      if (assistantMessage.id === anchorId) return true
      return assistantMessage.parts.some((part) => part.id === anchorId)
    })

    if (messageMatched) {
      updated[index] = {
        ...turn,
        assistantMessages: [...turn.assistantMessages, message],
      }
      return updated
    }
  }

  if (updated.length === 0) return updated
  const lastTurn = updated[updated.length - 1]
  updated[updated.length - 1] = {
    ...lastTurn,
    assistantMessages: [...lastTurn.assistantMessages, message],
  }
  return updated
}

const EMPTY_STATS: MockTaskStats = {
  taskText: "",
  tokensIn: 0,
  tokensOut: 0,
  cacheReads: null,
  cacheWrites: null,
  totalCost: null,
  costStatus: "unavailable",
  contextTokens: 0,
  contextWindow: 0,
  maxOutputTokens: 0,
  runStatus: "idle",
}

const EMPTY_TRACE_UI: MockSessionBundle["traceUI"] = {
  activeNodeId: null,
  selectedNodeId: null,
  focusedBranchId: "main",
  showInspector: false,
  showMiniMap: false,
  viewMode: "compact",
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : ""
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return undefined
}

function textContentValue(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string") return value
    if (value !== undefined && value !== null) return String(value)
  }
  return ""
}

function firstNonEmptyTextValue(...values: unknown[]): string {
  for (const value of values) {
    if (value === undefined || value === null) continue
    const text = typeof value === "string" ? value : String(value)
    if (text.trim()) return text
  }
  return ""
}

function recordFieldValue(payload: Record<string, unknown>, ...keys: string[]): Record<string, unknown> | undefined {
  for (const key of keys) {
    const record = objectValue(payload[key])
    if (Object.keys(record).length > 0) return record
  }
  return undefined
}

function hasMeaningfulPayloadValue(value: unknown): boolean {
  if (value === undefined || value === null) return false
  if (typeof value === "string") return value.trim().length > 0
  if (typeof value === "number" || typeof value === "boolean") return true
  if (Array.isArray(value)) return value.some(hasMeaningfulPayloadValue)
  if (typeof value === "object") {
    return Object.values(value as Record<string, unknown>).some(hasMeaningfulPayloadValue)
  }
  return false
}

function hasMeaningfulRecord(value: Record<string, unknown> | undefined): boolean {
  if (!value) return false
  return Object.values(value).some(hasMeaningfulPayloadValue)
}

function hasMeaningfulStructuredText(
  payload: Record<string, unknown>,
  structuredPayload: Record<string, unknown> | undefined,
  ...keys: string[]
): boolean {
  const directText = firstNonEmptyTextValue(...keys.map((key) => payload[key])).trim()
  if (directText) return true
  if (!structuredPayload) return false
  return firstNonEmptyTextValue(
    structuredPayload.markdown,
    structuredPayload.content,
    structuredPayload.message,
    structuredPayload.summary,
    structuredPayload.text,
    structuredPayload.rendered_context,
  ).trim().length > 0
}

function arrayFieldValue<T = unknown>(payload: Record<string, unknown>, ...keys: string[]): T[] | undefined {
  for (const key of keys) {
    if (Array.isArray(payload[key])) return payload[key] as T[]
  }
  return undefined
}

function textFormatValue(value: unknown): TranscriptTextFormat | undefined {
  return value === "plain" || value === "markdown" ? value : undefined
}

function outputFormatValue(value: unknown): TranscriptOutputFormat | undefined {
  return value === "plain" || value === "markdown" || value === "terminal" || value === "json"
    ? value
    : undefined
}

function toolStatusValue(value: unknown): ToolExecutionStatus | undefined {
  return value === "preparing" ||
    value === "pending" ||
    value === "running" ||
    value === "awaiting_approval" ||
    value === "approved" ||
    value === "denied" ||
    value === "returned" ||
    value === "error" ||
    value === "cancelled" ||
    value === "protocol_error"
    ? value
    : undefined
}

function sessionItemKindValue(value: unknown): Extract<TranscriptItem, { type: "session" }>["kind"] | undefined {
  return value === "main" || value === "fork" || value === "delegated_run" ? value : undefined
}

function sessionItemStateValue(value: unknown): Extract<TranscriptItem, { type: "session" }>["state"] | undefined {
  return value === "active" ||
    value === "success" ||
    value === "streaming" ||
    value === "abandoned" ||
    value === "cancelled" ||
    value === "error"
    ? value
    : undefined
}

function normalizeTranscriptMeta(
  payload: Record<string, unknown>,
  fallbackId: string,
): { id: string } & Record<string, unknown> {
  const meta: { id: string } & Record<string, unknown> = {
    id: stringValue(payload.id) || fallbackId,
  }
  const eventKey = stringValue(payload.eventKey)
  const sessionEventSeq = numberValue(payload.sessionEventSeq)
  const historyCutIndex = numberValue(payload.historyCutIndex)
  const traceNodeId = stringValue(payload.traceNodeId)
  const traceNodeKind = stringValue(payload.traceNodeKind)
  const traceNodeStatus = stringValue(payload.traceNodeStatus)
  if (eventKey) meta.eventKey = eventKey
  if (sessionEventSeq !== undefined) meta.sessionEventSeq = sessionEventSeq
  if (historyCutIndex !== undefined) meta.historyCutIndex = historyCutIndex
  if (traceNodeId) meta.traceNodeId = traceNodeId
  if (traceNodeKind) meta.traceNodeKind = traceNodeKind
  if (traceNodeStatus) meta.traceNodeStatus = traceNodeStatus
  return meta
}

function normalizeTranscriptItems(value: unknown, fallbackPrefix: string): TranscriptItem[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item, index) => normalizeTranscriptItem(item, `${fallbackPrefix}-${index}`))
    .filter((item): item is TranscriptItem => Boolean(item))
}

function normalizeTranscriptItem(value: unknown, fallbackId: string): TranscriptItem | undefined {
  const payload = objectValue(value)
  const type = stringValue(payload.type)
  if (!type) return undefined
  const meta = normalizeTranscriptMeta(payload, fallbackId)

  if (type === "assistant_text" || type === "text") {
    const markdown = textContentValue(payload.markdown, payload.text).trim()
    if (!markdown) return undefined
    return {
      ...meta,
      type: "assistant_text",
      markdown,
      format: textFormatValue(payload.format) || textFormatValue(payload.textFormat),
      streaming: payload.streaming === true,
      streamKey: stringValue(payload.streamKey) || stringValue(payload.textStreamKey) || undefined,
    } as TranscriptItem
  }

  if (type === "reasoning") {
    const raw = textContentValue(payload.raw, payload.reasoningText, payload.text).trim()
    const summary = textContentValue(payload.summary, payload.reasoningSummary).trim()
    if (!raw && !summary) return undefined
    return {
      ...meta,
      type: "reasoning",
      summary: summary || undefined,
      raw: raw || summary,
      format: textFormatValue(payload.format) || textFormatValue(payload.reasoningFormat),
    } as TranscriptItem
  }

  if (type === "thinking") {
    const raw = textContentValue(payload.raw, payload.detail, payload.text).trim()
    return {
      ...meta,
      type: "thinking",
      title: stringValue(payload.title) || "思考过程",
      detail: stringValue(payload.detail) || undefined,
      active: payload.active === true,
      raw: raw || undefined,
    } as TranscriptItem
  }

  if (type === "tool") {
    const output = textContentValue(payload.output, payload.toolOutput)
    const tool = stringValue(payload.tool) || stringValue(payload.toolName) || "tool"
    return {
      ...meta,
      type: "tool",
      tool,
      status: toolStatusValue(payload.status),
      title: stringValue(payload.title) || undefined,
      subtitle: stringValue(payload.subtitle) || undefined,
      toolCallId: stringValue(payload.toolCallId) || undefined,
      source: stringValue(payload.source) || stringValue(payload.toolSource) || undefined,
      input: recordFieldValue(payload, "input", "toolInput"),
      output,
      outputFormat: outputFormatValue(payload.outputFormat) || outputFormatValue(payload.toolOutputFormat),
      stream: stringValue(payload.stream) || undefined,
      outputChunks: arrayFieldValue(payload, "outputChunks", "toolOutputChunks"),
      finalOutput: textContentValue(payload.finalOutput, payload.toolFinalOutput) || undefined,
      outputTruncated: payload.outputTruncated === true || payload.toolOutputTruncated === true,
      resultMeta: recordFieldValue(payload, "resultMeta", "toolResultMeta"),
      preparingIndex: numberValue(payload.preparingIndex) ?? numberValue(payload.toolPreparingIndex),
      startedAt: numberValue(payload.startedAt) ?? numberValue(payload.toolStartedAt),
      endedAt: numberValue(payload.endedAt) ?? numberValue(payload.toolEndedAt),
      approvalId: stringValue(payload.approvalId) || undefined,
      approvalReason: stringValue(payload.approvalReason) || undefined,
      approvalResultReason: stringValue(payload.approvalResultReason) || undefined,
      approvalDecision: stringValue(payload.approvalDecision) || undefined,
      approvalSections: arrayFieldValue(payload, "approvalSections"),
      approvalContent: stringValue(payload.approvalContent) || undefined,
    } as TranscriptItem
  }

  if (type === "notice") {
    const text = textContentValue(payload.text, payload.noticeText).trim()
    if (!text) return undefined
    return {
      ...meta,
      type: "notice",
      level: stringValue(payload.level) || "info",
      text,
      format: textFormatValue(payload.format),
    } as TranscriptItem
  }

  if (type === "trace") {
    return {
      ...meta,
      type: "trace",
      title: stringValue(payload.title) || stringValue(payload.traceTitle) || undefined,
      text: stringValue(payload.text) || stringValue(payload.traceText) || undefined,
    } as TranscriptItem
  }

  if (type === "session") {
    return {
      ...meta,
      type: "session",
      sessionId: stringValue(payload.sessionId) || undefined,
      title: stringValue(payload.title) || stringValue(payload.sessionTitle) || undefined,
      kind: sessionItemKindValue(payload.kind) || sessionItemKindValue(payload.sessionKind),
      state: sessionItemStateValue(payload.state) || sessionItemStateValue(payload.sessionState),
      summary: stringValue(payload.summary) || stringValue(payload.sessionSummary) || undefined,
    } as TranscriptItem
  }

  if (type === "terminal") {
    const content = textContentValue(payload.content, payload.terminalContent).trim()
    if (!content) return undefined
    return {
      ...meta,
      type: "terminal",
      title: stringValue(payload.title) || stringValue(payload.terminalTitle) || undefined,
      content,
    } as TranscriptItem
  }

  if (type === "view") {
    const viewPayload = recordFieldValue(payload, "payload", "viewPayload")
    if (!hasMeaningfulRecord(viewPayload)) return undefined
    return {
      ...meta,
      type: "view",
      title: stringValue(payload.title) || stringValue(payload.viewTitle) || undefined,
      viewType: stringValue(payload.viewType) || stringValue(payload.view_type) || undefined,
      level: stringValue(payload.level) || stringValue(payload.viewLevel) || undefined,
      payload: viewPayload,
    } as TranscriptItem
  }

  if (type === "context_event") {
    const contextPayload = recordFieldValue(payload, "payload", "contextPayload")
    if (!hasMeaningfulRecord(contextPayload) && !hasMeaningfulStructuredText(payload, contextPayload, "title", "contextTitle", "text", "message", "summary")) {
      return undefined
    }
    return {
      ...meta,
      type: "context_event",
      title: stringValue(payload.title) || stringValue(payload.contextTitle) || undefined,
      payload: contextPayload,
    } as TranscriptItem
  }

  if (type === "memory_context") {
    const memoryPayload = recordFieldValue(payload, "payload", "memoryPayload")
    if (!hasMeaningfulRecord(memoryPayload) && !hasMeaningfulStructuredText(payload, memoryPayload, "title", "memoryTitle", "text", "message", "summary")) {
      return undefined
    }
    return {
      ...meta,
      type: "memory_context",
      title: stringValue(payload.title) || stringValue(payload.memoryTitle) || undefined,
      payload: memoryPayload,
    } as TranscriptItem
  }

  if (type === "ui_event") {
    const uiPayload = recordFieldValue(payload, "payload", "uiEventPayload")
    if (!hasMeaningfulRecord(uiPayload) && !hasMeaningfulStructuredText(payload, uiPayload, "title", "uiEventTitle", "text", "message", "summary")) {
      return undefined
    }
    return {
      ...meta,
      type: "ui_event",
      kind: stringValue(payload.kind) || stringValue(payload.uiEventKind) || undefined,
      level: stringValue(payload.level) || stringValue(payload.uiEventLevel) || undefined,
      title: stringValue(payload.title) || stringValue(payload.uiEventTitle) || undefined,
      payload: uiPayload,
    } as TranscriptItem
  }

  if (type === "parallel_tools" || type === "parallel_sessions") {
    return {
      ...meta,
      type,
      title: stringValue(payload.title) || stringValue(payload.parallelTitle) || undefined,
      summary: stringValue(payload.summary) || stringValue(payload.parallelSummary) || undefined,
      groupId: stringValue(payload.groupId) || undefined,
      items: normalizeTranscriptItems(
        Array.isArray(payload.items) ? payload.items : payload.parallelItems,
        `${fallbackId}-item`,
      ),
    } as TranscriptItem
  }

  return undefined
}

function normalizeMessage(value: unknown, fallbackId: string, fallbackRole: "user" | "assistant"): MockMessage | undefined {
  const payload = objectValue(value)
  const role = payload.role === "user" || payload.role === "assistant" ? payload.role : fallbackRole
  const text = textContentValue(payload.text)
  const normalizedParts = normalizeTranscriptItems(payload.parts, `${fallbackId}-part`)
  const shouldAppendTextPart = role === "assistant" &&
    text.trim().length > 0 &&
    !normalizedParts.some((part) => part.type === "assistant_text")
  const parts = shouldAppendTextPart
    ? [
        ...normalizedParts,
        {
          ...normalizeTranscriptMeta({ ...payload, id: `${fallbackId}-text` }, `${fallbackId}-text`),
          type: "assistant_text",
          markdown: text,
          format: "markdown",
        } as TranscriptItem,
      ]
    : normalizedParts
  return {
    id: stringValue(payload.id) || fallbackId,
    role,
    text,
    parts,
    timestamp: numberValue(payload.timestamp) ?? Date.now(),
    historyMessageIndex: numberValue(payload.historyMessageIndex),
    historyCutIndex: numberValue(payload.historyCutIndex),
    traceNodeId: stringValue(payload.traceNodeId) || undefined,
    traceNodeKind: (stringValue(payload.traceNodeKind) || undefined) as MockMessage["traceNodeKind"],
    traceNodeStatus: (stringValue(payload.traceNodeStatus) || undefined) as MockMessage["traceNodeStatus"],
  }
}

function normalizeTurn(value: unknown, index: number): MockTurn | undefined {
  const payload = objectValue(value)
  const userMessage = normalizeMessage(payload.userMessage, `user-${index}`, "user")
  if (!userMessage) return undefined
  const assistantMessages = Array.isArray(payload.assistantMessages)
    ? payload.assistantMessages
      .map((message, messageIndex) => normalizeMessage(message, `assistant-${index}-${messageIndex}`, "assistant"))
      .filter((message): message is MockMessage => Boolean(message))
    : []
  return { userMessage, assistantMessages }
}

function normalizeSession(value: unknown): MockSession | undefined {
  const payload = objectValue(value)
  const id = typeof payload.id === "string" ? payload.id : ""
  if (!id) return undefined
  return {
    id,
    title: typeof payload.title === "string"
      ? payload.title
      : typeof payload.preview === "string" && payload.preview
        ? payload.preview
        : "新会话",
    updatedAt: typeof payload.updatedAt === "string"
      ? payload.updatedAt
      : typeof payload.savedAt === "string"
        ? payload.savedAt
        : typeof payload.saved_at === "string"
          ? payload.saved_at
          : new Date().toISOString(),
    kind: payload.kind === "fork" || payload.kind === "delegated_run" || payload.kind === "main"
      ? payload.kind as MockSession["kind"]
      : "main",
    state: "active",
    parentSessionId: typeof payload.parentSessionId === "string"
      ? payload.parentSessionId
      : typeof payload.parent_session_id === "string"
        ? payload.parent_session_id
        : undefined,
    sourceSessionId: typeof payload.sourceSessionId === "string"
      ? payload.sourceSessionId
      : typeof payload.source_session_id === "string"
        ? payload.source_session_id
        : undefined,
    sourceNodeId: typeof payload.sourceNodeId === "string"
      ? payload.sourceNodeId
      : typeof payload.source_node_id === "string"
        ? payload.source_node_id
        : undefined,
    returnNodeId: typeof payload.returnNodeId === "string"
      ? payload.returnNodeId
      : typeof payload.return_node_id === "string"
        ? payload.return_node_id
        : undefined,
    summary: typeof payload.summary === "string"
      ? payload.summary
      : typeof payload.preview === "string"
        ? payload.preview
        : "",
    syncStatus: normalizeSyncStatus(payload.syncStatus) || normalizeSyncStatus(payload.sync_status),
    syncError: typeof payload.syncError === "string"
      ? payload.syncError
      : typeof payload.sync_error === "string"
        ? payload.sync_error
        : undefined,
    source: normalizeSessionSource(payload.source),
  }
}

function normalizeSyncStatus(value: unknown): MockSession["syncStatus"] | undefined {
  return value === "synced" || value === "pending" || value === "failed"
    ? value
    : undefined
}

function normalizeSessionSource(value: unknown): MockSession["source"] | undefined {
  return value === "server" || value === "local" || value === "merged"
    ? value
    : undefined
}

function normalizeSessionList(value: unknown): MockSession[] {
  if (!Array.isArray(value)) return []
  return value.map(normalizeSession).filter((item): item is MockSession => Boolean(item))
}

function normalizeSessionListStatus(value: unknown, sessions: MockSession[]): SessionListStatus {
  if (
    value === "idle" ||
    value === "loading" ||
    value === "unauthenticated" ||
    value === "unavailable" ||
    value === "empty" ||
    value === "ready" ||
    value === "error"
  ) {
    return value
  }
  return sessions.length ? "ready" : "empty"
}

function normalizeSessionListState(
  message: Record<string, unknown>,
  sessions: MockSession[],
): SessionListState {
  const status = normalizeSessionListStatus(message.status, sessions)
  const rawMessage = stringValue(message.message)
  return {
    status,
    message: rawMessage || sessionListStatusMessage(status),
    updatedAt: new Date().toISOString(),
    fingerprint: stringValue(message.fingerprint),
  }
}

function sessionListReadyState(sessions: MockSession[], fingerprint: unknown): SessionListState {
  const status: SessionListStatus = sessions.length ? "ready" : "empty"
  return {
    status,
    message: sessionListStatusMessage(status),
    updatedAt: new Date().toISOString(),
    fingerprint: stringValue(fingerprint),
  }
}

function sessionListStatusMessage(status: SessionListStatus): string {
  if (status === "loading") return "正在加载会话历史。"
  if (status === "unauthenticated") return "未登录，无法加载会话历史。"
  if (status === "unavailable") return "当前后端不支持会话历史。"
  if (status === "empty") return "当前没有可恢复的历史会话。"
  if (status === "error") return "会话历史加载失败。"
  return ""
}

export function normalizeSessionBundle(value: unknown): MockSessionBundle | undefined {
  const payload = objectValue(value)
  const trace = objectValue(payload.trace)
  const session = normalizeSession(payload.session)
  if (!session) return undefined
  const traceNodes = Array.isArray(payload.traceNodes) ? payload.traceNodes : trace.nodes
  const traceEdges = Array.isArray(payload.traceEdges) ? payload.traceEdges : trace.edges
  const traceUI = Object.keys(objectValue(payload.traceUI)).length
    ? objectValue(payload.traceUI)
    : objectValue(trace.ui)
  return {
    session,
    stats: {
      ...EMPTY_STATS,
      ...objectValue(payload.stats),
    },
    turns: Array.isArray(payload.turns)
      ? payload.turns.map(normalizeTurn).filter((turn): turn is MockTurn => Boolean(turn))
      : [],
    traceNodes: Array.isArray(traceNodes) ? traceNodes as TraceNode[] : [],
    traceEdges: Array.isArray(traceEdges) ? traceEdges as TraceEdge[] : [],
    traceUI: {
      ...EMPTY_TRACE_UI,
      ...traceUI,
    },
  }
}

export function normalizeRemoteSessionPayload(message: Record<string, unknown>): MockSessionBundle | undefined {
  const record = objectValue(message.record)
  return (
    normalizeSessionBundle(message.bundle) ||
    normalizeSessionBundle(record.transcript) ||
    normalizeSessionBundle(message.document)
  )
}

interface TraceSnapshotPayload {
  activeTraceNodeId?: string | null
  currentSessionId?: string | null
  focusedBranchId?: string | null
  selectedTraceNodeId?: string | null
  stats?: MockTaskStats
  traceEdges?: TraceEdge[]
  traceNodes?: TraceNode[]
  turns?: MockTurn[]
}

export type SessionListStatus = "idle" | "loading" | "unauthenticated" | "unavailable" | "empty" | "ready" | "error"

export interface SessionListState {
  status: SessionListStatus
  message: string
  updatedAt?: string
  fingerprint?: string
}

interface TraceContextValue {
  recentSessions: () => MockSession[]
  allSessions: () => MockSession[]
  sessionListState: () => SessionListState
  rootSessionId: () => string | null
  currentSessionId: () => string | null
  currentSession: () => MockSession | undefined
  findTraceNodeSessionId: (nodeId: string) => string | null
  stats: () => MockTaskStats
  turns: () => MockTurn[]
  traceNodes: () => TraceNode[]
  traceEdges: () => TraceEdge[]
  orchestrationTraceNodes: () => TraceNode[]
  orchestrationTraceEdges: () => TraceEdge[]
  focusedBranchId: () => string | null
  selectedTraceNodeId: () => string | null
  activeTraceNodeId: () => string | null
  panelIntent: () => TraceNavigationIntent | null
  loadSession: (sessionId: string) => void
  refreshSessions: () => void
  getSessionBundle: (sessionId: string) => MockSessionBundle | undefined
  clearSession: () => void
  deleteSession: (sessionId: string) => void
  focusTraceNode: (nodeId: string | null) => void
  focusBranch: (branchId: string | null) => void
  clearPanelIntent: () => void
  linkForkSession: (options: {
    sourceSessionId: string
    sourceMessageId?: string
    sourceNodeId?: string
    childSessionId: string
    childSessionTitle: string
    childSessionSummary?: string
    childSessionKind?: "fork" | "delegated_run"
  }) => void
  createMockFork: (sourceNodeId: string, mode?: "fork" | "delegated_run") => string | null
  createMockRollback: (sourceNodeId: string, targetNodeId?: string) => string | null
  openAgentManager: (options?: TraceNavigationPayload) => void
  applyPanelNavigation: (payload?: TraceNavigationPayload) => void
  createSession: () => void
  startDraftTask: (taskText: string, initialTurn?: MockTurn) => string
  appendTurn: (turn: MockTurn) => void
  replaceLastAssistantMessages: (assistantMessages: MockTurn["assistantMessages"]) => void
  patchStats: (patch: Partial<MockTaskStats>) => void
}

const TraceContext = createContext<TraceContextValue>()

export const TraceProvider: ParentComponent = (props) => {
  const vscode = useVSCode()

  const [allSessions, setAllSessions] = createSignal<MockSession[]>([])
  const [sessionListState, setSessionListState] = createSignal<SessionListState>({
    status: "idle",
    message: "",
  })
  const [sessionBundles, setSessionBundles] = createSignal<Record<string, MockSessionBundle>>({})
  const [currentSessionId, setCurrentSessionId] = createSignal<string | null>(null)
  const [stats, setStats] = createSignal<MockTaskStats>(cloneValue(EMPTY_STATS))
  const [turns, setTurns] = createSignal<MockTurn[]>([])
  const [traceNodes, setTraceNodes] = createSignal<TraceNode[]>([])
  const [traceEdges, setTraceEdges] = createSignal<TraceEdge[]>([])
  const [selectedTraceNodeId, setSelectedTraceNodeId] = createSignal<string | null>(null)
  const [activeTraceNodeId, setActiveTraceNodeId] = createSignal<string | null>(null)
  const [focusedBranchId, setFocusedBranchId] = createSignal<string | null>(null)
  const [panelIntent, setPanelIntent] = createSignal<TraceNavigationIntent | null>(null)
  const recentSessions = createMemo(() =>
    allSessions().filter((session) => !session.parentSessionId)
  )
  const rootSessionId = createMemo(() => getRootSessionId(allSessions(), currentSessionId()))

  const currentSession = createMemo(() =>
    allSessions().find(session => session.id === currentSessionId()) ||
    (currentSessionId() ? { id: currentSessionId()!, title: stats().taskText || "Draft Task", updatedAt: "" } : undefined)
  )

  const getSessionBundle = (sessionId: string) => sessionBundles()[sessionId]
  const findTraceNodeSessionId = (nodeId: string) => {
    for (const [sessionId, bundle] of Object.entries(sessionBundles())) {
      if (bundle.traceNodes.some((node) => node.id === nodeId)) {
        return sessionId
      }
    }

    return null
  }
  const orchestrationGraph = createMemo(() =>
    buildOrchestrationGraph(allSessions(), sessionBundles(), rootSessionId())
  )

  const applyBundleToSignals = (
    sessionId: string,
    bundle: MockSessionBundle,
    options: { preserveIntent?: boolean } = {}
  ) => {
    setCurrentSessionId(sessionId)
    setStats(cloneValue(bundle.stats))
    setTurns(cloneValue(bundle.turns))
    setTraceNodes(cloneValue(bundle.traceNodes))
    setTraceEdges(cloneValue(bundle.traceEdges))
    setSelectedTraceNodeId(bundle.traceUI.selectedNodeId)
    setActiveTraceNodeId(bundle.traceUI.activeNodeId)
    setFocusedBranchId(bundle.traceUI.focusedBranchId)

    if (!options.preserveIntent) {
      setPanelIntent(null)
    }
  }

  const writeSessionBundle = (
    sessionId: string,
    bundle: MockSessionBundle,
    options: { applyToCurrent?: boolean; preserveIntent?: boolean; includeInHistory?: boolean } = {}
  ) => {
    const snapshot = cloneValue(bundle)

    setSessionBundles((prev) => ({
      ...prev,
      [sessionId]: snapshot,
    }))

    if (options.includeInHistory !== false) {
      setAllSessions((prev) => {
        const existingIndex = prev.findIndex((session) => session.id === sessionId)
        if (existingIndex === -1) {
          return [...prev, snapshot.session]
        }

        const updated = [...prev]
        updated[existingIndex] = snapshot.session
        return updated
      })
    }

    if (options.applyToCurrent) {
      applyBundleToSignals(sessionId, snapshot, { preserveIntent: options.preserveIntent })
    }
  }

  const updateSessionMeta = (
    sessionId: string,
    updater: (session: MockSession) => MockSession
  ) => {
    const bundle = getSessionBundle(sessionId)
    if (!bundle) return

    const nextSession = updater(cloneValue(bundle.session))
    writeSessionBundle(sessionId, {
      ...bundle,
      session: nextSession,
    }, {
      applyToCurrent: sessionId === currentSessionId(),
      preserveIntent: true,
    })
  }

  const updateCurrentBundle = (
    updater: (bundle: MockSessionBundle) => MockSessionBundle
  ): MockSessionBundle | undefined => {
    const sessionId = currentSessionId()
    if (!sessionId) return undefined

    const bundle = getSessionBundle(sessionId)
    if (!bundle) return undefined

    const nextBundle = updater(cloneValue(bundle))
    writeSessionBundle(sessionId, nextBundle, { applyToCurrent: true, preserveIntent: true })
    return nextBundle
  }

  const updateCurrentTraceUI = (patch: Partial<MockSessionBundle["traceUI"]>) => {
    updateCurrentBundle((bundle) => ({
      ...bundle,
      traceUI: {
        ...bundle.traceUI,
        ...patch,
      },
    }))
  }

  const removeSessionBundle = (sessionId: string) => {
    setSessionBundles((prev) => {
      const next = { ...prev }
      delete next[sessionId]
      return next
    })
    setAllSessions((prev) => prev.filter((session) => session.id !== sessionId))
  }

  const loadSession = (sessionId: string) => {
    const bundle = getSessionBundle(sessionId)
    if (bundle) {
      applyBundleToSignals(sessionId, bundle)
    }
    vscode.postMessage({ type: "session.load", sessionId })
  }

  const refreshSessions = () => {
    setSessionListState({
      status: "loading",
      message: "正在加载会话历史。",
      updatedAt: new Date().toISOString(),
      fingerprint: sessionListState().fingerprint,
    })
    setAllSessions([])
    vscode.postMessage({ type: "session.list" })
  }

  const clearSession = () => {
    setCurrentSessionId(null)
    setStats(EMPTY_STATS)
    setTurns([])
    setTraceNodes([])
    setTraceEdges([])
    setSelectedTraceNodeId(null)
    setActiveTraceNodeId(null)
    setFocusedBranchId(null)
    setPanelIntent(null)
  }

  const createSession = () => {
    clearSession()
  }

  const deleteSession = (sessionId: string) => {
    removeSessionBundle(sessionId)
    if (currentSessionId() === sessionId) {
      setCurrentSessionId(null)
      setStats(EMPTY_STATS)
      setTurns([])
      setTraceNodes([])
      setTraceEdges([])
      setSelectedTraceNodeId(null)
      setActiveTraceNodeId(null)
      setFocusedBranchId(null)
      setPanelIntent(null)
    }
    vscode.postMessage({ type: "session.delete", sessionId })
  }

  const focusTraceNode = (nodeId: string | null) => {
    setSelectedTraceNodeId(nodeId)
    updateCurrentTraceUI({ selectedNodeId: nodeId })
  }

  const focusBranch = (branchId: string | null) => {
    setFocusedBranchId(branchId)
    updateCurrentTraceUI({ focusedBranchId: branchId })
  }

  const clearPanelIntent = () => {
    setPanelIntent(null)
  }

  const linkForkSession = (options: {
    sourceSessionId: string
    sourceMessageId?: string
    sourceNodeId?: string
    childSessionId: string
    childSessionTitle: string
    childSessionSummary?: string
    childSessionKind?: "fork" | "delegated_run"
  }) => {
    const sourceBundle = getSessionBundle(options.sourceSessionId)
    if (!sourceBundle) return
    const alreadyLinked = sourceBundle.turns.some((turn) =>
      turn.assistantMessages.some((message) =>
        message.parts.some((part) => part.type === "session" && part.sessionId === options.childSessionId)
      )
    )
    if (alreadyLinked) return

    const partId = buildMockId("part-session")
    const messageId = buildMockId("msg-session")
    const referenceMessage: MockMessage = {
      id: messageId,
      role: "assistant",
      text: "",
      timestamp: Date.now(),
      historyCutIndex: undefined,
      traceNodeId: options.sourceNodeId,
      parts: [
        {
          id: partId,
          type: "session",
          sessionId: options.childSessionId,
          title: options.childSessionTitle,
          kind: options.childSessionKind || "fork",
          state: "active",
          summary: options.childSessionSummary,
          traceNodeId: options.sourceNodeId,
          traceNodeKind: options.childSessionKind === "delegated_run" ? "delegated_run_spawn" : "fork",
          traceNodeStatus: "success",
        },
      ],
    }

    const nextBundle: MockSessionBundle = {
      ...cloneValue(sourceBundle),
      session: {
        ...cloneValue(sourceBundle.session),
        updatedAt: new Date().toISOString(),
      },
      turns: appendAssistantMessageNearAnchor(
        sourceBundle.turns,
        options.sourceMessageId || options.sourceNodeId,
        referenceMessage
      ),
    }
    writeSessionBundle(options.sourceSessionId, nextBundle, {
      applyToCurrent: options.sourceSessionId === currentSessionId(),
      preserveIntent: true,
    })
  }

  const createMockFork = (sourceNodeId: string, mode: "fork" | "delegated_run" = "fork") => {
    const sourceSessionId = currentSessionId()
    if (!sourceSessionId) return null

    const sourceBundle = getSessionBundle(sourceSessionId)
    if (!sourceBundle) return null

    const sourceNode = sourceBundle.traceNodes.find((node) => node.id === sourceNodeId)
    if (!sourceNode) return null

    const sessionId = buildMockId(mode === "delegated_run" ? "session-delegated_run" : "session-fork")
    const partId = buildMockId("part-session")
    const messageId = buildMockId("msg-session")
    const controlNodeId = buildMockId(mode === "delegated_run" ? "trace-delegated_run" : "trace-fork")
    const nowIso = new Date().toISOString()
    const now = Date.now()
    const maxStep = sourceBundle.traceNodes.reduce((value, node) => Math.max(value, node.step), 0)
    const sessionTitle =
      mode === "delegated_run"
        ? `委托运行 · ${sourceNode.title}`
        : `Fork · ${sourceNode.title}`
    const sessionSummary =
      mode === "delegated_run"
        ? `从「${sourceNode.title}」派发的委托运行会话，独立执行并回流结果。`
        : `从「${sourceNode.title}」Fork 出的新会话，用于继续探索或交付。`

    const nextSession: MockSession = {
      id: sessionId,
      title: sessionTitle,
      updatedAt: nowIso,
      kind: mode,
      state: "active",
      parentSessionId: sourceSessionId,
      sourceSessionId,
      sourceNodeId: sourceNode.id,
      summary: sessionSummary,
    }

    const controlNode: TraceNode = {
      id: controlNodeId,
      category: "control",
      kind: mode === "delegated_run" ? "delegated_run_spawn" : "fork",
      status: "success",
      branchId: "main",
      lane: 0,
      step: maxStep + 1,
      startedAt: nowIso,
      parentId: sourceNode.id,
      forkFrom: sourceNode.id,
      transcriptAnchorId: partId,
      title: mode === "delegated_run" ? `派发委托运行：${sessionTitle}` : `创建 Fork 会话：${sessionTitle}`,
      summary: sessionSummary,
      meta: {
        sessionId,
      },
    }

    const referenceMessage: MockMessage = {
      id: messageId,
      role: "assistant",
      text: "",
      timestamp: now,
      parts: [
        {
          id: partId,
          type: "session",
          sessionId,
          title: sessionTitle,
          kind: mode,
          state: "active",
          summary: sessionSummary,
          traceNodeId: controlNodeId,
          traceNodeKind: controlNode.kind,
          traceNodeStatus: controlNode.status,
        },
      ],
    }

    const updatedSourceBundle: MockSessionBundle = {
      ...cloneValue(sourceBundle),
      session: {
        ...cloneValue(sourceBundle.session),
        updatedAt: nowIso,
        state: "active",
      },
      turns: appendAssistantMessageNearAnchor(sourceBundle.turns, sourceNode.transcriptAnchorId, referenceMessage),
      traceNodes: [...sourceBundle.traceNodes, controlNode],
      traceEdges: [
        ...sourceBundle.traceEdges,
        {
          id: buildMockId("trace-edge"),
          kind: mode === "delegated_run" ? "delegated_run" : "fork",
          source: sourceNode.id,
          target: controlNodeId,
          branchId: "main",
          emphasis: "strong",
        },
      ],
      traceUI: {
        ...sourceBundle.traceUI,
        selectedNodeId: controlNodeId,
        activeNodeId: controlNodeId,
      },
    }

    const childUserMessageId = buildMockId("user")
    const childAssistantMessageId = buildMockId("assistant")
    const childUserNodeId = buildMockId("trace-user")
    const childAssistantNodeId = buildMockId("trace-assistant")

    const childTurns: MockTurn[] = [
      {
        userMessage: {
          id: childUserMessageId,
          role: "user",
          text:
            mode === "delegated_run"
              ? `独立处理「${sourceNode.title}」对应的委托运行，并在完成后返回父会话。`
              : `从「${sourceNode.title}」继续推进这条 Fork 会话。`,
          parts: [],
          timestamp: now,
          traceNodeId: childUserNodeId,
          traceNodeKind: "user_message",
          traceNodeStatus: "success",
        },
        assistantMessages: [
          {
            id: childAssistantMessageId,
            role: "assistant",
            text: "",
            timestamp: now + 1,
            traceNodeId: childAssistantNodeId,
            traceNodeKind: "assistant_message",
            traceNodeStatus: mode === "delegated_run" ? "active" : "queued",
            parts: [
              {
                id: buildMockId("part-text"),
                type: "assistant_text",
                markdown:
                  mode === "delegated_run"
                    ? "委托运行会话已创建，等待继续补充工具执行与结果回流。"
                    : "Fork 会话已创建，等待继续补充这条分支上的对话与操作。",
              },
            ],
          },
        ],
      },
    ]

    const childTraceNodes: TraceNode[] = [
      {
        id: childUserNodeId,
        category: "conversation",
        kind: "user_message",
        status: "success",
        branchId: "main",
        lane: 0,
        step: 1,
        startedAt: nowIso,
        transcriptAnchorId: childUserMessageId,
        title: mode === "delegated_run" ? "委托运行任务启动" : "Fork 会话启动",
        summary: sessionSummary,
      },
      {
        id: childAssistantNodeId,
        category: "conversation",
        kind: "assistant_message",
        status: mode === "delegated_run" ? "active" : "queued",
        branchId: "main",
        lane: 0,
        step: 2,
        startedAt: nowIso,
        parentId: childUserNodeId,
        transcriptAnchorId: childAssistantMessageId,
        title: mode === "delegated_run" ? "委托运行等待执行" : "Fork 会话等待继续",
        summary:
          mode === "delegated_run"
            ? "等待在委托运行会话中继续追加真实执行内容。"
            : "等待在 Fork 会话中继续追加真实执行内容。",
      },
    ]

    const childBundle: MockSessionBundle = {
      session: nextSession,
      stats: {
        ...EMPTY_STATS,
        taskText: sessionSummary,
        contextWindow: sourceBundle.stats.contextWindow,
        maxOutputTokens: sourceBundle.stats.maxOutputTokens,
      },
      turns: childTurns,
      traceNodes: childTraceNodes,
      traceEdges: [
        {
          id: buildMockId("trace-edge"),
          kind: "sequential",
          source: childUserNodeId,
          target: childAssistantNodeId,
          branchId: "main",
        },
      ],
      traceUI: {
        activeNodeId: childAssistantNodeId,
        selectedNodeId: childAssistantNodeId,
        focusedBranchId: "main",
        showInspector: false,
        showMiniMap: false,
        viewMode: "compact",
      },
    }

    writeSessionBundle(sourceSessionId, updatedSourceBundle, { applyToCurrent: true, preserveIntent: true })
    writeSessionBundle(sessionId, childBundle)
    setPanelIntent(null)
    return sessionId
  }

  const createMockRollback = (sourceNodeId: string, targetNodeId?: string) => {
    const sourceSessionId = currentSessionId()
    if (!sourceSessionId) return null

    const sourceSession = currentSession()
    const sourceBundle = getSessionBundle(sourceSessionId)
    if (!sourceSession || !sourceBundle) return null

    const sourceNode = sourceBundle.traceNodes.find((node) => node.id === sourceNodeId)
    if (!sourceNode) return null

    const nowIso = new Date().toISOString()
    const now = Date.now()
    const rollbackPartId = buildMockId("part-rollback")
    const rollbackMessageId = buildMockId("msg-rollback")
    const rollbackNodeId = buildMockId("trace-rollback")
    const maxStep = sourceBundle.traceNodes.reduce((value, node) => Math.max(value, node.step), 0)

    const parentSessionId = sourceSession.parentSessionId
    const resolvedParentTargetId = targetNodeId || sourceSession.returnNodeId || sourceSession.sourceNodeId

    const rollbackNode: TraceNode = {
      id: rollbackNodeId,
      category: "control",
      kind: "rollback",
      status: "rewound",
      branchId: "main",
      lane: 0,
      step: maxStep + 1,
      startedAt: nowIso,
      parentId: sourceNode.id,
      rollbackTo: parentSessionId ? undefined : (targetNodeId || sourceNode.rollbackTo || sourceNode.forkFrom || sourceNode.parentId),
      transcriptAnchorId: rollbackPartId,
      title: parentSessionId ? "回退到父会话" : "回退到当前会话中的稳定节点",
      summary: parentSessionId
        ? `结束当前会话并返回父会话中的 ${resolvedParentTargetId || "来源节点"}。`
        : `在当前会话内从 ${sourceNode.title} 回退。`,
    }

    const rollbackMessage: MockMessage = {
      id: rollbackMessageId,
      role: "assistant",
      text: "",
      timestamp: now,
      parts: [
        {
          id: rollbackPartId,
          type: "trace",
          title: rollbackNode.title,
          text: rollbackNode.summary,
          traceNodeId: rollbackNodeId,
          traceNodeKind: "rollback",
          traceNodeStatus: "rewound",
        },
      ],
    }

    const updatedSourceBundle: MockSessionBundle = {
      ...cloneValue(sourceBundle),
      session: {
        ...cloneValue(sourceBundle.session),
        updatedAt: nowIso,
        state: parentSessionId ? "abandoned" : cloneValue(sourceBundle.session).state,
      },
      turns: appendAssistantMessageNearAnchor(sourceBundle.turns, sourceNode.transcriptAnchorId, rollbackMessage),
      traceNodes: [
        ...sourceBundle.traceNodes.map((node) => {
          if (parentSessionId) return node

          if (node.id === sourceNode.id || node.step < sourceNode.step || node.status !== "success") {
            return node
          }

          return {
            ...node,
            status: "abandoned" as const,
          }
        }),
        rollbackNode,
      ],
      traceEdges: [
        ...sourceBundle.traceEdges,
        {
          id: buildMockId("trace-edge"),
          kind: parentSessionId ? "return" : "abandoned",
          source: sourceNode.id,
          target: rollbackNodeId,
          branchId: "main",
          emphasis: parentSessionId ? "strong" : "muted",
        },
      ],
      traceUI: {
        ...sourceBundle.traceUI,
        selectedNodeId: rollbackNodeId,
        activeNodeId: parentSessionId ? sourceBundle.traceUI.activeNodeId : rollbackNodeId,
      },
    }

    writeSessionBundle(sourceSessionId, updatedSourceBundle, { applyToCurrent: true, preserveIntent: true })

    if (parentSessionId) {
      updateSessionMeta(parentSessionId, (session) => ({
        ...session,
        updatedAt: nowIso,
        state: "active",
      }))

      const parentBundle = getSessionBundle(parentSessionId)
      if (parentBundle) {
        const nextSelectedNodeId = resolvedParentTargetId || parentBundle.traceUI.selectedNodeId
        const updatedParentBundle: MockSessionBundle = {
          ...cloneValue(parentBundle),
          session: {
            ...cloneValue(parentBundle.session),
            updatedAt: nowIso,
            state: "active",
          },
          traceUI: {
            ...parentBundle.traceUI,
            selectedNodeId: nextSelectedNodeId,
            activeNodeId: nextSelectedNodeId || parentBundle.traceUI.activeNodeId,
          },
        }

        writeSessionBundle(parentSessionId, updatedParentBundle)
        loadSession(parentSessionId)
        if (nextSelectedNodeId) {
          focusTraceNode(nextSelectedNodeId)
        }
      }

      setPanelIntent(null)
      return parentSessionId
    }

    const resolvedTargetId =
      targetNodeId ||
      sourceNode.rollbackTo ||
      sourceNode.forkFrom ||
      sourceNode.parentId

    if (resolvedTargetId) {
      updateCurrentTraceUI({
        selectedNodeId: rollbackNodeId,
        activeNodeId: rollbackNodeId,
      })
    }

    setPanelIntent(null)
    return sourceSessionId
  }

  const applyPanelNavigation = (payload: TraceNavigationPayload = {}) => {
    if (payload.sessionId && payload.sessionId !== currentSessionId()) {
      loadSession(payload.sessionId)
    }
    if (payload.branchId) {
      setFocusedBranchId(payload.branchId)
      updateCurrentTraceUI({ focusedBranchId: payload.branchId })
    }
    if (payload.nodeId !== undefined) {
      setSelectedTraceNodeId(payload.nodeId)
      updateCurrentTraceUI({ selectedNodeId: payload.nodeId })
    }
    setPanelIntent(payload.intent ?? null)
  }

  const openAgentManager = (options: TraceNavigationPayload = {}) => {
    vscode.postMessage({
      type: "openAgentManager",
      sessionId: options.sessionId ?? currentSessionId() ?? undefined,
      nodeId: options.nodeId ?? selectedTraceNodeId() ?? undefined,
      branchId: options.branchId ?? focusedBranchId() ?? undefined,
      intent: options.intent,
    })
  }

  const startDraftTask = (taskText: string, initialTurn?: MockTurn) => {
    const sessionId = buildMockId("session")
    const bundle: MockSessionBundle = {
      session: {
        id: sessionId,
        title: taskText,
        updatedAt: new Date().toISOString(),
        kind: "main",
        state: "streaming",
      },
      stats: {
        ...EMPTY_STATS,
        taskText,
      },
      turns: initialTurn ? [initialTurn] : [],
      traceNodes: [],
      traceEdges: [],
      traceUI: {
        activeNodeId: null,
        selectedNodeId: null,
        focusedBranchId: "main",
        showInspector: false,
        showMiniMap: false,
        viewMode: "compact",
      },
    }
    writeSessionBundle(sessionId, bundle, { applyToCurrent: true, includeInHistory: false })
    return sessionId
  }

  const appendTurn = (turn: MockTurn) => {
    updateCurrentBundle((bundle) => ({
      ...bundle,
      turns: [...bundle.turns, turn],
    }))
  }

  const replaceLastAssistantMessages = (assistantMessages: MockTurn["assistantMessages"]) => {
    updateCurrentBundle((bundle) => {
      if (bundle.turns.length === 0) return bundle

      const updatedTurns = [...bundle.turns]
      const lastTurn = updatedTurns[updatedTurns.length - 1]
      updatedTurns[updatedTurns.length - 1] = {
        ...lastTurn,
        assistantMessages,
      }

      return {
        ...bundle,
        turns: updatedTurns,
      }
    })
  }

  const patchStats = (patch: Partial<MockTaskStats>) => {
    updateCurrentBundle((bundle) => ({
      ...bundle,
      stats: {
        ...bundle.stats,
        ...patch,
      },
    }))
  }

  const mergeIncomingSessionBundle = (
    incomingSessionId: string,
    incomingBundle: MockSessionBundle
  ): MockSessionBundle => {
    const existingRemoteBundle = getSessionBundle(incomingSessionId)
    if (shouldPreserveExistingSessionContent(incomingBundle, existingRemoteBundle)) {
      return mergeRemoteBundlePreservingLocalContent(incomingBundle, existingRemoteBundle as MockSessionBundle)
    }

    const draftSessionId = currentSessionId()
    if (
      draftSessionId &&
      draftSessionId !== incomingSessionId &&
      isLocalDraftSessionId(draftSessionId) &&
      !isLocalDraftSessionId(incomingSessionId)
    ) {
      const draftBundle = getSessionBundle(draftSessionId)
      if (shouldPreserveExistingSessionContent(incomingBundle, draftBundle)) {
        return mergeRemoteBundlePreservingLocalContent(incomingBundle, draftBundle as MockSessionBundle)
      }
    }

    return incomingBundle
  }

  onMount(() => {
    const unsubscribe = vscode.onMessage((msg: ExtensionMessage) => {
      if (msg.type === "session.list") {
        const sessions = normalizeSessionList(msg.sessions)
        const nextState = normalizeSessionListState(msg as Record<string, unknown>, sessions)
        setSessionListState(nextState)
        setAllSessions(nextState.status === "ready" || nextState.status === "empty" ? sessions : [])
      }

      if (msg.type === "session.deleted" && typeof msg.sessionId === "string") {
        removeSessionBundle(msg.sessionId)
        const sessions = normalizeSessionList(msg.sessions)
        if (Object.prototype.hasOwnProperty.call(msg, "sessions")) {
          setAllSessions(sessions)
          setSessionListState(sessionListReadyState(sessions, msg.fingerprint))
        }
      }

      if (msg.type === "session.adopted" && typeof msg.sessionId === "string") {
        setCurrentSessionId(msg.sessionId)
      }

      if (
        (
          msg.type === "session.loaded" ||
          msg.type === "session.created" ||
          msg.type === "session.state" ||
          msg.type === "session.forked"
        ) &&
        typeof msg.sessionId === "string"
      ) {
        if (shouldIgnoreInitialSessionLoad(currentSessionId(), msg.sessionId, msg.reason)) {
          return
        }
        const remoteBundle = normalizeRemoteSessionPayload(msg as Record<string, unknown>)
        const sessions = normalizeSessionList(msg.sessions)
        if (Object.prototype.hasOwnProperty.call(msg, "sessions")) {
          setAllSessions(sessions)
          setSessionListState(sessionListReadyState(sessions, msg.fingerprint))
        }
        if (remoteBundle) {
          const bundleToWrite = mergeIncomingSessionBundle(msg.sessionId, remoteBundle)
          writeSessionBundle(msg.sessionId, bundleToWrite, {
            applyToCurrent: true,
            includeInHistory:
              msg.type === "session.forked" ||
              msg.type !== "session.created" ||
              sessionBundleHasContent(bundleToWrite),
          })
        }
      }

      if (msg.type === "traceSnapshot" && typeof msg.payload === "object" && msg.payload) {
        const payload = msg.payload as TraceSnapshotPayload
        const targetSessionId = payload.currentSessionId || currentSessionId()
        if (!targetSessionId) return
        const baseBundle = getSessionBundle(targetSessionId)
        if (!baseBundle) return

        const nextBundle: MockSessionBundle = {
          ...cloneValue(baseBundle),
          stats: payload.stats ? cloneValue(payload.stats) : cloneValue(baseBundle.stats),
          turns: payload.turns ? cloneValue(payload.turns) : cloneValue(baseBundle.turns),
          traceNodes: payload.traceNodes ? cloneValue(payload.traceNodes) : cloneValue(baseBundle.traceNodes),
          traceEdges: payload.traceEdges ? cloneValue(payload.traceEdges) : cloneValue(baseBundle.traceEdges),
          traceUI: {
            ...cloneValue(baseBundle.traceUI),
            selectedNodeId: payload.selectedTraceNodeId !== undefined ? payload.selectedTraceNodeId : baseBundle.traceUI.selectedNodeId,
            activeNodeId: payload.activeTraceNodeId !== undefined ? payload.activeTraceNodeId : baseBundle.traceUI.activeNodeId,
            focusedBranchId: payload.focusedBranchId !== undefined ? payload.focusedBranchId : baseBundle.traceUI.focusedBranchId,
          },
        }

        writeSessionBundle(targetSessionId, nextBundle, {
          applyToCurrent: targetSessionId === currentSessionId(),
          preserveIntent: true,
        })

        if (payload.currentSessionId && payload.currentSessionId !== currentSessionId()) {
          loadSession(payload.currentSessionId)
        }
      }

      if (msg.type === "traceFocusNode") {
        focusTraceNode(typeof msg.nodeId === "string" ? msg.nodeId : null)
      }
    })

    onCleanup(() => {
      unsubscribe()
    })
  })

  const value: TraceContextValue = {
    recentSessions,
    allSessions,
    sessionListState,
    rootSessionId,
    currentSessionId,
    currentSession,
    findTraceNodeSessionId,
    stats,
    turns,
    traceNodes,
    traceEdges,
    orchestrationTraceNodes: () => orchestrationGraph().nodes,
    orchestrationTraceEdges: () => orchestrationGraph().edges,
    focusedBranchId,
    selectedTraceNodeId,
    activeTraceNodeId,
    panelIntent,
    loadSession,
    refreshSessions,
    getSessionBundle,
    clearSession,
    deleteSession,
    focusTraceNode,
    focusBranch,
      clearPanelIntent,
      linkForkSession,
      createMockFork,
      createMockRollback,
    openAgentManager,
    applyPanelNavigation,
    createSession,
    startDraftTask,
    appendTurn,
    replaceLastAssistantMessages,
    patchStats,
  }

  return <TraceContext.Provider value={value}>{props.children}</TraceContext.Provider>
}

export function useTrace(): TraceContextValue {
  const context = useContext(TraceContext)
  if (!context) {
    throw new Error("useTrace 必须在 TraceProvider 内部使用")
  }
  return context
}
