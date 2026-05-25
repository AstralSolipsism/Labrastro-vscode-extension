import type { SettingsTab } from "./settingsControllerUtils"

export type SettingsOperationStatus = "idle" | "loading" | "saving" | "success" | "error"
export type SettingsRefreshMode = "foreground" | "background"

export type SettingsOperationKey =
  | "providers"
  | "modelProfiles"
  | "chatConfig"
  | "github"
  | "serverSettings"
  | "autoApproval"
  | "reasoningDisplay"
  | "chatSendDuringRunMode"
  | "peerDiagnosticsLogging"
  | "toolDiagnostics"
  | "modelCapabilities"
  | "providerModels"
  | "providerSave"
  | "providerTest"
  | "providerCopy"
  | "providerDelete"
  | "providerEnable"
  | "modelProfileSave"
  | "modelProfileDelete"
  | "toolchains"
  | "environmentManifest"
  | "authUsers"
  | "authDevices"
  | "authAudit"
  | "accounts"
  | "conversationSave"
  | "sessionPolicySave"
  | "serverSettingsSave"
  | "autoApprovalSave"
  | "integrationsSave"
  | "toolchainsCapabilitySave"
  | "agentConfigSave"
  | "diagnosticsSave"
  | "capabilitySyncSave"
  | "connectionSave"
  | "agentRunSubmit"
  | "agentRunRetry"
  | "agentRunCancel"
  | "capabilityIngestStart"
  | "capabilityIngestStatus"

export interface SettingsOperationState {
  status: SettingsOperationStatus
  error?: string
  lastStartedAt?: number
  lastCompletedAt?: number
  targetId?: string
  requestId?: string
}

export type SettingsOperationStates = Record<SettingsOperationKey, SettingsOperationState>
export type SettingsBackgroundRefreshes = Partial<Record<SettingsOperationKey, true>>

