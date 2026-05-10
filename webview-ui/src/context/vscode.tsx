/**
 * VS Code API 上下文提供器。
 *
 * 封装 `acquireVsCodeApi()` 的调用，提供类型安全的消息收发接口。
 *
 * 关键约束：
 * - `acquireVsCodeApi()` 是 VS Code 注入到 Webview 全局的函数
 * - 只能调用一次！后续调用会抛出错误
 * - 必须在应用最顶层调用并缓存返回值
 * - 它提供 postMessage / getState / setState 三个方法
 */

import { createContext, useContext, onMount, onCleanup, ParentComponent } from "solid-js"
import {
  isHostToWebviewMessage,
  type HostToWebviewMessage,
  type WebviewToHostMessage,
} from "../protocol/messages"

// ─────────────────────────────────────────────────────────────
// VS Code API 类型定义
// ─────────────────────────────────────────────────────────────

/** VS Code 注入的 Webview API */
interface VSCodeAPI {
  /** 向 Extension Host 发送消息 */
  postMessage(message: unknown): void
  /** 获取持久化状态 */
  getState(): unknown
  /** 设置持久化状态（跨 Webview 隐藏/显示保留） */
  setState(state: unknown): void
}

/** 全局声明 — VS Code 注入的函数 */
declare function acquireVsCodeApi(): VSCodeAPI

// ─────────────────────────────────────────────────────────────
// API 获取（单例缓存）
// ─────────────────────────────────────────────────────────────

let cachedApi: VSCodeAPI | undefined

function getVSCodeAPI(): VSCodeAPI {
  if (!cachedApi) {
    if (typeof acquireVsCodeApi === "function") {
      cachedApi = acquireVsCodeApi()
    } else {
      // 在 VS Code 外运行时使用 Mock（用于开发调试）
      console.warn("[labrastro] 非 VS Code 环境，使用 Mock API")
      cachedApi = {
        postMessage: (msg) => console.log("[Mock] postMessage:", msg),
        getState: () => undefined,
        setState: () => {},
      }
    }
  }
  return cachedApi
}

// ─────────────────────────────────────────────────────────────
// SolidJS Context
// ─────────────────────────────────────────────────────────────

/** 来自 Extension Host 的消息（即 Extension → Webview 方向） */
export type ExtensionMessage = HostToWebviewMessage

/** Context 提供的值 */
interface VSCodeContextValue {
  /** 向 Extension Host 发送消息（Webview → Extension 方向） */
  postMessage: (message: WebviewToHostMessage) => void
  /**
   * 注册来自 Extension Host 的消息监听器。
   * 返回取消注册的函数。
   */
  onMessage: (handler: (message: ExtensionMessage) => void) => () => void
  /** 获取 Webview 持久化状态 */
  getState: <T>() => T | undefined
  /** 设置 Webview 持久化状态 */
  setState: <T>(state: T) => void
}

const VSCodeContext = createContext<VSCodeContextValue>()

/**
 * VSCodeProvider — 消息桥接上下文。
 *
 * 在应用启动时：
 * 1. 获取 VS Code API（调用 acquireVsCodeApi）
 * 2. 监听 `window.message` 事件（Extension Host → Webview）
 * 3. 发送 `webviewReady` 信号通知 Extension Host
 */
export const VSCodeProvider: ParentComponent = (props) => {
  const api = getVSCodeAPI()
  const handlers = new Set<(message: ExtensionMessage) => void>()

  // 监听来自 Extension Host 的消息
  const messageListener = (event: MessageEvent) => {
    if (!isHostToWebviewMessage(event.data)) {
      console.warn("[labrastro] ignored unknown host message", event.data)
      return
    }
    const message = event.data
    handlers.forEach((handler) => handler(message))
  }

  onMount(() => {
    window.addEventListener("message", messageListener)

    // 通知 Extension Host：Webview 已就绪
    // 这是 Kilocode 消息协议的核心握手步骤
    api.postMessage({ type: "webviewReady" })
  })

  onCleanup(() => {
    window.removeEventListener("message", messageListener)
    handlers.clear()
  })

  const value: VSCodeContextValue = {
    postMessage: (message) => api.postMessage(message),
    onMessage: (handler) => {
      handlers.add(handler)
      return () => handlers.delete(handler)
    },
    getState: <T,>() => api.getState() as T | undefined,
    setState: <T,>(state: T) => api.setState(state),
  }

  return <VSCodeContext.Provider value={value}>{props.children}</VSCodeContext.Provider>
}

/**
 * 获取 VS Code 消息桥上下文。
 * 必须在 VSCodeProvider 内部使用。
 */
export function useVSCode(): VSCodeContextValue {
  const context = useContext(VSCodeContext)
  if (!context) {
    throw new Error("useVSCode 必须在 VSCodeProvider 内部使用")
  }
  return context
}
