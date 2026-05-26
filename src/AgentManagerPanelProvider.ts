import * as vscode from "vscode"
import { buildWebviewHtml } from "./webview-html"
import { LabrastroController } from "./LabrastroController"
import { isWebviewToHostMessage } from "./protocol/messages"

export interface AgentManagerOpenOptions {
  nodeId?: string
  branchId?: string
  sessionId?: string
  intent?: "inspect" | "fork" | "rollback" | "delegated_run"
}

const AGENT_MANAGER_VIEW_TYPE = "labrastro.agentManagerPanel"
const AGENT_MANAGER_TITLE = "Labrastro Trace Preview"

/**
 * AgentManager 单例面板。
 *
 * 设计目标：
 * 1. 编辑器区域始终只打开一个 AgentManager 标签页
 * 2. 重复打开时只更新焦点参数并聚焦已有面板
 * 3. 继续复用同一份 webview 前端 bundle，通过 navigate 消息切换到 agentManager 视图
 */
export class AgentManagerPanelProvider implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined
  private pendingContext: AgentManagerOpenOptions = {}

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly labrastro: LabrastroController
  ) {}

  openPanel(options: AgentManagerOpenOptions = {}): void {
    this.pendingContext = {
      nodeId: options.nodeId,
      branchId: options.branchId,
      sessionId: options.sessionId,
      intent: options.intent,
    }

    if (this.panel) {
      try {
        this.panel.webview.postMessage({
          type: "navigate",
          view: "agentManager",
          ...this.pendingContext,
        })
        this.panel.reveal(vscode.ViewColumn.One)
        console.log("[labrastro] Trace Preview 面板已存在，聚焦")
        return
      } catch {
        console.log("[labrastro] Trace Preview 面板已失效，重新创建")
        this.panel = undefined
      }
    }

    const panel = vscode.window.createWebviewPanel(
      AGENT_MANAGER_VIEW_TYPE,
      AGENT_MANAGER_TITLE,
      vscode.ViewColumn.One,
      {
        retainContextWhenHidden: true,
      }
    )

    this.wirePanel(panel)
  }

  deserializePanel(panel: vscode.WebviewPanel): void {
    if (panel.viewType !== AGENT_MANAGER_VIEW_TYPE) {
      panel.dispose()
      return
    }
    this.wirePanel(panel)
  }

  private wirePanel(panel: vscode.WebviewPanel): void {
    panel.iconPath = {
      light: vscode.Uri.joinPath(this.extensionUri, "assets", "icons", "labrastro-light.svg"),
      dark: vscode.Uri.joinPath(this.extensionUri, "assets", "icons", "labrastro-dark.svg"),
    }

    panel.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    }
    panel.webview.html = this.getHtml(panel.webview)
    let disposed = false
    const postToWebview = (payload: Record<string, unknown>) => {
      if (disposed) return
      try {
        const sent = panel.webview.postMessage(payload)
        void sent.then(undefined, () => false)
        return sent
      } catch {
        return
      }
    }
    const webviewPostDisposable = this.labrastro.registerWebviewPost(postToWebview, "agentManager")

    const messageDisposable = panel.webview.onDidReceiveMessage(async (msg) => {
      try {
        if (!isWebviewToHostMessage(msg)) {
          console.log("[labrastro] ignored unknown agent manager message", msg)
          return
        }
        if (msg.type === "closePanel") {
          panel.dispose()
          return
        }
        if (msg.type === "webviewReady") {
          setTimeout(() => {
            void (async () => {
              if (disposed) return
              await this.labrastro.postInitialState(postToWebview)
              postToWebview({
                type: "navigate",
                view: "agentManager",
                ...this.pendingContext,
              })
            })().catch((error) => {
              if (!disposed) {
                console.warn("[labrastro] agent manager postInitialState failed", error)
              }
            })
          }, 50)
          return
        }
        if (msg.type === "showInfo" && typeof msg.text === "string") {
          vscode.window.showInformationMessage(msg.text)
          return
        }
        if (msg.type === "openExternal" && typeof msg.url === "string") {
          vscode.env.openExternal(vscode.Uri.parse(msg.url))
          return
        }
        await this.labrastro.handleMessage(msg, postToWebview)
      } catch (error) {
        console.warn("[labrastro] agent manager webview message failed", error)
      }
    })

    this.panel = panel

    panel.onDidDispose(() => {
      disposed = true
      messageDisposable.dispose()
      webviewPostDisposable.dispose()
      if (this.panel === panel) {
        this.panel = undefined
      }
      console.log("[labrastro] Trace Preview 面板已关闭")
    })
  }

  private getHtml(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "dist", "webview.js")
    )
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "dist", "webview.css")
    )

    return buildWebviewHtml(webview, {
      scriptUri,
      styleUri,
      title: "Labrastro Trace Preview",
    })
  }

  dispose(): void {
    this.panel?.dispose()
    this.panel = undefined
  }
}
