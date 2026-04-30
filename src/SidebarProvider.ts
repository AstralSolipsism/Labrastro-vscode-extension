import * as vscode from "vscode"
import { buildWebviewHtml } from "./webview-html"
import { EzcodeController } from "./EzcodeController"

/**
 * 侧边栏 Webview 提供器。
 *
 * 实现 `vscode.WebviewViewProvider` 接口，当用户点击 Activity Bar
 * 上的 EZCode 图标时，VS Code 会调用 `resolveWebviewView` 来
 * 创建侧边栏中的 Webview 内容。
 *
 * 这是 Kilocode 中 `KiloProvider` 的简化复刻版本，
 * 演示了以下核心模式：
 * - WebviewView 的注册和生命周期管理
 * - HTML 生成与 CSP 注入
 * - 双向消息通信（postMessage / onDidReceiveMessage）
 * - webviewReady 握手协议
 */
export class SidebarProvider implements vscode.WebviewViewProvider {
  /** 必须与 package.json 中 views 的 id 完全一致 */
  public static readonly viewType = "solipsism-code.SidebarProvider"

  /** 当前 webview 实例引用（侧边栏可能被隐藏、重新显示） */
  private webviewView: vscode.WebviewView | undefined

  /** webview 前端是否已完成初始化 */
  private isWebviewReady = false

  /** 资源释放器集合 */
  private disposables: vscode.Disposable[] = []

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly ezcode: EzcodeController
  ) {}

  // ─────────────────────────────────────────────────────────
  // WebviewViewProvider 接口实现
  // ─────────────────────────────────────────────────────────

  /**
   * VS Code 在侧边栏需要显示 webview 时调用此方法。
   * 每次侧边栏从隐藏变为可见时都会调用。
   */
  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this.webviewView = webviewView
    this.isWebviewReady = false

    // 先写入带 CSP 的 HTML，再启用脚本选项。
    // VS Code 会在 options 更新时推送当前 HTML；若此时还是空 HTML，
    // Extension Development Host 会记录 missing-csp warning。
    webviewView.webview.html = this.getHtmlForWebview(webviewView.webview)

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    }

    // 设置消息处理器
    this.setupMessageHandler(webviewView.webview)

    // 侧边栏被销毁时清理资源
    webviewView.onDidDispose(() => {
      this.webviewView = undefined
      this.isWebviewReady = false
      this.dispose()
    })
  }

  // ─────────────────────────────────────────────────────────
  // 消息通信
  // ─────────────────────────────────────────────────────────

  /**
   * 设置来自 Webview 的消息处理器。
   *
   * 消息协议约定：
   * - 每条消息必须包含 `type` 字段作为消息类型标识
   * - `webviewReady`：Webview 前端初始化完成的握手信号
   * - `sendMessage`：用户发送聊天消息
   * - `navigate`：视图切换请求
   */
  private setupMessageHandler(webview: vscode.Webview): void {
    const postToWebview = (payload: Record<string, unknown>) => {
      if (!this.webviewView || !this.isWebviewReady) return
      try {
        const sent = webview.postMessage(payload)
        void sent.then(undefined, () => false)
        return sent
      } catch {
        return
      }
    }
    this.disposables.push(this.ezcode.registerWebviewPost(postToWebview))
    webview.onDidReceiveMessage(
      async (message: Record<string, unknown>) => {
        const type = message.type as string

        switch (type) {
          case "webviewReady":
            // Webview 前端初始化完成，推送初始状态
            this.isWebviewReady = true
            await this.ezcode.postInitialState(postToWebview)
            break

          case "sendMessage":
            // 用户发送消息 — 在此处理业务逻辑
            await this.handleUserMessage(message)
            break

          case "openExternal":
            // 打开外部链接（webview 无法直接打开 URL）
            if (typeof message.url === "string") {
              vscode.env.openExternal(vscode.Uri.parse(message.url))
            }
            break

          case "openSettings":
            // 侧边栏中点击设置 → 触发命令打开独立 Settings 面板
            vscode.commands.executeCommand("solipsism-code.openSettings")
            break

          case "openAbout":
            // 侧边栏中点击关于 → 触发命令打开独立 About 面板
            vscode.commands.executeCommand("solipsism-code.openAbout")
            break

          case "openAgentManager":
            vscode.commands.executeCommand("solipsism-code.openAgentManager", {
              nodeId: typeof message.nodeId === "string" ? message.nodeId : undefined,
              branchId: typeof message.branchId === "string" ? message.branchId : undefined,
              sessionId: typeof message.sessionId === "string" ? message.sessionId : undefined,
              intent: typeof message.intent === "string" ? message.intent : undefined,
            })
            break

          case "showInfo":
            // 显示信息通知
            if (typeof message.text === "string") {
              vscode.window.showInformationMessage(message.text)
            }
            break

          default:
            if (!(await this.ezcode.handleMessage(message, postToWebview))) {
              console.log(`[EZCode] 未知消息类型: ${type}`, message)
            }
        }
      },
      undefined,
      this.disposables
    )
  }

  /**
   * 向 Webview 发送消息。
   * Extension Host → Webview 方向的通信。
   */
  public postMessage(message: Record<string, unknown>): void {
    if (this.webviewView?.webview && this.isWebviewReady) {
      void this.webviewView.webview.postMessage(message)
    }
  }

  /**
   * 处理用户发送的聊天消息。
   * 这里是简化的示例——真实项目中会连接 LLM API。
   */
  private async handleUserMessage(message: Record<string, unknown>): Promise<void> {
    const text = message.text as string
    if (!text) return
    await this.ezcode.handleMessage({ type: "chat.send", text }, (payload) =>
      this.webviewView?.webview.postMessage(payload)
    )
  }

  // ─────────────────────────────────────────────────────────
  // 视图导航
  // ─────────────────────────────────────────────────────────

  /**
   * 向 Webview 发送视图导航命令。
   * 这是 Kilocode 中 SettingsEditorProvider 使用的模式：
   * 通过消息驱动前端视图切换，而非 URL 路由。
   */
  public navigateTo(view: string): void {
    this.postMessage({ type: "navigate", view })
  }

  /**
   * 触发指定的 UI 行为（如 "新建任务" 按钮点击）。
   */
  public triggerAction(action: string): void {
    this.postMessage({ type: "action", action })
  }

  // ─────────────────────────────────────────────────────────
  // HTML 生成
  // ─────────────────────────────────────────────────────────

  /**
   * 生成 Webview 的 HTML 内容。
   *
   * 关键步骤：
   * 1. 通过 `asWebviewUri` 将本地文件路径转换为 Webview 可访问的 URI
   * 2. 调用 `buildWebviewHtml` 生成带 CSP 的完整 HTML
   */
  private getHtmlForWebview(webview: vscode.Webview): string {
    // 将 dist/ 目录下的编译产物路径转换为 Webview URI
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "dist", "webview.js")
    )
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "dist", "webview.css")
    )

    return buildWebviewHtml(webview, {
      scriptUri,
      styleUri,
      title: "EZCode",
    })
  }

  // ─────────────────────────────────────────────────────────
  // 生命周期
  // ─────────────────────────────────────────────────────────

  public dispose(): void {
    this.disposables.forEach((d) => d.dispose())
    this.disposables = []
  }
}
