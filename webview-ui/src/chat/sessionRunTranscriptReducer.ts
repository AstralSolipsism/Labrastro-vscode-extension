import type { MockMessage, MockSessionBundle, MockTaskStats, MockTurn } from "../components/chat/mock-data"
import type {
  AssistantTextItem,
  NoticeLevel,
  ReasoningItem,
  ThinkingItem,
  ToolActivityItem,
  TranscriptItem,
} from "../components/chat/transcript-model"
import {
  approvalDecisionAfterResolution,
  approvalStatusAfterResolution,
  requiredToolCallId,
  resolveActiveToolPartIndex,
  resolveToolPartIndexForReturn,
  statusAfterToolReturn,
  upsertToolPartInParts,
} from "./tool-event-parts"
import {
  appendShellOutputChunk,
  buildShellOutputText,
  isShellToolName,
  reconcileShellFinalOutput,
  shellChunksFromText,
} from "../utils/shell-tool-output"

export interface SessionRunTranscriptLabels {
  thinking: string
  terminalOutput: string
  structuredView: string
  contextEvent: string
  memoryContext: string
  runEvent: string
  cancelled: string
  errorPrefix: string
  streamInterruptedPrefix: string
}

export interface SessionRunTranscriptContext {
  activeSessionRunId?: string
  currentSessionId?: string | null
  runStatus?: MockTaskStats["runStatus"]
  isWorking?: boolean
  now?: number
  labels?: Partial<SessionRunTranscriptLabels>
  approvalDecision?: string
  approvalReason?: string
}

export interface SessionRunTranscriptReduction {
  bundle: MockSessionBundle
  changed: boolean
  eventKey?: string
  sessionEventSeq?: number
}

type EventRenderMeta = { eventKey?: string; sessionEventSeq?: number }

export const SESSION_RUN_TRANSCRIPT_EVENT_TYPES = new Set([
  "session_run_start",
  "reasoning_delta",
  "reasoning_message",
  "assistant_delta",
  "assistant_message",
  "output",
  "view",
  "context_event",
  "memory_context",
  "remote_event",
  "mcp_event",
  "model_event",
  "session_event",
  "command_event",
  "approval_event",
  "system_event",
  "agent_event",
  "ui_event",
  "delegated_run_completed",
  "taskflow_started",
  "provider_stream_interrupted",
  "session_run_interrupted",
  "tool_call_delta",
  "tool_call_stream",
  "tool_call_start",
  "tool_call_protocol_error",
  "tool_call_end",
  "approval_request",
  "approval_resolved",
  "session_run_cancel_requested",
  "session_run_cancelled",
  "error",
  "session_run_failed",
  "session_run_end",
])

export function isSessionRunTranscriptEventType(type: string): boolean {
  return SESSION_RUN_TRANSCRIPT_EVENT_TYPES.has(type)
}

const DEFAULT_LABELS: SessionRunTranscriptLabels = {
  thinking: "正在思考",
  terminalOutput: "终端输出",
  structuredView: "结构化视图",
  contextEvent: "上下文事件",
  memoryContext: "注入记忆",
  runEvent: "运行事件",
  cancelled: "已取消当前请求。",
  errorPrefix: "错误：",
  streamInterruptedPrefix: "输出中断：",
}

const REASONING_STREAM_KEY = "reasoning-stream"

