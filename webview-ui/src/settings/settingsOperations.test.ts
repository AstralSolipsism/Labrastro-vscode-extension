import { describe, expect, it } from "vitest"
import {
  initialSettingsOperationStates,
  markSettingsOperationError,
  markSettingsOperationIdle,
  markSettingsOperationStarted,
  markSettingsOperationSuccess,
  settingsAgentRunOperationIsBusy,
  settingsCapabilityIngestOperationIsBusy,
  settingsOperationKeysForAdminError,
  settingsOperationIsBusy,
  settingsPageIsRefreshing,
  settingsPageOperationKeys,
  settingsProviderAdminActionIsBusy,
  settingsServerSettingsSaveIsBusy,
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

    states = markSettingsOperationStarted(states, "diagnosticsSave", "saving", 100)
    expect(settingsServerSettingsSaveIsBusy(states)).toBe(true)

    states = markSettingsOperationSuccess(states, "diagnosticsSave", 200)
    expect(settingsServerSettingsSaveIsBusy(states)).toBe(false)
  })

  it("settles provider model refreshes through admin errors only while they are pending", () => {
    expect(settingsOperationKeysForAdminError(initialSettingsOperationStates())).toEqual(["admin"])

    const states = markSettingsOperationStarted(
      initialSettingsOperationStates(),
      "providerModels",
      "loading",
      100,
    )

    expect(settingsOperationKeysForAdminError(states)).toEqual(["admin", "providerModels"])
  })

  it("treats provider admin actions as one mutually-exclusive action lane", () => {
    let states = initialSettingsOperationStates()
    expect(settingsProviderAdminActionIsBusy(states)).toBe(false)

    states = markSettingsOperationStarted(states, "providerTest", "loading", 100)
    expect(settingsProviderAdminActionIsBusy(states)).toBe(true)
    expect(settingsOperationKeysForAdminError(states)).toEqual(["admin", "providerTest"])

    states = markSettingsOperationSuccess(states, "providerTest", 200)
    expect(settingsProviderAdminActionIsBusy(states)).toBe(false)
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
