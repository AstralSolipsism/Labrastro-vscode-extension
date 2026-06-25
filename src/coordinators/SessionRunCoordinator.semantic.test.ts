import { describe, expect, it, vi } from "vitest"
import {
  resolveHostSessionSubmitDisposition,
  SessionRunCoordinator,
  type SelectedMainlineSnapshot,
} from "./SessionRunCoordinator"

function coordinatorWithStoredSessionRun(stored: unknown) {
  const options = {
    client: {
      approvalReply: vi.fn(),
      recoverSessionRun: vi.fn(),
    },
    context: {
      workspaceState: {
        get: vi.fn((key: string) => key === "labrastro.selectedMainlineSnapshot" ? stored : undefined),
        update: vi.fn(),
      },
    },
    approvalDocuments: { open: vi.fn() },
    startSessionRun: vi.fn(),
    continueSessionRun: vi.fn(),
    steerAgentRun: vi.fn(),
    branchSessionRun: vi.fn(),
    selectSessionRunBranch: vi.fn(),
    stopSessionRun: vi.fn(),
    cancelSessionRun: vi.fn(),
    recoverSessionRun: vi.fn(),
    postConnectionStateIfAuthRequired: vi.fn(),
  }
  return {
    options,
    coordinator: new SessionRunCoordinator(options as unknown as ConstructorParameters<typeof SessionRunCoordinator>[0]),
  }
}

