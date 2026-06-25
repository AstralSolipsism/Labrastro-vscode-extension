import { describe, expect, it, vi } from "vitest"
import { SessionRunCoordinator } from "./SessionRunCoordinator"

function coordinator() {
  const options = {
    client: {
      approvalReply: vi.fn(),
      sessionRunUserInputReply: vi.fn(async (): Promise<Record<string, unknown>> => ({ ok: true })),
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
      close: vi.fn(),
      approvedSaveCandidateFor: vi.fn(),
    },
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

function coordinatorWithStoredActiveRun(stored: unknown) {
  const created = coordinator()
  created.options.context.workspaceState.get.mockImplementation((key: string) =>
    key === "labrastro.selectedMainlineSnapshot" ? stored : undefined
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
      operationId: "op-start",
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
      clientRequestId: undefined,
      operationId: "op-start",
      branchBindingId: "main",
      providerId: "p1",
      modelId: "m1",
      parameters: { temperature: 0 },
      mentions: [{ kind: "file", path: "README.md" }],
    })
  })

  it("canonicalizes new start operation branch proof to main", async () => {
    const { options, coordinator: subject } = coordinator()
    const post = vi.fn()

    await expect(subject.handleMessage({
      type: "chat.send",
      text: "hello",
      sessionId: "s1",
      requestId: "request-1",
      operationId: "op-start",
      branchBindingId: "branch-a",
      providerId: "p1",
      modelId: "m1",
    }, post)).resolves.toBe(true)

    expect(options.startSessionRun).toHaveBeenCalledWith("hello", "s1", post, expect.objectContaining({
      operationId: "op-start",
      clientRequestId: "request-1",
      branchBindingId: "main",
    }))
  })

  it("routes explicit first-run start even when a stale selected mainline snapshot exists", async () => {
    const { options, coordinator: subject } = coordinator()
    const post = vi.fn()
    subject.setSelectedMainlineSnapshot({
      sessionRunId: "stale-run",
      sessionId: "old-session",
      cursor: 9,
      status: "settled",
      mainlineState: "settled",
      activationState: "completed",
      bindingStatus: "active",
      continuable: true,
      working: false,
      branchBindingId: "main",
      startedAt: "2026-01-01T00:00:00.000Z",
      reconnectAttempts: 0,
    })

    await expect(subject.handleMessage({
      type: "chat.send",
      text: "first message in the visible empty chat",
      sessionId: "new-session",
      requestId: "request-new-start",
      operationId: "op-new-start",
      operationKind: "start",
      branchBindingId: "main",
      providerId: "p1",
      modelId: "m1",
    }, post)).resolves.toBe(true)

    expect(options.startSessionRun).toHaveBeenCalledWith(
      "first message in the visible empty chat",
      "new-session",
      post,
      expect.objectContaining({
        operationId: "op-new-start",
        clientRequestId: "request-new-start",
        branchBindingId: "main",
        providerId: "p1",
        modelId: "m1",
      })
    )
    expect(options.continueSessionRun).not.toHaveBeenCalled()
  })

  it("blocks duplicate first-run starts while startSessionRun is pending", async () => {
    const { options, coordinator: subject } = coordinator()
    const post = vi.fn()
    let resolveStart: (() => void) | undefined
    options.startSessionRun.mockImplementation(() => new Promise<void>((resolve) => {
      resolveStart = resolve
    }))

    await expect(subject.handleMessage({
      type: "chat.send",
      text: "hello",
      sessionId: "s1",
      requestId: "request-1",
      operationId: "op-start-1",
      draftSessionId: "draft-1",
    }, post)).resolves.toBe(true)

    await expect(subject.handleMessage({
      type: "chat.send",
      text: "second",
      sessionId: "s1",
      requestId: "request-2",
      operationId: "op-start-2",
      draftSessionId: "draft-1",
    }, post)).resolves.toBe(true)

    expect(options.startSessionRun).toHaveBeenCalledTimes(1)
    expect(post).toHaveBeenCalledWith(expect.objectContaining({
      type: "sessionRun.operation.error",
      operationId: "op-start-2",
      operationKind: "start",
      message: "会话运行正在启动，请稍候后再发送。",
    }))

    resolveStart?.()
    await Promise.resolve()

    await expect(subject.handleMessage({
      type: "chat.send",
      text: "third",
      sessionId: "s1",
      requestId: "request-3",
      operationId: "op-start-3",
      draftSessionId: "draft-1",
    }, post)).resolves.toBe(true)

    expect(options.startSessionRun).toHaveBeenCalledTimes(2)
  })

  it("tracks active run identity and projection revisions separately", () => {
    const { coordinator: subject } = coordinator()

    expect(subject.selectedMainlineIdentityRevision).toBe(0)
    expect(subject.selectedMainlineProjectionRevision).toBe(0)
    subject.setSelectedMainlineSnapshot({
      sessionRunId: "run-1",
      sessionId: "session-1",
      branchBindingId: "main",
      agentRunId: "agent-main",
      cursor: 0,
      status: "running",
      startedAt: "2026-06-18T00:00:00.000Z",
      reconnectAttempts: 0,
    })
    expect(subject.selectedMainlineIdentityRevision).toBe(1)
    expect(subject.selectedMainlineProjectionRevision).toBe(1)

    subject.patchSelectedMainlineSnapshot({
      cursor: 20,
      status: "reconnecting",
      reconnectAttempts: 1,
      lastStreamAt: "2026-06-18T00:00:01.000Z",
      pendingNextTurnsByBranch: {
        "run-1:main": [{ text: "next", clientRequestId: "req-next", queuedAt: "2026-06-18T00:00:02.000Z" }],
      },
    })
    expect(subject.selectedMainlineIdentityRevision).toBe(1)
    expect(subject.selectedMainlineProjectionRevision).toBe(2)

    subject.patchSelectedMainlineSnapshot({ branchBindingId: "branch-a" })
    expect(subject.selectedMainlineIdentityRevision).toBe(2)
    expect(subject.selectedMainlineProjectionRevision).toBe(3)

    subject.patchSelectedMainlineSnapshot({ agentRunId: "agent-branch-a" })
    expect(subject.selectedMainlineIdentityRevision).toBe(3)
    expect(subject.selectedMainlineProjectionRevision).toBe(4)

    subject.clearSelectedMainlineSnapshot()
    expect(subject.selectedMainlineIdentityRevision).toBe(4)
    expect(subject.selectedMainlineProjectionRevision).toBe(5)
  })

  it("keeps active run identity revision stable across projection-only mutations", () => {
    const { coordinator: subject } = coordinator()

    subject.setSelectedMainlineSnapshot({
      sessionRunId: "run-1",
      sessionId: "session-1",
      branchBindingId: "main",
      agentRunId: "agent-main",
      cursor: 0,
      status: "running",
      startedAt: "2026-06-18T00:00:00.000Z",
      reconnectAttempts: 0,
      branches: [{ branch_binding_id: "main", agent_run_id: "agent-main", status: "running" }],
    })
    const identityRevision = subject.selectedMainlineIdentityRevision
    const projectionRevision = subject.selectedMainlineProjectionRevision

    subject.patchSelectedMainlineSnapshot({
      cursor: 20,
      lastStreamAt: "2026-06-18T00:00:01.000Z",
      pendingNextTurnsByBranch: {
        "run-1:main": [{ text: "next", clientRequestId: "req-next", queuedAt: "2026-06-18T00:00:02.000Z" }],
      },
      branches: [{ branch_binding_id: "main", agent_run_id: "agent-main", status: "waiting" }],
    })

    expect(subject.selectedMainlineIdentityRevision).toBe(identityRevision)
    expect(subject.selectedMainlineProjectionRevision).toBe(projectionRevision + 1)

    subject.patchSelectedMainlineSnapshot({ branchBindingId: "branch-a", agentRunId: "agent-branch-a" })
    expect(subject.selectedMainlineIdentityRevision).toBe(identityRevision + 1)
  })

  it("routes missing selected model through start operation preflight", async () => {
    const { options, coordinator: subject } = coordinator()
    const post = vi.fn()

    await expect(subject.handleMessage({
      type: "chat.send",
      text: "hello",
      sessionId: "s1",
      operationId: "op-start-missing-model",
    }, post)).resolves.toBe(true)

    expect(options.startSessionRun).toHaveBeenCalledWith("hello", "s1", post, expect.objectContaining({
      operationId: "op-start-missing-model",
      providerId: undefined,
      modelId: undefined,
    }))
    expect(post).not.toHaveBeenCalledWith(expect.objectContaining({ type: "sessionRun.error" }))
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
      type: "chat.command.events",
      requestId: "cmd-1",
      events: [{ type: "output", payload: { content: "help" } }],
    })
    expect(post).toHaveBeenCalledWith({ type: "chat.command.done", requestId: "cmd-1" })
    expect(post).not.toHaveBeenCalledWith(expect.objectContaining({ type: "sessionRun.events" }))
    expect(post).not.toHaveBeenCalledWith(expect.objectContaining({ type: "sessionRun.done" }))
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
      type: "chat.command.error",
      message: "无效指令：Chat 指令必须以 / 开头。",
    })
    expect(post).not.toHaveBeenCalledWith(expect.objectContaining({ type: "sessionRun.error" }))

    await expect(subject.handleMessage({
      type: "chat.command.dispatch",
      text: " /help",
    }, post)).resolves.toBe(true)

    expect(options.client.dispatchChatCommand).not.toHaveBeenCalled()
  })

  it("does not use the active session run as proof for approval replies", async () => {
    const { options, coordinator: subject } = coordinator()
    const post = vi.fn()
    subject.setSelectedMainlineSnapshot({
      sessionRunId: "active-run",
      branchBindingId: "branch-a",
      cursor: 0,
      status: "running",
      startedAt: "2026-01-01T00:00:00.000Z",
      reconnectAttempts: 0,
    })

    await subject.handleMessage({
      type: "approval.reply",
      approvalId: "approval-1",
      branchBindingId: "branch-a",
      decision: "allow_once",
      reason: "ok",
    }, post)

    expect(options.client.approvalReply).not.toHaveBeenCalled()
    expect(post).not.toHaveBeenCalledWith(expect.objectContaining({ type: "approval.reply.ok" }))
    expect(post).not.toHaveBeenCalledWith(expect.objectContaining({ type: "approval.reply.error" }))
  })

  it("uses explicit snake_case session_run_id and branch_binding_id for approval replies", async () => {
    const { options, coordinator: subject } = coordinator()
    const post = vi.fn()
    subject.setSelectedMainlineSnapshot({
      sessionRunId: "active-run",
      branchBindingId: "branch-a",
      cursor: 0,
      status: "running",
      startedAt: "2026-01-01T00:00:00.000Z",
      reconnectAttempts: 0,
    })

    await subject.handleMessage({
      type: "approval.reply",
      session_run_id: "snake-run",
      branch_binding_id: "branch-snake",
      approvalId: "approval-1",
      decision: "allow_once",
      reason: "ok",
    }, post)

    expect(options.client.approvalReply).toHaveBeenCalledWith({
      session_run_id: "snake-run",
      branch_binding_id: "branch-snake",
      approval_id: "approval-1",
      decision: "allow_once",
      reason: "ok",
    })
  })

  it("uses the current stored candidate before stale explicit approval reply candidates", async () => {
    const { options, coordinator: subject } = coordinator()
    const post = vi.fn()
    const staleExplicitCandidate = {
      tool_name: "apply_patch",
      operations: [{ kind: "update", path: "src/app.ts", new_content: "stale" }],
    }
    const currentStoredCandidate = {
      tool_name: "apply_patch",
      operations: [{ kind: "update", path: "src/app.ts", new_content: "edited" }],
    }
    options.approvalDocuments.approvedSaveCandidateFor.mockReturnValueOnce(currentStoredCandidate)
    subject.setSelectedMainlineSnapshot({
      sessionRunId: "active-run",
      cursor: 0,
      status: "running",
      startedAt: "2026-01-01T00:00:00.000Z",
      reconnectAttempts: 0,
    })

    await subject.handleMessage({
      type: "approval.reply",
      sessionRunId: "reply-run",
      branchBindingId: "branch-a",
      approvalId: "approval-1",
      decision: "allow_once",
      reason: "ok",
      approved_save_candidate: staleExplicitCandidate,
    }, post)

    expect(options.client.approvalReply).toHaveBeenCalledWith({
      session_run_id: "reply-run",
      branch_binding_id: "branch-a",
      approval_id: "approval-1",
      decision: "allow_once",
      reason: "ok",
      approved_save_candidate: currentStoredCandidate,
    })
  })

  it("uses the current stored candidate for allow approval replies when the webview omits one", async () => {
    const { options, coordinator: subject } = coordinator()
    const post = vi.fn()
    const approvedSaveCandidate = {
      tool_name: "apply_patch",
      operations: [{ kind: "update", path: "src/app.ts", new_content: "edited" }],
    }
    options.approvalDocuments.approvedSaveCandidateFor.mockReturnValueOnce(approvedSaveCandidate)
    subject.setSelectedMainlineSnapshot({
      sessionRunId: "active-run",
      branchBindingId: "branch-a",
      cursor: 0,
      status: "running",
      startedAt: "2026-01-01T00:00:00.000Z",
      reconnectAttempts: 0,
    })

    await subject.handleMessage({
      type: "approval.reply",
      sessionRunId: "reply-run",
      approvalId: "approval-1",
      branchBindingId: "branch-a",
      decision: "allow_once",
      reason: "ok",
    }, post)

    expect(options.client.approvalReply).toHaveBeenCalledWith({
      session_run_id: "reply-run",
      branch_binding_id: "branch-a",
      approval_id: "approval-1",
      decision: "allow_once",
      reason: "ok",
      approved_save_candidate: approvedSaveCandidate,
    })
  })

  it("falls back to explicit approved save candidates when no stored candidate exists", async () => {
    const { options, coordinator: subject } = coordinator()
    const post = vi.fn()
    const approvedSaveCandidate = {
      tool_name: "apply_patch",
      operations: [{ kind: "update", path: "src/app.ts", new_content: "explicit" }],
    }
    subject.setSelectedMainlineSnapshot({
      sessionRunId: "active-run",
      cursor: 0,
      status: "running",
      startedAt: "2026-01-01T00:00:00.000Z",
      reconnectAttempts: 0,
    })

    await subject.handleMessage({
      type: "approval.reply",
      sessionRunId: "reply-run",
      branchBindingId: "branch-a",
      approvalId: "approval-1",
      decision: "allow_once",
      reason: "ok",
      approved_save_candidate: approvedSaveCandidate,
    }, post)

    expect(options.client.approvalReply).toHaveBeenCalledWith({
      session_run_id: "reply-run",
      branch_binding_id: "branch-a",
      approval_id: "approval-1",
      decision: "allow_once",
      reason: "ok",
      approved_save_candidate: approvedSaveCandidate,
    })
  })

  it("does not send approved save candidates for denied approval replies", async () => {
    const { options, coordinator: subject } = coordinator()
    const post = vi.fn()
    options.approvalDocuments.approvedSaveCandidateFor.mockReturnValueOnce({
      tool_name: "apply_patch",
      operations: [{ kind: "update", path: "src/app.ts", new_content: "stored" }],
    })
    subject.setSelectedMainlineSnapshot({
      sessionRunId: "active-run",
      cursor: 0,
      status: "running",
      startedAt: "2026-01-01T00:00:00.000Z",
      reconnectAttempts: 0,
    })

    await subject.handleMessage({
      type: "approval.reply",
      sessionRunId: "reply-run",
      branchBindingId: "branch-a",
      approvalId: "approval-1",
      decision: "deny_once",
      reason: "no",
      approved_save_candidate: {
        tool_name: "apply_patch",
        operations: [{ kind: "update", path: "src/app.ts", new_content: "explicit" }],
      },
    }, post)

    expect(options.client.approvalReply).toHaveBeenCalledWith({
      session_run_id: "reply-run",
      branch_binding_id: "branch-a",
      approval_id: "approval-1",
      decision: "deny_once",
      reason: "no",
    })
    expect(options.approvalDocuments.approvedSaveCandidateFor).not.toHaveBeenCalled()
  })

  it("reports approval reply success with the backend resolution state", async () => {
    const { options, coordinator: subject } = coordinator()
    const post = vi.fn()
    options.client.approvalReply.mockResolvedValueOnce({
      ok: true,
      state: "already_resolved",
    })
    subject.setSelectedMainlineSnapshot({
      sessionRunId: "active-run",
      cursor: 0,
      status: "running",
      startedAt: "2026-01-01T00:00:00.000Z",
      reconnectAttempts: 0,
    })

    await subject.handleMessage({
      type: "approval.reply",
      sessionRunId: "reply-run",
      approvalId: "approval-1",
      branchBindingId: "branch-a",
      decision: "allow_once",
      reason: "ok",
    }, post)

    expect(post).toHaveBeenCalledWith({
      type: "approval.reply.ok",
      sessionRunId: "reply-run",
      branchBindingId: "branch-a",
      branch_binding_id: "branch-a",
      approvalId: "approval-1",
      decision: "allow_once",
      payload: {
        ok: true,
        state: "already_resolved",
      },
    })
    expect(options.approvalDocuments.close).toHaveBeenCalledWith("approval-1")
  })

  it("reports approval reply failures without converting the session run to a fatal run error", async () => {
    const { options, coordinator: subject } = coordinator()
    const post = vi.fn()
    options.client.approvalReply.mockRejectedValueOnce(new Error("fetch failed"))
    subject.setSelectedMainlineSnapshot({
      sessionRunId: "active-run",
      branchBindingId: "branch-a",
      cursor: 0,
      status: "running",
      startedAt: "2026-01-01T00:00:00.000Z",
      reconnectAttempts: 0,
    })

    await subject.handleMessage({
      type: "approval.reply",
      sessionRunId: "reply-run",
      approvalId: "approval-1",
      branchBindingId: "branch-a",
      decision: "allow_once",
      reason: "ok",
    }, post)

    expect(post).toHaveBeenCalledWith({
      type: "approval.reply.error",
      sessionRunId: "reply-run",
      branchBindingId: "branch-a",
      branch_binding_id: "branch-a",
      approvalId: "approval-1",
      decision: "allow_once",
      message: "fetch failed",
    })
    expect(post).not.toHaveBeenCalledWith(expect.objectContaining({ type: "sessionRun.error" }))
    expect(options.approvalDocuments.close).not.toHaveBeenCalled()
    expect(subject.selectedMainlineSnapshot?.sessionRunId).toBe("active-run")
  })

  it("does not use the active session run as proof for user input replies", async () => {
    const { options, coordinator: subject } = coordinator()
    const post = vi.fn()
    subject.setSelectedMainlineSnapshot({
      sessionRunId: "active-run",
      branchBindingId: "branch-a",
      cursor: 0,
      status: "running",
      startedAt: "2026-01-01T00:00:00.000Z",
      reconnectAttempts: 0,
    })

    await subject.handleMessage({
      type: "sessionRun.userInput.reply",
      inputId: "mcp-elicitation-1",
      branchBindingId: "branch-a",
      action: "accept",
      content: { format: "markdown" },
      reason: "chosen",
    }, post)

    expect(options.client.sessionRunUserInputReply).not.toHaveBeenCalled()
    expect(post).not.toHaveBeenCalledWith(expect.objectContaining({ type: "sessionRun.userInput.reply.ok" }))
    expect(post).not.toHaveBeenCalledWith(expect.objectContaining({ type: "sessionRun.userInput.reply.error" }))
  })

  it("routes structured session run user input replies with explicit run and branch proof", async () => {
    const { options, coordinator: subject } = coordinator()
    const post = vi.fn()
    options.client.sessionRunUserInputReply.mockResolvedValueOnce({
      ok: true,
      state: "resolved",
    })
    subject.setSelectedMainlineSnapshot({
      sessionRunId: "active-run",
      branchBindingId: "branch-a",
      cursor: 0,
      status: "running",
      startedAt: "2026-01-01T00:00:00.000Z",
      reconnectAttempts: 0,
    })

    await subject.handleMessage({
      type: "sessionRun.userInput.reply",
      sessionRunId: "reply-run",
      inputId: "mcp-elicitation-1",
      branchBindingId: "branch-a",
      action: "accept",
      content: { format: "markdown" },
      reason: "chosen",
    }, post)

    expect(options.client.sessionRunUserInputReply).toHaveBeenCalledWith({
      session_run_id: "reply-run",
      branch_binding_id: "branch-a",
      input_id: "mcp-elicitation-1",
      action: "accept",
      content: { format: "markdown" },
      reason: "chosen",
    })
    expect(post).toHaveBeenCalledWith({
      type: "sessionRun.userInput.reply.ok",
      sessionRunId: "reply-run",
      branchBindingId: "branch-a",
      branch_binding_id: "branch-a",
      inputId: "mcp-elicitation-1",
      action: "accept",
      payload: {
        ok: true,
        state: "resolved",
      },
    })
  })

  it("reports session run user input reply failures with the target branch", async () => {
    const { options, coordinator: subject } = coordinator()
    const post = vi.fn()
    options.client.sessionRunUserInputReply.mockRejectedValueOnce(new Error("reply failed"))
    subject.setSelectedMainlineSnapshot({
      sessionRunId: "active-run",
      branchBindingId: "branch-a",
      cursor: 0,
      status: "running",
      startedAt: "2026-01-01T00:00:00.000Z",
      reconnectAttempts: 0,
    })

    await subject.handleMessage({
      type: "sessionRun.userInput.reply",
      sessionRunId: "reply-run",
      inputId: "mcp-elicitation-1",
      branchBindingId: "branch-a",
      action: "accept",
      content: { format: "markdown" },
      reason: "chosen",
    }, post)

    expect(post).toHaveBeenCalledWith({
      type: "sessionRun.userInput.reply.error",
      sessionRunId: "reply-run",
      branchBindingId: "branch-a",
      branch_binding_id: "branch-a",
      inputId: "mcp-elicitation-1",
      action: "accept",
      message: "reply failed",
    })
  })

  it("routes sessionRun.cancel with snake_case session_run_id", async () => {
    const { options, coordinator: subject } = coordinator()
    const post = vi.fn()

    await subject.handleMessage({
      type: "sessionRun.cancel",
      session_run_id: "snake-run",
      branch_binding_id: "branch-a",
      operationId: "op-cancel",
      reason: "explicit_close",
    }, post)

    expect(options.cancelSessionRun).toHaveBeenCalledWith("snake-run", "branch-a", post, {
      operationId: "op-cancel",
      reason: "explicit_close",
    })
  })

  it("routes sessionRun.stop with snake_case session_run_id", async () => {
    const { options, coordinator: subject } = coordinator()
    const post = vi.fn()

    await subject.handleMessage({
      type: "sessionRun.stop",
      session_run_id: "snake-run",
      branch_binding_id: "branch-a",
      operationId: "op-stop",
    }, post)

    expect(options.stopSessionRun).toHaveBeenCalledWith("snake-run", "branch-a", post, {
      operationId: "op-stop",
    })
    expect(options.cancelSessionRun).not.toHaveBeenCalled()
  })

  it("does not use the active session run as proof for cancel messages", async () => {
    const { options, coordinator: subject } = coordinator()
    const post = vi.fn()
    subject.setSelectedMainlineSnapshot({
      sessionRunId: "active-run",
      branchBindingId: "branch-a",
      cursor: 0,
      status: "running",
      startedAt: "2026-01-01T00:00:00.000Z",
      reconnectAttempts: 0,
    })

    await subject.handleMessage({
      type: "sessionRun.cancel",
      operationId: "op-cancel",
    }, post)

    expect(options.cancelSessionRun).not.toHaveBeenCalled()
  })

  it("routes sessionRun.branch with snake_case branch payload", async () => {
    const { options, coordinator: subject } = coordinator()
    const post = vi.fn()

    await subject.handleMessage({
      type: "sessionRun.branch",
      session_run_id: "run-current",
      base_session_item_id: "msg-2",
      prompt: "edited prompt",
      operationId: "op-branch-create",
      source_branch_binding_id: "main",
      branch_binding_id: "branch-edit-1",
      source_label: "original prompt",
      source_message_id: "message-1",
      source_node_id: "node-1",
      compose_mode: "edit",
    }, post)

    expect(options.branchSessionRun).toHaveBeenCalledWith({
      sessionRunId: "run-current",
      baseSessionItemId: "msg-2",
      prompt: "edited prompt",
      sourceBranchBindingId: "main",
      branchBindingId: "branch-edit-1",
      operationId: "op-branch-create",
      sourceLabel: "original prompt",
      sourceMessageId: "message-1",
      sourceNodeId: "node-1",
      composeMode: "edit",
    }, post)
  })

  it("routes sessionRun.branch.select with snake_case branch binding", async () => {
    const { options, coordinator: subject } = coordinator()
    const post = vi.fn()

    await subject.handleMessage({
      type: "sessionRun.branch.select",
      session_run_id: "run-current",
      source_branch_binding_id: "main",
      branch_binding_id: "branch-2",
      operationId: "op-branch-select",
    }, post)

    expect(options.selectSessionRunBranch).toHaveBeenCalledWith({
      sessionRunId: "run-current",
      sourceBranchBindingId: "main",
      branchBindingId: "branch-2",
      operationId: "op-branch-select",
    }, post)
  })

  it("does not accept operation_id as selected-visible operation proof", async () => {
    {
      const { options, coordinator: subject } = coordinator()
      await subject.handleMessage({ type: "chat.send", text: "start", operation_id: "op-start" }, vi.fn())
      expect(options.startSessionRun).not.toHaveBeenCalled()
    }

    {
      const { options, coordinator: subject } = coordinator()
      subject.setSelectedMainlineSnapshot({
        sessionRunId: "active-run",
        cursor: 0,
        status: "settled",
        branchBindingId: "main",
        startedAt: "2026-01-01T00:00:00.000Z",
        reconnectAttempts: 0,
      })
      await subject.handleMessage({ type: "chat.send", text: "continue", operation_id: "op-continue" }, vi.fn())
      expect(options.continueSessionRun).not.toHaveBeenCalled()
    }

    {
      const { options, coordinator: subject } = coordinator()
      await subject.handleMessage({
        type: "sessionRun.cancel",
        sessionRunId: "run-1",
        branchBindingId: "main",
        operation_id: "op-cancel",
      }, vi.fn())
      expect(options.cancelSessionRun).not.toHaveBeenCalled()
    }

    {
      const { options, coordinator: subject } = coordinator()
      await subject.handleMessage({
        type: "sessionRun.recover",
        sessionRunId: "run-1",
        branchBindingId: "main",
        operation_id: "op-recover",
      }, vi.fn())
      expect(options.recoverSessionRun).not.toHaveBeenCalled()
    }

    {
      const { options, coordinator: subject } = coordinator()
      await subject.handleMessage({
        type: "sessionRun.branch",
        base_session_item_id: "msg-2",
        prompt: "edited prompt",
        operation_id: "op-branch-create",
        session_run_id: "run-current",
        branch_binding_id: "branch-edit-1",
      }, vi.fn())
      expect(options.branchSessionRun).not.toHaveBeenCalled()
    }

    {
      const { options, coordinator: subject } = coordinator()
      await subject.handleMessage({
        type: "sessionRun.branch.select",
        session_run_id: "run-current",
        branch_binding_id: "branch-2",
        operation_id: "op-branch-select",
      }, vi.fn())
      expect(options.selectSessionRunBranch).not.toHaveBeenCalled()
    }
  })

  it("fails closed selected-visible operations without operation id", async () => {
    {
      const { options, coordinator: subject } = coordinator()
      await subject.handleMessage({ type: "chat.send", text: "start", sessionId: "s1" }, vi.fn())
      expect(options.startSessionRun).not.toHaveBeenCalled()
    }

    {
      const { options, coordinator: subject } = coordinator()
      subject.setSelectedMainlineSnapshot({
        sessionRunId: "active-run",
        cursor: 0,
        status: "settled",
        branchBindingId: "main",
        startedAt: "2026-01-01T00:00:00.000Z",
        reconnectAttempts: 0,
      })
      await subject.handleMessage({ type: "chat.send", text: "continue" }, vi.fn())
      expect(options.continueSessionRun).not.toHaveBeenCalled()
    }

    {
      const { options, coordinator: subject } = coordinator()
      subject.setSelectedMainlineSnapshot({
        sessionRunId: "active-run",
        cursor: 0,
        status: "running",
        agentRunId: "agent-run-1",
        activationId: "activation-1",
        branchBindingId: "main",
        startedAt: "2026-01-01T00:00:00.000Z",
        reconnectAttempts: 0,
      })
      await subject.handleMessage({ type: "chat.send", text: "steer", intent: "steer" }, vi.fn())
      expect(options.steerAgentRun).not.toHaveBeenCalled()
      expect(subject.pendingNextTurnForBranch("active-run", "main")).toBeUndefined()
    }

    {
      const { options, coordinator: subject } = coordinator()
      await subject.handleMessage({
        type: "sessionRun.cancel",
        sessionRunId: "active-run",
        branchBindingId: "main",
      }, vi.fn())
      expect(options.cancelSessionRun).not.toHaveBeenCalled()
    }

    {
      const { options, coordinator: subject } = coordinator()
      await subject.handleMessage({
        type: "sessionRun.branch",
        baseSessionItemId: "msg-1",
        prompt: "branch",
        branchBindingId: "branch-a",
      }, vi.fn())
      expect(options.branchSessionRun).not.toHaveBeenCalled()
    }

    {
      const { options, coordinator: subject } = coordinator()
      await subject.handleMessage({
        type: "sessionRun.branch.select",
        branchBindingId: "branch-a",
      }, vi.fn())
      expect(options.selectSessionRunBranch).not.toHaveBeenCalled()
    }

    {
      const { options, coordinator: subject } = coordinator()
      await subject.handleMessage({
        type: "sessionRun.recover",
        sessionRunId: "active-run",
        branchBindingId: "main",
      }, vi.fn())
      expect(options.recoverSessionRun).not.toHaveBeenCalled()
    }
  })

  it("does not restore active session runs without explicit branch proof", () => {
    const { coordinator: subject } = coordinatorWithStoredActiveRun({
      sessionRunId: "run-without-branch",
      cursor: 0,
      status: "running",
      startedAt: "2026-01-01T00:00:00.000Z",
      reconnectAttempts: 0,
    })

    expect(subject.selectedMainlineSnapshot).toBeUndefined()
    expect(subject.selectedMainlineSnapshotPayload()).toBeUndefined()
  })

  it("does not route selected-visible branch operations without explicit session run proof", async () => {
    const { options, coordinator: subject } = coordinator()
    const post = vi.fn()
    subject.setSelectedMainlineSnapshot({
      sessionRunId: "active-run",
      cursor: 0,
      status: "settled",
      branchBindingId: "main",
      startedAt: "2026-01-01T00:00:00.000Z",
      reconnectAttempts: 0,
    })

    await subject.handleMessage({
      type: "sessionRun.branch",
      base_session_item_id: "msg-2",
      prompt: "edited prompt",
      operationId: "op-branch-create",
      source_branch_binding_id: "main",
      branch_binding_id: "branch-edit-1",
    }, post)
    await subject.handleMessage({
      type: "sessionRun.branch.select",
      source_branch_binding_id: "main",
      branch_binding_id: "branch-2",
      operationId: "op-branch-select",
    }, post)

    expect(options.branchSessionRun).not.toHaveBeenCalled()
    expect(options.selectSessionRunBranch).not.toHaveBeenCalled()
  })

  it("does not route active chat.send without explicit branch proof", async () => {
    const { options, coordinator: subject } = coordinator()
    const post = vi.fn()
    subject.setSelectedMainlineSnapshot({
      sessionRunId: "active-run",
      cursor: 0,
      status: "settled",
      branchBindingId: "main",
      startedAt: "2026-01-01T00:00:00.000Z",
      reconnectAttempts: 0,
    })

    await subject.handleMessage({
      type: "chat.send",
      text: "missing branch proof",
      requestId: "req-missing-branch",
      operationId: "op-missing-branch",
    }, post)

    expect(options.continueSessionRun).not.toHaveBeenCalled()
    expect(options.startSessionRun).not.toHaveBeenCalled()
  })

  it("blocks explicit continue chat.send without complete branch proof", async () => {
    const { options, coordinator: subject } = coordinator()
    const post = vi.fn()
    subject.setSelectedMainlineSnapshot({
      sessionRunId: "active-run",
      cursor: 0,
      status: "settled",
      branchBindingId: "main",
      startedAt: "2026-01-01T00:00:00.000Z",
      reconnectAttempts: 0,
    })

    await subject.handleMessage({
      type: "chat.send",
      text: "continue without branch proof",
      sessionRunId: "active-run",
      operationKind: "continue",
      requestId: "req-missing-branch",
      operationId: "op-missing-branch",
    }, post)

    expect(options.continueSessionRun).not.toHaveBeenCalled()
    expect(options.startSessionRun).not.toHaveBeenCalled()
    expect(post).toHaveBeenCalledWith(expect.objectContaining({
      type: "sessionRun.operation.error",
      operationId: "op-missing-branch",
      operationKind: "continue",
      reason: "scope_mismatch",
    }))
  })

  it("does not route settled active chat.send without explicit session run proof", async () => {
    const { options, coordinator: subject } = coordinator()
    const post = vi.fn()
    subject.setSelectedMainlineSnapshot({
      sessionRunId: "active-run",
      cursor: 0,
      status: "settled",
      branchBindingId: "main",
      startedAt: "2026-01-01T00:00:00.000Z",
      reconnectAttempts: 0,
    })

    await subject.handleMessage({
      type: "chat.send",
      text: "missing session run proof",
      branchBindingId: "main",
      requestId: "req-1",
      operationId: "op-continue",
      locale: "zh-CN",
      mentions: [{ kind: "file", path: "README.md" }],
    }, post)

    expect(options.continueSessionRun).not.toHaveBeenCalled()
    expect(options.startSessionRun).not.toHaveBeenCalled()
  })

  it("routes settled active chat.send only with explicit session run and branch proof", async () => {
    const { options, coordinator: subject } = coordinator()
    const post = vi.fn()
    subject.setSelectedMainlineSnapshot({
      sessionRunId: "active-run",
      cursor: 0,
      status: "settled",
      branchBindingId: "main",
      startedAt: "2026-01-01T00:00:00.000Z",
      reconnectAttempts: 0,
    })

    await subject.handleMessage({
      type: "chat.send",
      text: "continue here",
      sessionRunId: "active-run",
      branchBindingId: "main",
      requestId: "req-1",
      operationId: "op-continue",
      locale: "zh-CN",
      mentions: [{ kind: "file", path: "README.md" }],
    }, post)

    expect(options.continueSessionRun).toHaveBeenCalledWith("continue here", post, {
      sessionRunId: "active-run",
      branchBindingId: "main",
      clientRequestId: "req-1",
      operationId: "op-continue",
      locale: "zh-CN",
      mentions: [{ kind: "file", path: "README.md" }],
    })
    expect(options.startSessionRun).not.toHaveBeenCalled()
  })

  it("routes explicit continue with branch proof when the host snapshot is not restored yet", async () => {
    const { options, coordinator: subject } = coordinator()
    const post = vi.fn()

    await subject.handleMessage({
      type: "chat.send",
      text: "continue with proof",
      sessionRunId: "run-current",
      branchBindingId: "main",
      operationKind: "continue",
      requestId: "req-continue",
      operationId: "op-continue",
      locale: "zh-CN",
      mentions: [{ kind: "file", path: "README.md" }],
    }, post)

    expect(options.continueSessionRun).toHaveBeenCalledWith("continue with proof", post, {
      sessionRunId: "run-current",
      branchBindingId: "main",
      clientRequestId: "req-continue",
      operationId: "op-continue",
      locale: "zh-CN",
      mentions: [{ kind: "file", path: "README.md" }],
    })
    expect(options.startSessionRun).not.toHaveBeenCalled()
  })

  it("routes settled active chat.send to session run continue", async () => {
    const { options, coordinator: subject } = coordinator()
    const post = vi.fn()
    subject.setSelectedMainlineSnapshot({
      sessionRunId: "active-run",
      cursor: 0,
      status: "settled",
      branchBindingId: "main",
      startedAt: "2026-01-01T00:00:00.000Z",
      reconnectAttempts: 0,
    })

    await subject.handleMessage({
      type: "chat.send",
      text: "continue here",
      sessionRunId: "active-run",
      branchBindingId: "main",
      requestId: "req-1",
      operationId: "op-continue",
      locale: "zh-CN",
      mentions: [{ kind: "file", path: "README.md" }],
    }, post)

    expect(options.continueSessionRun).toHaveBeenCalledWith("continue here", post, {
      sessionRunId: "active-run",
      branchBindingId: "main",
      clientRequestId: "req-1",
      operationId: "op-continue",
      locale: "zh-CN",
      mentions: [{ kind: "file", path: "README.md" }],
    })
    expect(options.startSessionRun).not.toHaveBeenCalled()
  })

  it("routes explicit current-activation input to continue when the active run is settled", async () => {
    const { options, coordinator: subject } = coordinator()
    const post = vi.fn()
    subject.setSelectedMainlineSnapshot({
      sessionRunId: "active-run",
      cursor: 3,
      status: "settled",
      agentRunId: "agent-run-1",
      activationId: "old-activation",
      branchBindingId: "main",
      startedAt: "2026-01-01T00:00:00.000Z",
      reconnectAttempts: 0,
    })

    await subject.handleMessage({
      type: "chat.send",
      text: "continue after the previous activation ended",
      sessionRunId: "active-run",
      branchBindingId: "main",
      intent: "current_activation",
      requestId: "next-1",
      operationId: "op-continue-ended",
      locale: "zh-CN",
    }, post)

    expect(options.continueSessionRun).toHaveBeenCalledWith(
      "continue after the previous activation ended",
      post,
      {
        sessionRunId: "active-run",
        branchBindingId: "main",
        clientRequestId: "next-1",
        operationId: "op-continue-ended",
        locale: "zh-CN",
      }
    )
    expect(options.steerAgentRun).not.toHaveBeenCalled()
  })

  it("queues ordinary chat.send as branch-local pending next turn while active run is executing", async () => {
    const { options, coordinator: subject } = coordinator()
    const post = vi.fn()
    subject.setSelectedMainlineSnapshot({
      sessionRunId: "active-run",
      cursor: 0,
      status: "running",
      branchBindingId: "main",
      startedAt: "2026-01-01T00:00:00.000Z",
      reconnectAttempts: 0,
    })

    await subject.handleMessage({
      type: "chat.send",
      text: "next turn after this finishes",
      sessionRunId: "active-run",
      branchBindingId: "main",
      requestId: "req-2",
      locale: "zh-CN",
      mentions: [{ kind: "file", path: "README.md" }],
    }, post)

    expect(options.continueSessionRun).not.toHaveBeenCalled()
    expect(options.steerAgentRun).not.toHaveBeenCalled()
    const pending = subject.pendingNextTurnForBranch("active-run", "main")
    expect(pending?.text).toBe("next turn after this finishes")
    expect(pending?.locale).toBe("zh-CN")
    expect(pending?.mentions).toEqual([{ kind: "file", path: "README.md" }])
    expect(post).toHaveBeenCalledWith(expect.objectContaining({
      type: "sessionRun.pendingNextTurn",
      sessionRunId: "active-run",
      branchBindingId: "main",
    }))
  })

  it("continues ordinary chat.send after the selected active run is settled", async () => {
    const { options, coordinator: subject } = coordinator()
    const post = vi.fn()
    subject.setSelectedMainlineSnapshot({
      sessionRunId: "active-run",
      cursor: 12,
      status: "settled",
      branchBindingId: "main",
      startedAt: "2026-01-01T00:00:00.000Z",
      reconnectAttempts: 0,
    })

    await subject.handleMessage({
      type: "chat.send",
      text: "second turn",
      sessionRunId: "active-run",
      branchBindingId: "main",
      requestId: "req-second",
      operationId: "op-second",
      locale: "zh-CN",
    }, post)

    expect(options.continueSessionRun).toHaveBeenCalledWith(
      "second turn",
      post,
      {
        sessionRunId: "active-run",
        branchBindingId: "main",
        clientRequestId: "req-second",
        operationId: "op-second",
        locale: "zh-CN",
      }
    )
    expect(options.steerAgentRun).not.toHaveBeenCalled()
    expect(subject.pendingNextTurnForBranch("active-run", "main")).toBeUndefined()
    expect(post).not.toHaveBeenCalledWith(expect.objectContaining({
      type: "sessionRun.pendingNextTurn",
    }))
  })

  it("keeps pending next turns branch-local when the selected branch changes", async () => {
    const { options, coordinator: subject } = coordinator()
    const post = vi.fn()
    subject.setSelectedMainlineSnapshot({
      sessionRunId: "active-run",
      cursor: 0,
      status: "running",
      branchBindingId: "branch-a",
      startedAt: "2026-01-01T00:00:00.000Z",
      reconnectAttempts: 0,
    })

    await subject.handleMessage({
      type: "chat.send",
      text: "queued for A",
      session_run_id: "active-run",
      branch_binding_id: "branch-a",
      requestId: "req-a",
    }, post)
    subject.patchSelectedMainlineSnapshot({ branchBindingId: "branch-b" })
    await subject.handleMessage({
      type: "chat.send",
      text: "queued for B",
      session_run_id: "active-run",
      branch_binding_id: "branch-b",
      requestId: "req-b",
    }, post)

    expect(options.continueSessionRun).not.toHaveBeenCalled()
    expect(subject.pendingNextTurnForBranch("active-run", "branch-a")?.text).toBe("queued for A")
    expect(subject.pendingNextTurnForBranch("active-run", "branch-b")?.text).toBe("queued for B")

    const consumedA = subject.shiftPendingNextTurnForBranch("active-run", "branch-a")
    expect(consumedA?.text).toBe("queued for A")
    expect(subject.pendingNextTurnForBranch("active-run", "branch-a")).toBeUndefined()
    expect(subject.pendingNextTurnForBranch("active-run", "branch-b")?.text).toBe("queued for B")
  })

  it("removes and clears pending next turns by branch through host-owned queue messages", async () => {
    const { coordinator: subject } = coordinator()
    const post = vi.fn()
    subject.setSelectedMainlineSnapshot({
      sessionRunId: "active-run",
      cursor: 0,
      status: "running",
      branchBindingId: "branch-a",
      startedAt: "2026-01-01T00:00:00.000Z",
      reconnectAttempts: 0,
    })

    await subject.handleMessage({
      type: "chat.send",
      text: "queued A one",
      session_run_id: "active-run",
      branch_binding_id: "branch-a",
      requestId: "req-a-1",
    }, post)
    await subject.handleMessage({
      type: "chat.send",
      text: "queued A two",
      session_run_id: "active-run",
      branch_binding_id: "branch-a",
      requestId: "req-a-2",
    }, post)
    await subject.handleMessage({
      type: "chat.send",
      text: "queued B one",
      session_run_id: "active-run",
      branch_binding_id: "branch-b",
      requestId: "req-b-1",
    }, post)

    await subject.handleMessage({
      type: "sessionRun.pendingNextTurn.remove",
      sessionRunId: "active-run",
      branchBindingId: "branch-a",
      clientRequestId: "req-a-1",
      text: "queued A one",
    }, post)

    expect(subject.pendingNextTurnForBranch("active-run", "branch-a")?.text).toBe("queued A two")
    expect(subject.pendingNextTurnForBranch("active-run", "branch-b")?.text).toBe("queued B one")
    expect(post).toHaveBeenCalledWith(expect.objectContaining({
      type: "sessionRun.pendingNextTurns",
      sessionRunId: "active-run",
      branchBindingId: "branch-a",
      items: [expect.objectContaining({ text: "queued A two" })],
    }))

    await subject.handleMessage({
      type: "sessionRun.pendingNextTurn.clear",
      session_run_id: "active-run",
      branch_binding_id: "branch-a",
    }, post)

    expect(subject.pendingNextTurnForBranch("active-run", "branch-a")).toBeUndefined()
    expect(subject.pendingNextTurnForBranch("active-run", "branch-b")?.text).toBe("queued B one")
    expect(post).toHaveBeenCalledWith(expect.objectContaining({
      type: "sessionRun.pendingNextTurns",
      sessionRunId: "active-run",
      branchBindingId: "branch-a",
      items: [],
    }))
  })

  it("does not use the active session run as proof for pending next turn mutations", async () => {
    const { coordinator: subject } = coordinator()
    const post = vi.fn()
    subject.setSelectedMainlineSnapshot({
      sessionRunId: "active-run",
      cursor: 0,
      status: "running",
      branchBindingId: "branch-a",
      pendingNextTurnsByBranch: {
        "active-run:branch-a": [{
          text: "queued A",
          branchBindingId: "branch-a",
          sessionRunId: "active-run",
          clientRequestId: "req-a",
          queuedAt: "2026-01-01T00:00:00.000Z",
        }],
      },
      startedAt: "2026-01-01T00:00:00.000Z",
      reconnectAttempts: 0,
    })

    await subject.handleMessage({
      type: "sessionRun.pendingNextTurn.remove",
      branchBindingId: "branch-a",
      clientRequestId: "req-a",
    }, post)
    await subject.handleMessage({
      type: "sessionRun.pendingNextTurn.clear",
      sessionRunId: "active-run",
    }, post)

    expect(subject.pendingNextTurnForBranch("active-run", "branch-a")?.text).toBe("queued A")
    expect(post).not.toHaveBeenCalledWith(expect.objectContaining({
      type: "sessionRun.pendingNextTurns",
    }))
  })

  it("uses explicit pending next turn scope even when the active run identity differs", () => {
    const { coordinator: subject } = coordinator()
    subject.setSelectedMainlineSnapshot({
      sessionRunId: "run-visible",
      cursor: 0,
      status: "running",
      branchBindingId: "main",
      pendingNextTurnsByBranch: {
        "run-hidden:branch-a": [{
          text: "queued A",
          branchBindingId: "branch-a",
          sessionRunId: "run-hidden",
          clientRequestId: "req-a",
          queuedAt: "2026-01-01T00:00:00.000Z",
        }],
        "run-hidden:branch-b": [{
          text: "queued B",
          branchBindingId: "branch-b",
          sessionRunId: "run-hidden",
          clientRequestId: "req-b",
          queuedAt: "2026-01-01T00:00:00.000Z",
        }],
      },
      startedAt: "2026-01-01T00:00:00.000Z",
      reconnectAttempts: 0,
    })

    subject.removePendingNextTurnForBranch("run-hidden", "branch-a", {
      clientRequestId: "req-a",
      text: "queued A",
    })
    subject.clearPendingNextTurnForBranch("run-hidden", "branch-b")

    expect(subject.selectedMainlineSnapshot?.sessionRunId).toBe("run-visible")
    expect(subject.pendingNextTurnForBranch("run-hidden", "branch-a")).toBeUndefined()
    expect(subject.pendingNextTurnForBranch("run-hidden", "branch-b")).toBeUndefined()
  })

  it("queues explicit current-activation guidance instead of steering the current run", async () => {
    const { options, coordinator: subject } = coordinator()
    const post = vi.fn()
    subject.setSelectedMainlineSnapshot({
      sessionRunId: "active-run",
      cursor: 0,
      status: "running",
      agentRunId: "agent-run-1",
      activationId: "activation-1",
      branchBindingId: "main",
      startedAt: "2026-01-01T00:00:00.000Z",
      reconnectAttempts: 0,
    })

    await subject.handleMessage({
      type: "chat.send",
      text: "apply this to the current run",
      sessionRunId: "active-run",
      branchBindingId: "main",
      intent: "steer",
      requestId: "steer-1",
      operationId: "op-steer",
      locale: "zh-CN",
      mentions: [{ kind: "file", path: "README.md" }],
    }, post)

    expect(options.steerAgentRun).not.toHaveBeenCalled()
    expect(subject.pendingNextTurnForBranch("active-run", "main")).toMatchObject({
      text: "apply this to the current run",
      clientRequestId: "steer-1",
      locale: "zh-CN",
      mentions: [{ kind: "file", path: "README.md" }],
    })
    expect(post).toHaveBeenCalledWith(expect.objectContaining({
      type: "sessionRun.pendingNextTurn",
      sessionRunId: "active-run",
      branchBindingId: "main",
    }))
  })

  it("routes sessionRun.recover to the active interrupted session run", async () => {
    const { options, coordinator: subject } = coordinator()
    const post = vi.fn()
    subject.setSelectedMainlineSnapshot({
      sessionRunId: "active-run",
      cursor: 7,
      status: "running",
      startedAt: "2026-01-01T00:00:00.000Z",
      reconnectAttempts: 0,
    })

    await subject.handleMessage({
      type: "sessionRun.recover",
      sessionRunId: "active-run",
      branchBindingId: "main",
      operationId: "op-recover",
      action: "retry",
    }, post)

    expect(options.recoverSessionRun).toHaveBeenCalledWith("active-run", "main", "retry", post, {
      operationId: "op-recover",
    })
  })

  it("does not use the active session run as proof for recover messages", async () => {
    const { options, coordinator: subject } = coordinator()
    const post = vi.fn()
    subject.setSelectedMainlineSnapshot({
      sessionRunId: "active-run",
      cursor: 0,
      status: "running",
      branchBindingId: "main",
      startedAt: "2026-01-01T00:00:00.000Z",
      reconnectAttempts: 0,
    })

    await subject.handleMessage({
      type: "sessionRun.recover",
      operationId: "op-recover",
      action: "retry",
    }, post)

    expect(options.recoverSessionRun).not.toHaveBeenCalled()
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

    subject.setSelectedMainlineSnapshot({
      sessionRunId: "run-1",
      cursor: 4,
      sessionId: "session-1",
      draftSessionId: "session-local",
      branchBindingId: "main",
      status: "reconnecting",
      startedAt: "2026-01-01T00:00:00.000Z",
      reconnectAttempts: 2,
      nextRetryAt: 123,
    })

    expect(subject.activeSessionRunId).toBe("run-1")
    expect(subject.selectedMainlineSnapshotPayload()).toMatchObject({
      sessionRunId: "run-1",
      session_run_id: "run-1",
      cursor: 4,
      sessionId: "session-1",
      session_id: "session-1",
      draftSessionId: "session-local",
      draft_session_id: "session-local",
      status: "reconnecting",
      branchBindingId: "main",
      reconnectAttempts: 2,
      reconnect_attempts: 2,
      nextRetryAt: 123,
      next_retry_at: 123,
    })
    expect(options.context.workspaceState.update).toHaveBeenCalledWith(
      "labrastro.selectedMainlineSnapshot",
      expect.objectContaining({ sessionRunId: "run-1", session_run_id: "run-1" })
    )
  })

  it("restores active run state from workspaceState on construction", () => {
    const { coordinator: subject } = coordinatorWithStoredActiveRun({
      sessionRunId: "run-restored",
      session_run_id: "ignored-snake-id",
      cursor: "7",
      session_id: "session-restored",
      branch_binding_id: "main",
      status: "reconnecting",
      started_at: "2026-05-29T00:00:00.000Z",
      reconnect_attempts: "3",
      last_error: "network",
      last_stream_at: "2026-05-29T00:00:01.000Z",
      next_retry_at: "1234",
    })

    expect(subject.activeSessionRunId).toBe("run-restored")
    expect(subject.selectedMainlineSnapshotPayload()).toMatchObject({
      sessionRunId: "run-restored",
      session_run_id: "run-restored",
      cursor: 7,
      sessionId: "session-restored",
      session_id: "session-restored",
      branchBindingId: "main",
      branch_binding_id: "main",
      status: "reconnecting",
      startedAt: "2026-05-29T00:00:00.000Z",
      reconnectAttempts: 3,
      reconnect_attempts: 3,
      lastError: "network",
      nextRetryAt: 1234,
    })
  })

  it("ignores invalid stored active run payloads", () => {
    const { coordinator: missingSessionRunId } = coordinatorWithStoredActiveRun({
      cursor: 4,
      status: "running",
    })
    const { coordinator: arrayPayload } = coordinatorWithStoredActiveRun([])

    expect(missingSessionRunId.selectedMainlineSnapshot).toBeUndefined()
    expect(arrayPayload.selectedMainlineSnapshot).toBeUndefined()
  })
})
