import { describe, expect, it } from "vitest"
import {
  aggregateRuntimeFootprint,
  capabilityInstallPreviewFromMcpJson,
  capabilityViewsFromSources,
  capabilityComponentSummary,
  groupCapabilityPackageComponents,
  runtimeFootprintBadgeTone,
  runtimeFootprintLabel,
} from "./capabilityPackageView"

describe("capability package component view", () => {
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
})
