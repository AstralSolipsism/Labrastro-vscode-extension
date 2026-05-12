/**
 * 主应用组件。
 *
 * 复刻 Kilocode App.tsx 的核心模式：
 * 1. Provider 树依次嵌套（VSCodeProvider → ServerProvider → UI）
 * 2. 消息驱动视图切换（无 URL 路由）
 * 3. 侧边栏模式 vs 面板模式 的自动感知
 *
 * 面板模式感知（Kilocode SettingsEditorProvider 的精髓）：
 * - 侧边栏中加载此同一份 webview.js 时，默认显示聊天页 + 导航栏
 * - 当 SettingsPanelProvider 在编辑器区域打开面板时，也加载同一份 webview.js，
 *   然后通过 `navigate` 消息告知前端当前是 "settings" 或 "about" 视图
 * - 前端据此切换模式：隐藏侧边栏导航栏、显示面板顶部返回按钮
 */

import { Component, createSignal, Switch, Match, onMount, onCleanup, Show, Suspense, lazy } from "solid-js"
import { TraceProvider, useTrace } from "./context/trace"
import { VSCodeProvider, useVSCode, type ExtensionMessage } from "./context/vscode"
import { ServerProvider } from "./context/server"
import type { TraceNavigationIntent } from "./types/trace"
import ChatView from "./components/ChatView"
import { IconButton } from "./components/common/IconButton"
import { t } from "./i18n"
import "./styles/main.css"

const SettingsView = lazy(() => import("./components/SettingsView"))
const AboutView = lazy(() => import("./components/AboutView"))
const AgentManagerView = lazy(() => import("./components/AgentManagerView"))
const TaskflowView = lazy(() => import("./components/TaskflowView"))

// ─────────────────────────────────────────────────────────────
// 视图类型
// ─────────────────────────────────────────────────────────────

type ViewType = "chat" | "settings" | "about" | "agentManager" | "taskflow"
const VALID_VIEWS = new Set<string>(["chat", "settings", "about", "agentManager", "taskflow"])

interface EnvironmentRunRequest {
  id: string
  mode: "check" | "configure"
  executionMode: "serial" | "combined"
  items: Array<{ id: string; name: string; kind: "cli" | "mcp" | "skill" }>
}

// ─────────────────────────────────────────────────────────────
// 内部内容组件（在 Context Provider 树内部使用）
// ─────────────────────────────────────────────────────────────

