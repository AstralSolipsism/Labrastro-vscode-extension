import { t } from "../../i18n"
import { isLifecycleHookPayload, lifecycleDisplayTitle } from "../../chat/lifecycle-display"
import type { MockMessage } from "./mock-data"
import type { AssistantTextItem, FileChangeItem, LocalActionItem, NoticeItem, ToolActivityItem, TranscriptItem } from "./transcript-model"

export type ProcessGroupKind =
  | "explore"
  | "modify"
  | "run"
  | "mcp"
  | "skill"
  | "local_action"
  | "context"
  | "other"

export type ProcessState = "running" | "completed" | "error"

export interface ReasoningPanel {
  id: string
  state: ProcessState
  raw: string
  summary?: string
  count: number
}

export interface ProcessGroup {
  id: string
  groupKey: string
  kind: ProcessGroupKind
  label: string
  state: ProcessState
  count: number
  failureCount: number
  currentLabel?: string
  workflow?: string
  isWorkflow?: boolean
  items: TranscriptItem[]
}

export type ProcessTimelineItem =
  | { type: "timeline_text"; part: AssistantTextItem }
  | { type: "timeline_process_group"; group: ProcessGroup }
  | { type: "timeline_notice"; part: NoticeItem }
  | { type: "timeline_part"; part: TranscriptItem }

export interface ProcessSummary {
  id: string
  state: ProcessState
  count: number
  failureCount: number
  currentLabel?: string
  workflow?: string
  isWorkflow?: boolean
  items: ProcessTimelineItem[]
}

export type TranscriptPresentationItem =
  | ProcessTimelineItem
  | { type: "process_summary"; summary: ProcessSummary }
  | { type: "reasoning_panel"; panel: ReasoningPanel }
  | { type: "final_answer"; parts: AssistantTextItem[] }
  | { type: "primary_part"; part: TranscriptItem }

export interface TranscriptPresentationOptions {
  runningProcessLabel?: string
}

export function processTimelineItemKey(item: ProcessTimelineItem, index = 0): string {
  if (item.type === "timeline_process_group") return item.group.id
  if (item.type === "timeline_text") return `timeline_text:${item.part.id}`
  if (item.type === "timeline_notice") return `timeline_notice:${item.part.id}`
  if (item.type === "timeline_part") return `timeline_part:${item.part.id}`
  return `timeline:${index}`
}

export function transcriptPresentationItemKey(item: TranscriptPresentationItem, index = 0): string {
  if (
    item.type === "timeline_process_group" ||
    item.type === "timeline_text" ||
    item.type === "timeline_notice" ||
    item.type === "timeline_part"
  ) {
    return processTimelineItemKey(item, index)
  }
  if (item.type === "process_summary") return item.summary.id
  if (item.type === "reasoning_panel") return item.panel.id
  if (item.type === "final_answer") return `final_answer:${item.parts[0]?.id || index}`
  if (item.type === "primary_part") return `primary_part:${item.part.id}`
  return `presentation:${index}`
}

export const EXPLORE_TOOLS = new Set([
  "read_file",
  "read_files",
  "list_file",
  "list_files",
  "list_directory",
  "search_file",
  "search_files",
  "grep",
  "glob",
])

export const MODIFY_TOOLS = new Set([
  "apply_patch",
])

export const RUN_TOOLS = new Set([
  "shell",
  "execute_command",
  "run_terminal_cmd",
])

let transcriptPresentationBuildCount = 0

function isTranscriptPresentationDiagnosticsEnabled(): boolean {
  return typeof globalThis !== "undefined" &&
    Boolean((globalThis as { __LABRASTRO_CHAT_STREAM_DEBUG__?: boolean }).__LABRASTRO_CHAT_STREAM_DEBUG__)
}

function nowMs(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now()
}

