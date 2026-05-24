import { t } from "../../i18n"
import type { MockMessage } from "./mock-data"
import type { AssistantTextItem, NoticeItem, ToolActivityItem, TranscriptItem } from "./transcript-model"

export type ProcessGroupKind =
  | "explore"
  | "modify"
  | "run"
  | "mcp"
  | "skill"
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
  items: TranscriptItem[]
}

export type ProcessTimelineItem =
  | { type: "timeline_text"; part: AssistantTextItem }
  | { type: "timeline_process_group"; group: ProcessGroup }
  | { type: "timeline_notice"; part: NoticeItem }

export interface ProcessSummary {
  id: string
  state: ProcessState
  count: number
  failureCount: number
  items: ProcessTimelineItem[]
}

export type TranscriptPresentationItem =
  | ProcessTimelineItem
  | { type: "process_summary"; summary: ProcessSummary }
  | { type: "reasoning_panel"; panel: ReasoningPanel }
  | { type: "final_answer"; parts: AssistantTextItem[] }

export interface TranscriptPresentationOptions {
  runningProcessLabel?: string
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
  "write_file",
  "edit_file",
  "write_to_file",
  "replace_in_file",
  "apply_patch",
])

export const RUN_TOOLS = new Set([
  "shell",
  "execute_command",
  "run_terminal_cmd",
])

export function buildTranscriptPresentation(
  parts: TranscriptItem[],
  message?: Pick<MockMessage, "id" | "traceNodeStatus">,
  _options: TranscriptPresentationOptions = {},
): TranscriptPresentationItem[] {
  const reasoningPanel = buildReasoningPanel(parts, message)
  const finalAnswerStart = resolveFinalAnswerStartIndex(parts, message)

  if (finalAnswerStart >= 0) {
    const timeline = buildTimelineItems(parts.slice(0, finalAnswerStart), message)
    const finalParts = parts
      .slice(finalAnswerStart)
      .filter((part): part is AssistantTextItem => part.type === "assistant_text")
    const lateNotices = parts
      .slice(finalAnswerStart)
      .filter((part): part is NoticeItem => part.type === "notice")
    const summary = buildProcessSummary(timeline, message)
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
    return output
  }

  const output: TranscriptPresentationItem[] = [...buildTimelineItems(parts, message)]
  if (reasoningPanel) output.push({ type: "reasoning_panel", panel: reasoningPanel })
  return output
}

function buildReasoningPanel(
  parts: TranscriptItem[],
  message?: Pick<MockMessage, "id" | "traceNodeStatus">,
): ReasoningPanel | undefined {
  const items = parts.filter((item) => item.type === "thinking" || item.type === "reasoning")
  if (!items.length) return undefined
  const first = items[0]
  const last = items[items.length - 1]
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
    id: `reasoning:${message?.id || "message"}:${first.id}:${last.id}`,
    state,
    raw,
    summary: summary || undefined,
    count: items.length,
  }
}

function buildTimelineItems(
  parts: TranscriptItem[],
  message?: Pick<MockMessage, "id" | "traceNodeStatus">,
): ProcessTimelineItem[] {
  const items: ProcessTimelineItem[] = []
  let current: { key: string; info: ProcessGroupInfo; items: TranscriptItem[] } | undefined

  const flush = () => {
    if (!current?.items.length) {
      current = undefined
      return
    }
    const first = current.items[0]
    const last = current.items[current.items.length - 1]
    items.push({
      type: "timeline_process_group",
      group: {
        id: `process-group:${message?.id || "message"}:${items.length}:${first.id}:${last.id}:${current.key}`,
        groupKey: current.key,
        kind: current.info.kind,
        label: current.info.label,
        state: processItemsState(current.items),
        count: current.items.length,
        failureCount: processFailureCount(current.items),
        currentLabel: processItemCurrentLabel(current.items[current.items.length - 1]),
        items: current.items,
      },
    })
    current = undefined
  }

  for (const part of parts) {
    if (part.type === "assistant_text") {
      flush()
      items.push({ type: "timeline_text", part })
      continue
    }
    if (part.type === "notice") {
      flush()
      items.push({ type: "timeline_notice", part })
      continue
    }
    if (!isProcessItem(part)) {
      flush()
      continue
    }
    const info = processGroupInfoForPart(part)
    if (!current || current.key !== info.key) {
      flush()
      current = { key: info.key, info, items: [part] }
      continue
    }
    current.items.push(part)
  }
  flush()

  return items
}

