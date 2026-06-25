import { describe, expect, it } from "vitest"
import { resolveSessionSubmitDisposition, sessionSubmitBlockedMessage } from "./sessionSubmitDisposition"

const base = {
  hasText: true,
  activeSessionRunId: "run-1",
  selectedBranchBindingId: "main",
  currentRunSessionMatches: true,
  serverEventStreamStatus: "idle" as const,
}

describe("resolveSessionSubmitDisposition", () => {
  it("starts when there is no active SessionRun", () => {
    expect(resolveSessionSubmitDisposition({
      ...base,
      activeSessionRunId: undefined,
      selectedRuntimeStatus: "idle",
    }).kind).toBe("start")
  })

  it("blocks while the first SessionRun start is still in flight", () => {
    expect(resolveSessionSubmitDisposition({
      ...base,
      activeSessionRunId: undefined,
      selectedRuntimeStatus: "idle",
      startInFlight: true,
    })).toMatchObject({
      kind: "blocked",
      reason: "session_run_start_pending",
      proof: expect.objectContaining({
        startInFlight: true,
      }),
    })
  })

  it("continues only when the selected mainline is settled and continuable", () => {
    expect(resolveSessionSubmitDisposition({
      ...base,
      selectedRuntimeStatus: "done",
      mainlineState: "settled",
      activationState: "completed",
      bindingStatus: "active",
      working: false,
      continuable: true,
      eventStreamAllowed: false,
      projectionState: "drained",
      transportState: "disconnected",
    })).toMatchObject({
      kind: "continue",
      reason: "selected_branch_settled",
      proof: expect.objectContaining({
        mainlineState: "settled",
        activationState: "completed",
        continuable: true,
        eventStreamAllowed: false,
      }),
    })
  })

  it("continues after the current activation was stopped but the mainline remains continuable", () => {
    expect(resolveSessionSubmitDisposition({
      ...base,
      selectedRuntimeStatus: "done",
      mainlineState: "settled",
      activationState: "cancelled",
      bindingStatus: "active",
      working: false,
      continuable: true,
      recoverable: true,
      eventStreamAllowed: false,
      projectionState: "drained",
      transportState: "disconnected",
    })).toMatchObject({
      kind: "continue",
      reason: "selected_branch_settled",
      proof: expect.objectContaining({
        mainlineState: "settled",
        activationState: "cancelled",
        continuable: true,
      }),
    })
  })

  it("blocks closed or failed selected mainlines instead of silently starting or continuing", () => {
    for (const selectedRuntimeStatus of ["cancelled", "error", "interrupted"] as const) {
      expect(resolveSessionSubmitDisposition({
        ...base,
        selectedRuntimeStatus,
      })).toMatchObject({
        kind: "blocked",
        reason: "start_new_task_required",
      })
    }
    expect(resolveSessionSubmitDisposition({
      ...base,
      selectedRuntimeStatus: "cancelled",
      mainlineState: "cancelled",
      activationState: "cancelled",
      bindingStatus: "closed",
      recoverable: false,
      continuable: false,
      eventStreamAllowed: false,
      projectionState: "nonrecoverable",
    })).toMatchObject({
      kind: "blocked",
      reason: "start_new_task_required",
    })
    expect(resolveSessionSubmitDisposition({
      ...base,
      selectedRuntimeStatus: "error",
      mainlineState: "unrecoverable",
      activationState: "failed",
      bindingStatus: "closed",
      recoverable: false,
      continuable: false,
      eventStreamAllowed: false,
      projectionState: "nonrecoverable",
    })).toMatchObject({
      kind: "blocked",
      reason: "nonrecoverable",
    })
  })

  it("queues next-turn input while the selected branch cannot accept continuation", () => {
    for (const selectedRuntimeStatus of [
      "queued",
      "running",
      "waiting",
      "stopping",
    ] as const) {
      expect(resolveSessionSubmitDisposition({
        ...base,
        selectedRuntimeStatus,
      })).toMatchObject({
        kind: "queue_next_turn",
        reason: "selected_branch_not_accepting_continuation",
      })
    }
  })

  it("does not queue a settled branch for scoped reconnecting transport without executing activation", () => {
    expect(resolveSessionSubmitDisposition({
      ...base,
      selectedRuntimeStatus: "done",
      serverEventStreamStatus: "reconnecting",
      serverEventStreamSessionRunId: "run-1",
      serverEventStreamBranchBindingId: "main",
    })).toMatchObject({
      kind: "continue",
      proof: expect.objectContaining({
        serverEventStreamStatus: "reconnecting",
        serverEventStreamApplies: true,
        activationState: "completed",
        eventStreamAllowed: false,
      }),
    })
  })

  it("does not queue a settled branch for unscoped server event-stream connecting state", () => {
    expect(resolveSessionSubmitDisposition({
      ...base,
      selectedRuntimeStatus: "done",
      serverEventStreamStatus: "connecting",
    })).toMatchObject({
      kind: "continue",
      proof: expect.objectContaining({
        serverEventStreamApplies: false,
      }),
    })
  })

  it("queues current-activation intent while the branch is running", () => {
    expect(resolveSessionSubmitDisposition({
      ...base,
      selectedRuntimeStatus: "running",
      intent: "current_activation",
    }).kind).toBe("queue_next_turn")

    expect(resolveSessionSubmitDisposition({
      ...base,
      selectedRuntimeStatus: "done",
      intent: "current_activation",
    }).kind).toBe("continue")
  })

  it("blocks waiting-user and repair states for the normal composer path", () => {
    expect(resolveSessionSubmitDisposition({
      ...base,
      selectedRuntimeStatus: "waiting",
      mainlineState: "waiting_user",
      activationState: "waiting_user",
      bindingStatus: "active",
      working: false,
      continuable: false,
      recoverable: true,
      eventStreamAllowed: false,
    })).toMatchObject({
      kind: "blocked",
      reason: "waiting_user_action",
    })

    expect(resolveSessionSubmitDisposition({
      ...base,
      selectedRuntimeStatus: "error",
      mainlineState: "blocked",
      activationState: "failed",
      bindingStatus: "active",
      working: false,
      continuable: false,
      recoverable: true,
      eventStreamAllowed: false,
    })).toMatchObject({
      kind: "blocked",
      reason: "repair_required",
    })
  })

  it("blocks when another run is active but not the visible selected branch", () => {
    expect(resolveSessionSubmitDisposition({
      ...base,
      selectedRuntimeStatus: "running",
      currentRunSessionMatches: false,
    })).toMatchObject({
      kind: "blocked",
      reason: "active_run_not_visible",
    })
  })
})

describe("sessionSubmitBlockedMessage", () => {
  it("describes cancelled or closed mainlines without claiming the task is still running", () => {
    expect(sessionSubmitBlockedMessage("start_new_task_required")).toBe("当前任务已结束或取消，请先明确开启新任务。")
    expect(sessionSubmitBlockedMessage("start_new_task_required")).not.toContain("仍在运行")
  })

  it("keeps running-only wording out of generic blocked submit feedback", () => {
    expect(sessionSubmitBlockedMessage("active_run_not_visible")).toBe("当前可继续主线不属于正在查看的会话。")
    expect(sessionSubmitBlockedMessage("selected_mainline_state_missing")).toBe("当前会话运行状态不接受普通输入。")
  })
})