// Presentation contract:
// TranscriptItem[] is canonical event storage, while this function owns the
// user-facing projection. Reasoning is always collected into one
// reasoning_panel. Before final output starts it is shown after the process
// timeline; after final output starts the order is process_summary,
// reasoning_panel, then final_answer.
export function buildTranscriptPresentation(
  parts: TranscriptItem[],
  message?: Pick<MockMessage, "id" | "traceNodeStatus">,
  options: TranscriptPresentationOptions = {},
): TranscriptPresentationItem[] {
  const diagnosticsEnabled = isTranscriptPresentationDiagnosticsEnabled()
  const startedAt = diagnosticsEnabled ? nowMs() : 0
  const finish = (output: TranscriptPresentationItem[]): TranscriptPresentationItem[] => {
    if (diagnosticsEnabled) {
      transcriptPresentationBuildCount += 1
      console.debug("[Labrastro] transcript-presentation.build", {
        count: transcriptPresentationBuildCount,
        messageId: message?.id,
        partCount: parts.length,
        itemCount: output.length,
        durationMs: Math.round((nowMs() - startedAt) * 10) / 10,
      })
    }
    return output
  }
  const reasoningPanel = buildReasoningPanel(parts, message)
  const explicitPrimaryParts = parts.filter(isPrimaryLanePart)

  if (explicitPrimaryParts.length) {
    const workflowTerminals = workflowTerminalStates(parts)
    const timeline = buildTimelineItems(
      parts.filter((part) => !isPrimaryLanePart(part) && part.type !== "assistant_text"),
      message,
      options,
      workflowTerminals,
    )
    const summary = buildProcessSummary(timeline, message, options, workflowTerminals)
    const output: TranscriptPresentationItem[] = []
    if (summary) output.push({ type: "process_summary", summary })
    if (reasoningPanel) output.push({ type: "reasoning_panel", panel: reasoningPanel })
    output.push(...explicitPrimaryParts.map((part) => ({ type: "primary_part" as const, part })))
    return finish(output)
  }

  const finalAnswerStart = resolveFinalAnswerStartIndex(parts, message)

  if (finalAnswerStart >= 0) {
    const workflowTerminals = workflowTerminalStates(parts)
    const timeline = buildTimelineItems(parts.slice(0, finalAnswerStart), message, options, workflowTerminals)
    const finalParts = parts
      .slice(finalAnswerStart)
      .filter((part): part is AssistantTextItem => part.type === "assistant_text")
    const lateNotices = parts
      .slice(finalAnswerStart)
      .filter((part): part is NoticeItem => part.type === "notice")
    const summary = buildProcessSummary(timeline, message, options, workflowTerminals)
    const prefixNotices = summary
      ? []
      : timeline.filter((item): item is Extract<ProcessTimelineItem, { type: "timeline_notice" }> =>
          item.type === "timeline_notice"
        )
    const output: TranscriptPresentationItem[] = []
    if (summary) output.push({ type: "process_summary", summary })
    if (reasoningPanel) output.push({ type: "reasoning_panel", panel: reasoningPanel })
    output.push(...prefixNotices)
    output.push(...lateNotices.map((part) => ({ type: "timeline_notice" as const, part })))
    if (finalParts.length) output.push({ type: "final_answer", parts: finalParts })
    return finish(output)
  }

  const output: TranscriptPresentationItem[] = [...buildTimelineItems(parts, message, options)]
  if (reasoningPanel) output.push({ type: "reasoning_panel", panel: reasoningPanel })
  return finish(output)
}

function buildReasoningPanel(
  parts: TranscriptItem[],
  message?: Pick<MockMessage, "id" | "traceNodeStatus">,
): ReasoningPanel | undefined {
  const items = parts.filter((item) => item.type === "thinking" || item.type === "reasoning")
  if (!items.length) return undefined
  const first = items[0]
  let raw = ""
  let summary = ""
  let state: ProcessState = "completed"

  for (const item of items) {
    const nextRaw = item.type === "thinking"
      ? item.raw || item.detail || ""
      : item.raw || item.summary || ""
    raw = appendReasoningText(raw, nextRaw)
    if (item.type === "reasoning" && item.summary && !summary) summary = item.summary
    state = mergeProcessState(state, processItemsState([item]))
  }

  if (state !== "error" && isMessageRunning(parts, message) && items.some((item) => item.type === "thinking" && item.active === true)) {
    state = "running"
  }

  return {
    id: `reasoning:${message?.id || "message"}:${first.id}`,
    state,
    raw,
    summary: summary || undefined,
    count: items.length,
  }
}

