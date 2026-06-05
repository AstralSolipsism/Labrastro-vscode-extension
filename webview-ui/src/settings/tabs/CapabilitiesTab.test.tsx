import { createRequire } from "node:module"
import { dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { build } from "esbuild"
import { solidPlugin } from "esbuild-plugin-solid"
import { describe, expect, it } from "vitest"
import {
  hookRuntimeStatusItems,
  isManageableLifecycleHook,
  lifecycleHookDetailItems,
  lifecycleHookTrustActionPayload,
} from "./CapabilitiesTab"

const requireFromTest = createRequire(import.meta.url)
const testDir = dirname(fileURLToPath(import.meta.url))

function stringValue(value: unknown, fallback = ""): string {
  if (value === undefined || value === null) return fallback
  return String(value)
}

function lifecycleHook(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "hook:mcp_server:github:PreToolUse:0",
    event: "PreToolUse",
    source: "mcp_server",
    placement: "server",
    handlerType: "mcp_tool",
    displayName: "GitHub MCP guard",
    summary: "Guard GitHub MCP calls.",
    trust: "trusted",
    enabled: true,
    executable: false,
    canManage: true,
    unavailableReason: "runtime_unavailable:cwd",
    placementRuntime: {
      server: { executable: false, unavailableReason: "runtime_unavailable:cwd" },
    },
    permissions: ["mcp.invoke"],
    credentials: ["GITHUB_TOKEN"],
    riskLevel: "high",
    recentResult: {
      status: "denied",
      summary: "Denied dangerous GitHub operation",
    },
    technical: {
      matcher: { tool_names: ["github.create_issue"] },
      handler_ref: "mcp://github/hooks/pretool",
    },
    ...overrides,
  }
}

function capabilitiesTabFixture(): Record<string, unknown> {
  const mcpHook = lifecycleHook()
  const packageHook = lifecycleHook({
    id: "hook:capability_package:repo-review:SessionStart:0",
    event: "SessionStart",
    source: "capability_package",
    placement: "server",
    handlerType: "prompt",
    displayName: "Review package startup",
    summary: "Explain review package startup.",
    trust: "pending_review",
    executable: false,
    canManage: true,
    unavailableReason: "trust:pending_review",
    permissions: ["prompt.review"],
    credentials: ["REVIEW_TOKEN"],
    riskLevel: "medium",
    recentResult: {
      status: "allowed",
      summary: "Package startup hook allowed",
    },
    technical: { matcher: { session: "new" } },
  })
  const serverSettings = {
    capability_packages: {
      "repo-review": {
        name: "Repo review package",
        description: "Review repository actions.",
        components: ["mcp:github"],
        enabled: true,
        status: "installed",
        risk_level: "medium",
        credentials: ["REVIEW_TOKEN"],
        runtime_footprint: { runs_on: "server" },
        hook_views: [packageHook],
      },
    },
    capability_components: {
      "mcp:github": {
        kind: "mcp",
        role: "capability",
        name: "github",
        display_name: "GitHub MCP",
        summary: "GitHub MCP component.",
        runtime_footprint: { runs_on: "server" },
        hook_views: [mcpHook],
      },
    },
  }
  const mcpCapability = {
    id: "mcp_server:github",
    kind: "mcp_server",
    name: "github",
    displayName: "GitHub MCP",
    label: "MCP Server",
    summary: "GitHub MCP capability.",
    description: "Manage GitHub repository operations.",
    enabled: true,
    status: "available",
    runtimeFootprint: {
      runsOn: "server",
      installRequiredOn: [],
      configRequiredOn: [],
      userMessage: "",
    },
    sourcePackageIds: ["repo-review"],
    dependencyIds: [],
    hooks: [mcpHook],
    raw: {
      id: "mcp:github",
      kind: "mcp",
      name: "github",
      command: "github-mcp",
      args: ["stdio", "--verbose"],
      env: { GITHUB_TOKEN: "${env:GITHUB_TOKEN}" },
      risk_level: "high",
      credentials: ["GITHUB_TOKEN"],
    },
    mcp: {
      command: "github-mcp",
      args: ["stdio", "--verbose"],
      env: { GITHUB_TOKEN: "${env:GITHUB_TOKEN}" },
      url: "",
      transport: "stdio",
      cwd: "/repo",
      environmentRequirementRefs: [],
    },
  }

  return {
    serverSettings,
    capabilityViews: [mcpCapability],
    capabilityDashboardItems: [mcpCapability.raw],
  }
}

