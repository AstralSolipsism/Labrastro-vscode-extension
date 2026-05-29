export class RemoteError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly body: unknown
  ) {
    super(message)
    this.name = "RemoteError"
  }
}

export type RemoteErrorCategory = "transient_network" | "auth_required" | "fatal_session_run"

export class RemoteTransportError extends Error {
  constructor(
    message: string,
    public readonly category: RemoteErrorCategory,
    public readonly cause?: unknown
  ) {
    super(message)
    this.name = "RemoteTransportError"
  }
}

export function isRemoteError(error: unknown, code?: string, status?: number): error is RemoteError {
  if (!(error instanceof RemoteError)) return false
  if (code !== undefined && error.code !== code) return false
  if (status !== undefined && error.status !== status) return false
  return true
}

export function classifyRemoteError(error: unknown): RemoteErrorCategory {
  if (error instanceof RemoteTransportError) return error.category
  if (isInvalidPeerTokenError(error)) return "transient_network"
  if (isRemoteError(error, "unauthorized", 401) || isRemoteError(error, "invalid_refresh_token", 401)) {
    return "auth_required"
  }
  if (error instanceof RemoteError) {
    if ([408, 429, 500, 502, 503, 504].includes(error.status)) {
      return "transient_network"
    }
    return "fatal_session_run"
  }
  const code = errorCode(error)
  if (
    code === "AbortError" ||
    code === "ETIMEDOUT" ||
    code === "ECONNRESET" ||
    code === "ECONNREFUSED" ||
    code === "EAI_AGAIN" ||
    code === "ENOTFOUND" ||
    code === "UND_ERR_CONNECT_TIMEOUT" ||
    error instanceof TypeError
  ) {
    return "transient_network"
  }
  return "fatal_session_run"
}

export function isInvalidPeerTokenError(error: unknown): boolean {
  return isRemoteError(error, "invalid_peer_token", 401)
}

export async function retryInvalidPeerTokenOnce<T>(
  operation: () => Promise<T>,
  recover: () => Promise<void>
): Promise<T> {
  try {
    return await operation()
  } catch (error) {
    if (!isInvalidPeerTokenError(error)) {
      throw error
    }
    await recover()
    return operation()
  }
}

export function errorCode(error: unknown): string {
  const maybeCode = error && typeof error === "object"
    ? (error as { code?: unknown }).code
    : undefined
  return typeof maybeCode === "string" ? maybeCode : ""
}
