import type * as vscode from "vscode"
import { describe, expect, it, vi } from "vitest"

const vscodeMock = vi.hoisted(() => ({
  registerTextDocumentContentProvider: vi.fn(() => ({ dispose: vi.fn() })),
  createFileSystemWatcher: vi.fn(() => ({
    onDidChange: vi.fn(),
    onDidCreate: vi.fn(),
    onDidDelete: vi.fn(),
    dispose: vi.fn(),
  })),
  executeCommand: vi.fn(async () => undefined),
}))

vi.mock("vscode", () => ({
  workspace: {
    registerTextDocumentContentProvider: vscodeMock.registerTextDocumentContentProvider,
    createFileSystemWatcher: vscodeMock.createFileSystemWatcher,
    workspaceFolders: [],
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

import { LabrastroController, capabilityPackageIngestPayloadFromChatText } from "./LabrastroController"
import { RemoteError } from "./remote-errors"
import type { WebviewToHostMessage } from "./protocol/messages"
import type { RemoteStateStore } from "./RemoteStateStore"

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

function clientSpies(controller: LabrastroController) {
  const client = (controller as unknown as { client: Record<string, unknown> }).client
  const spies = {
    connectionState: vi.fn(async () => ({
      status: "ready",
      authenticated: true,
      hostUrl: "http://127.0.0.1:8765",
      role: "superadmin",
    })),
    providersList: vi.fn(async () => ({ ok: true, providers: [] })),
    modelProfilesList: vi.fn(async () => ({ ok: true, model_profiles: [] })),
    chatConfigRead: vi.fn(async () => ({ ok: true, model_profiles: [] })),
    githubStatus: vi.fn(async () => ({ ok: true, enabled: false })),
    features: vi.fn(async () => ({ ok: true, features: {} })),
  }
  Object.assign(client, spies)
  return spies
}

function remoteState(controller: LabrastroController): RemoteStateStore {
  return (controller as unknown as { remoteState: RemoteStateStore }).remoteState
}

describe("LabrastroController admin state errors", () => {
  it("sends the remote state snapshot during initial state without a false logged-out placeholder", async () => {
    const controller = new LabrastroController(context())
    const post = vi.fn()
    controller.registerWebviewPost(post, "settings")

    await controller.postInitialState(post, { initializeSession: false })

    expect(post).toHaveBeenCalledWith(expect.objectContaining({
      type: "ready",
    }))
    expect(post).toHaveBeenCalledWith(expect.objectContaining({
      type: "remoteState.snapshot",
      payload: expect.objectContaining({
        slices: expect.objectContaining({
          connection: expect.objectContaining({
            status: "idle",
            inFlight: false,
          }),
        }),
      }),
    }))
    expect(post).not.toHaveBeenCalledWith({
      type: "connection.state",
      payload: expect.objectContaining({
        authenticated: false,
        status: "checking",
      }),
    })
  })

  it("does not refresh ready admin slices when a settings webview opens", async () => {
    const controller = new LabrastroController(context())
    const spies = clientSpies(controller)
    remoteState(controller).setReady("connection", {
      status: "ready",
      authenticated: true,
      hostUrl: "http://127.0.0.1:8765",
      role: "superadmin",
    })
    const post = vi.fn()
    controller.registerWebviewPost(post, "settings")

    await controller.postInitialState(post, { initializeSession: false })
    await Promise.resolve()

    expect(spies.connectionState).not.toHaveBeenCalled()
    expect(spies.providersList).not.toHaveBeenCalled()
    expect(spies.modelProfilesList).not.toHaveBeenCalled()
    expect(spies.chatConfigRead).not.toHaveBeenCalled()
    expect(spies.githubStatus).not.toHaveBeenCalled()
    expect(spies.features).not.toHaveBeenCalled()
  })

  it("refreshes only the connection slice for an idle settings webview", async () => {
    const controller = new LabrastroController(context())
    const spies = clientSpies(controller)
    const post = vi.fn()
    controller.registerWebviewPost(post, "settings")

    await controller.postInitialState(post, { initializeSession: false })
    await Promise.resolve()

    expect(spies.connectionState).toHaveBeenCalledTimes(1)
    expect(spies.providersList).not.toHaveBeenCalled()
    expect(spies.modelProfilesList).not.toHaveBeenCalled()
    expect(spies.chatConfigRead).not.toHaveBeenCalled()
    expect(spies.githubStatus).not.toHaveBeenCalled()
    expect(spies.features).not.toHaveBeenCalled()
  })

  it("broadcasts connection state through the remote state store", async () => {
    const controller = new LabrastroController(context())
    const payload = {
      status: "ready",
      authenticated: true,
      hostUrl: "http://127.0.0.1:8765",
    }
    const connectionState = vi.fn(async () => payload)
    ;(controller as unknown as { client: { connectionState: typeof connectionState } }).client = { connectionState }
    const sidebarPost = vi.fn()
    const settingsPost = vi.fn()
    controller.registerWebviewPost(sidebarPost, "sidebar")
    controller.registerWebviewPost(settingsPost, "settings")

    await controller.postConnectionState(settingsPost)

    expect(settingsPost).toHaveBeenCalledWith(expect.objectContaining({
      type: "remoteState.patch",
      payload: expect.objectContaining({
        key: "connection",
        slice: expect.objectContaining({
          status: "ready",
          data: payload,
          inFlight: false,
        }),
      }),
    }))
    expect(sidebarPost).toHaveBeenCalledWith(expect.objectContaining({
      type: "remoteState.patch",
      payload: expect.objectContaining({
        key: "connection",
        slice: expect.objectContaining({
          status: "ready",
          data: payload,
          inFlight: false,
        }),
      }),
    }))
    expect(settingsPost).not.toHaveBeenCalledWith({ type: "connection.state", payload })
  })

  it("starts and stops the capability package local peer runner with authenticated peer connectivity", () => {
    const controller = new LabrastroController(context())
    const runner = {
      start: vi.fn(),
      stop: vi.fn(),
      dispose: vi.fn(),
    }
    ;(controller as unknown as { capabilityPackageLocalPeerRunner: typeof runner }).capabilityPackageLocalPeerRunner = runner
    const update = (controller as unknown as {
      updateCapabilityPackageLocalPeerRunner: (state: Record<string, unknown>) => void
    }).updateCapabilityPackageLocalPeerRunner.bind(controller)

    update({
      authenticated: true,
      status: "ready",
      peerConnected: true,
      hostUrl: "http://127.0.0.1:8765",
      username: "alice",
      peerId: "peer-1",
    })
    update({
      authenticated: true,
      status: "ready",
      peerConnected: false,
      hostUrl: "http://127.0.0.1:8765",
      username: "alice",
      peerId: "peer-1",
    })

    expect(runner.start).toHaveBeenCalledTimes(1)
    expect(runner.stop).toHaveBeenCalledTimes(1)
  })

  it("gates the capability package local peer runner on authenticated ready state", () => {
    const controller = new LabrastroController(context())
    const runner = {
      start: vi.fn(),
      stop: vi.fn(),
      dispose: vi.fn(),
    }
    ;(controller as unknown as { capabilityPackageLocalPeerRunner: typeof runner }).capabilityPackageLocalPeerRunner = runner
    const update = (controller as unknown as {
      updateCapabilityPackageLocalPeerRunner: (state: Record<string, unknown>) => void
    }).updateCapabilityPackageLocalPeerRunner.bind(controller)

    update({
      peerConnected: true,
      authenticated: false,
      status: "login-required",
      hostUrl: "http://127.0.0.1:8765",
      username: "alice",
      peerId: "peer-1",
    })
    update({
      peerConnected: true,
      authenticated: true,
      status: "ready",
      hostUrl: "http://127.0.0.1:8765",
      username: "alice",
      peerId: "peer-1",
    })
    update({
      peerConnected: true,
      authenticated: true,
      status: "ready",
      hostUrl: "http://127.0.0.1:8765",
      username: "bob",
      peerId: "peer-1",
    })

    expect(runner.start).toHaveBeenCalledTimes(2)
    expect(runner.stop).toHaveBeenCalledTimes(2)
  })

  it("emits adminState-scoped admin errors when admin state loading fails", async () => {
    const controller = new LabrastroController(context())
    const adminStatus = vi.fn(async () => {
      throw new Error("admin failed")
    })
    ;(controller as unknown as { client: { adminStatus: typeof adminStatus } }).client = { adminStatus }
    const post = vi.fn()

    await controller.postAdminState(post)

    expect(post).toHaveBeenCalledWith(expect.objectContaining({
      type: "admin.error",
      message: "admin failed",
      category: "unknown",
      scope: "adminState",
      stale: false,
      clearsState: false,
    }))
  })

  it("broadcasts refreshed admin state to all registered webviews", async () => {
    const controller = new LabrastroController(context())
    const payload = {
      model_profiles: [
        {
          id: "Zenmux-anthropic-claude-opus-4.6",
          provider: "Zenmux",
          model: "anthropic/claude-opus-4.6",
        },
      ],
    }
    const adminStatus = vi.fn(async () => payload)
    ;(controller as unknown as { client: { adminStatus: typeof adminStatus } }).client = { adminStatus }
    const sidebarPost = vi.fn()
    const settingsPost = vi.fn()
    controller.registerWebviewPost(sidebarPost, "sidebar")
    controller.registerWebviewPost(settingsPost, "settings")

    await controller.postAdminState(settingsPost)

    expect(settingsPost).toHaveBeenCalledWith({ type: "admin.state", payload })
    expect(sidebarPost).toHaveBeenCalledWith({ type: "admin.state", payload })
  })

  it("broadcasts providers remote state to all registered webviews", async () => {
    const controller = new LabrastroController(context())
    const payload = {
      ok: true,
      providers: [{ id: "Zenmux", type: "openai_chat" }],
    }
    const providersList = vi.fn(async () => payload)
    ;(controller as unknown as { client: { providersList: typeof providersList } }).client = { providersList }
    const sidebarPost = vi.fn()
    const settingsPost = vi.fn()
    controller.registerWebviewPost(sidebarPost, "sidebar")
    controller.registerWebviewPost(settingsPost, "settings")

    await controller.postProvidersState(settingsPost)

    expect(settingsPost).toHaveBeenCalledWith(expect.objectContaining({
      type: "remoteState.patch",
      payload: expect.objectContaining({
        key: "providers",
        slice: expect.objectContaining({
          status: "ready",
          data: payload,
          inFlight: false,
        }),
      }),
    }))
    expect(sidebarPost).toHaveBeenCalledWith(expect.objectContaining({
      type: "remoteState.patch",
      payload: expect.objectContaining({
        key: "providers",
        slice: expect.objectContaining({
          status: "ready",
          data: payload,
          inFlight: false,
        }),
      }),
    }))
    expect(settingsPost).not.toHaveBeenCalledWith({ type: "providers.state", payload })
    expect(sidebarPost).not.toHaveBeenCalledWith({ type: "providers.state", payload })
  })

  it("deduplicates concurrent provider refreshes through the remote state store", async () => {
    const controller = new LabrastroController(context())
    let resolveProviders: ((payload: Record<string, unknown>) => void) | undefined
    const providersList = vi.fn(() => new Promise<Record<string, unknown>>((resolve) => {
      resolveProviders = resolve
    }))
    ;(controller as unknown as { client: { providersList: typeof providersList } }).client = { providersList }
    const sidebarPost = vi.fn()
    const settingsPost = vi.fn()
    controller.registerWebviewPost(sidebarPost, "sidebar")
    controller.registerWebviewPost(settingsPost, "settings")

    const first = controller.postProvidersState(settingsPost)
    const second = controller.postProvidersState(sidebarPost)
    resolveProviders?.({ ok: true, providers: [] })
    await Promise.all([first, second])

    expect(providersList).toHaveBeenCalledTimes(1)
  })

  it("resolves the startup chat model from chat config instead of full admin status", async () => {
    const controller = new LabrastroController(context())
    const chatConfigRead = vi.fn(async () => ({
      ok: true,
      active_agent_model: {},
      active_main: "Zenmux-anthropic-claude-opus-4.6",
      model_profiles: [
        {
          id: "Zenmux-anthropic-claude-opus-4.6",
          provider: "Zenmux",
          model: "anthropic/claude-opus-4.6",
          max_tokens: 32000,
        },
      ],
    }))
    const adminStatus = vi.fn(async () => {
      throw new Error("admin status should not be used")
    })
    ;(controller as unknown as {
      client: {
        chatConfigRead: typeof chatConfigRead
        adminStatus: typeof adminStatus
      }
    }).client = { chatConfigRead, adminStatus }

    await expect((controller as unknown as {
      resolveConfiguredDefaultChatModel: () => Promise<Record<string, unknown> | undefined>
    }).resolveConfiguredDefaultChatModel()).resolves.toEqual({
      providerId: "Zenmux",
      modelId: "anthropic/claude-opus-4.6",
      parameters: { max_tokens: 32000 },
    })
    expect(chatConfigRead).toHaveBeenCalled()
    expect(adminStatus).not.toHaveBeenCalled()
  })

  it("emits adminAction-scoped admin errors when admin actions fail", async () => {
    const controller = new LabrastroController(context())
    const post = vi.fn()
    const runAdminAction = (controller as unknown as {
      runAdminAction: (post: (message: Record<string, unknown>) => void, action: () => Promise<Record<string, unknown>>) => Promise<boolean>
    }).runAdminAction.bind(controller)

    await expect(runAdminAction(post, async () => {
      throw new Error("action failed")
    })).resolves.toBe(false)

    expect(post).toHaveBeenCalledWith(expect.objectContaining({
      type: "admin.error",
      message: "action failed",
      category: "unknown",
      scope: "adminAction",
      stale: false,
      clearsState: false,
    }))
  })

  it("keeps admin data usable and surfaces backend detail for admin action reload failures", async () => {
    const controller = new LabrastroController(context())
    const post = vi.fn()
    const runAdminAction = (controller as unknown as {
      runAdminAction: (post: (message: Record<string, unknown>) => void, action: () => Promise<Record<string, unknown>>) => Promise<boolean>
    }).runAdminAction.bind(controller)

    await expect(runAdminAction(post, async () => {
      throw new RemoteError(
        500,
        "config_reload_failed",
        "500 config_reload_failed",
        { error: "config_reload_failed", message: "Unknown config field: providers.items.Zenmux.stream_recovery" },
      )
    })).resolves.toBe(false)

    expect(post).toHaveBeenCalledWith(expect.objectContaining({
      type: "admin.error",
      message: "500 config_reload_failed: Unknown config field: providers.items.Zenmux.stream_recovery",
      category: "unavailable",
      scope: "adminAction",
      stale: false,
      clearsState: false,
      status: 500,
      code: "config_reload_failed",
    }))
  })
})

describe("LabrastroController session run start", () => {
  it("detects capability package install intent from chat text", () => {
    expect(capabilityPackageIngestPayloadFromChatText("请安装这个 skill https://github.com/acme/tool")).toEqual({
      source: {
        type: "github_repo",
        url: "https://github.com/acme/tool",
        notes: "请安装这个 skill https://github.com/acme/tool",
      },
    })
    expect(capabilityPackageIngestPayloadFromChatText("安装这个 https://github.com/acme/tool")).toEqual({
      source: {
        type: "github_repo",
        url: "https://github.com/acme/tool",
        notes: "安装这个 https://github.com/acme/tool",
      },
    })
    expect(capabilityPackageIngestPayloadFromChatText('安装这个 MCP {"mcpServers":{"edgeone":{"command":"npx","args":["edgeone-pages-mcp"]}}}')).toEqual({
      source: {
        type: "project_notes",
        notes: '安装这个 MCP {"mcpServers":{"edgeone":{"command":"npx","args":["edgeone-pages-mcp"]}}}',
      },
    })
    expect(capabilityPackageIngestPayloadFromChatText('{"mcpServers":{"edgeone":{"command":"npx","args":["edgeone-pages-mcp"]}}}')).toEqual({
      source: {
        type: "project_notes",
        notes: '{"mcpServers":{"edgeone":{"command":"npx","args":["edgeone-pages-mcp"]}}}',
      },
    })
    expect(capabilityPackageIngestPayloadFromChatText("帮我看看 https://github.com/acme/tool 这个仓库")).toBeUndefined()
    expect(capabilityPackageIngestPayloadFromChatText("帮我把这个链接添加到 README https://github.com/acme/tool")).toBeUndefined()
  })

  it("routes chat install intent into the capability package session entry", async () => {
    const controller = new LabrastroController(context())
    const startCapabilityPackageIngestSession = vi.fn(async () => undefined)
    const sessionRunHandleMessage = vi.fn(async () => true)
    ;(controller as unknown as {
      startCapabilityPackageIngestSession: typeof startCapabilityPackageIngestSession
    }).startCapabilityPackageIngestSession = startCapabilityPackageIngestSession
    ;(controller as unknown as {
      sessionRunCoordinator: { handleMessage: typeof sessionRunHandleMessage }
    }).sessionRunCoordinator = { handleMessage: sessionRunHandleMessage }
    const post = vi.fn()

    await expect(controller.handleMessage({
      type: "chat.send",
      text: "请安装这个 skill https://github.com/acme/tool",
      sessionId: "session-chat",
      locale: "zh-CN",
    } as WebviewToHostMessage, post)).resolves.toBe(true)

    expect(startCapabilityPackageIngestSession).toHaveBeenCalledWith(expect.objectContaining({
      type: "capabilityPackage.ingest.session.start",
      payload: {
        source: {
          type: "github_repo",
          url: "https://github.com/acme/tool",
          notes: "请安装这个 skill https://github.com/acme/tool",
        },
        session_id: "session-chat",
        locale: "zh-CN",
      },
    }), post)
    expect(sessionRunHandleMessage).not.toHaveBeenCalled()
  })

  it("sends active capability package session run resume to settings initial state", async () => {
    const controller = new LabrastroController(context())
    const post = vi.fn()
    controller.registerWebviewPost(post, "settings")
    const sessionRunStatus = vi.fn(async () => ({
      status: "running",
      session_id: "session-cap",
      runtime_state: {
        workflow: "capability_package_ingest",
        agent_id: "capability_packager",
      },
      approvals: [
        {
          approval_id: "approval-cap",
          decision_type: "capability_package_install",
          tool_name: "install_capability_package",
          review: { package_id: "pkg-cap" },
          state: "requested",
        },
      ],
    }))
    const ensureSessionRunEventStream = vi.fn()
    ;((controller as unknown as { client: Record<string, unknown> }).client).sessionRunStatus = sessionRunStatus
    ;(controller as unknown as {
      sessionRunCoordinator: {
        setActiveRun: (run: Record<string, unknown>) => void
      }
    }).sessionRunCoordinator.setActiveRun({
      sessionRunId: "run-cap",
      sessionId: "session-cap",
      cursor: 0,
      status: "running",
      startedAt: "2026-06-02T00:00:00.000Z",
      reconnectAttempts: 0,
    })
    ;(controller as unknown as {
      ensureSessionRunEventStream: typeof ensureSessionRunEventStream
    }).ensureSessionRunEventStream = ensureSessionRunEventStream

    await controller.postInitialState(post, { initializeSession: false })

    expect(post).toHaveBeenCalledWith(expect.objectContaining({
      type: "sessionRun.resume",
      payload: expect.objectContaining({
        sessionRunId: "run-cap",
        sessionId: "session-cap",
        runtimeState: {
          workflow: "capability_package_ingest",
          agent_id: "capability_packager",
        },
        approvals: [
          expect.objectContaining({
            approval_id: "approval-cap",
            decision_type: "capability_package_install",
          }),
        ],
      }),
    }))
    expect(ensureSessionRunEventStream).toHaveBeenCalledWith("run-cap", "session-cap", post)
  })

  it("keeps terminal active runs resumable until final events are consumed", async () => {
    const controller = new LabrastroController(context())
    const sessionRunStatus = vi.fn(async () => ({
      status: "done",
      session_id: "session-cap",
      runtime_state: {
        workflow: "capability_package_ingest",
        agent_id: "capability_packager",
      },
      approvals: [],
    }))
    ;((controller as unknown as { client: Record<string, unknown> }).client).sessionRunStatus = sessionRunStatus
    ;(controller as unknown as {
      sessionRunCoordinator: {
        setActiveRun: (run: Record<string, unknown>) => void
        activeRun: unknown
      }
    }).sessionRunCoordinator.setActiveRun({
      sessionRunId: "run-cap",
      sessionId: "session-cap",
      cursor: 4,
      status: "running",
      startedAt: "2026-06-02T00:00:00.000Z",
      reconnectAttempts: 0,
    })

    const payload = await (controller as unknown as {
      activeRunPayloadWithServerStatus: (payload: Record<string, unknown>) => Promise<Record<string, unknown> | undefined>
    }).activeRunPayloadWithServerStatus({
      sessionRunId: "run-cap",
      sessionId: "session-cap",
      cursor: 4,
      status: "running",
    })

    expect(payload).toMatchObject({
      sessionRunId: "run-cap",
      sessionId: "session-cap",
      cursor: 4,
      status: "done",
      runtimeState: {
        workflow: "capability_package_ingest",
        agent_id: "capability_packager",
      },
      approvals: [],
    })
    expect((controller as unknown as {
      sessionRunCoordinator: { activeRun: unknown }
    }).sessionRunCoordinator.activeRun).toBeDefined()
  })

  it("continues terminal capability package runs from settings initial state until final events arrive", async () => {
    const controller = new LabrastroController(context())
    const post = vi.fn()
    controller.registerWebviewPost(post, "settings")
    const sessionRunStatus = vi.fn(async () => ({
      status: "failed",
      session_id: "session-cap",
      runtime_state: {
        workflow: "capability_package_ingest",
        agent_id: "capability_packager",
      },
      approvals: [],
    }))
    const ensureSessionRunEventStream = vi.fn()
    ;((controller as unknown as { client: Record<string, unknown> }).client).sessionRunStatus = sessionRunStatus
    ;(controller as unknown as {
      sessionRunCoordinator: {
        setActiveRun: (run: Record<string, unknown>) => void
      }
    }).sessionRunCoordinator.setActiveRun({
      sessionRunId: "run-cap",
      sessionId: "session-cap",
      cursor: 6,
      status: "running",
      startedAt: "2026-06-02T00:00:00.000Z",
      reconnectAttempts: 0,
    })
    ;(controller as unknown as {
      ensureSessionRunEventStream: typeof ensureSessionRunEventStream
    }).ensureSessionRunEventStream = ensureSessionRunEventStream

    await controller.postInitialState(post, { initializeSession: false })

    expect(post).toHaveBeenCalledWith(expect.objectContaining({
      type: "sessionRun.resume",
      payload: expect.objectContaining({
        sessionRunId: "run-cap",
        sessionId: "session-cap",
        cursor: 6,
        status: "failed",
        runtimeState: {
          workflow: "capability_package_ingest",
          agent_id: "capability_packager",
        },
        approvals: [],
      }),
    }))
    expect(ensureSessionRunEventStream).toHaveBeenCalledWith("run-cap", "session-cap", post)
  })

  it("reports empty session run ids as start failures without persisting active run", async () => {
    const controller = new LabrastroController(context())
    const startSessionRun = vi.fn(async () => ({ session_run_id: "", session_id: "session-1" }))
    const prepareSessionRunSession = vi.fn(async () => ({ ok: true, sessionId: "session-1" }))
    ;(controller as unknown as {
      client: { startSessionRun: typeof startSessionRun }
    }).client = { startSessionRun }
    ;(controller as unknown as {
      sessionCoordinator: { prepareSessionRunSession: typeof prepareSessionRunSession }
    }).sessionCoordinator = { prepareSessionRunSession }
    const post = vi.fn()

    await (controller as unknown as {
      startSessionRun: (
        text: string,
        requestedSessionId: string | undefined,
        post: (message: Record<string, unknown>) => void,
        options?: Record<string, unknown>
      ) => Promise<void>
    }).startSessionRun("hello", "session-1", post, {
      providerId: "deepseek",
      modelId: "V4FLASH",
      locale: "en",
    })

    expect(startSessionRun).toHaveBeenCalledWith("hello", "session-1", expect.objectContaining({
      locale: "en",
      providerId: "deepseek",
      modelId: "V4FLASH",
    }))
    expect(post).toHaveBeenCalledWith({ type: "sessionRun.started", text: "hello" })
    expect(post).toHaveBeenCalledWith({
      type: "sessionRun.error",
      message: "session run start failed: empty session run id",
    })
    expect(post).not.toHaveBeenCalledWith(expect.objectContaining({ type: "sessionRun.session" }))
    expect((controller as unknown as {
      sessionRunCoordinator: { activeRun: unknown }
    }).sessionRunCoordinator.activeRun).toBeUndefined()
  })

  it("starts capability package ingestion as a session run", async () => {
    const controller = new LabrastroController(context())
    const capabilityPackageIngestSessionStart = vi.fn(async () => ({
      session_run_id: "run-cap",
      session_id: "session-cap",
      runtime_state: {
        workflow: "capability_package_ingest",
        agent_id: "capability_packager",
      },
    }))
    const prepareSessionRunSession = vi.fn(async () => ({ ok: true, sessionId: "session-cap" }))
    const setActiveRun = vi.fn()
    const ensureSessionRunEventStream = vi.fn()
    ;(controller as unknown as {
      client: { capabilityPackageIngestSessionStart: typeof capabilityPackageIngestSessionStart }
    }).client = { capabilityPackageIngestSessionStart }
    ;(controller as unknown as {
      sessionCoordinator: { prepareSessionRunSession: typeof prepareSessionRunSession }
    }).sessionCoordinator = { prepareSessionRunSession }
    ;(controller as unknown as {
      sessionRunCoordinator: { setActiveRun: typeof setActiveRun; clearActiveRun: () => void }
    }).sessionRunCoordinator = { setActiveRun, clearActiveRun: vi.fn() }
    ;(controller as unknown as {
      ensureSessionRunEventStream: typeof ensureSessionRunEventStream
    }).ensureSessionRunEventStream = ensureSessionRunEventStream
    const post = vi.fn()

    await (controller as unknown as {
      startCapabilityPackageIngestSession: (
        message: Record<string, unknown>,
        post: (message: Record<string, unknown>) => void,
      ) => Promise<void>
    }).startCapabilityPackageIngestSession({
      type: "capabilityPackage.ingest.session.start",
      payload: { source: { type: "github_repo", url: "https://github.com/acme/tool" } },
    }, post)

    expect(prepareSessionRunSession).toHaveBeenCalledWith(undefined, post, {
      mode: "capability_package",
      workflowMode: "capability_package_ingest",
    })
    expect(capabilityPackageIngestSessionStart).toHaveBeenCalledWith(expect.objectContaining({
      session_id: "session-cap",
      locale: "zh-CN",
      source: { type: "github_repo", url: "https://github.com/acme/tool" },
    }))
    expect(setActiveRun).toHaveBeenCalledWith(expect.objectContaining({
      sessionRunId: "run-cap",
      sessionId: "session-cap",
      status: "running",
    }))
    expect(post).toHaveBeenCalledWith(expect.objectContaining({
      type: "sessionRun.session",
      sessionRunId: "run-cap",
      sessionId: "session-cap",
      runtimeState: {
        workflow: "capability_package_ingest",
        agent_id: "capability_packager",
      },
    }))
    expect(post).toHaveBeenCalledWith(expect.objectContaining({
      type: "capabilityPackage.ingest.session.started",
    }))
    expect(ensureSessionRunEventStream).toHaveBeenCalledWith("run-cap", "session-cap", post)
    expect(post).not.toHaveBeenCalledWith(expect.objectContaining({
      type: "capabilityPackage.error",
    }))
  })

  it("routes capability package session run messages through the shared session targets", async () => {
    const controller = new LabrastroController(context())
    const settingsPost = vi.fn()
    const sidebarPost = vi.fn()
    controller.registerWebviewPost(settingsPost, "settings")
    controller.registerWebviewPost(sidebarPost, "sidebar")

    const capabilityPackageIngestSessionStart = vi.fn(async () => ({
      session_run_id: "run-cap",
      session_id: "session-cap",
      runtime_state: {
        workflow: "capability_package_ingest",
        agent_id: "capability_packager",
      },
    }))
    const prepareSessionRunSession = vi.fn(async () => ({ ok: true, sessionId: "session-cap" }))
    const setActiveRun = vi.fn()
    const ensureSessionRunEventStream = vi.fn()
    ;(controller as unknown as {
      client: { capabilityPackageIngestSessionStart: typeof capabilityPackageIngestSessionStart }
    }).client = { capabilityPackageIngestSessionStart }
    ;(controller as unknown as {
      sessionCoordinator: { prepareSessionRunSession: typeof prepareSessionRunSession }
    }).sessionCoordinator = { prepareSessionRunSession }
    ;(controller as unknown as {
      sessionRunCoordinator: { setActiveRun: typeof setActiveRun; clearActiveRun: () => void }
    }).sessionRunCoordinator = { setActiveRun, clearActiveRun: vi.fn() }
    ;(controller as unknown as {
      ensureSessionRunEventStream: typeof ensureSessionRunEventStream
    }).ensureSessionRunEventStream = ensureSessionRunEventStream

    await (controller as unknown as {
      startCapabilityPackageIngestSession: (
        message: Record<string, unknown>,
        post: (message: Record<string, unknown>) => void,
      ) => Promise<void>
    }).startCapabilityPackageIngestSession({
      type: "capabilityPackage.ingest.session.start",
      payload: { source: { type: "github_repo", url: "https://github.com/acme/tool" } },
    }, settingsPost)

    const sessionMessage = expect.objectContaining({
      type: "sessionRun.session",
      sessionRunId: "run-cap",
      sessionId: "session-cap",
    })
    expect(settingsPost).toHaveBeenCalledWith(sessionMessage)
    expect(sidebarPost).toHaveBeenCalledWith(sessionMessage)
    expect(settingsPost).toHaveBeenCalledWith(expect.objectContaining({
      type: "capabilityPackage.ingest.session.started",
    }))
    expect(sidebarPost).not.toHaveBeenCalledWith(expect.objectContaining({
      type: "capabilityPackage.ingest.session.started",
    }))
  })
})