function skillCapabilitiesTabFixture(): Record<string, unknown> {
  const skillHook = lifecycleHook({
    id: "hook:skill:code-review:UserPromptSubmit:0",
    event: "UserPromptSubmit",
    source: "skill",
    placement: "server",
    handlerType: "prompt",
    displayName: "Code review prompt guard",
    summary: "Reviews prompts before the model sees them.",
    trust: "trusted",
    executable: true,
    canManage: true,
    unavailableReason: "",
    placementRuntime: {
      server: { executable: true, unavailableReason: "" },
    },
    permissions: ["prompt.read"],
    credentials: [],
    riskLevel: "low",
    recentResult: {
      status: "success",
      summary: "Skill guard accepted prompt",
    },
    technical: {
      handler_ref: "skills/code-review/SKILL.md",
    },
  })
  const skillCapability = {
    id: "skill:code-review",
    kind: "skill",
    name: "code-review",
    displayName: "Code review skill",
    label: "Skill",
    summary: "Review repository prompts.",
    description: "Review repository prompts before model execution.",
    enabled: true,
    status: "available",
    runtimeFootprint: {
      runsOn: "agent_only",
      installRequiredOn: [],
      configRequiredOn: [],
      userMessage: "",
    },
    sourcePackageIds: ["repo-review"],
    dependencyIds: [],
    hooks: [skillHook],
    raw: {
      id: "skill:code-review",
      kind: "skill",
      name: "code-review",
      risk_level: "low",
    },
    skill: {
      pathHint: "skills/code-review/SKILL.md",
      sourcePath: "skills/code-review/SKILL.md",
      globalEnabled: true,
      disabled: false,
      installPrompt: "",
      verifyPrompt: "",
      docs: [],
      evidence: [],
    },
  }
  return {
    serverSettings: {
      capability_packages: {
        "repo-review": {
          name: "Repo review package",
          components: ["skill:code-review"],
          enabled: true,
          status: "installed",
          risk_level: "low",
        },
      },
      capability_components: {},
    },
    capabilityViews: [skillCapability],
    capabilityDashboardItems: [skillCapability.raw],
  }
}

