import { snapshotDigest } from "../../utils/snapshot-digest"
import { buildShellOutputText, isShellToolName } from "../../utils/shell-tool-output"
import {
  bucketWidth,
  estimatePlainTextHeight,
  type TextMeasureMetrics,
} from "../../utils/text-measure"
import type { MockMessage, MockTurn } from "./mock-data"
import type { ToolActivityItem, TranscriptItem } from "./transcript-model"
import {
  buildTranscriptPresentation,
  type ProcessGroup,
  type ProcessTimelineItem,
  type TranscriptPresentationItem,
} from "./transcript-presentation"

export interface TurnHeightMetrics extends TextMeasureMetrics {
  actionRowHeight: number
  assistantMarkerWidth: number
  messageGap: number
  partGap: number
  turnGap: number
  userBubbleHorizontalPadding: number
  userBubbleVerticalPadding: number
}

export interface TurnHeightCacheStats {
  entries: number
  hits: number
  misses: number
}

const DEFAULT_METRICS: TurnHeightMetrics = {
  font: `13px "Segoe UI"`,
  monoFont: "12px Consolas, monospace",
  lineHeight: 19,
  monoLineHeight: 17,
  actionRowHeight: 24,
  assistantMarkerWidth: 24,
  messageGap: 8,
  partGap: 7,
  turnGap: 12,
  userBubbleHorizontalPadding: 20,
  userBubbleVerticalPadding: 16,
}

const MAX_TURN_CACHE_ENTRIES = 1200
const turnHeightCache = new Map<string, number>()
let cacheHits = 0
let cacheMisses = 0

export function estimateTurnHeight(turn: MockTurn, width: number, metrics: Partial<TurnHeightMetrics> = {}): number {
  const resolvedMetrics = { ...DEFAULT_METRICS, ...metrics }
  const normalizedWidth = Math.max(240, bucketWidth(width))
  const key = turnHeightCacheKey(turn, normalizedWidth)
  const cached = turnHeightCache.get(key)
  if (cached !== undefined) {
    cacheHits += 1
    return cached
  }

  cacheMisses += 1
  const height = Math.ceil(estimateTurnContentHeight(turn, normalizedWidth, resolvedMetrics))
  rememberTurnHeight(key, height)
  return height
}

export function turnHeightCacheKey(turn: MockTurn, width: number): string {
  return `${turn.userMessage.id}:${bucketWidth(width)}:${turnContentDigest(turn)}`
}

export function clearTurnHeightCache(): void {
  turnHeightCache.clear()
  cacheHits = 0
  cacheMisses = 0
}

export function getTurnHeightCacheStats(): TurnHeightCacheStats {
  return {
    entries: turnHeightCache.size,
    hits: cacheHits,
    misses: cacheMisses,
  }
}

function estimateTurnContentHeight(turn: MockTurn, width: number, metrics: TurnHeightMetrics): number {
  const userHeight = estimateUserMessageHeight(turn.userMessage, width, metrics)
  const assistantHeight = turn.assistantMessages.reduce(
    (sum, message) => sum + estimateAssistantMessageHeight(message, width, metrics),
    0,
  )
  const assistantGaps = Math.max(0, turn.assistantMessages.length) * metrics.messageGap
  return userHeight + assistantGaps + assistantHeight + metrics.turnGap
}

function estimateUserMessageHeight(message: MockMessage, width: number, metrics: TurnHeightMetrics): number {
  const bubbleWidth = Math.min(width * 0.92, 720) - metrics.userBubbleHorizontalPadding
  const textHeight = estimatePlainTextHeight(message.text, bubbleWidth, {
    font: metrics.font,
    lineHeight: metrics.lineHeight,
    whiteSpace: "pre-wrap",
    horizontalPadding: metrics.userBubbleHorizontalPadding,
    verticalPadding: metrics.userBubbleVerticalPadding,
    minLines: 1,
  })
  return metrics.actionRowHeight + textHeight
}

