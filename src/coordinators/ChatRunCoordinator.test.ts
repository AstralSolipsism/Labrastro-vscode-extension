import { describe, expect, it, vi } from "vitest"
import { ChatRunCoordinator } from "./ChatRunCoordinator"

function coordinator() {
  const options = {
    client: {
      approvalReply: vi.fn(),
    },
    context: {
      workspaceState: {
        update: vi.fn(),
      },
    },
    approvalDocuments: {
      open: vi.fn(),
    },
    startChat: vi.fn(),
    cancelChat: vi.fn(),
    postConnectionStateIfAuthRequired: vi.fn(),
  }
  return {
    options,
    coordinator: new ChatRunCoordinator(options as unknown as ConstructorParameters<typeof ChatRunCoordinator>[0]),
  }
}

describe("ChatRunCoordinator", () => {
  it("routes chat.send to startChat with unchanged payload fields", async () => {
    const { options, coordinator: subject } = coordinator()
    const post = vi.fn()

    await expect(subject.handleMessage({
      type: "chat.send",
      text: "hello",
      sessionId: "s1",
      workflowMode: "chat",
      taskflowId: "taskflow-1",
      draftSessionId: "session-local",
      providerId: "p1",
      modelId: "m1",
      parameters: { temperature: 0 },
    }, post)).resolves.toBe(true)

    expect(options.startChat).toHaveBeenCalledWith("hello", "s1", post, {
      mode: undefined,
      workflowMode: "chat",
      taskflowId: "taskflow-1",
      draftSessionId: "session-local",
      providerId: "p1",
      modelId: "m1",
      parameters: { temperature: 0 },
    })
  })

  it("uses the active chat id for approval replies when the message omits chatId", async () => {
    const { options, coordinator: subject } = coordinator()
    const post = vi.fn()
    subject.setActiveRun({
      chatId: "active-chat",
      cursor: 0,
      status: "running",
      startedAt: "2026-01-01T00:00:00.000Z",
      reconnectAttempts: 0,
    })

    await subject.handleMessage({
      type: "approval.reply",
      approvalId: "approval-1",
      decision: "allow_once",
      reason: "ok",
    }, post)

    expect(options.client.approvalReply).toHaveBeenCalledWith({
      chat_id: "active-chat",
      approval_id: "approval-1",
      decision: "allow_once",
      reason: "ok",
    })
  })

  it("owns active run resume state and persists it host-scoped", () => {
    const { options, coordinator: subject } = coordinator()

    subject.setActiveRun({
      chatId: "chat-1",
      cursor: 4,
      sessionId: "session-1",
      draftSessionId: "session-local",
      status: "reconnecting",
      startedAt: "2026-01-01T00:00:00.000Z",
      reconnectAttempts: 2,
      nextRetryAt: 123,
    })

    expect(subject.activeChatId).toBe("chat-1")
    expect(subject.activeRunPayload()).toMatchObject({
      chatId: "chat-1",
      chat_id: "chat-1",
      cursor: 4,
      sessionId: "session-1",
      session_id: "session-1",
      draftSessionId: "session-local",
      draft_session_id: "session-local",
      status: "reconnecting",
      reconnectAttempts: 2,
      reconnect_attempts: 2,
      nextRetryAt: 123,
      next_retry_at: 123,
    })
    expect(options.context.workspaceState.update).toHaveBeenCalledWith(
      "labrastro.activeChatRun",
      expect.objectContaining({ chatId: "chat-1", chat_id: "chat-1" })
    )
  })
})
