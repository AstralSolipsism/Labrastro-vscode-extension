import { describe, expect, it } from "vitest"
import {
  connectionStateFromRemoteSlice,
  environmentRunErrorMessageForGlobalState,
  environmentRunMessageTargetsGlobalState,
  remoteStateSliceData,
  remoteStateSliceError,
  shouldClearAdminForConnectionState,
  shouldClearAdminForError,
  shouldSetAdminStateErrorForError,
  shouldSetModelListErrorForError,
} from "./server-state"

describe("server context state guards", () => {
  it("reads remote state slice data without treating loading slices as empty data", () => {
    expect(remoteStateSliceData({ status: "loading", inFlight: true })).toBeUndefined()
    expect(remoteStateSliceData({ status: "revalidating", data: { providers: [{ id: "Zenmux" }] }, inFlight: true })).toEqual({
      providers: [{ id: "Zenmux" }],
    })
    expect(remoteStateSliceError({ status: "stale", data: { providers: [] }, error: "fetch failed" })).toBe("fetch failed")
  })

  it("maps stale connection slices without presenting the last ready state as current", () => {
    expect(connectionStateFromRemoteSlice({
      status: "stale",
      data: {
        status: "ready",
        authenticated: true,
        hostUrl: "http://127.0.0.1:8765",
        role: "superadmin",
      },
      error: "fetch failed",
    })).toEqual({
      status: "stale",
      authenticated: true,
      hostUrl: "http://127.0.0.1:8765",
      role: "superadmin",
      lastKnownStatus: "ready",
      message: "fetch failed",
    })
  })

  it("keeps revalidating connection data usable without clearing admin state", () => {
    expect(connectionStateFromRemoteSlice({
      status: "revalidating",
      data: {
        status: "ready",
        authenticated: true,
        hostUrl: "http://127.0.0.1:8765",
      },
      inFlight: true,
    })).toEqual({
      status: "ready",
      authenticated: true,
      hostUrl: "http://127.0.0.1:8765",
    })
    expect(shouldClearAdminForConnectionState({
      status: "ready",
      authenticated: true,
      hostUrl: "http://127.0.0.1:8765",
    })).toBe(false)
  })

  it("clears admin data only for explicit unauthenticated connection states", () => {
    expect(shouldClearAdminForConnectionState({ status: "ready", authenticated: true })).toBe(false)
    expect(shouldClearAdminForConnectionState({ status: "ready", authenticated: false })).toBe(true)
    expect(shouldClearAdminForConnectionState({ status: "login-required" })).toBe(true)
    expect(shouldClearAdminForConnectionState({ status: "checking" })).toBe(false)
    expect(shouldClearAdminForConnectionState({ status: "revalidating" })).toBe(false)
  })

  it("clears stale admin data for auth errors and admin-state refresh failures", () => {
    expect(shouldClearAdminForError({ type: "admin.error", message: "401 unauthorized", category: "unauthenticated" })).toBe(true)
    expect(shouldClearAdminForError({ type: "admin.error", message: "403 forbidden", category: "forbidden" })).toBe(true)
    expect(shouldClearAdminForError({ type: "admin.error", message: "503 unavailable", category: "unavailable", scope: "adminState" })).toBe(true)
    expect(shouldClearAdminForError({ type: "admin.error", message: "fetch failed", category: "network", scope: "adminState" })).toBe(true)
    expect(shouldClearAdminForError({ type: "admin.error", message: "provider save failed", category: "unavailable", scope: "adminAction", clearsState: false })).toBe(false)
    expect(shouldClearAdminForError({ type: "admin.error", message: "provider save failed", category: "unavailable", scope: "adminAction", stale: true })).toBe(false)
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

  it("keeps request-scoped environment run errors out of global environment state", () => {
    expect(environmentRunErrorMessageForGlobalState({
      type: "environment.run.error",
      requestId: "env-run-1",
      message: "environment run failed",
    })).toBeUndefined()
    expect(environmentRunErrorMessageForGlobalState({
      type: "environment.run.error",
      request_id: "env-run-1",
      message: "environment run failed",
    })).toBeUndefined()
    expect(environmentRunErrorMessageForGlobalState({
      type: "environment.run.error",
      message: "manifest refresh failed",
    })).toBe("manifest refresh failed")
  })

  it("keeps request-scoped environment run lifecycle messages out of global environment state", () => {
    expect(environmentRunMessageTargetsGlobalState({
      type: "environment.run.started",
      requestId: "env-run-1",
    })).toBe(false)
    expect(environmentRunMessageTargetsGlobalState({
      type: "environment.run.started",
      request_id: "env-run-1",
    })).toBe(false)
    expect(environmentRunMessageTargetsGlobalState({
      type: "environment.run.started",
    })).toBe(true)
    expect(environmentRunMessageTargetsGlobalState({
      type: "chat.command.done",
    })).toBe(false)
  })
})