function estimateAssistantMessageHeight(message: MockMessage, width: number, metrics: TurnHeightMetrics): number {
  const bodyWidth = Math.max(160, width - metrics.assistantMarkerWidth)
  const partHeights = buildTranscriptPresentation(message.parts, message)
    .map((item) => estimatePresentationItemHeight(item, bodyWidth, metrics))
  const partGaps = Math.max(0, partHeights.length - 1) * metrics.partGap
  const bodyHeight = partHeights.reduce((sum, height) => sum + height, 0) + partGaps
  return metrics.actionRowHeight + bodyHeight
}

function estimatePresentationItemHeight(item: TranscriptPresentationItem, width: number, metrics: TurnHeightMetrics): number {
  if (item.type === "timeline_text") return estimateTextPartHeight(item.part, width, metrics)
  if (item.type === "timeline_notice") return estimatePlainCardHeight(item.part.text, width, 32, metrics)
  if (item.type === "final_answer") {
    const heights = item.parts.map((part) => estimateTextPartHeight(part, width, metrics))
    const gaps = Math.max(0, heights.length - 1) * metrics.partGap
    return heights.reduce((sum, height) => sum + height, 0) + gaps
  }
  return 30
}

function estimatePartHeight(part: TranscriptItem, width: number, metrics: TurnHeightMetrics): number {
  switch (part.type) {
    case "assistant_text":
      return estimateTextPartHeight(part, width, metrics)
    case "thinking":
      return 30
    case "reasoning":
      return estimateReasoningPartHeight(part, width, metrics)
    case "tool":
      return estimateToolPartHeight(part, width, metrics)
    case "notice":
      return estimatePlainCardHeight(part.text, width, 32, metrics)
    case "trace":
      return estimatePlainCardHeight(part.text || part.title || "", width, 42, metrics)
    case "session":
      return estimatePlainCardHeight(part.summary || part.title || "", width, 44, metrics)
    case "terminal":
      return 34 + estimateCodeHeight(part.content || "", width, metrics, 88, 220)
    case "view":
    case "context_event":
    case "memory_context":
    case "ui_event":
      return estimateStructuredCardHeight(part, width, metrics)
    case "parallel_tools":
    case "parallel_sessions":
      return estimateParallelHeight(part, width, metrics)
    default:
      return 48
  }
}

function estimateTextPartHeight(part: Extract<TranscriptItem, { type: "assistant_text" }>, width: number, metrics: TurnHeightMetrics): number {
  if (part.format === "markdown") {
    return estimateMarkdownTextHeight(part.markdown || "", width, metrics)
  }
  return estimatePlainTextHeight(part.markdown || "", width, {
    font: metrics.font,
    lineHeight: metrics.lineHeight,
    whiteSpace: "pre-wrap",
    minLines: 1,
  })
}

function estimateReasoningPartHeight(part: Extract<TranscriptItem, { type: "reasoning" }>, _width: number, _metrics: TurnHeightMetrics): number {
  const headerHeight = 38
  return part.summary ? headerHeight + 18 : headerHeight
}

function estimateMarkdownTextHeight(text: string, width: number, metrics: TurnHeightMetrics): number {
  const codeBlocks = [...text.matchAll(/```[\w-]*\n([\s\S]*?)(?:```|$)/g)]
  const codeHeight = codeBlocks.reduce((sum, match) => sum + estimateCodeHeight(match[1] || "", width, metrics, 42, 320), 0)
  const markdownText = stripMarkdownForHeight(text.replace(/```[\s\S]*?(?:```|$)/g, "\n"))
  const proseHeight = estimatePlainTextHeight(markdownText, width, {
    font: metrics.font,
    lineHeight: metrics.lineHeight,
    whiteSpace: "pre-wrap",
    minLines: markdownText.trim() ? 1 : 0,
  })
  const structuralExtra = estimateMarkdownStructuralExtra(text, metrics)
  return proseHeight + codeHeight + structuralExtra
}

