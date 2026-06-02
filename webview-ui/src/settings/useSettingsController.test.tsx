import { createRoot } from "solid-js"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => {
  const messageHandlers: Array<(message: Record<string, unknown>) => void> = []
  return {
    messageHandlers,
    server: undefined as any,
    vscode: {
      postMessage: vi.fn(),
      onMessage: vi.fn((handler: (message: Record<string, unknown>) => void) => {
        messageHandlers.push(handler)
        return () => {
          const index = messageHandlers.indexOf(handler)
          if (index >= 0) messageHandlers.splice(index, 1)
        }
      }),
      getState: vi.fn(() => undefined),
      setState: vi.fn(),
    },
  }
})

vi.mock("../context/server", () => ({
  useServer: () => mocks.server,
}))

vi.mock("../context/vscode", () => ({
  useVSCode: () => mocks.vscode,
}))

import {
  agentToDraft,
  createSettingsController,
  profileToDraft,
  reduceCapabilityPackageIngestErrorState,
  reduceCapabilityPackageIngestSessionState,
  shouldRefreshCapabilitiesAfterCapabilityPackageIngest,
} from "./useSettingsController"
import { setLocale } from "../i18n"

const settingsControllerSource = readFileSync(join(__dirname, "useSettingsController.tsx"), "utf8")

function makeServer(overrides: Record<string, unknown> = {}) {
  const defaults: Record<string, unknown> = {
    connected: () => true,
    workspaceDirectory: () => undefined,
    extensionVersion: () => undefined,
    connectionState: () => ({ status: "ready", authenticated: true }),
    connectionSaveResult: () => undefined,
    adminState: () => ({}),
    adminStateUpdatedAt: () => undefined,
    adminError: () => undefined,
    adminStateError: () => undefined,
    modelListError: () => undefined,
    providersState: () => undefined,
    providersUpdatedAt: () => undefined,
    providersError: () => undefined,
    modelProfilesState: () => undefined,
    modelProfilesUpdatedAt: () => undefined,
    modelProfilesError: () => undefined,
    chatConfigState: () => undefined,
    chatConfigError: () => undefined,
    githubState: () => undefined,
    githubError: () => undefined,
    actionResult: () => undefined,
    serverSettingsState: () => undefined,
    serverSettingsError: () => undefined,
    diagnosticsState: () => undefined,
    diagnosticsError: () => undefined,
    modelCapabilitiesState: () => undefined,
    modelCapabilitiesError: () => undefined,
    backendFeatures: () => ({}),
    authUsersState: () => undefined,
    authDevicesState: () => undefined,
    authAuditState: () => undefined,
    authActionResult: () => undefined,
    authError: () => undefined,
    capabilityState: () => undefined,
    capabilityActionResult: () => undefined,
    capabilityError: () => undefined,
    environmentManifest: () => undefined,
    environmentSnapshot: () => ({}),
    environmentError: () => undefined,
    reasoningDisplayState: () => ({ defaultOpen: false }),
    chatSendDuringRunModeState: () => ({ mode: "guide" }),
    peerDiagnosticsLoggingState: () => ({}),
    executorType: () => ({ location: "remote", engine: "labrastro" }),
  }
  return { ...defaults, ...overrides }
}

function withController<T>(
  server: Record<string, unknown>,
  callback: (controller: ReturnType<typeof createSettingsController>) => T,
): T {
  mocks.server = server
  let dispose: (() => void) | undefined
  try {
    return createRoot((rootDispose) => {
      dispose = rootDispose
      const controller = createSettingsController({})
      return callback(controller)
    })
  } finally {
    dispose?.()
  }
}

function runtimeProfileDraft(overrides: Record<string, unknown> = {}) {
  return {
    id: "profile",
    executor: "reuleauxcoder",
    execution_location: "remote_server",
    worker_kind: "server_worker",
    model_request_origin: "server",
    runtime_home_policy: "per_task",
    approval_mode: "full",
    config_isolation: "",
    model: "",
    command: "",
    argsText: "",
    envText: "",
    credentialRefsText: "",
    mcpServersText: "",
    ...overrides,
  }
}

function agentDraft(overrides: Record<string, unknown> = {}) {
  return {
    id: "reviewer",
    name: "",
    description: "",
    role: "worker",
    chat_entrypoint: false,
    visibility: "user",
    delegable: true,
    taskflow_eligible: true,
    systemFlowOnlyText: "",
    runtime_profile: "agent_remote",
    modelKey: "",
    dispatchProfileText: "",
    dispatchExamplesText: "",
    dispatchAvoidText: "",
    systemAppend: "",
    agentMd: "",
    capabilityRefsText: "",
    max_concurrent_tasks: 1,
    credentialRefsText: "",
    memoryEnabled: true,
    memoryProvider: "",
    memoryInject: true,
    memoryCapture: true,
    memoryTokenBudget: 0,
    memoryExposeTools: false,
    memoryPolicyRest: {},
    ...overrides,
  } as any
}