export const SETTINGS_SERVER_SETTINGS_SAVE_KEYS: SettingsOperationKey[] = [
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

export const SETTINGS_PROVIDER_WRITE_KEYS: SettingsOperationKey[] = [
  "providerSave",
  "providerCopy",
  "providerDelete",
  "providerEnable",
  "modelProfileSave",
  "modelProfileDelete",
]

export const SETTINGS_PROVIDER_ACTION_RESULT_KEYS: SettingsOperationKey[] = [
  ...SETTINGS_PROVIDER_WRITE_KEYS,
  "providerTest",
]

export const SETTINGS_AGENT_RUN_OPERATION_KEYS: SettingsOperationKey[] = [
  "agentRunSubmit",
  "agentRunRetry",
  "agentRunCancel",
]

export const SETTINGS_CAPABILITY_INGEST_OPERATION_KEYS: SettingsOperationKey[] = [
  "capabilityIngestStart",
  "capabilityIngestStatus",
]

export const SETTINGS_OPERATION_KEYS: SettingsOperationKey[] = [
  "providers",
  "modelProfiles",
  "chatConfig",
  "github",
  "serverSettings",
  "autoApproval",
  "reasoningDisplay",
  "chatSendDuringRunMode",
  "peerDiagnosticsLogging",
  "toolDiagnostics",
  "modelCapabilities",
  "providerModels",
  "providerSave",
  "providerTest",
  "providerCopy",
  "providerDelete",
  "providerEnable",
  "modelProfileSave",
  "modelProfileDelete",
  "toolchains",
  "environmentManifest",
  "authUsers",
  "authDevices",
  "authAudit",
  "accounts",
  "conversationSave",
  "sessionPolicySave",
  "serverSettingsSave",
  "autoApprovalSave",
  "integrationsSave",
  "toolchainsCapabilitySave",
  "agentConfigSave",
  "diagnosticsSave",
  "capabilitySyncSave",
  "connectionSave",
  "agentRunSubmit",
  "agentRunRetry",
  "agentRunCancel",
  "capabilityIngestStart",
  "capabilityIngestStatus",
]

export const SETTINGS_PAGE_RESOURCES: Record<SettingsTab, SettingsOperationKey[]> = {
  executors: [],
  accounts: ["accounts"],
  providers: ["providers", "modelProfiles", "modelCapabilities"],
  toolchains: ["serverSettings", "toolchains", "environmentManifest"],
  conversation: ["chatConfig", "serverSettings", "reasoningDisplay", "chatSendDuringRunMode"],
  sessionPolicy: ["serverSettings"],
  serverSettings: ["serverSettings"],
  agentConfig: ["serverSettings", "chatConfig"],
  autoApproval: ["serverSettings", "autoApproval"],
  integrations: ["serverSettings", "github"],
  diagnostics: ["serverSettings", "peerDiagnosticsLogging", "toolDiagnostics"],
}

export function initialSettingsOperationStates(): SettingsOperationStates {
  return SETTINGS_OPERATION_KEYS.reduce<SettingsOperationStates>((states, key) => {
    states[key] = { status: "idle" }
    return states
  }, {} as SettingsOperationStates)
}

export function getSettingsOperationState(
  states: SettingsOperationStates,
  key: SettingsOperationKey,
): SettingsOperationState {
  return states[key] || { status: "idle" }
}

export function settingsOperationIsBusy(
  states: SettingsOperationStates,
  key: SettingsOperationKey,
): boolean {
  const status = getSettingsOperationState(states, key).status
  return status === "loading" || status === "saving"
}

export function settingsBackgroundRefreshIsBusy(
  backgroundRefreshes: SettingsBackgroundRefreshes,
  key: SettingsOperationKey,
): boolean {
  return backgroundRefreshes[key] === true
}

export function markSettingsBackgroundRefreshStarted(
  backgroundRefreshes: SettingsBackgroundRefreshes,
  key: SettingsOperationKey,
): SettingsBackgroundRefreshes {
  return {
    ...backgroundRefreshes,
    [key]: true,
  }
}

export function markSettingsBackgroundRefreshFinished(
  backgroundRefreshes: SettingsBackgroundRefreshes,
  key: SettingsOperationKey,
): SettingsBackgroundRefreshes {
  if (!backgroundRefreshes[key]) return backgroundRefreshes
  const next = { ...backgroundRefreshes }
  delete next[key]
  return next
}

export function settingsRefreshShouldSendRequest(
  states: SettingsOperationStates,
  backgroundRefreshes: SettingsBackgroundRefreshes,
  key: SettingsOperationKey,
  mode: SettingsRefreshMode,
): boolean {
  if (key === "providerModels" && mode === "background") return false
  if (settingsOperationIsBusy(states, key)) return false
  if (settingsBackgroundRefreshIsBusy(backgroundRefreshes, key)) return false
  return true
}

export function settingsRefreshShouldMarkForeground(
  states: SettingsOperationStates,
  backgroundRefreshes: SettingsBackgroundRefreshes,
  key: SettingsOperationKey,
  mode: SettingsRefreshMode,
): boolean {
  if (mode !== "foreground") return false
  if (settingsOperationIsBusy(states, key)) return false
  return key === "providerModels" || settingsBackgroundRefreshIsBusy(backgroundRefreshes, key)
    || settingsRefreshShouldSendRequest(states, backgroundRefreshes, key, mode)
}

export function settingsServerSettingsSaveIsBusy(states: SettingsOperationStates): boolean {
  return SETTINGS_SERVER_SETTINGS_SAVE_KEYS.some((key) => settingsOperationIsBusy(states, key))
}

export function settingsServerSettingsWriteIsBusy(states: SettingsOperationStates): boolean {
  return settingsServerSettingsSaveIsBusy(states)
}

export function settingsServerSettingsReadIsBusy(states: SettingsOperationStates): boolean {
  return settingsOperationIsBusy(states, "serverSettings")
}

export function settingsProviderWriteIsBusy(states: SettingsOperationStates): boolean {
  return SETTINGS_PROVIDER_WRITE_KEYS.some((key) => settingsOperationIsBusy(states, key))
}

export function settingsProviderActionResultIsBusy(states: SettingsOperationStates): boolean {
  return SETTINGS_PROVIDER_ACTION_RESULT_KEYS.some((key) => settingsOperationIsBusy(states, key))
}

export function settingsProviderModelReadIsBusy(
  states: SettingsOperationStates,
  providerId?: string,
): boolean {
  const state = getSettingsOperationState(states, "providerModels")
  if (!(state.status === "loading" || state.status === "saving")) return false
  return !providerId || !state.targetId || state.targetId === providerId
}

export function settingsOperationIsProviderWrite(key: SettingsOperationKey): boolean {
  return SETTINGS_PROVIDER_WRITE_KEYS.includes(key)
}

export function settingsOperationUsesProviderActionResult(key: SettingsOperationKey): boolean {
  return SETTINGS_PROVIDER_ACTION_RESULT_KEYS.includes(key)
}

export function settingsAgentRunOperationIsBusy(states: SettingsOperationStates): boolean {
  return SETTINGS_AGENT_RUN_OPERATION_KEYS.some((key) => settingsOperationIsBusy(states, key))
}

export function settingsCapabilityIngestOperationIsBusy(states: SettingsOperationStates): boolean {
  return SETTINGS_CAPABILITY_INGEST_OPERATION_KEYS.some((key) => settingsOperationIsBusy(states, key))
}

export function markSettingsOperationStarted(
  states: SettingsOperationStates,
  key: SettingsOperationKey,
  status: Extract<SettingsOperationStatus, "loading" | "saving"> = "loading",
  now = Date.now(),
  metadata: Pick<SettingsOperationState, "targetId" | "requestId"> = {},
): SettingsOperationStates {
  return {
    ...states,
    [key]: {
      status,
      lastStartedAt: now,
      ...metadata,
    },
  }
}

export function markSettingsOperationSuccess(
  states: SettingsOperationStates,
  key: SettingsOperationKey,
  now = Date.now(),
): SettingsOperationStates {
  return {
    ...states,
    [key]: {
      ...getSettingsOperationState(states, key),
      status: "success",
      error: undefined,
      lastCompletedAt: now,
    },
  }
}

export function markSettingsOperationIdle(
  states: SettingsOperationStates,
  key: SettingsOperationKey,
): SettingsOperationStates {
  return {
    ...states,
    [key]: { status: "idle" },
  }
}

export function markSettingsOperationError(
  states: SettingsOperationStates,
  key: SettingsOperationKey,
  error: string,
  now = Date.now(),
): SettingsOperationStates {
  return {
    ...states,
    [key]: {
      ...getSettingsOperationState(states, key),
      status: "error",
      error,
      lastCompletedAt: now,
    },
  }
}

export function settingsPageOperationKeys(tab: SettingsTab): SettingsOperationKey[] {
  return SETTINGS_PAGE_RESOURCES[tab] || []
}

export function settingsPageIsRefreshing(states: SettingsOperationStates, tab: SettingsTab): boolean {
  return settingsPageOperationKeys(tab).some((key) => settingsOperationIsBusy(states, key))
}