function estimateToolPartHeight(part: ToolActivityItem, width: number, metrics: TurnHeightMetrics): number {
  if (isShellToolName(part.tool, part.source)) {
    return estimateShellToolHeight(part, width, metrics)
  }

  const headerHeight = 38
  if (!isExpandableToolOpen(part.status)) return headerHeight

  const inputHeight = part.input && Object.keys(part.input).length > 0
    ? 24 + estimateCodeHeight(formatJson(part.input), width, metrics, 34, 112)
    : 0
  const outputText = part.output || ""
  const outputHeight = outputText
    ? 24 + (part.outputFormat === "markdown"
      ? Math.min(112, estimateMarkdownTextHeight(outputText, width, metrics))
      : estimateCodeHeight(outputText, width, metrics, 34, 112))
    : 0
  const approvalHeight = part.approvalId ? 92 : 0
  const metadataHeight = part.resultMeta && Object.keys(part.resultMeta).length > 0
    ? 24 + estimateCodeHeight(formatJson(part.resultMeta), width, metrics, 34, 160)
    : 0

  return headerHeight + 26 + inputHeight + outputHeight + approvalHeight + metadataHeight
}

function estimateShellToolHeight(part: ToolActivityItem, width: number, metrics: TurnHeightMetrics): number {
  const headerHeight = 38
  if (!isShellToolOpen(part.status)) return headerHeight

  const outputText = buildShellOutputText(part.outputChunks) || part.output || part.finalOutput || ""
  const terminalHeight = estimateCodeHeight(outputText, width, metrics, 72, 128)
  const approvalHeight = part.approvalId ? 32 : 0
  const detailsHintHeight = part.resultMeta || part.finalOutput ? 26 : 0
  return headerHeight + 26 + 30 + approvalHeight + terminalHeight + detailsHintHeight
}

function estimateStructuredCardHeight(part: TranscriptItem, width: number, metrics: TurnHeightMetrics): number {
  const payload = "payload" in part ? part.payload : undefined
  const summary = stringPayload(payload?.markdown || payload?.content || payload?.message || payload?.rendered_context)

  return 38 + (summary ? estimateMarkdownTextHeight(summary, width, metrics) : 0)
}

function estimateParallelHeight(part: Extract<TranscriptItem, { type: "parallel_tools" | "parallel_sessions" }>, width: number, metrics: TurnHeightMetrics): number {
  const items = part.items || []
  if (items.length === 0) return 42
  return 30 + items.reduce((sum, item) => sum + estimatePartHeight(item, width, metrics) + metrics.partGap, 0)
}

function estimatePlainCardHeight(text: string, width: number, baseline: number, metrics: TurnHeightMetrics): number {
  if (!text) return baseline
  return baseline + estimatePlainTextHeight(text, width, {
    font: metrics.font,
    lineHeight: metrics.lineHeight,
    whiteSpace: "normal",
    maxLines: 2,
  })
}

function estimateCodeHeight(text: string, width: number, metrics: TurnHeightMetrics, minHeight: number, maxHeight: number): number {
  const height = estimatePlainTextHeight(text, width, {
    font: metrics.monoFont,
    lineHeight: metrics.monoLineHeight,
    whiteSpace: "pre-wrap",
    verticalPadding: 16,
    minLines: text ? 1 : 0,
  })
  return Math.max(minHeight, Math.min(maxHeight, height))
}

