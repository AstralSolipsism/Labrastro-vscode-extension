import { describe, expect, it, vi } from "vitest"

import { buildChatSendMessage, buildPendingNextTurnSendMessage, chatMessages, type ChatMessagePort } from "./chatMessages"

const operationSnakeId = ["operation", "id"].join("_")

function port() {
  return {
    postMessage: vi.fn(),
  } satisfies ChatMessagePort
}

describe("chatMessages operation correlation fields", () => {
  it("emits chat.send operationId without snake_case operation alias", () => {
    const message = buildChatSendMessage({
      text: "hello",
      operationId: "op-start",
      providerId: "provider-1",
      modelId: "model-1",
    }) as Record<string, unknown>

    expect(message.operationId).toBe("op-start")
    expect(message).not.toHaveProperty(operationSnakeId)
  })

  it("emits pending next turn chat.send without operationId", () => {
    const message = buildPendingNextTurnSendMessage({
      text: "next",
      sessionRunId: "run-current",
      requestId: "pending-1",
      branchBindingId: "branch-a",
    }) as Record<string, unknown>

    expect(message.type).toBe("chat.send")
    expect(message.sessionRunId).toBe("run-current")
    expect(message.session_run_id).toBe("run-current")
    expect(message.requestId).toBe("pending-1")
    expect(message.branchBindingId).toBe("branch-a")
    expect(message).not.toHaveProperty("operationId")
    expect(message).not.toHaveProperty(operationSnakeId)
  })

  it("emits branch operationId without snake_case operation alias", () => {
    const chatPort = port()

    chatMessages.branch(chatPort, {
      baseSessionItemId: "msg-1",
      prompt: "try branch",
      sessionRunId: "run-current",
      operationId: "op-branch",
      sourceBranchBindingId: "main",
      branchBindingId: "branch-a",
    })

    const message = chatPort.postMessage.mock.calls[0]?.[0] as Record<string, unknown>
    expect(message.sessionRunId).toBe("run-current")
    expect(message.session_run_id).toBe("run-current")
    expect(message.operationId).toBe("op-branch")
    expect(message.sourceBranchBindingId).toBe("main")
    expect(message.source_branch_binding_id).toBe("main")
    expect(message.branchBindingId).toBe("branch-a")
    expect(message.branch_binding_id).toBe("branch-a")
    expect(message).not.toHaveProperty(operationSnakeId)
  })

  it("emits branch select operationId without snake_case operation alias", () => {
    const chatPort = port()

    chatMessages.selectBranch(chatPort, {
      sessionRunId: "run-current",
      sourceBranchBindingId: "main",
      branchBindingId: "branch-a",
      operationId: "op-select",
    })

    const message = chatPort.postMessage.mock.calls[0]?.[0] as Record<string, unknown>
    expect(message.sessionRunId).toBe("run-current")
    expect(message.session_run_id).toBe("run-current")
    expect(message.operationId).toBe("op-select")
    expect(message.sourceBranchBindingId).toBe("main")
    expect(message.source_branch_binding_id).toBe("main")
    expect(message.branchBindingId).toBe("branch-a")
    expect(message.branch_binding_id).toBe("branch-a")
    expect(message).not.toHaveProperty(operationSnakeId)
  })

  it("emits recover operationId without snake_case operation alias", () => {
    const chatPort = port()

    chatMessages.recover(chatPort, {
      sessionRunId: "run-current",
      branchBindingId: "branch-a",
      action: "retry",
      operationId: "op-recover",
    })

    const message = chatPort.postMessage.mock.calls[0]?.[0] as Record<string, unknown>
    expect(message.operationId).toBe("op-recover")
    expect(message).not.toHaveProperty(operationSnakeId)
  })

  it("emits cancel operationId without snake_case operation alias", () => {
    const chatPort = port()

    chatMessages.cancel(chatPort, {
      sessionRunId: "run-current",
      branchBindingId: "branch-a",
      operationId: "op-cancel",
    })

    const message = chatPort.postMessage.mock.calls[0]?.[0] as Record<string, unknown>
    expect(message.operationId).toBe("op-cancel")
    expect(message).not.toHaveProperty(operationSnakeId)
  })

  it("fails closed selected-visible facade calls without non-empty operationId", () => {
    const chatPort = port()

    chatMessages.send(chatPort, { text: "start", operationId: "  " })
    chatMessages.queuePendingNextTurn(chatPort, { text: "next", sessionRunId: "", branchBindingId: "main" })
    chatMessages.queuePendingNextTurn(chatPort, { text: "next", sessionRunId: "run-current", branchBindingId: "" })
    chatMessages.branch(chatPort, {
      baseSessionItemId: "msg-1",
      prompt: "branch",
      operationId: "",
      sessionRunId: "run-current",
      sourceBranchBindingId: "main",
      branchBindingId: "branch-a",
    })
    chatMessages.branch(chatPort, {
      baseSessionItemId: "msg-1",
      prompt: "branch",
      operationId: "op-branch",
      sessionRunId: "run-current",
      sourceBranchBindingId: "",
      branchBindingId: "branch-a",
    })
    chatMessages.branch(chatPort, {
      baseSessionItemId: "msg-1",
      prompt: "branch",
      operationId: "op-branch",
      sessionRunId: "",
      sourceBranchBindingId: "main",
      branchBindingId: "branch-a",
    })
    chatMessages.selectBranch(chatPort, { sessionRunId: "run-current", sourceBranchBindingId: "main", branchBindingId: "branch-a", operationId: "" })
    chatMessages.selectBranch(chatPort, { sessionRunId: "run-current", sourceBranchBindingId: "", branchBindingId: "branch-a", operationId: "op-select" })
    chatMessages.selectBranch(chatPort, { sessionRunId: "", sourceBranchBindingId: "main", branchBindingId: "branch-a", operationId: "op-select" })
    chatMessages.recover(chatPort, {
      sessionRunId: "run-current",
      branchBindingId: "main",
      action: "retry",
      operationId: "",
    })
    chatMessages.cancel(chatPort, {
      sessionRunId: "run-current",
      branchBindingId: "main",
      operationId: "",
    })

    expect(chatPort.postMessage).not.toHaveBeenCalled()
  })
})
