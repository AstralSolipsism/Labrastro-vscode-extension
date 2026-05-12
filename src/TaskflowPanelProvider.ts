import * as vscode from "vscode"
import { buildWebviewHtml } from "./webview-html"
import { LabrastroController } from "./LabrastroController"
import { isWebviewToHostMessage } from "./protocol/messages"

export interface TaskflowOpenOptions {
  taskflowId?: string
}

const TASKFLOW_VIEW_TYPE = "labrastro.taskflowPanel"
const TASKFLOW_TITLE = "Labrastro Taskflow"

export class TaskflowPanelProvider implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined
  private pendingContext: TaskflowOpenOptions = {}

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly labrastro: LabrastroController
  ) {}

  openPanel(options: TaskflowOpenOptions = {}): void {
    this.pendingContext = {
      taskflowId: options.taskflowId,
    }

    if (this.panel) {
      try {
        this.panel.webview.postMessage({
          type: "navigate",
          view: "taskflow",
          ...this.pendingContext,
        })
        this.panel.reveal(vscode.ViewColumn.One)
        console.log("[labrastro] Taskflow 面板已存在，聚焦")
        return
      } catch {
        console.log("[labrastro] Taskflow 面板已失效，重新创建")
        this.panel = undefined
      }
    }

    const panel = vscode.window.createWebviewPanel(
      TASKFLOW_VIEW_TYPE,
      TASKFLOW_TITLE,
      vscode.ViewColumn.One,
      {
        retainContextWhenHidden: true,
      }
    )

    this.wirePanel(panel)
  }

  deserializePanel(panel: vscode.WebviewPanel): void {
    if (panel.viewType !== TASKFLOW_VIEW_TYPE) {
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
    const webviewPostDisposable = this.labrastro.registerWebviewPost(postToWebview, "taskflow")

    const messageDisposable = panel.webview.onDidReceiveMessage(async (msg) => {
      try {
        if (!isWebviewToHostMessage(msg)) {
          console.log("[labrastro] ignored unknown taskflow message", msg)
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
                view: "taskflow",
                ...this.pendingContext,
              })
            })().catch((error) => {
              if (!disposed) {
                console.warn("[labrastro] taskflow postInitialState failed", error)
              }
            })
          }, 50)
          return
        }
        if (msg.type === "taskflow.focusChatInteraction") {
          this.labrastro.focusTaskflowChatInteraction({
            taskflowId: typeof msg.taskflowId === "string" ? msg.taskflowId : undefined,
            reason: typeof msg.reason === "string" ? msg.reason : undefined,
          })
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
        console.warn("[labrastro] taskflow webview message failed", error)
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
      console.log("[labrastro] Taskflow 面板已关闭")
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
      title: "Labrastro Taskflow",
    })
  }

  dispose(): void {
    this.panel?.dispose()
    this.panel = undefined
  }
}