function buildTimelineItems(
  parts: TranscriptItem[],
  message?: Pick<MockMessage, "id" | "traceNodeStatus">,
  options: TranscriptPresentationOptions = {},
  workflowTerminals = workflowTerminalStates(parts),
): ProcessTimelineItem[] {
  const items: ProcessTimelineItem[] = []
  let currentProcess: { key: string; info: ProcessGroupInfo; items: TranscriptItem[] } | undefined
  const hiddenCapabilityGatewayIds = new Set(
    parts
      .filter((part): part is ToolActivityItem => part.type === "tool" && isPairedCapabilityGateway(part, parts))
      .map((part) => part.id),
  )

  const flushProcess = () => {
    if (!currentProcess?.items.length) {
      currentProcess = undefined
      return
    }
    const first = currentProcess.items[0]
    const workflowState = currentProcess.info.isWorkflow
      ? workflowProcessState(currentProcess.items, message, options, workflowTerminals.get(currentProcess.info.workflow || ""))
      : undefined
    const state = workflowState?.state || processItemsState(currentProcess.items)
    const currentLabel = workflowState?.currentLabel ||
      processItemCurrentLabel(currentProcess.items[currentProcess.items.length - 1])
    const failureCount = workflowState ? workflowState.failureCount : processFailureCount(currentProcess.items)
    items.push({
      type: "timeline_process_group",
      group: {
        id: `process-group:${message?.id || "message"}:${first.id}:${currentProcess.key}`,
        groupKey: currentProcess.key,
        kind: currentProcess.info.kind,
        label: currentProcess.info.label,
        state,
        count: currentProcess.items.length,
        failureCount,
        currentLabel,
        workflow: currentProcess.info.workflow,
        isWorkflow: currentProcess.info.isWorkflow,
        items: currentProcess.items,
      },
    })
    currentProcess = undefined
  }

  for (const part of parts) {
    if (hiddenCapabilityGatewayIds.has(part.id)) continue
    if (part.type === "assistant_text") {
      flushProcess()
      items.push({ type: "timeline_text", part })
      continue
    }
    if (part.type === "notice") {
      flushProcess()
      items.push({ type: "timeline_notice", part })
      continue
    }
    if (part.type === "thinking" || part.type === "reasoning") {
      continue
    }
    if (!isProcessItem(part)) {
      flushProcess()
      items.push({ type: "timeline_part", part })
      continue
    }
    const info = processGroupInfoForPart(part)
    if (!currentProcess || currentProcess.key !== info.key) {
      flushProcess()
      currentProcess = { key: info.key, info, items: [part] }
      continue
    }
    currentProcess.items.push(part)
  }
  flushProcess()

  return items
}

function buildProcessSummary(
  items: ProcessTimelineItem[],
  message?: Pick<MockMessage, "id" | "traceNodeStatus">,
  options: TranscriptPresentationOptions = {},
  workflowTerminals = new Map<string, WorkflowTerminalState>(),
): ProcessSummary | undefined {
  if (!items.length) return undefined
  const processItems = items.flatMap((item) =>
    item.type === "timeline_process_group" ? item.group.items : []
  )
  const summaryItems = items.filter((item) => item.type !== "timeline_notice")
  if (!summaryItems.length) return undefined
  const first = summaryItems[0]
  const firstId = timelineItemStableId(first)
  const failureCount = processFailureCount(processItems)
  const workflowGroup = items.find((item): item is Extract<ProcessTimelineItem, { type: "timeline_process_group" }> =>
    item.type === "timeline_process_group" && Boolean(item.group.workflow)
  )
  const isWorkflow = items.some((item) => item.type === "timeline_process_group" && item.group.isWorkflow)
  const workflow = workflowGroup?.group.workflow
  const rawState = processItems.length ? processItemsState(processItems) : "completed"
  const workflowState = isWorkflow
    ? workflowProcessState(processItems, message, options, workflowTerminals.get(workflow || ""))
    : undefined
  const state = workflowState?.state || rawState
  const currentLabel = workflowState?.currentLabel ||
    processSummaryCurrentLabel(items, state, options.runningProcessLabel)
  const effectiveFailureCount = workflowState ? workflowState.failureCount : failureCount

  return {
    id: `process-summary:${message?.id || "message"}:${firstId}`,
    state: effectiveFailureCount > 0 ? "error" : state,
    count: processItems.length,
    failureCount: effectiveFailureCount,
    currentLabel,
    workflow,
    isWorkflow,
    items,
  }
}

