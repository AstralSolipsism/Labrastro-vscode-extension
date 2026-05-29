import { describe, expect, it } from "vitest"
import {
  markApprovalSubmitFailed,
  markApprovalSubmitting,
  markApprovalSubmitSucceeded,
  mergeStatusApprovals,
  type ApprovalSubmissionFields,
  type RecoverablePendingApproval,
} from "./approval-state"

interface TestApproval extends RecoverablePendingApproval, ApprovalSubmissionFields {}

const approval = (id = "approval-1"): TestApproval => ({
  approvalId: id,
  sessionRunId: "chat-1",
  toolName: "shell",
  toolArgs: {},
  sections: [],
})

describe("approval-state", () => {
  it("keeps an approval visible while its decision is submitting", () => {
    const next = markApprovalSubmitting([approval()], "approval-1", "allow_once")

    expect(next).toMatchObject([
      {
        approvalId: "approval-1",
        sessionRunId: "chat-1",
        toolName: "shell",
        submittedDecision: "allow_once",
        submissionState: "submitting",
        submissionError: undefined,
      },
    ])
  })

  it("keeps a failed approval visible and retryable", () => {
    const submitting = markApprovalSubmitting([approval()], "approval-1", "allow_once")

    const next = markApprovalSubmitFailed(submitting, "approval-1", "fetch failed")

    expect(next).toMatchObject([
      {
        approvalId: "approval-1",
        sessionRunId: "chat-1",
        toolName: "shell",
        submittedDecision: "allow_once",
        submissionState: "submit_failed",
        submissionError: "fetch failed",
      },
    ])
  })

  it("removes a successfully submitted approval and keeps other approvals", () => {
    const next = markApprovalSubmitSucceeded(
      [approval("approval-1"), approval("approval-2")],
      "approval-1",
    )

    expect(next).toMatchObject([
      {
        approvalId: "approval-2",
        sessionRunId: "chat-1",
        toolName: "shell",
      },
    ])
  })

  it("restores pending approvals from status payload as actionable approvals", () => {
    const failed = markApprovalSubmitFailed(
      markApprovalSubmitting([approval()], "approval-1", "allow_once"),
      "approval-1",
      "fetch failed",
    )

    const next = mergeStatusApprovals(
      failed,
      [
        {
          approval_id: "approval-1",
          tool_name: "shell",
          tool_args: { command: "echo hi" },
          state: "requested",
        },
        {
          approval_id: "approval-2",
          tool_name: "edit_file",
          state: "requested",
        },
      ],
      "chat-1",
    )

    expect(next).toMatchObject([
      {
        approvalId: "approval-1",
        sessionRunId: "chat-1",
        toolName: "shell",
        submissionState: undefined,
        submissionError: undefined,
        submittedDecision: undefined,
      },
      {
        approvalId: "approval-2",
        sessionRunId: "chat-1",
        toolName: "edit_file",
      },
    ])
  })
})