describe("settings controller capability model", () => {
  beforeEach(() => {
    mocks.messageHandlers.splice(0)
    mocks.vscode.postMessage.mockClear()
    mocks.vscode.onMessage.mockClear()
    setLocale("zh-CN")
  })

  it("keeps list configuration when dashboard only carries status summary", () => {
    const controller = withController(makeServer({
      capabilityState: () => ({
        environment_requirements: [
          {
            id: "envreq:sdk:dotnet",
            kind: "sdk",
            name: "dotnet",
            requirements: { version: ">=8" },
            configure: "dotnet workload restore",
            runtime: "dotnet",
            language: "csharp",
            path: "/usr/bin/dotnet",
            check: "dotnet --version",
            install: "winget install Microsoft.DotNet.SDK.8",
          },
        ],
        mcp_servers: [],
        dashboard_items: [
          {
            id: "envreq:sdk:dotnet",
            kind: "sdk",
            entry_type: "environment_requirement",
            name: "dotnet",
            status: "missing",
            status_detail: "dotnet not found",
            enabled: true,
          },
        ],
      }),
    }), (controller) => controller)

    const dotnet = controller.capabilityDashboardItems().find((item) => item.id === "envreq:sdk:dotnet")

    expect(dotnet).toMatchObject({
      status: "missing",
      status_detail: "dotnet not found",
      requirements: { version: ">=8" },
      configure: "dotnet workload restore",
      runtime: "dotnet",
      language: "csharp",
      path: "/usr/bin/dotnet",
      check: "dotnet --version",
      install: "winget install Microsoft.DotNet.SDK.8",
    })
  })

  it("runs environment checks only for environment requirements", () => {
    const controller = withController(makeServer({
      capabilityState: () => ({
        environment_requirements: [
          {
            id: "envreq:executable:gh",
            kind: "executable",
            name: "gh",
            command: "gh",
          },
        ],
        mcp_servers: [
          {
            id: "mcp:github",
            name: "github",
            command: "github-mcp",
            environment_requirement_refs: ["envreq:executable:gh"],
          },
        ],
        dashboard_items: [
          {
            id: "envreq:executable:gh",
            kind: "executable",
            entry_type: "environment_requirement",
            name: "gh",
          },
          {
            id: "mcp:github",
            kind: "mcp_server",
            entry_type: "mcp",
            name: "github",
          },
        ],
      }),
    }), (controller) => controller)

    controller.runEnvironment("check")
    expect(mocks.vscode.postMessage).toHaveBeenCalledWith({
      type: "environment.run",
      mode: "check",
      entryIds: ["envreq:executable:gh"],
      agentId: "environment_configurator",
    })

    mocks.vscode.postMessage.mockClear()
    controller.runEnvironment("check", ["mcp:github"])
    expect(mocks.vscode.postMessage).not.toHaveBeenCalled()
  })

  it("keeps dependency resource kind from envreq id when the list omits kind", () => {
    const controller = withController(makeServer({
      capabilityState: () => ({
        environment_requirements: [
          { id: "envreq:sdk:dotnet", name: "dotnet" },
          { id: "envreq:gpu:cuda", name: "cuda" },
        ],
        mcp_servers: [],
      }),
    }), (controller) => controller)

    expect(controller.capabilityDependencyViews()[0]).toMatchObject({
      id: "envreq:sdk:dotnet",
      resourceKind: "sdk",
      rawKind: "sdk",
      dependencyKind: "sdk",
      summary: "SDK · dotnet",
    })
    expect(controller.capabilityDependencyViews()[1]).toMatchObject({
      id: "envreq:gpu:cuda",
      resourceKind: "unsupported",
      rawKind: "gpu",
      dependencyKind: "gpu",
      summary: "Gpu · cuda",
    })
  })

  it("groups capability package components as user-facing capabilities and dependencies", () => {
    const controller = withController(makeServer({
      serverSettingsState: () => ({
        settings: {
          skills: {
            enabled: true,
            disabled: ["code-review"],
          },
          capability_packages: {
            "repo-review": {
              components: ["skill:code-review", "mcp:github", "envreq:sdk:dotnet"],
            },
          },
          capability_components: {
            "skill:code-review": {
              kind: "skill",
              name: "code-review",
              display_name: "Code review",
              summary: "Review repository changes before merging.",
              package_ids: ["repo-review"],
              config: { path_hint: "/skills/code-review" },
            },
            "mcp:github": {
              kind: "mcp",
              name: "github",
            },
            "envreq:sdk:dotnet": {
              kind: "environment_requirement",
              name: "dotnet",
              config: {
                kind: "sdk",
                requirements: { version: ">=8" },
              },
            },
          },
        },
      }),
    }), (controller) => controller)

    const groups = controller.capabilityPackageComponentGroups([
      "skill:code-review",
      "mcp:github",
      "envreq:sdk:dotnet",
    ])

    expect(groups.capabilities.map((item) => item.id)).toEqual(["skill:code-review", "mcp:github"])
    expect(groups.dependencies.map((item) => item.id)).toEqual(["envreq:sdk:dotnet"])
    expect(groups.capabilities[0]).toMatchObject({
      displayName: "Code review",
      summary: "Review repository changes before merging.",
      skillStatus: "disabled",
    })
  })

  it("builds pasted Skill install payload without requiring server paths", () => {
    withController(makeServer(), (controller) => {
      const editor = {
        ...controller.emptyCapabilityEditor("skill"),
        name: "",
        displayName: "Code review",
        summary: "Review repository changes before merging.",
        skillContent: "---\nname: code-review\ndescription: Review code changes.\n---\n\nReview code changes.\n",
      } as any

      const payload = controller.capabilityPayloadFromEditor(editor)

      expect(payload).toMatchObject({
        display_name: "Code review",
        summary: "Review repository changes before merging.",
        skill_content: editor.skillContent,
      })
      expect(payload).not.toHaveProperty("path_hint")
      expect(payload).not.toHaveProperty("source_path")
    })
  })

  it("builds pasted MCP JSON install payload without requiring split command fields", () => {
    withController(makeServer(), (controller) => {
      const mcpConfigText = JSON.stringify({
        mcpServers: {
          "edgeone-pages-mcp-server": {
            command: "npx",
            args: ["edgeone-pages-mcp"],
          },
        },
      }, null, 2)
      const editor = {
        ...controller.emptyCapabilityEditor("mcp"),
        name: "",
        displayName: "EdgeOne Pages",
        summary: "Deploy pages through EdgeOne.",
        mcpConfigText,
        runtimeRunsOn: "local_peer",
      } as any

      const payload = controller.capabilityPayloadFromEditor(editor)

      expect(payload).toMatchObject({
        display_name: "EdgeOne Pages",
        summary: "Deploy pages through EdgeOne.",
        mcp_config: mcpConfigText,
        runtime_footprint: {
          runs_on: "local_peer",
          install_required_on: ["local_peer"],
          config_required_on: ["local_peer"],
        },
      })
      expect(payload).not.toHaveProperty("command")
      expect(payload).not.toHaveProperty("args")
      expect(payload).not.toHaveProperty("env")
    })
  })

  it("exposes MCP servers and Skills as capabilities while dependencies stay separate", () => {
    const controller = withController(makeServer({
      capabilityState: () => ({
        environment_requirements: [
          { id: "envreq:executable:gh", kind: "executable", name: "gh", command: "gh" },
        ],
        mcp_servers: [
          {
            id: "mcp:github",
            name: "github",
            command: "github-mcp",
            runtime_footprint: {
              runs_on: "server",
              install_required_on: ["server"],
              config_required_on: ["server"],
              user_message: "服务端运行，无需本机安装",
            },
            environment_requirement_refs: ["envreq:executable:gh"],
            package_ids: ["github-tools"],
          },
        ],
      }),
      serverSettingsState: () => ({
        settings: {
          skills: { enabled: true, disabled: ["code-review"] },
          capability_packages: {
            "repo-review": { components: ["skill:code-review"] },
          },
          capability_components: {
            "skill:code-review": {
              kind: "skill",
              name: "code-review",
              display_name: "Code review",
              summary: "Review repository changes before merging.",
              config: { path_hint: "/skills/code-review" },
            },
          },
        },
      }),
    }), (controller) => controller as any)

    expect(controller.capabilityViews().map((item: any) => `${item.kind}:${item.name}`)).toEqual([
      "mcp_server:github",
      "skill:code-review",
    ])
    expect(controller.capabilityDependencyViews().map((item: any) => item.id)).toEqual(["envreq:executable:gh"])
    expect(controller.capabilityViews()[1].skill).toMatchObject({
      disabled: true,
      pathHint: "/skills/code-review",
    })
    expect(controller.capabilityViews()[1]).toMatchObject({
      displayName: "Code review",
      summary: "Review repository changes before merging.",
    })
    expect(controller.capabilityViews()[0].runtimeFootprint.userMessage).toBe("服务端运行，无需本机安装")
  })

  it("launches capability package generation through a chat session", () => {
    withController(makeServer(), (controller) => {
      controller.setCapabilitySourceType("github_repo")
      controller.setCapabilitySourceUrl("https://github.com/acme/tool")
      controller.setCapabilitySourceNotes("需要安装与配置")
      controller.setCapabilityPackageIdHint("acme-tool")
      mocks.vscode.postMessage.mockClear()
      controller.startCapabilityPackageIngest()

      expect(mocks.vscode.postMessage).toHaveBeenCalledWith({
        type: "capabilityPackage.ingest.session.start",
        payload: {
          locale: "zh-CN",
          source: {
            type: "github_repo",
            url: "https://github.com/acme/tool",
            notes: "需要安装与配置",
            package_id_hint: "acme-tool",
          },
        },
      })
    })
  })

  it("marks capability package session start errors as failed", () => {
    expect(reduceCapabilityPackageIngestErrorState({
      running: true,
      agentRunId: "",
      status: "opening_session",
      error: "",
    }, {
      message: "session start failed",
      validationMessages: ["bad source"],
    })).toMatchObject({
      running: false,
      status: "failed",
      error: "session start failed",
      validationMessages: ["bad source"],
    })
  })

  it("projects capability package session run events into settings entry state", () => {
    const initial = {
      running: false,
      agentRunId: "",
      status: "idle",
      error: "",
    }
    const running = reduceCapabilityPackageIngestSessionState(initial, {
      type: "sessionRun.session",
      sessionRunId: "run-cap",
      sessionId: "session-cap",
      runtimeState: {
        workflow: "capability_package_ingest",
        agent_id: "capability_packager",
      },
    })

    expect(running).toMatchObject({
      status: "session_running",
      sessionRunId: "run-cap",
      sessionId: "session-cap",
    })

    const awaitingApproval = reduceCapabilityPackageIngestSessionState(running, {
      type: "sessionRun.events",
      sessionRunId: "run-cap",
      events: [
        {
          type: "workflow_decision",
          payload: {
            approval_id: "approval-cap",
            decision_type: "capability_package_install",
            tool_name: "install_capability_package",
            review: { package_id: "pkg-cap" },
          },
        },
      ],
    })

    expect(awaitingApproval).toMatchObject({
      status: "awaiting_approval",
      sessionRunId: "run-cap",
      sessionId: "session-cap",
      approvalId: "approval-cap",
      packageId: "pkg-cap",
    })

    const completed = reduceCapabilityPackageIngestSessionState(awaitingApproval, {
      type: "sessionRun.events",
      sessionRunId: "run-cap",
      events: [
        {
          type: "workflow_result",
          payload: {
            result_type: "capability_package_install",
            status: "done",
            message: "installed",
          },
        },
      ],
    })

    expect(completed).toMatchObject({
      status: "completed",
      sessionRunId: "run-cap",
      sessionId: "session-cap",
      approvalId: "approval-cap",
      packageId: "pkg-cap",
      error: "",
    })

    const failed = reduceCapabilityPackageIngestSessionState(awaitingApproval, {
      type: "sessionRun.events",
      sessionRunId: "run-cap",
      events: [
        {
          type: "workflow_result",
          payload: {
            result_type: "capability_package_install",
            status: "error",
            message: "install failed",
          },
        },
      ],
    })
    expect(failed).toMatchObject({
      status: "failed",
      sessionRunId: "run-cap",
      error: "install failed",
    })

    const cancelled = reduceCapabilityPackageIngestSessionState(awaitingApproval, {
      type: "sessionRun.events",
      sessionRunId: "run-cap",
      events: [
        {
          type: "workflow_result",
          payload: {
            result_type: "capability_package_install",
            status: "cancelled",
          },
        },
      ],
    })
    expect(cancelled).toMatchObject({
      status: "cancelled",
      sessionRunId: "run-cap",
      error: "",
    })
  })

  it("restores awaiting approval state from session run resume payload", () => {
    const next = reduceCapabilityPackageIngestSessionState({
      running: false,
      agentRunId: "",
      status: "idle",
      error: "",
    }, {
      type: "sessionRun.resume",
      payload: {
        sessionRunId: "run-cap",
        sessionId: "session-cap",
        runtimeState: {
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
      },
    })

    expect(next).toMatchObject({
      status: "awaiting_approval",
      sessionRunId: "run-cap",
      sessionId: "session-cap",
      approvalId: "approval-cap",
      packageId: "pkg-cap",
      error: "",
    })
  })

  it("marks capability refresh only when capability package install enters completed state", () => {
    const awaitingApproval = {
      running: false,
      agentRunId: "",
      status: "awaiting_approval",
      error: "",
      sessionRunId: "run-cap",
    }
    const completed = {
      ...awaitingApproval,
      status: "completed",
    }

    expect(shouldRefreshCapabilitiesAfterCapabilityPackageIngest(awaitingApproval, completed)).toBe(true)
    expect(shouldRefreshCapabilitiesAfterCapabilityPackageIngest(completed, completed)).toBe(false)
    expect(shouldRefreshCapabilitiesAfterCapabilityPackageIngest(awaitingApproval, {
      ...awaitingApproval,
      status: "failed",
    })).toBe(false)
  })

  it("does not keep settings-owned capability package polling or draft approval paths", () => {
    expect(settingsControllerSource).not.toContain("capabilityPackage.draft.accept")
    expect(settingsControllerSource).not.toContain("capabilityPackage.ingest.status")
    expect(settingsControllerSource).not.toContain("capabilityIngestPollTimer")
    expect(settingsControllerSource).not.toContain("acceptCapabilityPackageDraft")
  })

  it("surfaces agent config first-load background resources", () => {
    withController(makeServer({
      connectionState: () => ({ status: "ready", authenticated: true, role: "superadmin" }),
    }), (controller) => {
      controller.refreshPage("agentConfig", { mode: "background" })

      expect(controller.pageRefreshing("agentConfig")).toBe(true)
      expect(controller.pageInitialLoading("agentConfig")).toBe(true)
      expect(controller.pageRevalidating("agentConfig")).toBe(false)
      expect(controller.pageLoadingItems("agentConfig")).toEqual([
        "服务器设置",
        "会话配置",
        "模型配置",
      ])
      expect(controller.pageLoadingMessage("agentConfig")).toBe("正在加载服务器设置、会话配置、模型配置")
    })
  })

  it("keeps agent config content visible while existing resources revalidate", () => {
    withController(makeServer({
      connectionState: () => ({ status: "ready", authenticated: true, role: "superadmin" }),
      serverSettingsState: () => ({ settings: { agent_registry: { profiles: {}, agents: {} } } }),
      chatConfigState: () => ({ default_model: "deepseek" }),
      modelProfilesState: () => ({ model_profiles: [] }),
    }), (controller) => {
      controller.refreshPage("agentConfig", { mode: "background" })

      expect(controller.pageRefreshing("agentConfig")).toBe(true)
      expect(controller.pageInitialLoading("agentConfig")).toBe(false)
      expect(controller.pageRevalidating("agentConfig")).toBe(true)
    })
  })

  it("keeps agent config content visible when auxiliary resources have not loaded yet", () => {
    withController(makeServer({
      connectionState: () => ({ status: "ready", authenticated: true, role: "superadmin" }),
      serverSettingsState: () => ({ settings: { agent_registry: { profiles: {}, agents: {} } } }),
    }), (controller) => {
      controller.refreshPage("agentConfig", { mode: "background" })

      expect(controller.pageRefreshing("agentConfig")).toBe(true)
      expect(controller.pageInitialLoading("agentConfig")).toBe(false)
      expect(controller.pageRevalidating("agentConfig")).toBe(true)
      expect(controller.pageLoadingItems("agentConfig")).toEqual([
        "服务器设置",
        "会话配置",
        "模型配置",
      ])
    })
  })

  it("surfaces capability first-load background resources", () => {
    withController(makeServer({
      connectionState: () => ({ status: "ready", authenticated: true, role: "superadmin" }),
    }), (controller) => {
      controller.refreshPage("capabilities", { mode: "background" })

      expect(controller.pageRefreshing("capabilities")).toBe(true)
      expect(controller.pageInitialLoading("capabilities")).toBe(true)
      expect(controller.pageRevalidating("capabilities")).toBe(false)
      expect(controller.pageLoadingItems("capabilities")).toEqual([
        "服务器设置",
        "能力清单",
        "环境清单",
      ])
      expect(controller.pageLoadingMessage("capabilities")).toBe("正在加载服务器设置、能力清单、环境清单")
    })
  })

  it("keeps capability content visible when the environment manifest has not loaded yet", () => {
    withController(makeServer({
      connectionState: () => ({ status: "ready", authenticated: true, role: "superadmin" }),
      serverSettingsState: () => ({ settings: { capability_packages: {} } }),
      capabilityState: () => ({ dashboard_items: [], environment_requirements: [], mcp_servers: [], skills: [] }),
    }), (controller) => {
      controller.refreshPage("capabilities", { mode: "background" })

      expect(controller.pageRefreshing("capabilities")).toBe(true)
      expect(controller.pageInitialLoading("capabilities")).toBe(false)
      expect(controller.pageRevalidating("capabilities")).toBe(true)
      expect(controller.pageLoadingItems("capabilities")).toEqual([
        "服务器设置",
        "能力清单",
        "环境清单",
      ])
    })
  })

  it("keeps capabilities in first-load state until capability state is available", () => {
    withController(makeServer({
      connectionState: () => ({ status: "ready", authenticated: true, role: "superadmin" }),
      serverSettingsState: () => ({ settings: { capability_packages: {} } }),
      environmentManifest: () => ({ entries: [] }),
    }), (controller) => {
      controller.refreshPage("capabilities", { mode: "background" })

      expect(controller.pageRefreshing("capabilities")).toBe(true)
      expect(controller.pageInitialLoading("capabilities")).toBe(true)
      expect(controller.pageRevalidating("capabilities")).toBe(false)
    })
  })

  it("keeps provider first-load feedback visible", () => {
    withController(makeServer({
      connectionState: () => ({ status: "ready", authenticated: true, role: "superadmin" }),
    }), (controller) => {
      controller.refreshPage("providers", { mode: "background" })

      expect(controller.pageRefreshing("providers")).toBe(true)
      expect(controller.pageInitialLoading("providers")).toBe(true)
      expect(controller.pageLoadingMessage("providers")).toBe("正在加载服务商、模型配置")
    })
  })

  it("exposes configured memory providers for per-agent selection", () => {
    withController(makeServer({
      serverSettingsState: () => ({
        settings: {
          memory: {
            providers: {
              agentmemory: { adapter: "agentmemory_rest" },
              archived: { adapter: "file" },
            },
          },
          memory_status: {
            providers: [
              { id: "agentmemory", adapter: "agentmemory_rest", status: "available", available: true },
            ],
          },
        },
      }),
    }), (controller) => {
      expect(controller.memoryProviderOptions()).toEqual([
        { id: "agentmemory", adapter: "agentmemory_rest", status: "available", available: true },
        { id: "archived", adapter: "", status: "configured", available: false },
      ])
    })
  })

  it("persists per-agent memory provider policy through agent config", () => {
    const controller = withController(makeServer(), (controller) => controller)

    controller.setProfileDrafts({
      agent_remote: runtimeProfileDraft({ id: "agent_remote" }),
    })
    controller.setAgentDrafts({
      reviewer: agentDraft({
        id: "reviewer",
        runtime_profile: "agent_remote",
        memoryProvider: "agentmemory",
        memoryInject: false,
        memoryCapture: false,
        memoryTokenBudget: 500,
        memoryPolicyRest: {
          read_providers: ["agentmemory", "archive"],
          scope_mode: "shared",
        },
      }),
    })

    controller.saveAgentConfig()

    expect(mocks.vscode.postMessage).toHaveBeenCalledWith({
      type: "serverSettings.update",
      payload: expect.objectContaining({
        agent_registry: {
          agents: {
            reviewer: expect.objectContaining({
              memory: {
                primary_provider: "agentmemory",
                inject: false,
                capture: false,
                token_budget: 500,
                read_providers: ["agentmemory", "archive"],
                scope_mode: "shared",
              },
            }),
          },
        },
      }),
    })
  })

  it("preserves backend-only agent memory policy fields while saving visible agent edits", () => {
    const controller = withController(makeServer(), (controller) => controller)
    const reviewer = agentToDraft("reviewer", {
      name: "Reviewer",
      runtime_profile: "agent_remote",
      memory: {
        primary_provider: "agentmemory",
        read_providers: ["agentmemory", "archive"],
        scope_mode: "shared",
      },
    })

    expect(reviewer.memoryPolicyRest).toEqual({
      read_providers: ["agentmemory", "archive"],
      scope_mode: "shared",
    })

    controller.setProfileDrafts({
      agent_remote: runtimeProfileDraft({ id: "agent_remote" }),
    })
    controller.setAgentDrafts({ reviewer })
    controller.setSelectedAgentId("reviewer")
    controller.updateAgentField("memoryCapture", false)
    controller.saveAgentConfig()

    expect(mocks.vscode.postMessage).toHaveBeenCalledWith({
      type: "serverSettings.update",
      payload: expect.objectContaining({
        agent_registry: {
          agents: {
            reviewer: expect.objectContaining({
              memory: {
                primary_provider: "agentmemory",
                capture: false,
                read_providers: ["agentmemory", "archive"],
                scope_mode: "shared",
              },
            }),
          },
        },
      }),
    })
  })

  it("persists runtime profile worker identity and model request origin", () => {
    const controller = withController(makeServer(), (controller) => controller)

    controller.setProfileDrafts({
      agent_remote: {
        id: "agent_remote",
        executor: "reuleauxcoder",
        execution_location: "remote_server",
        worker_kind: "server_worker",
        model_request_origin: "server",
        runtime_home_policy: "per_task",
        approval_mode: "full",
        config_isolation: "",
        model: "",
        command: "",
        argsText: "",
        envText: "",
        credentialRefsText: "",
        mcpServersText: "",
      },
    })
    controller.setAgentDrafts({
      reviewer: agentDraft({
        id: "reviewer",
        runtime_profile: "agent_remote",
      }),
    })

    controller.saveAgentConfig()

    expect(mocks.vscode.postMessage).toHaveBeenCalledWith({
      type: "serverSettings.update",
      payload: expect.objectContaining({
        runtime_profiles: {
          agent_remote: expect.objectContaining({
            executor: "reuleauxcoder",
            execution_location: "remote_server",
            worker_kind: "server_worker",
            model_request_origin: "server",
          }),
        },
      }),
    })
  })

  it("persists agent model binding with model profile parameters", () => {
    const controller = withController(makeServer({
      connectionState: () => ({ status: "ready", authenticated: true, role: "superadmin" }),
      serverSettingsState: () => ({
        settings: {
          agent_registry: {
            agents: {
              capability_packager: {
                name: "Capability Packager",
                visibility: "system",
                role: "worker",
                system_flow_only: ["capability_ingest"],
                runtime_profile: "capability_packager_sandbox",
                capability_refs: ["capability_packager_builtin_tools"],
                max_concurrent_tasks: 1,
              },
            },
          },
        },
      }),
      modelProfilesState: () => ({
        model_profiles: [
          {
            id: "deepseek-main",
            provider: "deepseek",
            model: "deepseek-v4-pro",
            max_tokens: 384000,
            max_context_tokens: 1000000,
            temperature: 0.2,
            thinking_enabled: true,
          },
        ],
      }),
    }), (controller) => controller)

    controller.setProfileDrafts({
      capability_packager_sandbox: runtimeProfileDraft({
        id: "capability_packager_sandbox",
        worker_kind: "sandbox_worker",
      }),
    })
    controller.setAgentDrafts({
      capability_packager: agentDraft({
        id: "capability_packager",
        name: "Capability Packager",
        role: "coordinator",
        chat_entrypoint: true,
        visibility: "system",
        systemFlowOnlyText: "wrong_flow",
        runtime_profile: "wrong_profile",
        modelKey: "deepseek::deepseek-v4-pro",
        dispatchProfileText: "changed dispatch",
        dispatchExamplesText: "changed example",
        dispatchAvoidText: "changed avoid",
        systemAppend: "changed prompt",
        capabilityRefsText: "wrong_capability",
        credentialRefsText: "secret=wrong",
        memoryProvider: "agentmemory",
        memoryExposeTools: true,
      }),
    })

    controller.saveAgentConfig()

    expect(mocks.vscode.postMessage).toHaveBeenCalledWith({
      type: "serverSettings.update",
      payload: expect.objectContaining({
        agent_registry: {
          agents: {
            capability_packager: expect.objectContaining({
              role: "worker",
              system_flow_only: ["capability_ingest"],
              runtime_profile: "capability_packager_sandbox",
              capability_refs: ["capability_packager_builtin_tools"],
              model: {
                provider: "deepseek",
                model: "deepseek-v4-pro",
                parameters: expect.objectContaining({
                  max_tokens: 384000,
                  max_context_tokens: 1000000,
                  temperature: 0.2,
                  thinking_enabled: true,
                }),
              },
              memory: {
                primary_provider: "agentmemory",
                expose_tools: true,
              },
            }),
          },
        },
      }),
    })
    const posted = mocks.vscode.postMessage.mock.calls.at(-1)?.[0] as any
    const savedAgent = posted.payload.agent_registry.agents.capability_packager
    expect(savedAgent).not.toHaveProperty("chat_entrypoint")
    expect(savedAgent).not.toHaveProperty("delegable")
    expect(savedAgent).not.toHaveProperty("taskflow_eligible")
    expect(savedAgent).not.toHaveProperty("dispatch")
    expect(savedAgent).not.toHaveProperty("prompt")
    expect(savedAgent).not.toHaveProperty("credential_refs")
  })

  it("infers missing model request origin from executor and worker identity", () => {
    expect(profileToDraft("local_codex", {
      executor: "codex",
      execution_location: "local_workspace",
      worker_kind: "local_peer",
    }).model_request_origin).toBe("local_cli")
    expect(profileToDraft("remote_claude", {
      executor: "claude",
      execution_location: "remote_server",
      worker_kind: "server_worker",
    }).model_request_origin).toBe("server_worker_cli")
    expect(profileToDraft("agent_remote", {
      executor: "reuleauxcoder",
      execution_location: "remote_server",
      worker_kind: "server_worker",
    }).model_request_origin).toBe("server")
  })

  it("keeps edited runtime profile model request origin aligned with executor and worker identity", () => {
    const controller = withController(makeServer(), (controller) => controller)

    controller.setProfileDrafts({
      local_cli: {
        id: "local_cli",
        executor: "reuleauxcoder",
        execution_location: "remote_server",
        worker_kind: "server_worker",
        model_request_origin: "server",
        runtime_home_policy: "per_task",
        approval_mode: "full",
        config_isolation: "",
        model: "",
        command: "",
        argsText: "",
        envText: "",
        credentialRefsText: "",
        mcpServersText: "",
      },
    })
    controller.setSelectedProfileId("local_cli")

    controller.updateProfileField("executor", "codex")
    expect(controller.profileDrafts().local_cli.model_request_origin).toBe("server_worker_cli")
    controller.updateProfileField("execution_location", "local_workspace")
    controller.updateProfileField("worker_kind", "local_peer")
    expect(controller.profileDrafts().local_cli.model_request_origin).toBe("local_cli")
  })

  it.each([
    [
      {
        id: "bad_server_cli",
        executor: "codex",
        worker_kind: "server_worker",
        model_request_origin: "local_cli",
      },
      /model_request_origin=server_worker_cli/,
    ],
    [
      {
        id: "bad_local_cli",
        executor: "codex",
        execution_location: "local_workspace",
        worker_kind: "local_peer",
        model_request_origin: "server_worker_cli",
      },
      /model_request_origin=local_cli/,
    ],
    [
      {
        id: "bad_reuleauxcoder",
        executor: "reuleauxcoder",
        worker_kind: "server_worker",
        model_request_origin: "server_worker_cli",
      },
      /model_request_origin=server/,
    ],
  ])("rejects inconsistent runtime profile model request origin", (profile, message) => {
    const controller = withController(makeServer(), (controller) => controller)
    controller.setProfileDrafts({
      [String(profile.id)]: runtimeProfileDraft(profile),
    })

    expect(() => controller.validateAgentConfigDrafts()).toThrow(message)
  })

  it("accepts valid server and local cli runtime profile model request origins", () => {
    const controller = withController(makeServer(), (controller) => controller)
    controller.setProfileDrafts({
      agent_remote: runtimeProfileDraft({
        id: "agent_remote",
        executor: "reuleauxcoder",
        worker_kind: "server_worker",
        model_request_origin: "server",
      }),
      codex_local: runtimeProfileDraft({
        id: "codex_local",
        executor: "codex",
        execution_location: "local_workspace",
        worker_kind: "local_peer",
        model_request_origin: "local_cli",
      }),
      codex_remote: runtimeProfileDraft({
        id: "codex_remote",
        executor: "codex",
        execution_location: "remote_server",
        worker_kind: "server_worker",
        model_request_origin: "server_worker_cli",
      }),
    })

    expect(() => controller.validateAgentConfigDrafts()).not.toThrow()
  })

  it("rejects user agents without a runtime profile", () => {
    const controller = withController(makeServer(), (controller) => controller)

    controller.setProfileDrafts({
      agent_remote: {
        id: "agent_remote",
        executor: "reuleauxcoder",
        execution_location: "remote_server",
        worker_kind: "server_worker",
        model_request_origin: "server",
        runtime_home_policy: "per_task",
        approval_mode: "full",
        config_isolation: "",
        model: "",
        command: "",
        argsText: "",
        envText: "",
        credentialRefsText: "",
        mcpServersText: "",
      },
    })
    controller.setAgentDrafts({
      reviewer: agentDraft({
        id: "reviewer",
        runtime_profile: "",
      }),
    })

    expect(() => controller.validateAgentConfigDrafts()).toThrow(/必须选择 Runtime Profile/)
  })

  it("rejects taskflow user agents bound to local-only profiles", () => {
    const controller = withController(makeServer(), (controller) => controller)

    controller.setProfileDrafts({
      local_cli: {
        id: "local_cli",
        executor: "codex",
        execution_location: "local_workspace",
        worker_kind: "local_peer",
        model_request_origin: "local_cli",
        runtime_home_policy: "per_task",
        approval_mode: "full",
        config_isolation: "",
        model: "",
        command: "",
        argsText: "",
        envText: "",
        credentialRefsText: "",
        mcpServersText: "",
      },
    })
    controller.setAgentDrafts({
      local_worker: agentDraft({
        id: "local_worker",
        runtime_profile: "local_cli",
      }),
    })

    expect(() => controller.validateAgentConfigDrafts()).toThrow(/Taskflow.*服务端/)
  })
})
