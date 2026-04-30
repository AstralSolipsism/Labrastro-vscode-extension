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
  adminState: () => Record<string, unknown>
  adminStateUpdatedAt: () => string | undefined
  adminError: () => string | undefined
  actionResult: () => Record<string, unknown> | undefined
  toolchainState: () => Record<string, unknown> | undefined
  toolchainActionResult: () => Record<string, unknown> | undefined
  toolchainError: () => string | undefined
  environmentManifest: () => Record<string, unknown> | undefined
  environmentSnapshot: () => Record<string, unknown>
  environmentError: () => string | undefined
}

const ServerContext = createContext<ServerContextValue>()

// ─────────────────────────────────────────────────────────────
// Provider 实现
// ─────────────────────────────────────────────────────────────

export const ServerProvider: ParentComponent = (props) => {
  const vscode = useVSCode()

  const [connected, setConnected] = createSignal(false)
  const [workspaceDirectory, setWorkspaceDirectory] = createSignal<string | undefined>()
  const [extensionVersion, setExtensionVersion] = createSignal<string | undefined>()
  const [connectionState, setConnectionState] = createSignal<Record<string, unknown>>({})
  const [adminState, setAdminState] = createSignal<Record<string, unknown>>({})
  const [adminStateUpdatedAt, setAdminStateUpdatedAt] = createSignal<string | undefined>()
  const [adminError, setAdminError] = createSignal<string | undefined>()
  const [actionResult, setActionResult] = createSignal<Record<string, unknown> | undefined>()
  const [toolchainState, setToolchainState] = createSignal<Record<string, unknown> | undefined>()
  const [toolchainActionResult, setToolchainActionResult] = createSignal<Record<string, unknown> | undefined>()
  const [toolchainError, setToolchainError] = createSignal<string | undefined>()
  const [environmentManifest, setEnvironmentManifest] = createSignal<Record<string, unknown> | undefined>()
  const [environmentSnapshot, setEnvironmentSnapshot] = createSignal<Record<string, unknown>>({})
  const [environmentError, setEnvironmentError] = createSignal<string | undefined>()

  onMount(() => {
    const unsubscribe = vscode.onMessage((msg: ExtensionMessage) => {
      // 监听 Extension Host 的 ready 信号
      if (msg.type === "ready") {
        setConnected(true)
        setWorkspaceDirectory(msg.workspaceDirectory as string | undefined)
        setExtensionVersion(msg.extensionVersion as string | undefined)
        console.log("[EZCode] 已连接到 Extension Host", msg)
      }
      if (msg.type === "connection.state" && typeof msg.payload === "object" && msg.payload) {
        setConnectionState(msg.payload as Record<string, unknown>)
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
    })

    onCleanup(unsubscribe)
  })

  const value: ServerContextValue = {
    connected,
    workspaceDirectory,
    extensionVersion,
    connectionState,
    adminState,
    adminStateUpdatedAt,
    adminError,
    actionResult,
    toolchainState,
    toolchainActionResult,
    toolchainError,
    environmentManifest,
    environmentSnapshot,
    environmentError,
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