function processSummaryCurrentLabel(
  items: ProcessTimelineItem[],
  state: ProcessState,
  runningProcessLabel?: string,
): string | undefined {
  const groups = items
    .filter((item): item is Extract<ProcessTimelineItem, { type: "timeline_process_group" }> => item.type === "timeline_process_group")
    .map((item) => item.group)
  const runningLabel = findLast(groups, (group) =>
    group.items.some(isRunningProcessItem) && Boolean(group.currentLabel)
  )?.currentLabel
  if (runningLabel) return runningLabel
  if (state === "running" && runningProcessLabel?.trim()) return runningProcessLabel.trim()
  return findLast(groups, (group) => Boolean(group.currentLabel))?.currentLabel
}

function findLast<T>(items: T[], predicate: (item: T) => boolean): T | undefined {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (predicate(items[index])) return items[index]
  }
  return undefined
}

interface WorkflowProcessState {
  state: ProcessState
  currentLabel?: string
  failureCount: number
}

interface WorkflowTerminalState {
  state: "done" | "error" | "cancelled"
  label?: string
}

function workflowProcessState(
  items: TranscriptItem[],
  message?: Pick<MockMessage, "traceNodeStatus">,
  options: TranscriptPresentationOptions = {},
  terminal?: WorkflowTerminalState,
): WorkflowProcessState {
  const latestSteps = workflowLatestSteps(items)
  const latestItem = latestSteps[latestSteps.length - 1] || items[items.length - 1]
  const failureCount = latestSteps.reduce((count, item) => count + (workflowStepState(item) === "error" ? 1 : 0), 0) +
    (terminal?.state === "error" ? 1 : 0)
  const latestRunning = findLast(latestSteps, (item) => workflowStepState(item) === "running")
  const latestLabel = latestItem ? processItemCurrentLabel(latestItem) : undefined
  const active = message?.traceNodeStatus === "active" || message?.traceNodeStatus === "streaming"

  if (failureCount > 0) {
    return {
      state: "error",
      currentLabel: terminal?.state === "error" && terminal.label ? terminal.label : latestLabel,
      failureCount,
    }
  }
  if (latestRunning) {
    return {
      state: terminal && !active ? "completed" : "running",
      currentLabel: terminal && !active ? terminal.label || latestLabel : processItemCurrentLabel(latestRunning),
      failureCount,
    }
  }
  if (active) {
    return {
      state: "running",
      currentLabel: options.runningProcessLabel?.trim() || latestLabel,
      failureCount,
    }
  }
  return {
    state: "completed",
    currentLabel: terminal?.label || latestLabel,
    failureCount,
  }
}

function workflowLatestSteps(items: TranscriptItem[]): TranscriptItem[] {
  const keyed = new Map<string, TranscriptItem>()
  const unkeyed: TranscriptItem[] = []
  for (const item of items) {
    if (item.type !== "workflow_step") {
      unkeyed.push(item)
      continue
    }
    const key = workflowStepLifecycleKey(item)
    if (!key) {
      unkeyed.push(item)
      continue
    }
    keyed.set(key, item)
  }
  const latestKeyed = Array.from(keyed.values())
  const all = [...unkeyed, ...latestKeyed]
  all.sort((left, right) => items.indexOf(left) - items.indexOf(right))
  return all
}

function workflowStepLifecycleKey(item: TranscriptItem): string {
  if (item.type !== "workflow_step") return ""
  const details = item.details || {}
  const payload = item.payload || {}
  return stringFromRecord(details, "tool_call_id") ||
    stringFromRecord(details, "toolCallId") ||
    stringFromRecord(payload, "tool_call_id") ||
    stringFromRecord(payload, "toolCallId")
}

function workflowStepState(item: TranscriptItem): ProcessState {
  if (isErrorProcessItem(item)) return "error"
  if (item.type === "workflow_step" && item.status === "running") return "running"
  if (item.type === "workflow_decision" && item.status === "pending") return "running"
  return "completed"
}

function workflowTerminalStates(items: TranscriptItem[]): Map<string, WorkflowTerminalState> {
  const terminals = new Map<string, WorkflowTerminalState>()
  for (const item of items) {
    const terminal = workflowTerminalState(item)
    if (!terminal) continue
    terminals.set(terminal.workflow, terminal)
  }
  return terminals
}