export function applySessionRunTranscriptEvent(
  bundle: MockSessionBundle,
  event: Record<string, unknown>,
  context: SessionRunTranscriptContext = {},
): SessionRunTranscriptReduction {
  const type = stringValue(event.type) || ""
  const payload = objectValue(event.payload)
  const meta = eventRenderMeta(bundle, event, type, payload, context)
  if (meta.eventKey && bundleHasEventKey(bundle, meta.eventKey)) {
    return { bundle, changed: false, ...meta }
  }

  const next = cloneBundle(bundle)
  const labels = { ...DEFAULT_LABELS, ...context.labels }
  const now = context.now ?? Date.now()
  let changed = false

  const markChanged = () => {
    changed = true
  }
  const appendNotice = (
    level: NoticeLevel,
    text: string,
    prefix = "notice",
    options: { format?: "plain" | "markdown"; trim?: boolean } = {},
  ) => {
    const clean = stripAnsi(text)
    const content = options.trim === false ? clean : clean.trim()
    if (!content) return
    updateAssistantItems(next, (parts) => [
      ...parts,
      withEventMeta({
        id: stablePartId(prefix, meta, now, parts.length),
        type: "notice",
        level,
        text: content,
        format: options.format || "plain",
      }, meta),
    ], context)
    markChanged()
  }

  if (type === "session_run_start") {
    const prompt = stringValue(payload.prompt) || ""
    if (prompt && !next.turns.some((turn) => turn.userMessage.text === prompt && !turn.assistantMessages.length)) {
      next.turns.push({
        userMessage: {
          id: `u-${meta.sessionEventSeq ?? now}`,
          role: "user",
          text: prompt,
          parts: [],
          timestamp: now,
          ...(meta.eventKey ? { eventKey: meta.eventKey } : {}),
          ...(meta.sessionEventSeq !== undefined ? { sessionEventSeq: meta.sessionEventSeq } : {}),
        },
        assistantMessages: [],
      })
    }
    next.stats = {
      ...next.stats,
      taskText: prompt || next.stats.taskText,
      runStatus: "running",
    }
    next.session = {
      ...next.session,
      title: next.session.title || prompt || "新会话",
      summary: next.session.summary || prompt || next.session.summary,
      state: "streaming",
    }
    markChanged()
  } else if (type === "reasoning_delta") {
    upsertReasoningThinking(next, String(payload.content || ""), meta, context, labels)
    markChanged()
  } else if (type === "reasoning_message") {
    finalizeReasoning(next, payload, meta, context, labels)
    markChanged()
  } else if (type === "assistant_delta") {
    upsertAssistantStream(next, String(payload.content || ""), meta, context)
    markChanged()
  } else if (type === "assistant_message") {
    finalizeAssistant(next, String(payload.content || ""), meta, context)
    markChanged()
  } else if (type === "output") {
    const format = String(payload.format || "plain")
    if (format === "terminal") {
      appendTerminal(next, String(payload.content || ""), labels.terminalOutput, meta, context)
    } else {
      appendNotice("info", String(payload.content || ""), "output", {
        format: format === "markdown" ? "markdown" : "plain",
      })
    }
    markChanged()
  } else if (type === "view") {
    appendView(next, payload, meta, context, labels, now)
    markChanged()
  } else if (type === "context_event") {
    if (isMemoryContextPayload(payload)) {
      appendMemoryContext(next, payload, meta, context, labels, now)
    } else {
      appendContextEvent(next, payload, meta, context, labels, now)
    }
    markChanged()
  } else if (type === "memory_context") {
    appendMemoryContext(next, payload, meta, context, labels, now)
    markChanged()
  } else if (isStructuredUiEventType(type)) {
    appendUiEvent(next, type, payload, meta, context, labels, now)
    markChanged()
  } else if (type === "provider_stream_interrupted") {
    appendNotice(
      "warning",
      String(payload.message || "模型输出流中断，正在尝试恢复。"),
      "stream-recovery",
    )
  } else if (type === "session_run_interrupted") {
    const message = stringValue(payload.message) || "模型输出流中断，可继续生成。"
    appendNotice("warning", `${labels.streamInterruptedPrefix}${message}`, "stream-interrupted")
    finalizeRunTranscriptItems(next, "interrupted", context)
    patchRunStatus(next, "interrupted")
    markChanged()
  } else if (type === "tool_call_delta") {
    appendToolCallDelta(next, payload, meta, context)
    markChanged()
  } else if (type === "tool_call_stream") {
    appendToolStream(next, payload, meta, context)
    markChanged()
  } else if (type === "tool_call_start") {
    appendToolStart(next, payload, meta, context)
    markChanged()
  } else if (type === "tool_call_protocol_error") {
    appendToolProtocolError(next, payload, meta, context)
    markChanged()
  } else if (type === "tool_call_end") {
    appendToolEnd(next, payload, meta, context)
    markChanged()
  } else if (type === "approval_request") {
    appendApprovalRequest(next, payload, meta, context)
    markChanged()
  } else if (type === "approval_resolved") {
    appendApprovalResolved(next, payload, meta, context)
    markChanged()
  } else if (type === "session_run_cancel_requested") {
    patchRunStatus(next, "stopping")
    markChanged()
  } else if (type === "session_run_cancelled") {
    settlePendingApprovalTools(next, "cancelled", String(payload.reason || "session_run_cancelled"), meta)
    appendNotice("info", labels.cancelled, "cancelled")
    finalizeRunTranscriptItems(next, "cancelled", context)
    patchRunStatus(next, "cancelled")
    next.session = { ...next.session, state: "cancelled" }
    markChanged()
  } else if (type === "error" || type === "session_run_failed") {
    const message = String(payload.message || "unknown error")
    settlePendingApprovalTools(next, "denied", message, meta)
    if (type === "error" || !hasNoticeLevel(next, "error")) {
      appendNotice("error", `${labels.errorPrefix}${message}`, "error")
    }
    finalizeRunTranscriptItems(next, "error", context)
    patchRunStatus(next, "error")
    next.session = { ...next.session, state: "error" }
    markChanged()
  } else if (type === "session_run_end") {
    const response = String(payload.response || "")
    if (response && payload.response_rendered !== true) {
      finalizeAssistant(next, response, meta, context)
    }
    finalizeRunTranscriptItems(next, "done", context)
    settlePendingApprovalTools(next, "denied", "session_run_closed", meta)
    patchRunStatus(next, "done")
    next.session = { ...next.session, state: "success" }
    markChanged()
  }

  return { bundle: changed ? next : bundle, changed, ...meta }
}

