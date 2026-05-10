/**
 * 服务器状态上下文。
 *
 * 复刻 Kilocode 的 ServerProvider 模式：
 * - 监听 Extension Host 发送的 `ready` 消息
 * - 管理"连接状态"信号
 * - 提供工作目录等元信息
 *
 * 在 Kilocode 真实架构中，这一层连接的是 CLI Backend；
 * 在此脚手架中是模拟实现，用于演示数据流。
 */

import { createContext, useContext, createSignal, onMount, onCleanup, ParentComponent } from "solid-js"
import { useVSCode, type ExtensionMessage } from "./vscode"
import { setLocale, resolveLocale, t } from "../i18n"

// ─────────────────────────────────────────────────────────────
// 类型定义
// ─────────────────────────────────────────────────────────────

interface ServerContextValue {
  /** 是否已连接（收到 ready 消息） */
  connected: () => boolean
  /** 工作区目录路径 */
  workspaceDirectory: () => string | undefined
  /** 插件版本 */
  extensionVersion: () => string | undefined
  connectionState: () => Record<string, unknown>
  connectionSaveResult: () => Record<string, unknown> | undefined
  adminState: () => Record<string, unknown>
  adminStateUpdatedAt: () => string | undefined
  adminError: () => string | undefined
  actionResult: () => Record<string, unknown> | undefined
  serverSettingsState: () => Record<string, unknown> | undefined
  serverSettingsError: () => string | undefined
  backendFeatures: () => Record<string, unknown>
  authUsersState: () => Record<string, unknown> | undefined
  authDevicesState: () => Record<string, unknown> | undefined
  authAuditState: () => Record<string, unknown> | undefined
  authActionResult: () => Record<string, unknown> | undefined
  authError: () => string | undefined
  toolchainState: () => Record<string, unknown> | undefined
  toolchainActionResult: () => Record<string, unknown> | undefined
  toolchainError: () => string | undefined
  toolchainIngestState: () => Record<string, unknown>
  environmentManifest: () => Record<string, unknown> | undefined
  environmentSnapshot: () => Record<string, unknown>
  environmentError: () => string | undefined
  /** 主执行器类型（位置 + 引擎） */
  executorType: () => { location: string; engine: string }
}

const ServerContext = createContext<ServerContextValue>()

function ingestLogs(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
    : []
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {}
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : ""
}

function authErrorCode(payload: Record<string, unknown>): string {
  const direct = stringValue(payload.code) || stringValue(payload.error)
  if (direct) return direct
  const body = objectValue(payload.body)
  const nested = stringValue(body.error) || stringValue(body.code)
  if (nested) return nested
  const message = stringValue(payload.message)
  const match = message.match(/^\d{3}\s+([a-z0-9_:-]+)/i)
  return match?.[1] || ""
}

function authErrorMessage(payload: Record<string, unknown>): string | undefined {
  const code = authErrorCode(payload)
  if (code) {
    const key = `auth.error.${code}`
    const localized = t(key)
    if (localized !== key) return localized
  }
  const raw = stringValue(payload.message)
  if (!raw) return t("auth.error.generic")
  return t("auth.error.genericWithMessage", { message: raw })
}

// ─────────────────────────────────────────────────────────────
// Provider 实现
// ─────────────────────────────────────────────────────────────

