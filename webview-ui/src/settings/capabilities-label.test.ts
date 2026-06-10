import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { setLocale, t } from "../i18n"
import { CAPABILITY_SECTIONS } from "./capabilitySections"
import { agentToolExecutionPolicyLabel, agentToolPermissionLabel } from "./capabilityCatalogLabels"
import { isPackageManagedCapability, isPackageManagedResource } from "./tabs/CapabilitiesTab"

const capabilitiesTabSource = readFileSync(join(__dirname, "tabs", "CapabilitiesTab.tsx"), "utf8")
const settingsControllerSource = readFileSync(join(__dirname, "useSettingsController.tsx"), "utf8")
const capabilityPackageViewSource = readFileSync(join(__dirname, "capabilityPackageView.ts"), "utf8")

describe("capabilities settings label", () => {
  it("uses capability and behavior management wording", () => {
    setLocale("zh-CN")
    expect(t("settings.tab.capabilities")).toBe("能力/行为管理")
    expect(t("capability.desc")).toContain("能力、MCP、Skills、依赖和行为")
    expect(t("capability.desc")).toContain("外部资源")
    expect(t("agentConfig.profile.mcpNotRegistered")).toBe("未在 MCP Server 配置中注册")

    setLocale("en")
    expect(t("settings.tab.capabilities")).toBe("Capability / Behavior Management")
    expect(t("capability.desc")).toContain("capabilities, MCP, Skills, dependencies, and behaviors")
    expect(t("capability.desc")).toContain("external resources")
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

  it("uses flat capability, MCP, Skills, dependency, and behavior tabs", () => {
    const labels = CAPABILITY_SECTIONS.map((section) => section.label)
    expect(labels).toEqual(["能力", "MCP", "Skills", "依赖", "行为"])
    expect(labels).not.toContain("环境看板")
    expect(labels).not.toContain("环境依赖")
    expect(labels).toContain("依赖")
    expect(labels).not.toContain("运行日志")
    expect(labels).not.toContain("行为" + "目录")
    expect(labels).not.toContain("能力包")
    expect(labels).not.toContain("组件清单")
    expect(labels).not.toContain("依赖配置")
    expect(labels).not.toContain("导入")
    expect(labels).not.toContain("Chat 指令")
    expect(labels).not.toContain("Mention 引用")
  })

  it("shows capability capabilities and dependencies explicitly", () => {
    expect(capabilitiesTabSource).toContain("groupCapabilityPackageComponents")
    expect(capabilitiesTabSource).toContain("提供的能力")
    expect(capabilitiesTabSource).toContain("所需能力依赖")
    expect(capabilitiesTabSource).toContain("检查该能力依赖")
    expect(capabilitiesTabSource).toContain("配置该能力依赖")
    expect(capabilitiesTabSource).toContain("全部能力依赖资源")
    expect(capabilitiesTabSource).toContain("运行日志")
    expect(capabilitiesTabSource).toContain("capabilityInstallStatusLabel")
    expect(capabilitiesTabSource).toContain("capabilityEnabledStatusLabel")
    expect(capabilitiesTabSource).toContain("安装路径")
    expect(capabilitiesTabSource).toContain("来源路径")
    expect(capabilityPackageViewSource).toContain("\"Skill\"")
    expect(capabilityPackageViewSource).toContain("displayName")
    expect(capabilityPackageViewSource).toContain("runtimeFootprintLabel")
    expect(capabilityPackageViewSource).toContain("capabilityInstallPreviewFromMcpJson")
    expect(capabilityPackageViewSource).not.toContain("installed path=")
    expect(capabilityPackageViewSource).toContain("resourceKindLabel(resourceKind)")
    expect(capabilityPackageViewSource).toContain("command=${command}")
    expect(capabilityPackageViewSource).toContain("CapabilityView")
    expect(capabilityPackageViewSource).toContain("CapabilityDependencyView")
    expect(capabilitiesTabSource).toContain("能力依赖")
    expect(capabilitiesTabSource).toContain("行为")
    expect(capabilitiesTabSource).toContain("install_prompt")
    expect(capabilitiesTabSource).toContain("verify_prompt")
    expect(capabilitiesTabSource).toContain("componentEvidenceItems")
    expect(capabilitiesTabSource).toContain("environment_requirement_refs")
  })

  it("keeps MCP and Skill on the capabilities page and out of capability dependencies", () => {
    expect(capabilitiesTabSource).toContain("capabilityViews")
    expect(capabilitiesTabSource).toContain("MCP Server")
    expect(capabilitiesTabSource).toContain("Skill")
    expect(capabilitiesTabSource).not.toContain('ariaLabel="能力类型筛选"')
    expect(capabilitiesTabSource).not.toContain("setCapabilityKindFilter")
    expect(capabilitiesTabSource).toContain("displayName")
    expect(capabilitiesTabSource).toContain("粘贴 SKILL.md")
    expect(capabilitiesTabSource).toContain("粘贴 MCP 配置")
    expect(capabilitiesTabSource).toContain("运行责任")
    expect(capabilitiesTabSource).toContain("服务端运行，无需本机安装")
    expect(capabilitiesTabSource).toContain("技术详情")
    expect(capabilitiesTabSource).toContain("生命周期 Hooks")
    expect(capabilitiesTabSource).toContain("信任状态")
    expect(capabilitiesTabSource).toContain("权限需求")
    expect(capabilitiesTabSource).toContain("hook.technical")
    expect(capabilitiesTabSource).toContain("hookCanManage")
    expect(capabilitiesTabSource).toContain("filteredCapabilityItems")
    expect(capabilityPackageViewSource).not.toContain("`hook:${event || \"event\"}:${index}`")
    expect(capabilitiesTabSource).toContain('item.kind === "environment_requirement"')
    expect(capabilitiesTabSource).not.toContain("环境依赖")
  })

  it("keeps lifecycle hook authority on the server instead of frontend inference", () => {
    expect(capabilitiesTabSource).not.toContain("^hook:")
    expect(capabilityPackageViewSource).not.toContain("^hook:")
    expect(capabilityPackageViewSource).not.toContain('trust === "trusted"')
    expect(capabilitiesTabSource).toContain("unavailableReason")
    expect(capabilityPackageViewSource).toContain("unavailableReason")
  })

  it("locks direct actions only for package-managed capabilities", () => {
    expect(capabilitiesTabSource).toContain("isPackageManagedCapability(capability)")
    expect(capabilitiesTabSource).toContain("isPackageManagedResource(item)")
    expect(capabilitiesTabSource).toContain("该资源由能力管理，请在能力页启停或删除来源能力。")
    expect(isPackageManagedCapability({
      raw: { managed_by: "capability_package", package_ids: ["review"] },
      sourcePackageIds: ["review"],
    } as any)).toBe(true)
    expect(isPackageManagedResource({
      managed_by: "capability_package",
      package_ids: ["review"],
      kind: "environment_requirement",
      name: "gh",
    })).toBe(true)
    expect(isPackageManagedCapability({
      raw: { managed_by: "capability_package" },
      sourcePackageIds: [],
    } as any)).toBe(false)
    expect(isPackageManagedResource({
      raw: { managed_by: "user", package_ids: ["review"] },
      sourcePackageIds: ["review"],
    })).toBe(false)
    expect(isPackageManagedResource({
      managed_by: "user",
      package_ids: ["review"],
      kind: "environment_requirement",
      name: "gh",
    })).toBe(false)
  })

  it("uses shared capability grouping in Agent configuration preview", () => {
    const agentConfigSource = readFileSync(join(__dirname, "tabs", "AgentConfigTab.tsx"), "utf8")
    expect(agentConfigSource).toContain("capabilityPackageComponentGroups")
    expect(agentConfigSource).toContain("提供的能力")
    expect(agentConfigSource).toContain("所需能力依赖")
    expect(agentConfigSource).not.toContain("<For each={pkg.components}>{(item) => <StatusBadge>{item}</StatusBadge>}</For>")
  })

  it("does not expose environment run actions for MCP servers", () => {
    expect(capabilitiesTabSource).toContain("canRunEnvironmentItem")
    expect(capabilitiesTabSource).toContain('item.kind === "environment_requirement"')
    expect(capabilitiesTabSource).toContain("MCP Server 通过环境要求引用间接检查")
  })

  it("projects chat command execution semantics from the behavior catalog", () => {
    expect(settingsControllerSource).toContain("selectionBehavior: stringValue(item.selection_behavior)")
    expect(settingsControllerSource).toContain("availableDuringRun: item.available_during_run === true")
    expect(settingsControllerSource).toContain("visibility: stringValue(item.visibility, \"visible\")")
    expect(settingsControllerSource).toContain("executionPolicy: stringValue(item.execution_policy)")
    expect(settingsControllerSource).toContain("permission: normalizeAgentToolPermission(item.permission)")
    expect(capabilitiesTabSource).toContain("userInstructionItems")
    expect(capabilitiesTabSource).toContain("reference_only")
    expect(capabilitiesTabSource).toContain("effectiveCapabilities")
    expect(capabilitiesTabSource).toContain("权限")
  })
})