function cloneBundle(bundle: MockSessionBundle): MockSessionBundle {
  return JSON.parse(JSON.stringify(bundle)) as MockSessionBundle
}

function eventRenderMeta(
  bundle: MockSessionBundle,
  event: Record<string, unknown>,
  type: string,
  payload: Record<string, unknown>,
  context: SessionRunTranscriptContext,
): EventRenderMeta {
  const sessionEventSeq = numberValue(event.session_event_seq) ?? numberValue(event.sessionEventSeq)
  const sessionRunSeq = numberValue(event.session_run_seq) ?? numberValue(event.seq)
  const sessionRunId = stringValue(event.session_run_id) || context.activeSessionRunId
  const eventSessionId =
    stringValue(event.session_id) ||
    stringValue(payload.session_id) ||
    context.currentSessionId ||
    bundle.session.id
  const toolCallId = stringValue(payload.tool_call_id)
  const eventKey = sessionEventSeq !== undefined
    ? `session:${eventSessionId || "unknown"}:${sessionEventSeq}`
    : sessionRunId && sessionRunSeq !== undefined
      ? `session-run:${sessionRunId}:${sessionRunSeq}:${type}${toolCallId ? `:${toolCallId}` : ""}`
      : undefined
  return { eventKey, sessionEventSeq }
}

function bundleHasEventKey(bundle: MockSessionBundle, eventKey: string): boolean {
  return bundle.turns.some((turn) =>
    [turn.userMessage, ...turn.assistantMessages].some((message) =>
      message.eventKey === eventKey ||
      message.parts.some((part) => part.eventKey === eventKey)
    )
  )
}

function withEventMeta<T extends TranscriptItem>(item: T, meta?: EventRenderMeta): T {
  return {
    ...item,
    ...(meta?.eventKey ? { eventKey: meta.eventKey } : {}),
    ...(meta?.sessionEventSeq !== undefined ? { sessionEventSeq: meta.sessionEventSeq } : {}),
  }
}

function stablePartId(prefix: string, meta: EventRenderMeta, now: number, index: number): string {
  return `${prefix}-${meta.sessionEventSeq ?? now}-${index}`
}

function ensureAssistantMessage(bundle: MockSessionBundle, context: SessionRunTranscriptContext): MockMessage {
  if (!bundle.turns.length) {
    bundle.turns.push({
      userMessage: {
        id: "user-0",
        role: "user",
        text: "",
        parts: [],
        timestamp: context.now ?? Date.now(),
      },
      assistantMessages: [],
    })
  }
  const turn = bundle.turns[bundle.turns.length - 1]
  if (!turn.assistantMessages.length) {
    turn.assistantMessages.push({
      id: `assistant-${bundle.turns.length - 1}`,
      role: "assistant",
      text: "",
      parts: [],
      timestamp: context.now ?? Date.now(),
      traceNodeKind: "assistant_message",
      traceNodeStatus: context.isWorking ? "active" : "success",
    })
  }
  return turn.assistantMessages[0]
}

function updateAssistantItems(
  bundle: MockSessionBundle,
  updater: (items: TranscriptItem[]) => TranscriptItem[],
  context: SessionRunTranscriptContext,
  options: { traceNodeStatus?: MockMessage["traceNodeStatus"] } = {},
): void {
  const message = ensureAssistantMessage(bundle, context)
  const parts = updater(message.parts)
  message.parts = parts
  message.text = parts
    .filter((part): part is AssistantTextItem => part.type === "assistant_text")
    .map((part) => part.markdown || "")
    .join("")
  message.traceNodeStatus = options.traceNodeStatus ?? (context.isWorking ? "active" : "success")
}

function appendAssistantText(
  bundle: MockSessionBundle,
  text: string,
  prefix: string,
  meta: EventRenderMeta,
  context: SessionRunTranscriptContext,
  options: { format?: "plain" | "markdown"; trim?: boolean } = {},
): void {
  const clean = stripAnsi(text)
  const content = options.trim === false ? clean : clean.trim()
  if (!content) return
  const now = context.now ?? Date.now()
  updateAssistantItems(bundle, (parts) => [
    ...parts,
    withEventMeta({
      id: stablePartId(prefix, meta, now, parts.length),
      type: "assistant_text",
      markdown: content,
      format: options.format || "plain",
      streamKey: prefix,
    }, meta),
  ], context)
}

