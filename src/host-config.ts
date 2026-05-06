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
  labrastroInspected: HostUrlInspection | undefined,
  labrastroEffectiveValue: string | undefined
): HostUrlState {
  const labrastroConfigured = configuredHostUrlFromInspection(labrastroInspected)
  const labrastroUrl = normalizeHostUrl(labrastroEffectiveValue || labrastroConfigured?.url || DEFAULT_HOST_URL)

  return {
    url: labrastroUrl,
    configured: Boolean(labrastroConfigured),
    source: labrastroConfigured?.source || (labrastroInspected ? "default" : "unknown"),
  }
}

export function selectLabrastroHostWriteSource(
  labrastroInspected: HostUrlInspection | undefined
): HostUrlSource {
  const configured = configuredHostUrlFromInspection(labrastroInspected)
  if (configured?.source === "workspace-folder") return "workspace-folder"
  if (configured?.source === "workspace") return "workspace"
  return "global"
}

