export function shouldClearAdminForConnectionState(payload: Record<string, unknown>): boolean {
  return payload.authenticated !== true
}

export function shouldClearAdminForError(message: Record<string, unknown>): boolean {
  if (message.type !== "admin.error") return false
  const category = typeof message.category === "string" ? message.category : ""
  if (category === "unauthenticated" || category === "forbidden") return true
  const scope = typeof message.scope === "string" ? message.scope : ""
  if (scope === "adminAction" || scope === "peerDiagnostics") return false
  if (message.stale === true || message.clearsState === true) return true
  if (message.clearsState === false) return false
  return scope === "adminState" && (category === "unavailable" || category === "network")
}

export function shouldSetAdminStateErrorForError(message: Record<string, unknown>): boolean {
  return shouldSetScopedAdminError(message)
}

export function shouldSetModelListErrorForError(message: Record<string, unknown>): boolean {
  return shouldSetScopedAdminError(message)
}

function shouldSetScopedAdminError(message: Record<string, unknown>): boolean {
  if (message.type !== "admin.error") return false
  return message.scope === "adminState" || shouldClearAdminForError(message)
}
