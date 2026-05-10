import { describe, expect, it } from "vitest"
import {
  PROVIDER_KIND_REGISTRY,
  agentDefinitionDraftToPayload,
  inferProviderKind,
  isAccountAdminRole,
  modelProfilePayload,
  normalizeEnvironmentSnapshot,
  providerDraftToPayload,
  resolveConnectionNotice,
  resolveProviderProtocol,
  runtimeProfileDraftToPayload,
  toolchainEditorToPayload,
  uniqueCommandRules,
} from "./utils"
import {
  connectionSaveResultKey,
  sanitizeAutoApproveOptions,
  serverAgentRuntimeSettingsPayload,
} from "./settingsControllerUtils"

describe("settings utils", () => {
  it("builds provider payloads without leaking empty api keys", () => {
    expect(providerDraftToPayload({
      providerId: "deepseek",
      type: "openai_chat",
      compat: "deepseek",
      baseUrl: "https://api.deepseek.com",
      apiKey: "",
      enabled: true,
    })).toEqual({
      provider_id: "deepseek",
      type: "openai_chat",
      compat: "deepseek",
      base_url: "https://api.deepseek.com",
      api_key: undefined,
      enabled: true,
    })
  })

  it("maps provider kinds to the saved protocol fields", () => {
    expect(resolveProviderProtocol("deepseek")).toEqual({
      type: "openai_chat",
      compat: "deepseek",
    })
    expect(resolveProviderProtocol("anthropic")).toEqual({
      type: "anthropic_messages",
      compat: "generic",
    })
    expect(resolveProviderProtocol("openai-responses")).toEqual({
      type: "openai_responses",
      compat: "generic",
    })
  })

  it("keeps provider types searchable without changing the save payload schema", () => {
    const deepseek = PROVIDER_KIND_REGISTRY.find((kind) => kind.id === "deepseek")
    expect(deepseek).toMatchObject({
      label: "DeepSeek",
      aliases: expect.arrayContaining(["deepseek"]),
      defaultBaseUrl: "https://api.deepseek.com",
      type: "openai_chat",
      compat: "deepseek",
    })
  })

  it("infers provider kinds from saved provider metadata", () => {
    expect(inferProviderKind({
      providerId: "moonshot",
      baseUrl: "https://api.moonshot.cn/v1",
      type: "openai_chat",
      compat: "generic",
    })).toBe("kimi")
    expect(inferProviderKind({
      providerId: "claude",
      baseUrl: "https://api.anthropic.com",
      type: "anthropic_messages",
      compat: "generic",
    })).toBe("anthropic")
    expect(inferProviderKind({
      providerId: "private-gateway",
      baseUrl: "https://llm.example.test/v1",
      type: "openai_chat",
      compat: "generic",
    })).toBe("openai-compatible")
  })

  it("builds model profile payloads", () => {
    expect(modelProfilePayload({
      profileId: "deepseek-main",
      provider: "deepseek",
      model: "deepseek-chat",
      maxTokens: 4096,
      maxContextTokens: 128000,
      temperature: 0,
      reasoningEffort: "",
      thinkingEnabled: true,
    })).toMatchObject({
      profile_id: "deepseek-main",
      model: "deepseek-chat",
      reasoning_effort: undefined,
      thinking_enabled: true,
    })
  })

  it("converts runtime profile drafts to agent runtime payloads", () => {
    const payload = runtimeProfileDraftToPayload({
      id: "codex",
      executor: "codex",
      execution_location: "local",
      model: "gpt-5.2",
      command: "codex",
      argsText: "--approval-mode full-auto\n--model gpt-5.2",
      envText: "OPENAI_BASE_URL=https://example.test",
      mcpServersText: "github\ncontext7",
      allowedToolsText: "read_file, write_file",
      deniedToolsText: "delete_file",
      homePolicy: "shared",
      approvalMode: "manual",
      configIsolation: "profile",
      credentialRefsText: "OPENAI_API_KEY",
    })

    expect(payload).toMatchObject({
      executor: "codex",
      execution_location: "local",
      args: ["--approval-mode full-auto", "--model gpt-5.2"],
      env: { OPENAI_BASE_URL: "https://example.test" },
      mcp: { servers: ["github", "context7"] },
      allowed_tools: ["read_file", "write_file"],
      denied_tools: ["delete_file"],
      credential_refs: ["OPENAI_API_KEY"],
    })
  })

  it("converts agent definition drafts", () => {
    expect(agentDefinitionDraftToPayload({
      id: "reviewer",
      name: "Reviewer",
      description: "",
      runtime_profile: "codex",
      max_concurrent_tasks: 0,
      dispatchProfileText: "Best for reviewing backend changes.",
      dispatchExamplesText: "Review a runtime patch\nCheck test coverage",
      dispatchAvoidText: "Production deploys",
      systemAppend: "Be concise.",
      capabilityRefsText: "github-review",
      credentialRefsText: "",
    })).toMatchObject({
      name: "Reviewer",
      description: undefined,
      runtime_profile: "codex",
      max_concurrent_tasks: 1,
      dispatch: {
        profile: "Best for reviewing backend changes.",
        examples: ["Review a runtime patch", "Check test coverage"],
        avoid: ["Production deploys"],
      },
      capability_refs: ["github-review"],
    })
  })

  it("builds toolchain payloads", () => {
    expect(toolchainEditorToPayload({
      kind: "mcp",
      name: "context7",
      enabled: true,
      command: "npx",
      argsText: "@upstash/context7-mcp",
      envText: "TOKEN=abc",
      tagsText: "docs",
      check: "npx context7 --help",
      install: "npm install",
      repoUrl: "https://github.com/upstash/context7",
      docsText: "Docs | https://context7.com",
    })).toMatchObject({
      kind: "mcp",
      name: "context7",
      tags: ["docs"],
      args: ["@upstash/context7-mcp"],
      env: { TOKEN: "abc" },
      docs: [{ title: "Docs", url: "https://context7.com" }],
    })
  })

  it("normalizes environment snapshots defensively", () => {
    expect(normalizeEnvironmentSnapshot({
      running: true,
      status: "completed",
      entries: [
        { id: "node", kind: "cli", name: "Node.js" },
        { id: "docs", kind: "unexpected", name: "Docs" },
      ],
    })).toEqual({
      running: true,
      status: "completed",
      summary: "尚未运行。",
      entries: [
        { id: "node", kind: "cli", name: "Node.js" },
        { id: "docs", kind: "cli", name: "Docs" },
      ],
    })
  })

  it("deduplicates command rules while preserving order", () => {
    expect(uniqueCommandRules([" git status ", "", "npm test", "git status"])).toEqual([
      "git status",
      "npm test",
    ])
  })

  it("normalizes settings controller helper payloads", () => {
    expect(connectionSaveResultKey({
      hostUrlSaveRequested: "http://new",
      hostUrl: "http://old",
      hostUrlSaveApplied: false,
    })).toBe("http://new|http://old|false")
    expect(sanitizeAutoApproveOptions({ readOnly: true, execute: false, custom: true }).readOnly).toBe(true)
    expect(serverAgentRuntimeSettingsPayload(2.8, 0)).toEqual({
      agent_runtime: {
        max_running_agents: 2,
        max_shells_per_agent: 1,
      },
    })
  })

  it("does not render an extra notice for an authenticated ready connection", () => {
    expect(resolveConnectionNotice({
      status: "ready",
      authenticated: true,
      message: "Labrastro Host 已登录。",
    })).toBeUndefined()
  })

  it("maps connection messages to status-appropriate notice tones", () => {
    expect(resolveConnectionNotice({
      status: "login-required",
      authenticated: false,
      message: "请登录 Labrastro Host。",
    })).toMatchObject({
      tone: "warning",
      icon: "warning",
    })
    expect(resolveConnectionNotice({
      status: "error",
      authenticated: false,
      message: "Auth API unreachable",
    })).toMatchObject({
      tone: "error",
      icon: "error",
    })
  })

  it("allows the accounts surface only for admin roles", () => {
    expect(isAccountAdminRole("admin")).toBe(true)
    expect(isAccountAdminRole("superadmin")).toBe(true)
    expect(isAccountAdminRole("user")).toBe(false)
    expect(isAccountAdminRole(undefined)).toBe(false)
  })
})
