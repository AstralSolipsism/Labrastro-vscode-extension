export type MemoryStatusTone = "success" | "warning" | "muted" | "error"
export type SettingsTranslate = (key: string, params?: Record<string, string | number>) => string

function boolValue(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback
}

function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback
}

export function memoryStatusTone(status: unknown): MemoryStatusTone {
  switch (String(status || "")) {
    case "available":
    case "configured":
      return "success"
    case "adapter_missing":
    case "target_missing":
    case "target_disabled":
    case "target_unavailable":
    case "missing":
    case "not_configured":
      return "error"
    case "disabled":
      return "muted"
    default:
      return "warning"
  }
}

export function memoryStatusLabelKey(status: unknown): string {
  switch (String(status || "")) {
    case "available":
      return "memorySettings.status.available"
    case "configured":
      return "memorySettings.status.configured"
    case "adapter_missing":
      return "memorySettings.status.adapterMissing"
    case "target_missing":
      return "memorySettings.status.targetMissing"
    case "target_disabled":
      return "memorySettings.status.targetDisabled"
    case "target_unavailable":
      return "memorySettings.status.targetUnavailable"
    case "missing":
      return "memorySettings.status.missing"
    case "not_configured":
      return "memorySettings.status.notConfigured"
    case "disabled":
      return "memorySettings.status.disabled"
    case "policy_only":
      return "memorySettings.status.policyOnly"
    default:
      return "memorySettings.status.pending"
  }
}

export function memoryStatusReasonKey(status: unknown): string {
  switch (String(status || "")) {
    case "available":
      return "memorySettings.reason.available"
    case "configured":
      return "memorySettings.reason.configured"
    case "adapter_missing":
      return "memorySettings.reason.adapterMissing"
    case "target_missing":
      return "memorySettings.reason.targetMissing"
    case "target_disabled":
      return "memorySettings.reason.targetDisabled"
    case "target_unavailable":
      return "memorySettings.reason.targetUnavailable"
    case "missing":
      return "memorySettings.reason.missing"
    case "not_configured":
      return "memorySettings.reason.notConfigured"
    case "disabled":
      return "memorySettings.reason.disabled"
    case "policy_only":
      return "memorySettings.reason.policyOnly"
    default:
      return "memorySettings.reason.pending"
  }
}

export function memoryStatusActionKey(status: unknown): string {
  switch (String(status || "")) {
    case "available":
    case "configured":
      return "memorySettings.action.none"
    case "adapter_missing":
      return "memorySettings.action.checkAdapter"
    case "target_missing":
      return "memorySettings.action.chooseProvider"
    case "target_disabled":
      return "memorySettings.action.enableProvider"
    case "target_unavailable":
      return "memorySettings.action.fixProvider"
    case "missing":
    case "not_configured":
      return "memorySettings.action.configureDefaultProvider"
    case "disabled":
      return "memorySettings.action.enableWhenNeeded"
    case "policy_only":
      return "memorySettings.action.keepAdvanced"
    default:
      return "memorySettings.action.refresh"
  }
}

export function memoryProviderStatusLabelKey(status: unknown): string {
  return memoryStatusLabelKey(status)
}

export function memoryProviderOptionLabel(provider: Record<string, unknown>, translate: SettingsTranslate): string {
  const id = stringValue(provider.id)
  if (provider.available !== false) return id
  return translate("memorySettings.provider.optionUnavailable", {
    id,
    status: translate(memoryProviderStatusLabelKey(provider.status)),
  })
}

export function sourceSectionTone(sources: Record<string, unknown>[]): MemoryStatusTone {
  if (!sources.length) return "muted"
  if (sources.some((source) => memoryStatusTone(source.status) === "error")) return "error"
  if (sources.every((source) => memoryStatusTone(source.status) === "success")) return "success"
  return "warning"
}

export function agentSectionTone(memoryEnabled: boolean, policies: Record<string, unknown>[]): MemoryStatusTone {
  if (!memoryEnabled) return "muted"
  if (!policies.length) return "warning"
  if (policies.some((policy) => boolValue(policy.enabled) && memoryStatusTone(policy.provider_status) === "error")) return "error"
  if (policies.some((policy) => boolValue(policy.enabled))) return "success"
  return "muted"
}

export function enabledPolicyCount(policies: Record<string, unknown>[]): number {
  return policies.filter((policy) => boolValue(policy.enabled)).length
}
