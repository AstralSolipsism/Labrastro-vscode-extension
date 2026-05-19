import { describe, expect, it, vi } from "vitest"
import { ChatRunCoordinator } from "./ChatRunCoordinator"

function coordinator() {
  const options = {
    client: {
      approvalReply: vi.fn(),
      followUpChat: vi.fn(async () => ({ ok: true })),
      cancelChatFollowUp: vi.fn(async () => ({ ok: true })),
      recoverChat: vi.fn(async () => ({ ok: true })),
      getTaskflowState: vi.fn(async () => ({ ok: true, taskflow: { id: "taskflow-1" } })),
      getTaskflowWorkspace: vi.fn(async () => ({ ok: true, schema_version: "taskflow.workspace.v1" })),
      getTaskflowRuntime: vi.fn(async () => ({ ok: true, task_runs: [] })),
      getTaskflowProjectMemory: vi.fn(async () => ({ ok: true, project_memory: { project_id: "project-1" } })),
      getTaskflowProjectorPreview: vi.fn(async () => ({ ok: true, projector_preview: { target: "openspec" } })),
      answerTaskflowReviewCardV1: vi.fn(async () => ({ ok: true, taskflow: { id: "taskflow-1" } })),
      previewTaskflowProjectMemoryPatch: vi.fn(async () => ({ ok: true, proposal: { id: "patch-1" } })),
      applyTaskflowProjectMemoryPatch: vi.fn(async () => ({ ok: true, taskflow: { id: "taskflow-1" } })),
      reviewTaskflowCompilerDecision: vi.fn(async () => ({ ok: true, compiler_decision: { id: "compiler-decision-1" } })),
      compileTaskflowBrief: vi.fn(async () => ({ ok: true, taskflow: { id: "taskflow-1" } })),
      markTaskflowBriefReady: vi.fn(async () => ({ ok: true, taskflow: { id: "taskflow-1" } })),
      confirmTaskflowBrief: vi.fn(async () => ({ ok: true, taskflow: { id: "taskflow-1" } })),
      compileTaskflowGoal: vi.fn(async () => ({ ok: true, plan: { id: "plan-1" } })),
      requestTaskflowDispatch: vi.fn(async () => ({ ok: true, taskflow: { id: "taskflow-1" } })),
      confirmTaskflowDispatch: vi.fn(async () => ({ ok: true, taskflow: { id: "taskflow-1" } })),
      rejectTaskflowDispatch: vi.fn(async () => ({ ok: true, taskflow: { id: "taskflow-1" } })),
      dispatchTaskflowWorkItem: vi.fn(async () => ({ ok: true, task_run: { id: "task-run-1" } })),
      getTaskflowComplexity: vi.fn(async () => ({ ok: true, complexity: { estimate: { level: "L2" } } })),
      scanTaskflowRepoComplexity: vi.fn(async () => ({ ok: true, complexity: { estimate: { level: "L3" } } })),
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
    recoverChat: vi.fn(),
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
      locale: "zh-CN",
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

  it("rejects chat.send when the selected model is missing", async () => {
    const { options, coordinator: subject } = coordinator()
    const post = vi.fn()

    await expect(subject.handleMessage({
      type: "chat.send",
      text: "hello",
      sessionId: "s1",
    }, post)).resolves.toBe(true)

    expect(options.startChat).not.toHaveBeenCalled()
    expect(post).toHaveBeenCalledWith({
      type: "chat.error",
      message: "请选择会话模型后再发送。",
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

  it("routes chat follow-ups to the active run and supports cancellation", async () => {
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
      type: "chat.followup",
      text: "use this extra constraint",
      followupId: "follow-1",
      requestId: "req-1",
    }, post)
    await subject.handleMessage({
      type: "chat.followup.cancel",
      followupId: "follow-1",
      reason: "user_changed_to_queue",
    }, post)

    expect(options.client.followUpChat).toHaveBeenCalledWith({
      chatId: "active-chat",
      text: "use this extra constraint",
      followupId: "follow-1",
      clientRequestId: "req-1",
    })
    expect(options.client.cancelChatFollowUp).toHaveBeenCalledWith({
      chatId: "active-chat",
      followupId: "follow-1",
      reason: "user_changed_to_queue",
    })
  })

  it("routes chat.recover to the active interrupted chat", async () => {
    const { options, coordinator: subject } = coordinator()
    const post = vi.fn()
    subject.setActiveRun({
      chatId: "active-chat",
      cursor: 7,
      status: "running",
      startedAt: "2026-01-01T00:00:00.000Z",
      reconnectAttempts: 0,
    })

    await subject.handleMessage({
      type: "chat.recover",
      action: "retry",
    }, post)

    expect(options.recoverChat).toHaveBeenCalledWith("active-chat", "retry", post)
  })

  it("routes taskflow complexity requests and posts results", async () => {
    const { options, coordinator: subject } = coordinator()
    const post = vi.fn()

    await expect(subject.handleMessage({
      type: "taskflow.complexity.get",
      taskflowId: "taskflow-1",
    }, post)).resolves.toBe(true)
    await expect(subject.handleMessage({
      type: "taskflow.complexity.scan",
      taskflowId: "taskflow-1",
      workspacePath: "G:/repo/main",
      repositoryId: "repo-main",
    }, post)).resolves.toBe(true)

    expect(options.client.getTaskflowComplexity).toHaveBeenCalledWith("taskflow-1")
    expect(options.client.scanTaskflowRepoComplexity).toHaveBeenCalledWith("taskflow-1", {
      workspacePath: "G:/repo/main",
      repositoryId: "repo-main",
    })
    expect(post).toHaveBeenCalledWith({
      type: "taskflow.complexity",
      taskflowId: "taskflow-1",
      payload: { ok: true, complexity: { estimate: { level: "L2" } } },
    })
    expect(post).toHaveBeenCalledWith({
      type: "taskflow.complexity",
      taskflowId: "taskflow-1",
      payload: { ok: true, complexity: { estimate: { level: "L3" } } },
    })
  })

  it("routes taskflow operating console requests and posts typed host messages", async () => {
    const { options, coordinator: subject } = coordinator()
    const post = vi.fn()
    const client = options.client as Record<string, ReturnType<typeof vi.fn>>

    await expect(subject.handleMessage({ type: "taskflow.state.get", taskflowId: "taskflow-1" }, post)).resolves.toBe(true)
    await expect(subject.handleMessage({ type: "taskflow.workspace.get", taskflowId: "taskflow-1" }, post)).resolves.toBe(true)
    await expect(subject.handleMessage({ type: "taskflow.projectMemory.get", taskflowId: "taskflow-1" }, post)).resolves.toBe(true)
    await expect(subject.handleMessage({ type: "taskflow.runtime.get", taskflowId: "taskflow-1" }, post)).resolves.toBe(true)
    await expect(subject.handleMessage({
      type: "taskflow.reviewCardV1.action",
      taskflowId: "taskflow-1",
      cardId: "taskflow-1:question:question-1",
      action: "skip",
      actor: "user",
      reason: "Known risk.",
    }, post)).resolves.toBe(true)
    await expect(subject.handleMessage({
      type: "taskflow.projectMemory.patch.preview",
      taskflowId: "taskflow-1",
      actor: "user",
      reason: "Align term.",
      source: "workspace",
      operations: [{ type: "upsert_term", term: "CompilerDecision", definition: "Reviewable choice." }],
    }, post)).resolves.toBe(true)
    await expect(subject.handleMessage({
      type: "taskflow.projectMemory.patch.apply",
      taskflowId: "taskflow-1",
      proposalId: "patch-1",
      actor: "user",
      reason: "Align term.",
      source: "workspace",
      operations: [{ type: "upsert_term", term: "CompilerDecision", definition: "Reviewable choice." }],
    }, post)).resolves.toBe(true)
    await expect(subject.handleMessage({
      type: "taskflow.compilerDecision.review",
      taskflowId: "taskflow-1",
      decisionId: "compiler-decision-1",
      action: "force_create",
      actor: "user",
      reason: "Separate boundary.",
    }, post)).resolves.toBe(true)
    await expect(subject.handleMessage({
      type: "taskflow.projectorPreview.get",
      taskflowId: "taskflow-1",
      target: "speckit",
    }, post)).resolves.toBe(true)
    await expect(subject.handleMessage({
      type: "taskflow.brief.compile",
      taskflowId: "taskflow-1",
      actor: "agent",
    }, post)).resolves.toBe(true)
    await expect(subject.handleMessage({
      type: "taskflow.brief.ready",
      taskflowId: "taskflow-1",
      version: 2,
      actor: "agent",
    }, post)).resolves.toBe(true)
    await expect(subject.handleMessage({
      type: "taskflow.brief.confirm",
      taskflowId: "taskflow-1",
      version: 2,
      actor: "user",
    }, post)).resolves.toBe(true)
    await expect(subject.handleMessage({ type: "taskflow.goal.compile", taskflowId: "taskflow-1" }, post)).resolves.toBe(true)
    await expect(subject.handleMessage({
      type: "taskflow.dispatch.request",
      taskflowId: "taskflow-1",
      workItemIds: ["work-item-1"],
      actor: "user",
      rationale: "Ready.",
    }, post)).resolves.toBe(true)
    await expect(subject.handleMessage({
      type: "taskflow.dispatch.confirm",
      taskflowId: "taskflow-1",
      decisionId: "dispatch-decision-1",
      actor: "user",
    }, post)).resolves.toBe(true)
    await expect(subject.handleMessage({
      type: "taskflow.dispatch.reject",
      taskflowId: "taskflow-1",
      decisionId: "dispatch-decision-2",
      actor: "user",
    }, post)).resolves.toBe(true)
    await expect(subject.handleMessage({
      type: "taskflow.workItem.dispatch",
      taskflowId: "taskflow-1",
      workItemId: "work-item-1",
      dispatchDecisionId: "dispatch-decision-1",
      executorHint: "agent-1",
    }, post)).resolves.toBe(true)

    expect(client.getTaskflowState).toHaveBeenCalledWith("taskflow-1")
    expect(client.getTaskflowWorkspace).toHaveBeenCalledWith("taskflow-1")
    expect(client.getTaskflowProjectMemory).toHaveBeenCalledWith("taskflow-1")
    expect(client.getTaskflowRuntime).toHaveBeenCalledWith("taskflow-1")
    expect(client.answerTaskflowReviewCardV1).toHaveBeenCalledWith("taskflow-1", "taskflow-1:question:question-1", {
      action: "skip",
      value: undefined,
      actor: "user",
      comment: "Known risk.",
    })
    expect(client.previewTaskflowProjectMemoryPatch).toHaveBeenCalledWith("taskflow-1", {
      actor: "user",
      reason: "Align term.",
      source: "workspace",
      operations: [{ type: "upsert_term", term: "CompilerDecision", definition: "Reviewable choice." }],
    })
    expect(client.applyTaskflowProjectMemoryPatch).toHaveBeenCalledWith("taskflow-1", "patch-1", {
      actor: "user",
      reason: "Align term.",
      source: "workspace",
      operations: [{ type: "upsert_term", term: "CompilerDecision", definition: "Reviewable choice." }],
    })
    expect(client.reviewTaskflowCompilerDecision).toHaveBeenCalledWith("taskflow-1", "compiler-decision-1", {
      action: "force_create",
      actor: "user",
      reason: "Separate boundary.",
      value: undefined,
    })
    expect(client.getTaskflowProjectorPreview).toHaveBeenCalledWith("taskflow-1", "speckit")
    expect(client.compileTaskflowBrief).toHaveBeenCalledWith("taskflow-1", { actor: "agent" })
    expect(client.markTaskflowBriefReady).toHaveBeenCalledWith("taskflow-1", { version: 2, actor: "agent" })
    expect(client.confirmTaskflowBrief).toHaveBeenCalledWith("taskflow-1", { version: 2, actor: "user" })
    expect(client.compileTaskflowGoal).toHaveBeenCalledWith("taskflow-1")
    expect(client.requestTaskflowDispatch).toHaveBeenCalledWith("taskflow-1", {
      workItemIds: ["work-item-1"],
      actor: "user",
      rationale: "Ready.",
      metadata: undefined,
    })
    expect(client.confirmTaskflowDispatch).toHaveBeenCalledWith("taskflow-1", "dispatch-decision-1", { actor: "user" })
    expect(client.rejectTaskflowDispatch).toHaveBeenCalledWith("taskflow-1", "dispatch-decision-2", { actor: "user" })
    expect(client.dispatchTaskflowWorkItem).toHaveBeenCalledWith("taskflow-1", "work-item-1", {
      dispatchDecisionId: "dispatch-decision-1",
      executorHint: "agent-1",
      metadata: undefined,
    })
    expect(post).toHaveBeenCalledWith({
      type: "taskflow.state",
      taskflowId: "taskflow-1",
      action: "taskflow.state.get",
      payload: { ok: true, taskflow: { id: "taskflow-1" } },
    })
    expect(post).toHaveBeenCalledWith({
      type: "taskflow.workspace",
      taskflowId: "taskflow-1",
      payload: { ok: true, schema_version: "taskflow.workspace.v1" },
    })
    expect(post).toHaveBeenCalledWith({
      type: "taskflow.runtime",
      taskflowId: "taskflow-1",
      payload: { ok: true, task_runs: [] },
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
