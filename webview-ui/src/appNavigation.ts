import type { ExtensionMessage } from "./context/vscode"
import type { TraceNavigationIntent } from "./types/trace"

export type ViewType = "chat" | "settings" | "about" | "agentManager" | "taskflow"

const VALID_VIEWS = new Set<string>(["chat", "settings", "about", "agentManager", "taskflow"])

export interface NavigateViewState {
  currentView: ViewType
  panelNodeId: string | undefined
  panelBranchId: string | undefined
  panelSessionId: string | undefined
  panelTaskflowId: string | undefined
  panelIntent: TraceNavigationIntent | undefined
  settingsTab: string | undefined
  isPanelMode: boolean
}

export function isViewType(value: unknown): value is ViewType {
  return typeof value === "string" && VALID_VIEWS.has(value)
}

export function resolveNavigateViewState(msg: ExtensionMessage): NavigateViewState | undefined {
  if (msg.type !== "navigate" || !isViewType(msg.view)) return undefined
  return {
    currentView: msg.view,
    panelNodeId: typeof msg.nodeId === "string" ? msg.nodeId : undefined,
    panelBranchId: typeof msg.branchId === "string" ? msg.branchId : undefined,
    panelSessionId: typeof msg.sessionId === "string" ? msg.sessionId : undefined,
    panelTaskflowId: typeof msg.taskflowId === "string" ? msg.taskflowId : undefined,
    panelIntent: typeof msg.intent === "string" ? msg.intent as TraceNavigationIntent : undefined,
    settingsTab: msg.view === "settings" && typeof msg.tab === "string" ? msg.tab : undefined,
    isPanelMode: msg.view !== "chat",
  }
}
