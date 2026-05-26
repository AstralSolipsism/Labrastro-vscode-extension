import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { setLocale, t } from "../i18n"
import { TOOLCHAIN_SECTIONS } from "./toolchainSections"
import { agentToolExecutionPolicyLabel, agentToolPermissionLabel } from "./toolchainCatalogLabels"

const toolchainsTabSource = readFileSync(join(__dirname, "tabs", "ToolchainsTab.tsx"), "utf8")
const settingsControllerSource = readFileSync(join(__dirname, "useSettingsController.tsx"), "utf8")
const capabilityPackageViewSource = readFileSync(join(__dirname, "capabilityPackageView.ts"), "utf8")

describe("toolchains settings label", () => {
  it("uses capability and behavior management wording", () => {
    setLocale("zh-CN")
    expect(t("settings.tab.toolchains")).toBe("能力/行为管理")
    expect(t("toolchain.desc")).toContain("MCP Server 和 Skill")
    expect(t("toolchain.desc")).toContain("能力依赖")
    expect(t("agentConfig.profile.mcpNotRegistered")).toBe("未在 MCP Server 配置中注册")

    setLocale("en")
    expect(t("settings.tab.toolchains")).toBe("Capability / Behavior Management")
    expect(t("toolchain.desc")).toContain("MCP Servers and Skills")
    expect(t("toolchain.desc")).toContain("Capability Dependencies")
    expect(t("agentConfig.profile.mcpNotRegistered")).toBe("Not registered in MCP Server configuration")

    setLocale("zh-CN")
  })

  it("uses execution policy wording for agent tools", () => {
    expect(agentToolExecutionPolicyLabel("allow")).toBe("自动允许")
    expect(agentToolExecutionPolicyLabel("require_approval")).toBe("需用户确认")
    expect(agentToolExecutionPolicyLabel("inherits_component_policy")).toBe("继承策略")
  })

  it("uses runtime permission wording for agent tools", () => {
    expect(agentToolPermissionLabel("allow")).toBe("已授权")
    expect(agentToolPermissionLabel("require_approval")).toBe("交互审批")
    expect(agentToolPermissionLabel("blocked_review")).toBe("后台复核")
    expect(agentToolPermissionLabel("deny")).toBe("未授权")
  })

  it("splits behavior management into clear catalog tabs", () => {
    const labels = TOOLCHAIN_SECTIONS.map((section) => section.label)
    expect(labels).toEqual(["能力", "能力包", "能力依赖", "行为管理", "运行日志"])
    expect(labels).not.toContain("环境看板")
    expect(labels).not.toContain("环境依赖")
    expect(labels).not.toContain("行为目录")
    expect(labels).toContain("能力包")
    expect(labels).not.toContain("组件清单")
    expect(labels).not.toContain("依赖配置")
    expect(labels).not.toContain("导入")
    expect(labels).not.toContain("Chat 指令")
    expect(labels).not.toContain("Mention 引用")
  })

  it("shows capability package capabilities and dependencies explicitly", () => {
    expect(toolchainsTabSource).toContain("groupCapabilityPackageComponents")
    expect(toolchainsTabSource).toContain("提供的能力")
    expect(toolchainsTabSource).toContain("所需能力依赖")
    expect(capabilityPackageViewSource).toContain("\"Skill\"")
    expect(capabilityPackageViewSource).toContain("resourceKindLabel(resourceKind)")
    expect(capabilityPackageViewSource).toContain("command=${command}")
    expect(capabilityPackageViewSource).toContain("CapabilityView")
    expect(capabilityPackageViewSource).toContain("CapabilityDependencyView")
    expect(toolchainsTabSource).toContain("能力依赖")
    expect(toolchainsTabSource).toContain("行为管理")
    expect(toolchainsTabSource).toContain("install_prompt")
    expect(toolchainsTabSource).toContain("verify_prompt")
    expect(toolchainsTabSource).toContain("componentEvidenceItems")
    expect(toolchainsTabSource).toContain("environment_requirement_refs")
  })

  it("keeps MCP and Skill on the capabilities page and out of capability dependencies", () => {
    expect(toolchainsTabSource).toContain("capabilityViews")
    expect(toolchainsTabSource).toContain("MCP Server")
    expect(toolchainsTabSource).toContain("Skill")
    expect(toolchainsTabSource).toContain("filteredCapabilityItems")
    expect(toolchainsTabSource).toContain('item.kind === "environment_requirement"')
    expect(toolchainsTabSource).not.toContain("环境依赖")
  })

  it("uses shared capability package grouping in Agent configuration preview", () => {
    const agentConfigSource = readFileSync(join(__dirname, "tabs", "AgentConfigTab.tsx"), "utf8")
    expect(agentConfigSource).toContain("capabilityPackageComponentGroups")
    expect(agentConfigSource).toContain("提供的能力")
    expect(agentConfigSource).toContain("所需能力依赖")
    expect(agentConfigSource).not.toContain("<For each={pkg.components}>{(item) => <StatusBadge>{item}</StatusBadge>}</For>")
  })

  it("does not expose environment run actions for MCP servers", () => {
    expect(toolchainsTabSource).toContain("canRunEnvironmentItem")
    expect(toolchainsTabSource).toContain('item.kind === "environment_requirement"')
    expect(toolchainsTabSource).toContain("MCP Server 通过环境要求引用间接检查")
  })

  it("projects chat command execution semantics from the behavior catalog", () => {
    expect(settingsControllerSource).toContain("selectionBehavior: stringValue(item.selection_behavior)")
    expect(settingsControllerSource).toContain("availableDuringRun: item.available_during_run === true")
    expect(settingsControllerSource).toContain("visibility: stringValue(item.visibility, \"visible\")")
    expect(settingsControllerSource).toContain("executionPolicy: stringValue(item.execution_policy)")
    expect(settingsControllerSource).toContain("permission: normalizeAgentToolPermission(item.permission)")
    expect(toolchainsTabSource).toContain("userInstructionItems")
    expect(toolchainsTabSource).toContain("reference_only")
    expect(toolchainsTabSource).toContain("effectiveCapabilities")
    expect(toolchainsTabSource).toContain("权限")
  })
})
