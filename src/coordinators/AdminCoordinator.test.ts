import { describe, expect, it, vi } from "vitest"
import { AdminCoordinator } from "./AdminCoordinator"

function coordinator() {
  let peerDiagnosticsState = {
    enabled: true,
    lifecycle: true,
    processOutput: true,
    http: true,
    logPath: "G:/tmp/peer-diagnostics.log",
  }
  const options = {
    client: {
      hostUrl: "http://127.0.0.1:8765",
      login: vi.fn(),
      logout: vi.fn(),
      saveHostUrl: vi.fn(),
      authPasswordChange: vi.fn(),
      authUsersList: vi.fn(),
      authUsersCreate: vi.fn(),
      authUsersUpdate: vi.fn(),
      authUsersDisable: vi.fn(),
      authUsersResetPassword: vi.fn(),
      authDevicesList: vi.fn(),
      authDevicesRevoke: vi.fn(),
      authAuditList: vi.fn(),
      serverSettingsRead: vi.fn(),
      serverSettingsUpdate: vi.fn(),
      toolArgumentDiagnosticsStats: vi.fn(),
      peerDiagnosticsLoggingState: vi.fn(() => peerDiagnosticsState),
      savePeerDiagnosticsLoggingState: vi.fn(async (payload: Record<string, unknown>) => {
        peerDiagnosticsState = {
          ...peerDiagnosticsState,
          ...(typeof payload.enabled === "boolean" ? { enabled: payload.enabled } : {}),
          ...(typeof payload.lifecycle === "boolean" ? { lifecycle: payload.lifecycle } : {}),
          ...(typeof payload.processOutput === "boolean" ? { processOutput: payload.processOutput } : {}),
          ...(typeof payload.http === "boolean" ? { http: payload.http } : {}),
        }
        return peerDiagnosticsState
      }),
      openPeerDiagnosticsLog: vi.fn(async () => ({
        enabled: true,
        lifecycle: true,
        processOutput: true,
        http: true,
        logPath: "G:/tmp/peer-diagnostics.log",
      })),
      clearPeerDiagnosticsLog: vi.fn(async () => ({
        enabled: true,
        lifecycle: true,
        processOutput: true,
        http: true,
        logPath: "G:/tmp/peer-diagnostics.log",
      })),
      providerRecord: vi.fn(),
      providerTest: vi.fn(),
      providerDelete: vi.fn(),
      providerCopy: vi.fn(),
      providerEnable: vi.fn(),
      providerModels: vi.fn(),
      modelProfileRecord: vi.fn(),
      modelProfileActivate: vi.fn(),
      modelCapabilitiesStatus: vi.fn(async () => ({
        ok: true,
        model_capabilities: { enabled: true, model_count: 2 },
      })),
      modelCapabilitiesList: vi.fn(async () => ({
        ok: true,
        model_capabilities: { enabled: true, models: [] },
      })),
      modelCapabilitiesRefresh: vi.fn(async () => ({
        ok: true,
        model_capabilities: { enabled: true, model_count: 2 },
      })),
      modelCapabilitiesApply: vi.fn(async () => ({
        ok: true,
        model_profiles: [],
      })),
    },
    context: {
      workspaceState: {
        get: vi.fn(() => ({})),
        update: vi.fn(),
      },
    },
    connectionErrorState: vi.fn(),
    postConnectionState: vi.fn(),
    postAdminState: vi.fn(),
    refreshBackendFeatures: vi.fn(),
    broadcastState: vi.fn(),
    runAdminAction: vi.fn(async (_post, action) => {
      await action()
      return true
    }),
    openFileTarget: vi.fn(),
    getExecutorType: vi.fn(() => ({ location: "remote", engine: "labrastro" })),
    broadcastExecutorType: vi.fn(),
  }
  return {
    options,
    coordinator: new AdminCoordinator(options as unknown as ConstructorParameters<typeof AdminCoordinator>[0]),
  }
}

describe("AdminCoordinator", () => {
  it("routes auto approval updates without changing the wire name", async () => {
    const { options, coordinator: subject } = coordinator()
    const post = vi.fn()

    await expect(subject.handleMessage({ type: "autoApproval.update", options: { execute: true } }, post)).resolves.toBe(true)

    expect(options.context.workspaceState.update).toHaveBeenCalledWith("labrastro.autoApproval", {
      options: {
        readOnly: false,
        write: false,
        delete: false,
        execute: true,
        mcp: false,
        unknown: false,
      },
      allowedCommands: [],
      deniedCommands: [],
    })
    expect(options.broadcastState).toHaveBeenCalledWith({
      type: "autoApproval.state",
      payload: {
        options: {
          readOnly: false,
          write: false,
          delete: false,
          execute: false,
          mcp: false,
          unknown: false,
        },
        allowedCommands: [],
        deniedCommands: [],
        platform: process.platform,
      },
    })
  })

  it("forwards openFile requests to the existing file opener", async () => {
    const { options, coordinator: subject } = coordinator()

    await subject.handleMessage({ type: "openFile", path: "src/index.ts", line: 2, column: 3 }, vi.fn())

    expect(options.openFileTarget).toHaveBeenCalledWith("src/index.ts", 2, 3)
  })

  it("loads tool argument diagnostics stats", async () => {
    const { options, coordinator: subject } = coordinator()
    const post = vi.fn()
    options.client.toolArgumentDiagnosticsStats.mockResolvedValue({
      ok: true,
      tool_argument_validation: { totals: { events: 1 } },
    })

    await expect(subject.handleMessage({ type: "diagnostics.toolArguments.stats" }, post)).resolves.toBe(true)

    expect(post).toHaveBeenCalledWith({
      type: "diagnostics.toolArguments.state",
      payload: {
        ok: true,
        tool_argument_validation: { totals: { events: 1 } },
      },
    })
  })

  it("persists reasoning display defaults in workspace state", async () => {
    const { options, coordinator: subject } = coordinator()
    const post = vi.fn()

    await expect(subject.handleMessage({ type: "reasoningDisplay.save", defaultOpen: true }, post)).resolves.toBe(true)

    expect(options.context.workspaceState.update).toHaveBeenCalledWith("labrastro.reasoningDefaultOpen", true)
    expect(options.broadcastState).toHaveBeenCalledWith({
      type: "reasoningDisplay.state",
      payload: { defaultOpen: false },
    })

    await expect(subject.handleMessage({ type: "reasoningDisplay.get" }, post)).resolves.toBe(true)
    expect(post).toHaveBeenCalledWith({
      type: "reasoningDisplay.state",
      payload: { defaultOpen: false },
    })
  })
})
