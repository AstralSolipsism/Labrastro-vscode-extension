import { describe, expect, it } from "vitest"

import type { SelectedMainlineSnapshot } from "./SessionRunCoordinator"
import { resolveSessionRunSourceIdentity } from "./SessionRunSourceIdentityResolver"

const selectedMainlineSnapshot = (overrides: Partial<SelectedMainlineSnapshot> = {}): SelectedMainlineSnapshot => ({
  sessionRunId: "run-current",
  sessionId: "session-current",
  cursor: 12,
  status: "running",
  agentRunId: "agent-main",
  branchBindingId: "main",
  startedAt: "2026-06-18T00:00:00.000Z",
  reconnectAttempts: 0,
  branches: [
    { branch_binding_id: "main", agent_run_id: "agent-main", selected: true },
    { branch_binding_id: "branch-a", agent_run_id: "agent-branch-a", selected: false },
  ],
  ...overrides,
})

describe("resolveSessionRunSourceIdentity", () => {
  it("resolves selected visible source from explicit session run proof", () => {
    const result = resolveSessionRunSourceIdentity({
      selectedMainlineSnapshot: selectedMainlineSnapshot(),
      sourceIdentityRevision: 7,
      sessionRunId: "run-current",
      branchBindingId: "main",
      scope: "selected-visible",
    })

    expect(result).toEqual({
      ok: true,
      value: expect.objectContaining({
        targetBranchBindingId: "main",
        selectedBranch: true,
        scope: "selected-visible",
        emitWebviewOperation: true,
        canPatchSelectedRun: true,
        source: {
          sessionRunId: "run-current",
          branchBindingId: "main",
          agentRunId: "agent-main",
          sourceIdentityRevision: 7,
        },
      }),
    })
  })

  it("rejects selected-visible source without an explicit session run id", () => {
    const result = resolveSessionRunSourceIdentity({
      selectedMainlineSnapshot: selectedMainlineSnapshot(),
      sourceIdentityRevision: 7,
      branchBindingId: "main",
      scope: "selected-visible",
    })

    expect(result).toEqual(expect.objectContaining({
      ok: false,
      targetBranchBindingId: "main",
    }))
  })

  it("resolves branch-local source from branch summaries without borrowing selected identity revision", () => {
    const result = resolveSessionRunSourceIdentity({
      selectedMainlineSnapshot: selectedMainlineSnapshot({ branchBindingId: "branch-b", agentRunId: "agent-branch-b" }),
      sourceIdentityRevision: 9,
      sessionRunId: "run-current",
      branchBindingId: "branch-a",
      scope: "branch-local",
    })

    expect(result).toEqual({
      ok: true,
      value: expect.objectContaining({
        targetBranchBindingId: "branch-a",
        selectedBranch: false,
        scope: "branch-local",
        emitWebviewOperation: false,
        canPatchSelectedRun: false,
        source: {
          sessionRunId: "run-current",
          branchBindingId: "branch-a",
          agentRunId: "agent-branch-a",
          sourceIdentityRevision: 0,
        },
      }),
    })
  })

  it("rejects selected-visible source when the target is a sibling branch", () => {
    const result = resolveSessionRunSourceIdentity({
      selectedMainlineSnapshot: selectedMainlineSnapshot(),
      sourceIdentityRevision: 1,
      branchBindingId: "branch-a",
      scope: "selected-visible",
    })

    expect(result).toEqual(expect.objectContaining({
      ok: false,
      targetBranchBindingId: "branch-a",
      sourceBranchBindingId: "main",
    }))
  })

  it("rejects selected-visible source without explicit branch proof", () => {
    const result = resolveSessionRunSourceIdentity({
      selectedMainlineSnapshot: selectedMainlineSnapshot(),
      sourceIdentityRevision: 1,
      scope: "selected-visible",
    })

    expect(result).toEqual(expect.objectContaining({
      ok: false,
      sourceBranchBindingId: "main",
      targetBranchBindingId: "",
    }))
  })

  it("rejects branch-local source when the branch agent id is unavailable", () => {
    const result = resolveSessionRunSourceIdentity({
      selectedMainlineSnapshot: selectedMainlineSnapshot({ branches: [{ branch_binding_id: "branch-a" }] }),
      sourceIdentityRevision: 1,
      branchBindingId: "branch-a",
      scope: "branch-local",
    })

    expect(result).toEqual(expect.objectContaining({
      ok: false,
      targetBranchBindingId: "branch-a",
    }))
  })

  it("rejects branch-local source for another session run", () => {
    const result = resolveSessionRunSourceIdentity({
      selectedMainlineSnapshot: selectedMainlineSnapshot(),
      sourceIdentityRevision: 1,
      sessionRunId: "run-other",
      branchBindingId: "branch-a",
      scope: "branch-local",
    })

    expect(result).toEqual(expect.objectContaining({
      ok: false,
      sessionRunId: "run-other",
      targetBranchBindingId: "branch-a",
    }))
  })

  it("rejects branch-local source without an explicit session run id", () => {
    const result = resolveSessionRunSourceIdentity({
      selectedMainlineSnapshot: selectedMainlineSnapshot(),
      sourceIdentityRevision: 1,
      branchBindingId: "branch-a",
      scope: "branch-local",
    })

    expect(result).toEqual(expect.objectContaining({
      ok: false,
      targetBranchBindingId: "branch-a",
    }))
  })

  it("rejects branch-local source without an explicit branch binding id", () => {
    const result = resolveSessionRunSourceIdentity({
      selectedMainlineSnapshot: selectedMainlineSnapshot(),
      sourceIdentityRevision: 1,
      sessionRunId: "run-current",
      scope: "branch-local",
    })

    expect(result).toEqual(expect.objectContaining({
      ok: false,
      sessionRunId: "run-current",
      sourceBranchBindingId: "main",
      targetBranchBindingId: "",
    }))
  })
})