function upsertAssistantStream(
  bundle: MockSessionBundle,
  text: string,
  meta: EventRenderMeta,
  context: SessionRunTranscriptContext,
): void {
  const content = stripAnsi(text)
  if (!content) return
  updateAssistantItems(bundle, (parts) => {
    const index = findLastItemIndex(parts, (part) =>
      part.type === "assistant_text" && part.streamKey === "assistant-stream"
    )
    if (index >= 0) {
      const next = [...parts]
      const current = next[index] as AssistantTextItem
      next[index] = withEventMeta({
        ...current,
        markdown: `${current.markdown || ""}${content}`,
        format: "markdown",
        streaming: true,
        streamKey: "assistant-stream",
      }, meta)
      return next
    }
    return [
      ...parts,
      withEventMeta({
        id: `assistant-stream-${context.activeSessionRunId || meta.sessionEventSeq || "pending"}`,
        type: "assistant_text",
        markdown: content,
        format: "markdown",
        streaming: true,
        streamKey: "assistant-stream",
      }, meta),
    ]
  }, context)
}

function finalizeAssistant(
  bundle: MockSessionBundle,
  text: string,
  meta: EventRenderMeta,
  context: SessionRunTranscriptContext,
): void {
  const content = stripAnsi(text).trim()
  if (!content) return
  updateAssistantItems(bundle, (parts) => {
    const streamIndex = findLastItemIndex(parts, (part) =>
      part.type === "assistant_text" && part.streamKey === "assistant-stream"
    )
    if (streamIndex >= 0) {
      const next = [...parts]
      next[streamIndex] = withEventMeta({
        ...next[streamIndex] as AssistantTextItem,
        markdown: content,
        format: "markdown",
        streaming: false,
        streamKey: "assistant-message",
      }, meta)
      return next
    }
    return [
      ...parts,
      withEventMeta({
        id: stablePartId("assistant-message", meta, context.now ?? Date.now(), parts.length),
        type: "assistant_text",
        markdown: content,
        format: "markdown",
        streaming: false,
        streamKey: "assistant-message",
      }, meta),
    ]
  }, context)
}

function upsertReasoningThinking(
  bundle: MockSessionBundle,
  text: string,
  meta: EventRenderMeta,
  context: SessionRunTranscriptContext,
  labels: SessionRunTranscriptLabels,
): void {
  const content = stripAnsi(text)
  if (!content) return
  updateAssistantItems(bundle, (parts) => {
    const updateThinkingItem = (part: ThinkingItem): ThinkingItem => withEventMeta({
      ...part,
      title: labels.thinking,
      detail: undefined,
      active: true,
      raw: `${part.raw || ""}${content}`,
      streamKey: REASONING_STREAM_KEY,
    }, meta)
    const index = findLastItemIndex(parts, isReasoningThinkingItem)
    if (index >= 0) {
      const next = [...parts]
      next[index] = updateThinkingItem(next[index] as ThinkingItem)
      return next
    }
    return [
      ...parts,
      withEventMeta({
        id: `thinking-${context.activeSessionRunId || meta.sessionEventSeq || "pending"}`,
        type: "thinking",
        title: labels.thinking,
        active: true,
        raw: content,
        streamKey: REASONING_STREAM_KEY,
      }, meta),
    ]
  }, context)
}

function finalizeReasoning(
  bundle: MockSessionBundle,
  payload: Record<string, unknown>,
  meta: EventRenderMeta,
  context: SessionRunTranscriptContext,
  _labels: SessionRunTranscriptLabels,
): void {
  const rawValue = stringValue(payload.raw) ?? stringValue(payload.content) ?? ""
  const summaryValue = stringValue(payload.summary) ?? ""
  const raw = stripAnsi(rawValue)
  const summary = stripAnsi(summaryValue)
  if (!raw && !summary) return
  updateAssistantItems(bundle, (parts) => {
    const createReasoning = (id: string): ReasoningItem => withEventMeta({
      id,
      type: "reasoning",
      summary: summary || undefined,
      raw: raw || summary,
      format: stringValue(payload.format) === "plain" ? "plain" : "markdown",
    }, meta)
    const thinkingIndex = findLastItemIndex(parts, isReasoningThinkingItem)
    if (thinkingIndex >= 0) {
      const next = [...parts]
      next[thinkingIndex] = createReasoning(next[thinkingIndex].id)
      return next
    }
    const reasoningIndex = findLastItemIndex(parts, (part) => part.type === "reasoning")
    if (reasoningIndex >= 0) {
      const next = [...parts]
      const current = next[reasoningIndex] as ReasoningItem
      next[reasoningIndex] = createReasoning(current.id)
      return next
    }
    return [...parts, createReasoning(stablePartId("reasoning-message", meta, context.now ?? Date.now(), parts.length))]
  }, context)
}

function appendTerminal(
  bundle: MockSessionBundle,
  content: string,
  title: string,
  meta: EventRenderMeta,
  context: SessionRunTranscriptContext,
): void {
  const clean = stripAnsi(content).trim()
  if (!clean || isRemotePeerReadyTui(clean)) return
  updateAssistantItems(bundle, (parts) => [
    ...parts,
    withEventMeta({
      id: stablePartId("terminal", meta, context.now ?? Date.now(), parts.length),
      type: "terminal",
      title,
      content: clean,
    }, meta),
  ], context)
}

