import type { MockMessage, MockSessionBundle, MockTaskStats, MockTurn } from "../components/chat/mock-data"
import type {
  AssistantTextItem,
  DocumentDraftItem,
  FileChangeEntry,
  FileChangeItem,
  FileChangeStatus,
  NoticeLevel,
  RawEventRef,
  ReasoningItem,
  ThinkingItem,
  ToolActivityItem,
  TranscriptItem,
  WorkflowDecisionAction,
  WorkflowItemStatus,
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
  providerStreamInterrupted: string
  streamInterruptedCanContinue: string
  capabilityPackageSessionFailed: string
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
  eventKeys?: string[]
  sessionEventSeqs?: number[]
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
  "lifecycle_hook",
  "workflow_step",
  "workflow_artifact",
  "workflow_decision",
  "workflow_result",
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
  "file_change_started",
  "file_change_patch_updated",
  "file_change_approval_requested",
  "file_change_approval_resolved",
  "file_change_completed",
  "turn_diff_updated",
  "document_draft_started",
  "document_draft_progress",
  "document_draft_snapshot",
  "document_draft_commit_requested",
  "document_draft_committed",
  "document_draft_failed",
  "document_draft_cancelled",
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
  providerStreamInterrupted: "模型输出流中断，正在尝试恢复。",
  streamInterruptedCanContinue: "模型输出流中断，可继续生成。",
  capabilityPackageSessionFailed: "能力流程执行失败。",
}

const REASONING_STREAM_KEY = "reasoning-stream"
const ASSISTANT_STREAM_KEY = "assistant-stream"
const ASSISTANT_MESSAGE_KEY = "assistant-message"

export function applySessionRunTranscriptEvent(
  bundle: MockSessionBundle,
  event: Record<string, unknown>,
  context: SessionRunTranscriptContext = {},
): SessionRunTranscriptReduction {
  const reduction = applySessionRunTranscriptEvents(bundle, [event], context)
  return {
    ...reduction,
    eventKey: reduction.eventKeys?.[0] ?? reduction.eventKey,
    sessionEventSeq: reduction.sessionEventSeqs?.[0] ?? reduction.sessionEventSeq,
  }
}

// TranscriptItem[] stores canonical session-run event facts only. User-facing
// grouping, reasoning placement, and final-answer ordering belong to
// buildTranscriptPresentation().

export function applySessionRunTranscriptEvents(
  bundle: MockSessionBundle,
  events: readonly Record<string, unknown>[],
  context: SessionRunTranscriptContext = {},
): SessionRunTranscriptReduction {
  if (!events.length) {
    return { bundle, changed: false, eventKeys: [], sessionEventSeqs: [] }
  }

  const next = cloneBundle(bundle)
  const eventKeys: string[] = []
  const sessionEventSeqs: number[] = []
  let changed = false
  let lastEventKey: string | undefined
  let lastSessionEventSeq: number | undefined

  for (const event of events) {
    const reduction = applySessionRunTranscriptEventToBundle(next, event, context)
    if (reduction.eventKey) {
      eventKeys.push(reduction.eventKey)
      lastEventKey = reduction.eventKey
    }
    if (reduction.sessionEventSeq !== undefined) {
      sessionEventSeqs.push(reduction.sessionEventSeq)
      lastSessionEventSeq = reduction.sessionEventSeq
    }
    changed = reduction.changed || changed
  }

  return {
    bundle: changed ? next : bundle,
    changed,
    eventKey: lastEventKey,
    sessionEventSeq: lastSessionEventSeq,
    eventKeys,
    sessionEventSeqs,
  }
}

