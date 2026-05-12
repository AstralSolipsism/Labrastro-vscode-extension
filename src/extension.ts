import * as vscode from "vscode"
import { AgentManagerPanelProvider } from "./AgentManagerPanelProvider"
import { LabrastroController } from "./LabrastroController"
import { SidebarProvider } from "./SidebarProvider"
import { SettingsPanelProvider } from "./SettingsPanelProvider"
import { TaskflowPanelProvider } from "./TaskflowPanelProvider"

/**
 * 插件激活入口。
 *
 * VS Code 在以下时机调用此函数：
 * 1. `onStartupFinished` — VS Code 启动完成后（由 package.json activationEvents 配置）
 * 2. 用户首次点击 Activity Bar 图标时
 *
 * 此函数负责：
 * - 注册侧边栏 WebviewViewProvider
 * - 注册命令处理器
 * - 注册 Panel Serializer（面板重启恢复）
 */
export function activate(context: vscode.ExtensionContext) {
  const activatedAt = Date.now()
  console.log("[labrastro] 插件激活中...")

  // ─────────────────────────────────────────────────────────
  // 1. 创建 Provider 实例
  // ─────────────────────────────────────────────────────────

  const labrastroController = new LabrastroController(context)
  const sidebarProvider = new SidebarProvider(context.extensionUri, labrastroController)
  const settingsPanelProvider = new SettingsPanelProvider(context.extensionUri, labrastroController)
  const agentManagerPanelProvider = new AgentManagerPanelProvider(
    context.extensionUri,
    labrastroController
  )
  const taskflowPanelProvider = new TaskflowPanelProvider(
    context.extensionUri,
    labrastroController
  )

  // ─────────────────────────────────────────────────────────
  // 2. 注册侧边栏 WebviewViewProvider
  //
  // 当用户点击 Activity Bar 图标时，VS Code 会调用
  // `SidebarProvider.resolveWebviewView()` 来渲染侧边栏 Webview。
  // ─────────────────────────────────────────────────────────

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      SidebarProvider.viewType,
      sidebarProvider,
      {
        webviewOptions: {
          // 隐藏时保持 Webview DOM 活跃，避免切回时重新加载
          retainContextWhenHidden: true,
        },
      }
    )
  )

  // ─────────────────────────────────────────────────────────
  // 3. 注册命令
  // ─────────────────────────────────────────────────────────

  // "新建任务" — 触发侧边栏聊天视图
  context.subscriptions.push(
    vscode.commands.registerCommand("labrastro.newTask", () => {
      sidebarProvider.triggerAction("newTask")
    })
  )

  // "会话历史" — 在侧边栏聊天视图中打开历史会话入口
  context.subscriptions.push(
    vscode.commands.registerCommand("labrastro.openSessionHistory", () => {
      sidebarProvider.triggerAction("openSessionHistory")
    })
  )

  // "设置" — 在编辑器区域打开独立的 Settings 面板
  context.subscriptions.push(
    vscode.commands.registerCommand("labrastro.openSettings", (tab?: string) => {
      settingsPanelProvider.openPanel("settings", tab)
    })
  )

  // "关于" — 在编辑器区域打开独立的 About 面板
  context.subscriptions.push(
    vscode.commands.registerCommand("labrastro.openAbout", () => {
      settingsPanelProvider.openPanel("about")
    })
  )

  // "Trace Preview" — 在编辑器区域打开后续深查页占位面板
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "labrastro.openAgentManager",
      (options?: { nodeId?: string; branchId?: string; sessionId?: string; intent?: "inspect" | "fork" | "rollback" | "delegated_run" }) => {
        agentManagerPanelProvider.openPanel(options)
      }
    )
  )

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "labrastro.openTaskflow",
      (options?: { taskflowId?: string }) => {
        taskflowPanelProvider.openPanel(options)
      }
    )
  )

  // ─────────────────────────────────────────────────────────
  // 4. 注册 Panel Serializer（重启恢复）
  //
  // 每种面板类型需要独立的 Serializer。
  // 当 VS Code 重启时，如果之前有打开的 WebviewPanel，
  // VS Code 会通过对应的 Serializer 恢复它。
  //
  // 注意：WebviewView（侧边栏）由 VS Code 自动恢复，不需要 Serializer。
  // ─────────────────────────────────────────────────────────

  const panelTypes = ["settingsPanel", "aboutPanel"] as const
  for (const suffix of panelTypes) {
    context.subscriptions.push(
      vscode.window.registerWebviewPanelSerializer(`labrastro.${suffix}`, {
        async deserializeWebviewPanel(panel: vscode.WebviewPanel) {
          settingsPanelProvider.deserializePanel(panel)
        },
      })
    )
  }

  context.subscriptions.push(
    vscode.window.registerWebviewPanelSerializer("labrastro.agentManagerPanel", {
      async deserializeWebviewPanel(panel: vscode.WebviewPanel) {
        agentManagerPanelProvider.deserializePanel(panel)
      },
    })
  )

  context.subscriptions.push(
    vscode.window.registerWebviewPanelSerializer("labrastro.taskflowPanel", {
      async deserializeWebviewPanel(panel: vscode.WebviewPanel) {
        taskflowPanelProvider.deserializePanel(panel)
      },
    })
  )

  // ─────────────────────────────────────────────────────────
  // 5. 注册清理逻辑
  // ─────────────────────────────────────────────────────────

  context.subscriptions.push(sidebarProvider)
  context.subscriptions.push(settingsPanelProvider)
  context.subscriptions.push(agentManagerPanelProvider)
  context.subscriptions.push(taskflowPanelProvider)
  context.subscriptions.push(labrastroController)

  console.log(`[labrastro startup] extension.activate ${Date.now() - activatedAt}ms`)
  console.log("[labrastro] 插件激活完成")
}

/**
 * 插件停用时调用。
 * 通常不需要手动清理，因为 VS Code 会自动释放 `context.subscriptions` 中的资源。
 */
export function deactivate() {
  console.log("[labrastro] 插件已停用")
}