function appendView(
  bundle: MockSessionBundle,
  payload: Record<string, unknown>,
  meta: EventRenderMeta,
  context: SessionRunTranscriptContext,
  labels: SessionRunTranscriptLabels,
  now: number,
): void {
  const nestedPayload = objectValue(payload.payload)
  const viewPayload = Object.keys(nestedPayload).length ? nestedPayload : payload
  if (!hasMeaningfulPayload(viewPayload)) return
  updateAssistantItems(bundle, (parts) => [
    ...parts,
    withEventMeta({
      id: stablePartId("view", meta, now, parts.length),
      type: "view",
      title: String(payload.title || payload.message || labels.structuredView),
      viewType: String(payload.view_type || payload.kind || "view"),
      level: String(payload.level || "info"),
      payload: viewPayload,
    }, meta),
  ], context)
}

function appendContextEvent(
  bundle: MockSessionBundle,
  payload: Record<string, unknown>,
  meta: EventRenderMeta,
  context: SessionRunTranscriptContext,
  labels: SessionRunTranscriptLabels,
  now: number,
): void {
  updateAssistantItems(bundle, (parts) => [
    ...parts,
    withEventMeta({
      id: stablePartId("context", meta, now, parts.length),
      type: "context_event",
      title: String(payload.message || payload.phase || labels.contextEvent),
      payload,
    }, meta),
  ], context)
}

function appendMemoryContext(
  bundle: MockSessionBundle,
  payload: Record<string, unknown>,
  meta: EventRenderMeta,
  context: SessionRunTranscriptContext,
  labels: SessionRunTranscriptLabels,
  now: number,
): void {
  updateAssistantItems(bundle, (parts) => [
    ...parts,
    withEventMeta({
      id: stablePartId("memory", meta, now, parts.length),
      type: "memory_context",
      title: String(payload.title || labels.memoryContext),
      payload,
    }, meta),
  ], context)
}

function appendUiEvent(
  bundle: MockSessionBundle,
  eventType: string,
  payload: Record<string, unknown>,
  meta: EventRenderMeta,
  context: SessionRunTranscriptContext,
  labels: SessionRunTranscriptLabels,
  now: number,
): void {
  updateAssistantItems(bundle, (parts) => [
    ...parts,
    withEventMeta({
      id: stablePartId(eventType, meta, now, parts.length),
      type: "ui_event",
      kind: String(payload.kind || eventType.replace("_event", "")),
      level: String(payload.level || "info"),
      title: String(payload.title || payload.message || uiEventTitle(eventType, labels)),
      payload,
    }, meta),
  ], context)
}

function appendToolStream(
  bundle: MockSessionBundle,
  payload: Record<string, unknown>,
  meta: EventRenderMeta,
  context: SessionRunTranscriptContext,
): void {
  const toolName = String(payload.tool_name || "tool")
  const toolCallId = requiredToolCallId(payload)
  if (!toolCallId) return
  const content = stripAnsi(String(payload.content || ""))
  if (!content) return
  const stream = String(payload.stream || "stdout")
  const outputFormat = stringValue(payload.format) || stringValue(payload.output_format) || stringValue(payload.tool_output_format)
  const toolSource = stringValue(payload.tool_source)
  updateAssistantItems(bundle, (parts) => {
    const existingIndex = resolveToolPartIndex(parts, toolName, toolCallId)
    const existing = existingIndex >= 0 ? parts[existingIndex] as ToolActivityItem : undefined
    const resolvedToolSource = toolSource || existing?.source
    const isShell = isShellToolName(toolName, resolvedToolSource)
    const shellOutput = isShell
      ? appendShellOutputChunk(existing?.outputChunks, stream, content)
      : undefined
    const patch: Partial<ToolActivityItem> = {
      status: "running",
      toolCallId,
      source: resolvedToolSource,
      stream,
      outputFormat: inferToolOutputFormat(toolName, resolvedToolSource, outputFormat),
      output: shellOutput
        ? buildShellOutputText(shellOutput.chunks)
        : `${existing?.output || ""}${content}`,
      outputChunks: shellOutput?.chunks || existing?.outputChunks,
      outputTruncated: shellOutput?.truncated || existing?.outputTruncated,
    }
    return upsertToolPartInParts(parts, toolName, patch, { fallbackId: toolCallId }).map((part) => (
      part.type === "tool" && part.toolCallId === toolCallId ? withEventMeta(part, meta) : part
    ))
  }, context)
}

function preparingToolCallId(payload: Record<string, unknown>, context: SessionRunTranscriptContext): string {
  const index = numberValue(payload.index) ?? 0
  return `preparing:${context.activeSessionRunId || "pending"}:${index}`
}

function shouldIgnoreToolCallDelta(
  parts: TranscriptItem[],
  toolCallId: string | undefined,
  preparingIndex: number,
): boolean {
  return parts.some((part) => {
    if (part.type !== "tool") return false
    if (toolCallId && part.toolCallId === toolCallId) return part.status !== "preparing"
    if (!toolCallId && part.preparingIndex === preparingIndex) return part.status !== "preparing"
    return false
  })
}

