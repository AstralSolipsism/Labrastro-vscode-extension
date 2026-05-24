import { describe, expect, it } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"

const tabsDir = join(process.cwd(), "webview-ui", "src", "settings", "tabs")
const controllerPath = join(process.cwd(), "webview-ui", "src", "settings", "useSettingsController.tsx")

describe("settings architecture", () => {
  it("keeps tabs behind the settings controller instead of importing settingsMessages", () => {
    const offenders = readdirSync(tabsDir)
      .filter((file) => file.endsWith(".tsx"))
      .filter((file) => {
        const source = readFileSync(join(tabsDir, file), "utf8")
        return source.includes("settingsMessages") || source.includes("postMessage")
      })

    expect(offenders).toEqual([])
  })

  it("keeps server settings saves behind the shared busy guard", () => {
    const saveKeys = [
      "conversationSave",
      "sessionPolicySave",
      "serverSettingsSave",
      "autoApprovalSave",
      "integrationsSave",
      "toolchainsCapabilitySave",
      "agentConfigSave",
      "diagnosticsSave",
      "capabilitySyncSave",
    ]
    const pattern = new RegExp(`operations\\.isBusy\\(["'](${saveKeys.join("|")})["']\\)`)
    const offenders = readdirSync(tabsDir)
      .filter((file) => file.endsWith(".tsx"))
      .filter((file) => pattern.test(readFileSync(join(tabsDir, file), "utf8")))

    expect(offenders).toEqual([])
  })

  it("records provider model auto-fetch only after the request can be sent", () => {
    const source = readFileSync(controllerPath, "utf8")
    const requestIndex = source.indexOf('const requestProviderModels = (message = "正在获取模型列表..."): boolean =>')
    const busyGuardIndex = source.indexOf("if (providerAdminActionBusy()) return false", requestIndex)
    const fetchedProviderIndex = source.indexOf("setLastModelFetchProvider(id)", requestIndex)
    const requestSendIndex = source.indexOf("settingsMessages.providerModels(vscode, id)", requestIndex)
    const autoFetchIndex = source.indexOf("if (lastModelFetchProvider() === id) return", requestIndex)
    const nextEffectIndex = source.indexOf("createEffect(() =>", autoFetchIndex + 1)
    const autoFetchBlock = source.slice(autoFetchIndex, nextEffectIndex)

    expect(requestIndex).toBeGreaterThanOrEqual(0)
    expect(busyGuardIndex).toBeGreaterThan(requestIndex)
    expect(fetchedProviderIndex).toBeGreaterThan(busyGuardIndex)
    expect(fetchedProviderIndex).toBeLessThan(requestSendIndex)
    expect(autoFetchBlock).not.toContain("setLastModelFetchProvider(id)")
  })
})
