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
  sessionRunId: "run-1",
  branchBindingId: "branch-a",
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
        sessionRunId: "run-1",
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
        sessionRunId: "run-1",
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
        sessionRunId: "run-1",
        toolName: "shell",
      },
    ])
  })

  it("removes a successfully submitted approval only from the targeted branch", () => {
    const next = markApprovalSubmitSucceeded(
      [
        approval("approval-1"),
        {
          ...approval("approval-1"),
          branchBindingId: "branch-b",
        },
      ],
      "approval-1",
      "run-1",
      "branch-a",
    )

    expect(next).toMatchObject([
      {
        approvalId: "approval-1",
        sessionRunId: "run-1",
        branchBindingId: "branch-b",
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
          tool_name: "apply_patch",
          state: "requested",
        },
      ],
      "run-1",
    )

    expect(next).toMatchObject([
      {
        approvalId: "approval-1",
        sessionRunId: "run-1",
        toolName: "shell",
        submissionState: undefined,
        submissionError: undefined,
        submittedDecision: undefined,
      },
      {
        approvalId: "approval-2",
        sessionRunId: "run-1",
        toolName: "apply_patch",
      },
    ])
  })

  it("merges status approvals only into the targeted branch", () => {
    const branchB = {
      ...approval("approval-1"),
      branchBindingId: "branch-b",
      toolName: "apply_patch",
    }

    const next = mergeStatusApprovals(
      [branchB],
      [
        {
          approval_id: "approval-1",
          branch_binding_id: "branch-a",
          tool_name: "shell",
          state: "requested",
        },
      ],
      "run-1",
      "branch-a",
    )

    expect(next).toEqual(expect.arrayContaining([
      expect.objectContaining({
        approvalId: "approval-1",
        sessionRunId: "run-1",
        branchBindingId: "branch-a",
        toolName: "shell",
      }),
      expect.objectContaining({
        approvalId: "approval-1",
        sessionRunId: "run-1",
        branchBindingId: "branch-b",
        toolName: "apply_patch",
      }),
    ]))
  })

  it("treats an empty status approval list as authoritative only for the targeted branch", () => {
    const next = mergeStatusApprovals(
      [
        approval("approval-a"),
        {
          ...approval("approval-b"),
          branchBindingId: "branch-b",
        },
      ],
      [],
      "run-1",
      "branch-a",
    )

    expect(next).toMatchObject([
      {
        approvalId: "approval-b",
        sessionRunId: "run-1",
        branchBindingId: "branch-b",
      },
    ])
  })
})