function buildProcessSummary(
  items: ProcessTimelineItem[],
  message?: Pick<MockMessage, "id">,
): ProcessSummary | undefined {
  if (!items.length) return undefined
  const processItems = items.flatMap((item) =>
    item.type === "timeline_process_group" ? item.group.items : []
  )
  const summaryItems = items.filter((item) => item.type !== "timeline_notice")
  if (!summaryItems.length) return undefined
  const first = summaryItems[0]
  const last = summaryItems[summaryItems.length - 1]
  const firstId = timelineItemStableId(first)
  const lastId = timelineItemStableId(last)
  const failureCount = processFailureCount(processItems)

  return {
    id: `process-summary:${message?.id || "message"}:${firstId}:${lastId}`,
    state: failureCount > 0 ? "error" : "completed",
    count: processItems.length,
    failureCount,
    items,
  }
}

function timelineItemStableId(item: ProcessTimelineItem): string {
  if (item.type === "timeline_text" || item.type === "timeline_notice") return item.part.id
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

interface ProcessGroupInfo {
  key: string
  kind: ProcessGroupKind
  label: string
}

function processGroupInfoForPart(part: TranscriptItem): ProcessGroupInfo {
  if (part.type === "tool") return toolGroupInfo(part)
  if (part.type === "terminal") return { key: "run:terminal", kind: "run", label: t("process.group.run") }
  if (part.type === "session") {
    return { key: "context:session", kind: "context", label: t("process.group.context") }
  }
  if (
    part.type === "context_event" ||
    part.type === "memory_context" ||
    part.type === "ui_event" ||
    part.type === "view"
  ) {
    return { key: "context", kind: "context", label: t("process.group.context") }
  }
  return { key: `other:${part.type}`, kind: "other", label: t("process.group.other") }
}

function toolGroupInfo(part: ToolActivityItem): ProcessGroupInfo {
  const toolName = (part.tool || "").trim()
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
    part.type === "trace" ||
    part.type === "session" ||
    part.type === "terminal" ||
    part.type === "view" ||
    part.type === "context_event" ||
    part.type === "memory_context" ||
    part.type === "ui_event" ||
    part.type === "parallel_tools" ||
    part.type === "parallel_sessions"
  )
}

function isMcpTool(part: ToolActivityItem): boolean {
  const tool = (part.tool || "").toLowerCase()
  const source = (part.source || "").toLowerCase()
  return source.includes("mcp") || tool === "mcp" || tool === "use_mcp_server" || tool.startsWith("mcp_") || tool.includes("mcp")
}

function isSkillTool(part: ToolActivityItem): boolean {
  const tool = (part.tool || "").toLowerCase()
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
      const toolName = (item.tool || "").trim()
      if (!toolName || toolName === "tool") return t("tool.preparingGeneric")
      return t("tool.preparingCall", { tool: toolName })
    }
    return [getToolActionLabel(item.tool), processItemTarget(item)].filter(Boolean).join(" ")
  }
  if (item.type === "terminal") return item.title || t("process.group.run")
  if (item.type === "session") return item.title || item.sessionId || t("process.group.context")
  if ("title" in item && item.title) return item.title
  if (item.type === "notice") return item.text
  return processGroupInfoForPart(item).label
}

function processItemTarget(item: ToolActivityItem): string {
  const input = item.input || {}
  for (const key of ["path", "file", "pattern", "query", "command", "cmd"]) {
    const value = input[key]
    if (typeof value === "string" && value.trim()) return compactLabel(value.trim())
  }
  return ""
}

function compactLabel(value: string): string {
  return value.length > 72 ? `${value.slice(0, 69)}...` : value
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
    write_file: t("tool.writeFile"),
    edit_file: t("tool.editFile"),
    shell: t("tool.shell"),
    grep: t("tool.grep"),
    glob: t("tool.glob"),
    mcp: t("tool.mcp"),
    delegate_agent: t("tool.delegateAgent"),
    write_to_file: t("tool.writeToFile"),
    execute_command: t("tool.executeCommand"),
    run_terminal_cmd: t("tool.executeCommand"),
    list_file: t("tool.listFile"),
    list_files: t("tool.listFile"),
    list_directory: t("tool.listDirectory"),
    search_file: t("tool.searchFiles"),
    search_files: t("tool.searchFiles"),
    apply_patch: t("tool.applyPatch"),
    replace_in_file: t("tool.applyPatch"),
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
  if (part.type === "tool") return isRunningTool(part)
  if (part.traceNodeStatus === "active" || part.traceNodeStatus === "streaming") return true
  if (part.type === "session") return part.state === "active" || part.state === "streaming"
  return false
}

function isErrorProcessItem(part: TranscriptItem): boolean {
  if (isParallelItem(part)) return processFailureCount(part.items || []) > 0
  if (part.traceNodeStatus === "error") return true
  if (part.type === "tool") return part.status === "error" || part.status === "protocol_error"
  if (part.type === "notice") return part.level === "error"
  if (part.type === "session") return part.state === "error"
  if (part.type === "view" || part.type === "ui_event") return part.level === "error"
  return false
}