export const ServerProvider: ParentComponent = (props) => {
  const vscode = useVSCode()

  const [connected, setConnected] = createSignal(false)
  const [workspaceDirectory, setWorkspaceDirectory] = createSignal<string | undefined>()
  const [extensionVersion, setExtensionVersion] = createSignal<string | undefined>()
  const [connectionState, setConnectionState] = createSignal<Record<string, unknown>>({})
  const [connectionSaveResult, setConnectionSaveResult] = createSignal<Record<string, unknown> | undefined>()
  const [adminState, setAdminState] = createSignal<Record<string, unknown>>({})
  const [adminStateUpdatedAt, setAdminStateUpdatedAt] = createSignal<string | undefined>()
  const [adminError, setAdminError] = createSignal<string | undefined>()
  const [actionResult, setActionResult] = createSignal<Record<string, unknown> | undefined>()
  const [serverSettingsState, setServerSettingsState] = createSignal<Record<string, unknown> | undefined>()
  const [serverSettingsError, setServerSettingsError] = createSignal<string | undefined>()
  const [backendFeatures, setBackendFeatures] = createSignal<Record<string, unknown>>({})
  const [authUsersState, setAuthUsersState] = createSignal<Record<string, unknown> | undefined>()
  const [authDevicesState, setAuthDevicesState] = createSignal<Record<string, unknown> | undefined>()
  const [authAuditState, setAuthAuditState] = createSignal<Record<string, unknown> | undefined>()
  const [authActionResult, setAuthActionResult] = createSignal<Record<string, unknown> | undefined>()
  const [authErrorPayload, setAuthErrorPayload] = createSignal<Record<string, unknown> | undefined>()
  const [toolchainState, setToolchainState] = createSignal<Record<string, unknown> | undefined>()
  const [toolchainActionResult, setToolchainActionResult] = createSignal<Record<string, unknown> | undefined>()
  const [toolchainError, setToolchainError] = createSignal<string | undefined>()
  const [toolchainIngestState, setToolchainIngestState] = createSignal<Record<string, unknown>>({
    running: false,
    status: "idle",
    logs: [],
  })
  const [environmentManifest, setEnvironmentManifest] = createSignal<Record<string, unknown> | undefined>()
  const [environmentSnapshot, setEnvironmentSnapshot] = createSignal<Record<string, unknown>>({})
  const [environmentError, setEnvironmentError] = createSignal<string | undefined>()
  const [executorType, setExecutorType] = createSignal<{ location: string; engine: string }>({
    location: "remote",
    engine: "labrastro",
  })

  onMount(() => {
    const unsubscribe = vscode.onMessage((msg: ExtensionMessage) => {
      // 监听 Extension Host 的 ready 信号
      if (msg.type === "ready") {
        setConnected(true)
        setWorkspaceDirectory(msg.workspaceDirectory as string | undefined)
        setExtensionVersion(msg.extensionVersion as string | undefined)
        console.log("[labrastro startup]", {
          name: "ready-received",
          elapsedMs: Math.round(performance.now()),
        })
        console.log("[labrastro] 已连接到 Extension Host", msg)
      }
      if (msg.type === "connection.state" && typeof msg.payload === "object" && msg.payload) {
        setConnectionState(msg.payload as Record<string, unknown>)
      }
      if (msg.type === "connection.result" && typeof msg.payload === "object" && msg.payload) {
        const payload = msg.payload as Record<string, unknown>
        setConnectionSaveResult(payload)
        setConnectionState(payload)
      }
      if (msg.type === "admin.state" && typeof msg.payload === "object" && msg.payload) {
        setAdminState(msg.payload as Record<string, unknown>)
        setAdminStateUpdatedAt(new Date().toLocaleString())
        setAdminError(undefined)
      }
      if (msg.type === "admin.error") {
        setAdminError(typeof msg.message === "string" ? msg.message : "Admin request failed")
        setActionResult(undefined)
      }
      if (msg.type === "admin.actionResult" && typeof msg.payload === "object" && msg.payload) {
        setActionResult(msg.payload as Record<string, unknown>)
        setAdminError(undefined)
      }
      if (msg.type === "serverSettings.state" && typeof msg.payload === "object" && msg.payload) {
        setServerSettingsState(msg.payload as Record<string, unknown>)
        setServerSettingsError(undefined)
      }
      if (msg.type === "serverSettings.error") {
        setServerSettingsError(typeof msg.message === "string" ? msg.message : "Server settings request failed")
      }
      if (msg.type === "backend.features" && typeof msg.payload === "object" && msg.payload) {
        setBackendFeatures(msg.payload as Record<string, unknown>)
      }
      if (msg.type === "auth.users" && typeof msg.payload === "object" && msg.payload) {
        setAuthUsersState(msg.payload as Record<string, unknown>)
        setAuthErrorPayload(undefined)
      }
      if (msg.type === "auth.devices" && typeof msg.payload === "object" && msg.payload) {
        setAuthDevicesState(msg.payload as Record<string, unknown>)
        setAuthErrorPayload(undefined)
      }
      if (msg.type === "auth.audit" && typeof msg.payload === "object" && msg.payload) {
        setAuthAuditState(msg.payload as Record<string, unknown>)
        setAuthErrorPayload(undefined)
      }
      if (msg.type === "auth.actionResult" && typeof msg.payload === "object" && msg.payload) {
        setAuthActionResult(msg.payload as Record<string, unknown>)
        setAuthErrorPayload(undefined)
      }
      if (msg.type === "auth.error") {
        const payload = objectValue(msg.payload)
        setAuthErrorPayload(Object.keys(payload).length > 0 ? payload : { message: stringValue(msg.message) })
      }
      if (msg.type === "toolchain.state" && typeof msg.payload === "object" && msg.payload) {
        setToolchainState(msg.payload as Record<string, unknown>)
        setToolchainError(undefined)
      }
      if (msg.type === "toolchain.actionResult" && typeof msg.payload === "object" && msg.payload) {
        setToolchainActionResult(msg.payload as Record<string, unknown>)
        setToolchainError(undefined)
      }
      if (msg.type === "toolchain.error") {
        setToolchainError(typeof msg.message === "string" ? msg.message : "Toolchain request failed")
      }
      if (msg.type === "toolchain.ingest.started" && typeof msg.payload === "object" && msg.payload) {
        setToolchainIngestState({
          ...(msg.payload as Record<string, unknown>),
          running: true,
          logs: [],
        })
        setToolchainError(undefined)
      }
      if (msg.type === "toolchain.ingest.event" && typeof msg.payload === "object" && msg.payload) {
        setToolchainIngestState((current) => ({
          ...current,
          running: true,
          logs: [
            ...ingestLogs(current.logs),
            msg.payload as Record<string, unknown>,
          ].slice(-80),
        }))
      }
      if (msg.type === "toolchain.ingest.result" && typeof msg.payload === "object" && msg.payload) {
        setToolchainIngestState((current) => ({
          ...current,
          ...(msg.payload as Record<string, unknown>),
          running: false,
          logs: ingestLogs(current.logs),
        }))
        setToolchainError(undefined)
      }
      if (msg.type === "toolchain.ingest.error") {
        const payload = typeof msg.payload === "object" && msg.payload
          ? msg.payload as Record<string, unknown>
          : { message: typeof msg.message === "string" ? msg.message : "Toolchain ingest failed" }
        setToolchainIngestState((current) => ({
          ...current,
          ...payload,
          running: false,
          error: typeof payload.message === "string" ? payload.message : "Toolchain ingest failed",
          logs: [
            ...ingestLogs(current.logs),
            {
              level: "error",
              message: typeof payload.message === "string" ? payload.message : "Toolchain ingest failed",
              createdAt: new Date().toISOString(),
            },
          ].slice(-80),
        }))
        setToolchainError(typeof payload.message === "string" ? payload.message : "Toolchain ingest failed")
      }
      if (msg.type === "environment.manifest" && typeof msg.payload === "object" && msg.payload) {
        setEnvironmentManifest(msg.payload as Record<string, unknown>)
        setEnvironmentError(undefined)
      }
      if (msg.type === "environment.snapshot" && typeof msg.payload === "object" && msg.payload) {
        setEnvironmentSnapshot(msg.payload as Record<string, unknown>)
        setEnvironmentError(typeof (msg.payload as Record<string, unknown>).error === "string"
          ? (msg.payload as Record<string, unknown>).error as string
          : undefined)
      }
      if (msg.type === "environment.run.started") {
        setEnvironmentError(undefined)
      }
      if (msg.type === "environment.run.error") {
        setEnvironmentError(typeof msg.message === "string" ? msg.message : "Environment run failed")
      }
      if (msg.type === "startup.metric") {
        console.log("[labrastro startup]", msg.payload)
      }
      if (msg.type === "executorType.state" && typeof msg.payload === "object" && msg.payload) {
        setExecutorType(msg.payload as { location: string; engine: string })
      }
      if (msg.type === "locale.state" && typeof msg.locale === "string") {
        setLocale(resolveLocale(msg.locale))
      }
    })

    onCleanup(unsubscribe)
  })

  const value: ServerContextValue = {
    connected,
    workspaceDirectory,
    extensionVersion,
    connectionState,
    connectionSaveResult,
    adminState,
    adminStateUpdatedAt,
    adminError,
    actionResult,
    serverSettingsState,
    serverSettingsError,
    backendFeatures,
    authUsersState,
    authDevicesState,
    authAuditState,
    authActionResult,
    authError: () => {
      const payload = authErrorPayload()
      return payload ? authErrorMessage(payload) : undefined
    },
    toolchainState,
    toolchainActionResult,
    toolchainError,
    toolchainIngestState,
    environmentManifest,
    environmentSnapshot,
    environmentError,
    executorType,
  }

  return <ServerContext.Provider value={value}>{props.children}</ServerContext.Provider>
}

export function useServer(): ServerContextValue {
  const context = useContext(ServerContext)
  if (!context) {
    throw new Error("useServer 必须在 ServerProvider 内部使用")
  }
  return context
}
