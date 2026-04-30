export interface HostUrlValidationResult {
  ok: boolean
  value: string
  error?: string
}

export interface HostDraftSyncInput {
  currentHostUrl: string
  dirty: boolean
  pendingHostSave?: string
  localError?: string
  syncLock?: string
}

export interface HostSaveResolution {
  hostUrl: string
  dirty: boolean
  syncLock?: string
  error?: string
}

export function normalizeHostUrlInput(value: string): string {
  return value
    .trim()
    .replace(/^(https?):\/(?!\/)/i, "$1://")
    .replace(/\/+$/, "")
}

export function validateHostUrlInput(value: string): HostUrlValidationResult {
  const normalized = normalizeHostUrlInput(value)
  if (!normalized) {
    return { ok: false, value: "", error: "Host URL 不能为空。" }
  }
  let parsed: URL
  try {
    parsed = new URL(normalized)
  } catch {
    return { ok: false, value: normalized, error: "Host URL 格式无效，请使用 http:// 或 https:// 地址。" }
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, value: normalized, error: "Host URL 只支持 http:// 或 https://。" }
  }
  if (!parsed.hostname) {
    return { ok: false, value: normalized, error: "Host URL 缺少主机名。" }
  }
  return { ok: true, value: normalized }
}

export function shouldSyncHostDraft(input: HostDraftSyncInput): boolean {
  if (!input.currentHostUrl) return false
  if (input.dirty || input.pendingHostSave || input.localError) return false
  if (input.syncLock && input.currentHostUrl !== input.syncLock) return false
  return true
}

export function resolveHostSaveResult(
  result: Record<string, unknown>,
  currentDraft: string
): HostSaveResolution {
  const requested = stringValue(result.hostUrlSaveRequested)
  const effective = stringValue(result.hostUrl)
  const applied = result.hostUrlSaveApplied === true && requested && effective === requested
  if (applied) {
    return {
      hostUrl: effective,
      dirty: false,
      syncLock: effective,
    }
  }
  return {
    hostUrl: currentDraft,
    dirty: true,
    error: requested
      ? `Host URL 保存未生效：请求保存 ${requested}，当前实际请求 Host 是 ${effective || "未配置"}。`
      : "Host URL 保存未生效。",
  }
}

function stringValue(value: unknown, fallback = ""): string {
  if (value === undefined || value === null) return fallback
  return String(value)
}

