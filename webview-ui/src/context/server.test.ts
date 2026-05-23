import { describe, expect, it } from "vitest"
import {
  shouldClearAdminForConnectionState,
  shouldClearAdminForError,
  shouldSetAdminStateErrorForError,
  shouldSetModelListErrorForError,
} from "./server-state"

describe("server context state guards", () => {
  it("clears admin data whenever the current connection is not authenticated", () => {
    expect(shouldClearAdminForConnectionState({ status: "ready", authenticated: true })).toBe(false)
    expect(shouldClearAdminForConnectionState({ status: "ready", authenticated: false })).toBe(true)
    expect(shouldClearAdminForConnectionState({ status: "login-required" })).toBe(true)
    expect(shouldClearAdminForConnectionState({ status: "checking" })).toBe(true)
  })

  it("clears stale admin data on auth, permission, unavailable, and network admin errors", () => {
    expect(shouldClearAdminForError({ type: "admin.error", message: "401 unauthorized", category: "unauthenticated" })).toBe(true)
    expect(shouldClearAdminForError({ type: "admin.error", message: "403 forbidden", category: "forbidden" })).toBe(true)
    expect(shouldClearAdminForError({ type: "admin.error", message: "503 unavailable", category: "unavailable" })).toBe(true)
    expect(shouldClearAdminForError({ type: "admin.error", message: "fetch failed", category: "network" })).toBe(true)
    expect(shouldClearAdminForError({ type: "admin.error", message: "stale", stale: true })).toBe(true)
    expect(shouldClearAdminForError({ type: "admin.error", message: "clear", clearsState: true })).toBe(true)
    expect(shouldClearAdminForError({ type: "admin.error", message: "diagnostics unavailable", category: "unavailable", scope: "peerDiagnostics", clearsState: false })).toBe(false)
    expect(shouldClearAdminForError({ type: "admin.error", message: "validation failed", category: "unknown" })).toBe(false)
  })

  it("scopes admin errors for admin state and model list consumers", () => {
    const peerDiagnosticsError = {
      type: "admin.error",
      message: "diagnostics unavailable",
      category: "unavailable",
      scope: "peerDiagnostics",
      clearsState: false,
    }
    expect(shouldSetAdminStateErrorForError(peerDiagnosticsError)).toBe(false)
    expect(shouldSetModelListErrorForError(peerDiagnosticsError)).toBe(false)

    const adminStateError = {
      type: "admin.error",
      message: "admin state failed",
      category: "unknown",
      scope: "adminState",
      clearsState: false,
    }
    expect(shouldSetAdminStateErrorForError(adminStateError)).toBe(true)
    expect(shouldSetModelListErrorForError(adminStateError)).toBe(true)

    const staleError = {
      type: "admin.error",
      message: "stale state",
      category: "unknown",
      clearsState: true,
    }
    expect(shouldSetAdminStateErrorForError(staleError)).toBe(true)
    expect(shouldSetModelListErrorForError(staleError)).toBe(true)
  })
})
