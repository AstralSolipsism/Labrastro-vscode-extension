export const ROOT_BRANCH_BASE_SESSION_ITEM_ID = "__root__"

export interface ChatBranchSummary {
  branchBindingId: string
  bindingId?: string
  agentRunId?: string
  parentBranchBindingId?: string
  baseSessionItemId: string
  sourceAgentRunId?: string
  targetAgentRunId?: string
  selected: boolean
  status?: string
  hasUpdates?: boolean
  lastSeq?: number
  lastEventAt?: string
  pendingApprovalCount?: number
  pendingUserInputCount?: number
  currentIndex: number
  totalSiblingCount: number
}

export function normalizeBranchSummaries(value: unknown): ChatBranchSummary[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    const record = objectValue(item)
    const branchBindingId =
      stringValue(record.branch_binding_id) ||
      stringValue(record.branchBindingId) ||
      stringValue(record.binding_id) ||
      stringValue(record.bindingId)
    if (!branchBindingId) return []
    const baseSessionItemId =
      stringValue(record.base_session_item_id) ||
      stringValue(record.baseSessionItemId) ||
      ROOT_BRANCH_BASE_SESSION_ITEM_ID
    const totalSiblingCount =
      positiveInteger(record.total_sibling_count) ??
      positiveInteger(record.totalSiblingCount) ??
      1
    const currentIndex =
      positiveInteger(record.current_index) ??
      positiveInteger(record.currentIndex) ??
      1
    const bindingId = stringValue(record.binding_id) || stringValue(record.bindingId)
    const agentRunId = stringValue(record.agent_run_id) || stringValue(record.agentRunId)
    const parentBranchBindingId =
      stringValue(record.parent_branch_binding_id) ||
      stringValue(record.parentBranchBindingId)
    const sourceAgentRunId = stringValue(record.source_agent_run_id) || stringValue(record.sourceAgentRunId)
    const targetAgentRunId = stringValue(record.target_agent_run_id) || stringValue(record.targetAgentRunId)
    const status = stringValue(record.status)
    const hasUpdates = booleanValue(record.has_updates) ?? booleanValue(record.hasUpdates)
    const lastSeq = numberValue(record.last_seq) ?? numberValue(record.lastSeq)
    const lastEventAt = stringValue(record.last_event_at) || stringValue(record.lastEventAt)
    const pendingApprovalCount =
      nonNegativeInteger(record.pending_approval_count) ??
      nonNegativeInteger(record.pendingApprovalCount)
    const pendingUserInputCount =
      nonNegativeInteger(record.pending_user_input_count) ??
      nonNegativeInteger(record.pendingUserInputCount)
    const summary: ChatBranchSummary = {
      branchBindingId,
      baseSessionItemId,
      selected: booleanValue(record.selected) ?? false,
      currentIndex,
      totalSiblingCount,
      ...(bindingId ? { bindingId } : {}),
      ...(agentRunId ? { agentRunId } : {}),
      ...(parentBranchBindingId ? { parentBranchBindingId } : {}),
      ...(sourceAgentRunId ? { sourceAgentRunId } : {}),
      ...(targetAgentRunId ? { targetAgentRunId } : {}),
      ...(status ? { status } : {}),
      ...(hasUpdates !== undefined ? { hasUpdates } : {}),
      ...(lastSeq !== undefined ? { lastSeq } : {}),
      ...(lastEventAt ? { lastEventAt } : {}),
      ...(pendingApprovalCount !== undefined ? { pendingApprovalCount } : {}),
      ...(pendingUserInputCount !== undefined ? { pendingUserInputCount } : {}),
    }
    return [summary]
  })
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return undefined
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined
}

function positiveInteger(value: unknown): number | undefined {
  const parsed = numberValue(value)
  return parsed !== undefined && Number.isInteger(parsed) && parsed > 0 ? parsed : undefined
}

function nonNegativeInteger(value: unknown): number | undefined {
  const parsed = numberValue(value)
  return parsed !== undefined && Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined
}
