import { describe, expect, it, vi } from "vitest"

import { settingsMessages, type SettingsMessagePort } from "./settingsMessages"

function port() {
  return {
    postMessage: vi.fn(),
  } satisfies SettingsMessagePort
}

describe("settingsMessages session run interaction proof", () => {
  it("emits approval replies with explicit session run and branch proof", () => {
    const settingsPort = port()

    settingsMessages.replyApproval(settingsPort, {
      sessionRunId: "run-env",
      branchBindingId: "branch-env",
      approvalId: "approval-env",
      decision: "allow_once",
    })

    expect(settingsPort.postMessage).toHaveBeenCalledWith({
      type: "approval.reply",
      sessionRunId: "run-env",
      session_run_id: "run-env",
      branchBindingId: "branch-env",
      branch_binding_id: "branch-env",
      approvalId: "approval-env",
      decision: "allow_once",
    })
  })
})