async function renderCapabilitiesTab(fixture: Record<string, unknown>): Promise<string> {
  const result = await build({
    stdin: {
      contents: [
        'import { createComponent, renderToString } from "solid-js/web";',
        'import { CapabilitiesTab } from "./CapabilitiesTab";',
        `const fixture = ${JSON.stringify(fixture)};`,
        "function objectValue(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }",
        "function stringValue(value, fallback = '') { return value === undefined || value === null ? fallback : String(value); }",
        "function numberValue(value, fallback = 0) { return typeof value === 'number' && Number.isFinite(value) ? value : fallback; }",
        "const operations = { isBusy: () => false, error: () => '', state: () => ({ status: 'idle' }) };",
        "const controller = {",
        "  environmentStatusTone: () => undefined,",
        "  environmentStatusLabel: (status) => status || 'unknown',",
        "  environmentRunStatusLabel: (status) => status || 'idle',",
        "  formatTimestamp: (value) => stringValue(value, 'never'),",
        "  operations,",
        "  pageRefreshing: () => false,",
        "  serverSettingsSaveBusy: () => false,",
        "  refreshCapabilities: () => {},",
        "  saveCapabilitySettings: () => {},",
        "  recordCapability: () => {},",
        "  enableCapability: () => {},",
        "  deleteCapabilityRecord: () => {},",
        "  capabilityEditor: () => undefined,",
        "  setCapabilityEditor: () => {},",
        "  emptyCapabilityEditor: () => ({}),",
        "  capabilityEditorFromRecord: () => ({}),",
        "  capabilityPayloadFromEditor: () => ({}),",
        "  stringValue, objectValue, numberValue,",
        "  server: { serverSettingsState: () => ({ settings: fixture.serverSettings }) },",
        "  runEnvironment: () => {},",
        "  environmentSnapshot: () => ({ status: 'idle', running: false, lastManifestAt: '2026-06-05T00:00:00.000Z', entries: [], logs: [] }),",
        "  environmentError: () => '',",
        "  environmentAgentCandidates: () => [{ id: 'agent-1', name: 'Agent' }],",
        "  capabilityError: () => '',",
        "  capabilityActionFeedback: () => '',",
        "  selectedEnvironmentApproval: () => undefined,",
        "  setSelectedEnvironmentApproval: () => {},",
        "  replyEnvironmentApproval: () => {},",
        "  rememberEnvironmentApprovalDecision: () => {},",
        "  capabilityBehaviorError: () => '',",
        "  chatCommandCatalogItems: () => [],",
        "  mentionProviderCatalogItems: () => [],",
        "  uiActionCatalogItems: () => [],",
        "  agentToolCatalogItems: () => [],",
        "  capabilityStatusFilter: () => 'all',",
        "  setCapabilityStatusFilter: () => {},",
        "  capabilitySearch: () => '',",
        "  setCapabilitySearch: () => {},",
        "  capabilityDashboardItems: () => fixture.capabilityDashboardItems,",
        "  capabilityViews: () => fixture.capabilityViews,",
        "  capabilityDependencyViews: () => [],",
        "  selectedCapabilityId: () => '',",
        "  setSelectedCapabilityId: () => {},",
        "  dashboardItemToRecord: (item) => item,",
        "  capabilitySourceLabel: (source) => source,",
        "  placementLabel: (placement) => placement,",
        "  capabilitySourceType: () => 'github_repo',",
        "  setCapabilitySourceType: () => {},",
        "  capabilitySourceUrl: () => '',",
        "  setCapabilitySourceUrl: () => {},",
        "  capabilitySourceNotes: () => '',",
        "  setCapabilitySourceNotes: () => {},",
        "  capabilityPackageIdHint: () => '',",
        "  setCapabilityPackageIdHint: () => {},",
        "  capabilityPackageIngestState: () => ({ status: 'idle', error: '' }),",
        "  startCapabilityPackageIngest: () => {},",
        "  deleteCapabilityPackage: () => {},",
        "  enableCapabilityPackage: () => {},",
        "  pageInitialLoading: () => false,",
        "  pageRevalidating: () => false,",
        "  pageLoadingMessage: () => '',",
        "};",
        "globalThis.confirm = globalThis.confirm || (() => true);",
        "export default renderToString(() => createComponent(CapabilitiesTab, { controller }));",
      ].join("\n"),
      resolveDir: testDir,
      loader: "ts",
    },
    bundle: true,
    write: false,
    format: "cjs",
    platform: "node",
    plugins: [solidPlugin({ solid: { generate: "ssr" } })],
    logLevel: "silent",
  })
  const module = { exports: {} as { default?: string } }
  new Function("require", "module", "exports", result.outputFiles[0].text)(
    requireFromTest,
    module,
    module.exports,
  )
  return module.exports.default || ""
}

