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
  chatId: string
}

export function markApprovalSubmitting<T extends ApprovalSubmissionFields>(
  items: T[],
  approvalId: string,
  decision: ApprovalDecision,
): T[] {
  return items.map((item) =>
    item.approvalId === approvalId
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
): T[] {
  return items.map((item) =>
    item.approvalId === approvalId
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
): T[] {
  return items.filter((item) => item.approvalId !== approvalId)
}

export function mergeStatusApprovals<T extends RecoverablePendingApproval>(
  items: T[],
  statusApprovals: unknown[],
  chatId: string,
): T[] {
  const next = [...items]
  for (const raw of statusApprovals) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue
    const payload = raw as Record<string, unknown>
    if (payload.state && payload.state !== "requested") continue
    const approval = approvalFromPayload(payload)
    if (!approval.approvalId) continue
    const restored = {
      ...approval,
      chatId,
      submittedDecision: undefined,
      submissionState: undefined,
      submissionError: undefined,
    } as T
    const index = next.findIndex((item) => item.approvalId === approval.approvalId)
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
