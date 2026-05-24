import type { SettingsTab } from "./settingsControllerUtils"

export type SettingsOperationStatus = "idle" | "loading" | "saving" | "success" | "error"

export type SettingsOperationKey =
  | "admin"
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
}

export type SettingsOperationStates = Record<SettingsOperationKey, SettingsOperationState>

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

export const SETTINGS_PROVIDER_ADMIN_ACTION_KEYS: SettingsOperationKey[] = [
  "providerModels",
  "providerSave",
  "providerTest",
  "providerCopy",
  "providerDelete",
  "providerEnable",
  "modelProfileSave",
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
  "admin",
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
  executors: ["admin"],
  accounts: ["accounts"],
  providers: ["admin", "modelCapabilities"],
  toolchains: ["serverSettings", "toolchains", "environmentManifest"],
  conversation: ["admin", "serverSettings", "reasoningDisplay", "chatSendDuringRunMode"],
  sessionPolicy: ["serverSettings"],
  serverSettings: ["serverSettings"],
  agentConfig: ["serverSettings"],
  autoApproval: ["serverSettings", "autoApproval"],
  integrations: ["admin", "serverSettings"],
  diagnostics: ["admin", "serverSettings", "peerDiagnosticsLogging", "toolDiagnostics"],
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

export function settingsServerSettingsSaveIsBusy(states: SettingsOperationStates): boolean {
  return SETTINGS_SERVER_SETTINGS_SAVE_KEYS.some((key) => settingsOperationIsBusy(states, key))
}

export function settingsProviderAdminActionIsBusy(states: SettingsOperationStates): boolean {
  return SETTINGS_PROVIDER_ADMIN_ACTION_KEYS.some((key) => settingsOperationIsBusy(states, key))
}

export function settingsAgentRunOperationIsBusy(states: SettingsOperationStates): boolean {
  return SETTINGS_AGENT_RUN_OPERATION_KEYS.some((key) => settingsOperationIsBusy(states, key))
}

export function settingsCapabilityIngestOperationIsBusy(states: SettingsOperationStates): boolean {
  return SETTINGS_CAPABILITY_INGEST_OPERATION_KEYS.some((key) => settingsOperationIsBusy(states, key))
}

export function settingsOperationKeysForAdminError(states: SettingsOperationStates): SettingsOperationKey[] {
  const keys: SettingsOperationKey[] = ["admin"]
  for (const key of SETTINGS_PROVIDER_ADMIN_ACTION_KEYS) {
    if (settingsOperationIsBusy(states, key)) keys.push(key)
  }
  return keys
}

export function markSettingsOperationStarted(
  states: SettingsOperationStates,
  key: SettingsOperationKey,
  status: Extract<SettingsOperationStatus, "loading" | "saving"> = "loading",
  now = Date.now(),
): SettingsOperationStates {
  return {
    ...states,
    [key]: {
      status,
      lastStartedAt: now,
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