function workflowTerminalState(item: TranscriptItem): (WorkflowTerminalState & { workflow: string }) | undefined {
  if (item.type === "workflow_result") {
    return {
      workflow: item.workflow || "",
      state: item.status === "error" ? "error" : item.status === "cancelled" ? "cancelled" : "done",
      label: item.title || item.summary,
    }
  }
  if (item.type === "workflow_artifact") {
    return {
      workflow: item.workflow || "",
      state: "done",
      label: item.title || item.summary,
    }
  }
  if (item.type === "workflow_step" && item.status !== "running" && isTerminalWorkflowStep(item)) {
    return {
      workflow: item.workflow || "",
      state: item.status === "error" ? "error" : item.status === "cancelled" ? "cancelled" : "done",
      label: item.title || item.summary,
    }
  }
  return undefined
}

function isTerminalWorkflowStep(item: Extract<TranscriptItem, { type: "workflow_step" }>): boolean {
  const phase = stringFromRecord(item.details || {}, "phase") || stringFromRecord(item.payload || {}, "phase")
  return item.stage === "done" || /^agent_run_(completed|failed|cancelled)$/.test(phase)
}

function stringFromRecord(record: Record<string, unknown>, key: string): string {
  const value = record[key]
  return typeof value === "string" ? value.trim() : ""
}

function timelineItemStableId(item: ProcessTimelineItem): string {
  if (item.type === "timeline_text" || item.type === "timeline_notice" || item.type === "timeline_part") return item.part.id
  return item.group.id
}

function resolveFinalAnswerStartIndex(
  parts: TranscriptItem[],
  message?: Pick<MockMessage, "traceNodeStatus">,
): number {
  const markedFinalIndex = findLastIndex(parts, (part) =>
    part.type === "assistant_text" && part.streamKey === "final" && !hasProcessItemAfter(parts, part)
  )
  if (markedFinalIndex >= 0) return markedFinalIndex

  const lastAssistantIndex = findLastIndex(parts, (part) => part.type === "assistant_text")
  if (lastAssistantIndex < 0) return -1
  const lastProcessIndex = findLastIndex(parts, isProcessItem)
  if (lastProcessIndex < 0) return lastAssistantIndex
  if (lastAssistantIndex <= lastProcessIndex) return -1

  const candidate = parts[lastAssistantIndex]
  if (candidate.type !== "assistant_text") return -1
  const streamKey = candidate.streamKey || ""
  if (streamKey === "assistant-stream" || streamKey === "assistant-message") return lastAssistantIndex
  if (!streamKey && !isMessageRunning(parts, message)) return lastAssistantIndex
  return -1
}

function hasProcessItemAfter(parts: TranscriptItem[], item: TranscriptItem): boolean {
  const index = parts.indexOf(item)
  if (index < 0) return false
  return parts.slice(index + 1).some(isProcessItem)
}

function findLastIndex<T>(items: T[], predicate: (item: T) => boolean): number {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (predicate(items[index])) return index
  }
  return -1
}

function appendReasoningText(current: string, next: string): string {
  if (!current) return next
  if (!next) return current
  if (/\s$/.test(current) || /^\s/.test(next)) return `${current}${next}`
  return `${current}\n${next}`
}

function mergeProcessState(left: ProcessState, right: ProcessState): ProcessState {
  if (left === "error" || right === "error") return "error"
  if (left === "running" || right === "running") return "running"
  return "completed"
}

interface ProcessGroupInfo {
  key: string
  kind: ProcessGroupKind
  label: string
  workflow?: string
  isWorkflow?: boolean
}

function processGroupInfoForPart(part: TranscriptItem): ProcessGroupInfo {
  if (part.type === "tool") return toolGroupInfo(part)
  if (part.type === "local_action") {
    return { key: `local-action:${part.workspaceRoot || part.actionKind || "default"}`, kind: "local_action", label: "本地动作" }
  }
  if (part.type === "file_change" || part.type === "document_draft") {
    return { key: "modify", kind: "modify", label: t("process.group.modify") }
  }
  if (part.type === "terminal") return { key: "run:terminal", kind: "run", label: t("process.group.run") }
  if (part.type === "session") {
    return { key: "context:session", kind: "context", label: t("process.group.context") }
  }
  if (
    part.type === "context_event" ||
    part.type === "workflow_step" ||
    part.type === "memory_context" ||
    part.type === "ui_event" ||
    part.type === "view"
  ) {
    if (part.type === "workflow_step") {
      const workflow = (part.workflow || "").trim()
      return {
        key: `workflow:${workflow || "workflow"}`,
        kind: "context",
        label: workflowGroupLabel(workflow),
        workflow,
        isWorkflow: true,
      }
    }
    return { key: "context", kind: "context", label: t("process.group.context") }
  }
  return { key: `other:${part.type}`, kind: "other", label: t("process.group.other") }
}

