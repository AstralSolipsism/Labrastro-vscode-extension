export const LEGACY_BACKEND_UPGRADE_MESSAGE = "服务端版本过旧，需要升级 Labrastro backend。"

export interface SessionStartFeatures {
  freshSessionWithoutSessionHint?: boolean
}

export function canStartSessionlessChat(
  sessionApiAvailable: boolean | undefined,
  features: SessionStartFeatures | null | undefined
): boolean {
  if (sessionApiAvailable !== false) {
    return true
  }
  return features?.freshSessionWithoutSessionHint === true
}