function appendToolCallDelta(
  bundle: MockSessionBundle,
  payload: Record<string, unknown>,
  meta: EventRenderMeta,
  context: SessionRunTranscriptContext,
): void {
  const rawToolName = stringValue(payload.tool_name)
  const toolName = rawToolName || "tool"
  const realToolCallId = requiredToolCallId(payload)
  const toolCallId = realToolCallId || preparingToolCallId(payload, context)
  const preparingIndex = numberValue(payload.index) ?? 0
  const argumentsPreview = stringValue(payload.arguments_preview)
  updateAssistantItems(bundle, (parts) => {
    if (shouldIgnoreToolCallDelta(parts, realToolCallId, preparingIndex)) return parts
    return upsertToolPartWithPreparing(parts, toolName, {
      status: "preparing",
      toolCallId,
      source: stringValue(payload.tool_source),
      startedAt: numberValue(payload.started_at),
      input: argumentsPreview ? { arguments_preview: argumentsPreview } : undefined,
      preparingIndex,
    }, toolCallId, { meta, preparingIndex })
  }, context)
}

function appendToolStart(
  bundle: MockSessionBundle,
  payload: Record<string, unknown>,
  meta: EventRenderMeta,
  context: SessionRunTranscriptContext,
): void {
  const toolName = String(payload.tool_name || "tool")
  const toolCallId = requiredToolCallId(payload)
  if (!toolCallId) return
  updateAssistantItems(bundle, (parts) =>
    upsertToolPartWithPreparing(parts, toolName, {
      status: "running",
      toolCallId,
      source: stringValue(payload.tool_source),
      startedAt: numberValue(payload.started_at),
      input: objectValue(payload.tool_args),
      resultMeta: {},
      preparingIndex: numberValue(payload.index),
    }, toolCallId, { meta, preparingIndex: numberValue(payload.index) }),
  context)
}

function appendToolProtocolError(
  bundle: MockSessionBundle,
  payload: Record<string, unknown>,
  meta: EventRenderMeta,
  context: SessionRunTranscriptContext,
): void {
  const toolName = String(payload.tool_name || "tool")
  const toolCallId = requiredToolCallId(payload)
  if (!toolCallId) return
  const code = stringValue(payload.code)
  const message = String(payload.message || code || "Remote tool protocol error")
  const output = code ? `[${code}] ${message}` : message
  const resultMeta: Record<string, unknown> = {}
  if (code) resultMeta.code = code
  if (message) resultMeta.message = message
  updateAssistantItems(bundle, (parts) =>
    upsertToolPartWithPreparing(parts, toolName, {
      status: "protocol_error",
      toolCallId,
      output,
      outputFormat: "plain",
      resultMeta,
    }, toolCallId, { meta }),
  context)
}

function appendToolEnd(
  bundle: MockSessionBundle,
  payload: Record<string, unknown>,
  meta: EventRenderMeta,
  context: SessionRunTranscriptContext,
): void {
  const toolName = String(payload.tool_name || "tool")
  const toolCallId = requiredToolCallId(payload)
  if (!toolCallId) return
  const outputFormat = stringValue(payload.format) ||
    stringValue(payload.output_format) ||
    stringValue(payload.tool_output_format) ||
    stringValue(payload.tool_result_format)
  const toolSource = stringValue(payload.tool_source)
  const finalOutput = String(payload.tool_result || "")
  updateAssistantItems(bundle, (parts) => {
    const existingIndex = resolveToolPartIndex(parts, toolName, toolCallId, true)
    const existing = existingIndex >= 0 ? parts[existingIndex] as ToolActivityItem : undefined
    const resolvedToolSource = toolSource || existing?.source
    const isShell = isShellToolName(toolName, resolvedToolSource)
    const reconciledShellOutput = isShell
      ? reconcileShellFinalOutput(existing?.output, finalOutput, existing?.outputChunks)
      : finalOutput
    const shellChunks = isShell
      ? existing?.outputChunks?.length
        ? existing.outputChunks
        : shellChunksFromText(reconciledShellOutput)
      : existing?.outputChunks
    const patch: Partial<ToolActivityItem> = {
      status: statusAfterToolReturn(existing?.status),
      toolCallId,
      source: resolvedToolSource,
      endedAt: numberValue(payload.ended_at),
      output: reconciledShellOutput,
      outputFormat: inferToolOutputFormat(toolName, resolvedToolSource, outputFormat),
      outputChunks: shellChunks,
      finalOutput: isShell ? finalOutput : undefined,
      resultMeta: objectValue(payload.meta),
    }
    return upsertToolPartWithPreparing(parts, toolName, patch, toolCallId, { matchReturn: true, meta })
  }, context)
}

