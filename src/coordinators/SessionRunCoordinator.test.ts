import { describe, expect, it, vi } from "vitest"
import { SessionRunCoordinator } from "./SessionRunCoordinator"

function coordinator() {
  const options = {
    client: {
      approvalReply: vi.fn(),
      followUpSessionRun: vi.fn(async () => ({ ok: true })),
      cancelSessionRunFollowUp: vi.fn(async () => ({ ok: true })),
      recoverSessionRun: vi.fn(async () => ({ ok: true })),
      dispatchChatCommand: vi.fn(async () => ({
        ok: true,
        action: "continue",
        session_id: "session-1",
        events: [{ type: "output", payload: { content: "help" } }],
      })),
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
        get: vi.fn(),
        update: vi.fn(),
      },
    },
    approvalDocuments: {
      open: vi.fn(),
    },
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

function coordinatorWithStoredActiveRun(stored: unknown) {
  const created = coordinator()
  created.options.context.workspaceState.get.mockImplementation((key: string) =>
    key === "labrastro.activeSessionRun" ? stored : undefined
  )
  return {
    ...created,
    coordinator: new SessionRunCoordinator(created.options as unknown as ConstructorParameters<typeof SessionRunCoordinator>[0]),
  }
}

describe("SessionRunCoordinator", () => {
  it("routes chat.send to startSessionRun with unchanged payload fields", async () => {
    const { options, coordinator: subject } = coordinator()
    const post = vi.fn()

    await expect(subject.handleMessage({
      type: "chat.send",
      text: "hello",
      sessionId: "s1",
      workflowMode: "chat",
      taskflowId: "taskflow-1",
      draftSessionId: "session-local",
      locale: "zh-CN",
      providerId: "p1",
      modelId: "m1",
      parameters: { temperature: 0 },
      mentions: [{ kind: "file", path: "README.md" }],
    }, post)).resolves.toBe(true)

    expect(options.startSessionRun).toHaveBeenCalledWith("hello", "s1", post, {
      mode: undefined,
      workflowMode: "chat",
      taskflowId: "taskflow-1",
      draftSessionId: "session-local",
      locale: "zh-CN",
      providerId: "p1",
      modelId: "m1",
      parameters: { temperature: 0 },
      mentions: [{ kind: "file", path: "README.md" }],
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

    expect(options.startSessionRun).not.toHaveBeenCalled()
    expect(post).toHaveBeenCalledWith({
      type: "sessionRun.error",
      message: "请选择会话模型后再发送。",
    })
  })

  it("routes slash commands to chat command dispatch instead of chat.send", async () => {
    const { options, coordinator: subject } = coordinator()
    const post = vi.fn()

    await expect(subject.handleMessage({
      type: "chat.command.dispatch",
      text: "/help",
      commandId: "system.help",
      trigger: "/help",
      sessionId: "session-1",
      requestId: "cmd-1",
      mentions: [{ kind: "file", path: "README.md" }],
    }, post)).resolves.toBe(true)

    expect(options.startSessionRun).not.toHaveBeenCalled()
    expect(options.client.dispatchChatCommand).toHaveBeenCalledWith({
      text: "/help",
      commandId: "system.help",
      trigger: "/help",
      args: undefined,
      sessionId: "session-1",
      clientRequestId: "cmd-1",
      mentions: [{ kind: "file", path: "README.md" }],
    })
    expect(post).toHaveBeenCalledWith({
      type: "sessionRun.events",
      events: [{ type: "output", payload: { content: "help" } }],
    })
    expect(post).toHaveBeenCalledWith({ type: "sessionRun.done" })
  })

  it("rejects non-slash chat command dispatch messages locally", async () => {
    const { options, coordinator: subject } = coordinator()
    const post = vi.fn()

    await expect(subject.handleMessage({
      type: "chat.command.dispatch",
      text: "help",
    }, post)).resolves.toBe(true)

    expect(options.client.dispatchChatCommand).not.toHaveBeenCalled()
    expect(post).toHaveBeenCalledWith({
      type: "sessionRun.error",
      message: "无效指令：Chat 指令必须以 / 开头。",
    })

    await expect(subject.handleMessage({
      type: "chat.command.dispatch",
      text: " /help",
    }, post)).resolves.toBe(true)

    expect(options.client.dispatchChatCommand).not.toHaveBeenCalled()
  })

  it("uses the active chat id for approval replies when the message omits sessionRunId", async () => {
    const { options, coordinator: subject } = coordinator()
    const post = vi.fn()
    subject.setActiveRun({
      sessionRunId: "active-chat",
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
      session_run_id: "active-chat",
      approval_id: "approval-1",
      decision: "allow_once",
      reason: "ok",
    })
  })

  it("reports approval reply success with the backend resolution state", async () => {
    const { options, coordinator: subject } = coordinator()
    const post = vi.fn()
    options.client.approvalReply.mockResolvedValueOnce({
      ok: true,
      state: "already_resolved",
    })
    subject.setActiveRun({
      sessionRunId: "active-chat",
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

    expect(post).toHaveBeenCalledWith({
      type: "approval.reply.ok",
      sessionRunId: "active-chat",
      approvalId: "approval-1",
      decision: "allow_once",
      payload: {
        ok: true,
        state: "already_resolved",
      },
    })
  })

  it("reports approval reply failures without converting the chat run to a fatal chat error", async () => {
    const { options, coordinator: subject } = coordinator()
    const post = vi.fn()
    options.client.approvalReply.mockRejectedValueOnce(new Error("fetch failed"))
    subject.setActiveRun({
      sessionRunId: "active-chat",
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

    expect(post).toHaveBeenCalledWith({
      type: "approval.reply.error",
      sessionRunId: "active-chat",
      approvalId: "approval-1",
      decision: "allow_once",
      message: "fetch failed",
    })
    expect(post).not.toHaveBeenCalledWith(expect.objectContaining({ type: "sessionRun.error" }))
    expect(subject.activeRun?.sessionRunId).toBe("active-chat")
  })

  it("routes chat follow-ups to the active run and supports cancellation", async () => {
    const { options, coordinator: subject } = coordinator()
    const post = vi.fn()
    subject.setActiveRun({
      sessionRunId: "active-chat",
      cursor: 0,
      status: "running",
      startedAt: "2026-01-01T00:00:00.000Z",
      reconnectAttempts: 0,
    })

    await subject.handleMessage({
      type: "sessionRun.followup",
      text: "use this extra constraint",
      followupId: "follow-1",
      requestId: "req-1",
    }, post)
    await subject.handleMessage({
      type: "sessionRun.followup.cancel",
      followupId: "follow-1",
      reason: "user_changed_to_queue",
    }, post)

    expect(options.client.followUpSessionRun).toHaveBeenCalledWith({
      sessionRunId: "active-chat",
      text: "use this extra constraint",
      followupId: "follow-1",
      clientRequestId: "req-1",
    })
    expect(options.client.cancelSessionRunFollowUp).toHaveBeenCalledWith({
      sessionRunId: "active-chat",
      followupId: "follow-1",
      reason: "user_changed_to_queue",
    })
  })

  it("routes sessionRun.recover to the active interrupted chat", async () => {
    const { options, coordinator: subject } = coordinator()
    const post = vi.fn()
    subject.setActiveRun({
      sessionRunId: "active-chat",
      cursor: 7,
      status: "running",
      startedAt: "2026-01-01T00:00:00.000Z",
      reconnectAttempts: 0,
    })

    await subject.handleMessage({
      type: "sessionRun.recover",
      action: "retry",
    }, post)

    expect(options.recoverSessionRun).toHaveBeenCalledWith("active-chat", "retry", post)
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
      sessionRunId: "chat-1",
      cursor: 4,
      sessionId: "session-1",
      draftSessionId: "session-local",
      status: "reconnecting",
      startedAt: "2026-01-01T00:00:00.000Z",
      reconnectAttempts: 2,
      nextRetryAt: 123,
    })

    expect(subject.activeSessionRunId).toBe("chat-1")
    expect(subject.activeRunPayload()).toMatchObject({
      sessionRunId: "chat-1",
      session_run_id: "chat-1",
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
      "labrastro.activeSessionRun",
      expect.objectContaining({ sessionRunId: "chat-1", session_run_id: "chat-1" })
    )
  })

  it("restores active run state from workspaceState on construction", () => {
    const { coordinator: subject } = coordinatorWithStoredActiveRun({
      sessionRunId: "chat-restored",
      session_run_id: "ignored-snake-id",
      cursor: "7",
      session_id: "session-restored",
      status: "reconnecting",
      started_at: "2026-05-29T00:00:00.000Z",
      reconnect_attempts: "3",
      last_error: "network",
      last_stream_at: "2026-05-29T00:00:01.000Z",
      next_retry_at: "1234",
    })

    expect(subject.activeSessionRunId).toBe("chat-restored")
    expect(subject.activeRunPayload()).toMatchObject({
      sessionRunId: "chat-restored",
      session_run_id: "chat-restored",
      cursor: 7,
      sessionId: "session-restored",
      session_id: "session-restored",
      status: "reconnecting",
      startedAt: "2026-05-29T00:00:00.000Z",
      reconnectAttempts: 3,
      reconnect_attempts: 3,
      lastError: "network",
      nextRetryAt: 1234,
    })
  })

  it("ignores invalid stored active run payloads", () => {
    const { coordinator: missingChatId } = coordinatorWithStoredActiveRun({
      cursor: 4,
      status: "running",
    })
    const { coordinator: arrayPayload } = coordinatorWithStoredActiveRun([])

    expect(missingChatId.activeRun).toBeUndefined()
    expect(arrayPayload.activeRun).toBeUndefined()
  })
})
