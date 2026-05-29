import { describe, expect, it, vi } from "vitest"
import { SessionRunCoordinator, type ActiveSessionRun } from "./SessionRunCoordinator"

function coordinatorWithStoredSessionRun(stored: unknown) {
  const options = {
    client: {
      approvalReply: vi.fn(),
      followUpSessionRun: vi.fn(),
      cancelSessionRunFollowUp: vi.fn(),
      recoverSessionRun: vi.fn(),
    },
    context: {
      workspaceState: {
        get: vi.fn((key: string) => key === "labrastro.activeSessionRun" ? stored : undefined),
        update: vi.fn(),
      },
    },
    approvalDocuments: { open: vi.fn() },
    startSessionRun: vi.fn(),
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
  it("persists active session run state with sessionRunId only", () => {
    const { options, coordinator } = coordinatorWithStoredSessionRun(undefined)
    const run: ActiveSessionRun = {
      sessionRunId: "run-1",
      cursor: 4,
      sessionId: "session-1",
      status: "reconnecting",
      startedAt: "2026-05-29T00:00:00.000Z",
      reconnectAttempts: 2,
    }

    coordinator.setActiveRun(run)

    expect(coordinator.activeSessionRunId).toBe("run-1")
    expect(coordinator.activeRunPayload()).toMatchObject({
      sessionRunId: "run-1",
      session_run_id: "run-1",
      sessionId: "session-1",
      session_id: "session-1",
    })
    expect(coordinator.activeRunPayload()).not.toHaveProperty("chatId")
    expect(coordinator.activeRunPayload()).not.toHaveProperty("chat_id")
    expect(options.context.workspaceState.update).toHaveBeenCalledWith(
      "labrastro.activeSessionRun",
      expect.objectContaining({ sessionRunId: "run-1", session_run_id: "run-1" })
    )
  })

  it("restores active session run state from session_run_id payloads", () => {
    const { coordinator } = coordinatorWithStoredSessionRun({
      session_run_id: "run-restored",
      cursor: "7",
      session_id: "session-restored",
      status: "reconnecting",
      started_at: "2026-05-29T00:00:00.000Z",
      reconnect_attempts: "3",
    })

    expect(coordinator.activeSessionRunId).toBe("run-restored")
    expect(coordinator.activeRunPayload()).toMatchObject({
      sessionRunId: "run-restored",
      session_run_id: "run-restored",
      cursor: 7,
      sessionId: "session-restored",
      session_id: "session-restored",
    })
  })
})
