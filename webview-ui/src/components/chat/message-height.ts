import { snapshotDigest } from "../../utils/snapshot-digest"
import { buildShellOutputText, isShellToolName } from "../../utils/shell-tool-output"
import {
  bucketWidth,
  estimatePlainTextHeight,
  type TextMeasureMetrics,
} from "../../utils/text-measure"
import type { MockMessage, MockPart, MockTurn } from "./mock-data"

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
  const partHeights = message.parts.map((part) => estimatePartHeight(part, bodyWidth, metrics))
  const partGaps = Math.max(0, partHeights.length - 1) * metrics.partGap
  const bodyHeight = partHeights.reduce((sum, height) => sum + height, 0) + partGaps
  return metrics.actionRowHeight + bodyHeight
}

function estimatePartHeight(part: MockPart, width: number, metrics: TurnHeightMetrics): number {
  switch (part.type) {
    case "text":
      return estimateTextPartHeight(part, width, metrics)
    case "reasoning":
      return estimateReasoningPartHeight(part, width, metrics)
    case "tool":
      return estimateToolPartHeight(part, width, metrics)
    case "trace":
      return estimatePlainCardHeight(part.text || part.traceTitle || "", width, 42, metrics)
    case "session":
      return estimatePlainCardHeight(part.sessionSummary || part.sessionTitle || "", width, 44, metrics)
    case "remote_status":
      return 42
    case "terminal":
      return 34 + estimateCodeHeight(part.terminalContent || "", width, metrics, 88, 220)
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

function estimateTextPartHeight(part: MockPart, width: number, metrics: TurnHeightMetrics): number {
  if (part.textFormat === "markdown") {
    return estimateMarkdownTextHeight(part.text || "", width, metrics)
  }
  return estimatePlainTextHeight(part.text || "", width, {
    font: metrics.font,
    lineHeight: metrics.lineHeight,
    whiteSpace: "pre-wrap",
    minLines: 1,
  })
}

function estimateReasoningPartHeight(part: MockPart, width: number, metrics: TurnHeightMetrics): number {
  const headerHeight = 38
  const text = part.reasoningText || ""
  if (!text) return headerHeight
  return headerHeight + Math.min(220, estimateMarkdownTextHeight(text, width, metrics))
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

function estimateToolPartHeight(part: MockPart, width: number, metrics: TurnHeightMetrics): number {
  if (isShellToolName(part.tool, part.toolSource)) {
    return estimateShellToolHeight(part, width, metrics)
  }

  const headerHeight = 38
  if (!isExpandableToolOpen(part.status)) return headerHeight

  const inputHeight = part.toolInput && Object.keys(part.toolInput).length > 0
    ? 24 + estimateCodeHeight(formatJson(part.toolInput), width, metrics, 34, 180)
    : 0
  const outputText = part.toolOutput || ""
  const outputHeight = outputText
    ? 24 + (part.toolOutputFormat === "markdown"
      ? estimateMarkdownTextHeight(outputText, width, metrics)
      : estimateCodeHeight(outputText, width, metrics, 34, 260))
    : 0
  const approvalHeight = part.approvalId ? 92 : 0
  const metadataHeight = part.toolResultMeta && Object.keys(part.toolResultMeta).length > 0
    ? 24 + estimateCodeHeight(formatJson(part.toolResultMeta), width, metrics, 34, 160)
    : 0

  return headerHeight + 26 + inputHeight + outputHeight + approvalHeight + metadataHeight
}

function estimateShellToolHeight(part: MockPart, width: number, metrics: TurnHeightMetrics): number {
  const headerHeight = 38
  if (!isShellToolOpen(part.status)) return headerHeight

  const outputText = buildShellOutputText(part.toolOutputChunks) || part.toolOutput || part.toolFinalOutput || ""
  const terminalHeight = estimateCodeHeight(outputText, width, metrics, 88, 360)
  const approvalHeight = part.approvalId ? 32 : 0
  const detailsHintHeight = part.toolResultMeta || part.toolFinalOutput ? 26 : 0
  return headerHeight + 26 + 30 + approvalHeight + terminalHeight + detailsHintHeight
}

function estimateStructuredCardHeight(part: MockPart, width: number, metrics: TurnHeightMetrics): number {
  const summary = stringPayload(part.viewPayload?.markdown || part.viewPayload?.content || part.viewPayload?.message) ||
    stringPayload(part.contextPayload?.markdown || part.contextPayload?.content || part.contextPayload?.message) ||
    stringPayload(part.memoryPayload?.rendered_context || part.memoryPayload?.message) ||
    stringPayload(part.uiEventPayload?.markdown || part.uiEventPayload?.content || part.uiEventPayload?.message)

  return 38 + (summary ? estimateMarkdownTextHeight(summary, width, metrics) : 0)
}

function estimateParallelHeight(part: MockPart, width: number, metrics: TurnHeightMetrics): number {
  const items = part.parallelItems || []
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
  return ["pending", "running", "awaiting_approval", "denied", "error", "cancelled"].includes(status || "")
}

function isShellToolOpen(status?: string): boolean {
  return ["pending", "running", "awaiting_approval", "approved", "denied", "error", "cancelled"].includes(status || "")
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
      parts: message.parts.map(partDigestSource),
    })),
  })
}

function partDigestSource(part: MockPart): Record<string, unknown> {
  return {
    id: part.id,
    type: part.type,
    text: part.text,
    textFormat: part.textFormat,
    reasoningText: part.reasoningText,
    reasoningFormat: part.reasoningFormat,
    tool: part.tool,
    toolSource: part.toolSource,
    toolInput: part.toolInput,
    toolOutput: part.toolOutput,
    toolOutputFormat: part.toolOutputFormat,
    toolOutputChunks: part.toolOutputChunks,
    toolFinalOutput: part.toolFinalOutput,
    status: part.status,
    terminalContent: part.terminalContent,
    viewPayload: part.viewPayload,
    contextPayload: part.contextPayload,
    memoryPayload: part.memoryPayload,
    uiEventPayload: part.uiEventPayload,
    parallelItems: part.parallelItems?.map(partDigestSource),
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
