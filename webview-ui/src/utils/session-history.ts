import type { MockSessionBundle } from "../components/chat/mock-data"

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