function toolGroupInfo(part: ToolActivityItem): ProcessGroupInfo {
  const toolName = toolDisplayName(part)
  if (isMcpTool(part)) {
    const server = toolSourceName(part, ["mcp_server", "server", "server_name", "namespace"])
    return {
      key: `mcp:${server || "default"}`,
      kind: "mcp",
      label: server ? `MCP · ${server}` : "MCP",
    }
  }
  if (isSkillTool(part)) {
    const skill = toolSourceName(part, ["skill", "skill_name", "name"])
    return {
      key: `skill:${skill || "default"}`,
      kind: "skill",
      label: skill ? `Skill · ${skill}` : "Skill",
    }
  }

  const kind = getToolGroupKind(toolName)
  if (kind === "explore") return { key: "explore", kind, label: t("process.group.explore") }
  if (kind === "modify") return { key: "modify", kind, label: t("process.group.modify") }
  if (kind === "run") return { key: "run", kind, label: t("process.group.run") }
  return { key: `other-tool:${toolName || "tool"}`, kind: "other", label: t("process.group.other") }
}

function isProcessItem(part: TranscriptItem): boolean {
  return (
    part.type === "tool" ||
    part.type === "file_change" ||
    part.type === "document_draft" ||
    part.type === "trace" ||
    part.type === "session" ||
    part.type === "terminal" ||
    part.type === "view" ||
    part.type === "context_event" ||
    part.type === "workflow_step" ||
    part.type === "memory_context" ||
    part.type === "ui_event" ||
    part.type === "local_action" ||
    part.type === "parallel_tools" ||
    part.type === "parallel_sessions"
  )
}

function isMcpTool(part: ToolActivityItem): boolean {
  const tool = toolDisplayName(part).toLowerCase()
  const source = (part.source || "").toLowerCase()
  return source.includes("mcp") || tool === "mcp" || tool === "use_mcp_server" || tool.startsWith("mcp_") || tool.includes("mcp")
}

function isSkillTool(part: ToolActivityItem): boolean {
  const tool = toolDisplayName(part).toLowerCase()
  const source = (part.source || "").toLowerCase()
  return source.includes("skill") || tool === "skill" || tool === "use_skill" || tool.startsWith("skill_") || tool.includes("skill")
}

function toolSourceName(part: ToolActivityItem, inputKeys: string[]): string {
  for (const key of inputKeys) {
    const value = part.input?.[key]
    if (typeof value === "string" && value.trim()) return value.trim()
  }
  const source = (part.source || "").trim()
  const match = source.match(/(?:mcp|skill)[:/\\-]([^:/\\]+)$/i)
  if (match?.[1]) return match[1].trim()
  return ""
}

function processItemCurrentLabel(item: TranscriptItem): string {
  if (item.type === "tool") {
    if (item.status === "preparing") {
      const toolName = toolDisplayName(item)
      if (!toolName || toolName === "tool") return t("tool.preparingGeneric")
      return t("tool.preparingCall", { tool: toolName })
    }
    return [getToolActionLabel(toolDisplayName(item)), processItemTarget(item)].filter(Boolean).join(" ")
  }
  if (item.type === "file_change") {
    return [t("tool.fileChange"), compactLabel(fileChangeTarget(item))].filter(Boolean).join(" ")
  }
  if (item.type === "document_draft") {
    return [t("tool.documentDraft"), compactLabel(item.targetPath || item.title || "")].filter(Boolean).join(" ")
  }
  if (item.type === "local_action") return item.message || localActionLabel(item)
  if (item.type === "terminal") return item.title || t("process.group.run")
  if (item.type === "workflow_step") return item.title || workflowStageLabel(item.stage)
  if (item.type === "session") return item.title || item.sessionId || t("process.group.context")
  if (item.type === "context_event" && isLifecycleHookPayload(item.payload)) {
    return lifecycleDisplayTitle(item.payload, lifecycleLabels())
  }
  if ("title" in item && item.title) return item.title
  if (item.type === "notice") return item.text
  return processGroupInfoForPart(item).label
}

