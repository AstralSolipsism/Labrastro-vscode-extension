import { createRoot } from "solid-js"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  server: undefined as any,
  vscode: {
    postMessage: vi.fn(),
    onMessage: vi.fn(() => () => {}),
    getState: vi.fn(() => undefined),
    setState: vi.fn(),
  },
}))

vi.mock("../context/server", () => ({
  useServer: () => mocks.server,
}))

vi.mock("../context/vscode", () => ({
  useVSCode: () => mocks.vscode,
}))

import { createSettingsController } from "./useSettingsController"

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

describe("settings controller capability model", () => {
  beforeEach(() => {
    mocks.vscode.postMessage.mockClear()
    mocks.vscode.onMessage.mockClear()
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
      summary: "Skill · code-review · path=/skills/code-review",
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
})