const AppContent: Component = () => {
  const vscode = useVSCode()
  const trace = useTrace()
  const [currentView, setCurrentView] = createSignal<ViewType>("chat")
  const [panelNodeId, setPanelNodeId] = createSignal<string | undefined>(undefined)
  const [panelBranchId, setPanelBranchId] = createSignal<string | undefined>(undefined)
  const [panelSessionId, setPanelSessionId] = createSignal<string | undefined>(undefined)
  const [panelTaskflowId, setPanelTaskflowId] = createSignal<string | undefined>(undefined)
  const [panelIntent, setPanelIntent] = createSignal<TraceNavigationIntent | undefined>(undefined)
  const [settingsTab, setSettingsTab] = createSignal<string | undefined>(undefined)
  const [sessionHistoryOpen, setSessionHistoryOpen] = createSignal(false)
  const [pendingEnvironmentRun, setPendingEnvironmentRun] = createSignal<EnvironmentRunRequest | undefined>()

  /**
   * 面板模式标识。
   *
   * 当收到来自 SettingsPanelProvider 的 navigate 消息且目标视图
   * 不是 "chat" 时，说明此 webview 实例是在编辑器面板中运行的，
   * 而非侧边栏中。此时应隐藏侧边栏导航栏，显示面板顶部返回按钮。
   */
  const [isPanelMode, setIsPanelMode] = createSignal(false)

  onMount(() => {
    const unsubscribe = vscode.onMessage((msg: ExtensionMessage) => {
      // ① 视图导航（来自 SettingsPanelProvider 或侧边栏命令）
      if (msg.type === "navigate" && typeof msg.view === "string" && VALID_VIEWS.has(msg.view)) {
        console.log("[labrastro] 导航到视图:", msg.view, msg.tab ? `tab=${msg.tab}` : "")
        setCurrentView(msg.view as ViewType)
        setPanelNodeId(typeof msg.nodeId === "string" ? msg.nodeId : undefined)
        setPanelBranchId(typeof msg.branchId === "string" ? msg.branchId : undefined)
        setPanelSessionId(typeof msg.sessionId === "string" ? msg.sessionId : undefined)
        setPanelTaskflowId(typeof msg.taskflowId === "string" ? msg.taskflowId : undefined)
        setPanelIntent(typeof msg.intent === "string" ? msg.intent as TraceNavigationIntent : undefined)
        setSettingsTab(msg.view === "settings" && typeof msg.tab === "string" ? msg.tab : undefined)

        // 如果导航到 settings 或 about，说明是面板模式
        setIsPanelMode(msg.view !== "chat")
      }

      // ② 动作触发（侧边栏按钮）
      if (msg.type === "action" && msg.action === "newTask") {
        setCurrentView("chat")
        setIsPanelMode(false)
        setSessionHistoryOpen(false)
        trace.clearSession()
      }

      if (msg.type === "action" && msg.action === "openSessionHistory") {
        setCurrentView("chat")
        setIsPanelMode(false)
        setSessionHistoryOpen(true)
      }
    })

    onCleanup(unsubscribe)
  })

  /**
   * 关闭面板 — 通知 Extension Host 关闭当前 WebviewPanel。
   * 只在面板模式下显示此按钮。
   */
  const handleClosePanel = () => {
    vscode.postMessage({ type: "closePanel" })
  }

  const handleEnvironmentRun = (request: EnvironmentRunRequest) => {
    setCurrentView("chat")
    setIsPanelMode(false)
    setSessionHistoryOpen(false)
    setPendingEnvironmentRun(request)
  }

  return (
    <>
      {/* 面板模式：显示返回按钮顶栏（由 SettingsPanelProvider 驱动） */}
      <Show when={isPanelMode()}>
        <div class="panel-header">
          <IconButton icon="close" title={t("panel.close")} onClick={handleClosePanel} />
          <span class="panel-title">
            {
              currentView() === "settings"
                ? t("panel.settings")
                : currentView() === "about"
                  ? t("panel.about")
                  : currentView() === "taskflow"
                    ? "Taskflow"
                    : t("panel.tracePreview")
            }
          </span>
        </div>
      </Show>

      {/*
        视图区域。
        侧边栏模式下，设置/关于 通过 package.json 的 view/title 图标按钮触发，
        Extension Host 发送 { type: "navigate", view: "settings" } 消息切换视图。
        webview 内部不再放置导航栏，避免与标题栏图标重复。
      */}

      {/* 视图区域 */}
      <Switch fallback={<ChatView />}>
        <Match when={currentView() === "chat"}>
          <ChatView
            historyOpen={sessionHistoryOpen()}
            onHistoryClose={() => setSessionHistoryOpen(false)}
            pendingEnvironmentRun={pendingEnvironmentRun()}
            onEnvironmentRunConsumed={(id) => {
              if (pendingEnvironmentRun()?.id === id) {
                setPendingEnvironmentRun(undefined)
              }
            }}
          />
        </Match>
        <Match when={currentView() === "settings"}>
          <Suspense fallback={null}>
            <SettingsView
              targetTab={settingsTab()}
              onEnvironmentRun={handleEnvironmentRun}
            />
          </Suspense>
        </Match>
        <Match when={currentView() === "about"}>
          <Suspense fallback={null}>
            <AboutView />
          </Suspense>
        </Match>
        <Match when={currentView() === "agentManager"}>
          <Suspense fallback={null}>
            <AgentManagerView
              nodeId={panelNodeId()}
              branchId={panelBranchId()}
              sessionId={panelSessionId()}
              intent={panelIntent()}
            />
          </Suspense>
        </Match>
        <Match when={currentView() === "taskflow"}>
          <Suspense fallback={null}>
            <TaskflowView taskflowId={panelTaskflowId()} />
          </Suspense>
        </Match>
      </Switch>
    </>
  )
}

// ─────────────────────────────────────────────────────────────
// 根组件 — Context Provider 嵌套树
// ─────────────────────────────────────────────────────────────

const App: Component = () => {
  return (
    <VSCodeProvider>
      <ServerProvider>
        <TraceProvider>
          <AppContent />
        </TraceProvider>
      </ServerProvider>
    </VSCodeProvider>
  )
}

export default App