function appendApprovalRequest(
  bundle: MockSessionBundle,
  payload: Record<string, unknown>,
  meta: EventRenderMeta,
  context: SessionRunTranscriptContext,
): void {
  const toolName = String(payload.tool_name || "tool")
  const toolCallId = requiredToolCallId(payload)
  const decision = context.approvalDecision
  updateAssistantItems(bundle, (parts) =>
    upsertToolPartWithPreparing(parts, toolName, {
      status: decision === "allow" ? "approved" : decision === "deny" ? "denied" : "awaiting_approval",
      toolCallId,
      source: stringValue(payload.tool_source),
      input: objectValue(payload.tool_args),
      approvalId: stringValue(payload.approval_id),
      approvalReason: context.approvalReason || stringValue(payload.reason),
      approvalIntent: stringValue(payload.intent),
      approvalContent: stringValue(payload.content),
      approvalSections: Array.isArray(payload.sections) ? payload.sections as Record<string, unknown>[] : undefined,
      approvalDecision: decision === "allow" ? "auto_approved" : decision === "deny" ? "auto_denied" : undefined,
    }, toolCallId, { meta }),
  context)
}

function appendApprovalResolved(
  bundle: MockSessionBundle,
  payload: Record<string, unknown>,
  meta: EventRenderMeta,
  context: SessionRunTranscriptContext,
): void {
  const approvalId = String(payload.approval_id || "")
  const toolCallId = stringValue(payload.tool_call_id)
  const decision = String(payload.decision || "")
  const reason = stringValue(payload.reason)
  updateAssistantItems(bundle, (parts) =>
    parts.map((part) => {
      if (part.type !== "tool") return part
      if (toolCallId && part.toolCallId !== toolCallId) return part
      if (!toolCallId && part.approvalId !== approvalId) return part
      return withEventMeta({
        ...part,
        approvalDecision: approvalDecisionAfterResolution(part.approvalDecision, decision),
        approvalResultReason: reason || part.approvalResultReason,
        status: approvalStatusAfterResolution(decision, part.status),
      }, meta)
    }),
  context)
}

function upsertToolPartWithPreparing(
  parts: TranscriptItem[],
  toolName: string,
  patch: Partial<ToolActivityItem>,
  fallbackId?: string,
  options: { matchReturn?: boolean; meta?: EventRenderMeta; preparingIndex?: number } = {},
): TranscriptItem[] {
  const toolCallId = patch.toolCallId || fallbackId
  const existingIndex = resolveToolPartIndex(parts, toolName, toolCallId, options.matchReturn)
  if (existingIndex < 0 && options.preparingIndex !== undefined) {
    const preparingIndex = options.preparingIndex
    const draftIndex = parts.findIndex((part) =>
      part.type === "tool" &&
        part.status === "preparing" &&
        (
          part.toolCallId === toolCallId ||
          part.preparingIndex === preparingIndex
        )
    )
    if (draftIndex >= 0) {
      const current = parts[draftIndex] as ToolActivityItem
      const definedPatch = defined(patch)
      const next = [...parts]
      next[draftIndex] = withEventMeta({
        ...current,
        ...definedPatch,
        id: current.id,
        type: "tool",
        tool: toolName,
        toolCallId: toolCallId || current.toolCallId,
        preparingIndex,
      } as ToolActivityItem, options.meta)
      return next
    }
  }
  return upsertToolPartInParts(parts, toolName, patch, {
    fallbackId,
    matchReturn: options.matchReturn,
  }).map((part) => (
    part.type === "tool" && part.toolCallId === toolCallId
      ? withEventMeta(part, options.meta)
      : part
  ))
}

function resolveToolPartIndex(
  parts: TranscriptItem[],
  toolName: string,
  toolCallId?: string,
  matchReturn = false,
): number {
  return matchReturn
    ? resolveToolPartIndexForReturn(parts, toolName, toolCallId)
    : resolveActiveToolPartIndex(parts, toolName, toolCallId)
}

function finalizeRunTranscriptItems(
  bundle: MockSessionBundle,
  status: "cancelled" | "done" | "error" | "interrupted",
  context: SessionRunTranscriptContext,
): void {
  const traceNodeStatus = traceStatusForRunEnd(status)
  updateAssistantItems(bundle, (parts) =>
    parts.map((part) => normalizeTranscriptItemForRunEnd(part, traceNodeStatus)),
  context, { traceNodeStatus })
}

function normalizeTranscriptItemForRunEnd(
  item: TranscriptItem,
  traceNodeStatus: MockMessage["traceNodeStatus"],
): TranscriptItem {
  if (item.type === "assistant_text" && item.streamKey === "assistant-stream") {
    return {
      ...item,
      streaming: false,
      streamKey: "assistant-message",
      traceNodeStatus,
    }
  }
  if (isReasoningThinkingItem(item)) {
    return {
      ...item,
      active: false,
      traceNodeStatus,
    }
  }
  if (item.type === "tool" && ["running", "pending", "preparing", "awaiting_approval"].includes(item.status || "")) {
    return {
      ...item,
      status: traceNodeStatus === "cancelled" ? "cancelled" : item.status,
      traceNodeStatus,
    }
  }
  return {
    ...item,
    traceNodeStatus,
  }
}

