import type { MockSessionBundle } from "../components/chat/mock-data"

export function isLocalDraftSessionId(sessionId: string | null | undefined): boolean {
  return Boolean(sessionId?.startsWith("session-"))
}

export function shouldIgnoreInitialSessionLoad(
  currentSessionId: string | null | undefined,
  incomingSessionId: string | null | undefined,
  reason: unknown
): boolean {
  return (
    reason === "initial" &&
    Boolean(currentSessionId) &&
    Boolean(incomingSessionId) &&
    currentSessionId !== incomingSessionId &&
    isLocalDraftSessionId(currentSessionId)
  )
}

export function sessionBundleHasContent(bundle: MockSessionBundle): boolean {
  return bundle.turns.some((turn) => {
    if (turn.userMessage.text.trim() || turn.userMessage.parts.length > 0) {
      return true
    }
    return turn.assistantMessages.some(
      (message) => message.text.trim() || message.parts.length > 0
    )
  })
}