describe("CapabilitiesTab lifecycle hook management", () => {
  it("only allows backend-managed lifecycle hooks with server-provided ids to be managed", () => {
    expect(isManageableLifecycleHook({
      id: "hook:mcp_server:github:PostToolUse:0",
      can_manage: true,
    })).toBe(true)

    expect(isManageableLifecycleHook({
      id: "",
      can_manage: true,
    })).toBe(false)

    expect(isManageableLifecycleHook({
      id: "author-supplied-id",
      can_manage: false,
    })).toBe(false)
  })

  it("surfaces server and peer runtime states for both-placement lifecycle hooks", () => {
    expect(hookRuntimeStatusItems({
      placement: "both",
      executable: true,
      placementRuntime: {
        server: {
          executable: true,
          unavailableReason: "",
        },
        peer: {
          executable: false,
          unavailableReason: "peer_runtime_unavailable",
        },
      },
    })).toEqual([
      "服务端：可执行",
      "本地端：不可执行：peer_runtime_unavailable",
    ])
  })

  it("includes risk, credentials, and recent result in lifecycle hook detail text", () => {
    expect(lifecycleHookDetailItems({
      event: "PreToolUse",
      source: "mcp_server",
      placement: "server",
      trust: "trusted",
      executable: false,
      unavailableReason: "runtime_unavailable:cwd",
      permissions: ["shell.read"],
      credentials: ["GITHUB_TOKEN"],
      riskLevel: "high",
      recentResult: {
        status: "denied",
        summary: "Denied shell command",
      },
    })).toEqual([
      "来源：MCP Server",
      "事件：PreToolUse",
      "运行位置：服务端",
      "执行状态：服务端：不可执行：runtime_unavailable:cwd",
      "信任状态：已信任",
      "权限需求：shell.read",
      "凭据：GITHUB_TOKEN",
      "风险：high",
      "最近结果：已阻断 · Denied shell command",
    ])
  })

  it("builds lifecycle hook trust actions only from backend-managed hook ids", () => {
    expect(lifecycleHookTrustActionPayload({
      id: "hook:mcp_server:github:PostToolUse:0",
      can_manage: true,
    }, "trusted")).toEqual({
      kind: "lifecycle_hook",
      payload: {
        hook_id: "hook:mcp_server:github:PostToolUse:0",
        trust: "trusted",
      },
    })

    expect(lifecycleHookTrustActionPayload({
      id: "author-supplied-id",
      can_manage: false,
    }, "blocked")).toBeUndefined()

    expect(lifecycleHookTrustActionPayload({
      id: "",
      can_manage: true,
    }, "disabled")).toBeUndefined()
  })

  it("renders MCP lifecycle hook trust, risk, recent result, and runtime details in the management component", async () => {
    const html = await renderCapabilitiesTab(capabilitiesTabFixture())

    expect(html).toContain("GitHub MCP")
    expect(html).toContain("github-mcp")
    expect(html).toContain("args=stdio --verbose")
    expect(html).toContain("env=GITHUB_TOKEN")
    expect(html).toContain("GitHub MCP guard")
    expect(html).toContain("Guard GitHub MCP calls.")
    expect(html).toContain("来源：MCP Server")
    expect(html).toContain("事件：PreToolUse")
    expect(html).toContain("信任状态：已信任")
    expect(html).toContain("权限需求：mcp.invoke")
    expect(html).toContain("凭据：GITHUB_TOKEN")
    expect(html).toContain("风险：high")
    expect(html).toContain("最近结果：已阻断 · Denied dangerous GitHub operation")
    expect(html).toContain("Review package startup")
    expect(html).toContain("信任状态：待审查")
    expect(html).toContain("最近结果：成功 · Package startup hook allowed")
    expect(html).toContain("REVIEW_TOKEN")
  })

  it("renders Skill lifecycle hook source package, trust, risk, and recent result in the management component", async () => {
    const html = await renderCapabilitiesTab(skillCapabilitiesTabFixture())

    expect(html).toContain("Code review skill")
    expect(html).toContain("来源能力包：repo-review")
    expect(html).toContain("Code review prompt guard")
    expect(html).toContain("Reviews prompts before the model sees them.")
    expect(html).toContain("来源：Skill")
    expect(html).toContain("事件：UserPromptSubmit")
    expect(html).toContain("信任状态：已信任")
    expect(html).toContain("权限需求：prompt.read")
    expect(html).toContain("风险：low")
    expect(html).toContain("最近结果：成功 · Skill guard accepted prompt")
  })
})