function stripMarkdownForHeight(text: string): string {
  return text
    .replace(/!\[[^\]]*]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^>\s?/gm, "")
    .replace(/^[\s-]*[-*+]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/[*_~`]/g, "")
}

function estimateMarkdownStructuralExtra(text: string, metrics: TurnHeightMetrics): number {
  const headingCount = (text.match(/^#{1,6}\s+/gm) || []).length
  const listCount = (text.match(/^\s*(?:[-*+]|\d+\.)\s+/gm) || []).length
  const tableCount = (text.match(/^\|.*\|$/gm) || []).length
  return headingCount * Math.round(metrics.lineHeight * 0.45) + Math.min(6, listCount) * 2 + Math.min(3, tableCount) * 8
}

function isExpandableToolOpen(status?: string): boolean {
  return ["preparing", "pending", "running", "awaiting_approval", "denied", "error", "cancelled"].includes(status || "")
}

function isShellToolOpen(status?: string): boolean {
  return ["preparing", "pending", "running", "awaiting_approval", "approved", "denied", "error", "cancelled"].includes(status || "")
}

function turnContentDigest(turn: MockTurn): string {
  return snapshotDigest({
    user: {
      id: turn.userMessage.id,
      text: turn.userMessage.text,
      trace: turn.userMessage.traceNodeStatus,
    },
    assistant: turn.assistantMessages.map((message) => ({
      id: message.id,
      text: message.text,
      trace: message.traceNodeStatus,
      presentation: buildTranscriptPresentation(message.parts, message).map(presentationDigestSource),
    })),
  })
}

function presentationDigestSource(item: TranscriptPresentationItem): Record<string, unknown> {
  if (item.type === "timeline_text") {
    return {
      type: item.type,
      id: item.part.id,
      markdown: item.part.markdown,
      format: item.part.format,
      streaming: item.part.streaming,
    }
  }
  if (item.type === "timeline_notice") {
    return {
      type: item.type,
      id: item.part.id,
      level: item.part.level,
      text: item.part.text,
      format: item.part.format,
    }
  }
  if (item.type === "reasoning_panel") {
    return {
      type: item.type,
      id: item.panel.id,
      state: item.panel.state,
      raw: textDigestSource(item.panel.raw),
      summary: textDigestSource(item.panel.summary || ""),
      count: item.panel.count,
    }
  }
  if (item.type === "timeline_process_group") {
    return {
      type: item.type,
      group: processGroupDigestSource(item.group),
    }
  }
  if (item.type === "process_summary") {
    return {
      type: item.type,
      id: item.summary.id,
      state: item.summary.state,
      count: item.summary.count,
      failures: item.summary.failureCount,
      items: item.summary.items.map(processTimelineItemDigestSource),
    }
  }
  return {
    type: item.type,
    parts: item.parts.map((part) => ({
      id: part.id,
      markdown: part.markdown,
      format: part.format,
      streaming: part.streaming,
      streamKey: part.streamKey,
    })),
  }
}

function processTimelineItemDigestSource(item: ProcessTimelineItem): Record<string, unknown> {
  if (item.type === "timeline_text") {
    return {
      type: item.type,
      id: item.part.id,
      markdown: item.part.markdown,
      format: item.part.format,
      streaming: item.part.streaming,
      streamKey: item.part.streamKey,
    }
  }
  if (item.type === "timeline_notice") {
    return {
      type: item.type,
      id: item.part.id,
      level: item.part.level,
      text: item.part.text,
      format: item.part.format,
    }
  }
  return {
    type: item.type,
    group: processGroupDigestSource(item.group),
  }
}

function processGroupDigestSource(group: ProcessGroup): Record<string, unknown> {
  return {
    id: group.id,
    key: group.groupKey,
    kind: group.kind,
    label: group.label,
    state: group.state,
    count: group.count,
    failures: group.failureCount,
    current: group.currentLabel,
    items: group.items.map(processPartDigestSource),
  }
}

function processPartDigestSource(part: TranscriptItem): Record<string, unknown> {
  return {
    id: part.id,
    type: part.type,
    trace: part.traceNodeStatus,
    title: "title" in part ? part.title : undefined,
    text: part.type === "notice" ? part.text : undefined,
    level: "level" in part ? part.level : undefined,
    summary: part.type === "session" || part.type === "parallel_tools" || part.type === "parallel_sessions" ? part.summary : undefined,
    tool: part.type === "tool" ? part.tool : undefined,
    source: part.type === "tool" ? part.source : undefined,
    outputFormat: part.type === "tool" ? part.outputFormat : undefined,
    status: part.type === "tool" ? part.status : undefined,
    state: part.type === "session" ? part.state : undefined,
    viewType: part.type === "view" ? part.viewType : undefined,
    kind: part.type === "ui_event" ? part.kind : undefined,
    itemCount: (part.type === "parallel_tools" || part.type === "parallel_sessions") ? part.items?.length : undefined,
  }
}

function textDigestSource(text: string): Record<string, unknown> {
  return {
    length: text.length,
    head: text.slice(0, 256),
    tail: text.length > 256 ? text.slice(-256) : "",
  }
}

function formatJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function stringPayload(value: unknown): string {
  return typeof value === "string" ? value : ""
}

function rememberTurnHeight(key: string, height: number): void {
  if (turnHeightCache.size >= MAX_TURN_CACHE_ENTRIES) {
    const oldest = turnHeightCache.keys().next().value
    if (oldest !== undefined) turnHeightCache.delete(oldest)
  }
  turnHeightCache.set(key, height)
}
