import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import {
  aggregateRuntimeFootprint,
  capabilityEnabledStatusLabel,
  capabilityEnabledStatusTone,
  capabilityInstallPreviewFromMcpJson,
  capabilityInstallStatusLabel,
  capabilityInstallStatusTone,
  capabilityPackageStatePayload,
  capabilityPackageStateView,
  capabilityPackageUserStateLabel,
  capabilityViewsFromSources,
  capabilityComponentSummary,
  credentialBindingScopeLabel,
  credentialRequirementViews,
  groupCapabilityPackageComponents,
  manualStepUserActionLabel,
  normalizeLifecycleHookViews,
  runtimeFootprintBadgeTone,
  runtimeFootprintLabel,
  targetStatusLabel,
  updateStateLabel,
} from "./capabilityPackageView"

describe("capability package component view", () => {
  it("does not reintroduce raw hooks fallbacks for lifecycle hook views", () => {
    const files = [
      new URL("./capabilityPackageView.ts", import.meta.url),
      new URL("./useSettingsController.tsx", import.meta.url),
      new URL("./tabs/CapabilitiesTab.tsx", import.meta.url),
    ]
    const forbidden = [
      "|| item.hooks",
      "|| record.hooks",
      "|| component.hooks",
      "|| config.hooks",
      "normalizeLifecycleHookViews(record.hooks",
      "normalizeLifecycleHookViews(item.hooks",
    ]

    for (const file of files) {
      const text = readFileSync(file, "utf8")
      for (const pattern of forbidden) {
        expect(text, `${pattern} found in ${file.pathname}`).not.toContain(pattern)
      }
    }
  })

  const components = {
    "skill:code-review": {
      kind: "skill",
      name: "code-review",
      display_name: "Code review",
      summary: "Review repository changes before merging.",
      package_ids: ["repo-review"],
      config: {
        path_hint: "/skills/code-review",
      },
    },
    "mcp:github": {
      kind: "mcp",
      name: "github",
      config: {
        command: "github-mcp-server",
      },
      runtime_footprint: {
        runs_on: "server",
        install_required_on: ["server"],
        config_required_on: ["server"],
        user_message: "服务端运行，无需本机安装",
      },
    },
    "envreq:sdk:dotnet": {
      kind: "environment_requirement",
      name: "dotnet",
      config: {
        kind: "sdk",
        requirements: { version: ">=8" },
        placement: "peer",
      },
    },
    "credential:GITHUB_TOKEN": {
      kind: "credential",
      name: "GITHUB_TOKEN",
    },
  }

  it("groups capability package components into user-facing capabilities and dependencies", () => {
    const groups = groupCapabilityPackageComponents(
      [
        "skill:code-review",
        "mcp:github",
        "envreq:sdk:dotnet",
        "credential:GITHUB_TOKEN",
      ],
      components,
      { skillsEnabled: true, disabledSkills: [] },
    )

    expect(groups.capabilities.map((item) => item.id)).toEqual([
      "skill:code-review",
      "mcp:github",
    ])
    expect(groups.dependencies.map((item) => item.id)).toEqual([
      "envreq:sdk:dotnet",
      "credential:GITHUB_TOKEN",
    ])
    expect(groups.capabilities[0]).toMatchObject({
      kind: "skill",
      name: "code-review",
      displayName: "Code review",
      packageIds: ["repo-review"],
      pathHint: "/skills/code-review",
      skillStatus: "enabled",
      summary: "Review repository changes before merging.",
      runtimeFootprint: {
        runsOn: "agent_only",
        installRequiredOn: [],
        configRequiredOn: [],
        userMessage: "仅 Agent 指令能力，无需外部进程",
      },
    })
    expect(groups.dependencies[0].summary).toBe("SDK · dotnet · version >=8")
    expect(groups.capabilities[1].runtimeFootprint.userMessage).toBe("服务端运行，无需本机安装")
    expect(groups.dependencies[0].runtimeFootprint.userMessage).toBe("需要在本机安装/配置")
  })

  it("labels runtime footprint for user-facing display", () => {
    expect(runtimeFootprintLabel({
      runs_on: "server",
      install_required_on: ["server"],
      config_required_on: ["server"],
    })).toBe("服务端运行，无需本机安装")
    expect(runtimeFootprintLabel({
      runs_on: "local_peer",
      install_required_on: ["local_peer"],
      config_required_on: ["local_peer"],
    })).toBe("需要在本机安装/配置")
    expect(runtimeFootprintBadgeTone({
      runs_on: "local_peer",
      install_required_on: ["local_peer"],
      config_required_on: ["local_peer"],
    })).toBe("warning")
    expect(aggregateRuntimeFootprint([
      { runs_on: "server", install_required_on: ["server"], config_required_on: ["server"] },
      { runs_on: "local_peer", install_required_on: ["local_peer"], config_required_on: ["local_peer"] },
    ])).toMatchObject({
      runsOn: "both",
      userMessage: "服务端和本地端都需要配置",
    })
  })

  it("previews standard MCP JSON install snippets", () => {
    const preview = capabilityInstallPreviewFromMcpJson(`{
      "mcpServers": {
        "edgeone-pages-mcp-server": {
          "command": "npx",
          "args": ["edgeone-pages-mcp"],
          "env": {"EDGEONE_TOKEN": "${"${EDGEONE_TOKEN}"}"}
        }
      }
    }`)

    expect(preview.ok).toBe(true)
    expect(preview.servers[0]).toMatchObject({
      name: "edgeone-pages-mcp-server",
      command: "npx",
      args: ["edgeone-pages-mcp"],
      envKeys: ["EDGEONE_TOKEN"],
    })
    expect(preview.servers[0].runtimeFootprint.userMessage).toBe("服务端运行，无需本机安装")
  })

  it("surfaces peer runtime requirements from pasted MCP JSON", () => {
    const preview = capabilityInstallPreviewFromMcpJson(`{
      "mcpServers": {
        "filesystem": {
          "command": "npx",
          "args": ["-y", "@modelcontextprotocol/server-filesystem"],
          "runtime_footprint": {
            "runs_on": "peer",
            "install_required_on": ["peer"],
            "config_required_on": ["peer"]
          }
        }
      }
    }`)

    expect(preview.ok).toBe(true)
    expect(preview.servers[0]).toMatchObject({
      name: "filesystem",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-filesystem"],
      runtimeFootprint: {
        runsOn: "local_peer",
        installRequiredOn: ["local_peer"],
        configRequiredOn: ["local_peer"],
        userMessage: "需要在本机安装/配置",
      },
    })
  })

  it("describes skill disabled state from global and per-skill settings", () => {
    expect(groupCapabilityPackageComponents(
      ["skill:code-review"],
      components,
      { skillsEnabled: true, disabledSkills: ["code-review"] },
    ).capabilities[0].skillStatus).toBe("disabled")

    expect(groupCapabilityPackageComponents(
      ["skill:code-review"],
      components,
      { skillsEnabled: false, disabledSkills: [] },
    ).capabilities[0].skillStatus).toBe("global_disabled")

    expect(groupCapabilityPackageComponents(
      [{ id: "skill:stopped-review", kind: "skill", name: "stopped-review", enabled: false }],
      {},
      { skillsEnabled: true, disabledSkills: [] },
    ).capabilities[0].skillStatus).toBe("disabled")
  })

  it("uses capability and dependency labels in summaries", () => {
    expect(capabilityComponentSummary({
      kind: "mcp_server",
      name: "github",
    })).toBe("MCP Server · Github")
    expect(capabilityComponentSummary({
      kind: "skill",
      name: "code-review",
      path_hint: "/skills/code-review/SKILL.md",
    })).toBe("Skill · Code Review")
    expect(capabilityComponentSummary({
      kind: "environment_requirement",
      name: "gh",
      config: { kind: "executable", command: "gh" },
    })).toBe("Executable · gh · command=gh")
  })

  it("uses environment requirement kind from id without hiding unknown future kinds", () => {
    expect(capabilityComponentSummary({
      id: "envreq:sdk:dotnet",
      kind: "environment_requirement",
      name: "dotnet",
      config: { requirements: { version: ">=8" } },
    })).toBe("SDK · dotnet · version >=8")

    expect(capabilityComponentSummary({
      id: "envreq:gpu:cuda",
      kind: "environment_requirement",
      name: "cuda",
    })).toBe("Gpu · cuda")
  })

  it("builds a unified capability list from MCP servers and Skills", () => {
    const capabilities = capabilityViewsFromSources({
      mcpServers: [{
        id: "mcp:github",
        kind: "mcp",
        name: "github",
        enabled: true,
        status: "available",
        command: "github-mcp",
        runtime_footprint: {
          runs_on: "server",
          install_required_on: ["server"],
          config_required_on: ["server"],
          user_message: "服务端运行，无需本机安装",
        },
        environment_requirement_refs: ["envreq:executable:gh"],
        package_ids: ["github-tools"],
      }],
      skillRecords: [{
        id: "skill:code-review",
        kind: "skill",
        name: "code-review",
        display_name: "Code review",
        summary: "Review repository changes before merging.",
        enabled: true,
        path_hint: "/srv/skills/packages/repo-review/code-review/SKILL.md",
        source_path: "skills/code-review/SKILL.md",
        package_ids: ["repo-review"],
      }],
      componentIndex: {
        "skill:code-review": components["skill:code-review"],
      },
      packages: {
        "repo-review": {
          components: ["skill:code-review"],
        },
      },
      skillsEnabled: true,
      disabledSkills: ["skill:code-review"],
    })

    expect(capabilities.map((item) => `${item.kind}:${item.name}`)).toEqual([
      "mcp_server:github",
      "skill:code-review",
    ])
    expect(capabilities[1]).toMatchObject({
      displayName: "Code review",
      summary: "Review repository changes before merging.",
      runtimeFootprint: {
        userMessage: "仅 Agent 指令能力，无需外部进程",
      },
    })
    expect(capabilities[0]).toMatchObject({
      sourcePackageIds: ["github-tools"],
      dependencyIds: ["envreq:executable:gh"],
      mcp: { command: "github-mcp" },
    })
    expect(capabilities[1]).toMatchObject({
      enabled: false,
      status: "disabled",
      sourcePackageIds: ["repo-review"],
      skill: {
        pathHint: "/srv/skills/packages/repo-review/code-review/SKILL.md",
        sourcePath: "skills/code-review/SKILL.md",
        disabled: true,
        globalEnabled: true,
      },
    })
  })

  it("aggregates Skill runtime footprint from referenced environment requirements", () => {
    const capabilities = capabilityViewsFromSources({
      skillRecords: [{
        id: "skill:code-review",
        kind: "skill",
        name: "code-review",
        display_name: "Code review",
        environment_requirement_refs: ["envreq:executable:gh"],
      }],
      componentIndex: {
        "envreq:executable:gh": {
          id: "envreq:executable:gh",
          kind: "environment_requirement",
          name: "gh",
          config: {
            placement: "peer",
            command: "gh",
          },
        },
      },
    })

    expect(capabilities[0]).toMatchObject({
      dependencyIds: ["envreq:executable:gh"],
      runtimeFootprint: {
        runsOn: "local_peer",
        userMessage: "需要在本机安装/配置",
      },
    })
  })

  it("projects lifecycle hook summaries without leaking handler details into main fields", () => {
    const capabilities = capabilityViewsFromSources({
      mcpServers: [{
        id: "mcp:github",
        kind: "mcp",
        name: "github",
        enabled: true,
        hook_views: [
          {
            id: "hook:mcp_server:github:PostToolUse:0",
            event: "PostToolUse",
            source: "mcp_server",
            placement: "server",
            handler_type: "mcp_tool",
            display_name: "GitHub audit",
            summary: "Records GitHub MCP tool results.",
            trust: "pending_review",
            permissions: ["audit.write"],
            risk_level: "low",
            executable: false,
            can_manage: false,
            unavailable_reason: "pending_review",
            technical: {
              handler_ref: "github.audit",
              matcher: "*",
            },
          },
        ],
      }],
    })

    const hook = (capabilities[0] as any).hooks[0]
    expect(hook).toMatchObject({
      id: "hook:mcp_server:github:PostToolUse:0",
      event: "PostToolUse",
      source: "mcp_server",
      placement: "server",
      handlerType: "mcp_tool",
      displayName: "GitHub audit",
      summary: "Records GitHub MCP tool results.",
      trust: "pending_review",
      permissions: ["audit.write"],
      riskLevel: "low",
      executable: false,
      canManage: false,
      unavailableReason: "pending_review",
      technical: {
        handler_ref: "github.audit",
        matcher: "*",
      },
    })
    expect(hook.handler_ref).toBeUndefined()
  })

  it("preserves lifecycle hook credentials and recent result for management display", () => {
    const hooks = normalizeLifecycleHookViews([
      {
        id: "hook:mcp_server:github:PreToolUse:0",
        event: "PreToolUse",
        source: "mcp_server",
        placement: "server",
        handler_type: "command",
        display_name: "GitHub guard",
        summary: "Checks GitHub shell commands.",
        trust: "trusted",
        credentials: ["GITHUB_TOKEN"],
        risk_level: "high",
        recent_result: {
          status: "denied",
          summary: "Denied shell command",
          session_run_id: "session-run-1",
        },
      },
    ])

    expect(hooks[0]).toMatchObject({
      credentials: ["GITHUB_TOKEN"],
      riskLevel: "high",
      recentResult: {
        status: "denied",
        summary: "Denied shell command",
        session_run_id: "session-run-1",
      },
    })
  })

  it("preserves lifecycle hook placement runtime returned by the backend", () => {
    const hooks = normalizeLifecycleHookViews([
      {
        id: "hook:mcp_server:github:PreToolUse:0",
        event: "PreToolUse",
        source: "mcp_server",
        placement: "both",
        handler_type: "internal",
        display_name: "GitHub guard",
        summary: "Checks GitHub tool calls.",
        trust: "trusted",
        executable: true,
        can_manage: true,
        placement_runtime: {
          server: {
            executable: true,
            unavailable_reason: "",
          },
          peer: {
            executable: false,
            unavailable_reason: "peer_runtime_unavailable",
          },
        },
      },
    ])

    expect(hooks[0].placementRuntime).toEqual({
      server: {
        executable: true,
        unavailableReason: "",
      },
      peer: {
        executable: false,
        unavailableReason: "peer_runtime_unavailable",
      },
    })
  })

  it("does not create lifecycle hook cards from raw config hooks", () => {
    const capabilities = capabilityViewsFromSources({
      mcpServers: [{
        id: "mcp:github",
        kind: "mcp",
        name: "github",
        enabled: true,
        hooks: [
          {
            event: "PostToolUse",
            source: "mcp_server",
            placement: "server",
            handler_type: "mcp_tool",
            display_name: "GitHub audit",
            summary: "Records GitHub MCP tool results.",
            trust: "trusted",
          },
        ],
      }],
    })

    expect((capabilities[0] as any).hooks).toEqual([])
  })

  it("keeps MCP memory provider metadata out of lifecycle hook cards", () => {
    const capabilities = capabilityViewsFromSources({
      mcpServers: [{
        id: "mcp:github",
        kind: "mcp",
        name: "github",
        enabled: true,
        hook_views: [
          {
            id: "hook:mcp_server:github:PostToolUse:0",
            event: "PostToolUse",
            source: "mcp_server",
            placement: "server",
            handler_type: "mcp_tool",
            display_name: "GitHub audit",
            summary: "Records GitHub MCP tool results.",
            trust: "pending_review",
          },
        ],
        memory_provider: {
          id: "github_memory",
          adapter: "mcp_memory",
          hooks: [
            {
              event: "UserPromptSubmit",
              handler_type: "mcp_tool",
              display_name: "Memory audit",
              summary: "This must not become a lifecycle hook card.",
            },
          ],
        },
      }],
    })

    expect((capabilities[0] as any).hooks).toHaveLength(1)
    expect((capabilities[0] as any).hooks[0]).toMatchObject({
      id: "hook:mcp_server:github:PostToolUse:0",
      source: "mcp_server",
      displayName: "GitHub audit",
    })
    expect(JSON.stringify((capabilities[0] as any).hooks)).not.toContain("github_memory")
    expect(JSON.stringify((capabilities[0] as any).hooks)).not.toContain("Memory audit")
  })

  it("does not infer manageability or executability from canonical-looking ids or trust", () => {
    const capabilities = capabilityViewsFromSources({
      mcpServers: [{
        id: "mcp:github",
        kind: "mcp",
        name: "github",
        enabled: true,
        hook_views: [
          {
            id: "hook:mcp_server:github:PostToolUse:0",
            event: "PostToolUse",
            source: "mcp_server",
            placement: "server",
            handler_type: "mcp_tool",
            display_name: "GitHub audit",
            summary: "Records GitHub MCP tool results.",
            trust: "trusted",
            executable: false,
            can_manage: false,
            unavailable_reason: "owner_disabled",
          },
        ],
      }],
    })

    expect((capabilities[0] as any).hooks[0]).toMatchObject({
      id: "hook:mcp_server:github:PostToolUse:0",
      trust: "trusted",
      executable: false,
      enabled: false,
      canManage: false,
      unavailableReason: "owner_disabled",
    })
  })

  it("keeps install state and enabled state as separate user-facing dimensions", () => {
    expect(capabilityInstallStatusLabel("installed")).toBe("已安装")
    expect(capabilityInstallStatusTone("installed")).toBe("success")
    expect(capabilityEnabledStatusLabel(true)).toBe("已启用")
    expect(capabilityEnabledStatusTone(true)).toBe("success")
    expect(capabilityEnabledStatusLabel(false)).toBe("已停用")
    expect(capabilityEnabledStatusTone(false)).toBe("muted")
  })

  it("projects package state axes into user-facing labels without leaking internal enum names", () => {
    const state = {
      install_state: "registered",
      activation_state: "inactive",
      runtime_state: "failed",
      check_state: "stale",
      credential_state: "bound",
      update_state: "candidate_ready",
      mapping_state: "mapping_required",
      target_facts: {
        server: {
          runtime_state: "running",
          check_state: "passed",
        },
        local_peer: {
          runtime_state: "not_applicable",
          check_state: "missing",
        },
      },
    }
    const view = capabilityPackageStateView(state)

    expect(view.installLabel).toBe("已登记")
    expect(view.activationLabel).toBe("未激活")
    expect(view.runtimeLabel).toBe("运行失败")
    expect(view.checkLabel).toBe("需要重新检查")
    expect(view.serverTargetLabel).toBe("服务端：运行中，检查通过")
    expect(view.localPeerTargetLabel).toBe("本地端：无需运行进程，缺失")
    expect(view.credentialLabel).toBe("已绑定凭据")
    expect(view.updateLabel).toBe("更新候选已准备")
    expect(view.mappingLabel).toBe("需要管理员映射")
    expect(capabilityPackageUserStateLabel(state)).not.toContain("mapping_required")
    expect(capabilityPackageUserStateLabel(state)).not.toContain("不支持")
    expect(capabilityPackageUserStateLabel(state)).not.toContain("等待开发者")
    expect(updateStateLabel("rollback_available")).toBe("可回滚")
    expect(targetStatusLabel("server", state)).toBe("服务端：运行中，检查通过")
    expect(manualStepUserActionLabel("manual_command_review_required")).toBe("需要确认命令")
  })

  it("builds package state payload from top-level backend facts", () => {
    const state = capabilityPackageStatePayload({
      state: {
        install_state: "installed",
        activation_state: "active",
        credential_state: "missing",
      },
      credential_state: "bound",
      target_facts: {
        server: {
          runtime_state: "running",
          check_state: "passed",
        },
      },
    })

    expect(state.credential_state).toBe("bound")
    expect(targetStatusLabel("server", state)).toBe("服务端：运行中，检查通过")
  })

  it("does not duplicate package-level runtime state into target labels", () => {
    const state = {
      runtime_state: "running",
      check_state: "passed",
    }

    expect(targetStatusLabel("server", state)).toBe("服务端：未返回运行状态，未检查")
    expect(targetStatusLabel("local_peer", state)).toBe("本地端：未返回运行状态，未检查")
  })

  it("projects credential binding scopes without exposing secret values", () => {
    expect(credentialBindingScopeLabel("user")).toBe("默认使用当前用户凭据")
    expect(credentialBindingScopeLabel("workspace")).toBe("工作区共享凭据")
    expect(credentialBindingScopeLabel("server_global")).toBe("服务端全局凭据")

    const views = credentialRequirementViews([
      {
        requirement_id: "credreq:github:user",
        provider: "github",
        kind: "oauth",
        placement: "server",
        state: "bound",
        scope: "user",
        secret_ref_id: "github-user",
        secret_value: "ghp_user_secret",
      },
      {
        requirement_id: "credreq:github:workspace",
        provider: "github",
        kind: "token",
        placement: "local_peer",
        state: "bound",
        scope: "workspace",
        secret_ref_id: "github-workspace",
        token: "ghp_workspace_secret",
      },
      {
        requirement_id: "credreq:github:global",
        provider: "github",
        kind: "app_installation",
        placement: "server",
        state: "bound",
        scope: "server_global",
        secret_ref_id: "github-app",
        api_key: "plain-secret",
      },
    ])

    expect(views.map((view) => view.scopeLabel)).toEqual([
      "默认使用当前用户凭据",
      "工作区共享凭据",
      "服务端全局凭据",
    ])
    expect(views.map((view) => view.secretRefId)).toEqual([
      "github-user",
      "github-workspace",
      "github-app",
    ])
    expect(JSON.stringify(views)).not.toContain("ghp_user_secret")
    expect(JSON.stringify(views)).not.toContain("ghp_workspace_secret")
    expect(JSON.stringify(views)).not.toContain("plain-secret")
  })
})
