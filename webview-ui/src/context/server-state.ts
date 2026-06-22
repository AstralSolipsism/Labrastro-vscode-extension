export function remoteStateSliceData(slice: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!("data" in slice)) return undefined
  const data = slice.data
  return data && typeof data === "object" ? data as Record<string, unknown> : undefined
}

export function remoteStateSliceError(slice: Record<string, unknown>): string | undefined {
  return typeof slice.error === "string" ? slice.error : undefined
}

export function connectionStateFromRemoteSlice(slice: Record<string, unknown>): Record<string, unknown> | undefined {
  const data = remoteStateSliceData(slice)
  const error = remoteStateSliceError(slice)
  if (!data) {
    return error ? { status: "error", message: error } : undefined
  }
  if (slice.status === "stale" && error) {
    const lastKnownStatus = typeof data.status === "string" ? data.status : undefined
    return {
      ...data,
      status: "stale",
      ...(lastKnownStatus ? { lastKnownStatus } : {}),
      message: error,
    }
  }
  return data
}

export function shouldClearAdminForConnectionState(payload: Record<string, unknown>): boolean {
  if (payload.authenticated === false) return true
  return payload.status === "login-required"
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

export function environmentRunErrorMessageForGlobalState(message: Record<string, unknown>): string | undefined {
  if (message.type !== "environment.run.error") return undefined
  if (!environmentRunMessageTargetsGlobalState(message)) return undefined
  return stringValue(message.message) || "Environment run failed"
}

export function environmentRunMessageTargetsGlobalState(message: Record<string, unknown>): boolean {
  const type = stringValue(message.type)
  if (
    type !== "environment.run.started" &&
    type !== "environment.run.completed" &&
    type !== "environment.run.error"
  ) {
    return false
  }
  return !stringValue(message.requestId) && !stringValue(message.request_id)
}

function shouldSetScopedAdminError(message: Record<string, unknown>): boolean {
  if (message.type !== "admin.error") return false
  return message.scope === "adminState" || shouldClearAdminForError(message)
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : ""
}
