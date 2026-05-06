import * as vscode from "vscode"
import { buildWebviewHtml } from "./webview-html"
import { LabrastroController } from "./LabrastroController"

/**
 * 面板视图类型。
 *
 * 复刻 Kilocode SettingsEditorProvider 模式：
 * 每种视图类型在编辑器区域作为独立标签页打开，各自单例。
 */
type PanelView = "settings" | "about"

/** 面板标题映射 */
const PANEL_TITLES: Record<PanelView, string> = {
  settings: "Labrastro Settings",
  about: "Labrastro About",
}

/** 从 panel viewType 字符串推断视图类型 */
function viewFromType(viewType: string): PanelView | undefined {
  if (viewType === "labrastro.settingsPanel") return "settings"
  if (viewType === "labrastro.aboutPanel") return "about"
  return undefined
}

/**
 * 设置/关于页面管理器 — 在编辑器区域打开独立的 WebviewPanel。
 *
 * 完整复刻 Kilocode `SettingsEditorProvider` 的核心设计：
 *
 * 1. **多视图单例**：每种视图类型（settings / about）各维护一个面板实例，
 *    重复调用 openPanel() 只会聚焦已有面板，不会创建重复标签页。
 *
 * 2. **消息驱动导航**：面板打开后通过 `navigate` 消息告知前端当前视图类型，
 *    前端据此切换到对应的 UI（隐藏侧边栏导航栏、显示返回按钮）。
 *
 * 3. **Tab 记忆**：Settings 面板记忆用户最后展开的 Tab，重新打开时恢复。
 *
 * 4. **关闭按钮**：面板内的返回/关闭按钮通过 `closePanel` 消息关闭面板。
 *
 * 5. **Serialization**：支持 VS Code 重启后恢复面板。
 */
export class SettingsPanelProvider implements vscode.Disposable {
  /** 面板实例映射（每种视图类型最多一个） */
  private panels = new Map<PanelView, vscode.WebviewPanel>()

