import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { setLocale, t } from "../i18n"
import { TOOLCHAIN_SECTIONS } from "./toolchainSections"
import { agentToolExecutionPolicyLabel, agentToolPermissionLabel } from "./toolchainCatalogLabels"

const toolchainsTabSource = readFileSync(join(__dirname, "tabs", "ToolchainsTab.tsx"), "utf8")
const settingsControllerSource = readFileSync(join(__dirname, "useSettingsController.tsx"), "utf8")

describe("toolchains settings label", () => {
  it("uses capability and behavior management wording", () => {
    setLocale("zh-CN")
    expect(t("settings.tab.toolchains")).toBe("能力/行为管理")

    setLocale("en")
    expect(t("settings.tab.toolchains")).toBe("Capability / Behavior Management")

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
    expect(labels).toContain("用户指令")
    expect(labels).toContain("Agent Tools")
    expect(labels).not.toContain("Chat 指令")
    expect(labels).not.toContain("Mention 引用")
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
