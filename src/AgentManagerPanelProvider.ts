import * as vscode from "vscode"
import { buildWebviewHtml } from "./webview-html"

export interface AgentManagerOpenOptions {
  nodeId?: string
  branchId?: string
  sessionId?: string
  intent?: "inspect" | "fork" | "rollback" | "subagent"
}

const AGENT_MANAGER_VIEW_TYPE = "dogcode.agentManagerPanel"
const AGENT_MANAGER_TITLE = "dogcode Trace Preview"

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

  constructor(private readonly extensionUri: vscode.Uri) {}

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
        console.log("[dogcode] Trace Preview 面板已存在，聚焦")
        return
      } catch {
        console.log("[dogcode] Trace Preview 面板已失效，重新创建")
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
      light: vscode.Uri.joinPath(this.extensionUri, "assets", "icons", "dogcode-light.svg"),
      dark: vscode.Uri.joinPath(this.extensionUri, "assets", "icons", "dogcode-dark.svg"),
    }

    panel.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    }
    panel.webview.html = this.getHtml(panel.webview)

    const closePanelDisposable = panel.webview.onDidReceiveMessage((msg) => {
      if (msg.type === "closePanel") {
        panel.dispose()
      }
    })

    const readyDisposable = panel.webview.onDidReceiveMessage((msg) => {
      if (msg.type === "webviewReady") {
        setTimeout(() => {
          panel.webview.postMessage({
            type: "navigate",
            view: "agentManager",
            ...this.pendingContext,
          })
        }, 50)
      }
    })

    const genericDisposable = panel.webview.onDidReceiveMessage((msg) => {
      if (msg.type === "showInfo" && typeof msg.text === "string") {
        vscode.window.showInformationMessage(msg.text)
      }
      if (msg.type === "openExternal" && typeof msg.url === "string") {
        vscode.env.openExternal(vscode.Uri.parse(msg.url))
      }
    })

    this.panel = panel

    panel.onDidDispose(() => {
      closePanelDisposable.dispose()
      readyDisposable.dispose()
      genericDisposable.dispose()
      if (this.panel === panel) {
        this.panel = undefined
      }
      console.log("[dogcode] Trace Preview 面板已关闭")
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
      title: "dogcode Trace Preview",
    })
  }

  dispose(): void {
    this.panel?.dispose()
    this.panel = undefined
  }
}