function lifecycleLabels() {
  return {
    defaultTitle: t("tool.lifecycle.default"),
    toolCheck: t("tool.lifecycle.toolCheck"),
    toolBlocked: t("tool.lifecycle.toolBlocked"),
    toolResult: t("tool.lifecycle.toolResult"),
    promptReview: t("tool.lifecycle.promptReview"),
    recovery: t("tool.lifecycle.recovery"),
    elicitation: t("tool.lifecycle.elicitation"),
    elicitationResult: t("tool.lifecycle.elicitationResult"),
  }
}

function fileChangeTarget(item: FileChangeItem): string {
  if (item.path) return item.path
  for (const change of item.changes || []) {
    const path = change.move_path || change.movePath || change.path
    if (typeof path === "string" && path.trim()) return path.trim()
  }
  return ""
}

function processItemTarget(item: ToolActivityItem): string {
  const input = item.capabilityTarget?.targetArguments || item.input || {}
  for (const key of ["path", "file", "pattern", "query", "command", "cmd"]) {
    const value = input[key]
    if (typeof value === "string" && value.trim()) return compactLabel(value.trim())
  }
  return ""
}

function toolDisplayName(item: ToolActivityItem): string {
  return (item.capabilityTarget?.targetToolName || item.tool || "").trim()
}

function isPairedCapabilityGateway(gateway: ToolActivityItem, parts: TranscriptItem[]): boolean {
  if (gateway.capabilityRole !== "gateway") return false
  const targetToolCallId = stringFromMaybeRecord(gateway.executeTrace, "target_tool_call_id", "targetToolCallId")
  return parts.some((part) => {
    if (part.type !== "tool" || part.capabilityRole !== "target") return false
    const target = part.capabilityTarget
    if (!target) return false
    if (gateway.toolCallId && target.parentToolCallId === gateway.toolCallId) return true
    if (targetToolCallId && (part.toolCallId === targetToolCallId || target.targetToolCallId === targetToolCallId)) return true
    return false
  })
}

function stringFromMaybeRecord(value: unknown, snakeKey: string, camelKey: string): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) return ""
  const record = value as Record<string, unknown>
  const raw = record[snakeKey] ?? record[camelKey]
  return typeof raw === "string" ? raw.trim() : ""
}

function compactLabel(value: string): string {
  return value.length > 72 ? `${value.slice(0, 69)}...` : value
}

export function processGroupKindForPart(part: TranscriptItem): ProcessGroupKind {
  return processGroupInfoForPart(part).kind
}

export function getToolGroupKind(toolName?: string): ProcessGroupKind {
  const normalized = (toolName || "").trim()
  if (EXPLORE_TOOLS.has(normalized)) return "explore"
  if (MODIFY_TOOLS.has(normalized)) return "modify"
  if (RUN_TOOLS.has(normalized)) return "run"
  return "other"
}

export function getToolGroupLabel(toolName?: string): string {
  const kind = getToolGroupKind(toolName)
  if (kind === "explore") return t("tool.explore")
  if (kind === "modify") return t("tool.modify")
  if (kind === "run") return t("tool.run")
  return (toolName || "").trim() || "tool"
}

export function getToolActionLabel(toolName?: string): string {
  const labels: Record<string, string> = {
    read_file: t("tool.readFile"),
    read_files: t("tool.readFile"),
    shell: t("tool.shell"),
    grep: t("tool.grep"),
    glob: t("tool.glob"),
    mcp: t("tool.mcp"),
    delegate_agent: t("tool.delegateAgent"),
    execute_command: t("tool.executeCommand"),
    run_terminal_cmd: t("tool.executeCommand"),
    list_file: t("tool.listFile"),
    list_files: t("tool.listFile"),
    list_directory: t("tool.listDirectory"),
    search_file: t("tool.searchFiles"),
    search_files: t("tool.searchFiles"),
    apply_patch: t("tool.applyPatch"),
    draft_document_begin: t("tool.documentDraft"),
    install_capability_package: t("tool.installCapabilityPackage"),
    read_workspace_file: "读取本地文件",
    read_workspace_files: "读取本地文件",
    write_workspace_file: "写入本地文件",
    apply_workspace_patch: "修改本地文件",
    run_workspace_command: "执行本地命令",
    mcp_status: "检查本地 MCP 状态",
    mcp_lifecycle: "管理本地 MCP 生命周期",
    mcp_invocation: "调用本地 MCP",
  }
  const normalized = (toolName || "").trim()
  return labels[normalized] || normalized || "tool"
}

