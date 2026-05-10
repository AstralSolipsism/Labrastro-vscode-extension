export function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

export function numberValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return undefined
}

export function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function isAuthRequiredError(error: unknown): boolean {
  return classifyRemoteError(error) === "auth_required"
}

export function chatErrorMessage(error: unknown): string {
  if (isAuthRequiredError(error)) {
    return "登录已失效，请重新登录。"
  }
  return errorMessage(error)
}

export function postAuthError(
  post: (message: Record<string, unknown>) => void,
  error: unknown
): void {
  const message = errorMessage(error)
  const payload: Record<string, unknown> = { message }
  if (isRemoteError(error)) {
    payload.status = error.status
    payload.code = error.code
    payload.body = error.body
  }
  post({ type: "auth.error", message, payload })
}
import { classifyRemoteError, isRemoteError } from "./remote-errors"