function settlePendingApprovalTools(
  bundle: MockSessionBundle,
  status: "cancelled" | "denied",
  reason: string,
  meta: EventRenderMeta,
): void {
  bundle.turns = bundle.turns.map((turn) => ({
    ...turn,
    assistantMessages: turn.assistantMessages.map((message) => ({
      ...message,
      parts: message.parts.map((part) => {
        if (part.type !== "tool") return part
        if (part.status !== "awaiting_approval" || !part.approvalId || part.approvalDecision) return part
        return withEventMeta({
          ...part,
          status,
          approvalDecision: "deny_once",
          approvalResultReason: reason,
        }, meta)
      }),
    })),
  }))
}

function patchRunStatus(bundle: MockSessionBundle, status: MockTaskStats["runStatus"]): void {
  bundle.stats = {
    ...bundle.stats,
    runStatus: status,
  }
}

function traceStatusForRunEnd(status: "cancelled" | "done" | "error" | "interrupted"): MockMessage["traceNodeStatus"] {
  if (status === "error") return "error"
  if (status === "cancelled") return "cancelled"
  return "success"
}

function hasNoticeLevel(bundle: MockSessionBundle, level: NoticeLevel): boolean {
  const currentTurn = bundle.turns[bundle.turns.length - 1]
  const currentAssistant = currentTurn?.assistantMessages[0]
  return Boolean(currentAssistant?.parts.some((part) => part.type === "notice" && part.level === level))
}

function isReasoningThinkingItem(item: TranscriptItem): item is ThinkingItem {
  return item.type === "thinking" && item.streamKey === REASONING_STREAM_KEY
}

function findLastItemIndex(
  parts: TranscriptItem[],
  predicate: (item: TranscriptItem) => boolean,
): number {
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    if (predicate(parts[index])) return index
  }
  return -1
}

function inferToolOutputFormat(
  toolName: string,
  toolSource?: string,
  explicitFormat?: string,
): "plain" | "markdown" | "terminal" | "json" {
  if (
    explicitFormat === "plain" ||
    explicitFormat === "markdown" ||
    explicitFormat === "terminal" ||
    explicitFormat === "json"
  ) {
    return explicitFormat
  }
  const normalizedTool = toolName.toLowerCase()
  const normalizedSource = (toolSource || "").toLowerCase()
  if (normalizedTool === "shell" || normalizedTool === "execute_command" || normalizedSource.includes("terminal")) {
    return "terminal"
  }
  if (
    normalizedSource.includes("mcp") ||
    normalizedTool.includes("agent") ||
    normalizedTool === "mcp" ||
    normalizedTool === "delegate_agent"
  ) {
    return "markdown"
  }
  return "plain"
}

function isStructuredUiEventType(value: string): boolean {
  return [
    "remote_event",
    "mcp_event",
    "model_event",
    "session_event",
    "command_event",
    "approval_event",
    "system_event",
    "agent_event",
    "ui_event",
    "delegated_run_completed",
    "taskflow_started",
  ].includes(value)
}

function isMemoryContextPayload(payload: Record<string, unknown>): boolean {
  return payload.schema === "memory_context.v1" || payload.context_kind === "memory_injection"
}

function uiEventTitle(type: string, labels: SessionRunTranscriptLabels): string {
  const titles: Record<string, string> = {
    remote_event: "远程事件",
    mcp_event: "MCP 事件",
    model_event: "模型事件",
    session_event: "会话事件",
    command_event: "命令事件",
    approval_event: "审批事件",
    system_event: "系统事件",
    agent_event: "智能体事件",
    ui_event: labels.runEvent,
    delegated_run_completed: "委派运行完成",
    taskflow_started: "Taskflow 已启动",
  }
  return titles[type] || labels.runEvent
}

function isRemotePeerReadyTui(content: string): boolean {
  const normalized = content.replace(/\r\n/g, "\n")
  const titleMatch = normalized.match(/╭[─\s]*([A-Z_ ]+?)[─\s]*╮/)
  return titleMatch?.[1].trim() === "REMOTE PEER READY"
}

function hasMeaningfulPayload(payload: Record<string, unknown>): boolean {
  return Object.values(payload).some((value) => {
    if (value === undefined || value === null) return false
    if (typeof value === "string") return Boolean(value.trim())
    if (Array.isArray(value)) return value.length > 0
    if (typeof value === "object") return Object.keys(value as Record<string, unknown>).length > 0
    return true
  })
}

function stripAnsi(value: string): string {
  return value.replace(/\x1b\[[0-9;]*m/g, "")
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return undefined
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function defined<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined)
  ) as Partial<T>
}
