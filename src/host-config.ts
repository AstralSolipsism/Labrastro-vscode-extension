export type HostUrlSource = "default" | "global" | "workspace" | "workspace-folder" | "unknown"

export interface HostUrlInspection {
  defaultValue?: string
  globalValue?: string
  workspaceValue?: string
  workspaceFolderValue?: string
}

export interface HostUrlState {
  url: string
  configured: boolean
  source: HostUrlSource
  migratedFromEzcode: boolean
  legacyHostUrl?: string
  legacyHostUrlSource?: HostUrlSource
  migrationTargetSource?: HostUrlSource
  message?: string
}

export const DEFAULT_HOST_URL = "http://127.0.0.1:8765"

export function normalizeHostUrl(value: string | undefined): string {
  return (value || "").trim().replace(/\/+$/, "")
}

export function isDefaultLocalHost(value: string | undefined): boolean {
  const host = normalizeHostUrl(value)
  return host === "http://127.0.0.1:8765" || host === "http://localhost:8765"
}

export function configuredHostUrlFromInspection(
  inspected: HostUrlInspection | undefined
): { url: string; source: HostUrlSource } | undefined {
  if (!inspected) return undefined
  if (inspected.workspaceFolderValue !== undefined) {
    return { url: normalizeHostUrl(inspected.workspaceFolderValue), source: "workspace-folder" }
  }
  if (inspected.workspaceValue !== undefined) {
    return { url: normalizeHostUrl(inspected.workspaceValue), source: "workspace" }
  }
  if (inspected.globalValue !== undefined) {
    return { url: normalizeHostUrl(inspected.globalValue), source: "global" }
  }
  return undefined
}

export function resolveHostUrlState(
  dogcodeInspected: HostUrlInspection | undefined,
  dogcodeEffectiveValue: string | undefined,
  ezcodeInspected: HostUrlInspection | undefined
): HostUrlState {
  const dogcodeConfigured = configuredHostUrlFromInspection(dogcodeInspected)
  const legacyConfigured = configuredHostUrlFromInspection(ezcodeInspected)
  const dogcodeUrl = normalizeHostUrl(dogcodeEffectiveValue || dogcodeConfigured?.url || DEFAULT_HOST_URL)
  const legacyUrl = normalizeHostUrl(legacyConfigured?.url)
  const shouldUseLegacy =
    Boolean(legacyConfigured && legacyUrl && !isDefaultLocalHost(legacyUrl)) &&
    (!dogcodeConfigured || !dogcodeUrl || isDefaultLocalHost(dogcodeUrl))

  if (shouldUseLegacy && legacyConfigured) {
    return {
      url: legacyUrl,
      configured: true,
      source: legacyConfigured.source,
      migratedFromEzcode: true,
      legacyHostUrl: legacyUrl,
      legacyHostUrlSource: legacyConfigured.source,
      migrationTargetSource: legacyConfigured.source,
      message: `已从 EZCode 旧 Host 配置迁移到 dogcode：${legacyUrl}。`,
    }
  }

  return {
    url: dogcodeUrl,
    configured: Boolean(dogcodeConfigured),
    source: dogcodeConfigured?.source || (dogcodeInspected ? "default" : "unknown"),
    migratedFromEzcode: false,
    legacyHostUrl: legacyUrl || undefined,
    legacyHostUrlSource: legacyConfigured?.source,
  }
}

export function selectDogcodeHostWriteSource(
  dogcodeInspected: HostUrlInspection | undefined
): HostUrlSource {
  const configured = configuredHostUrlFromInspection(dogcodeInspected)
  if (configured?.source === "workspace-folder") return "workspace-folder"
  if (configured?.source === "workspace") return "workspace"
  return "global"
}

export function selectMigrationWriteSource(source: HostUrlSource | undefined): HostUrlSource {
  if (source === "workspace-folder" || source === "workspace") return source
  return "global"
}