  /** Tab 记忆（记住 settings 面板内用户选中的子 Tab） */
  private tabs = new Map<PanelView, string>()

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly labrastro: LabrastroController
  ) {}

  // ─────────────────────────────────────────────────────────
  // 面板管理
  // ─────────────────────────────────────────────────────────

  /**
   * 打开指定类型的面板。单例模式：若已存在则聚焦。
   *
   * @param view - 视图类型
   * @param tab  - 可选，Settings 面板内要导航到的子 Tab
   */
  openPanel(view: PanelView, tab?: string): void {
    if (tab) this.tabs.set(view, tab)

    // 单例检查：面板已存在 → 聚焦到已有面板
    const existing = this.panels.get(view)
    if (existing) {
      try {
        if (tab) {
          existing.webview.postMessage({ type: "navigate", view, tab })
        }
        existing.reveal(vscode.ViewColumn.One)
        console.log(`[labrastro] ${PANEL_TITLES[view]} 面板已存在，聚焦`)
        return
      } catch {
        // 面板已被 dispose 但 onDidDispose 回调未清理 Map — 清除无效引用
        console.log(`[labrastro] ${PANEL_TITLES[view]} 面板已失效，重新创建`)
        this.panels.delete(view)
      }
    }

    console.log(`[labrastro] 创建 ${PANEL_TITLES[view]} 面板 (当前 Map 大小: ${this.panels.size})`)

    // 创建新面板
    const panel = vscode.window.createWebviewPanel(
      `labrastro.${view}Panel`,   // viewType — Serializer 用此标识恢复
      PANEL_TITLES[view],
      vscode.ViewColumn.One,
      {
        retainContextWhenHidden: true,
      }
    )

    this.wirePanel(panel, view)
  }

  /**
   * 反序列化面板（VS Code 重启后恢复）。
   *
   * VS Code 通过 `registerWebviewPanelSerializer` 在重启时调用此方法，
   * 传入已恢复的 panel 对象，需要重新绑定 HTML 和消息处理。
   */
  deserializePanel(panel: vscode.WebviewPanel): void {
    const view = viewFromType(panel.viewType)
    if (!view) {
      panel.dispose()
      return
    }
    this.wirePanel(panel, view)
  }

  // ─────────────────────────────────────────────────────────
  // 内部绑定
  // ─────────────────────────────────────────────────────────

  /**
   * 将 Panel 与业务逻辑绑定。
   * 同时用于新建面板和反序列化场景。
   */
  private wirePanel(panel: vscode.WebviewPanel, view: PanelView): void {
    // 设置面板图标
    panel.iconPath = {
      light: vscode.Uri.joinPath(this.extensionUri, "assets", "icons", "labrastro-light.svg"),
      dark: vscode.Uri.joinPath(this.extensionUri, "assets", "icons", "labrastro-dark.svg"),
    }

    // 先启用脚本与本地资源访问，再写入 HTML，确保首轮加载可执行前端 bundle。
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
    const webviewPostDisposable = this.labrastro.registerWebviewPost(postToWebview)

    // ① closePanel：面板内返回按钮关闭面板
    const closePanelDisposable = panel.webview.onDidReceiveMessage((msg) => {
      if (msg.type === "closePanel") {
        panel.dispose()
      }
    })

    // ② webviewReady：Webview 就绪后发送 navigate 消息让前端切换到对应视图
    const readyDisposable = panel.webview.onDidReceiveMessage((msg) => {
      if (msg.type === "webviewReady") {
        // 短暂延迟确保 SolidJS 已完成挂载
        setTimeout(() => {
          void (async () => {
            if (disposed) return
            await this.labrastro.postInitialState(postToWebview, {
              initializeSession: false,
            })
            postToWebview({
              type: "navigate",
              view,
              tab: this.tabs.get(view),
            })
          })().catch((error) => {
            if (!disposed) {
              console.warn("[labrastro] postInitialState failed", error)
            }
          })
        }, 50)
      }
    })

    // ③ settingsTabChanged：记忆用户在 Settings 面板中选中的子 Tab
    const tabDisposable = panel.webview.onDidReceiveMessage((msg) => {
      if (msg.type === "settingsTabChanged" && typeof msg.tab === "string") {
        this.tabs.set(view, msg.tab)
      }
    })

    // ④ 通用消息转发（showInfo、openExternal 等）
    const genericDisposable = panel.webview.onDidReceiveMessage(async (msg) => {
      if (msg.type === "showInfo" && typeof msg.text === "string") {
        vscode.window.showInformationMessage(msg.text)
        return
      }
      if (msg.type === "openExternal" && typeof msg.url === "string") {
        vscode.env.openExternal(vscode.Uri.parse(msg.url))
        return
      }
      await this.labrastro.handleMessage(msg, postToWebview)
      if (msg.type === "connection.save") {
        vscode.window.showInformationMessage("Labrastro 连接配置已保存")
      }
    })

    // 存储面板引用
    this.panels.set(view, panel)

    // 面板关闭时清理
    panel.onDidDispose(() => {
      disposed = true
      console.log(`[labrastro] ${PANEL_TITLES[view]} 面板已关闭`)
      closePanelDisposable.dispose()
      readyDisposable.dispose()
      tabDisposable.dispose()
      genericDisposable.dispose()
      webviewPostDisposable.dispose()
      this.panels.delete(view)
      this.tabs.delete(view)
    })
  }

  /**
   * 生成 HTML — 复用主 webview 的 JS/CSS。
   *
   * Kilocode 的设计精髓：Settings/About 面板不需要独立的前端构建入口，
   * 加载同一份 webview.js，然后通过 `navigate` 消息切换到不同的视图。
   */
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
      title: "Labrastro",
    })
  }

  // ─────────────────────────────────────────────────────────
  // 生命周期
  // ─────────────────────────────────────────────────────────

  dispose(): void {
    for (const [, panel] of this.panels) {
      panel.dispose()
    }
    this.panels.clear()
    this.tabs.clear()
  }
}