export function isMessageRunning(
  parts: TranscriptItem[],
  message?: Pick<MockMessage, "traceNodeStatus">,
): boolean {
  if (message?.traceNodeStatus === "active" || message?.traceNodeStatus === "streaming") return true
  return parts.some((part) => {
    if (part.type === "assistant_text") return part.streaming === true
    if (part.type === "thinking") return part.active === true
    if (part.type === "workflow_step") return part.status === "running"
    if (part.type === "workflow_decision") return part.status === "pending"
    if (part.type === "file_change") return part.status === "in_progress"
    if (part.type === "document_draft") {
      return ["streaming", "committing"].includes(part.status)
    }
    if (part.type === "local_action") return isRunningLocalAction(part)
    if (part.type !== "tool") return false
    return isRunningTool(part)
  })
}

export function processItemsState(items: TranscriptItem[]): ProcessState {
  if (items.some(isErrorProcessItem)) return "error"
  if (items.some(isRunningProcessItem)) return "running"
  return "completed"
}

export function processFailureCount(items: TranscriptItem[]): number {
  return items.reduce((count, item) => {
    if (isParallelItem(item)) return count + processFailureCount(item.items || [])
    return count + (isErrorProcessItem(item) ? 1 : 0)
  }, 0)
}

function isRunningTool(part: ToolActivityItem): boolean {
  return ["preparing", "pending", "running", "awaiting_approval", "approved"].includes(part.status || "")
}

function isParallelItem(part: TranscriptItem): part is Extract<TranscriptItem, { type: "parallel_tools" | "parallel_sessions" }> {
  return part.type === "parallel_tools" || part.type === "parallel_sessions"
}

function isRunningProcessItem(part: TranscriptItem): boolean {
  if (isParallelItem(part)) return processItemsState(part.items || []) === "running"
  if (part.type === "thinking") return part.active === true
  if (part.type === "workflow_step") return part.status === "running"
  if (part.type === "workflow_decision") return part.status === "pending"
  if (part.type === "file_change") return part.status === "in_progress"
  if (part.type === "document_draft") {
    return ["streaming", "committing"].includes(part.status)
  }
  if (part.type === "local_action") return isRunningLocalAction(part)
  if (part.type === "tool") return isRunningTool(part)
  if (part.traceNodeStatus === "active" || part.traceNodeStatus === "streaming") return true
  if (part.type === "session") return part.state === "active" || part.state === "streaming"
  return false
}

function isErrorProcessItem(part: TranscriptItem): boolean {
  if (isParallelItem(part)) return processFailureCount(part.items || []) > 0
  if (part.traceNodeStatus === "error") return true
  if (part.type === "tool") return part.status === "error" || part.status === "protocol_error"
  if (part.type === "file_change") return part.status === "failed"
  if (part.type === "document_draft") return part.status === "failed"
  if (part.type === "local_action") return part.status === "failed" || part.status === "timed_out"
  if (part.type === "notice") return part.level === "error"
  if (part.type === "session") return part.state === "error"
  if (part.type === "workflow_step" || part.type === "workflow_result") return part.status === "error"
  if (part.type === "workflow_decision") return part.status === "denied" || part.status === "error"
  if (part.type === "view" || part.type === "ui_event") return part.level === "error"
  return false
}

function localActionLabel(part: LocalActionItem): string {
  const target = part.workspaceRoot ? ` · ${compactLabel(part.workspaceRoot)}` : ""
  return [getToolActionLabel(part.actionKind), target].filter(Boolean).join("")
}

function isRunningLocalAction(part: LocalActionItem): boolean {
  return part.status === "requested" ||
    part.status === "waiting_peer" ||
    part.status === "started" ||
    part.status === "progress"
}

function isPrimaryLanePart(part: TranscriptItem): boolean {
  return (
    part.type === "workflow_artifact" ||
    part.type === "workflow_decision" ||
    part.type === "workflow_result"
  )
}

function workflowStageLabel(stage?: string): string {
  const labels: Record<string, string> = {
    prepare: "准备",
    read_source: "读取来源",
    extract_evidence: "提取证据",
    compose_draft: "生成草案",
    await_approval: "等待确认",
    install: "安装",
    done: "完成",
  }
  const key = (stage || "").trim()
  return labels[key] || key || t("process.group.context")
}

function workflowGroupLabel(workflow?: string): string {
  const key = (workflow || "").trim()
  if (key === "capability_package_ingest") return t("workflow.capabilityPackageIngest")
  return key || t("workflow.generic")
}
