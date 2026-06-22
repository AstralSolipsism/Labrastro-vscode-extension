import {
  approvalFromPayload,
  type ApprovalDecision,
  type ApprovalDetails,
} from "../components/chat/approval-details"

export type ApprovalSubmissionState = "submitting" | "submit_failed"

export interface ApprovalSubmissionFields {
  approvalId: string
  submittedDecision?: ApprovalDecision
  submissionState?: ApprovalSubmissionState
  submissionError?: string
}

export interface RecoverablePendingApproval extends ApprovalDetails, ApprovalSubmissionFields {
  sessionRunId: string
}

export function markApprovalSubmitting<T extends ApprovalSubmissionFields>(
  items: T[],
  approvalId: string,
  decision: ApprovalDecision,
  sessionRunId?: string,
  branchBindingId?: string,
): T[] {
  return items.map((item) =>
    approvalMatches(item, approvalId, sessionRunId, branchBindingId)
      ? {
          ...item,
          submittedDecision: decision,
          submissionState: "submitting",
          submissionError: undefined,
        }
      : item
  )
}

export function markApprovalSubmitFailed<T extends ApprovalSubmissionFields>(
  items: T[],
  approvalId: string,
  error: string,
  sessionRunId?: string,
  branchBindingId?: string,
): T[] {
  return items.map((item) =>
    approvalMatches(item, approvalId, sessionRunId, branchBindingId)
      ? {
          ...item,
          submissionState: "submit_failed",
          submissionError: error || "approval reply failed",
        }
      : item
  )
}

export function markApprovalSubmitSucceeded<T extends ApprovalSubmissionFields>(
  items: T[],
  approvalId: string,
  sessionRunId?: string,
  branchBindingId?: string,
): T[] {
  return items.filter((item) => !approvalMatches(item, approvalId, sessionRunId, branchBindingId))
}

export function mergeStatusApprovals<T extends RecoverablePendingApproval>(
  items: T[],
  statusApprovals: unknown[],
  sessionRunId: string,
  branchBindingId?: string,
): T[] {
  if (!branchBindingId) return items
  const next = items.filter((item) => {
    if (item.sessionRunId !== sessionRunId) return true
    return item.branchBindingId !== branchBindingId
  })
  for (const raw of statusApprovals) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue
    const payload = raw as Record<string, unknown>
    if (payload.state && payload.state !== "requested") continue
    const approval = approvalFromPayload(payload)
    if (!approval.approvalId) continue
    const restoredBranchBindingId: string = approval.branchBindingId || branchBindingId
    if (restoredBranchBindingId !== branchBindingId) continue
    const restored = {
      ...approval,
      sessionRunId,
      branchBindingId: restoredBranchBindingId,
      submittedDecision: undefined,
      submissionState: undefined,
      submissionError: undefined,
    } as T
    const index = next.findIndex((item) =>
      approvalMatches(
        item,
        restored.approvalId,
        sessionRunId,
        restoredBranchBindingId,
      )
    )
    if (index < 0) {
      next.push(restored)
    } else {
      next[index] = {
        ...next[index],
        ...restored,
      }
    }
  }
  return next
}

function approvalMatches(
  item: ApprovalSubmissionFields,
  approvalId: string,
  sessionRunId?: string,
  branchBindingId?: string,
): boolean {
  if (!sessionRunId || !branchBindingId) return false
  if (item.approvalId !== approvalId) return false
  const itemWithRun = item as ApprovalSubmissionFields & { sessionRunId?: string; branchBindingId?: string }
  if (itemWithRun.sessionRunId !== sessionRunId) return false
  if (itemWithRun.branchBindingId !== branchBindingId) return false
  return true
}
