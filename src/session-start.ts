export const LEGACY_BACKEND_UPGRADE_MESSAGE = "服务端版本过旧，需要升级 dogcode backend。"

export interface SessionStartCapabilities {
  freshSessionWithoutSessionHint?: boolean
}

export function canStartSessionlessChat(
  sessionApiAvailable: boolean | undefined,
  capabilities: SessionStartCapabilities | null | undefined
): boolean {
  if (sessionApiAvailable !== false) {
    return true
  }
  return capabilities?.freshSessionWithoutSessionHint === true
}
