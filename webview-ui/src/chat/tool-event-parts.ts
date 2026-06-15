import type { CapabilityTarget, ToolActivityItem, TranscriptItem } from "../components/chat/transcript-model"
import type { ToolExecutionStatus } from "../types/trace"

const PRESERVED_AFTER_RETURN = new Set(["denied", "cancelled", "protocol_error"])
const AUTO_APPROVAL_DECISIONS = new Set(["auto_denied", "auto_approved"])

export function requiredToolCallId(payload: Record<string, unknown>): string | undefined {
  const value = payload.tool_call_id
  if (typeof value === "string") {
    const trimmed = value.trim()
    return trimmed || undefined
  }
  if (typeof value === "number" && Number.isFinite(value)) return String(value)
  return undefined
}

export function resolveToolPartIndexForReturn(
  parts: readonly TranscriptItem[],
  _toolName: string,
  toolCallId?: string,
): number {
  if (!toolCallId) return -1
  const index = parts.findIndex((part) => part.type === "tool" && part.toolCallId === toolCallId)
  return index >= 0 ? index : -1
}

export function resolveActiveToolPartIndex(
  parts: readonly TranscriptItem[],
  _toolName: string,
  toolCallId?: string,
): number {
  if (!toolCallId) return -1
  const index = parts.findIndex((part) => part.type === "tool" && part.toolCallId === toolCallId)
  return index >= 0 ? index : -1
}

export function upsertToolPartInParts(
  parts: readonly TranscriptItem[],
  toolName: string,
  patch: Partial<ToolActivityItem>,
  options: { fallbackId?: string; matchReturn?: boolean; now?: number } = {},
): TranscriptItem[] {
  const toolCallId = patch.toolCallId || options.fallbackId
  if (!toolCallId) return [...parts]
  const index = options.matchReturn
    ? resolveToolPartIndexForReturn(parts, toolName, toolCallId)
    : resolveActiveToolPartIndex(parts, toolName, toolCallId)
  const id = index >= 0
    ? parts[index].id
    : `tool-${toolCallId || `${toolName}-${options.now ?? Date.now()}-${parts.length}`}`
  const current: ToolActivityItem = index >= 0 ? parts[index] as ToolActivityItem : {
    id,
    type: "tool",
    tool: toolName,
    toolCallId,
    status: "running",
    output: "",
  }
  const definedPatch = Object.fromEntries(
    Object.entries(patch).filter(([, value]) => value !== undefined)
  ) as Partial<ToolActivityItem>
  const rawEventRefs = mergeRawEventRefs(current.rawEventRefs, definedPatch.rawEventRefs)
  const next = {
    ...current,
    ...definedPatch,
    ...(rawEventRefs ? { rawEventRefs } : {}),
    id,
    type: "tool",
    tool: toolName,
  } as ToolActivityItem
  if (index < 0) return [...parts, next]
  const updated = [...parts]
  updated[index] = next
  return updated
}

export function toolSpecPatch(payload: Record<string, unknown>): Partial<ToolActivityItem> {
  const toolId = stringValue(payload.tool_id) || stringValue(payload.toolId)
  const risk = stringValue(payload.risk)
  const exposure = stringValue(payload.exposure)
  const capabilityName = stringValue(payload.capability_name) || stringValue(payload.capabilityName)
  return {
    ...(toolId ? { toolId } : {}),
    ...(risk ? { risk } : {}),
    ...(exposure ? { exposure } : {}),
    ...(capabilityName ? { capabilityName } : {}),
  }
}

export function capabilityTargetPatch(payload: Record<string, unknown>): Partial<ToolActivityItem> {
  const capabilityTarget = capabilityTargetFromPayload(payload)
  if (!capabilityTarget) return {}
  return {
    capabilityRole: "target",
    capabilityTarget,
    ...(capabilityTarget.targetToolId ? { toolId: capabilityTarget.targetToolId } : {}),
    ...(capabilityTarget.targetRisk ? { risk: capabilityTarget.targetRisk } : {}),
    ...(capabilityTarget.targetExposure ? { exposure: capabilityTarget.targetExposure } : {}),
  }
}

export function toolTracePatch(resultMeta: Record<string, unknown>): Partial<ToolActivityItem> {
  const searchTrace = objectValue(resultMeta.search_trace ?? resultMeta.searchTrace)
  const executeTrace = objectValue(resultMeta.execute_trace ?? resultMeta.executeTrace)
  const targetToolId = stringValue(executeTrace.target_tool_id) || stringValue(executeTrace.targetToolId)
  const targetToolName = stringValue(executeTrace.target_tool_name) || stringValue(executeTrace.targetToolName)
  return {
    ...(Object.keys(searchTrace).length > 0 ? { searchTrace } : {}),
    ...(Object.keys(executeTrace).length > 0 ? { executeTrace } : {}),
    ...(targetToolId || targetToolName ? { capabilityRole: "gateway" as const } : {}),
  }
}

export function capabilityTargetToolName(payload: Record<string, unknown>, fallback = "tool"): string {
  return capabilityTargetFromPayload(payload)?.targetToolName || String(payload.tool_name || fallback)
}

export function capabilityTargetToolCallId(payload: Record<string, unknown>): string | undefined {
  return capabilityTargetFromPayload(payload)?.targetToolCallId || requiredToolCallId(payload)
}

export function capabilityTargetArguments(payload: Record<string, unknown>): Record<string, unknown> {
  return capabilityTargetFromPayload(payload)?.targetArguments || objectValue(payload.tool_args)
}

function capabilityTargetFromPayload(payload: Record<string, unknown>): CapabilityTarget | undefined {
  const direct = objectValue(payload.capability_target ?? payload.capabilityTarget)
  const meta = objectValue(payload.meta)
  const nested = objectValue(meta.capability_target ?? meta.capabilityTarget)
  const raw = Object.keys(direct).length > 0 ? direct : nested
  if (!Object.keys(raw).length) return undefined
  const target: CapabilityTarget = {
    parentToolCallId: stringValue(raw.parent_tool_call_id) || stringValue(raw.parentToolCallId),
    gatewayToolName: stringValue(raw.gateway_tool_name) || stringValue(raw.gatewayToolName),
    targetToolCallId: stringValue(raw.target_tool_call_id) || stringValue(raw.targetToolCallId),
    targetToolId: stringValue(raw.target_tool_id) || stringValue(raw.targetToolId),
    targetToolName: stringValue(raw.target_tool_name) || stringValue(raw.targetToolName),
    targetArguments: objectValue(raw.target_arguments ?? raw.targetArguments),
    targetExposure: stringValue(raw.target_exposure) || stringValue(raw.targetExposure),
    targetRisk: stringValue(raw.target_risk) || stringValue(raw.targetRisk),
    targetPermissionPolicy: stringValue(raw.target_permission_policy) || stringValue(raw.targetPermissionPolicy),
  }
  return Object.fromEntries(
    Object.entries(target).filter(([, value]) => {
      if (value === undefined) return false
      if (typeof value === "object" && !Array.isArray(value)) return Object.keys(value).length > 0
      return true
    }),
  ) as CapabilityTarget
}

function mergeRawEventRefs(
  current: ToolActivityItem["rawEventRefs"],
  incoming: ToolActivityItem["rawEventRefs"],
): ToolActivityItem["rawEventRefs"] {
  if (!current?.length && !incoming?.length) return undefined
  const merged: NonNullable<ToolActivityItem["rawEventRefs"]> = []
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

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}
