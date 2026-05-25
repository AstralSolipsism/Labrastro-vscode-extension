import { describe, expect, it } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"

const tabsDir = join(process.cwd(), "webview-ui", "src", "settings", "tabs")
const controllerPath = join(process.cwd(), "webview-ui", "src", "settings", "useSettingsController.tsx")
const operationsPath = join(process.cwd(), "webview-ui", "src", "settings", "settingsOperations.ts")

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

  it("keeps provider model refresh independent from provider writes", () => {
    const source = readFileSync(controllerPath, "utf8")
    const requestIndex = source.indexOf('const requestProviderModels = (message = "正在获取模型列表..."): boolean =>')
    const nextFunctionIndex = source.indexOf("\n  const ", requestIndex + 1)
    const requestBlock = source.slice(requestIndex, nextFunctionIndex)
    const writeBusyGuardIndex = requestBlock.indexOf("providerWriteBusy()")
    const refreshBusyGuardIndex = requestBlock.indexOf("if (providerModelRefreshBusy(id)) return false")
    const beginReadIndex = requestBlock.indexOf("return beginProviderModelRead(id, message)")
    const requestSendIndex = source.indexOf("settingsMessages.providerModels(vscode, id)")

    expect(requestIndex).toBeGreaterThanOrEqual(0)
    expect(writeBusyGuardIndex).toBe(-1)
    expect(refreshBusyGuardIndex).toBeGreaterThanOrEqual(0)
    expect(beginReadIndex).toBeGreaterThan(refreshBusyGuardIndex)
    expect(requestSendIndex).toBeGreaterThan(source.indexOf("const beginProviderModelRead"))
    expect(source).not.toContain("lastModelFetchProvider")
    expect(source).not.toContain('requestProviderModels("正在读取该服务商的模型列表...")')
  })

  it("loads provider model cache when selecting a saved provider", () => {
    const source = readFileSync(controllerPath, "utf8")
    const selectIndex = source.indexOf("const selectProvider = (provider: Record<string, unknown>) =>")
    const nextFunctionIndex = source.indexOf("\n  const saveProvider", selectIndex)
    const selectBlock = source.slice(selectIndex, nextFunctionIndex)

    expect(selectIndex).toBeGreaterThanOrEqual(0)
    expect(selectBlock).toContain("loadProviderModelCache(provider)")
    expect(selectBlock).not.toContain("setFetchedModels([])")
  })

  it("does not derive loading state from user-facing copy", () => {
    const source = readFileSync(controllerPath, "utf8")
    const providersSource = readFileSync(join(tabsDir, "ProvidersTab.tsx"), "utf8")

    expect(source).not.toContain('startsWith("正在")')
    expect(providersSource).not.toContain('startsWith("正在")')
    expect(providersSource).toContain("providerModelRefreshBusy(providerId())")
  })

  it("keeps provider save and model refresh buttons on separate busy lanes", () => {
    const providersSource = readFileSync(join(tabsDir, "ProvidersTab.tsx"), "utf8")
    const saveButtonStart = providersSource.indexOf("<button class=\"btn btn-primary\" type=\"button\" onClick={saveProvider}")
    const saveButtonEnd = providersSource.indexOf("</button>", saveButtonStart)
    const saveButton = providersSource.slice(saveButtonStart, saveButtonEnd)
    const refreshIndex = providersSource.indexOf("刷新模型列表")
    const refreshButtonStart = providersSource.lastIndexOf("<RefreshButton", refreshIndex)
    const refreshButton = providersSource.slice(refreshButtonStart, refreshIndex)

    expect(saveButton).toContain("providerActionBusy()")
    expect(saveButton).not.toContain("modelRefreshing()")
    expect(refreshButton).toContain("disabled={!selectedProvider() || !adminUsable() || modelRefreshing()}")
    expect(refreshButton).toContain("loading={modelRefreshing()}")
    expect(refreshButton).not.toContain("providerActionBusy()")
  })

  it("uses background refresh for first tab load without tracking refresh buttons", () => {
    const source = readFileSync(controllerPath, "utf8")

    expect(source).toContain('refreshPage(tab, { mode: "background" })')
    expect(source).not.toContain("refreshPage(tab)")
    expect(source).not.toContain("track: false")
  })

  it("does not trigger tracked refreshes from bootstrap effects", () => {
    const source = readFileSync(controllerPath, "utf8")
    const bootstrapStart = source.indexOf("const visitedSettingsTabs = new Set<SettingsTab>()")
    const bootstrapEnd = source.indexOf("onMount(() => {", bootstrapStart)
    const bootstrapBlock = source.slice(bootstrapStart, bootstrapEnd)

    expect(bootstrapStart).toBeGreaterThanOrEqual(0)
    expect(bootstrapEnd).toBeGreaterThan(bootstrapStart)
    expect(bootstrapBlock).toContain('refreshOperation("toolchains", { mode: "background" })')
    expect(bootstrapBlock).toContain('refreshOperation("environmentManifest", { mode: "background" })')
    expect(bootstrapBlock).toContain('refreshOperation("serverSettings", { mode: "background" })')
    expect(bootstrapBlock).not.toContain('refreshOperation("toolchains")')
    expect(bootstrapBlock).not.toContain('refreshOperation("serverSettings")')
    expect(bootstrapBlock).not.toContain("refreshServerSettings()")
  })

  it("keeps provider model refresh out of background initialization", () => {
    const source = readFileSync(controllerPath, "utf8")
    const operationsSource = readFileSync(operationsPath, "utf8")
    const backgroundRefreshIndex = source.indexOf('refreshPage(tab, { mode: "background" })')
    const providerModelsCaseIndex = source.indexOf('case "providerModels":')

    expect(backgroundRefreshIndex).toBeGreaterThanOrEqual(0)
    expect(providerModelsCaseIndex).toBeGreaterThanOrEqual(0)
    expect(operationsSource).toContain('if (key === "providerModels" && mode === "background") return false')
    expect(source).toContain('if (mode === "background" || providerModelRefreshBusy()) return')
  })

  it("keeps settings business refreshes off the legacy admin status channel", () => {
    const source = readFileSync(controllerPath, "utf8")
    const operationsSource = readFileSync(operationsPath, "utf8")

    expect(operationsSource).not.toContain('| "admin"')
    expect(operationsSource).not.toContain('"admin",')
    expect(source).not.toContain('case "admin":')
    expect(source).not.toContain("settingsMessages.refreshAdmin(vscode)")
  })

  it("keeps provider catalog models behind an explicit add or configure action", () => {
    const providersSource = readFileSync(join(tabsDir, "ProvidersTab.tsx"), "utf8")

    expect(providersSource).toContain("modelHasSavedProfile")
    expect(providersSource).toContain("visibleProviderModels")
    expect(providersSource).toContain("prioritizeProviderModelEntries")
    expect(providersSource).toContain('StatusBadge tone="success">已添加')
    expect(providersSource).toContain('{added() ? "配置" : "添加"}')
    expect(providersSource).toContain('onClick={() => openModelDetail(model.id, custom ? "custom" : "fetched")}')
    expect(providersSource).toContain('onClick={() => deleteModelPresetByModel(model.id)}')
    expect(providersSource).not.toContain("配置参数")
  })
})
