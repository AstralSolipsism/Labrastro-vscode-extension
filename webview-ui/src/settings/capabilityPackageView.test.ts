import { describe, expect, it } from "vitest"
import {
  capabilityViewsFromSources,
  capabilityComponentSummary,
  groupCapabilityPackageComponents,
} from "./capabilityPackageView"

describe("capability package component view", () => {
  const components = {
    "skill:code-review": {
      kind: "skill",
      name: "code-review",
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
    },
    "envreq:sdk:dotnet": {
      kind: "environment_requirement",
      name: "dotnet",
      config: {
        kind: "sdk",
        requirements: { version: ">=8" },
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
      packageIds: ["repo-review"],
      pathHint: "/skills/code-review",
      skillStatus: "enabled",
      summary: "Skill · code-review · installed path=/skills/code-review",
    })
    expect(groups.dependencies[0].summary).toBe("SDK · dotnet · version >=8")
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
    })).toBe("MCP Server · github")
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
        environment_requirement_refs: ["envreq:executable:gh"],
        package_ids: ["github-tools"],
      }],
      skillRecords: [{
        id: "skill:code-review",
        kind: "skill",
        name: "code-review",
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
})