function applySessionRunTranscriptEventToBundle(
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

  const next = bundle
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
    options: { format?: "plain" | "markdown"; trim?: boolean; rawEventRefs?: RawEventRef[] } = {},
  ) => {
    const clean = stripAnsi(text)
    const content = options.trim === false ? clean : clean.trim()
    if (!content) return
    updateAssistantItems(next, (parts) => {
      const nextParts = closeTrailingInlineStream(parts)
      return [
        ...nextParts,
        withEventMeta({
          id: stablePartId(prefix, meta, now, nextParts.length),
          type: "notice",
          level,
          text: content,
          format: options.format || "plain",
          rawEventRefs: options.rawEventRefs,
        }, meta),
      ]
    }, context)
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
    upsertReasoningThinking(next, String(payload.content || ""), payload, meta, context, labels)
    markChanged()
  } else if (type === "reasoning_message") {
    finalizeReasoning(next, payload, meta, context, labels)
    markChanged()
  } else if (type === "assistant_delta") {
    upsertAssistantStream(next, String(payload.content || ""), payload, meta, context)
    markChanged()
  } else if (type === "assistant_message") {
    finalizeAssistant(next, String(payload.content || ""), payload, meta, context)
    markChanged()
  } else if (type === "output") {
    const format = String(payload.format || "plain")
    if (format === "terminal") {
      appendTerminal(next, String(payload.content || ""), labels.terminalOutput, payload, meta, context)
    } else {
      appendNotice(noticeLevelValue(payload.level), String(payload.content || ""), "output", {
        format: format === "markdown" ? "markdown" : "plain",
        rawEventRefs: rawEventRefsFromPayload(payload),
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
  } else if (type === "lifecycle_hook") {
    appendLifecycleHookEvent(next, payload, meta, context, labels, now)
    markChanged()
  } else if (type === "workflow_step") {
    appendWorkflowStep(next, payload, meta, context, now)
    markChanged()
  } else if (type === "workflow_artifact") {
    appendWorkflowArtifact(next, payload, meta, context, now)
    markChanged()
  } else if (type === "workflow_decision") {
    appendWorkflowDecision(next, payload, meta, context, now)
    markChanged()
  } else if (type === "workflow_result") {
    appendWorkflowResult(next, payload, meta, context, now)
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
      sessionEventMessage(
        payload,
        labels,
        "provider_stream_interrupted.recovering",
        labels.providerStreamInterrupted,
      ),
      "stream-recovery",
      { rawEventRefs: rawEventRefsFromPayload(payload) },
    )
  } else if (type === "session_run_interrupted") {
    const message = sessionEventMessage(payload, labels, "", labels.streamInterruptedCanContinue)
    appendNotice("warning", `${labels.streamInterruptedPrefix}${message}`, "stream-interrupted", {
      rawEventRefs: rawEventRefsFromPayload(payload),
    })
    finalizeRunTranscriptItems(next, "interrupted", context)
    patchRunStatus(next, "interrupted")
    next.session = { ...next.session, state: "active" }
    markChanged()
  } else if (
    type === "file_change_started" ||
    type === "file_change_patch_updated" ||
    type === "file_change_approval_requested" ||
    type === "file_change_approval_resolved" ||
    type === "file_change_completed" ||
    type === "turn_diff_updated"
  ) {
    upsertFileChange(next, type, payload, meta, context)
    markChanged()
  } else if (
    type === "document_draft_started" ||
    type === "document_draft_progress" ||
    type === "document_draft_snapshot" ||
    type === "document_draft_commit_requested" ||
    type === "document_draft_committed" ||
    type === "document_draft_failed" ||
    type === "document_draft_cancelled"
  ) {
    upsertDocumentDraft(next, type, payload, meta, context)
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
    appendNotice("info", labels.cancelled, "cancelled", { rawEventRefs: rawEventRefsFromPayload(payload) })
    finalizeRunTranscriptItems(next, "cancelled", context)
    patchRunStatus(next, "cancelled")
    next.session = { ...next.session, state: "cancelled" }
    markChanged()
  } else if (type === "error" || type === "session_run_failed") {
    const message = sessionEventMessage(payload, labels, "", "unknown error")
    settlePendingApprovalTools(next, "denied", message, meta)
    if (type === "error" || !hasNoticeLevel(next, "error")) {
      appendNotice("error", `${labels.errorPrefix}${message}`, "error", { rawEventRefs: rawEventRefsFromPayload(payload) })
    }
    finalizeRunTranscriptItems(next, "error", context)
    patchRunStatus(next, "error")
    next.session = { ...next.session, state: "error" }
    markChanged()
  } else if (type === "session_run_end") {
    const response = String(payload.response || "")
    if (response && payload.response_rendered !== true) {
      finalizeAssistant(next, response, payload, meta, context)
    }
    finalizeRunTranscriptItems(next, "done", context)
    settlePendingApprovalTools(next, "denied", "session_run_closed", meta)
    patchRunStatus(next, "done")
    next.session = { ...next.session, state: "success" }
    markChanged()
  }

  return { bundle: next, changed, ...meta }
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

function closeTrailingInlineStream(parts: TranscriptItem[]): TranscriptItem[] {
  const last = parts[parts.length - 1]
  if (!last) return parts

  let nextLast: TranscriptItem | undefined
  if (last.type === "assistant_text" && last.streamKey === ASSISTANT_STREAM_KEY) {
    nextLast = {
      ...last,
      streaming: false,
      streamKey: ASSISTANT_MESSAGE_KEY,
    }
  } else if (isReasoningThinkingItem(last)) {
    nextLast = {
      ...last,
      active: false,
    }
  }

  if (!nextLast) return parts
  return [...parts.slice(0, -1), nextLast]
}

function findLastItemIndex<T>(items: T[], predicate: (item: T) => boolean): number {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (predicate(items[index])) return index
  }
  return -1
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
  options: { format?: "plain" | "markdown"; trim?: boolean; rawEventRefs?: RawEventRef[] } = {},
): void {
  const clean = stripAnsi(text)
  const content = options.trim === false ? clean : clean.trim()
  if (!content) return
  const now = context.now ?? Date.now()
  updateAssistantItems(bundle, (parts) => {
    const nextParts = closeTrailingInlineStream(parts)
    return [
      ...nextParts,
      withEventMeta({
        id: stablePartId(prefix, meta, now, nextParts.length),
        type: "assistant_text",
        markdown: content,
        format: options.format || "plain",
        streamKey: prefix,
        rawEventRefs: options.rawEventRefs,
      }, meta),
    ]
  }, context)
}

function upsertAssistantStream(
  bundle: MockSessionBundle,
  text: string,
  payload: Record<string, unknown>,
  meta: EventRenderMeta,
  context: SessionRunTranscriptContext,
): void {
  const content = stripAnsi(text)
  if (!content) return
  const rawEventRefs = rawEventRefsFromPayload(payload)
  updateAssistantItems(bundle, (parts) => {
    const last = parts[parts.length - 1]
    if (last?.type === "assistant_text" && last.streamKey === ASSISTANT_STREAM_KEY) {
      const next = [...parts]
      const current = last
      next[next.length - 1] = withEventMeta({
        ...current,
        markdown: `${current.markdown || ""}${content}`,
        format: "markdown",
        streaming: true,
        streamKey: ASSISTANT_STREAM_KEY,
        rawEventRefs: mergeRawEventRefs(current.rawEventRefs, rawEventRefs),
      }, meta)
      return next
    }
    const nextParts = closeTrailingInlineStream(parts)
    return [
      ...nextParts,
      withEventMeta({
        id: stablePartId("assistant-stream", meta, context.now ?? Date.now(), nextParts.length),
        type: "assistant_text",
        markdown: content,
        format: "markdown",
        streaming: true,
        streamKey: ASSISTANT_STREAM_KEY,
        rawEventRefs,
      }, meta),
    ]
  }, context)
}

function finalizeAssistant(
  bundle: MockSessionBundle,
  text: string,
  payload: Record<string, unknown>,
  meta: EventRenderMeta,
  context: SessionRunTranscriptContext,
): void {
  const content = stripAnsi(text).trim()
  if (!content) return
  const rawEventRefs = rawEventRefsFromPayload(payload)
  updateAssistantItems(bundle, (parts) => {
    const last = parts[parts.length - 1]
    if (last?.type === "assistant_text" && last.streamKey === ASSISTANT_STREAM_KEY) {
      const next = [...parts]
      next[next.length - 1] = withEventMeta({
        ...last,
        markdown: content,
        format: "markdown",
        streaming: false,
        streamKey: ASSISTANT_MESSAGE_KEY,
        rawEventRefs: mergeRawEventRefs(last.rawEventRefs, rawEventRefs),
      }, meta)
      return next
    }
    const nextParts = closeTrailingInlineStream(parts)
    return [
      ...nextParts,
      withEventMeta({
        id: stablePartId("assistant-message", meta, context.now ?? Date.now(), nextParts.length),
        type: "assistant_text",
        markdown: content,
        format: "markdown",
        streaming: false,
        streamKey: ASSISTANT_MESSAGE_KEY,
        rawEventRefs,
      }, meta),
    ]
  }, context)
}

function upsertReasoningThinking(
  bundle: MockSessionBundle,
  text: string,
  payload: Record<string, unknown>,
  meta: EventRenderMeta,
  context: SessionRunTranscriptContext,
  labels: SessionRunTranscriptLabels,
): void {
  const content = stripAnsi(text)
  if (!content) return
  const rawEventRefs = rawEventRefsFromPayload(payload)
  updateAssistantItems(bundle, (parts) => {
    const updateThinkingItem = (part: ThinkingItem): ThinkingItem => withEventMeta({
      ...part,
      title: labels.thinking,
      detail: undefined,
      active: true,
      raw: `${part.raw || ""}${content}`,
      streamKey: REASONING_STREAM_KEY,
      rawEventRefs: mergeRawEventRefs(part.rawEventRefs, rawEventRefs),
    }, meta)
    const thinkingIndex = findLastItemIndex(parts, isReasoningThinkingItem)
    if (thinkingIndex >= 0) {
      const next = [...parts]
      next[thinkingIndex] = updateThinkingItem(parts[thinkingIndex] as ThinkingItem)
      return next
    }
    const nextParts = closeTrailingInlineStream(parts)
    return [
      ...nextParts,
      withEventMeta({
        id: stablePartId("thinking", meta, context.now ?? Date.now(), nextParts.length),
        type: "thinking",
        title: labels.thinking,
        active: true,
        raw: content,
        streamKey: REASONING_STREAM_KEY,
        rawEventRefs,
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
  const rawEventRefs = rawEventRefsFromPayload(payload)
  updateAssistantItems(bundle, (parts) => {
    const createReasoning = (id: string, existingRefs?: RawEventRef[]): ReasoningItem => withEventMeta({
      id,
      type: "reasoning",
      summary: summary || undefined,
      raw: raw || summary,
      format: stringValue(payload.format) === "plain" ? "plain" : "markdown",
      rawEventRefs: mergeRawEventRefs(existingRefs, rawEventRefs),
    }, meta)
    const thinkingIndex = findLastItemIndex(parts, isReasoningThinkingItem)
    if (thinkingIndex >= 0) {
      const next = [...parts]
      next[thinkingIndex] = createReasoning(parts[thinkingIndex].id, parts[thinkingIndex].rawEventRefs)
      return next
    }
    const reasoningIndex = findLastItemIndex(parts, (part) => part.type === "reasoning")
    if (reasoningIndex >= 0) {
      const next = [...parts]
      next[reasoningIndex] = createReasoning(parts[reasoningIndex].id, parts[reasoningIndex].rawEventRefs)
      return next
    }
    const nextParts = closeTrailingInlineStream(parts)
    return [
      ...nextParts,
      createReasoning(stablePartId("reasoning-message", meta, context.now ?? Date.now(), nextParts.length)),
    ]
  }, context)
}

function appendTerminal(
  bundle: MockSessionBundle,
  content: string,
  title: string,
  payload: Record<string, unknown>,
  meta: EventRenderMeta,
  context: SessionRunTranscriptContext,
): void {
  const clean = stripAnsi(content).trim()
  if (!clean || isRunPeerReadyTui(clean)) return
  updateAssistantItems(bundle, (parts) => {
    const nextParts = closeTrailingInlineStream(parts)
    return [
      ...nextParts,
      withEventMeta({
        id: stablePartId("terminal", meta, context.now ?? Date.now(), nextParts.length),
        type: "terminal",
        title,
        content: clean,
        rawEventRefs: rawEventRefsFromPayload(payload),
      }, meta),
    ]
  }, context)
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
  updateAssistantItems(bundle, (parts) => {
    const nextParts = closeTrailingInlineStream(parts)
    return [
      ...nextParts,
      withEventMeta({
        id: stablePartId("view", meta, now, nextParts.length),
        type: "view",
        title: String(payload.title || payload.message || labels.structuredView),
        viewType: String(payload.view_type || payload.kind || "view"),
        level: String(payload.level || "info"),
        payload: viewPayload,
        rawEventRefs: rawEventRefsFromPayload(payload),
      }, meta),
    ]
  }, context)
}

function appendContextEvent(
  bundle: MockSessionBundle,
  payload: Record<string, unknown>,
  meta: EventRenderMeta,
  context: SessionRunTranscriptContext,
  labels: SessionRunTranscriptLabels,
  now: number,
): void {
  updateAssistantItems(bundle, (parts) => {
    const nextParts = closeTrailingInlineStream(parts)
    return [
      ...nextParts,
      withEventMeta({
        id: stablePartId("context", meta, now, nextParts.length),
        type: "context_event",
        title: String(payload.message || payload.phase || labels.contextEvent),
        payload,
        rawEventRefs: rawEventRefsFromPayload(payload),
      }, meta),
    ]
  }, context)
}

function appendLifecycleHookEvent(
  bundle: MockSessionBundle,
  payload: Record<string, unknown>,
  meta: EventRenderMeta,
  context: SessionRunTranscriptContext,
  labels: SessionRunTranscriptLabels,
  now: number,
): void {
  const title =
    stringValue(payload.title) ||
    stringValue(payload.message) ||
    stringValue(payload.display_name) ||
    stringValue(payload.event_name) ||
    stringValue(payload.event_type) ||
    stringValue(payload.hook_id) ||
    labels.contextEvent
  updateAssistantItems(bundle, (parts) => {
    const nextParts = closeTrailingInlineStream(parts)
    return [
      ...nextParts,
      withEventMeta({
        id: stablePartId("lifecycle-hook", meta, now, nextParts.length),
        type: "context_event",
        title,
        payload,
        rawEventRefs: rawEventRefsFromPayload(payload),
      }, meta),
    ]
  }, context)
}

function appendWorkflowStep(
  bundle: MockSessionBundle,
  payload: Record<string, unknown>,
  meta: EventRenderMeta,
  context: SessionRunTranscriptContext,
  now: number,
): void {
  updateAssistantItems(bundle, (parts) => {
    const nextParts = closeTrailingInlineStream(parts)
    return [
      ...nextParts,
      withEventMeta({
        id: stablePartId("workflow-step", meta, now, nextParts.length),
        type: "workflow_step",
        lane: "process",
        workflow: stringValue(payload.workflow) || "workflow",
        stage: stringValue(payload.stage) || stringValue(payload.phase) || "step",
        status: workflowItemStatus(payload.status, "running"),
        title: stringValue(payload.title) || stringValue(payload.message),
        summary: stringValue(payload.summary),
        details: objectValue(payload.details),
        payload,
        rawEventRefs: rawEventRefsFromPayload(payload),
      }, meta),
    ]
  }, context)
}

function appendWorkflowArtifact(
  bundle: MockSessionBundle,
  payload: Record<string, unknown>,
  meta: EventRenderMeta,
  context: SessionRunTranscriptContext,
  now: number,
): void {
  updateAssistantItems(bundle, (parts) => {
    const nextParts = closeTrailingInlineStream(parts)
    return [
      ...nextParts,
      withEventMeta({
        id: stablePartId("workflow-artifact", meta, now, nextParts.length),
        type: "workflow_artifact",
        lane: "primary",
        workflow: stringValue(payload.workflow) || "workflow",
        artifactType: stringValue(payload.artifact_type) || stringValue(payload.artifactType) || "artifact",
        title: stringValue(payload.title) || stringValue(payload.message),
        summary: stringValue(payload.summary),
        artifact: objectValue(payload.artifact),
        payload,
        rawEventRefs: rawEventRefsFromPayload(payload),
      }, meta),
    ]
  }, context)
}

function appendWorkflowDecision(
  bundle: MockSessionBundle,
  payload: Record<string, unknown>,
  meta: EventRenderMeta,
  context: SessionRunTranscriptContext,
  now: number,
): void {
  const decision = context.approvalDecision
  updateAssistantItems(bundle, (parts) => {
    const nextParts = closeTrailingInlineStream(parts)
    return [
      ...nextParts,
      withEventMeta({
        id: stablePartId("workflow-decision", meta, now, nextParts.length),
        type: "workflow_decision",
        lane: "primary",
        workflow: stringValue(payload.workflow) || "workflow",
        decisionType: stringValue(payload.decision_type) || stringValue(payload.decisionType) || "decision",
        status: decision === "allow" ? "approved" : decision === "deny" ? "denied" : workflowDecisionStatus(payload.status),
        title: stringValue(payload.title) || stringValue(payload.intent) || stringValue(payload.message),
        summary: stringValue(payload.summary) || stringValue(payload.content),
        review: objectValue(payload.review),
        actions: workflowDecisionActions(payload.actions),
        approvalId: stringValue(payload.approval_id),
        toolCallId: stringValue(payload.tool_call_id),
        decision: decision === "allow" ? "auto_approved" : decision === "deny" ? "auto_denied" : undefined,
        resultReason: context.approvalReason,
        payload,
        rawEventRefs: rawEventRefsFromPayload(payload),
      }, meta),
    ]
  }, context)
}

function appendWorkflowResult(
  bundle: MockSessionBundle,
  payload: Record<string, unknown>,
  meta: EventRenderMeta,
  context: SessionRunTranscriptContext,
  now: number,
): void {
  updateAssistantItems(bundle, (parts) => {
    const nextParts = closeTrailingInlineStream(parts)
    return [
      ...nextParts,
      withEventMeta({
        id: stablePartId("workflow-result", meta, now, nextParts.length),
        type: "workflow_result",
        lane: "primary",
        workflow: stringValue(payload.workflow) || "workflow",
        resultType: stringValue(payload.result_type) || stringValue(payload.resultType),
        status: workflowItemStatus(payload.status, "done"),
        title: stringValue(payload.title) || stringValue(payload.message),
        summary: stringValue(payload.summary),
        result: objectValue(payload.result),
        payload,
        rawEventRefs: rawEventRefsFromPayload(payload),
      }, meta),
    ]
  }, context)
}

function appendMemoryContext(
  bundle: MockSessionBundle,
  payload: Record<string, unknown>,
  meta: EventRenderMeta,
  context: SessionRunTranscriptContext,
  labels: SessionRunTranscriptLabels,
  now: number,
): void {
  updateAssistantItems(bundle, (parts) => {
    const nextParts = closeTrailingInlineStream(parts)
    return [
      ...nextParts,
      withEventMeta({
        id: stablePartId("memory", meta, now, nextParts.length),
        type: "memory_context",
        title: String(payload.title || labels.memoryContext),
        payload,
        rawEventRefs: rawEventRefsFromPayload(payload),
      }, meta),
    ]
  }, context)
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
  updateAssistantItems(bundle, (parts) => {
    const nextParts = closeTrailingInlineStream(parts)
    return [
      ...nextParts,
      withEventMeta({
        id: stablePartId(eventType, meta, now, nextParts.length),
        type: "ui_event",
        kind: String(payload.kind || eventType.replace("_event", "")),
        level: String(payload.level || "info"),
        title: String(payload.title || payload.message || uiEventTitle(eventType, labels)),
        payload,
        rawEventRefs: rawEventRefsFromPayload(payload),
      }, meta),
    ]
  }, context)
}

function upsertFileChange(
  bundle: MockSessionBundle,
  eventType: string,
  payload: Record<string, unknown>,
  meta: EventRenderMeta,
  context: SessionRunTranscriptContext,
): void {
  const itemId = stringValue(payload.item_id) ||
    stringValue(payload.itemId) ||
    `file-change-${meta.sessionEventSeq ?? context.now ?? Date.now()}`
  updateAssistantItems(bundle, (parts) => {
    const existingIndex = parts.findIndex((part) =>
      part.type === "file_change" && part.itemId === itemId
    )
    const existing = existingIndex >= 0 ? parts[existingIndex] as FileChangeItem : undefined
    const changes = normalizeFileChangeEntries(payload.changes, existing?.changes)
    const combinedDiff = stringValue(payload.diff) || combinedFileChangeDiff(changes) || existing?.diff
    const stats = fileChangeDiffStats(combinedDiff)
    const patch: Partial<FileChangeItem> = {
      itemId,
      toolCallId: stringValue(payload.tool_call_id) || stringValue(payload.toolCallId) || existing?.toolCallId,
      status: fileChangeStatus(payload, eventType, existing?.status),
      changes,
      diff: combinedDiff,
      path: primaryFileChangePath(changes) || stringValue(payload.path) || stringValue(payload.target_path) || existing?.path,
      addedLines: numberValue(payload.added_lines) ?? numberValue(payload.addedLines) ?? stats.added,
      removedLines: numberValue(payload.removed_lines) ?? numberValue(payload.removedLines) ?? stats.removed,
      patchPreview: eventType === "file_change_patch_updated"
        ? stringValue(payload.patch_preview) || stringValue(payload.patchPreview) || existing?.patchPreview
        : existing?.patchPreview,
      approvalId: stringValue(payload.approval_id) || stringValue(payload.approvalId) || existing?.approvalId,
      approvalReason: eventType === "file_change_approval_requested"
        ? stringValue(payload.reason) || existing?.approvalReason
        : existing?.approvalReason,
      approvalDecision: eventType === "file_change_approval_resolved"
        ? stringValue(payload.decision) || existing?.approvalDecision
        : existing?.approvalDecision,
      approvalResultReason: eventType === "file_change_approval_resolved"
        ? stringValue(payload.reason) || existing?.approvalResultReason
        : existing?.approvalResultReason,
      durationMs: numberValue(payload.duration_ms) ?? numberValue(payload.durationMs) ?? existing?.durationMs,
      error: stringValue(payload.error) || existing?.error,
      rawEventRefs: rawEventRefsFromPayload(payload),
    }
    const nextPart: FileChangeItem = withEventMeta({
      id: existing?.id || itemId,
      type: "file_change",
      itemId,
      status: "in_progress",
      changes: [],
      ...defined(patch),
      rawEventRefs: mergeRawEventRefs(existing?.rawEventRefs, patch.rawEventRefs),
    }, meta)
    if (existingIndex >= 0) {
      const next = [...parts]
      next[existingIndex] = nextPart
      return next
    }
    return [...closeTrailingInlineStream(parts), nextPart]
  }, context)
}

function normalizeFileChangeEntries(
  value: unknown,
  fallback: FileChangeEntry[] = [],
): FileChangeEntry[] {
  if (!Array.isArray(value)) return fallback
  return value
    .map((item) => objectValue(item))
    .filter((item) => Object.keys(item).length > 0) as FileChangeEntry[]
}

function fileChangeStatus(
  payload: Record<string, unknown>,
  eventType: string,
  fallback?: FileChangeStatus,
): FileChangeStatus {
  const status = stringValue(payload.status)
  if (
    status === "in_progress" ||
    status === "completed" ||
    status === "failed" ||
    status === "declined" ||
    status === "cancelled"
  ) {
    return status
  }
  if (eventType === "file_change_approval_resolved") {
    return stringValue(payload.decision) === "allow_once" ? "in_progress" : "declined"
  }
  if (eventType === "file_change_completed") return "completed"
  return fallback || "in_progress"
}

function primaryFileChangePath(changes: FileChangeEntry[]): string {
  for (const change of changes) {
    const path = change.move_path || change.movePath || change.path
    if (typeof path === "string" && path.trim()) return path.trim()
  }
  return ""
}

function combinedFileChangeDiff(changes: FileChangeEntry[]): string {
  return changes
    .map((change) => typeof change.diff === "string" ? change.diff : "")
    .filter(Boolean)
    .join("\n")
    .trim()
}

function fileChangeDiffStats(diff: string | undefined): { added: number; removed: number } {
  let added = 0
  let removed = 0
  for (const line of (diff || "").split(/\r?\n/)) {
    if (line.startsWith("+++") || line.startsWith("---")) continue
    if (line.startsWith("+")) added += 1
    else if (line.startsWith("-")) removed += 1
  }
  return { added, removed }
}

function upsertDocumentDraft(
  bundle: MockSessionBundle,
  eventType: string,
  payload: Record<string, unknown>,
  meta: EventRenderMeta,
  context: SessionRunTranscriptContext,
): void {
  const draftId = stringValue(payload.draft_id) ||
    stringValue(payload.draftId) ||
    `draft-${meta.sessionEventSeq ?? context.now ?? Date.now()}`
  updateAssistantItems(bundle, (parts) => {
    const existingIndex = parts.findIndex((part) =>
      part.type === "document_draft" && part.draftId === draftId
    )
    const existing = existingIndex >= 0 ? parts[existingIndex] as DocumentDraftItem : undefined
    const patch: Partial<DocumentDraftItem> = {
      draftId,
      targetPath: stringValue(payload.target_path) || stringValue(payload.targetPath) || existing?.targetPath,
      title: stringValue(payload.title) || existing?.title,
      format: stringValue(payload.format) || existing?.format,
      status: documentDraftStatus(payload, eventType, existing?.status),
      itemId: stringValue(payload.item_id) || stringValue(payload.itemId) || existing?.itemId,
      approvalId: stringValue(payload.approval_id) || stringValue(payload.approvalId) || existing?.approvalId,
      contentLength: documentDraftContentLength(payload, existing?.contentLength),
      contentSha256: stringValue(payload.content_sha256) || stringValue(payload.contentSha256) || existing?.contentSha256,
      lastChunkSeq: numberValue(payload.last_chunk_seq) ?? numberValue(payload.lastChunkSeq) ?? existing?.lastChunkSeq,
      snapshotKind: stringValue(payload.snapshot_kind) || stringValue(payload.snapshotKind) || existing?.snapshotKind,
      snapshotFinal: Object.prototype.hasOwnProperty.call(payload, "final")
        ? Boolean(payload.final)
        : existing?.snapshotFinal,
      error: stringValue(payload.error) || existing?.error,
      reason: stringValue(payload.reason) || existing?.reason,
      rawEventRefs: rawEventRefsFromPayload(payload),
    }
    const nextPart: DocumentDraftItem = withEventMeta({
      id: existing?.id || draftId,
      type: "document_draft",
      draftId,
      status: "streaming",
      ...defined(patch),
      rawEventRefs: mergeRawEventRefs(existing?.rawEventRefs, patch.rawEventRefs),
    }, meta)
    if (existingIndex >= 0) {
      const next = [...parts]
      next[existingIndex] = nextPart
      return next
    }
    return [...closeTrailingInlineStream(parts), nextPart]
  }, context)
}

function documentDraftStatus(
  payload: Record<string, unknown>,
  eventType: string,
  fallback?: DocumentDraftItem["status"],
): DocumentDraftItem["status"] {
  const status = stringValue(payload.status)
  if (
    status === "declared" ||
    status === "streaming" ||
    status === "committing" ||
    status === "committed" ||
    status === "cancelled" ||
    status === "failed"
  ) {
    return status
  }
  const mapped: Record<string, DocumentDraftItem["status"]> = {
    document_draft_started: "streaming",
    document_draft_progress: "streaming",
    document_draft_snapshot: "streaming",
    document_draft_commit_requested: "committing",
    document_draft_committed: "committed",
    document_draft_failed: "failed",
    document_draft_cancelled: "cancelled",
  }
  return mapped[eventType] || fallback || "streaming"
}

function documentDraftContentLength(
  payload: Record<string, unknown>,
  fallback?: number,
): number | undefined {
  const explicit = numberValue(payload.content_length) ?? numberValue(payload.contentLength)
  if (explicit !== undefined) return explicit
  return fallback
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
    const targetParts = existingIndex >= 0 ? parts : closeTrailingInlineStream(parts)
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
      rawEventRefs: rawEventRefsFromPayload(payload),
    }
    return upsertToolPartInParts(targetParts, toolName, patch, { fallbackId: toolCallId }).map((part) => (
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
      rawEventRefs: rawEventRefsFromPayload(payload),
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
      rawEventRefs: rawEventRefsFromPayload(payload),
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
      rawEventRefs: rawEventRefsFromPayload(payload),
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
  const resultMeta = objectValue(payload.meta)
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
    const permissionStatus = statusAfterPermissionResult(resultMeta.permission)
    const patch: Partial<ToolActivityItem> = {
      status: permissionStatus || statusAfterToolReturn(existing?.status),
      toolCallId,
      source: resolvedToolSource,
      endedAt: numberValue(payload.ended_at),
      output: reconciledShellOutput,
      outputFormat: inferToolOutputFormat(toolName, resolvedToolSource, outputFormat),
      outputChunks: shellChunks,
      finalOutput: isShell ? finalOutput : undefined,
      resultMeta,
      rawEventRefs: rawEventRefsFromPayload(payload),
    }
    return upsertToolPartWithPreparing(parts, toolName, patch, toolCallId, { matchReturn: true, meta })
  }, context)
}

function statusAfterPermissionResult(value: unknown): ToolActivityItem["status"] | undefined {
  const permission = objectValue(value)
  const action = (stringValue(permission.action) || "").toLowerCase()
  const authorized = permission.authorized
  if (
    authorized === false ||
    action === "deny" ||
    action === "denied" ||
    action === "defer" ||
    action === "blocked" ||
    action === "blocked_review"
  ) {
    return "denied"
  }
  return undefined
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
      resultMeta: approvalRequestResultMeta(payload),
      rawEventRefs: rawEventRefsFromPayload(payload),
    }, toolCallId, { meta }),
  context)
}

function approvalRequestResultMeta(payload: Record<string, unknown>): Record<string, unknown> | undefined {
  const resultMeta = objectValue(payload.meta)
  const permission = objectValue(payload.permission)
  if (Object.keys(permission).length > 0) {
    resultMeta.permission = permission
  }
  const lifecycleEvent = stringValue(payload.lifecycle_event)
  if (lifecycleEvent) {
    resultMeta.lifecycle_event = lifecycleEvent
  }
  const lifecycleHooks = approvalLifecycleHooks(payload.lifecycle_hooks)
  if (lifecycleHooks.length > 0) {
    resultMeta.lifecycle_hooks = lifecycleHooks
  }
  return Object.keys(resultMeta).length > 0 ? resultMeta : undefined
}

const APPROVAL_LIFECYCLE_HOOK_FIELDS = [
  "hook_id",
  "display_name",
  "source",
  "handler_type",
  "decision",
  "reason",
]

function approvalLifecycleHooks(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => objectValue(item))
    .map((item) => Object.fromEntries(
      APPROVAL_LIFECYCLE_HOOK_FIELDS
        .filter((field) => item[field] !== undefined && item[field] !== null)
        .map((field) => [field, item[field]]),
    ))
    .filter((item) => Object.keys(item).length > 0)
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
      if (part.type === "tool") {
        if (toolCallId && part.toolCallId !== toolCallId) return part
        if (!toolCallId && part.approvalId !== approvalId) return part
        return withEventMeta({
          ...part,
          approvalDecision: approvalDecisionAfterResolution(part.approvalDecision, decision),
          approvalResultReason: reason || part.approvalResultReason,
          status: approvalStatusAfterResolution(decision, part.status),
          rawEventRefs: mergeRawEventRefs(part.rawEventRefs, rawEventRefsFromPayload(payload)),
        }, meta)
      }
      if (part.type === "workflow_decision") {
        if (toolCallId && part.toolCallId !== toolCallId) return part
        if (!toolCallId && part.approvalId !== approvalId) return part
        const nextStatus = decision === "allow_once"
          ? "approved"
          : decision === "deny_once"
            ? "denied"
            : part.status
        return withEventMeta({
          ...part,
          status: nextStatus,
          decision: approvalDecisionAfterResolution(part.decision, decision),
          resultReason: reason || part.resultReason,
          rawEventRefs: mergeRawEventRefs(part.rawEventRefs, rawEventRefsFromPayload(payload)),
        }, meta)
      }
      return part
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
        rawEventRefs: mergeRawEventRefs(current.rawEventRefs, definedPatch.rawEventRefs),
        id: current.id,
        type: "tool",
        tool: toolName,
        toolCallId: toolCallId || current.toolCallId,
        preparingIndex,
      } as ToolActivityItem, options.meta)
      return next
    }
  }
  const targetParts = existingIndex >= 0 ? parts : closeTrailingInlineStream(parts)
  return upsertToolPartInParts(targetParts, toolName, patch, {
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
  if (item.type === "assistant_text" && item.streamKey === ASSISTANT_STREAM_KEY) {
    return {
      ...item,
      streaming: false,
      streamKey: ASSISTANT_MESSAGE_KEY,
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
  if (item.type === "tool" && ["running", "pending", "preparing", "awaiting_approval", "approved"].includes(item.status || "")) {
    return {
      ...item,
      status: traceNodeStatus === "error" ? "error" : "cancelled",
      traceNodeStatus,
    }
  }
  if (item.type === "workflow_step" && item.status === "running") {
    return {
      ...item,
      status: traceNodeStatus === "error" ? "error" : "done",
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
        if (part.type === "tool") {
          if (part.status !== "awaiting_approval" || !part.approvalId || part.approvalDecision) return part
          return withEventMeta({
            ...part,
            status,
            approvalDecision: "deny_once",
            approvalResultReason: reason,
          }, meta)
        }
        if (part.type === "workflow_decision") {
          if (part.status !== "pending" || !part.approvalId || part.decision) return part
          return withEventMeta({
            ...part,
            status: "denied",
            decision: "deny_once",
            resultReason: reason,
          }, meta)
        }
        return part
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

function sessionEventMessage(
  payload: Record<string, unknown>,
  labels: SessionRunTranscriptLabels,
  defaultKey: string,
  defaultMessage: string,
): string {
  const explicit = stringValue(payload.message)
  if (explicit) return explicit
  const key = stringValue(payload.message_key) || defaultKey
  if (key === "provider_stream_interrupted.recovering") return labels.providerStreamInterrupted
  if (key === "provider_stream.interrupted_can_continue") return labels.streamInterruptedCanContinue
  if (key === "capability_package.session_failed") return labels.capabilityPackageSessionFailed
  return defaultMessage
}

function isRunPeerReadyTui(content: string): boolean {
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

function noticeLevelValue(value: unknown): NoticeLevel {
  const level = typeof value === "string" ? value.trim().toLowerCase() : ""
  return level === "warning" || level === "error" ? level : "info"
}

function workflowItemStatus(value: unknown, fallback: WorkflowItemStatus): WorkflowItemStatus {
  const status = typeof value === "string" ? value.trim().toLowerCase() : ""
  if (status === "running" || status === "done" || status === "warning" || status === "error" || status === "cancelled") {
    return status
  }
  if (status === "completed" || status === "success" || status === "approved") return "done"
  if (status === "failed" || status === "blocked" || status === "denied") return "error"
  return fallback
}

function workflowDecisionStatus(value: unknown): "pending" | "approved" | "denied" | WorkflowItemStatus {
  const status = typeof value === "string" ? value.trim().toLowerCase() : ""
  if (status === "pending" || status === "approved" || status === "denied") return status
  return workflowItemStatus(value, "running") === "running" ? "pending" : workflowItemStatus(value, "running")
}

function workflowDecisionActions(value: unknown): WorkflowDecisionAction[] | undefined {
  if (!Array.isArray(value)) return undefined
  const actions: WorkflowDecisionAction[] = []
  for (const raw of value) {
    const item = objectValue(raw)
    const id = stringValue(item.id) || stringValue(item.decision)
    const label = stringValue(item.label) || stringValue(item.title)
    if (!id || !label) continue
    const tone = workflowDecisionActionTone(item.tone)
    actions.push(tone ? { id, label, tone } : { id, label })
  }
  return actions.length ? actions : undefined
}

function workflowDecisionActionTone(value: unknown): WorkflowDecisionAction["tone"] {
  const tone = typeof value === "string" ? value.trim().toLowerCase() : ""
  if (tone === "primary" || tone === "danger" || tone === "secondary") return tone
  return undefined
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

function rawEventRefsFromPayload(payload: Record<string, unknown>): RawEventRef[] | undefined {
  const refs = payload.raw_event_refs ?? payload.rawEventRefs
  if (!Array.isArray(refs)) return undefined
  const normalized = refs
    .map((item) => objectValue(item))
    .filter((item) => Object.keys(item).length > 0) as RawEventRef[]
  return normalized.length ? normalized : undefined
}

function mergeRawEventRefs(
  current: RawEventRef[] | undefined,
  incoming: RawEventRef[] | undefined,
): RawEventRef[] | undefined {
  if (!current?.length && !incoming?.length) return undefined
  const merged: RawEventRef[] = []
  const seen = new Set<string>()
  for (const ref of [...(current || []), ...(incoming || [])]) {
    const key = [
      String(ref.agent_run_id || ""),
      String(ref.seq ?? ""),
      String(ref.type || ""),
      String(ref.id || ""),
    ].join(":")
    if (seen.has(key)) continue
    seen.add(key)
    merged.push(ref)
  }
  return merged.length ? merged : undefined
}

function defined<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined)
  ) as Partial<T>
}
