import { describe, expect, it } from "vitest"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { extname, join, relative } from "node:path"

const tabsDir = join(process.cwd(), "webview-ui", "src", "settings", "tabs")
const controllerPath = join(process.cwd(), "webview-ui", "src", "settings", "useSettingsController.tsx")
const operationsPath = join(process.cwd(), "webview-ui", "src", "settings", "settingsOperations.ts")
const sourceExtensions = new Set([".css", ".json", ".ts", ".tsx"])

function projectSourceFiles(path: string): string[] {
  const stat = statSync(path)
  if (stat.isFile()) {
    return sourceExtensions.has(extname(path)) ? [path] : []
  }
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) =>
    projectSourceFiles(join(path, entry.name))
  )
}

describe("settings architecture", () => {
  it("keeps frontend source files free of UTF-8 BOM", () => {
    const files = [
      join(process.cwd(), "package.json"),
      ...projectSourceFiles(join(process.cwd(), "src")),
      ...projectSourceFiles(join(process.cwd(), "webview-ui", "src")),
    ]
    const offenders = files
      .filter((file) => {
        const bytes = readFileSync(file)
        return bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF
      })
      .map((file) => relative(process.cwd(), file).replace(/\\/g, "/"))

    expect(offenders).toEqual([])
    expect(() => JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8"))).not.toThrow()
  })

  it("initializes operation accessors before eager settings memos use them", () => {
    const source = readFileSync(controllerPath, "utf8")
    const operationStateIndex = source.indexOf("const operationState = (key: SettingsOperationKey)")
    const operationBusyIndex = source.indexOf("const operationBusy = (key: SettingsOperationKey): boolean =>")
    const backgroundRefreshBusyIndex = source.indexOf("const backgroundRefreshBusy = (key: SettingsOperationKey): boolean =>")
    const providerListEmptyMessageIndex = source.indexOf("const providerListEmptyMessage = createMemo")
    const settingsTabDefsIndex = source.indexOf("const settingsTabDefsVisible", providerListEmptyMessageIndex)
    const providerListEmptyMessageBlock = source.slice(providerListEmptyMessageIndex, settingsTabDefsIndex)

    expect(operationStateIndex).toBeGreaterThanOrEqual(0)
    expect(operationBusyIndex).toBeGreaterThanOrEqual(0)
    expect(backgroundRefreshBusyIndex).toBeGreaterThanOrEqual(0)
    expect(providerListEmptyMessageIndex).toBeGreaterThanOrEqual(0)
    expect(operationStateIndex).toBeLessThan(providerListEmptyMessageIndex)
    expect(operationBusyIndex).toBeLessThan(providerListEmptyMessageIndex)
    expect(backgroundRefreshBusyIndex).toBeLessThan(providerListEmptyMessageIndex)
    expect(providerListEmptyMessageBlock).toContain('operationBusy("providers")')
    expect(providerListEmptyMessageBlock).toContain('backgroundRefreshBusy("providers")')
  })

  it("keeps refreshOperation hoisted for effects that call it during setup", () => {
    const source = readFileSync(controllerPath, "utf8")
    const agentConfigEffectIndex = source.indexOf('refreshOperation("serverSettings", { mode: "background" })')

    expect(agentConfigEffectIndex).toBeGreaterThanOrEqual(0)
    expect(source).toContain("function refreshOperation(key: SettingsOperationKey")
    expect(source).toContain("function refreshPage(tab: SettingsTab")
    expect(source).not.toContain("const refreshOperation =")
    expect(source).not.toContain("const refreshPage =")
  })

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
      "capabilitySettingsSave",
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
    expect(bootstrapBlock).toContain('refreshOperation("capabilities", { mode: "background" })')
    expect(bootstrapBlock).toContain('refreshOperation("environmentManifest", { mode: "background" })')
    expect(bootstrapBlock).toContain('refreshOperation("serverSettings", { mode: "background" })')
    expect(bootstrapBlock).not.toContain('refreshOperation("capabilities")')
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

  it("keeps capabilities layout on shared settings primitives", () => {
    const capabilitiesSource = readFileSync(join(tabsDir, "CapabilitiesTab.tsx"), "utf8")
    const layoutSource = readFileSync(join(process.cwd(), "webview-ui", "src", "settings", "components", "SettingsLayout.tsx"), "utf8")
    const stylesSource = readFileSync(join(process.cwd(), "webview-ui", "src", "styles", "main.css"), "utf8")

    expect(layoutSource).toContain("SettingsPage")
    expect(layoutSource).toContain("SettingsPageHeader")
    expect(layoutSource).toContain("SettingsSubTabs")
    expect(layoutSource).toContain("SettingsSubTabButton")
    expect(layoutSource).toContain("SettingsToolbar")
    expect(layoutSource).toContain("SettingsSearchField")
    expect(layoutSource).toContain("SettingsActionRail")
    expect(layoutSource).toContain("SettingsSegmentedControl")
    expect(layoutSource).toContain("SettingsCompactField")
    expect(layoutSource).toContain("SettingsSummaryStrip")
    expect(layoutSource).toContain("SettingsSummaryCard")
    expect(layoutSource).toContain("SettingsFlatSection")
    expect(layoutSource).toContain("SettingsSectionHeading")
    expect(layoutSource).toContain("SettingsWorkbench")
    expect(layoutSource).toContain("SettingsPane")
    expect(layoutSource).toContain("SettingsAsidePane")
    expect(layoutSource).toContain("SettingsPaneBody")
    expect(layoutSource).toContain("SettingsBoundedList")
    expect(layoutSource).toContain("SettingsCatalogTable")
    expect(layoutSource).toContain("SettingsListCard")
    expect(layoutSource).toContain("SettingsListButton")
    expect(layoutSource).toContain("SettingsListCardSelect")
    expect(layoutSource).toContain("SettingsListCardMain")
    expect(layoutSource).toContain("SettingsListCardMeta")
    expect(layoutSource).not.toContain("SettingsInteractiveListCard")
    expect(layoutSource).toContain("SettingsDetailHeader")
    expect(layoutSource).toContain("SettingsDetailActions")
    expect(layoutSource).toContain("SettingsDetailGrid")
    expect(layoutSource).toContain("SettingsDetailBlock")
    expect(layoutSource).toContain("SettingsDetailSection")
    expect(stylesSource).toContain(".settings-workbench")
    expect(stylesSource).toContain(".settings-pane")
    expect(stylesSource).toContain(".settings-bounded-list")
    expect(stylesSource).toContain(".settings-catalog-table")
    expect(stylesSource).toContain(".settings-detail-section")
    expect(capabilitiesSource).toContain("SettingsPage")
    expect(capabilitiesSource).toContain("SettingsPageHeader")
    expect(capabilitiesSource).toContain("SettingsSubTabs")
    expect(capabilitiesSource).toContain("SettingsSubTabButton")
    expect(capabilitiesSource).toContain("SettingsToolbar")
    expect(capabilitiesSource).toContain("SettingsSegmentedControl")
    expect(capabilitiesSource).toContain("SettingsCompactField")
    expect(capabilitiesSource).toContain("SettingsSummaryStrip")
    expect(capabilitiesSource).toContain("SettingsSummaryCard")
    expect(capabilitiesSource).toContain("SettingsFlatSection")
    expect(capabilitiesSource).toContain("SettingsSectionHeading")
    expect(capabilitiesSource).toContain("SettingsWorkbench")
    expect(capabilitiesSource).toContain("SettingsPane")
    expect(capabilitiesSource).toContain("SettingsBoundedList")
    expect(capabilitiesSource).toContain("SettingsCatalogTable")
    expect(capabilitiesSource).toContain("SettingsListCard")
    expect(capabilitiesSource).toContain("SettingsListButton")
    expect(capabilitiesSource).toContain("SettingsListCardSelect")
    expect(capabilitiesSource).toContain("SettingsListCardMain")
    expect(capabilitiesSource).toContain("SettingsListCardMeta")
    expect(capabilitiesSource).toContain("SettingsDetailHeader")
    expect(capabilitiesSource).toContain("SettingsDetailActions")
    expect(capabilitiesSource).toContain("SettingsDetailGrid")
    expect(capabilitiesSource).toContain("SettingsDetailBlock")
    expect(capabilitiesSource).toContain("SettingsDetailSection")
    expect(capabilitiesSource).toContain("currentDraftComponentCounts")
    expect(capabilitiesSource).toContain("renderComponentGroupsDetails(currentDraftComponentGroups())")
    expect(capabilitiesSource).toContain("renderComponentGroupsDetails(packageComponentGroups(pkg()))")
    const selectedBehaviorStart = capabilitiesSource.indexOf("const selectedBehaviorEntry = createMemo")
    const selectedBehaviorEnd = capabilitiesSource.indexOf("\n  const markCapabilityDirty", selectedBehaviorStart)
    const selectedBehaviorBlock = capabilitiesSource.slice(selectedBehaviorStart, selectedBehaviorEnd)
    expect(selectedBehaviorStart).toBeGreaterThanOrEqual(0)
    expect(selectedBehaviorEnd).toBeGreaterThan(selectedBehaviorStart)
    expect(selectedBehaviorBlock).not.toContain("behaviorEntries()[0]")
    expect(capabilitiesSource).not.toContain("SettingsInteractiveListCard")
    expect(capabilitiesSource).not.toContain('role="button"')
    expect(capabilitiesSource).not.toContain('class="settings-page')
    expect(capabilitiesSource).not.toContain('class="settings-page-header')
    expect(capabilitiesSource).not.toContain('class="settings-subtabs')
    expect(capabilitiesSource).not.toContain("settings-subtab-button")
    expect(capabilitiesSource).not.toContain("settings-actions settings-actions--right")
    expect(capabilitiesSource).not.toContain('class="settings-workbench')
    expect(capabilitiesSource).not.toContain('class="settings-pane')
    expect(capabilitiesSource).not.toContain('class="settings-bounded-list')
    expect(capabilitiesSource).not.toContain('class="settings-catalog-table')
    expect(capabilitiesSource).not.toContain('class="settings-list-card')
    expect(capabilitiesSource).not.toContain("settings-list-card__")
    expect(capabilitiesSource).not.toContain('class="settings-badge')
    expect(capabilitiesSource).not.toContain('class="settings-segmented-control')
    expect(capabilitiesSource).not.toContain('class="settings-summary-strip')
    expect(capabilitiesSource).not.toContain('class="settings-summary-card')
    expect(capabilitiesSource).not.toContain('class="settings-action-rail')
    expect(capabilitiesSource).not.toContain('class="settings-section settings-section--flat')
    expect(capabilitiesSource).not.toContain('class="settings-section-heading')
    expect(capabilitiesSource).not.toContain('class="settings-detail-header')
    expect(capabilitiesSource).not.toContain('class="settings-detail-actions')
    expect(capabilitiesSource).not.toContain('class="settings-detail-grid')
    expect(capabilitiesSource).not.toContain('class="settings-detail-block')
    expect(capabilitiesSource).not.toContain('class="settings-detail-section')
    expect(capabilitiesSource).not.toContain('field-label field-label--compact')
    expect(capabilitiesSource).not.toContain("capability-toolbar")
    expect(stylesSource).not.toContain(".capability-list")
    expect(stylesSource).not.toContain(".capability-row {")
    expect(stylesSource).not.toContain(".capability-row__")
    expect(stylesSource).not.toContain(".capability-ingest-grid")
    expect(stylesSource).not.toContain(".capability-component-chips")
    expect(capabilitiesSource).not.toContain("capability-component-list")
    expect(capabilitiesSource).not.toContain("capability-component-card")
    expect(capabilitiesSource).not.toContain("settings-table--agent-tools")
    expect(capabilitiesSource).not.toContain("settings-table--user-actions")
  })

  it("keeps adjacent settings tabs on shared page shell primitives", () => {
    const agentConfigSource = readFileSync(join(tabsDir, "AgentConfigTab.tsx"), "utf8")
    const accountsSource = readFileSync(join(tabsDir, "AccountsTab.tsx"), "utf8")
    const providersSource = readFileSync(join(tabsDir, "ProvidersTab.tsx"), "utf8")
    const serverSettingsSource = readFileSync(join(tabsDir, "ServerSettingsTab.tsx"), "utf8")

    expect(agentConfigSource).toContain("SettingsPage")
    expect(agentConfigSource).toContain("SettingsPageHeader")
    expect(agentConfigSource).toContain("SettingsActionRail")
    expect(agentConfigSource).toContain("SettingsSubTabs")
    expect(agentConfigSource).toContain("SettingsSubTabButton")
    expect(accountsSource).toContain("SettingsPage")
    expect(providersSource).toContain("SettingsPage")
    expect(providersSource).toContain("SettingsPageHeader")
    expect(providersSource).toContain("SettingsActionRail")
    expect(serverSettingsSource).toContain("SettingsPage")
    expect(serverSettingsSource).toContain("SettingsPageHeader")
    expect(serverSettingsSource).toContain("SettingsActionRail")

    expect(accountsSource).not.toContain('class="settings-page')
    expect(agentConfigSource).not.toContain('class="settings-page')
    expect(agentConfigSource).not.toContain('class="settings-page-header')
    expect(agentConfigSource).not.toContain('class="settings-subtabs')
    expect(agentConfigSource).not.toContain("settings-subtab-button")
    expect(agentConfigSource).not.toContain("settings-actions settings-actions--right")
    expect(providersSource).not.toContain('class="settings-page')
    expect(providersSource).not.toContain('class="settings-page-header')
    expect(providersSource).not.toContain("settings-actions settings-actions--right")
    expect(serverSettingsSource).not.toContain('class="settings-page')
    expect(serverSettingsSource).not.toContain('class="settings-page-header')
    expect(serverSettingsSource).not.toContain("settings-actions settings-actions--right")
  })
})
