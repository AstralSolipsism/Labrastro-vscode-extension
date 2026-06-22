import type * as vscode from "vscode"
import { describe, expect, it, vi } from "vitest"

const vscodeMock = vi.hoisted(() => ({
  EventEmitter: class MockVscodeEventEmitter<T> {
    private readonly listeners: Array<(event: T) => unknown> = []

    readonly event = (listener: (event: T) => unknown) => {
      this.listeners.push(listener)
      return {
        dispose: () => {
          const index = this.listeners.indexOf(listener)
          if (index >= 0) this.listeners.splice(index, 1)
        },
      }
    }

    fire(event: T): void {
      for (const listener of [...this.listeners]) listener(event)
    }

    dispose(): void {
      this.listeners.length = 0
    }
  },
  registerTextDocumentContentProvider: vi.fn(() => ({ dispose: vi.fn() })),
  registerFileSystemProvider: vi.fn(() => ({ dispose: vi.fn() })),
  createFileSystemWatcher: vi.fn(() => ({
    onDidChange: vi.fn(),
    onDidCreate: vi.fn(),
    onDidDelete: vi.fn(),
    dispose: vi.fn(),
  })),
  executeCommand: vi.fn(async () => undefined),
}))

vi.mock("vscode", () => ({
  EventEmitter: vscodeMock.EventEmitter,
  workspace: {
    registerTextDocumentContentProvider: vscodeMock.registerTextDocumentContentProvider,
    registerFileSystemProvider: vscodeMock.registerFileSystemProvider,
    createFileSystemWatcher: vscodeMock.createFileSystemWatcher,
    workspaceFolders: [{ uri: { fsPath: "D:/workspace" } }],
    getConfiguration: () => ({
      inspect: () => undefined,
      get: (_key: string, fallback: unknown) => fallback,
      update: vi.fn(async () => undefined),
    }),
  },
  window: {},
  commands: {
    executeCommand: vscodeMock.executeCommand,
  },
  env: {
    language: "zh-cn",
  },
  languages: {},
  ViewColumn: { Active: -1 },
  Uri: {
    from: (value: Record<string, unknown>) => ({
      ...value,
      toString: () => `${value.scheme}:${value.path}`,
    }),
  },
}))

import { LabrastroController } from "./LabrastroController"
import type { ActiveSessionRun, PendingNextTurn } from "./coordinators/SessionRunCoordinator"
import { RemoteError } from "./remote-errors"

const operationSnakeId = ["operation", "id"].join("_")
const operationSnakeKind = ["operation", "kind"].join("_")

function context(): vscode.ExtensionContext {
  return {
    subscriptions: [],
    workspaceState: {
      get: vi.fn(),
      update: vi.fn(),
    },
    globalStorageUri: { fsPath: "" },
    extension: { packageJSON: { version: "0.1.0" } },
  } as unknown as vscode.ExtensionContext
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function sessionRunCoordinator(controller: LabrastroController) {
  return (controller as unknown as {
    sessionRunCoordinator: {
      activeRun: ActiveSessionRun | undefined
      activeRunIdentityRevision: number
      activeDraftSessionId: string | undefined
      setActiveRun: (run: ActiveSessionRun | undefined) => void
      setActiveDraftSessionId: (sessionId: string | undefined) => void
      pendingNextTurnForBranch: (
        sessionRunId: string | undefined,
        branchBindingId: string | undefined,
      ) => PendingNextTurn | undefined
    }
  }).sessionRunCoordinator
}

function sessionRuntimeStore(controller: LabrastroController) {
  return (controller as unknown as {
    sessionRuntimeStore: {
      snapshot: () => {
        scopes: Record<string, { status: string }>
        visible: { selectedRuntimeStatus: string }
      }
      ensureBranchRuntimeScope: (input: {
        sessionRunId: string
        branchBindingId: string
        agentRunId?: string
        activeActivationId?: string
        status?: "idle" | "running"
        select?: boolean
      }) => boolean
    }
  }).sessionRuntimeStore
}

function recordString(record: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === "string" && value.trim()) return value.trim()
  }
  return ""
}

function setActiveRun(controller: LabrastroController, patch: Partial<ActiveSessionRun>): void {
  const run: ActiveSessionRun = {
    sessionRunId: "run-current",
    sessionId: "session-current",
    branchBindingId: "main",
    agentRunId: "agent-current",
    activationId: "activation-current",
    cursor: 0,
    status: "running",
    startedAt: "2026-06-18T00:00:00.000Z",
    reconnectAttempts: 0,
    ...patch,
  }
  sessionRunCoordinator(controller).setActiveRun(run)
  if (run.branchBindingId && run.agentRunId) {
    sessionRuntimeStore(controller).ensureBranchRuntimeScope({
      sessionRunId: run.sessionRunId,
      branchBindingId: run.branchBindingId,
      agentRunId: run.agentRunId,
      activeActivationId: run.activationId,
      status: run.status === "idle" ? "idle" : "running",
      select: true,
    })
  }
  for (const branch of run.branches || []) {
    const branchBindingId = recordString(branch, "branchBindingId", "branch_binding_id")
    if (!branchBindingId || branchBindingId === run.branchBindingId) continue
    const agentRunId =
      recordString(branch, "agentRunId", "agent_run_id", "targetAgentRunId", "target_agent_run_id") ||
      `agent-${branchBindingId}`
    sessionRuntimeStore(controller).ensureBranchRuntimeScope({
      sessionRunId: run.sessionRunId,
      branchBindingId,
      agentRunId,
      status: "idle",
    })
  }
}