describe("SessionRunCoordinator semantic contract", () => {
  it("resolves host submit disposition from active SessionRun state", () => {
    const settledRun: SelectedMainlineSnapshot = {
      sessionRunId: "run-1",
      cursor: 4,
      branchBindingId: "main",
      status: "settled",
      mainlineState: "settled",
      activationState: "completed",
      bindingStatus: "active",
      working: false,
      continuable: true,
      recoverable: true,
      eventStreamAllowed: false,
      projectionState: "drained",
      transportState: "disconnected",
      startedAt: "2026-05-29T00:00:00.000Z",
      reconnectAttempts: 0,
    }
    const runningRun: SelectedMainlineSnapshot = {
      ...settledRun,
      status: "running",
      mainlineState: "executing",
      activationState: "running",
      working: true,
      continuable: false,
      eventStreamAllowed: true,
      projectionState: "live",
      transportState: "streaming",
    }
    const reconnectingSettledRun: SelectedMainlineSnapshot = {
      ...settledRun,
      status: "settled",
      transportState: "reconnecting",
    }
    const cancelledRun: SelectedMainlineSnapshot = {
      ...settledRun,
      status: "cancelled",
      mainlineState: "cancelled",
      activationState: "cancelled",
      bindingStatus: "closed",
      recoverable: false,
      continuable: false,
      eventStreamAllowed: false,
      projectionState: "nonrecoverable",
    }
    const stoppedActivationRun: SelectedMainlineSnapshot = {
      ...settledRun,
      status: "settled",
      mainlineState: "settled",
      activationState: "cancelled",
      bindingStatus: "active",
      working: false,
      continuable: true,
      recoverable: true,
      eventStreamAllowed: false,
      projectionState: "drained",
    }

    expect(resolveHostSessionSubmitDisposition({
      hasText: true,
      selectedMainlineSnapshot: settledRun,
      proof: { sessionRunId: "run-1", branchBindingId: "main" },
    }).kind).toBe("continue")
    expect(resolveHostSessionSubmitDisposition({
      hasText: true,
      selectedMainlineSnapshot: runningRun,
      proof: { sessionRunId: "run-1", branchBindingId: "main" },
    }).kind).toBe("queue_next_turn")
    expect(resolveHostSessionSubmitDisposition({
      hasText: true,
      selectedMainlineSnapshot: reconnectingSettledRun,
      proof: { sessionRunId: "run-1", branchBindingId: "main" },
    }).kind).toBe("continue")
    expect(resolveHostSessionSubmitDisposition({
      hasText: true,
      selectedMainlineSnapshot: stoppedActivationRun,
      proof: { sessionRunId: "run-1", branchBindingId: "main" },
    }).kind).toBe("continue")
    const {
      mainlineState: _mainlineState,
      activationState: _activationState,
      ...transportOnlyReconnectBase
    } = settledRun
    const transportOnlyReconnectRun: SelectedMainlineSnapshot = {
      ...transportOnlyReconnectBase,
      status: "reconnecting",
      working: false,
      eventStreamAllowed: false,
      transportState: "reconnecting",
    }
    expect(resolveHostSessionSubmitDisposition({
      hasText: true,
      selectedMainlineSnapshot: transportOnlyReconnectRun,
      proof: { sessionRunId: "run-1", branchBindingId: "main" },
    })).toMatchObject({
      kind: "blocked",
      reason: "selected_mainline_state_missing",
    })
    expect(resolveHostSessionSubmitDisposition({
      hasText: true,
      selectedMainlineSnapshot: cancelledRun,
      proof: { sessionRunId: "run-1", branchBindingId: "main" },
    })).toMatchObject({
      kind: "blocked",
      reason: "start_new_task_required",
    })
    expect(resolveHostSessionSubmitDisposition({
      hasText: true,
      selectedMainlineSnapshot: runningRun,
      proof: { sessionRunId: "run-1", branchBindingId: "main" },
      intent: "current_activation",
    }).kind).toBe("queue_next_turn")
    expect(resolveHostSessionSubmitDisposition({
      hasText: true,
      selectedMainlineSnapshot: settledRun,
      proof: { sessionRunId: "other-run", branchBindingId: "main" },
    }).kind).toBe("blocked")
  })

  it("blocks a new start while the first SessionRun start is pending", () => {
    expect(resolveHostSessionSubmitDisposition({
      hasText: true,
      startInFlight: true,
    })).toMatchObject({
      kind: "blocked",
      reason: "session_run_start_pending",
      proof: expect.objectContaining({
        startInFlight: true,
      }),
    })
  })

  it("persists active session run state without legacy chat id fields", () => {
    const { options, coordinator } = coordinatorWithStoredSessionRun(undefined)
    const run: SelectedMainlineSnapshot = {
      sessionRunId: "run-1",
      cursor: 4,
      sessionId: "session-1",
      branchBindingId: "branch-main",
      status: "reconnecting",
      mainlineState: "executing",
      activationState: "running",
      bindingStatus: "active",
      working: true,
      continuable: false,
      recoverable: true,
      eventStreamAllowed: true,
      projectionState: "live",
      transportState: "reconnecting",
      startedAt: "2026-05-29T00:00:00.000Z",
      reconnectAttempts: 2,
    }

    coordinator.setSelectedMainlineSnapshot(run)

    expect(coordinator.activeSessionRunId).toBe("run-1")
    expect(coordinator.selectedMainlineSnapshotPayload()).toMatchObject({
      sessionRunId: "run-1",
      session_run_id: "run-1",
      sessionId: "session-1",
      session_id: "session-1",
      branchBindingId: "branch-main",
      branch_binding_id: "branch-main",
    })
    expect(coordinator.selectedMainlineSnapshotPayload()).not.toHaveProperty("chatId")
    expect(coordinator.selectedMainlineSnapshotPayload()).not.toHaveProperty("chat_id")
    expect(options.context.workspaceState.update).toHaveBeenCalledWith(
      "labrastro.selectedMainlineSnapshot",
      expect.objectContaining({
        sessionRunId: "run-1",
        session_run_id: "run-1",
        branchBindingId: "branch-main",
        branch_binding_id: "branch-main",
        mainlineState: "executing",
        mainline_state: "executing",
        activationState: "running",
        activation_state: "running",
      })
    )
  })

  it("restores active session run state from session_run_id payloads", () => {
    const { coordinator } = coordinatorWithStoredSessionRun({
      session_run_id: "run-restored",
      cursor: "7",
      session_id: "session-restored",
      branch_binding_id: "branch-restored",
      status: "done",
      mainline_state: "settled",
      activation_state: "completed",
      binding_status: "active",
      continuable: true,
      event_stream_allowed: false,
      projection_state: "drained",
      started_at: "2026-05-29T00:00:00.000Z",
      reconnect_attempts: "3",
    })

    expect(coordinator.activeSessionRunId).toBe("run-restored")
    expect(coordinator.selectedMainlineSnapshotPayload()).toMatchObject({
      sessionRunId: "run-restored",
      session_run_id: "run-restored",
      cursor: 7,
      sessionId: "session-restored",
      session_id: "session-restored",
      branchBindingId: "branch-restored",
      branch_binding_id: "branch-restored",
      status: "settled",
      mainlineState: "settled",
      activationState: "completed",
      continuable: true,
      eventStreamAllowed: false,
    })
  })
})
