import { describe, expect, it } from "vitest"
import {
  PROVIDER_KIND_REGISTRY,
  approvalRuleDraftToPayload,
  agentDefinitionDraftToPayload,
  canUseSettingsAdminData,
  choiceListToText,
  inferProviderKind,
  isAccountAdminRole,
  modelOwnerDisplay,
  modelProfilePayload,
  normalizeEnvironmentSnapshot,
  providerDraftToPayload,
  providerListEmptyMessageForState,
  resolveConnectionNotice,
  resolveProviderProtocol,
  runtimeProfileDraftToPayload,
  settingsAdminRecordList,
  textToChoiceList,
  capabilityEditorToPayload,
  uniqueCommandRules,
} from "./utils"
import {
  connectionSaveResultKey,
  normalizeSettingsTab,
  sanitizeAutoApproveOptions,
  serverAgentRunSettingsPayload,
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
    const payload = modelProfilePayload({
      profileId: "deepseek-main",
      provider: "deepseek",
      model: "deepseek-chat",
      maxTokens: 384000,
      maxContextTokens: 1000000,
      temperature: 0,
      reasoningEffort: "",
      thinkingEnabled: true,
    })
    expect(payload).toMatchObject({
      profile_id: "deepseek-main",
      model: "deepseek-chat",
      max_context_tokens: 1000000,
      reasoning_effort: undefined,
      thinking_enabled: true,
    })
    expect(payload).not.toHaveProperty("api_key")
    expect(payload).not.toHaveProperty("base_url")
  })

  it("converts runtime profile drafts to agent runtime payloads", () => {
    const payload = runtimeProfileDraftToPayload({
      id: "codex",
      executor: "codex",
      execution_location: "local",
      worker_kind: "local_peer",
      model_request_origin: "local_cli",
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
      worker_kind: "local_peer",
      model_request_origin: "local_cli",
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

  it("builds capability payloads", () => {
    expect(capabilityEditorToPayload({
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

  it("normalizes environment snapshots without downgrading requirement kinds to cli", () => {
    expect(normalizeEnvironmentSnapshot({
      running: true,
      status: "completed",
      entries: [
        { id: "envreq:executable:gh", kind: "environment_requirement", requirement_kind: "executable", name: "gh" },
        { id: "docs", kind: "unexpected", name: "Docs" },
      ],
    })).toEqual({
      running: true,
      status: "completed",
      summary: "尚未运行。",
      entries: [
        { id: "envreq:executable:gh", kind: "environment_requirement", requirementKind: "executable", name: "gh" },
        { id: "docs", kind: "unsupported", requirementKind: "unsupported", name: "Docs" },
      ],
    })
  })

  it("deduplicates command rules while preserving order", () => {
    expect(uniqueCommandRules([" git status ", "", "npm test", "git status"])).toEqual([
      "git status",
      "npm test",
    ])
  })

  it("maps choice lists without losing historical custom values", () => {
    expect(textToChoiceList("github\ncontext7, github\ncustom-tool")).toEqual([
      "github",
      "context7",
      "custom-tool",
    ])
    expect(choiceListToText(["github", " context7 ", "github", "", "custom-tool"], ", ")).toBe("github, context7, custom-tool")
  })

  it("hides model owner text when it duplicates the provider", () => {
    expect(modelOwnerDisplay("deepseek", "deepseek")).toBeUndefined()
    expect(modelOwnerDisplay("DeepSeek", "deepseek")).toBeUndefined()
    expect(modelOwnerDisplay("provider", "deepseek")).toBeUndefined()
    expect(modelOwnerDisplay("openrouter", "deepseek")).toBe("openrouter")
  })

  it("serializes approval rule drafts to the server payload shape", () => {
    expect(approvalRuleDraftToPayload({
      tool_name: " shell ",
      tool_source: "",
      mcp_server: "",
      effect_class: "",
      profile: " agent-run ",
      action: "deny",
    })).toEqual({
      tool_name: "shell",
      profile: "agent-run",
      action: "deny",
    })
  })

  it("normalizes settings controller helper payloads", () => {
    expect(connectionSaveResultKey({
      hostUrlSaveRequested: "http://new",
      hostUrl: "http://old",
      hostUrlSaveApplied: false,
    })).toBe("http://new|http://old|false")
    expect(sanitizeAutoApproveOptions({ readOnly: true, execute: false, custom: true }).readOnly).toBe(true)
    expect(serverAgentRunSettingsPayload(2.8, 0)).toEqual({
      run_limits: {
        max_running_agents: 2,
        max_shells_per_agent: 1,
      },
    })
  })

  it("normalizes settings tab ids with legacy other compatibility", () => {
    expect(normalizeSettingsTab("conversation")).toBe("conversation")
    expect(normalizeSettingsTab("diagnostics")).toBe("diagnostics")
    expect(normalizeSettingsTab("other")).toBe("conversation")
    expect(normalizeSettingsTab("unknown")).toBeUndefined()
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

  it("gates provider and profile records by current authenticated admin state", () => {
    const oldAdminState = {
      providers: [{ id: "stale-provider" }],
      model_profiles: [{ profile_id: "stale-profile" }],
    }

    expect(canUseSettingsAdminData({ authenticated: true, role: "admin" })).toBe(true)
    expect(canUseSettingsAdminData({ authenticated: false, role: "admin" })).toBe(false)
    expect(canUseSettingsAdminData({ authenticated: true, role: "user" })).toBe(false)
    expect(settingsAdminRecordList(oldAdminState, "providers", false)).toEqual([])
    expect(settingsAdminRecordList(oldAdminState, "model_profiles", false)).toEqual([])
    expect(settingsAdminRecordList(oldAdminState, "providers", true)).toEqual([{ id: "stale-provider" }])
  })

  it("explains why provider records are not currently available", () => {
    expect(providerListEmptyMessageForState({ connectionStatus: "checking" })).toBe("正在检查登录状态。")
    expect(providerListEmptyMessageForState({ connectionStatus: "ready", authenticated: false })).toBe("未登录，无法加载服务商。")
    expect(providerListEmptyMessageForState({ connectionStatus: "ready", authenticated: true, adminUsable: false })).toBe("当前账号没有管理服务商的权限。")
    expect(providerListEmptyMessageForState({ connectionStatus: "ready", authenticated: true, adminUsable: true, loading: true })).toBe("正在加载服务商...")
    expect(providerListEmptyMessageForState({ connectionStatus: "ready", authenticated: true, adminUsable: true, adminError: "failed" })).toBe("服务商列表加载失败。")
    expect(providerListEmptyMessageForState({ connectionStatus: "ready", authenticated: true, adminUsable: true })).toBe("暂无服务商")
  })
})
