import { describe, expect, it } from "vitest"
import {
  ROOT_BRANCH_BASE_SESSION_ITEM_ID,
  normalizeBranchSummaries,
} from "./branchSummaries"

describe("branch summaries", () => {
  it("normalizes snake_case branch projection summaries for chat controls", () => {
    expect(normalizeBranchSummaries([
      {
        branch_binding_id: "branch-2",
        base_session_item_id: "session-item-1",
        agent_run_id: "agent-run-2",
        selected: true,
        has_updates: false,
        current_index: 2,
        total_sibling_count: 3,
        pending_approval_count: 0,
      },
      { ignored: true },
    ])).toEqual([
      expect.objectContaining({
        branchBindingId: "branch-2",
        baseSessionItemId: "session-item-1",
        agentRunId: "agent-run-2",
        selected: true,
        hasUpdates: false,
        currentIndex: 2,
        totalSiblingCount: 3,
        pendingApprovalCount: 0,
      }),
    ])
  })

  it("defaults missing base anchors to the root branch sentinel", () => {
    expect(normalizeBranchSummaries([
      {
        branch_binding_id: "root-branch",
        current_index: 1,
        total_sibling_count: 2,
      },
    ])[0]).toMatchObject({
      branchBindingId: "root-branch",
      baseSessionItemId: ROOT_BRANCH_BASE_SESSION_ITEM_ID,
    })
  })
})
