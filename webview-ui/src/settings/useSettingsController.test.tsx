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

import { createSettingsController, profileToDraft } from "./useSettingsController"
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
      summary: "Skill · code-review · installed path=/skills/code-review",
      skillStatus: "disabled",
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

  it("does not keep settings-owned capability package polling or draft approval paths", () => {
    expect(settingsControllerSource).not.toContain("capabilityPackage.draft.accept")
    expect(settingsControllerSource).not.toContain("capabilityPackage.ingest.status")
    expect(settingsControllerSource).not.toContain("capabilityIngestPollTimer")
    expect(settingsControllerSource).not.toContain("acceptCapabilityPackageDraft")
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
      reviewer: {
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
      },
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
      capability_packager: {
        id: "capability_packager",
        name: "Capability Packager",
        description: "",
        role: "coordinator",
        chat_entrypoint: true,
        visibility: "system",
        delegable: true,
        taskflow_eligible: true,
        systemFlowOnlyText: "wrong_flow",
        runtime_profile: "wrong_profile",
        modelKey: "deepseek::deepseek-v4-pro",
        dispatchProfileText: "changed dispatch",
        dispatchExamplesText: "changed example",
        dispatchAvoidText: "changed avoid",
        systemAppend: "changed prompt",
        agentMd: "",
        capabilityRefsText: "wrong_capability",
        max_concurrent_tasks: 1,
        credentialRefsText: "secret=wrong",
      },
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
      reviewer: {
        id: "reviewer",
        name: "",
        description: "",
        role: "worker",
        chat_entrypoint: false,
        visibility: "user",
        delegable: true,
        taskflow_eligible: true,
        systemFlowOnlyText: "",
        runtime_profile: "",
        modelKey: "",
        dispatchProfileText: "",
        dispatchExamplesText: "",
        dispatchAvoidText: "",
        systemAppend: "",
        agentMd: "",
        capabilityRefsText: "",
        max_concurrent_tasks: 1,
        credentialRefsText: "",
      },
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
      local_worker: {
        id: "local_worker",
        name: "",
        description: "",
        role: "worker",
        chat_entrypoint: false,
        visibility: "user",
        delegable: true,
        taskflow_eligible: true,
        systemFlowOnlyText: "",
        runtime_profile: "local_cli",
        modelKey: "",
        dispatchProfileText: "",
        dispatchExamplesText: "",
        dispatchAvoidText: "",
        systemAppend: "",
        agentMd: "",
        capabilityRefsText: "",
        max_concurrent_tasks: 1,
        credentialRefsText: "",
      },
    })

    expect(() => controller.validateAgentConfigDrafts()).toThrow(/Taskflow.*服务端/)
  })
})
