import { describe, expect, it } from "vitest"
import {
  initialSettingsOperationStates,
  markSettingsBackgroundRefreshFinished,
  markSettingsBackgroundRefreshStarted,
  markSettingsOperationError,
  markSettingsOperationIdle,
  markSettingsOperationStarted,
  markSettingsOperationSuccess,
  settingsBackgroundRefreshIsBusy,
  settingsOperationIsProviderWrite,
  settingsOperationUsesProviderActionResult,
  settingsAgentRunOperationIsBusy,
  settingsCapabilityIngestOperationIsBusy,
  settingsOperationIsBusy,
  settingsPageIsRefreshing,
  settingsPageOperationKeys,
  settingsProviderActionResultIsBusy,
  settingsProviderModelReadIsBusy,
  settingsProviderWriteIsBusy,
  settingsRefreshShouldMarkForeground,
  settingsRefreshShouldSendRequest,
  settingsServerSettingsReadIsBusy,
  settingsServerSettingsSaveIsBusy,
  settingsServerSettingsWriteIsBusy,
  type SettingsBackgroundRefreshes,
} from "./settingsOperations"

describe("settings operations", () => {
  it("maps conversation refresh to shared conversation resources", () => {
    expect(settingsPageOperationKeys("conversation")).toEqual([
      "admin",
      "serverSettings",
      "reasoningDisplay",
      "chatSendDuringRunMode",
    ])
  })

  it("maps toolchains refresh to server settings, toolchains, and environment manifest", () => {
    expect(settingsPageOperationKeys("toolchains")).toEqual([
      "serverSettings",
      "toolchains",
      "environmentManifest",
    ])
  })

  it("tracks operation busy, success, and error states", () => {
    let states = initialSettingsOperationStates()

    states = markSettingsOperationStarted(states, "serverSettings", "loading", 100)
    expect(settingsOperationIsBusy(states, "serverSettings")).toBe(true)
    expect(settingsPageIsRefreshing(states, "serverSettings")).toBe(true)

    states = markSettingsOperationSuccess(states, "serverSettings", 200)
    expect(settingsOperationIsBusy(states, "serverSettings")).toBe(false)
    expect(states.serverSettings).toMatchObject({ status: "success", lastCompletedAt: 200 })

    states = markSettingsOperationError(states, "serverSettings", "boom", 300)
    expect(states.serverSettings).toMatchObject({ status: "error", error: "boom", lastCompletedAt: 300 })

    states = markSettingsOperationIdle(states, "serverSettings")
    expect(states.serverSettings).toEqual({ status: "idle" })
  })

  it("has separate save operations for server settings surfaces", () => {
    const states = markSettingsOperationStarted(
      initialSettingsOperationStates(),
      "conversationSave",
      "saving",
      100,
    )

    expect(settingsOperationIsBusy(states, "conversationSave")).toBe(true)
    expect(settingsOperationIsBusy(states, "sessionPolicySave")).toBe(false)
    expect(settingsOperationIsBusy(states, "serverSettingsSave")).toBe(false)
  })

  it("treats server settings saves as one mutually-exclusive write lane", () => {
    let states = initialSettingsOperationStates()
    expect(settingsServerSettingsSaveIsBusy(states)).toBe(false)
    expect(settingsServerSettingsWriteIsBusy(states)).toBe(false)

    states = markSettingsOperationStarted(states, "diagnosticsSave", "saving", 100)
    expect(settingsServerSettingsSaveIsBusy(states)).toBe(true)
    expect(settingsServerSettingsWriteIsBusy(states)).toBe(true)

    states = markSettingsOperationSuccess(states, "diagnosticsSave", 200)
    expect(settingsServerSettingsSaveIsBusy(states)).toBe(false)
    expect(settingsServerSettingsWriteIsBusy(states)).toBe(false)
  })

  it("tracks server settings reads separately from writes", () => {
    let states = initialSettingsOperationStates()
    expect(settingsServerSettingsReadIsBusy(states)).toBe(false)

    states = markSettingsOperationStarted(states, "serverSettings", "loading", 100)
    expect(settingsServerSettingsReadIsBusy(states)).toBe(true)
    expect(settingsServerSettingsWriteIsBusy(states)).toBe(false)
  })

  it("keeps background refreshes out of page loading while allowing foreground takeover", () => {
    let states = initialSettingsOperationStates()
    let background: SettingsBackgroundRefreshes = {}

    background = markSettingsBackgroundRefreshStarted(background, "serverSettings")

    expect(settingsBackgroundRefreshIsBusy(background, "serverSettings")).toBe(true)
    expect(settingsPageIsRefreshing(states, "serverSettings")).toBe(false)
    expect(settingsRefreshShouldSendRequest(states, background, "serverSettings", "foreground")).toBe(false)
    expect(settingsRefreshShouldMarkForeground(states, background, "serverSettings", "foreground")).toBe(true)

    states = markSettingsOperationStarted(states, "serverSettings", "loading", 100)
    expect(settingsPageIsRefreshing(states, "serverSettings")).toBe(true)

    background = markSettingsBackgroundRefreshFinished(background, "serverSettings")
    states = markSettingsOperationSuccess(states, "serverSettings", 200)

    expect(settingsBackgroundRefreshIsBusy(background, "serverSettings")).toBe(false)
    expect(settingsPageIsRefreshing(states, "serverSettings")).toBe(false)
  })

  it("prevents duplicate background refreshes and excludes provider model refresh", () => {
    let background: SettingsBackgroundRefreshes = {}
    let states = initialSettingsOperationStates()

    expect(settingsRefreshShouldSendRequest(states, background, "modelCapabilities", "background")).toBe(true)
    expect(settingsRefreshShouldSendRequest(states, background, "providerModels", "background")).toBe(false)

    background = markSettingsBackgroundRefreshStarted(background, "modelCapabilities")
    expect(settingsRefreshShouldSendRequest(states, background, "modelCapabilities", "background")).toBe(false)

    states = markSettingsOperationStarted(states, "modelCapabilities", "loading", 100)
    expect(settingsRefreshShouldSendRequest(states, {}, "modelCapabilities", "background")).toBe(false)
  })

  it("keeps provider model reads out of the provider write lane", () => {
    let states = initialSettingsOperationStates()
    expect(settingsProviderWriteIsBusy(states)).toBe(false)
    expect(settingsProviderModelReadIsBusy(states)).toBe(false)

    states = markSettingsOperationStarted(states, "providerModels", "loading", 100, {
      targetId: "deepseek",
      requestId: "deepseek:1",
    })

    expect(settingsProviderModelReadIsBusy(states)).toBe(true)
    expect(settingsProviderModelReadIsBusy(states, "deepseek")).toBe(true)
    expect(settingsProviderModelReadIsBusy(states, "openai")).toBe(false)
    expect(settingsProviderWriteIsBusy(states)).toBe(false)
  })

  it("tracks provider writes separately from provider action-result reads", () => {
    let states = initialSettingsOperationStates()
    expect(settingsProviderWriteIsBusy(states)).toBe(false)
    expect(settingsProviderActionResultIsBusy(states)).toBe(false)

    states = markSettingsOperationStarted(states, "providerTest", "loading", 100)
    expect(settingsProviderWriteIsBusy(states)).toBe(false)
    expect(settingsProviderActionResultIsBusy(states)).toBe(true)

    states = markSettingsOperationSuccess(states, "providerTest", 200)
    expect(settingsProviderActionResultIsBusy(states)).toBe(false)

    states = markSettingsOperationStarted(states, "providerSave", "saving", 300)
    expect(settingsProviderWriteIsBusy(states)).toBe(true)
    expect(settingsProviderActionResultIsBusy(states)).toBe(true)
    expect(settingsOperationIsProviderWrite("providerSave")).toBe(true)
    expect(settingsOperationIsProviderWrite("providerModels")).toBe(false)
    expect(settingsOperationUsesProviderActionResult("providerTest")).toBe(true)
    expect(settingsOperationUsesProviderActionResult("providerModels")).toBe(false)
  })

  it("tracks agent run and capability ingest lanes separately", () => {
    let states = initialSettingsOperationStates()

    states = markSettingsOperationStarted(states, "agentRunRetry", "saving", 100)
    states = markSettingsOperationStarted(states, "capabilityIngestStatus", "loading", 101)

    expect(settingsAgentRunOperationIsBusy(states)).toBe(true)
    expect(settingsCapabilityIngestOperationIsBusy(states)).toBe(true)

    states = markSettingsOperationSuccess(states, "agentRunRetry", 200)
    expect(settingsAgentRunOperationIsBusy(states)).toBe(false)
    expect(settingsCapabilityIngestOperationIsBusy(states)).toBe(true)
  })
})