describe("LabrastroController SessionRun response correlation", () => {
  it("ignores a stale start response after another active run is selected", async () => {
    const controller = new LabrastroController(context())
    const start = deferred<Record<string, unknown>>()
    const startSessionRun = vi.fn(() => start.promise)
    const prepareSessionRunSession = vi.fn(async () => ({ ok: true, sessionId: "session-start" }))
    const consumeSessionRunEventStream = vi.fn(async () => undefined)
    ;(controller as unknown as { client: { startSessionRun: typeof startSessionRun } }).client = { startSessionRun }
    ;(controller as unknown as {
      sessionCoordinator: { prepareSessionRunSession: typeof prepareSessionRunSession }
    }).sessionCoordinator = { prepareSessionRunSession }
    ;(controller as unknown as {
      consumeSessionRunEventStream: typeof consumeSessionRunEventStream
    }).consumeSessionRunEventStream = consumeSessionRunEventStream
    const post = vi.fn()

    const pending = (controller as unknown as {
      startSessionRun: (
        text: string,
        requestedSessionId: string | undefined,
        post: (message: Record<string, unknown>) => void,
        options?: Record<string, unknown>,
      ) => Promise<void>
    }).startSessionRun("hello", "session-start", post, {
      providerId: "deepseek",
      modelId: "V4FLASH",
      clientRequestId: "start-1",
      operationId: "op-start-stale",
    })
    await Promise.resolve()
    setActiveRun(controller, { sessionRunId: "run-other", sessionId: "session-other", branchBindingId: "main" })

    start.resolve({
      session_run_id: "run-start",
      session_id: "session-start",
      branch_binding_id: "main",
      agent_run_id: "agent-start",
      activation_id: "activation-start",
    })
    await pending

    expect(sessionRunCoordinator(controller).activeRun?.sessionRunId).toBe("run-other")
    expect(post).not.toHaveBeenCalledWith(expect.objectContaining({
      type: "sessionRun.session",
      sessionRunId: "run-start",
    }))
    expect(post).toHaveBeenCalledWith(expect.objectContaining({
      type: "sessionRun.operation.error",
      operationId: "op-start-stale",
      operationKind: "start",
      branchBindingId: "main",
    }))
    expect(consumeSessionRunEventStream).not.toHaveBeenCalled()
  })

  it("reports event stream failures after a start success through stream lifecycle", async () => {
    const controller = new LabrastroController(context())
    const startSessionRun = vi.fn(async () => ({
      session_run_id: "run-start",
      session_id: "session-start",
      branch_binding_id: "main",
      agent_run_id: "agent-start",
      activation_id: "activation-start",
    }))
    const prepareSessionRunSession = vi.fn(async () => ({ ok: true, sessionId: "session-start" }))
    const consumeSessionRunEventStream = vi.fn(async () => {
      throw new Error("stream failed")
    })
    ;(controller as unknown as { client: { startSessionRun: typeof startSessionRun } }).client = { startSessionRun }
    ;(controller as unknown as {
      sessionCoordinator: { prepareSessionRunSession: typeof prepareSessionRunSession }
    }).sessionCoordinator = { prepareSessionRunSession }
    ;(controller as unknown as {
      consumeSessionRunEventStream: typeof consumeSessionRunEventStream
    }).consumeSessionRunEventStream = consumeSessionRunEventStream
    const post = vi.fn()

    await (controller as unknown as {
      startSessionRun: (
        text: string,
        requestedSessionId: string | undefined,
        post: (message: Record<string, unknown>) => void,
        options?: Record<string, unknown>,
      ) => Promise<void>
    }).startSessionRun("hello", "session-start", post, {
      providerId: "deepseek",
      modelId: "V4FLASH",
      operationId: "op-start",
    })
    await Promise.resolve()

    expect(post).toHaveBeenCalledWith(expect.objectContaining({
      type: "sessionRun.session",
      operationId: "op-start",
      operationKind: "start",
      sessionRunId: "run-start",
    }))
    expect(post).toHaveBeenCalledWith(expect.objectContaining({
      type: "sessionRun.error",
      sessionRunId: "run-start",
      branchBindingId: "main",
      message: "stream failed",
    }))
    for (const [message] of post.mock.calls as Array<[Record<string, unknown>]>) {
      if (message.type === "sessionRun.operation.pending" || message.type === "sessionRun.session") {
        expect(message).not.toHaveProperty(operationSnakeId)
        expect(message).not.toHaveProperty(operationSnakeKind)
      }
    }
  })

  it("does not create a stream scope from active run branch metadata", () => {
    const controller = new LabrastroController(context())
    const consumeSessionRunEventStream = vi.fn(async () => undefined)
    ;(controller as unknown as {
      consumeSessionRunEventStream: typeof consumeSessionRunEventStream
    }).consumeSessionRunEventStream = consumeSessionRunEventStream
    sessionRunCoordinator(controller).setActiveRun({
      sessionRunId: "run-current",
      sessionId: "session-current",
      branchBindingId: "main",
      agentRunId: "agent-main",
      cursor: 0,
      status: "running",
      startedAt: "2026-06-18T00:00:00.000Z",
      reconnectAttempts: 0,
      branches: [
        { branch_binding_id: "main", agent_run_id: "agent-main", selected: true },
        { branch_binding_id: "branch-a", agent_run_id: "agent-branch-a", selected: false },
      ],
    })
    sessionRuntimeStore(controller).ensureBranchRuntimeScope({
      sessionRunId: "run-current",
      branchBindingId: "main",
      agentRunId: "agent-main",
      status: "running",
      select: true,
    })
    const post = vi.fn()

    ;(controller as unknown as {
      ensureSessionRunEventStream: (
        sessionRunId: string,
        sessionId: string,
        post: (message: Record<string, unknown>) => void,
        branchBindingId: string,
      ) => void
    }).ensureSessionRunEventStream("run-current", "session-current", post, "branch-a")

    expect(consumeSessionRunEventStream).not.toHaveBeenCalled()
    expect(sessionRuntimeStore(controller).snapshot().scopes["run-current:branch-a"]).toBeUndefined()
  })

  it("does not create a stream scope from event payload identity", async () => {
    const controller = new LabrastroController(context())
    setActiveRun(controller, {
      sessionRunId: "run-current",
      sessionId: "session-current",
      branchBindingId: "main",
      agentRunId: "agent-main",
    })
    const post = vi.fn()

    await (controller as unknown as {
      applySessionRunEventsBatch: (
        sessionRunId: string,
        sessionId: string,
        streamBranchBindingId: string,
        cursor: number,
        stream: Record<string, unknown>,
        post: (message: Record<string, unknown>) => void,
      ) => Promise<{ sessionId: string; cursor: number; done: boolean; active: boolean }>
    }).applySessionRunEventsBatch("run-current", "session-current", "branch-a", 0, {
      next_cursor: 1,
      events: [{
        type: "assistant_delta",
        payload: {
          branch_binding_id: "branch-a",
          agent_run_id: "agent-branch-a",
          content: "hidden",
        },
      }],
    }, post)

    expect(sessionRuntimeStore(controller).snapshot().scopes["run-current:branch-a"]).toBeUndefined()
    expect(post).not.toHaveBeenCalledWith(expect.objectContaining({
      type: "sessionRun.stream",
      branchBindingId: "branch-a",
    }))
  })

  it("accepts a new start run while an existing active run is still visible", async () => {
    const controller = new LabrastroController(context())
    const startSessionRun = vi.fn(async () => ({
      session_run_id: "run-new",
      session_id: "session-new",
      branch_binding_id: "main",
      agent_run_id: "agent-new",
      activation_id: "activation-new",
    }))
    const prepareSessionRunSession = vi.fn(async () => ({ ok: true, sessionId: "session-new" }))
    const ensureSessionRunEventStream = vi.fn()
    ;(controller as unknown as { client: { startSessionRun: typeof startSessionRun } }).client = { startSessionRun }
    ;(controller as unknown as {
      sessionCoordinator: { prepareSessionRunSession: typeof prepareSessionRunSession }
    }).sessionCoordinator = { prepareSessionRunSession }
    ;(controller as unknown as {
      ensureSessionRunEventStream: typeof ensureSessionRunEventStream
    }).ensureSessionRunEventStream = ensureSessionRunEventStream
    setActiveRun(controller, { sessionRunId: "run-existing", sessionId: "session-existing", branchBindingId: "main" })
    const post = vi.fn()

    await (controller as unknown as {
      startSessionRun: (
        text: string,
        requestedSessionId: string | undefined,
        post: (message: Record<string, unknown>) => void,
        options?: Record<string, unknown>,
      ) => Promise<void>
    }).startSessionRun("hello", "session-new", post, {
      providerId: "deepseek",
      modelId: "V4FLASH",
      operationId: "op-start-new",
    })

    expect(sessionRunCoordinator(controller).activeRun?.sessionRunId).toBe("run-new")
    expect(post).toHaveBeenCalledWith(expect.objectContaining({
      type: "sessionRun.session",
      operationId: "op-start-new",
      operationKind: "start",
      sessionRunId: "run-new",
      sessionId: "session-new",
    }))
    expect(ensureSessionRunEventStream).toHaveBeenCalledWith("run-new", "session-new", post, "main")
  })

  it("uses canonical main proof for start even when the caller supplies another branch", async () => {
    const controller = new LabrastroController(context())
    const startSessionRun = vi.fn(async () => ({
      session_run_id: "run-new",
      session_id: "session-new",
      branch_binding_id: "main",
      agent_run_id: "agent-new",
      activation_id: "activation-new",
    }))
    const prepareSessionRunSession = vi.fn(async () => ({ ok: true, sessionId: "session-new" }))
    const ensureSessionRunEventStream = vi.fn()
    ;(controller as unknown as { client: { startSessionRun: typeof startSessionRun } }).client = { startSessionRun }
    ;(controller as unknown as {
      sessionCoordinator: { prepareSessionRunSession: typeof prepareSessionRunSession }
    }).sessionCoordinator = { prepareSessionRunSession }
    ;(controller as unknown as {
      ensureSessionRunEventStream: typeof ensureSessionRunEventStream
    }).ensureSessionRunEventStream = ensureSessionRunEventStream
    const post = vi.fn()

    await (controller as unknown as {
      startSessionRun: (
        text: string,
        requestedSessionId: string | undefined,
        post: (message: Record<string, unknown>) => void,
        options?: Record<string, unknown>,
      ) => Promise<void>
    }).startSessionRun("hello", "session-new", post, {
      providerId: "deepseek",
      modelId: "V4FLASH",
      operationId: "op-start-main",
      branchBindingId: "branch-a",
    })

    expect(post).toHaveBeenCalledWith(expect.objectContaining({
      type: "sessionRun.operation.pending",
      operationId: "op-start-main",
      operationKind: "start",
      targetBranchBindingId: "main",
    }))
    const startOptions = (startSessionRun.mock.calls[0] as unknown[])[2] as Record<string, unknown>
    expect(startOptions).not.toHaveProperty("branchBindingId")
    expect(post).toHaveBeenCalledWith(expect.objectContaining({
      type: "sessionRun.session",
      operationId: "op-start-main",
      operationKind: "start",
      branchBindingId: "main",
    }))
    expect(ensureSessionRunEventStream).toHaveBeenCalledWith("run-new", "session-new", post, "main")
  })

  it("rejects start success when the backend returns a non-canonical branch target", async () => {
    const controller = new LabrastroController(context())
    const startSessionRun = vi.fn(async () => ({
      session_run_id: "run-new",
      session_id: "session-new",
      branch_binding_id: "branch-a",
      agent_run_id: "agent-branch-a",
      activation_id: "activation-branch-a",
    }))
    const prepareSessionRunSession = vi.fn(async () => ({ ok: true, sessionId: "session-new" }))
    const ensureSessionRunEventStream = vi.fn()
    ;(controller as unknown as { client: { startSessionRun: typeof startSessionRun } }).client = { startSessionRun }
    ;(controller as unknown as {
      sessionCoordinator: { prepareSessionRunSession: typeof prepareSessionRunSession }
    }).sessionCoordinator = { prepareSessionRunSession }
    ;(controller as unknown as {
      ensureSessionRunEventStream: typeof ensureSessionRunEventStream
    }).ensureSessionRunEventStream = ensureSessionRunEventStream
    const post = vi.fn()

    await (controller as unknown as {
      startSessionRun: (
        text: string,
        requestedSessionId: string | undefined,
        post: (message: Record<string, unknown>) => void,
        options?: Record<string, unknown>,
      ) => Promise<void>
    }).startSessionRun("hello", "session-new", post, {
      providerId: "deepseek",
      modelId: "V4FLASH",
      operationId: "op-start-branch-a",
    })

    expect(sessionRunCoordinator(controller).activeRun).toBeUndefined()
    expect(post).not.toHaveBeenCalledWith(expect.objectContaining({
      type: "sessionRun.session",
      sessionRunId: "run-new",
    }))
    expect(post).toHaveBeenCalledWith(expect.objectContaining({
      type: "sessionRun.operation.error",
      operationId: "op-start-branch-a",
      operationKind: "start",
      branchBindingId: "main",
    }))
    expect(ensureSessionRunEventStream).not.toHaveBeenCalled()
  })

  it("accepts a capability ingest start run while an existing active run is still visible", async () => {
    const controller = new LabrastroController(context())
    const capabilityPackageIngestSessionStart = vi.fn(async () => ({
      session_run_id: "run-cap-new",
      session_id: "session-cap-new",
      branch_binding_id: "main",
      runtime_state: {
        workflow: "capability_package_ingest",
      },
    }))
    const prepareSessionRunSession = vi.fn(async () => ({ ok: true, sessionId: "session-cap-new" }))
    const ensureSessionRunEventStream = vi.fn()
    ;(controller as unknown as {
      client: { capabilityPackageIngestSessionStart: typeof capabilityPackageIngestSessionStart }
    }).client = { capabilityPackageIngestSessionStart }
    ;(controller as unknown as {
      sessionCoordinator: { prepareSessionRunSession: typeof prepareSessionRunSession }
    }).sessionCoordinator = { prepareSessionRunSession }
    ;(controller as unknown as {
      ensureSessionRunEventStream: typeof ensureSessionRunEventStream
    }).ensureSessionRunEventStream = ensureSessionRunEventStream
    setActiveRun(controller, { sessionRunId: "run-existing", sessionId: "session-existing", branchBindingId: "main" })
    const post = vi.fn()

    await (controller as unknown as {
      startCapabilityPackageIngestSession: (
        message: Record<string, unknown>,
        post: (message: Record<string, unknown>) => void,
      ) => Promise<void>
    }).startCapabilityPackageIngestSession({
      type: "capabilityPackage.ingest.session.start",
      operationId: "op-cap-start",
      payload: { source: { type: "github_repo", url: "https://github.com/acme/tool" } },
    }, post)

    expect(sessionRunCoordinator(controller).activeRun?.sessionRunId).toBe("run-cap-new")
    expect(post).toHaveBeenCalledWith(expect.objectContaining({
      type: "sessionRun.session",
      operationId: "op-cap-start",
      operationKind: "start",
      sessionRunId: "run-cap-new",
      sessionId: "session-cap-new",
    }))
    expect(ensureSessionRunEventStream).toHaveBeenCalledWith("run-cap-new", "session-cap-new", post, "main")
  })

  it("fails closed selected-visible controller operations without operation id", async () => {
    const controller = new LabrastroController(context())
    const client = {
      startSessionRun: vi.fn(),
      continueSessionRun: vi.fn(),
      steerAgentRun: vi.fn(),
      branchAgentRun: vi.fn(),
      selectSessionRunBranch: vi.fn(),
      recoverSessionRun: vi.fn(),
      cancelSessionRun: vi.fn(),
    }
    ;(controller as unknown as { client: typeof client }).client = client
    setActiveRun(controller, {
      sessionRunId: "run-current",
      sessionId: "session-current",
      branchBindingId: "main",
      agentRunId: "agent-main",
      activationId: "activation-main",
    })
    const post = vi.fn()

    await (controller as unknown as {
      startSessionRun: (
        text: string,
        requestedSessionId: string | undefined,
        post: (message: Record<string, unknown>) => void,
        options?: { providerId?: string; modelId?: string },
      ) => Promise<void>
    }).startSessionRun("start", "session-1", post, { providerId: "provider", modelId: "model" })
    await (controller as unknown as {
      continueSessionRun: (
        text: string,
        post: (message: Record<string, unknown>) => void,
        options?: { branchBindingId?: string },
      ) => Promise<void>
    }).continueSessionRun("continue", post, { branchBindingId: "main" })
    await (controller as unknown as {
      steerAgentRun: (
        text: string,
        post: (message: Record<string, unknown>) => void,
        options?: { clientSteerId?: string },
      ) => Promise<void>
    }).steerAgentRun("steer", post, { clientSteerId: "steer-1" })
    await (controller as unknown as {
      branchSessionRun: (
        request: { baseSessionItemId: string; prompt: string; branchBindingId: string },
        post: (message: Record<string, unknown>) => void,
      ) => Promise<void>
    }).branchSessionRun({ baseSessionItemId: "msg-1", prompt: "branch", branchBindingId: "branch-a" }, post)
    await (controller as unknown as {
      selectSessionRunBranch: (
        request: { branchBindingId: string },
        post: (message: Record<string, unknown>) => void,
      ) => Promise<void>
    }).selectSessionRunBranch({ branchBindingId: "branch-a" }, post)
    await (controller as unknown as {
      recoverSessionRun: (
        sessionRunId: string,
        branchBindingId: string,
        action: "continue" | "retry",
        post: (message: Record<string, unknown>) => void,
      ) => Promise<void>
    }).recoverSessionRun("run-current", "main", "retry", post)
    await (controller as unknown as {
      cancelSessionRun: (
        sessionRunId: string,
        branchBindingId: string,
        post: (message: Record<string, unknown>) => void,
      ) => Promise<void>
    }).cancelSessionRun("run-current", "main", post)

    expect(client.startSessionRun).not.toHaveBeenCalled()
    expect(client.continueSessionRun).not.toHaveBeenCalled()
    expect(client.steerAgentRun).not.toHaveBeenCalled()
    expect(client.branchAgentRun).not.toHaveBeenCalled()
    expect(client.selectSessionRunBranch).not.toHaveBeenCalled()
    expect(client.recoverSessionRun).not.toHaveBeenCalled()
    expect(client.cancelSessionRun).not.toHaveBeenCalled()
    expect(post).not.toHaveBeenCalledWith(expect.objectContaining({ type: "sessionRun.operation.pending" }))
    expect(post).not.toHaveBeenCalledWith(expect.objectContaining({ type: "sessionRun.operation.error" }))
  })

  it("keeps the existing active run when a new start operation fails before establishing a run", async () => {
    const controller = new LabrastroController(context())
    const startSessionRun = vi.fn(async () => {
      throw new Error("start failed")
    })
    const prepareSessionRunSession = vi.fn(async () => ({ ok: true, sessionId: "session-start" }))
    ;(controller as unknown as { client: { startSessionRun: typeof startSessionRun } }).client = { startSessionRun }
    ;(controller as unknown as {
      sessionCoordinator: { prepareSessionRunSession: typeof prepareSessionRunSession }
    }).sessionCoordinator = { prepareSessionRunSession }
    setActiveRun(controller, { sessionRunId: "run-existing", sessionId: "session-existing", branchBindingId: "main" })
    const post = vi.fn()

    await (controller as unknown as {
      startSessionRun: (
        text: string,
        requestedSessionId: string | undefined,
        post: (message: Record<string, unknown>) => void,
        options?: Record<string, unknown>,
      ) => Promise<void>
    }).startSessionRun("hello", "session-start", post, {
      providerId: "deepseek",
      modelId: "V4FLASH",
      operationId: "op-start-fail",
    })

    expect(sessionRunCoordinator(controller).activeRun?.sessionRunId).toBe("run-existing")
    expect(post).toHaveBeenCalledWith(expect.objectContaining({
      type: "sessionRun.operation.error",
      operationId: "op-start-fail",
      operationKind: "start",
      message: "start failed",
    }))
    expect(post).not.toHaveBeenCalledWith(expect.objectContaining({ type: "sessionRun.error" }))
  })

  it("ignores a stale branch creation response after the selected branch changes", async () => {
    const controller = new LabrastroController(context())
    const branch = deferred<Record<string, unknown>>()
    const branchAgentRun = vi.fn(() => branch.promise)
    const ensureSessionRunEventStreamSoon = vi.fn()
    ;(controller as unknown as { client: { branchAgentRun: typeof branchAgentRun } }).client = { branchAgentRun }
    ;(controller as unknown as {
      ensureSessionRunEventStreamSoon: typeof ensureSessionRunEventStreamSoon
    }).ensureSessionRunEventStreamSoon = ensureSessionRunEventStreamSoon
    setActiveRun(controller, { sessionRunId: "run-current", branchBindingId: "main" })
    const post = vi.fn()

    const pending = (controller as unknown as {
      branchSessionRun: (
        request: {
          sessionRunId?: string
          operationId?: string
          baseSessionItemId: string
          prompt: string
          sourceBranchBindingId?: string
          branchBindingId?: string
        },
        post: (message: Record<string, unknown>) => void,
      ) => Promise<void>
    }).branchSessionRun({
      sessionRunId: "run-current",
      operationId: "op-create-stale",
      baseSessionItemId: "msg-1",
      prompt: "try branch",
      sourceBranchBindingId: "main",
      branchBindingId: "branch-a",
    }, post)
    await Promise.resolve()
    setActiveRun(controller, { sessionRunId: "run-current", branchBindingId: "branch-b" })

    branch.resolve({
      agent_run: {
        id: "agent-branch-a",
        current_activation_id: "activation-branch-a",
      },
      branch_binding_id: "branch-a",
    })
    await pending

    expect(sessionRunCoordinator(controller).activeRun?.branchBindingId).toBe("branch-b")
    expect(post).not.toHaveBeenCalledWith(expect.objectContaining({
      type: "sessionRun.branch.started",
      branchBindingId: "branch-a",
    }))
    expect(post).toHaveBeenCalledWith(expect.objectContaining({
      type: "sessionRun.operation.error",
      operationId: "op-create-stale",
      operationKind: "branch.create",
      sessionRunId: "run-current",
      branchBindingId: "branch-a",
    }))
    expect(ensureSessionRunEventStreamSoon).not.toHaveBeenCalled()
  })

  it("ignores a stale branch selection response after a newer branch becomes selected", async () => {
    const controller = new LabrastroController(context())
    const select = deferred<Record<string, unknown>>()
    const selectSessionRunBranch = vi.fn(() => select.promise)
    const fetchSessionRunEventsBatch = vi.fn(async () => ({}))
    const ensureSessionRunEventStreamSoon = vi.fn()
    ;(controller as unknown as {
      client: {
        selectSessionRunBranch: typeof selectSessionRunBranch
        fetchSessionRunEventsBatch: typeof fetchSessionRunEventsBatch
      }
    }).client = { selectSessionRunBranch, fetchSessionRunEventsBatch }
    ;(controller as unknown as {
      ensureSessionRunEventStreamSoon: typeof ensureSessionRunEventStreamSoon
    }).ensureSessionRunEventStreamSoon = ensureSessionRunEventStreamSoon
    setActiveRun(controller, { sessionRunId: "run-current", branchBindingId: "main" })
    const post = vi.fn()

    const pending = (controller as unknown as {
      selectSessionRunBranch: (
        request: { sessionRunId?: string; sourceBranchBindingId?: string; branchBindingId: string; operationId?: string },
        post: (message: Record<string, unknown>) => void,
      ) => Promise<void>
    }).selectSessionRunBranch({ sessionRunId: "run-current", sourceBranchBindingId: "main", branchBindingId: "branch-a", operationId: "op-select-stale" }, post)
    await Promise.resolve()
    setActiveRun(controller, { sessionRunId: "run-current", branchBindingId: "branch-b" })

    select.resolve({
      session_run_id: "run-current",
      session_id: "session-current",
      branch_binding_id: "branch-a",
      agent_run_id: "agent-branch-a",
      status: "idle",
      branches: [
        { branch_binding_id: "branch-a", selected: true },
        { branch_binding_id: "branch-b", selected: false },
      ],
    })
    await pending

    expect(sessionRunCoordinator(controller).activeRun?.branchBindingId).toBe("branch-b")
    expect(post).not.toHaveBeenCalledWith(expect.objectContaining({
      type: "sessionRun.branch.selected",
      branchBindingId: "branch-a",
    }))
    expect(post).toHaveBeenCalledWith(expect.objectContaining({
      type: "sessionRun.operation.error",
      operationId: "op-select-stale",
      operationKind: "branch.select",
      sessionRunId: "run-current",
      branchBindingId: "branch-a",
    }))
    expect(fetchSessionRunEventsBatch).not.toHaveBeenCalled()
    expect(ensureSessionRunEventStreamSoon).not.toHaveBeenCalled()
  })

  it("rejects branch creation when the current active run lost the source agentRunId", async () => {
    const controller = new LabrastroController(context())
    const branch = deferred<Record<string, unknown>>()
    const branchAgentRun = vi.fn(() => branch.promise)
    const ensureSessionRunEventStreamSoon = vi.fn()
    ;(controller as unknown as { client: { branchAgentRun: typeof branchAgentRun } }).client = { branchAgentRun }
    ;(controller as unknown as {
      ensureSessionRunEventStreamSoon: typeof ensureSessionRunEventStreamSoon
    }).ensureSessionRunEventStreamSoon = ensureSessionRunEventStreamSoon
    setActiveRun(controller, {
      sessionRunId: "run-current",
      branchBindingId: "main",
      agentRunId: "agent-current",
    })
    const post = vi.fn()

    const pending = (controller as unknown as {
      branchSessionRun: (
        request: {
          sessionRunId?: string
          operationId?: string
          baseSessionItemId: string
          prompt: string
          sourceBranchBindingId?: string
          branchBindingId?: string
        },
        post: (message: Record<string, unknown>) => void,
      ) => Promise<void>
    }).branchSessionRun({
      sessionRunId: "run-current",
      operationId: "op-create-a",
      baseSessionItemId: "msg-1",
      prompt: "try branch",
      sourceBranchBindingId: "main",
      branchBindingId: "branch-a",
    }, post)
    await Promise.resolve()
    setActiveRun(controller, {
      sessionRunId: "run-current",
      branchBindingId: "main",
      agentRunId: undefined,
    })

    branch.resolve({
      agent_run: {
        id: "agent-branch-a",
        current_activation_id: "activation-branch-a",
      },
      branch_binding_id: "branch-a",
    })
    await pending

    expect(post).not.toHaveBeenCalledWith(expect.objectContaining({
      type: "sessionRun.branch.started",
      branchBindingId: "branch-a",
    }))
    expect(ensureSessionRunEventStreamSoon).not.toHaveBeenCalled()
  })

  it("rejects a stale branch selection response after the active branch changes away and back", async () => {
    const controller = new LabrastroController(context())
    const select = deferred<Record<string, unknown>>()
    const selectSessionRunBranch = vi.fn(() => select.promise)
    const fetchSessionRunEventsBatch = vi.fn(async () => ({}))
    const ensureSessionRunEventStreamSoon = vi.fn()
    ;(controller as unknown as {
      client: {
        selectSessionRunBranch: typeof selectSessionRunBranch
        fetchSessionRunEventsBatch: typeof fetchSessionRunEventsBatch
      }
    }).client = { selectSessionRunBranch, fetchSessionRunEventsBatch }
    ;(controller as unknown as {
      ensureSessionRunEventStreamSoon: typeof ensureSessionRunEventStreamSoon
    }).ensureSessionRunEventStreamSoon = ensureSessionRunEventStreamSoon
    setActiveRun(controller, { sessionRunId: "run-current", branchBindingId: "main" })
    const post = vi.fn()

    const pending = (controller as unknown as {
      selectSessionRunBranch: (
        request: { sessionRunId?: string; sourceBranchBindingId?: string; operationId?: string; branchBindingId: string },
        post: (message: Record<string, unknown>) => void,
      ) => Promise<void>
    }).selectSessionRunBranch({ sessionRunId: "run-current", sourceBranchBindingId: "main", operationId: "op-select-aba", branchBindingId: "branch-a" }, post)
    await Promise.resolve()
    setActiveRun(controller, { sessionRunId: "run-current", branchBindingId: "branch-b" })
    setActiveRun(controller, { sessionRunId: "run-current", branchBindingId: "main" })

    select.resolve({
      session_run_id: "run-current",
      session_id: "session-current",
      branch_binding_id: "branch-a",
      agent_run_id: "agent-branch-a",
      status: "idle",
      branches: [{ branch_binding_id: "branch-a", selected: true }],
    })
    await pending

    expect(sessionRunCoordinator(controller).activeRun?.branchBindingId).toBe("main")
    expect(post).not.toHaveBeenCalledWith(expect.objectContaining({
      type: "sessionRun.branch.selected",
      branchBindingId: "branch-a",
    }))
    expect(fetchSessionRunEventsBatch).not.toHaveBeenCalled()
    expect(ensureSessionRunEventStreamSoon).not.toHaveBeenCalled()
  })

  it("rejects branch selection when the active run has no source agentRunId", async () => {
    const controller = new LabrastroController(context())
    const selectSessionRunBranch = vi.fn(async () => ({
      session_run_id: "run-current",
      session_id: "session-current",
      branch_binding_id: "branch-a",
      agent_run_id: "agent-branch-a",
      status: "idle",
      branches: [{ branch_binding_id: "branch-a", selected: true }],
    }))
    const fetchSessionRunEventsBatch = vi.fn(async () => ({}))
    const ensureSessionRunEventStreamSoon = vi.fn()
    ;(controller as unknown as {
      client: {
        selectSessionRunBranch: typeof selectSessionRunBranch
        fetchSessionRunEventsBatch: typeof fetchSessionRunEventsBatch
      }
    }).client = { selectSessionRunBranch, fetchSessionRunEventsBatch }
    ;(controller as unknown as {
      ensureSessionRunEventStreamSoon: typeof ensureSessionRunEventStreamSoon
    }).ensureSessionRunEventStreamSoon = ensureSessionRunEventStreamSoon
    setActiveRun(controller, {
      sessionRunId: "run-current",
      branchBindingId: "main",
      agentRunId: undefined,
    })
    const post = vi.fn()

    await (controller as unknown as {
      selectSessionRunBranch: (
        request: { sessionRunId?: string; sourceBranchBindingId?: string; operationId?: string; branchBindingId: string },
        post: (message: Record<string, unknown>) => void,
      ) => Promise<void>
    }).selectSessionRunBranch({ sessionRunId: "run-current", sourceBranchBindingId: "main", operationId: "op-select-no-source-agent", branchBindingId: "branch-a" }, post)

    expect(sessionRunCoordinator(controller).activeRun?.branchBindingId).toBe("main")
    expect(post).not.toHaveBeenCalledWith(expect.objectContaining({
      type: "sessionRun.branch.selected",
      branchBindingId: "branch-a",
    }))
    expect(fetchSessionRunEventsBatch).not.toHaveBeenCalled()
    expect(ensureSessionRunEventStreamSoon).not.toHaveBeenCalled()
  })

  it("rejects stale continue success after the active branch changes", async () => {
    const controller = new LabrastroController(context())
    const continued = deferred<Record<string, unknown>>()
    const continueSessionRun = vi.fn(() => continued.promise)
    const ensureSessionRunEventStream = vi.fn()
    ;(controller as unknown as { client: { continueSessionRun: typeof continueSessionRun } }).client = { continueSessionRun }
    ;(controller as unknown as {
      ensureSessionRunEventStream: typeof ensureSessionRunEventStream
    }).ensureSessionRunEventStream = ensureSessionRunEventStream
    setActiveRun(controller, {
      sessionRunId: "run-current",
      branchBindingId: "main",
      agentRunId: "agent-main",
    })
    const post = vi.fn()

    const pending = (controller as unknown as {
      continueSessionRun: (
        text: string,
        post: (message: Record<string, unknown>) => void,
        options?: { sessionRunId?: string; branchBindingId?: string; clientRequestId?: string; operationId?: string },
      ) => Promise<void>
    }).continueSessionRun("continue on main", post, {
      sessionRunId: "run-current",
      branchBindingId: "main",
      clientRequestId: "continue-1",
      operationId: "op-continue-stale",
    })
    await Promise.resolve()
    setActiveRun(controller, {
      sessionRunId: "run-current",
      branchBindingId: "branch-b",
      agentRunId: "agent-branch-b",
    })

    continued.resolve({
      session_run_id: "run-current",
      branch_binding_id: "main",
      agent_run_id: "agent-main",
      activation_id: "activation-main-2",
    })
    await pending

    expect(sessionRunCoordinator(controller).activeRun?.branchBindingId).toBe("branch-b")
    expect(sessionRunCoordinator(controller).activeRun?.agentRunId).toBe("agent-branch-b")
    expect(post).not.toHaveBeenCalledWith(expect.objectContaining({
      type: "sessionRun.continued",
      branchBindingId: "main",
    }))
    expect(post).toHaveBeenCalledWith(expect.objectContaining({
      type: "sessionRun.operation.error",
      operationId: "op-continue-stale",
      operationKind: "continue",
      sessionRunId: "run-current",
      branchBindingId: "main",
    }))
    expect(ensureSessionRunEventStream).not.toHaveBeenCalled()
  })

  it("rejects continue success without response agent proof", async () => {
    const controller = new LabrastroController(context())
    const continueSessionRun = vi.fn(async () => ({
      session_run_id: "run-current",
      branch_binding_id: "main",
      activation_id: "activation-main-2",
    }))
    ;(controller as unknown as { client: { continueSessionRun: typeof continueSessionRun } }).client = { continueSessionRun }
    setActiveRun(controller, {
      sessionRunId: "run-current",
      branchBindingId: "main",
      agentRunId: "agent-main",
    })
    const post = vi.fn()

    await (controller as unknown as {
      continueSessionRun: (
        text: string,
        post: (message: Record<string, unknown>) => void,
        options?: { sessionRunId?: string; branchBindingId?: string; clientRequestId?: string; operationId?: string },
      ) => Promise<void>
    }).continueSessionRun("continue on main", post, {
      sessionRunId: "run-current",
      branchBindingId: "main",
      clientRequestId: "continue-missing-agent",
      operationId: "op-continue-missing-agent",
    })

    expect(post).toHaveBeenCalledWith(expect.objectContaining({
      type: "sessionRun.operation.error",
      operationId: "op-continue-missing-agent",
      operationKind: "continue",
      sessionRunId: "run-current",
      branchBindingId: "main",
    }))
    expect(post).not.toHaveBeenCalledWith(expect.objectContaining({
      type: "sessionRun.continued",
      branchBindingId: "main",
    }))
  })

  it("rejects stale recover success after the active branch changes", async () => {
    const controller = new LabrastroController(context())
    const recovered = deferred<void>()
    const recoverSessionRun = vi.fn(() => recovered.promise)
    const sessionRunStatus = vi.fn(async () => ({
      session_run_id: "run-current",
      session_id: "session-current",
      branch_binding_id: "main",
      agent_run_id: "agent-main",
      activation_id: "activation-main-recovered",
      next_cursor: 0,
      runtime_state: {},
      approvals: [],
    }))
    const consumeSessionRunEventStream = vi.fn(async () => undefined)
    ;(controller as unknown as {
      client: {
        recoverSessionRun: typeof recoverSessionRun
        sessionRunStatus: typeof sessionRunStatus
      }
    }).client = { recoverSessionRun, sessionRunStatus }
    ;(controller as unknown as {
      consumeSessionRunEventStream: typeof consumeSessionRunEventStream
    }).consumeSessionRunEventStream = consumeSessionRunEventStream
    setActiveRun(controller, {
      sessionRunId: "run-current",
      branchBindingId: "main",
      agentRunId: "agent-main",
    })
    const post = vi.fn()

    const pending = (controller as unknown as {
      recoverSessionRun: (
        sessionRunId: string,
        branchBindingId: string,
        action: "continue" | "retry",
        post: (message: Record<string, unknown>) => void,
        options?: { operationId?: string },
      ) => Promise<void>
    }).recoverSessionRun("run-current", "main", "retry", post, { operationId: "op-recover-stale" })
    await Promise.resolve()
    setActiveRun(controller, {
      sessionRunId: "run-current",
      branchBindingId: "branch-b",
      agentRunId: "agent-branch-b",
    })

    recovered.resolve()
    await pending

    expect(sessionRunCoordinator(controller).activeRun?.branchBindingId).toBe("branch-b")
    expect(sessionRunCoordinator(controller).activeRun?.agentRunId).toBe("agent-branch-b")
    expect(post).not.toHaveBeenCalledWith(expect.objectContaining({
      type: "sessionRun.resume",
    }))
    expect(post).toHaveBeenCalledWith(expect.objectContaining({
      type: "sessionRun.operation.error",
      operationId: "op-recover-stale",
      operationKind: "recover",
      sessionRunId: "run-current",
      branchBindingId: "main",
    }))
    expect(consumeSessionRunEventStream).not.toHaveBeenCalled()
  })

  it("preserves recovered status branch agent identities", async () => {
    const controller = new LabrastroController(context())
    const recoverSessionRun = vi.fn(async () => undefined)
    const sessionRunStatus = vi.fn(async () => ({
      session_run_id: "run-current",
      session_id: "session-current",
      branch_binding_id: "main",
      agent_run_id: "agent-main",
      activation_id: "activation-main-recovered",
      next_cursor: 0,
      status: "running",
      runtime_state: {},
      branches: [
        { branch_binding_id: "main", agent_run_id: "agent-main", selected: true },
        { branch_binding_id: "branch-a", agent_run_id: "agent-branch-a", selected: false },
      ],
      approvals: [],
    }))
    const consumeSessionRunEventStream = vi.fn(async () => undefined)
    ;(controller as unknown as {
      client: {
        recoverSessionRun: typeof recoverSessionRun
        sessionRunStatus: typeof sessionRunStatus
      }
    }).client = { recoverSessionRun, sessionRunStatus }
    ;(controller as unknown as {
      consumeSessionRunEventStream: typeof consumeSessionRunEventStream
    }).consumeSessionRunEventStream = consumeSessionRunEventStream
    setActiveRun(controller, {
      sessionRunId: "run-current",
      branchBindingId: "main",
      agentRunId: "agent-main",
    })
    const post = vi.fn()

    await (controller as unknown as {
      recoverSessionRun: (
        sessionRunId: string,
        branchBindingId: string,
        action: "continue" | "retry",
        post: (message: Record<string, unknown>) => void,
        options?: { operationId?: string },
      ) => Promise<void>
    }).recoverSessionRun("run-current", "main", "retry", post, { operationId: "op-recover-branches" })

    expect(sessionRunCoordinator(controller).activeRun?.branches).toEqual([
      { branch_binding_id: "main", agent_run_id: "agent-main", selected: true },
      { branch_binding_id: "branch-a", agent_run_id: "agent-branch-a", selected: false },
    ])
    expect(post).toHaveBeenCalledWith(expect.objectContaining({
      type: "sessionRun.resume",
      payload: expect.objectContaining({
        branchBindingId: "main",
        status: "running",
      }),
    }))
  })

  it("rejects recover status success without response branch proof", async () => {
    const controller = new LabrastroController(context())
    const recoverSessionRun = vi.fn(async () => undefined)
    const sessionRunStatus = vi.fn(async () => ({
      session_run_id: "run-current",
      session_id: "session-current",
      agent_run_id: "agent-main",
      next_cursor: 0,
      status: "running",
      runtime_state: {},
      approvals: [],
    }))
    const consumeSessionRunEventStream = vi.fn(async () => undefined)
    ;(controller as unknown as {
      client: {
        recoverSessionRun: typeof recoverSessionRun
        sessionRunStatus: typeof sessionRunStatus
      }
    }).client = { recoverSessionRun, sessionRunStatus }
    ;(controller as unknown as {
      consumeSessionRunEventStream: typeof consumeSessionRunEventStream
    }).consumeSessionRunEventStream = consumeSessionRunEventStream
    setActiveRun(controller, {
      sessionRunId: "run-current",
      branchBindingId: "main",
      agentRunId: "agent-main",
    })
    const post = vi.fn()

    await (controller as unknown as {
      recoverSessionRun: (
        sessionRunId: string,
        branchBindingId: string,
        action: "continue" | "retry",
        post: (message: Record<string, unknown>) => void,
        options?: { operationId?: string },
      ) => Promise<void>
    }).recoverSessionRun("run-current", "main", "retry", post, { operationId: "op-recover-missing-branch" })

    expect(post).toHaveBeenCalledWith(expect.objectContaining({
      type: "sessionRun.operation.error",
      operationId: "op-recover-missing-branch",
      operationKind: "recover",
      sessionRunId: "run-current",
      branchBindingId: "main",
    }))
    expect(post).not.toHaveBeenCalledWith(expect.objectContaining({
      type: "sessionRun.resume",
    }))
    expect(consumeSessionRunEventStream).not.toHaveBeenCalled()
  })

  it("rejects stale steer success after the active branch changes", async () => {
    const controller = new LabrastroController(context())
    const steered = deferred<Record<string, unknown>>()
    const steerAgentRun = vi.fn(() => steered.promise)
    ;(controller as unknown as { client: { steerAgentRun: typeof steerAgentRun } }).client = { steerAgentRun }
    setActiveRun(controller, {
      sessionRunId: "run-current",
      branchBindingId: "main",
      agentRunId: "agent-main",
      activationId: "activation-main",
    })
    const post = vi.fn()

    const pending = (controller as unknown as {
      steerAgentRun: (
        text: string,
        post: (message: Record<string, unknown>) => void,
        options?: { clientSteerId?: string; operationId?: string; sessionRunId?: string; branchBindingId?: string },
      ) => Promise<void>
    }).steerAgentRun("steer main", post, {
      clientSteerId: "steer-1",
      operationId: "op-steer-stale",
      sessionRunId: "run-current",
      branchBindingId: "main",
    })
    await Promise.resolve()
    setActiveRun(controller, {
      sessionRunId: "run-current",
      branchBindingId: "branch-b",
      agentRunId: "agent-branch-b",
      activationId: "activation-branch-b",
    })

    steered.resolve({ status: "accepted" })
    await pending

    expect(post).not.toHaveBeenCalledWith(expect.objectContaining({
      type: "sessionRun.steer",
      sessionRunId: "run-current",
    }))
    expect(post).toHaveBeenCalledWith(expect.objectContaining({
      type: "sessionRun.operation.error",
      operationId: "op-steer-stale",
      operationKind: "steer",
      sessionRunId: "run-current",
      branchBindingId: "main",
    }))
  })

  it("rejects stale steer fallback after the active branch changes", async () => {
    const controller = new LabrastroController(context())
    const steered = deferred<Record<string, unknown>>()
    const steerAgentRun = vi.fn(() => steered.promise)
    ;(controller as unknown as { client: { steerAgentRun: typeof steerAgentRun } }).client = { steerAgentRun }
    setActiveRun(controller, {
      sessionRunId: "run-current",
      branchBindingId: "main",
      agentRunId: "agent-main",
      activationId: "activation-main",
    })
    const post = vi.fn()

    const pending = (controller as unknown as {
      steerAgentRun: (
        text: string,
        post: (message: Record<string, unknown>) => void,
        options?: { clientSteerId?: string; operationId?: string; sessionRunId?: string; branchBindingId?: string },
      ) => Promise<void>
    }).steerAgentRun("queue main", post, {
      clientSteerId: "steer-2",
      operationId: "op-steer-fallback-stale",
      sessionRunId: "run-current",
      branchBindingId: "main",
    })
    await Promise.resolve()
    setActiveRun(controller, {
      sessionRunId: "run-current",
      branchBindingId: "branch-b",
      agentRunId: "agent-branch-b",
      activationId: "activation-branch-b",
    })

    steered.reject(new RemoteError(409, "agent_run_not_steerable", "not steerable", {}))
    await pending

    expect(post).not.toHaveBeenCalledWith(expect.objectContaining({
      type: "sessionRun.pendingNextTurn",
      branchBindingId: "main",
    }))
    expect(post).toHaveBeenCalledWith(expect.objectContaining({
      type: "sessionRun.operation.error",
      operationId: "op-steer-fallback-stale",
      operationKind: "steer",
      sessionRunId: "run-current",
      branchBindingId: "main",
    }))
    expect(sessionRunCoordinator(controller).activeRun?.pendingNextTurnsByBranch).not.toHaveProperty("run-current:main")
  })

  it("wraps idle steer fallback in a visible operation pending/result pair", async () => {
    const controller = new LabrastroController(context())
    setActiveRun(controller, {
      sessionRunId: "run-current",
      branchBindingId: "main",
      agentRunId: "agent-main",
      activationId: undefined,
      status: "idle",
    })
    const post = vi.fn()

    await (controller as unknown as {
      steerAgentRun: (
        text: string,
        post: (message: Record<string, unknown>) => void,
        options?: { clientSteerId?: string; operationId?: string; sessionRunId?: string; branchBindingId?: string },
      ) => Promise<void>
    }).steerAgentRun("queue main", post, {
      clientSteerId: "steer-idle",
      operationId: "op-steer-idle",
      sessionRunId: "run-current",
      branchBindingId: "main",
    })

    const postedMessages = post.mock.calls.map(([message]) => message)
    const pendingIndex = postedMessages.findIndex((message) =>
      message?.type === "sessionRun.operation.pending" &&
      message.operationId === "op-steer-idle" &&
      message.operationKind === "steer"
    )
    const steerIndex = postedMessages.findIndex((message) =>
      message?.type === "sessionRun.steer" &&
      message.operationId === "op-steer-idle" &&
      message.operationKind === "steer" &&
      message.status === "queued_next_turn"
    )

    expect(pendingIndex).toBeGreaterThanOrEqual(0)
    expect(steerIndex).toBeGreaterThan(pendingIndex)
    expect(postedMessages).toContainEqual(expect.objectContaining({
      type: "sessionRun.pendingNextTurn",
      sessionRunId: "run-current",
      branchBindingId: "main",
    }))
  })

  it("echoes matching continue operation identity on success", async () => {
    const controller = new LabrastroController(context())
    const continueSessionRun = vi.fn(async () => ({
      session_run_id: "run-current",
      branch_binding_id: "branch-a",
      agent_run_id: "agent-branch-a",
      activation_id: "activation-next",
    }))
    const ensureSessionRunEventStream = vi.fn()
    ;(controller as unknown as { client: { continueSessionRun: typeof continueSessionRun } }).client = { continueSessionRun }
    ;(controller as unknown as {
      ensureSessionRunEventStream: typeof ensureSessionRunEventStream
    }).ensureSessionRunEventStream = ensureSessionRunEventStream
    setActiveRun(controller, {
      sessionRunId: "run-current",
      branchBindingId: "branch-a",
      agentRunId: "agent-branch-a",
      status: "idle",
    })
    const post = vi.fn()

    await (controller as unknown as {
      continueSessionRun: (
        text: string,
        post: (message: Record<string, unknown>) => void,
        options?: { sessionRunId?: string; branchBindingId?: string; clientRequestId?: string; operationId?: string },
      ) => Promise<void>
    }).continueSessionRun("continue on branch", post, {
      sessionRunId: "run-current",
      branchBindingId: "branch-a",
      clientRequestId: "continue-branch-a",
      operationId: "op-continue",
    })

    expect(post).toHaveBeenCalledWith(expect.objectContaining({
      type: "sessionRun.continued",
      operationId: "op-continue",
      operationKind: "continue",
      sessionRunId: "run-current",
      branchBindingId: "branch-a",
    }))
    expect(ensureSessionRunEventStream).toHaveBeenCalledWith("run-current", "session-current", post, "branch-a")
  })

  it("reports continue failures through operation error without terminal run failure", async () => {
    const controller = new LabrastroController(context())
    const continueSessionRun = vi.fn(async () => {
      throw new Error("continue failed")
    })
    ;(controller as unknown as { client: { continueSessionRun: typeof continueSessionRun } }).client = { continueSessionRun }
    setActiveRun(controller, {
      sessionRunId: "run-current",
      branchBindingId: "branch-a",
      agentRunId: "agent-branch-a",
      status: "idle",
    })
    const post = vi.fn()

    await (controller as unknown as {
      continueSessionRun: (
        text: string,
        post: (message: Record<string, unknown>) => void,
        options?: { sessionRunId?: string; branchBindingId?: string; operationId?: string },
      ) => Promise<void>
    }).continueSessionRun("continue on branch", post, {
      sessionRunId: "run-current",
      branchBindingId: "branch-a",
      operationId: "op-continue-fail",
    })

    expect(post).toHaveBeenCalledWith(expect.objectContaining({
      type: "sessionRun.operation.error",
      operationId: "op-continue-fail",
      operationKind: "continue",
      sessionRunId: "run-current",
      branchBindingId: "branch-a",
      message: "continue failed",
    }))
    expect(post).not.toHaveBeenCalledWith(expect.objectContaining({ type: "sessionRun.error" }))
  })

  it("reports steer failures through operation error without terminal run failure", async () => {
    const controller = new LabrastroController(context())
    const steerAgentRun = vi.fn(async () => {
      throw new Error("steer failed")
    })
    ;(controller as unknown as { client: { steerAgentRun: typeof steerAgentRun } }).client = { steerAgentRun }
    setActiveRun(controller, {
      sessionRunId: "run-current",
      branchBindingId: "branch-a",
      agentRunId: "agent-branch-a",
      activationId: "activation-a",
      status: "running",
    })
    const post = vi.fn()

    await (controller as unknown as {
      steerAgentRun: (
        text: string,
        post: (message: Record<string, unknown>) => void,
        options?: { clientSteerId?: string; operationId?: string; sessionRunId?: string; branchBindingId?: string },
      ) => Promise<void>
    }).steerAgentRun("steer branch", post, {
      clientSteerId: "steer-1",
      operationId: "op-steer-fail",
      sessionRunId: "run-current",
      branchBindingId: "branch-a",
    })

    expect(post).toHaveBeenCalledWith(expect.objectContaining({
      type: "sessionRun.operation.error",
      operationId: "op-steer-fail",
      operationKind: "steer",
      sessionRunId: "run-current",
      branchBindingId: "branch-a",
      message: "steer failed",
    }))
    expect(post).not.toHaveBeenCalledWith(expect.objectContaining({ type: "sessionRun.error" }))
  })

  it("reports recover precheck failures through operation error without terminal run failure", async () => {
    const controller = new LabrastroController(context())
    const recoverSessionRun = vi.fn()
    ;(controller as unknown as { client: { recoverSessionRun: typeof recoverSessionRun } }).client = { recoverSessionRun }
    setActiveRun(controller, {
      sessionRunId: "run-current",
      branchBindingId: "branch-a",
      agentRunId: undefined,
      status: "running",
    })
    const post = vi.fn()

    await (controller as unknown as {
      recoverSessionRun: (
        sessionRunId: string,
        branchBindingId: string,
        action: "continue" | "retry",
        post: (message: Record<string, unknown>) => void,
        options?: { operationId?: string },
      ) => Promise<void>
    }).recoverSessionRun("run-current", "branch-a", "retry", post, {
      operationId: "op-recover-precheck",
    })

    expect(recoverSessionRun).not.toHaveBeenCalled()
    expect(post).toHaveBeenCalledWith(expect.objectContaining({
      type: "sessionRun.operation.error",
      operationId: "op-recover-precheck",
      operationKind: "recover",
      sessionRunId: "run-current",
      branchBindingId: "branch-a",
      message: "当前会话没有可恢复的 AgentRun mainline。",
    }))
    expect(post).not.toHaveBeenCalledWith(expect.objectContaining({ type: "sessionRun.error" }))
  })

  it("echoes matching cancel operation identity on success", async () => {
    const controller = new LabrastroController(context())
    const cancelSessionRun = vi.fn(async () => undefined)
    ;(controller as unknown as { client: { cancelSessionRun: typeof cancelSessionRun } }).client = { cancelSessionRun }
    setActiveRun(controller, {
      sessionRunId: "run-current",
      branchBindingId: "branch-a",
      agentRunId: "agent-branch-a",
      status: "running",
    })
    const post = vi.fn()

    await (controller as unknown as {
      cancelSessionRun: (
        sessionRunId: string | undefined,
        branchBindingId: string | undefined,
        post: (message: Record<string, unknown>) => void,
        options?: { operationId?: string },
      ) => Promise<void>
    }).cancelSessionRun("run-current", "branch-a", post, {
      operationId: "op-cancel",
    })

    expect(cancelSessionRun).toHaveBeenCalledWith("run-current", "user_cancelled", "branch-a")
    expect(sessionRunCoordinator(controller).activeRun).toBeUndefined()
    expect(post).toHaveBeenCalledWith(expect.objectContaining({
      type: "sessionRun.cancelled",
      operationId: "op-cancel",
      operationKind: "cancel",
      sessionRunId: "run-current",
      branchBindingId: "branch-a",
    }))
  })

  it("reports stale cancel success through operation error instead of silently leaving pending UI", async () => {
    const controller = new LabrastroController(context())
    const cancelled = deferred<void>()
    const cancelSessionRun = vi.fn(() => cancelled.promise)
    ;(controller as unknown as { client: { cancelSessionRun: typeof cancelSessionRun } }).client = { cancelSessionRun }
    setActiveRun(controller, {
      sessionRunId: "run-current",
      branchBindingId: "branch-a",
      agentRunId: "agent-branch-a",
      status: "running",
    })
    const post = vi.fn()

    const pending = (controller as unknown as {
      cancelSessionRun: (
        sessionRunId: string | undefined,
        branchBindingId: string | undefined,
        post: (message: Record<string, unknown>) => void,
        options?: { operationId?: string },
      ) => Promise<void>
    }).cancelSessionRun("run-current", "branch-a", post, {
      operationId: "op-cancel-stale",
    })
    await Promise.resolve()
    setActiveRun(controller, {
      sessionRunId: "run-current",
      branchBindingId: "branch-b",
      agentRunId: "agent-branch-b",
      status: "running",
    })

    cancelled.resolve()
    await pending

    expect(sessionRunCoordinator(controller).activeRun?.branchBindingId).toBe("branch-b")
    expect(post).not.toHaveBeenCalledWith(expect.objectContaining({
      type: "sessionRun.cancelled",
      branchBindingId: "branch-a",
    }))
    expect(post).toHaveBeenCalledWith(expect.objectContaining({
      type: "sessionRun.operation.error",
      operationId: "op-cancel-stale",
      operationKind: "cancel",
      sessionRunId: "run-current",
      branchBindingId: "branch-a",
    }))
  })

  it("requires explicit cancel identity instead of falling back to the active run", async () => {
    const controller = new LabrastroController(context())
    const cancelSessionRun = vi.fn(async () => undefined)
    ;(controller as unknown as { client: { cancelSessionRun: typeof cancelSessionRun } }).client = { cancelSessionRun }
    setActiveRun(controller, {
      sessionRunId: "run-current",
      branchBindingId: "branch-a",
      agentRunId: "agent-branch-a",
      status: "running",
    })
    const post = vi.fn()

    await (controller as unknown as {
      cancelSessionRun: (
        sessionRunId: string | undefined,
        branchBindingId: string | undefined,
        post: (message: Record<string, unknown>) => void,
        options?: { operationId?: string },
      ) => Promise<void>
    }).cancelSessionRun(undefined, undefined, post, {
      operationId: "op-cancel-missing-proof",
    })

    expect(cancelSessionRun).not.toHaveBeenCalled()
    expect(sessionRunCoordinator(controller).activeRun?.sessionRunId).toBe("run-current")
    expect(post).toHaveBeenCalledWith(expect.objectContaining({
      type: "sessionRun.operation.error",
      operationId: "op-cancel-missing-proof",
      operationKind: "cancel",
      message: "当前没有正在运行的会话。",
    }))
    expect(post).not.toHaveBeenCalledWith(expect.objectContaining({
      type: "sessionRun.cancelled",
    }))
  })

  it("reports cancel failures through operation error without terminal run failure", async () => {
    const controller = new LabrastroController(context())
    const cancelSessionRun = vi.fn(async () => {
      throw new Error("cancel failed")
    })
    ;(controller as unknown as { client: { cancelSessionRun: typeof cancelSessionRun } }).client = { cancelSessionRun }
    setActiveRun(controller, {
      sessionRunId: "run-current",
      branchBindingId: "branch-a",
      agentRunId: "agent-branch-a",
      status: "running",
    })
    const post = vi.fn()

    await (controller as unknown as {
      cancelSessionRun: (
        sessionRunId: string | undefined,
        branchBindingId: string | undefined,
        post: (message: Record<string, unknown>) => void,
        options?: { operationId?: string },
      ) => Promise<void>
    }).cancelSessionRun("run-current", "branch-a", post, {
      operationId: "op-cancel-fail",
    })

    expect(sessionRunCoordinator(controller).activeRun?.sessionRunId).toBe("run-current")
    expect(post).toHaveBeenCalledWith(expect.objectContaining({
      type: "sessionRun.operation.error",
      operationId: "op-cancel-fail",
      operationKind: "cancel",
      sessionRunId: "run-current",
      branchBindingId: "branch-a",
      message: "停止失败：cancel failed",
    }))
    expect(post).not.toHaveBeenCalledWith(expect.objectContaining({ type: "sessionRun.error" }))
  })

  it("continues a branch-local pending next turn without switching the selected branch", async () => {
    const controller = new LabrastroController(context())
    const continueSessionRun = vi.fn(async () => ({
      session_run_id: "run-current",
      branch_binding_id: "branch-a",
      agent_run_id: "agent-branch-a",
      activation_id: "activation-branch-a-2",
    }))
    const ensureSessionRunEventStream = vi.fn()
    ;(controller as unknown as { client: { continueSessionRun: typeof continueSessionRun } }).client = { continueSessionRun }
    ;(controller as unknown as {
      ensureSessionRunEventStream: typeof ensureSessionRunEventStream
    }).ensureSessionRunEventStream = ensureSessionRunEventStream
    setActiveRun(controller, {
      sessionRunId: "run-current",
      sessionId: "session-current",
      branchBindingId: "branch-b",
      agentRunId: "agent-branch-b",
      status: "idle",
      branches: [
        { branch_binding_id: "branch-a", agent_run_id: "agent-branch-a", selected: false },
        { branch_binding_id: "branch-b", agent_run_id: "agent-branch-b", selected: true },
      ],
      pendingNextTurnsByBranch: {
        "run-current:branch-a": [{
          text: "queued on A",
          sessionRunId: "run-current",
          branchBindingId: "branch-a",
          clientRequestId: "queued-a",
          queuedAt: "2026-06-18T00:00:00.000Z",
        }],
      },
    })
    const post = vi.fn()

    await (controller as unknown as {
      continueSessionRun: (
        text: string,
        post: (message: Record<string, unknown>) => void,
        options?: {
          sessionRunId?: string
          branchBindingId?: string
          clientRequestId?: string
          sourceScope?: "branch-local"
        },
      ) => Promise<void>
    }).continueSessionRun("queued on A", post, {
      sourceScope: "branch-local",
      sessionRunId: "run-current",
      branchBindingId: "branch-a",
      clientRequestId: "queued-a",
    })

    expect(continueSessionRun).toHaveBeenCalledWith(expect.objectContaining({
      sessionRunId: "run-current",
      branchBindingId: "branch-a",
      prompt: "queued on A",
      clientRequestId: "queued-a",
    }))
    expect(sessionRunCoordinator(controller).activeRun?.branchBindingId).toBe("branch-b")
    expect(sessionRunCoordinator(controller).activeRun?.agentRunId).toBe("agent-branch-b")
    expect(sessionRunCoordinator(controller).pendingNextTurnForBranch("run-current", "branch-a")).toBeUndefined()
    expect(ensureSessionRunEventStream).toHaveBeenCalledWith("run-current", "session-current", post, "branch-a")
    expect(post).not.toHaveBeenCalledWith(expect.objectContaining({
      type: "sessionRun.operation.pending",
      operationKind: "continue",
    }))
  })

  it("continues a branch-local pending next turn and resumes stream when its branch is selected", async () => {
    const controller = new LabrastroController(context())
    const continueSessionRun = vi.fn(async () => ({
      session_run_id: "run-current",
      branch_binding_id: "branch-a",
      agent_run_id: "agent-branch-a",
      activation_id: "activation-branch-a-2",
    }))
    const ensureSessionRunEventStream = vi.fn()
    ;(controller as unknown as { client: { continueSessionRun: typeof continueSessionRun } }).client = { continueSessionRun }
    ;(controller as unknown as {
      ensureSessionRunEventStream: typeof ensureSessionRunEventStream
    }).ensureSessionRunEventStream = ensureSessionRunEventStream
    setActiveRun(controller, {
      sessionRunId: "run-current",
      sessionId: "session-current",
      branchBindingId: "branch-a",
      agentRunId: "agent-branch-a",
      status: "idle",
      branches: [
        { branch_binding_id: "branch-a", agent_run_id: "agent-branch-a", selected: true },
        { branch_binding_id: "branch-b", agent_run_id: "agent-branch-b", selected: false },
      ],
      pendingNextTurnsByBranch: {
        "run-current:branch-a": [{
          text: "queued on selected A",
          sessionRunId: "run-current",
          branchBindingId: "branch-a",
          clientRequestId: "queued-selected-a",
          queuedAt: "2026-06-18T00:00:00.000Z",
        }],
      },
    })
    const post = vi.fn()

    await (controller as unknown as {
      continueSessionRun: (
        text: string,
        post: (message: Record<string, unknown>) => void,
        options?: {
          sessionRunId?: string
          branchBindingId?: string
          clientRequestId?: string
          sourceScope?: "branch-local"
        },
      ) => Promise<void>
    }).continueSessionRun("queued on selected A", post, {
      sourceScope: "branch-local",
      sessionRunId: "run-current",
      branchBindingId: "branch-a",
      clientRequestId: "queued-selected-a",
    })

    expect(sessionRunCoordinator(controller).pendingNextTurnForBranch("run-current", "branch-a")).toBeUndefined()
    expect(sessionRunCoordinator(controller).activeRun).toEqual(expect.objectContaining({
      branchBindingId: "branch-a",
      agentRunId: "agent-branch-a",
      activationId: "activation-branch-a-2",
      status: "running",
    }))
    expect(ensureSessionRunEventStream).toHaveBeenCalledWith("run-current", "session-current", post, "branch-a")
    const continuedMessages = post.mock.calls
      .map(([message]) => message)
      .filter((message) => message && message.type === "sessionRun.continued")
    expect(continuedMessages).toHaveLength(1)
    expect(continuedMessages[0]).toEqual(expect.objectContaining({
      type: "sessionRun.continued",
      sessionRunId: "run-current",
      branchBindingId: "branch-a",
    }))
    expect(continuedMessages[0]).not.toHaveProperty("operationId")
    expect(continuedMessages[0]).not.toHaveProperty("operationKind")
    expect(post).not.toHaveBeenCalledWith(expect.objectContaining({
      type: "sessionRun.operation.pending",
      operationKind: "continue",
    }))
  })

  it("keeps branch-local pending next turn queued when sibling identity lacks agentRunId", async () => {
    const controller = new LabrastroController(context())
    const continueSessionRun = vi.fn()
    ;(controller as unknown as { client: { continueSessionRun: typeof continueSessionRun } }).client = { continueSessionRun }
    setActiveRun(controller, {
      sessionRunId: "run-current",
      sessionId: "session-current",
      branchBindingId: "branch-b",
      agentRunId: "agent-branch-b",
      status: "idle",
      branches: [
        { branch_binding_id: "branch-a", selected: false },
        { branch_binding_id: "branch-b", agent_run_id: "agent-branch-b", selected: true },
      ],
      pendingNextTurnsByBranch: {
        "run-current:branch-a": [{
          text: "queued on A",
          sessionRunId: "run-current",
          branchBindingId: "branch-a",
          clientRequestId: "queued-a",
          queuedAt: "2026-06-18T00:00:00.000Z",
        }],
      },
    })
    const post = vi.fn()

    await (controller as unknown as {
      continueSessionRun: (
        text: string,
        post: (message: Record<string, unknown>) => void,
        options?: {
          sessionRunId?: string
          branchBindingId?: string
          clientRequestId?: string
          sourceScope?: "branch-local"
        },
      ) => Promise<void>
    }).continueSessionRun("queued on A", post, {
      sourceScope: "branch-local",
      sessionRunId: "run-current",
      branchBindingId: "branch-a",
      clientRequestId: "queued-a",
    })

    expect(continueSessionRun).not.toHaveBeenCalled()
    expect(sessionRunCoordinator(controller).activeRun?.branchBindingId).toBe("branch-b")
    expect(sessionRunCoordinator(controller).pendingNextTurnForBranch("run-current", "branch-a")?.text).toBe("queued on A")
    expect(post).toHaveBeenCalledWith(expect.objectContaining({
      type: "sessionRun.pendingNextTurns",
      sessionRunId: "run-current",
      branchBindingId: "branch-a",
    }))
    expect(post).not.toHaveBeenCalledWith(expect.objectContaining({
      type: "sessionRun.operation.error",
      operationKind: "continue",
      branchBindingId: "branch-a",
    }))
    expect(post).not.toHaveBeenCalledWith(expect.objectContaining({ type: "sessionRun.error" }))
  })

  it("keeps sibling terminal stream cleanup out of the selected draft state", async () => {
    const controller = new LabrastroController(context())
    const refreshSessionListAfterSessionRunDone = vi.fn(async () => undefined)
    ;(controller as unknown as {
      sessionCoordinator: {
        refreshSessionListAfterSessionRunDone: typeof refreshSessionListAfterSessionRunDone
      }
    }).sessionCoordinator = { refreshSessionListAfterSessionRunDone }
    setActiveRun(controller, {
      sessionRunId: "run-current",
      sessionId: "session-current",
      branchBindingId: "main",
      agentRunId: "agent-main",
      status: "running",
      branches: [
        { branch_binding_id: "main", agent_run_id: "agent-main", selected: true },
        { branch_binding_id: "branch-a", agent_run_id: "agent-branch-a", selected: false },
      ],
    })
    sessionRunCoordinator(controller).setActiveDraftSessionId("draft-selected")
    const post = vi.fn()

    await (controller as unknown as {
      applySessionRunEventsBatch: (
        sessionRunId: string,
        sessionId: string,
        streamBranchBindingId: string,
        cursor: number,
        stream: Record<string, unknown>,
        post: (message: Record<string, unknown>) => void,
      ) => Promise<{ sessionId: string; cursor: number; done: boolean; active: boolean }>
    }).applySessionRunEventsBatch("run-current", "session-current", "branch-a", 0, {
      events: [],
      branches: [
        { branch_binding_id: "branch-a", agent_run_id: "agent-branch-a", selected: false, status: "done" },
      ],
      done: true,
      next_cursor: 7,
    }, post)

    expect(sessionRunCoordinator(controller).activeDraftSessionId).toBe("draft-selected")
    expect(sessionRunCoordinator(controller).activeRun?.branchBindingId).toBe("main")
    expect(sessionRunCoordinator(controller).activeRun?.status).toBe("running")
    expect(post).toHaveBeenCalledWith(expect.objectContaining({
      type: "sessionRun.done",
      sessionRunId: "run-current",
      branchBindingId: "branch-a",
    }))
  })

  it("derives stream terminal errors from scoped branch runtime status instead of transport done", async () => {
    const controller = new LabrastroController(context())
    const refreshSessionListAfterSessionRunDone = vi.fn(async () => undefined)
    ;(controller as unknown as {
      sessionCoordinator: {
        refreshSessionListAfterSessionRunDone: typeof refreshSessionListAfterSessionRunDone
      }
    }).sessionCoordinator = { refreshSessionListAfterSessionRunDone }
    setActiveRun(controller, {
      sessionRunId: "run-current",
      sessionId: "session-current",
      branchBindingId: "main",
      agentRunId: "agent-main",
      status: "running",
      branches: [
        { branch_binding_id: "main", agent_run_id: "agent-main", selected: true, status: "running" },
      ],
    })
    const post = vi.fn()

    await (controller as unknown as {
      applySessionRunEventsBatch: (
        sessionRunId: string,
        sessionId: string,
        streamBranchBindingId: string,
        cursor: number,
        stream: Record<string, unknown>,
        post: (message: Record<string, unknown>) => void,
      ) => Promise<{ sessionId: string; cursor: number; done: boolean; active: boolean }>
    }).applySessionRunEventsBatch("run-current", "session-current", "main", 0, {
      events: [],
      branches: [
        { branch_binding_id: "main", agent_run_id: "agent-main", selected: true, status: "error" },
      ],
      done: true,
      next_cursor: 7,
    }, post)

    expect(sessionRuntimeStore(controller).snapshot().scopes["run-current:main"].status).toBe("error")
    expect(post).toHaveBeenCalledWith(expect.objectContaining({
      type: "sessionRun.error",
      sessionRunId: "run-current",
      branchBindingId: "main",
    }))
    expect(post).not.toHaveBeenCalledWith(expect.objectContaining({
      type: "sessionRun.done",
      sessionRunId: "run-current",
      branchBindingId: "main",
    }))
  })

  it("reports stream terminal projection errors instead of defaulting missing branch status to done", async () => {
    const controller = new LabrastroController(context())
    const refreshSessionListAfterSessionRunDone = vi.fn(async () => undefined)
    ;(controller as unknown as {
      sessionCoordinator: {
        refreshSessionListAfterSessionRunDone: typeof refreshSessionListAfterSessionRunDone
      }
    }).sessionCoordinator = { refreshSessionListAfterSessionRunDone }
    setActiveRun(controller, {
      sessionRunId: "run-current",
      sessionId: "session-current",
      branchBindingId: "main",
      agentRunId: "agent-main",
      status: "running",
      branches: [
        { branch_binding_id: "main", agent_run_id: "agent-main", selected: true, status: "running" },
      ],
    })
    const post = vi.fn()

    await (controller as unknown as {
      applySessionRunEventsBatch: (
        sessionRunId: string,
        sessionId: string,
        streamBranchBindingId: string,
        cursor: number,
        stream: Record<string, unknown>,
        post: (message: Record<string, unknown>) => void,
      ) => Promise<{ sessionId: string; cursor: number; done: boolean; active: boolean }>
    }).applySessionRunEventsBatch("run-current", "session-current", "main", 0, {
      events: [],
      branches: [
        { branch_binding_id: "main", agent_run_id: "agent-main", selected: true, status: "running" },
      ],
      done: true,
      next_cursor: 7,
    }, post)

    expect(sessionRuntimeStore(controller).snapshot().scopes["run-current:main"].status).toBe("running")
    expect(post).toHaveBeenCalledWith(expect.objectContaining({
      type: "sessionRun.projection.error",
      sessionRunId: "run-current",
      branchBindingId: "main",
      message: "SessionRun stream completed without scoped branch terminal status.",
    }))
    expect(post).not.toHaveBeenCalledWith(expect.objectContaining({
      type: "sessionRun.done",
      sessionRunId: "run-current",
      branchBindingId: "main",
    }))
  })

  it("reports stream session binding mismatch as projection error without terminalizing runtime scope", async () => {
    const controller = new LabrastroController(context())
    setActiveRun(controller, {
      sessionRunId: "run-current",
      sessionId: "session-current",
      branchBindingId: "main",
      agentRunId: "agent-main",
      status: "running",
      branches: [
        { branch_binding_id: "main", agent_run_id: "agent-main", selected: true, status: "running" },
      ],
    })
    const post = vi.fn()

    const result = await (controller as unknown as {
      applySessionRunEventsBatch: (
        sessionRunId: string,
        sessionId: string,
        streamBranchBindingId: string,
        cursor: number,
        stream: Record<string, unknown>,
        post: (message: Record<string, unknown>) => void,
      ) => Promise<{ sessionId: string; cursor: number; done: boolean; active: boolean }>
    }).applySessionRunEventsBatch("run-current", "session-current", "main", 0, {
      events: [
        { type: "remote_peer_ready", payload: { session_id: "session-other" } },
      ],
      branches: [
        { branch_binding_id: "main", agent_run_id: "agent-main", selected: true, status: "running" },
      ],
      next_cursor: 3,
    }, post)

    expect(result).toEqual({ sessionId: "session-current", cursor: 0, done: false, active: false })
    expect(sessionRuntimeStore(controller).snapshot().scopes["run-current:main"].status).toBe("running")
    expect(post).toHaveBeenCalledWith(expect.objectContaining({
      type: "sessionRun.projection.error",
      sessionRunId: "run-current",
      branchBindingId: "main",
      stopWorking: true,
      message: "会话绑定异常：当前会话 session-current，远端返回 session-other。",
    }))
    expect(post).not.toHaveBeenCalledWith(expect.objectContaining({
      type: "sessionRun.error",
      sessionRunId: "run-current",
      branchBindingId: "main",
    }))
  })

  it("keeps sibling branch metadata from advancing selected operation revision", async () => {
    const controller = new LabrastroController(context())
    setActiveRun(controller, {
      sessionRunId: "run-current",
      sessionId: "session-current",
      branchBindingId: "main",
      agentRunId: "agent-main",
      status: "running",
      branches: [
        { branch_binding_id: "main", agent_run_id: "agent-main", selected: true, status: "running" },
        { branch_binding_id: "branch-a", agent_run_id: "agent-branch-a", selected: false, status: "running" },
      ],
    })
    const revisionBeforeSiblingMetadata = sessionRunCoordinator(controller).activeRunIdentityRevision
    const post = vi.fn()

    await (controller as unknown as {
      applySessionRunEventsBatch: (
        sessionRunId: string,
        sessionId: string,
        streamBranchBindingId: string,
        cursor: number,
        stream: Record<string, unknown>,
        post: (message: Record<string, unknown>) => void,
      ) => Promise<{ sessionId: string; cursor: number; done: boolean; active: boolean }>
    }).applySessionRunEventsBatch("run-current", "session-current", "branch-a", 0, {
      events: [],
      branches: [
        { branch_binding_id: "main", agent_run_id: "agent-main", selected: true, status: "running" },
        { branch_binding_id: "branch-a", agent_run_id: "agent-branch-a", selected: false, status: "running", has_updates: true },
      ],
      next_cursor: 9,
    }, post)

    expect(sessionRunCoordinator(controller).activeRunIdentityRevision).toBe(revisionBeforeSiblingMetadata)
    expect(sessionRuntimeStore(controller).snapshot().scopes["run-current:branch-a"].status).toBe("running")
    expect(post).toHaveBeenCalledWith(expect.objectContaining({
      type: "sessionRun.branches",
      sessionRunId: "run-current",
      branchBindingId: "branch-a",
    }))
  })

  it("derives stream terminal interruptions from scoped branch runtime status instead of runtime errors", async () => {
    const controller = new LabrastroController(context())
    const refreshSessionListAfterSessionRunDone = vi.fn(async () => undefined)
    ;(controller as unknown as {
      sessionCoordinator: {
        refreshSessionListAfterSessionRunDone: typeof refreshSessionListAfterSessionRunDone
      }
    }).sessionCoordinator = { refreshSessionListAfterSessionRunDone }
    setActiveRun(controller, {
      sessionRunId: "run-current",
      sessionId: "session-current",
      branchBindingId: "main",
      agentRunId: "agent-main",
      status: "running",
      branches: [
        { branch_binding_id: "main", agent_run_id: "agent-main", selected: true, status: "running" },
      ],
    })
    const post = vi.fn()

    await (controller as unknown as {
      applySessionRunEventsBatch: (
        sessionRunId: string,
        sessionId: string,
        streamBranchBindingId: string,
        cursor: number,
        stream: Record<string, unknown>,
        post: (message: Record<string, unknown>) => void,
      ) => Promise<{ sessionId: string; cursor: number; done: boolean; active: boolean }>
    }).applySessionRunEventsBatch("run-current", "session-current", "main", 0, {
      events: [],
      branches: [
        {
          branch_binding_id: "main",
          agent_run_id: "agent-main",
          selected: true,
          status: "interrupted",
          metadata: { status_reason: "provider stream interrupted" },
        },
      ],
      done: true,
      next_cursor: 7,
    }, post)

    expect(sessionRuntimeStore(controller).snapshot().scopes["run-current:main"].status).toBe("interrupted")
    expect(post).toHaveBeenCalledWith(expect.objectContaining({
      type: "sessionRun.interrupted",
      sessionRunId: "run-current",
      branchBindingId: "main",
      message: "provider stream interrupted",
    }))
    expect(post).not.toHaveBeenCalledWith(expect.objectContaining({
      type: "sessionRun.error",
      sessionRunId: "run-current",
      branchBindingId: "main",
    }))
  })

  it("uses the stream envelope branch as active-run authority over inner event payloads", async () => {
    const controller = new LabrastroController(context())
    const applySessionRunEvents = vi.fn(async () => undefined)
    ;(controller as unknown as {
      draftDocuments: { applySessionRunEvents: typeof applySessionRunEvents }
    }).draftDocuments = { applySessionRunEvents }
    setActiveRun(controller, {
      sessionRunId: "run-current",
      sessionId: "session-current",
      branchBindingId: "main",
      agentRunId: "agent-main",
      status: "running",
      branches: [
        { branch_binding_id: "main", agent_run_id: "agent-main", selected: true },
        { branch_binding_id: "branch-a", agent_run_id: "agent-branch-a", selected: false },
      ],
    })
    const post = vi.fn()

    await (controller as unknown as {
      applySessionRunEventsBatch: (
        sessionRunId: string,
        sessionId: string,
        streamBranchBindingId: string,
        cursor: number,
        stream: Record<string, unknown>,
        post: (message: Record<string, unknown>) => void,
      ) => Promise<{ sessionId: string; cursor: number; done: boolean; active: boolean }>
    }).applySessionRunEventsBatch("run-current", "session-current", "main", 0, {
      events: [{
        type: "assistant_message",
        payload: {
          content: "main response",
          branch_binding_id: "branch-a",
          agent_run_id: "agent-main-next",
        },
      }],
      next_cursor: 2,
    }, post)

    expect(sessionRunCoordinator(controller).activeRun?.branchBindingId).toBe("main")
    expect(sessionRunCoordinator(controller).activeRun?.agentRunId).toBe("agent-main")
  })

  it("keeps branch summaries from becoming selected runtime status authority", async () => {
    const controller = new LabrastroController(context())
    setActiveRun(controller, {
      sessionRunId: "run-current",
      sessionId: "session-current",
      branchBindingId: "main",
      agentRunId: "agent-main",
      status: "running",
      branches: [
        { branch_binding_id: "main", agent_run_id: "agent-main", selected: true },
        { branch_binding_id: "branch-a", agent_run_id: "agent-branch-a", selected: false },
      ],
    })
    const post = vi.fn()

    await (controller as unknown as {
      applySessionRunEventsBatch: (
        sessionRunId: string,
        sessionId: string,
        streamBranchBindingId: string,
        cursor: number,
        stream: Record<string, unknown>,
        post: (message: Record<string, unknown>) => void,
      ) => Promise<{ sessionId: string; cursor: number; done: boolean; active: boolean }>
    }).applySessionRunEventsBatch("run-current", "session-current", "main", 0, {
      events: [],
      branches: [
        { branch_binding_id: "main", agent_run_id: "agent-main", selected: true, status: "done" },
        { branch_binding_id: "branch-a", agent_run_id: "agent-branch-a", selected: false, status: "done" },
      ],
      next_cursor: 2,
    }, post)

    const snapshot = sessionRuntimeStore(controller).snapshot()
    expect(snapshot.visible.selectedRuntimeStatus).toBe("running")
    expect(snapshot.scopes["run-current:main"].status).toBe("running")
    expect(snapshot.scopes["run-current:branch-a"].status).toBe("done")
  })

  it("keeps a branch-local pending next turn queued when auto-continue fails", async () => {
    const controller = new LabrastroController(context())
    const continueSessionRun = vi.fn(async () => {
      throw new Error("continue failed")
    })
    ;(controller as unknown as { client: { continueSessionRun: typeof continueSessionRun } }).client = { continueSessionRun }
    setActiveRun(controller, {
      sessionRunId: "run-current",
      sessionId: "session-current",
      branchBindingId: "branch-b",
      agentRunId: "agent-branch-b",
      status: "idle",
      branches: [
        { branch_binding_id: "branch-a", agent_run_id: "agent-branch-a", selected: false },
        { branch_binding_id: "branch-b", agent_run_id: "agent-branch-b", selected: true },
      ],
      pendingNextTurnsByBranch: {
        "run-current:branch-a": [{
          text: "queued on A",
          sessionRunId: "run-current",
          branchBindingId: "branch-a",
          clientRequestId: "queued-a",
          queuedAt: "2026-06-18T00:00:00.000Z",
        }],
      },
    })
    const post = vi.fn()

    await (controller as unknown as {
      continueSessionRun: (
        text: string,
        post: (message: Record<string, unknown>) => void,
        options?: {
          sessionRunId?: string
          branchBindingId?: string
          clientRequestId?: string
          sourceScope?: "branch-local"
        },
      ) => Promise<void>
    }).continueSessionRun("queued on A", post, {
      sourceScope: "branch-local",
      sessionRunId: "run-current",
      branchBindingId: "branch-a",
      clientRequestId: "queued-a",
    })

    expect(sessionRunCoordinator(controller).activeRun?.branchBindingId).toBe("branch-b")
    expect(sessionRunCoordinator(controller).pendingNextTurnForBranch("run-current", "branch-a")?.text).toBe("queued on A")
    expect(post).toHaveBeenCalledWith(expect.objectContaining({
      type: "sessionRun.pendingNextTurns",
      sessionRunId: "run-current",
      branchBindingId: "branch-a",
    }))
    expect(post).not.toHaveBeenCalledWith(expect.objectContaining({
      type: "sessionRun.operation.error",
      operationKind: "continue",
      branchBindingId: "branch-a",
    }))
    expect(post).not.toHaveBeenCalledWith(expect.objectContaining({ type: "sessionRun.error" }))
  })

  it("keeps branch-local continue failure scoped after another active run is selected", async () => {
    const controller = new LabrastroController(context())
    const continuation = deferred<Record<string, unknown>>()
    const continueSessionRun = vi.fn(() => continuation.promise)
    ;(controller as unknown as { client: { continueSessionRun: typeof continueSessionRun } }).client = {
      continueSessionRun,
    }
    const pendingNextTurnsByBranch = {
      "run-current:branch-a": [{
        text: "queued on A",
        sessionRunId: "run-current",
        branchBindingId: "branch-a",
        clientRequestId: "queued-a",
        queuedAt: "2026-06-18T00:00:00.000Z",
      }],
    }
    setActiveRun(controller, {
      sessionRunId: "run-current",
      sessionId: "session-current",
      branchBindingId: "branch-b",
      agentRunId: "agent-branch-b",
      status: "idle",
      branches: [
        { branch_binding_id: "branch-a", agent_run_id: "agent-branch-a", selected: false },
        { branch_binding_id: "branch-b", agent_run_id: "agent-branch-b", selected: true },
      ],
      pendingNextTurnsByBranch,
    })
    const post = vi.fn()

    const pending = (controller as unknown as {
      continueSessionRun: (
        text: string,
        post: (message: Record<string, unknown>) => void,
        options?: {
          sessionRunId?: string
          branchBindingId?: string
          clientRequestId?: string
          sourceScope?: "branch-local"
        },
      ) => Promise<void>
    }).continueSessionRun("queued on A", post, {
      sourceScope: "branch-local",
      sessionRunId: "run-current",
      branchBindingId: "branch-a",
      clientRequestId: "queued-a",
    })

    expect(continueSessionRun).toHaveBeenCalledWith(expect.objectContaining({
      sessionRunId: "run-current",
      branchBindingId: "branch-a",
      prompt: "queued on A",
      clientRequestId: "queued-a",
    }))
    setActiveRun(controller, {
      sessionRunId: "run-other",
      sessionId: "session-other",
      branchBindingId: "main",
      agentRunId: "agent-other",
      status: "idle",
      pendingNextTurnsByBranch,
    })

    continuation.reject(new Error("continue failed after switch"))
    await pending

    expect(sessionRunCoordinator(controller).activeRun?.sessionRunId).toBe("run-other")
    expect(sessionRunCoordinator(controller).activeRun?.agentRunId).toBe("agent-other")
    expect(sessionRunCoordinator(controller).pendingNextTurnForBranch("run-current", "branch-a")?.text).toBe("queued on A")
    expect(post).toHaveBeenCalledWith(expect.objectContaining({
      type: "sessionRun.pendingNextTurns",
      sessionRunId: "run-current",
      branchBindingId: "branch-a",
      items: [expect.objectContaining({ text: "queued on A" })],
      pendingNextTurn: expect.objectContaining({ text: "queued on A" }),
    }))
    expect(post).not.toHaveBeenCalledWith(expect.objectContaining({
      type: "sessionRun.operation.error",
      operationKind: "continue",
    }))
    expect(post).not.toHaveBeenCalledWith(expect.objectContaining({ type: "sessionRun.error" }))
    expect(post).not.toHaveBeenCalledWith(expect.objectContaining({ type: "sessionRun.continued" }))
  })

  it("closes branch-local pending next turn success after another active run is selected", async () => {
    const controller = new LabrastroController(context())
    const continuation = deferred<Record<string, unknown>>()
    const continueSessionRun = vi.fn(() => continuation.promise)
    const ensureSessionRunEventStream = vi.fn()
    ;(controller as unknown as { client: { continueSessionRun: typeof continueSessionRun } }).client = {
      continueSessionRun,
    }
    ;(controller as unknown as {
      ensureSessionRunEventStream: typeof ensureSessionRunEventStream
    }).ensureSessionRunEventStream = ensureSessionRunEventStream
    const pendingNextTurnsByBranch = {
      "run-current:branch-a": [{
        text: "queued on A",
        sessionRunId: "run-current",
        branchBindingId: "branch-a",
        clientRequestId: "queued-a",
        queuedAt: "2026-06-18T00:00:00.000Z",
      }],
    }
    setActiveRun(controller, {
      sessionRunId: "run-current",
      sessionId: "session-current",
      branchBindingId: "branch-b",
      agentRunId: "agent-branch-b",
      status: "idle",
      branches: [
        { branch_binding_id: "branch-a", agent_run_id: "agent-branch-a", selected: false },
        { branch_binding_id: "branch-b", agent_run_id: "agent-branch-b", selected: true },
      ],
      pendingNextTurnsByBranch,
    })
    const post = vi.fn()

    const pending = (controller as unknown as {
      continueSessionRun: (
        text: string,
        post: (message: Record<string, unknown>) => void,
        options?: {
          sessionRunId?: string
          branchBindingId?: string
          clientRequestId?: string
          sourceScope?: "branch-local"
        },
      ) => Promise<void>
    }).continueSessionRun("queued on A", post, {
      sourceScope: "branch-local",
      sessionRunId: "run-current",
      branchBindingId: "branch-a",
      clientRequestId: "queued-a",
    })

    expect(continueSessionRun).toHaveBeenCalledWith(expect.objectContaining({
      sessionRunId: "run-current",
      branchBindingId: "branch-a",
      prompt: "queued on A",
      clientRequestId: "queued-a",
    }))
    setActiveRun(controller, {
      sessionRunId: "run-other",
      sessionId: "session-other",
      branchBindingId: "main",
      agentRunId: "agent-other",
      status: "idle",
      pendingNextTurnsByBranch,
    })

    continuation.resolve({
      session_run_id: "run-current",
      branch_binding_id: "branch-a",
      agent_run_id: "agent-branch-a",
      activation_id: "activation-branch-a-2",
    })
    await pending

    expect(sessionRunCoordinator(controller).activeRun?.sessionRunId).toBe("run-other")
    expect(sessionRunCoordinator(controller).activeRun?.agentRunId).toBe("agent-other")
    expect(sessionRunCoordinator(controller).pendingNextTurnForBranch("run-current", "branch-a")).toBeUndefined()
    expect(post).toHaveBeenCalledWith(expect.objectContaining({
      type: "sessionRun.pendingNextTurns",
      sessionRunId: "run-current",
      branchBindingId: "branch-a",
      items: [],
    }))
    expect(ensureSessionRunEventStream).toHaveBeenCalledWith("run-current", "session-current", post, "branch-a")
    expect(post).not.toHaveBeenCalledWith(expect.objectContaining({ type: "sessionRun.continued" }))
    expect(post).not.toHaveBeenCalledWith(expect.objectContaining({ type: "sessionRun.operation.error" }))
    expect(post).not.toHaveBeenCalledWith(expect.objectContaining({ type: "sessionRun.error" }))
  })

  it("fails closed when branch-local continue belongs to a different SessionRun", async () => {
    const controller = new LabrastroController(context())
    const continueSessionRun = vi.fn()
    ;(controller as unknown as { client: { continueSessionRun: typeof continueSessionRun } }).client = { continueSessionRun }
    setActiveRun(controller, {
      sessionRunId: "run-current",
      sessionId: "session-current",
      branchBindingId: "branch-b",
      agentRunId: "agent-branch-b",
      status: "idle",
      branches: [
        { branch_binding_id: "branch-a", agent_run_id: "agent-branch-a", selected: false },
        { branch_binding_id: "branch-b", agent_run_id: "agent-branch-b", selected: true },
      ],
      pendingNextTurnsByBranch: {
        "run-stale:branch-a": [{
          text: "queued on stale run",
          sessionRunId: "run-stale",
          branchBindingId: "branch-a",
          clientRequestId: "queued-stale-a",
          queuedAt: "2026-06-18T00:00:00.000Z",
        }],
      },
    })
    const post = vi.fn()

    await (controller as unknown as {
      continueSessionRun: (
        text: string,
        post: (message: Record<string, unknown>) => void,
        options?: {
          sessionRunId?: string
          branchBindingId?: string
          clientRequestId?: string
          sourceScope?: "branch-local"
        },
      ) => Promise<void>
    }).continueSessionRun("queued on stale run", post, {
      sourceScope: "branch-local",
      sessionRunId: "run-stale",
      branchBindingId: "branch-a",
      clientRequestId: "queued-stale-a",
    })

    expect(continueSessionRun).not.toHaveBeenCalled()
    expect(sessionRunCoordinator(controller).activeRun?.sessionRunId).toBe("run-current")
    expect(sessionRunCoordinator(controller).pendingNextTurnForBranch("run-stale", "branch-a")?.text).toBe("queued on stale run")
    expect(post).toHaveBeenCalledWith(expect.objectContaining({
      type: "sessionRun.pendingNextTurns",
      sessionRunId: "run-stale",
      branchBindingId: "branch-a",
    }))
    expect(post).not.toHaveBeenCalledWith(expect.objectContaining({
      type: "sessionRun.operation.error",
      operationKind: "continue",
    }))
    expect(post).not.toHaveBeenCalledWith(expect.objectContaining({ type: "sessionRun.error" }))
  })

  it("rejects stale restored active-run status after the active run changes", async () => {
    const controller = new LabrastroController(context())
    const status = deferred<Record<string, unknown>>()
    const sessionRunStatus = vi.fn(() => status.promise)
    ;(controller as unknown as { client: { sessionRunStatus: typeof sessionRunStatus } }).client = { sessionRunStatus }
    setActiveRun(controller, {
      sessionRunId: "run-current",
      branchBindingId: "main",
      agentRunId: "agent-main",
    })

    const pending = (controller as unknown as {
      activeRunPayloadWithServerStatus: (
        payload: Record<string, unknown>,
      ) => Promise<Record<string, unknown> | undefined>
    }).activeRunPayloadWithServerStatus({
      sessionRunId: "run-current",
      session_run_id: "run-current",
      sessionId: "session-current",
      session_id: "session-current",
      branchBindingId: "main",
      branch_binding_id: "main",
      agentRunId: "agent-main",
      agent_run_id: "agent-main",
      cursor: 0,
      status: "running",
    })
    await Promise.resolve()
    setActiveRun(controller, {
      sessionRunId: "run-other",
      sessionId: "session-other",
      branchBindingId: "main",
      agentRunId: "agent-other",
    })

    status.resolve({
      session_run_id: "run-current",
      session_id: "session-current",
      branch_binding_id: "main",
      agent_run_id: "agent-main",
      status: "running",
      approvals: [],
    })

    await expect(pending).resolves.toBeUndefined()
    expect(sessionRunCoordinator(controller).activeRun?.sessionRunId).toBe("run-other")
    expect(sessionRunCoordinator(controller).activeRun?.agentRunId).toBe("agent-other")
  })

  it("rejects restored active-run payloads without run proof", async () => {
    const controller = new LabrastroController(context())

    const payload = await (controller as unknown as {
      activeRunPayloadWithServerStatus: (
        payload: Record<string, unknown>,
      ) => Promise<Record<string, unknown> | undefined>
    }).activeRunPayloadWithServerStatus({
      sessionId: "session-current",
      session_id: "session-current",
      branchBindingId: "main",
      branch_binding_id: "main",
      agentRunId: "agent-main",
      agent_run_id: "agent-main",
      cursor: 0,
      status: "running",
    })

    expect(payload).toBeUndefined()
  })

  it("rejects restored active-run status when the response branch proof changes", async () => {
    const controller = new LabrastroController(context())
    const sessionRunStatus = vi.fn(async () => ({
      session_run_id: "run-current",
      session_id: "session-current",
      branch_binding_id: "branch-a",
      agent_run_id: "agent-branch-a",
      status: "running",
      approvals: [],
    }))
    ;(controller as unknown as { client: { sessionRunStatus: typeof sessionRunStatus } }).client = { sessionRunStatus }
    setActiveRun(controller, {
      sessionRunId: "run-current",
      branchBindingId: "main",
      agentRunId: "agent-main",
      branches: [{ branch_binding_id: "branch-a", agent_run_id: "agent-branch-a", selected: false }],
    })

    const payload = await (controller as unknown as {
      activeRunPayloadWithServerStatus: (
        payload: Record<string, unknown>,
      ) => Promise<Record<string, unknown> | undefined>
    }).activeRunPayloadWithServerStatus({
      sessionRunId: "run-current",
      session_run_id: "run-current",
      sessionId: "session-current",
      session_id: "session-current",
      branchBindingId: "main",
      branch_binding_id: "main",
      agentRunId: "agent-main",
      agent_run_id: "agent-main",
      cursor: 0,
      status: "running",
    })

    expect(payload).toBeUndefined()
    expect(sessionRunCoordinator(controller).activeRun?.branchBindingId).toBe("main")
    expect(sessionRunCoordinator(controller).activeRun?.agentRunId).toBe("agent-main")
  })

  it("rejects restored active-run status without response branch proof", async () => {
    const controller = new LabrastroController(context())
    const sessionRunStatus = vi.fn(async () => ({
      session_run_id: "run-current",
      session_id: "session-current",
      agent_run_id: "agent-main",
      status: "running",
      approvals: [],
    }))
    ;(controller as unknown as { client: { sessionRunStatus: typeof sessionRunStatus } }).client = { sessionRunStatus }
    setActiveRun(controller, {
      sessionRunId: "run-current",
      branchBindingId: "main",
      agentRunId: "agent-main",
    })

    const payload = await (controller as unknown as {
      activeRunPayloadWithServerStatus: (
        payload: Record<string, unknown>,
      ) => Promise<Record<string, unknown> | undefined>
    }).activeRunPayloadWithServerStatus({
      sessionRunId: "run-current",
      session_run_id: "run-current",
      sessionId: "session-current",
      session_id: "session-current",
      branchBindingId: "main",
      branch_binding_id: "main",
      agentRunId: "agent-main",
      agent_run_id: "agent-main",
      cursor: 0,
      status: "running",
    })

    expect(payload).toBeUndefined()
    expect(sessionRunCoordinator(controller).activeRun?.branchBindingId).toBe("main")
    expect(sessionRunCoordinator(controller).activeRun?.agentRunId).toBe("agent-main")
  })

  it("rejects restored active-run status when the response agent proof changes", async () => {
    const controller = new LabrastroController(context())
    const sessionRunStatus = vi.fn(async () => ({
      session_run_id: "run-current",
      session_id: "session-current",
      branch_binding_id: "main",
      agent_run_id: "agent-other-main",
      status: "running",
      approvals: [],
    }))
    ;(controller as unknown as { client: { sessionRunStatus: typeof sessionRunStatus } }).client = { sessionRunStatus }
    setActiveRun(controller, {
      sessionRunId: "run-current",
      branchBindingId: "main",
      agentRunId: "agent-main",
    })

    const payload = await (controller as unknown as {
      activeRunPayloadWithServerStatus: (
        payload: Record<string, unknown>,
      ) => Promise<Record<string, unknown> | undefined>
    }).activeRunPayloadWithServerStatus({
      sessionRunId: "run-current",
      session_run_id: "run-current",
      sessionId: "session-current",
      session_id: "session-current",
      branchBindingId: "main",
      branch_binding_id: "main",
      agentRunId: "agent-main",
      agent_run_id: "agent-main",
      cursor: 0,
      status: "running",
    })

    expect(payload).toBeUndefined()
    expect(sessionRunCoordinator(controller).activeRun?.agentRunId).toBe("agent-main")
  })

  it("rejects bootstrap restore when response agent proof differs from payload agent proof", async () => {
    const controller = new LabrastroController(context())
    const sessionRunStatus = vi.fn(async () => ({
      session_run_id: "run-current",
      session_id: "session-current",
      branch_binding_id: "main",
      agent_run_id: "agent-other-main",
      status: "running",
      approvals: [],
    }))
    ;(controller as unknown as { client: { sessionRunStatus: typeof sessionRunStatus } }).client = { sessionRunStatus }
    sessionRunCoordinator(controller).setActiveRun({
      sessionRunId: "run-current",
      sessionId: "session-current",
      branchBindingId: "main",
      agentRunId: "agent-main",
      cursor: 3,
      status: "running",
      startedAt: "2026-06-18T00:00:00.000Z",
      reconnectAttempts: 0,
    })

    const payload = await (controller as unknown as {
      activeRunPayloadWithServerStatus: (
        payload: Record<string, unknown>,
      ) => Promise<Record<string, unknown> | undefined>
    }).activeRunPayloadWithServerStatus({
      sessionRunId: "run-current",
      session_run_id: "run-current",
      sessionId: "session-current",
      session_id: "session-current",
      branchBindingId: "main",
      branch_binding_id: "main",
      agentRunId: "agent-main",
      agent_run_id: "agent-main",
      cursor: 3,
      status: "running",
    })

    expect(payload).toBeUndefined()
    expect(sessionRunCoordinator(controller).activeRun?.agentRunId).toBe("agent-main")
  })

  it("rejects degraded restored active-run fallback after the active run changes", async () => {
    const controller = new LabrastroController(context())
    const status = deferred<Record<string, unknown>>()
    const sessionRunStatus = vi.fn(() => status.promise)
    ;(controller as unknown as { client: { sessionRunStatus: typeof sessionRunStatus } }).client = { sessionRunStatus }
    setActiveRun(controller, {
      sessionRunId: "run-current",
      branchBindingId: "main",
      agentRunId: "agent-main",
    })

    const pending = (controller as unknown as {
      activeRunPayloadWithServerStatus: (
        payload: Record<string, unknown>,
      ) => Promise<Record<string, unknown> | undefined>
    }).activeRunPayloadWithServerStatus({
      sessionRunId: "run-current",
      session_run_id: "run-current",
      sessionId: "session-current",
      session_id: "session-current",
      branchBindingId: "main",
      branch_binding_id: "main",
      agentRunId: "agent-main",
      agent_run_id: "agent-main",
      cursor: 0,
      status: "running",
    })
    await Promise.resolve()
    setActiveRun(controller, {
      sessionRunId: "run-other",
      sessionId: "session-other",
      branchBindingId: "main",
      agentRunId: "agent-other",
    })

    status.reject(new RemoteError(503, "service_unavailable", "service unavailable", {}))

    await expect(pending).resolves.toBeUndefined()
    expect(sessionRunCoordinator(controller).activeRun?.sessionRunId).toBe("run-other")
    expect(sessionRunCoordinator(controller).activeRun?.agentRunId).toBe("agent-other")
  })

  it("preserves status branch agent identities while restoring an active run", async () => {
    const controller = new LabrastroController(context())
    const sessionRunStatus = vi.fn(async () => ({
      session_run_id: "run-current",
      session_id: "session-current",
      branch_binding_id: "main",
      status: "running",
      branches: [
        { branch_binding_id: "main", agent_run_id: "agent-main", selected: true },
        { branch_binding_id: "branch-a", agent_run_id: "agent-branch-a", selected: false },
      ],
      approvals: [],
    }))
    ;(controller as unknown as { client: { sessionRunStatus: typeof sessionRunStatus } }).client = { sessionRunStatus }
    setActiveRun(controller, {
      sessionRunId: "run-current",
      branchBindingId: "main",
      agentRunId: "agent-main",
      branches: undefined,
    })

    const payload = await (controller as unknown as {
      activeRunPayloadWithServerStatus: (
        payload: Record<string, unknown>,
      ) => Promise<Record<string, unknown> | undefined>
    }).activeRunPayloadWithServerStatus({
      sessionRunId: "run-current",
      session_run_id: "run-current",
      sessionId: "session-current",
      session_id: "session-current",
      branchBindingId: "main",
      branch_binding_id: "main",
      agentRunId: "agent-main",
      agent_run_id: "agent-main",
      cursor: 0,
      status: "running",
    })

    expect(payload?.branches).toEqual([
      { branch_binding_id: "main", agent_run_id: "agent-main", selected: true },
      { branch_binding_id: "branch-a", agent_run_id: "agent-branch-a", selected: false },
    ])
    expect(sessionRunCoordinator(controller).activeRun?.branches).toEqual(payload?.branches)
  })

  it("restores a strongly proven bootstrap payload when the runtime store is empty", async () => {
    const controller = new LabrastroController(context())
    const sessionRunStatus = vi.fn(async () => ({
      session_run_id: "run-current",
      session_id: "session-current",
      branch_binding_id: "main",
      agent_run_id: "agent-main",
      status: "running",
      approvals: [],
    }))
    ;(controller as unknown as { client: { sessionRunStatus: typeof sessionRunStatus } }).client = { sessionRunStatus }
    sessionRunCoordinator(controller).setActiveRun({
      sessionRunId: "run-current",
      sessionId: "session-current",
      branchBindingId: "main",
      agentRunId: "agent-main",
      cursor: 3,
      status: "running",
      startedAt: "2026-06-18T00:00:00.000Z",
      reconnectAttempts: 0,
    })

    const payload = await (controller as unknown as {
      activeRunPayloadWithServerStatus: (
        payload: Record<string, unknown>,
      ) => Promise<Record<string, unknown> | undefined>
    }).activeRunPayloadWithServerStatus({
      sessionRunId: "run-current",
      session_run_id: "run-current",
      sessionId: "session-current",
      session_id: "session-current",
      branchBindingId: "main",
      branch_binding_id: "main",
      agentRunId: "agent-main",
      agent_run_id: "agent-main",
      cursor: 3,
      status: "running",
    })

    expect(payload).toEqual(expect.objectContaining({
      sessionRunId: "run-current",
      branchBindingId: "main",
      agentRunId: "agent-main",
      cursor: 3,
    }))
  })

  it("degrades a strongly proven bootstrap payload when status refresh fails and the runtime store is empty", async () => {
    const controller = new LabrastroController(context())
    const sessionRunStatus = vi.fn(async () => {
      throw new RemoteError(503, "service_unavailable", "service unavailable", {})
    })
    ;(controller as unknown as { client: { sessionRunStatus: typeof sessionRunStatus } }).client = { sessionRunStatus }
    sessionRunCoordinator(controller).setActiveRun({
      sessionRunId: "run-current",
      sessionId: "session-current",
      branchBindingId: "main",
      agentRunId: "agent-main",
      cursor: 3,
      status: "running",
      startedAt: "2026-06-18T00:00:00.000Z",
      reconnectAttempts: 0,
    })

    const payload = await (controller as unknown as {
      activeRunPayloadWithServerStatus: (
        payload: Record<string, unknown>,
      ) => Promise<Record<string, unknown> | undefined>
    }).activeRunPayloadWithServerStatus({
      sessionRunId: "run-current",
      session_run_id: "run-current",
      sessionId: "session-current",
      session_id: "session-current",
      branchBindingId: "main",
      branch_binding_id: "main",
      agentRunId: "agent-main",
      agent_run_id: "agent-main",
      cursor: 3,
      status: "running",
    })

    expect(payload).toEqual(expect.objectContaining({
      sessionRunId: "run-current",
      branchBindingId: "main",
      agentRunId: "agent-main",
      cursor: 3,
    }))
  })

  it("rejects branch selection when the response branch differs from the operation target", async () => {
    const controller = new LabrastroController(context())
    const selectSessionRunBranch = vi.fn(async () => ({
      session_run_id: "run-current",
      session_id: "session-current",
      branch_binding_id: "branch-b",
      agent_run_id: "agent-branch-b",
      status: "idle",
      branches: [{ branch_binding_id: "branch-b", selected: true }],
    }))
    const fetchSessionRunEventsBatch = vi.fn(async () => ({}))
    const ensureSessionRunEventStreamSoon = vi.fn()
    ;(controller as unknown as {
      client: {
        selectSessionRunBranch: typeof selectSessionRunBranch
        fetchSessionRunEventsBatch: typeof fetchSessionRunEventsBatch
      }
    }).client = { selectSessionRunBranch, fetchSessionRunEventsBatch }
    ;(controller as unknown as {
      ensureSessionRunEventStreamSoon: typeof ensureSessionRunEventStreamSoon
    }).ensureSessionRunEventStreamSoon = ensureSessionRunEventStreamSoon
    setActiveRun(controller, { sessionRunId: "run-current", branchBindingId: "main" })
    const post = vi.fn()

    await (controller as unknown as {
      selectSessionRunBranch: (
        request: { sessionRunId?: string; sourceBranchBindingId?: string; operationId?: string; branchBindingId: string },
        post: (message: Record<string, unknown>) => void,
      ) => Promise<void>
    }).selectSessionRunBranch({ sessionRunId: "run-current", sourceBranchBindingId: "main", operationId: "op-select-target", branchBindingId: "branch-a" }, post)

    expect(sessionRunCoordinator(controller).activeRun?.branchBindingId).toBe("main")
    expect(post).not.toHaveBeenCalledWith(expect.objectContaining({
      type: "sessionRun.branch.selected",
    }))
    expect(fetchSessionRunEventsBatch).not.toHaveBeenCalled()
    expect(ensureSessionRunEventStreamSoon).not.toHaveBeenCalled()
  })

  it("rejects branch creation when the response branch differs from the operation target", async () => {
    const controller = new LabrastroController(context())
    const branch = deferred<Record<string, unknown>>()
    const branchAgentRun = vi.fn(() => branch.promise)
    const ensureSessionRunEventStreamSoon = vi.fn()
    ;(controller as unknown as { client: { branchAgentRun: typeof branchAgentRun } }).client = { branchAgentRun }
    ;(controller as unknown as {
      ensureSessionRunEventStreamSoon: typeof ensureSessionRunEventStreamSoon
    }).ensureSessionRunEventStreamSoon = ensureSessionRunEventStreamSoon
    setActiveRun(controller, { sessionRunId: "run-current", branchBindingId: "main" })
    const post = vi.fn()

    const pending = (controller as unknown as {
      branchSessionRun: (
        request: {
          sessionRunId?: string
          operationId?: string
          baseSessionItemId: string
          prompt: string
          sourceBranchBindingId?: string
          branchBindingId?: string
        },
        post: (message: Record<string, unknown>) => void,
      ) => Promise<void>
    }).branchSessionRun({
      sessionRunId: "run-current",
      operationId: "op-create-target",
      baseSessionItemId: "msg-1",
      prompt: "try branch",
      sourceBranchBindingId: "main",
      branchBindingId: "branch-a",
    }, post)
    await Promise.resolve()

    branch.resolve({
      agent_run: {
        id: "agent-branch-b",
        current_activation_id: "activation-branch-b",
      },
      branch_binding_id: "branch-b",
    })
    await pending

    expect(sessionRunCoordinator(controller).activeRun?.branchBindingId).toBe("main")
    expect(post).not.toHaveBeenCalledWith(expect.objectContaining({
      type: "sessionRun.branch.started",
      branchBindingId: "branch-a",
    }))
    expect(ensureSessionRunEventStreamSoon).not.toHaveBeenCalled()
  })

  it("reports a canonical branch result error when branch creation omits the response branch", async () => {
    const controller = new LabrastroController(context())
    const branch = deferred<Record<string, unknown>>()
    const branchAgentRun = vi.fn(() => branch.promise)
    const ensureSessionRunEventStreamSoon = vi.fn()
    ;(controller as unknown as { client: { branchAgentRun: typeof branchAgentRun } }).client = { branchAgentRun }
    ;(controller as unknown as {
      ensureSessionRunEventStreamSoon: typeof ensureSessionRunEventStreamSoon
    }).ensureSessionRunEventStreamSoon = ensureSessionRunEventStreamSoon
    setActiveRun(controller, { sessionRunId: "run-current", branchBindingId: "main" })
    const post = vi.fn()

    const pending = (controller as unknown as {
      branchSessionRun: (
        request: {
          sessionRunId?: string
          operationId?: string
          baseSessionItemId: string
          prompt: string
          sourceBranchBindingId?: string
          branchBindingId?: string
        },
        post: (message: Record<string, unknown>) => void,
      ) => Promise<void>
    }).branchSessionRun({
      sessionRunId: "run-current",
      operationId: "op-create-missing-branch",
      baseSessionItemId: "msg-1",
      prompt: "try branch",
      sourceBranchBindingId: "main",
      branchBindingId: "branch-a",
    }, post)
    await Promise.resolve()

    branch.resolve({
      agent_run: {
        id: "agent-branch-a",
        current_activation_id: "activation-branch-a",
      },
    })
    await pending

    expect(sessionRunCoordinator(controller).activeRun?.branchBindingId).toBe("main")
    expect(post).toHaveBeenCalledWith(expect.objectContaining({
      type: "sessionRun.operation.error",
      operationId: "op-create-missing-branch",
      operationKind: "branch.create",
      message: "AgentRun branch failed: missing canonical branch result",
    }))
    expect(post).not.toHaveBeenCalledWith(expect.objectContaining({
      type: "sessionRun.branch.started",
    }))
    expect(ensureSessionRunEventStreamSoon).not.toHaveBeenCalled()
  })

  it("reports branch creation precheck failures through the matching operation", async () => {
    const controller = new LabrastroController(context())
    const branchAgentRun = vi.fn()
    ;(controller as unknown as { client: { branchAgentRun: typeof branchAgentRun } }).client = { branchAgentRun }
    const post = vi.fn()

    await (controller as unknown as {
      branchSessionRun: (
        request: {
          sessionRunId?: string
          operationId?: string
          baseSessionItemId: string
          prompt: string
          sourceBranchBindingId?: string
          branchBindingId?: string
        },
        post: (message: Record<string, unknown>) => void,
      ) => Promise<void>
    }).branchSessionRun({
      sessionRunId: "run-current",
      operationId: "op-create-precheck",
      baseSessionItemId: "msg-1",
      prompt: "try branch",
      branchBindingId: "branch-a",
    }, post)

    expect(branchAgentRun).not.toHaveBeenCalled()
    expect(post).toHaveBeenCalledWith(expect.objectContaining({
      type: "sessionRun.operation.error",
      operationId: "op-create-precheck",
      operationKind: "branch.create",
      branchBindingId: "branch-a",
      message: "当前会话没有可分支的 AgentRun mainline。",
    }))
    expect(post).not.toHaveBeenCalledWith(expect.objectContaining({ type: "sessionRun.error" }))
  })

  it.each([
    {
      name: "missing base message",
      request: { baseSessionItemId: "", prompt: "try branch" },
      message: "缺少分支基准消息，无法创建会话分支。",
    },
    {
      name: "empty prompt",
      request: { baseSessionItemId: "msg-1", prompt: "   " },
      message: "分支需要新的用户输入。",
    },
  ])("reports branch creation precheck failure for $name through the matching operation", async ({ request, message }) => {
    const controller = new LabrastroController(context())
    const branchAgentRun = vi.fn()
    ;(controller as unknown as { client: { branchAgentRun: typeof branchAgentRun } }).client = { branchAgentRun }
    setActiveRun(controller, { sessionRunId: "run-current", branchBindingId: "main" })
    const post = vi.fn()

    await (controller as unknown as {
      branchSessionRun: (
        request: {
          sessionRunId?: string
          operationId?: string
          baseSessionItemId: string
          prompt: string
          sourceBranchBindingId?: string
          branchBindingId?: string
        },
        post: (message: Record<string, unknown>) => void,
      ) => Promise<void>
    }).branchSessionRun({
      sessionRunId: "run-current",
      operationId: "op-create-validation",
      sourceBranchBindingId: "main",
      branchBindingId: "branch-a",
      ...request,
    }, post)

    expect(branchAgentRun).not.toHaveBeenCalled()
    expect(post).toHaveBeenCalledWith(expect.objectContaining({
      type: "sessionRun.operation.error",
      operationId: "op-create-validation",
      operationKind: "branch.create",
      sessionRunId: "run-current",
      branchBindingId: "branch-a",
      message,
    }))
    expect(post).not.toHaveBeenCalledWith(expect.objectContaining({ type: "sessionRun.error" }))
  })

  it("reports branch selection precheck failures through the matching operation", async () => {
    const controller = new LabrastroController(context())
    const selectSessionRunBranch = vi.fn()
    ;(controller as unknown as { client: { selectSessionRunBranch: typeof selectSessionRunBranch } }).client = { selectSessionRunBranch }
    const post = vi.fn()

    await (controller as unknown as {
      selectSessionRunBranch: (
        request: { sessionRunId?: string; operationId?: string; branchBindingId: string },
        post: (message: Record<string, unknown>) => void,
      ) => Promise<void>
    }).selectSessionRunBranch({ sessionRunId: "run-current", operationId: "op-select-precheck", branchBindingId: "branch-a" }, post)

    expect(selectSessionRunBranch).not.toHaveBeenCalled()
    expect(post).toHaveBeenCalledWith(expect.objectContaining({
      type: "sessionRun.operation.error",
      operationId: "op-select-precheck",
      operationKind: "branch.select",
      branchBindingId: "branch-a",
      message: "缺少可切换的会话分支。",
    }))
    expect(post).not.toHaveBeenCalledWith(expect.objectContaining({ type: "sessionRun.error" }))
  })

  it("reports branch selection no-op through the matching operation", async () => {
    const controller = new LabrastroController(context())
    const selectSessionRunBranch = vi.fn()
    ;(controller as unknown as { client: { selectSessionRunBranch: typeof selectSessionRunBranch } }).client = { selectSessionRunBranch }
    setActiveRun(controller, { sessionRunId: "run-current", branchBindingId: "main" })
    const post = vi.fn()

    await (controller as unknown as {
      selectSessionRunBranch: (
        request: { sessionRunId?: string; sourceBranchBindingId?: string; operationId?: string; branchBindingId: string },
        post: (message: Record<string, unknown>) => void,
      ) => Promise<void>
    }).selectSessionRunBranch({ sessionRunId: "run-current", sourceBranchBindingId: "main", operationId: "op-select-noop", branchBindingId: "main" }, post)

    expect(selectSessionRunBranch).not.toHaveBeenCalled()
    expect(post).toHaveBeenCalledWith(expect.objectContaining({
      type: "sessionRun.operation.error",
      operationId: "op-select-noop",
      operationKind: "branch.select",
      sessionRunId: "run-current",
      branchBindingId: "main",
      message: "该分支已经是当前会话分支。",
    }))
    expect(post).not.toHaveBeenCalledWith(expect.objectContaining({ type: "sessionRun.error" }))
  })

  it("does not switch the visible branch until branch selection projection replay is available", async () => {
    const controller = new LabrastroController(context())
    const replay = deferred<Record<string, unknown>>()
    const selectSessionRunBranch = vi.fn(async () => ({
      session_run_id: "run-current",
      session_id: "session-current",
      branch_binding_id: "branch-a",
      agent_run_id: "agent-branch-a",
      status: "idle",
      branches: [{ branch_binding_id: "branch-a", selected: true }],
    }))
    const fetchSessionRunEventsBatch = vi.fn(() => replay.promise)
    const ensureSessionRunEventStreamSoon = vi.fn()
    ;(controller as unknown as {
      client: {
        selectSessionRunBranch: typeof selectSessionRunBranch
        fetchSessionRunEventsBatch: typeof fetchSessionRunEventsBatch
      }
    }).client = { selectSessionRunBranch, fetchSessionRunEventsBatch }
    ;(controller as unknown as {
      ensureSessionRunEventStreamSoon: typeof ensureSessionRunEventStreamSoon
    }).ensureSessionRunEventStreamSoon = ensureSessionRunEventStreamSoon
    setActiveRun(controller, { sessionRunId: "run-current", branchBindingId: "main" })
    const post = vi.fn()

    const pending = (controller as unknown as {
      selectSessionRunBranch: (
        request: { sessionRunId?: string; sourceBranchBindingId?: string; operationId?: string; branchBindingId: string },
        post: (message: Record<string, unknown>) => void,
      ) => Promise<void>
    }).selectSessionRunBranch({ sessionRunId: "run-current", sourceBranchBindingId: "main", operationId: "op-select-replay-ready", branchBindingId: "branch-a" }, post)
    await Promise.resolve()

    expect(post).not.toHaveBeenCalledWith(expect.objectContaining({
      type: "sessionRun.branch.selected",
      branchBindingId: "branch-a",
    }))
    expect(sessionRunCoordinator(controller).activeRun?.branchBindingId).toBe("main")

    replay.resolve({})
    await pending

    expect(post).toHaveBeenCalledWith(expect.objectContaining({
      type: "sessionRun.branch.selected",
      operationId: "op-select-replay-ready",
      operationKind: "branch.select",
      branchBindingId: "branch-a",
    }))
    expect(sessionRunCoordinator(controller).activeRun?.branchBindingId).toBe("branch-a")
    expect(ensureSessionRunEventStreamSoon).toHaveBeenCalledWith("run-current", "session-current", post, "branch-a")
  })

  it("reports branch projection replay failures as operation failures before switching visible branch", async () => {
    const controller = new LabrastroController(context())
    const selectSessionRunBranch = vi.fn(async () => ({
      session_run_id: "run-current",
      session_id: "session-current",
      branch_binding_id: "branch-a",
      agent_run_id: "agent-branch-a",
      status: "idle",
      branches: [{ branch_binding_id: "branch-a", selected: true }],
    }))
    const fetchSessionRunEventsBatch = vi.fn(async () => {
      throw new Error("event replay failed")
    })
    const ensureSessionRunEventStreamSoon = vi.fn()
    ;(controller as unknown as {
      client: {
        selectSessionRunBranch: typeof selectSessionRunBranch
        fetchSessionRunEventsBatch: typeof fetchSessionRunEventsBatch
      }
    }).client = { selectSessionRunBranch, fetchSessionRunEventsBatch }
    ;(controller as unknown as {
      ensureSessionRunEventStreamSoon: typeof ensureSessionRunEventStreamSoon
    }).ensureSessionRunEventStreamSoon = ensureSessionRunEventStreamSoon
    setActiveRun(controller, { sessionRunId: "run-current", branchBindingId: "main" })
    const post = vi.fn()

    await (controller as unknown as {
      selectSessionRunBranch: (
        request: { sessionRunId?: string; sourceBranchBindingId?: string; operationId?: string; branchBindingId: string },
        post: (message: Record<string, unknown>) => void,
      ) => Promise<void>
    }).selectSessionRunBranch({ sessionRunId: "run-current", sourceBranchBindingId: "main", operationId: "op-select-replay", branchBindingId: "branch-a" }, post)

    expect(sessionRunCoordinator(controller).activeRun?.branchBindingId).toBe("main")
    expect(post).not.toHaveBeenCalledWith(expect.objectContaining({
      type: "sessionRun.branch.selected",
      branchBindingId: "branch-a",
    }))
    expect(post).not.toHaveBeenCalledWith(expect.objectContaining({
      type: "sessionRun.error",
      sessionRunId: "run-current",
      branchBindingId: "branch-a",
      message: "event replay failed",
    }))
    expect(post).not.toHaveBeenCalledWith(expect.objectContaining({
      type: "sessionRun.projection.error",
      sessionRunId: "run-current",
      branchBindingId: "branch-a",
      message: "event replay failed",
    }))
    expect(post).toHaveBeenCalledWith(expect.objectContaining({
      type: "sessionRun.operation.error",
      operationId: "op-select-replay",
      operationKind: "branch.select",
      sessionRunId: "run-current",
      branchBindingId: "branch-a",
      message: "event replay failed",
    }))
    expect(ensureSessionRunEventStreamSoon).not.toHaveBeenCalled()
  })

  it("reports branch projection apply failures as operation failures before switching visible branch", async () => {
    const controller = new LabrastroController(context())
    const selectSessionRunBranch = vi.fn(async () => ({
      session_run_id: "run-current",
      session_id: "session-current",
      branch_binding_id: "branch-a",
      agent_run_id: "agent-branch-a",
      status: "idle",
      branches: [{ branch_binding_id: "branch-a", selected: true }],
    }))
    const fetchSessionRunEventsBatch = vi.fn(async () => ({
      events: [{ type: "assistant_message", payload: { content: "branch-a replay" } }],
      next_cursor: 1,
    }))
    const applySessionRunEventsBatch = vi.fn(async () => {
      throw new Error("projection apply failed")
    })
    const ensureSessionRunEventStreamSoon = vi.fn()
    ;(controller as unknown as {
      client: {
        selectSessionRunBranch: typeof selectSessionRunBranch
        fetchSessionRunEventsBatch: typeof fetchSessionRunEventsBatch
      }
    }).client = { selectSessionRunBranch, fetchSessionRunEventsBatch }
    ;(controller as unknown as {
      applySessionRunEventsBatch: typeof applySessionRunEventsBatch
      ensureSessionRunEventStreamSoon: typeof ensureSessionRunEventStreamSoon
    }).applySessionRunEventsBatch = applySessionRunEventsBatch
    ;(controller as unknown as {
      ensureSessionRunEventStreamSoon: typeof ensureSessionRunEventStreamSoon
    }).ensureSessionRunEventStreamSoon = ensureSessionRunEventStreamSoon
    setActiveRun(controller, { sessionRunId: "run-current", branchBindingId: "main" })
    const post = vi.fn()

    await (controller as unknown as {
      selectSessionRunBranch: (
        request: { sessionRunId?: string; sourceBranchBindingId?: string; operationId?: string; branchBindingId: string },
        post: (message: Record<string, unknown>) => void,
      ) => Promise<void>
    }).selectSessionRunBranch({ sessionRunId: "run-current", sourceBranchBindingId: "main", operationId: "op-select-apply", branchBindingId: "branch-a" }, post)

    expect(applySessionRunEventsBatch).toHaveBeenCalledWith(
      "run-current",
      "session-current",
      "branch-a",
      0,
      expect.objectContaining({ next_cursor: 1 }),
      post,
      { emitScopedEvents: true, applyVisibleSideEffects: false },
    )
    expect(sessionRunCoordinator(controller).activeRun?.branchBindingId).toBe("main")
    expect(post).not.toHaveBeenCalledWith(expect.objectContaining({
      type: "sessionRun.branch.selected",
      branchBindingId: "branch-a",
    }))
    expect(post).not.toHaveBeenCalledWith(expect.objectContaining({
      type: "sessionRun.projection.error",
      sessionRunId: "run-current",
      branchBindingId: "branch-a",
      message: "projection apply failed",
    }))
    expect(post).toHaveBeenCalledWith(expect.objectContaining({
      type: "sessionRun.operation.error",
      operationId: "op-select-apply",
      operationKind: "branch.select",
      sessionRunId: "run-current",
      branchBindingId: "branch-a",
      message: "projection apply failed",
    }))
    expect(ensureSessionRunEventStreamSoon).not.toHaveBeenCalled()
  })
})
