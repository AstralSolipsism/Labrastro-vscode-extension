import type { MockPart } from "../components/chat/mock-data"
import type { ToolExecutionStatus } from "../types/trace"

const ACTIVE_TOOL_STATUSES = new Set(["pending", "running", "awaiting_approval", "approved"])
const RETURN_MERGE_TOOL_STATUSES = new Set([
  "pending",
  "running",
  "awaiting_approval",
  "approved",
  "denied",
  "cancelled",
  "protocol_error",
])
const PRESERVED_AFTER_RETURN = new Set(["denied", "cancelled", "protocol_error"])
const AUTO_APPROVAL_DECISIONS = new Set(["auto_denied", "auto_approved"])

export function resolveToolPartIndexForReturn(
  parts: readonly MockPart[],
  toolName: string,
  toolCallId?: string,
): number {
  if (toolCallId) {
    const index = parts.findIndex((part) => part.type === "tool" && part.toolCallId === toolCallId)
    if (index >= 0) return index
  }
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    const part = parts[index]
    if (part.type === "tool" && part.tool === toolName && RETURN_MERGE_TOOL_STATUSES.has(part.status || "")) {
      return index
    }
  }
  return -1
}

export function resolveActiveToolPartIndex(
  parts: readonly MockPart[],
  toolName: string,
  toolCallId?: string,
): number {
  if (toolCallId) {
    const index = parts.findIndex((part) => part.type === "tool" && part.toolCallId === toolCallId)
    if (index >= 0) return index
  }
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    const part = parts[index]
    if (part.type === "tool" && part.tool === toolName && ACTIVE_TOOL_STATUSES.has(part.status || "")) {
      return index
    }
  }
  return -1
}

export function upsertToolPartInParts(
  parts: readonly MockPart[],
  toolName: string,
  patch: Partial<MockPart>,
  options: { fallbackId?: string; matchReturn?: boolean; now?: number } = {},
): MockPart[] {
  const toolCallId = patch.toolCallId || options.fallbackId
  const index = options.matchReturn
    ? resolveToolPartIndexForReturn(parts, toolName, toolCallId)
    : resolveActiveToolPartIndex(parts, toolName, toolCallId)
  const id = index >= 0
    ? parts[index].id
    : `tool-${toolCallId || `${toolName}-${options.now ?? Date.now()}-${parts.length}`}`
  const current: MockPart = index >= 0 ? parts[index] : {
    id,
    type: "tool",
    tool: toolName,
    toolCallId,
    status: "running",
    toolOutput: "",
  }
  const definedPatch = Object.fromEntries(
    Object.entries(patch).filter(([, value]) => value !== undefined)
  ) as Partial<MockPart>
  const next = { ...current, ...definedPatch, id, type: "tool", tool: toolName } as MockPart
  if (index < 0) return [...parts, next]
  const updated = [...parts]
  updated[index] = next
  return updated
}

export function statusAfterToolReturn(currentStatus?: ToolExecutionStatus): ToolExecutionStatus {
  if (currentStatus && PRESERVED_AFTER_RETURN.has(currentStatus)) {
    return currentStatus
  }
  return "returned"
}

export function approvalDecisionAfterResolution(
  currentDecision: string | undefined,
  nextDecision: string,
): string | undefined {
  if (currentDecision && AUTO_APPROVAL_DECISIONS.has(currentDecision)) {
    return currentDecision
  }
  if (!nextDecision) return currentDecision
  return nextDecision
}

export function approvalStatusAfterResolution(
  decision: string,
  currentStatus?: ToolExecutionStatus,
): ToolExecutionStatus | undefined {
  if (decision === "allow_once") return "approved"
  if (decision === "deny_once") return "denied"
  return currentStatus
}
