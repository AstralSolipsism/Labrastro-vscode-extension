import * as vscode from "vscode"
import * as fs from "fs"
import * as path from "path"
import { ApprovalDocumentProvider } from "./ApprovalDocumentProvider"
import {
  BackendFeatures,
  LabrastroRemoteClient,
  type ConnectionState,
} from "./LabrastroRemoteClient"
import { classifyRemoteError, isRemoteError } from "./remote-errors"
import { WebviewBus, type PostMessage, type WebviewTarget } from "./WebviewBus"
import type { WebviewToHostMessage } from "./protocol/messages"
import { AdminCoordinator } from "./coordinators/AdminCoordinator"
import { ChatRunCoordinator, type ActiveChatRun } from "./coordinators/ChatRunCoordinator"
import { EnvironmentCoordinator } from "./coordinators/EnvironmentCoordinator"
import { SessionCoordinator } from "./coordinators/SessionCoordinator"

type EnvironmentRunMode = "check" | "configure"
type EnvironmentEntryKind = "cli" | "mcp" | "skill"
type EnvironmentEntryStatus =
  | "unchecked"
  | "checking"
  | "available"
  | "missing"
  | "awaiting_approval"
  | "downloading"
  | "installing"
  | "configured"
  | "failed"

interface EnvironmentEntryState {
  id: string
  kind: EnvironmentEntryKind
  name: string
  description: string
  source: string
  version?: string
  check: string
  install: string
  command?: string
  tags: string[]
  status: EnvironmentEntryStatus
  detail?: string
  lastAction?: string
  lastUpdated?: string
  installAttempted?: boolean
}

interface EnvironmentApprovalState {
  approvalId: string
  toolName: string
  toolSource?: string
  command: string
  entryId?: string
  reason?: string
  content?: string
  toolArgs?: Record<string, unknown>
  sections?: Record<string, unknown>[]
  previewUnavailable?: boolean
  previewError?: string
  rawPayload?: Record<string, unknown>
}

interface EnvironmentLogState {
  id: string
  level: "info" | "warning" | "error"
  message: string
  createdAt: string
  entryId?: string
}

interface EnvironmentSnapshot {
  mode: EnvironmentRunMode | null
  running: boolean
  status: "idle" | "running" | "completed" | "error" | "canceled"
  summary: string
  chatId?: string
  taskId?: string
  agentId?: string
  sessionId?: string
  startedAt?: string
  completedAt?: string
  lastManifestAt?: string
  error?: string
  entries: EnvironmentEntryState[]
  approvals: EnvironmentApprovalState[]
  logs: EnvironmentLogState[]
  lastRunSummary?: string
  lastRunCompletedAt?: string
  lastRunStatus?: "completed" | "error" | "canceled"
}

interface ActiveEnvironmentRun {
  taskId: string
  agentId?: string
  mode: EnvironmentRunMode
  cancelled: boolean
}

const CHAT_STREAM_RETRY_DELAYS_MS = [1_000, 2_000, 5_000, 10_000, 15_000]
const CHAT_STREAM_RECOVERY_DEADLINE_MS = 5 * 60 * 1000
const CHAT_WEBVIEW_TARGETS: readonly WebviewTarget[] = ["sidebar"]
const SESSION_WEBVIEW_TARGETS: readonly WebviewTarget[] = ["sidebar", "agentManager"]
export class LabrastroController implements vscode.Disposable {
  private readonly client: LabrastroRemoteClient
  private readonly approvalDocuments: ApprovalDocumentProvider
  private readonly adminCoordinator: AdminCoordinator
  private readonly chatRunCoordinator: ChatRunCoordinator
  private readonly environmentCoordinator: EnvironmentCoordinator
  private readonly sessionCoordinator: SessionCoordinator
  private backendFeatures: BackendFeatures | null | undefined
  private readonly webviewBus = new WebviewBus()
  private disposed = false

  constructor(private readonly context: vscode.ExtensionContext) {
    this.client = new LabrastroRemoteClient(context)
    this.approvalDocuments = new ApprovalDocumentProvider()
    this.adminCoordinator = new AdminCoordinator({
      client: this.client,
      context: this.context,
      connectionErrorState: this.connectionErrorState.bind(this),
      postConnectionState: this.postConnectionState.bind(this),
      postAdminState: this.postAdminState.bind(this),
      refreshBackendFeatures: this.refreshBackendFeatures.bind(this),
      broadcastState: this.broadcastWebviewMessage.bind(this),
      runAdminAction: this.runAdminAction.bind(this),
      openFileTarget: this.openFileTarget.bind(this),
      getExecutorType: this.getExecutorType.bind(this),
      broadcastExecutorType: this.broadcastExecutorType.bind(this),
    })
    this.environmentCoordinator = new EnvironmentCoordinator({
      client: this.client,
      isEnvironmentRunActive: () => this.environmentCoordinator.isEnvironmentRunActive(),
      agentRunSubmitPayload: this.agentRunSubmitPayload.bind(this),
      refreshToolchainState: this.refreshToolchainState.bind(this),
      refreshEnvironmentManifest: this.refreshEnvironmentManifest.bind(this),
      startToolchainIngest: this.startToolchainIngest.bind(this),
      cancelToolchainIngest: this.cancelToolchainIngest.bind(this),
      startEnvironmentRun: this.startEnvironmentRun.bind(this),
      cancelEnvironmentRun: this.cancelEnvironmentRun.bind(this),
      runToolchainAction: this.runToolchainAction.bind(this),
    })
    this.sessionCoordinator = new SessionCoordinator({
      client: this.client,
      context: this.context,
      emitSessionMessage: this.emitSessionMessage.bind(this),
      refreshBackendFeatures: this.refreshBackendFeatures.bind(this),
      ensureBackendFeatures: this.ensureBackendFeatures.bind(this),
      getBackendFeatures: () => this.backendFeatures,
      isChatActive: () => this.chatRunCoordinator.isActive(),
    })
    this.chatRunCoordinator = new ChatRunCoordinator({
      client: this.client,
      context: this.context,
      approvalDocuments: this.approvalDocuments,
      startChat: this.startChat.bind(this),
      cancelChat: this.cancelChat.bind(this),
      postConnectionStateIfAuthRequired: this.postConnectionStateIfAuthRequired.bind(this),
    })
    this.context.subscriptions.push(
      vscode.workspace.registerTextDocumentContentProvider(
        ApprovalDocumentProvider.scheme,
        this.approvalDocuments
      )
    )
  }

  private get toolchainState(): Record<string, unknown> | undefined {
    return this.environmentCoordinator.toolchainState
  }

  private set toolchainState(value: Record<string, unknown> | undefined) {
    this.environmentCoordinator.toolchainState = value
  }

  private get environmentManifest(): Record<string, unknown> | undefined {
    return this.environmentCoordinator.environmentManifest
  }

  private set environmentManifest(value: Record<string, unknown> | undefined) {
    this.environmentCoordinator.environmentManifest = value
  }

  private get environmentSnapshot(): EnvironmentSnapshot {
    return this.environmentCoordinator.environmentSnapshot as unknown as EnvironmentSnapshot
  }

  private set environmentSnapshot(value: EnvironmentSnapshot) {
    this.environmentCoordinator.environmentSnapshot = value as unknown as Record<string, unknown>
  }

  private get activeEnvironmentRun(): ActiveEnvironmentRun | undefined {
    return this.environmentCoordinator.activeEnvironmentRun as unknown as ActiveEnvironmentRun | undefined
  }

  private set activeEnvironmentRun(value: ActiveEnvironmentRun | undefined) {
    this.environmentCoordinator.activeEnvironmentRun = value as unknown as Record<string, unknown> | undefined
  }

  private get activeToolchainIngestChatId(): string | undefined {
    return this.environmentCoordinator.activeToolchainIngestChatId
  }

  private set activeToolchainIngestChatId(value: string | undefined) {
    this.environmentCoordinator.activeToolchainIngestChatId = value
  }

  registerWebviewPost(post: PostMessage, target: WebviewTarget = "sidebar"): vscode.Disposable {
    return this.webviewBus.register(target, post)
  }

  focusTaskflowChatInteraction(options: { taskflowId?: string; reason?: string } = {}): void {
    void vscode.commands.executeCommand("workbench.view.extension.labrastro-ActivityBar")
    this.emitTargetedMessage(
      {
        type: "taskflow.focusChatInteraction",
        ...(options.taskflowId ? { taskflowId: options.taskflowId } : {}),
        ...(options.reason ? { reason: options.reason } : {}),
      },
      ["sidebar"]
    )
  }

  private connectionErrorState(
    message: string,
    options: { hostUrlSaveRequested?: string } = {}
  ): ConnectionState {
    const state = this.client.startupConnectionState()
    const requested = options.hostUrlSaveRequested
    return {
      ...state,
      authReachable: false,
      authenticated: false,
      status: "error",
      message,
      ...(requested
        ? {
            hostUrlSaveRequested: requested,
            hostUrlSaveApplied: state.hostUrl === requested,
          }
        : {}),
    }
  }

  async postInitialState(
    post: PostMessage,
    options: { initializeSession?: boolean } = {}
  ): Promise<void> {
    const startedAt = Date.now()
    const target = this.webviewBus.targetOf(post)
    const includeSession = target !== "settings" && options.initializeSession !== false
    const includeAdminState = target !== "agentManager"
    const includeChatResume = target === "sidebar" || !target
    post({
      type: "ready",
      extensionVersion: contextVersion(this.context),
      workspaceDirectory: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
      platform: process.platform,
    })
    if (includeAdminState) {
      post({ type: "autoApproval.state", payload: this.adminCoordinator.getAutoApprovalState() })
      post({ type: "connection.state", payload: this.client.startupConnectionState() })
      post({ type: "environment.snapshot", payload: this.environmentSnapshot })
      post({ type: "executorType.state", payload: this.getExecutorType() })
      post({ type: "locale.state", locale: this.context.workspaceState.get<string>("labrastro.locale") || vscode.env.language })
    }
    if (includeSession) {
      await this.sessionCoordinator.postSessionSyncStatus(post)
    }
    const activeRunPayload = this.chatRunCoordinator.activeRunPayload()
    if (activeRunPayload && includeChatResume) {
      post({ type: "chat.resume", payload: activeRunPayload })
    }
    post({
      type: "startup.metric",
      payload: { name: "initial-state-ready", elapsedMs: Date.now() - startedAt },
    })
    void this.refreshInitialStateInBackground(post, startedAt, {
      includeAdminState,
      includeSession,
    })
  }

  private async refreshInitialStateInBackground(
    post: PostMessage,
    startedAt: number,
    options: { includeAdminState: boolean; includeSession: boolean }
  ): Promise<void> {
    const run = async (name: string, operation: () => Promise<void>) => {
      const stepStartedAt = Date.now()
      try {
        await operation()
        post({
          type: "startup.metric",
          payload: {
            name,
            elapsedMs: Date.now() - stepStartedAt,
            totalElapsedMs: Date.now() - startedAt,
          },
        })
      } catch (error) {
        post({
          type: "startup.metric",
          payload: {
            name,
            error: errorMessage(error),
            elapsedMs: Date.now() - stepStartedAt,
            totalElapsedMs: Date.now() - startedAt,
          },
        })
      }
    }

    const tasks: Promise<void>[] = []
    if (options.includeAdminState) {
      tasks.push(
        run("connection-state", () => this.postConnectionState(post)),
        run("admin-state", () => this.postAdminState(post)),
        run("backend-features", () => this.refreshBackendFeatures(post))
      )
    } else if (options.includeSession) {
      tasks.push(run("backend-features", () => this.refreshBackendFeatures(post)))
    }
    if (options.includeSession) {
      tasks.push(run("session-sync", () => this.sessionCoordinator.syncDueSessionSnapshots(post)))
      tasks.push(run("session-initialize", () => this.sessionCoordinator.initializeSessionState(post)))
    }

    await Promise.allSettled(tasks)

    if (options.includeAdminState && this.toolchainState) {
      post({ type: "toolchain.state", payload: this.toolchainState })
    }
    if (options.includeAdminState && this.environmentManifest) {
      post({ type: "environment.manifest", payload: this.environmentManifest })
    }
  }

  async handleMessage(
    message: WebviewToHostMessage,
    post: PostMessage
  ): Promise<boolean> {
    if (await this.adminCoordinator.handleMessage(message, post)) return true
    if (await this.environmentCoordinator.handleMessage(message, post)) return true
    if (await this.sessionCoordinator.handleMessage(message, post)) return true
    if (await this.chatRunCoordinator.handleMessage(message, post)) return true
    return false
  }

  private getExecutorType(): { location: string; engine: string } {
    const stored = this.context.workspaceState.get<Record<string, string>>("labrastro.executorType")
    return {
      location: stored?.location || "remote",
      engine: stored?.engine || "labrastro",
    }
  }

  private broadcastExecutorType(): void {
    const payload = { type: "executorType.state", payload: this.getExecutorType() }
    this.broadcastWebviewMessage(payload)
  }

  private agentRunSubmitPayload(payload: Record<string, unknown>): Record<string, unknown> {
    const metadata: Record<string, unknown> = {
      ...objectValue(payload.metadata),
    }
    if (!metadata.workspace_root && vscode.workspace.workspaceFolders?.[0]?.uri.fsPath) {
      metadata.workspace_root = vscode.workspace.workspaceFolders[0].uri.fsPath
    }
    return {
      ...payload,
      metadata,
    }
  }

  private postWebviewMessage(post: PostMessage, payload: Record<string, unknown>): void {
    this.webviewBus.post(post, payload)
  }

  private broadcastWebviewMessage(
    payload: Record<string, unknown>,
    targets?: readonly WebviewTarget[]
  ): void {
    this.webviewBus.broadcast(payload, targets)
  }

  private emitTargetedMessage(
    payload: Record<string, unknown>,
    targets: readonly WebviewTarget[],
    fallbackPost?: PostMessage
  ): void {
    if (this.webviewBus.hasTargets(targets)) {
      this.broadcastWebviewMessage(payload, targets)
      return
    }
    if (!fallbackPost) return
    const fallbackTarget = this.webviewBus.targetOf(fallbackPost)
    if (!fallbackTarget || targets.includes(fallbackTarget)) {
      this.postWebviewMessage(fallbackPost, payload)
    }
  }

  private emitSessionMessage(payload: Record<string, unknown>, fallbackPost?: PostMessage): void {
    this.emitTargetedMessage(payload, SESSION_WEBVIEW_TARGETS, fallbackPost)
  }

  private emitChatMessage(payload: Record<string, unknown>, fallbackPost?: PostMessage): void {
    const type = typeof payload.type === "string" ? payload.type : ""
    if (type.startsWith("session.") || type === "traceSnapshot" || type === "traceFocusNode") {
      this.emitSessionMessage(payload, fallbackPost)
      return
    }
    this.emitTargetedMessage(payload, CHAT_WEBVIEW_TARGETS, fallbackPost)
  }

  async postConnectionState(post: PostMessage): Promise<void> {
    this.postWebviewMessage(post, await this.connectionStateMessage())
  }

  private async broadcastConnectionState(): Promise<void> {
    this.broadcastWebviewMessage(await this.connectionStateMessage())
  }

  private async connectionStateMessage(): Promise<Record<string, unknown>> {
    try {
      return { type: "connection.state", payload: await this.client.connectionState() }
    } catch (error) {
      return {
        type: "connection.state",
        payload: { status: "error", message: errorMessage(error) },
      }
    }
  }

  async postAdminState(post: PostMessage): Promise<void> {
    try {
      post({ type: "admin.state", payload: await this.client.adminStatus() })
    } catch (error) {
      post({ type: "admin.error", message: errorMessage(error) })
    }
  }

  private async refreshBackendFeatures(post?: PostMessage): Promise<void> {
    try {
      this.backendFeatures = await this.client.features()
      post?.({ type: "backend.features", payload: this.backendFeatures })
      await this.sessionCoordinator.postSessionSyncStatus(post)
    } catch {
      this.backendFeatures = null
    }
  }

  private async postConnectionStateIfAuthRequired(
    error: unknown,
    post: PostMessage
  ): Promise<void> {
    if (classifyRemoteError(error) === "auth_required") {
      if (this.webviewBus.size > 0) {
        await this.broadcastConnectionState()
        return
      }
      await this.postConnectionState(post)
    }
  }

  private async ensureBackendFeatures(): Promise<BackendFeatures | null> {
    if (this.backendFeatures !== undefined) {
      return this.backendFeatures
    }
    await this.refreshBackendFeatures()
    return this.backendFeatures ?? null
  }

  private async refreshToolchainState(post: PostMessage): Promise<void> {
    try {
      const list = await this.client.toolchainList()
      let dashboard: Record<string, unknown> | undefined
      try {
        dashboard = await this.client.toolchainDashboard()
      } catch (error) {
        dashboard = {
          error: errorMessage(error),
          items: [],
          summary: {},
        }
      }
      const dashboardPayload = dashboard || {}
      this.toolchainState = {
        ...list,
        dashboard: dashboardPayload,
        dashboard_items: Array.isArray(dashboardPayload.items) ? dashboardPayload.items : [],
        dashboard_summary:
          dashboardPayload.summary && typeof dashboardPayload.summary === "object"
            ? dashboardPayload.summary
            : {},
      }
      post({ type: "toolchain.state", payload: this.toolchainState })
    } catch (error) {
      post({ type: "toolchain.error", message: errorMessage(error) })
    }
  }

  private async refreshEnvironmentManifest(post: PostMessage): Promise<void> {
    if (this.activeEnvironmentRun) {
      post({
        type: "environment.run.error",
        message: "环境任务运行中，暂时不能刷新清单。",
      })
      return
    }
    try {
      const payload = normalizeEnvironmentManifest(await this.client.environmentManifest())
      const lastManifestAt = stringValue(payload.loadedAt) || new Date().toISOString()
      const entries = buildEnvironmentEntries(payload)
      const history = environmentRunHistory(this.environmentSnapshot)
      this.environmentManifest = payload
      this.environmentSnapshot = {
        ...createEmptyEnvironmentSnapshot(),
        summary: environmentEntrySummary(entries),
        lastManifestAt,
        entries,
        ...history,
      }
      post({ type: "environment.manifest", payload })
      post({ type: "environment.snapshot", payload: this.environmentSnapshot })
    } catch (error) {
      this.environmentSnapshot = {
        ...this.environmentSnapshot,
        running: false,
        status: "error",
        summary: "环境清单加载失败",
        error: errorMessage(error),
      }
      post({ type: "environment.snapshot", payload: this.environmentSnapshot })
      post({ type: "environment.run.error", message: errorMessage(error) })
    }
  }

  private async ensureEnvironmentManifest(post: PostMessage): Promise<Record<string, unknown>> {
    if (this.environmentManifest) {
      return this.environmentManifest
    }
    await this.refreshEnvironmentManifest(post)
    if (!this.environmentManifest) {
      throw new Error("环境清单不可用。")
    }
    return this.environmentManifest
  }

  private async startEnvironmentRun(
    mode: EnvironmentRunMode,
    post: PostMessage,
    entryIds?: string[],
    agentId?: string
  ): Promise<void> {
    if (this.activeEnvironmentRun) {
      post({
        type: "environment.run.error",
        message: "已有环境任务正在运行，请先停止当前任务。",
      })
      return
    }

    let taskId = ""
    try {
      const manifest = await this.ensureEnvironmentManifest(post)
      const runManifest = filterEnvironmentManifest(manifest, entryIds)
      const entries = buildEnvironmentEntries(runManifest)
      if (entries.length === 0) {
        const history = environmentRunHistory(this.environmentSnapshot)
        this.environmentSnapshot = {
          ...createEmptyEnvironmentSnapshot(),
          status: "error",
          summary: "当前服务器没有配置任何环境条目。",
          error: "environment_manifest_empty",
          lastManifestAt:
            stringValue(manifest.loadedAt) || this.environmentSnapshot.lastManifestAt,
          ...history,
        }
        post({ type: "environment.snapshot", payload: this.environmentSnapshot })
        post({
          type: "environment.run.error",
          message: "当前服务器没有配置任何环境条目。",
        })
        return
      }

      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || ""
      const start = await this.client.environmentRun({
        mode,
        entry_ids: entryIds || [],
        workspace_root: workspaceRoot,
        agent_id: agentId || undefined,
      })
      const task = objectValue(start.agent_run)
      taskId = stringValue(task.id) || stringValue(start.agent_run_id) || ""
      if (!taskId) {
        throw new Error("environment_agent_run_id_missing")
      }
      const selectedAgentId = stringValue(start.agent_id) || agentId

      this.activeEnvironmentRun = {
        taskId,
        agentId: selectedAgentId,
        mode,
        cancelled: false,
      }
      const history = environmentRunHistory(this.environmentSnapshot)
      this.environmentSnapshot = {
        mode,
        running: true,
        status: "running",
        summary: mode === "check" ? "正在检查当前环境..." : "正在配置当前环境...",
        taskId,
        agentId: selectedAgentId,
        startedAt: new Date().toISOString(),
        completedAt: undefined,
        lastManifestAt:
          stringValue(runManifest.loadedAt) || this.environmentSnapshot.lastManifestAt,
        error: undefined,
        entries,
        approvals: [],
        logs: [],
        ...history,
      }
      post({ type: "environment.run.started", payload: { mode, taskId, agentId: selectedAgentId } })
      post({ type: "environment.snapshot", payload: this.environmentSnapshot })
      await this.pollEnvironmentRuntimeRun(taskId, post)
    } catch (error) {
      if (
        this.activeEnvironmentRun?.cancelled ||
        this.environmentSnapshot.status === "canceled" ||
        (taskId &&
          this.environmentSnapshot.taskId &&
          this.environmentSnapshot.taskId !== taskId &&
          this.activeEnvironmentRun?.taskId !== taskId)
      ) {
        return
      }
      const completedAt = new Date().toISOString()
      this.environmentSnapshot = {
        ...this.environmentSnapshot,
        running: false,
        status: "error",
        summary: "环境任务执行失败",
        error: errorMessage(error),
        completedAt,
        lastRunSummary: "环境任务执行失败",
        lastRunCompletedAt: completedAt,
        lastRunStatus: "error",
      }
      this.activeEnvironmentRun = undefined
      post({ type: "environment.snapshot", payload: this.environmentSnapshot })
      post({ type: "environment.run.error", message: errorMessage(error) })
    }
  }

  private async pollEnvironmentRuntimeRun(
    taskId: string,
    post: PostMessage
  ): Promise<void> {
    let afterSeq = 0
    while (!this.disposed && this.activeEnvironmentRun?.taskId === taskId) {
      const payload = await this.client.agentRunEvents({
        agent_run_id: taskId,
        after_seq: afterSeq,
      })
      const events = Array.isArray(payload.events) ? payload.events : []
      if (events.length) {
        for (const event of events) {
          if (!event || typeof event !== "object") continue
          const normalized = event as Record<string, unknown>
          const seq = numberValue(normalized.seq)
          if (typeof seq === "number" && seq > afterSeq) {
            afterSeq = seq
          }
          this.applyEnvironmentEvent(normalized, post)
        }
        post({ type: "environment.snapshot", payload: this.environmentSnapshot })
      }
      if (!this.activeEnvironmentRun || this.environmentSnapshot.status !== "running") {
        break
      }
      await delay(1200)
    }
  }

  private async startToolchainIngest(
    input: Record<string, unknown>,
    post: PostMessage
  ): Promise<void> {
    if (this.activeToolchainIngestChatId) {
      post({
        type: "toolchain.ingest.error",
        payload: {
          status: "failed",
          message: "已有新增能力 Agent 正在运行，请先等待当前任务结束。",
        },
      })
      return
    }

    let chatId = ""
    const startedAt = new Date().toISOString()
    post({
      type: "toolchain.ingest.started",
      payload: { running: true, status: "running", startedAt, input },
    })
    try {
      const prompt = buildToolchainIngestPrompt(input)
      const start = await this.client.startChat(prompt)
      chatId = String(start.chat_id || "")
      if (!chatId) {
        throw new Error("toolchain_ingest_chat_id_missing")
      }
      this.activeToolchainIngestChatId = chatId
      post({
        type: "toolchain.ingest.event",
        payload: {
          chatId,
          level: "info",
          message: "新增能力 Agent 已启动。",
          createdAt: new Date().toISOString(),
        },
      })

      let cursor = 0
      let assistantText = ""
      let finalResponse = ""
      while (!this.disposed && this.activeToolchainIngestChatId === chatId) {
        const stream = await this.client.streamChat(chatId, cursor, 2)
        const events = Array.isArray(stream.events) ? stream.events : []
        const nextCursor = Number(stream.next_cursor ?? cursor)
        for (const event of events) {
          if (!event || typeof event !== "object") continue
          const normalized = event as Record<string, unknown>
          if (normalized.type === "approval_request") {
            await this.approvalDocuments.store(objectValue(normalized.payload))
          }
          const capturedText = toolchainIngestAssistantText(normalized)
          if (capturedText) {
            assistantText += capturedText
          }
          const chatEndResponse = toolchainIngestChatEndResponse(normalized)
          if (chatEndResponse) {
            finalResponse = chatEndResponse
          }
          const log = toolchainIngestEventLog(normalized)
          if (log) {
            post({
              type: "toolchain.ingest.event",
              payload: {
                chatId,
                ...log,
                createdAt: new Date().toISOString(),
              },
            })
          }
        }
        cursor = nextCursor
        if (stream.done) {
          break
        }
      }
      if (this.activeToolchainIngestChatId !== chatId) {
        return
      }

      const rawResponse = finalResponse || assistantText
      const candidate = parseToolchainIngestResponse(rawResponse)
      const validation = validateToolchainIngestCandidate(candidate)
      if (!validation.ok) {
        post({
          type: "toolchain.ingest.result",
          payload: {
            status: "needs_review",
            persisted: false,
            candidate,
            rawResponse,
            error: validation.error,
            completedAt: new Date().toISOString(),
          },
        })
        return
      }

      const payload = toolchainPayloadFromIngestCandidate(candidate)
      const recordResult = await this.client.toolchainRecord(validation.kind, payload)
      post({ type: "toolchain.actionResult", payload: recordResult })
      post({
        type: "toolchain.ingest.result",
        payload: {
          status: "configured",
          persisted: true,
          kind: validation.kind,
          candidate: payload,
          rawCandidate: candidate,
          recordResult,
          completedAt: new Date().toISOString(),
        },
      })
      await this.refreshToolchainState(post)
      if (!this.activeEnvironmentRun) {
        await this.refreshEnvironmentManifest(post)
      }
    } catch (error) {
      post({
        type: "toolchain.ingest.error",
        payload: {
          status: "parse_failed",
          message: errorMessage(error),
          chatId,
          completedAt: new Date().toISOString(),
        },
      })
    } finally {
      if (!chatId || this.activeToolchainIngestChatId === chatId) {
        this.activeToolchainIngestChatId = undefined
      }
    }
  }

  private async cancelToolchainIngest(post: PostMessage): Promise<void> {
    const chatId = this.activeToolchainIngestChatId
    if (!chatId) {
      post({
        type: "toolchain.ingest.error",
        payload: { status: "canceled", message: "当前没有正在运行的新增能力 Agent。" },
      })
      return
    }
    this.activeToolchainIngestChatId = undefined
    try {
      await this.client.cancelChat(chatId, "user_cancelled")
    } catch {
      // The local UI state is already cancelled; stream cleanup may race with the backend.
    }
    post({
      type: "toolchain.ingest.error",
      payload: {
        status: "canceled",
        chatId,
        message: "新增能力 Agent 已停止。",
        completedAt: new Date().toISOString(),
      },
    })
  }

  private async cancelEnvironmentRun(post: PostMessage): Promise<void> {
    const run = this.activeEnvironmentRun
    if (!run) {
      post({ type: "environment.snapshot", payload: this.environmentSnapshot })
      return
    }
    run.cancelled = true
    const completedAt = new Date().toISOString()
    this.environmentSnapshot = {
      ...this.environmentSnapshot,
      running: false,
      status: "canceled",
      summary: "环境任务已停止。",
      completedAt,
      approvals: [],
      lastRunSummary: "环境任务已停止。",
      lastRunCompletedAt: completedAt,
      lastRunStatus: "canceled",
    }
    this.activeEnvironmentRun = undefined
    post({ type: "environment.snapshot", payload: this.environmentSnapshot })
    post({ type: "environment.run.completed", payload: this.environmentSnapshot })
    try {
      if (run.taskId) {
        await this.client.agentRunCancel({
          agent_run_id: run.taskId,
          reason: "user_cancelled",
        })
      }
    } catch {
      // The UI state is already cancelled; backend cancellation may race with completion.
    }
  }

  private applyEnvironmentEvent(
    event: Record<string, unknown>,
    post: PostMessage
  ): void {
    const run = this.activeEnvironmentRun
    if (!run) return
    const type = String(event.type || "")
    const payload = objectValue(event.payload)
    const data = objectValue(payload.data)
    const entryId = stringValue(payload.entry_id) || ""
    const phase = stringValue(payload.phase) || ""
    const command = stringValue(payload.command) || ""
    if (type === "text" || type === "log") {
      const text = stringValue(payload.text) || stringValue(data.text)
      if (text) this.appendEnvironmentLog("info", truncateText(text, 1200))
      return
    }
    if (type === "error") {
      const message =
        stringValue(payload.text) ||
        stringValue(data.message) ||
        stringValue(payload.message) ||
        "unknown error"
      this.appendEnvironmentLog("error", truncateText(message, 1200))
      return
    }
    if (type === "status") {
      const status = stringValue(data.status) || stringValue(payload.status)
      if (status === "running") this.appendEnvironmentLog("info", "环境任务已开始。")
      if (status === "blocked") {
        this.finalizeEnvironmentRuntimeRun("error", "环境任务被策略阻止。", post)
      }
      return
    }
    if (type === "environment.install_requested") {
      if (entryId) {
        this.updateEnvironmentEntry(entryId, {
          status: "awaiting_approval",
          lastAction: "请求安装",
          detail: command,
          lastUpdated: new Date().toISOString(),
          installAttempted: true,
        })
      }
      this.appendEnvironmentLog("warning", command ? `请求安装：${command}` : "请求安装", entryId)
      return
    }
    if (type === "environment.entry_started") {
      if (entryId) {
        this.updateEnvironmentEntry(entryId, {
          status: phase === "install" ? "installing" : "checking",
          lastAction: phase === "install" ? "安装中" : "检查中",
          detail: command,
          lastUpdated: new Date().toISOString(),
          installAttempted: phase === "install" ? true : undefined,
        })
      }
      this.appendEnvironmentLog("info", command || `${entryId} started`, entryId)
      return
    }
    if (type === "environment.entry_checked") {
      const ok = booleanValue(payload.ok)
      const detail = environmentEventDetail(payload)
      if (entryId) {
        const entry = this.environmentSnapshot.entries.find((item) => item.id === entryId)
        this.updateEnvironmentEntry(entryId, {
          status:
            ok === true
              ? entry?.installAttempted
                ? "configured"
                : "available"
              : ok === false
                ? entry?.installAttempted
                  ? "failed"
                  : "missing"
                : "checking",
          lastAction:
            ok === true
              ? entry?.installAttempted
                ? "复检通过"
                : "检查通过"
              : ok === false
                ? entry?.installAttempted
                  ? "复检失败"
                  : "缺失"
                : "检查完成",
          detail: detail || command,
          lastUpdated: new Date().toISOString(),
        })
      }
      if (detail) this.appendEnvironmentLog(ok === false ? "error" : "info", detail, entryId)
      return
    }
    if (type === "environment.entry_verified") {
      if (entryId) {
        const entry = this.environmentSnapshot.entries.find((item) => item.id === entryId)
        this.updateEnvironmentEntry(entryId, {
          status: entry?.installAttempted ? "configured" : "available",
          lastAction: entry?.installAttempted ? "复检通过" : "检查通过",
          detail: environmentEventDetail(payload) || command,
          lastUpdated: new Date().toISOString(),
        })
      }
      return
    }
    if (type === "environment.entry_failed") {
      const detail = environmentEventDetail(payload) || command || "环境条目失败"
      if (entryId) {
        const entry = this.environmentSnapshot.entries.find((item) => item.id === entryId)
        this.updateEnvironmentEntry(entryId, {
          status: phase === "check" && !entry?.installAttempted ? "missing" : "failed",
          lastAction: stringValue(payload.error_code) ? "策略阻止" : "失败",
          detail,
          lastUpdated: new Date().toISOString(),
        })
      }
      this.appendEnvironmentLog("error", detail, entryId)
      return
    }
    if (type === "environment.summary") {
      const output = truncateText(stringValue(payload.output) || "", 2000)
      if (output) this.appendEnvironmentLog("info", output)
      return
    }
    if (type === "completed") {
      this.finalizeEnvironmentRuntimeRun(
        "completed",
        finalizeEnvironmentSummary(this.environmentSnapshot.entries, run.mode),
        post
      )
      return
    }
    if (type === "cancelled" || type === "canceled") {
      run.cancelled = true
      this.finalizeEnvironmentRuntimeRun("canceled", "环境任务已停止。", post)
      return
    }
    if (type === "failed" || type === "blocked") {
      const result = objectValue(payload.result)
      const error =
        stringValue(result.error) ||
        stringValue(payload.error) ||
        (type === "blocked" ? "environment_policy_blocked" : "environment_task_failed")
      this.finalizeEnvironmentRuntimeRun("error", "环境任务执行失败", post, error)
    }
  }

  private finalizeEnvironmentRuntimeRun(
    status: EnvironmentSnapshot["status"],
    summary: string,
    post: PostMessage,
    error?: string
  ): void {
    const completedAt = new Date().toISOString()
    const entries = this.environmentSnapshot.entries.map((entry) => {
      if (entry.status === "checking" || entry.status === "installing" || entry.status === "downloading" || entry.status === "awaiting_approval") {
        return {
          ...entry,
          status: "failed" as const,
          lastAction: status === "canceled" ? "已停止" : "流程未完成",
        }
      }
      return entry
    })
    this.environmentSnapshot = {
      ...this.environmentSnapshot,
      running: false,
      status,
      summary,
      error,
      completedAt,
      entries,
      approvals: [],
      lastRunSummary: summary,
      lastRunCompletedAt: completedAt,
      lastRunStatus:
        status === "completed" || status === "error" || status === "canceled"
          ? status
          : undefined,
    }
    this.activeEnvironmentRun = undefined
    post({ type: "environment.snapshot", payload: this.environmentSnapshot })
    post({ type: "environment.run.completed", payload: this.environmentSnapshot })
  }

  private updateEnvironmentEntry(
    entryId: string,
    patch: Partial<EnvironmentEntryState>
  ): void {
    this.environmentSnapshot = {
      ...this.environmentSnapshot,
      entries: this.environmentSnapshot.entries.map((entry) =>
        entry.id === entryId ? { ...entry, ...patch } : entry
      ),
    }
  }

  private appendEnvironmentLog(
    level: EnvironmentLogState["level"],
    message: string,
    entryId?: string
  ): void {
    const trimmed = message.trim()
    if (!trimmed) return
    const next: EnvironmentLogState = {
      id: `env-log-${Date.now()}-${this.environmentSnapshot.logs.length}`,
      level,
      message: trimmed,
      createdAt: new Date().toISOString(),
      entryId,
    }
    this.environmentSnapshot = {
      ...this.environmentSnapshot,
      logs: [...this.environmentSnapshot.logs, next].slice(-80),
    }
  }

  private finalizeEnvironmentRun(cancelled: boolean, post: PostMessage): void {
    const snapshot = this.environmentSnapshot
    const completedAt = new Date().toISOString()
    const runningEntries = snapshot.entries.map((entry) => {
      if (entry.status === "checking") {
        return { ...entry, status: "failed" as const, lastAction: "检查未完成" }
      }
      if (
        entry.status === "downloading" ||
        entry.status === "installing" ||
        entry.status === "awaiting_approval"
      ) {
        return {
          ...entry,
          status: "failed" as const,
          lastAction: cancelled ? "已停止" : "流程未完成",
        }
      }
      return entry
    })
    const summary = cancelled
      ? "环境任务已停止。"
      : finalizeEnvironmentSummary(runningEntries, snapshot.mode)
    this.environmentSnapshot = {
      ...snapshot,
      running: false,
      status: cancelled ? "canceled" : "completed",
      summary,
      completedAt,
      entries: runningEntries,
      approvals: [],
      lastRunSummary: summary,
      lastRunCompletedAt: completedAt,
      lastRunStatus: cancelled ? "canceled" : "completed",
    }
    this.activeEnvironmentRun = undefined
    post({ type: "environment.snapshot", payload: this.environmentSnapshot })
  }

  private async refreshEnvironmentSessionList(post: PostMessage): Promise<void> {
    try {
      await this.sessionCoordinator.syncDueSessionSnapshots(post)
      await this.sessionCoordinator.refreshSessions()
      this.emitSessionMessage({
        type: "session.list",
        sessions: this.sessionCoordinator.list,
        fingerprint: this.sessionCoordinator.fingerprint,
      }, post)
    } catch {
      // Session history refresh should not mask the environment run result.
    }
  }

  private async startChat(
    text: string,
    requestedSessionId: string | undefined,
    post: PostMessage,
    options: {
      mode?: string
      workflowMode?: string
      taskflowId?: string
      draftSessionId?: string
      providerId?: string
      modelId?: string
      parameters?: Record<string, unknown>
    } = {}
  ): Promise<void> {
    try {
      this.chatRunCoordinator.setActiveDraftSessionId(options.draftSessionId)
      const preparedSession = await this.sessionCoordinator.prepareChatSession(
        requestedSessionId,
        post,
        options
      )
      if (!preparedSession.ok) {
        this.chatRunCoordinator.clearActiveDraftSessionId()
        return
      }
      let sessionId = preparedSession.sessionId
      this.emitChatMessage({ type: "chat.started", text }, post)
      const start = await this.client.startChat(text, sessionId, options)
      const chatId = String(start.chat_id || "")
      this.chatRunCoordinator.setActiveRun({
        chatId,
        cursor: 0,
        sessionId,
        draftSessionId: options.draftSessionId,
        status: "running",
        startedAt: new Date().toISOString(),
        reconnectAttempts: 0,
        lastStreamAt: new Date().toISOString(),
      })
      this.emitChatMessage({ type: "chat.session", chatId, sessionId }, post)
      let cursor = 0
      while (!this.disposed) {
        if (this.chatRunCoordinator.activeRun?.chatId !== chatId) {
          break
        }
        let stream: Record<string, unknown>
        try {
          stream = await this.client.streamChat(chatId, cursor, 2)
          const reconnecting = this.chatRunCoordinator.activeRun?.status === "reconnecting"
          this.chatRunCoordinator.patchActiveRun({
            status: "running",
            reconnectAttempts: 0,
            reconnectStartedAt: undefined,
            lastError: undefined,
            nextRetryAt: undefined,
            lastStreamAt: new Date().toISOString(),
          })
          if (reconnecting && this.chatRunCoordinator.activeRun) {
            this.emitChatMessage(
              {
                type: "chat.reconnected",
                chatId,
                payload: this.chatRunCoordinator.activeRunPayload(),
              },
              post
            )
          }
        } catch (error) {
          const activeRun = this.chatRunCoordinator.activeRun
          if (
            activeRun?.chatId === chatId &&
            classifyRemoteError(error) === "transient_network" &&
            canRetryChatStream(activeRun)
          ) {
            const delayMs = retryDelayForChatRun(activeRun)
            const reconnectStartedAt = activeRun.reconnectStartedAt ?? Date.now()
            const next = this.chatRunCoordinator.patchActiveRun({
              status: "reconnecting",
              reconnectAttempts: activeRun.reconnectAttempts + 1,
              reconnectStartedAt,
              lastError: errorMessage(error),
              nextRetryAt: Date.now() + delayMs,
            })
            this.emitChatMessage(
              {
                type: "chat.reconnecting",
                chatId,
                message: errorMessage(error),
                payload: next ? this.chatRunCoordinator.activeRunPayload() : undefined,
              },
              post
            )
            await delay(delayMs)
            continue
          }
          throw error
        }
        const events = Array.isArray(stream.events) ? stream.events : []
        const nextCursor = Number(stream.next_cursor ?? cursor)
        if (events.length) {
          for (const event of events) {
            if (
              event &&
              event.type === "remote_peer_ready" &&
              typeof event.payload === "object" &&
              event.payload
            ) {
              const remoteSessionId = stringValue(
                (event.payload as Record<string, unknown>).session_id
              )
              if (remoteSessionId && sessionId && remoteSessionId !== sessionId) {
                this.emitChatMessage({
                  type: "chat.error",
                  message: `会话绑定异常：当前会话 ${sessionId}，远端返回 ${remoteSessionId}。`,
                }, post)
                this.chatRunCoordinator.clearActiveRun()
                return
              }
              const currentSessionId = await this.sessionCoordinator.adoptRemoteSession(
                remoteSessionId,
                sessionId,
                this.chatRunCoordinator.activeDraftSessionId,
                post
              )
              this.chatRunCoordinator.patchActiveRun({
                sessionId: currentSessionId,
                draftSessionId: undefined,
              })
            }
          }
          for (const event of events) {
            if (event && event.type === "approval_request") {
              await this.approvalDocuments.store(objectValue(event.payload))
            }
          }
          this.emitChatMessage({ type: "chat.events", chatId, events }, post)
        }
        cursor = nextCursor
        this.chatRunCoordinator.patchActiveRun({
          cursor,
          lastStreamAt: new Date().toISOString(),
        })
        if (stream.done) {
          await this.sessionCoordinator.reloadCurrentAfterChatDone(post)
          this.emitChatMessage({ type: "chat.done", chatId }, post)
          if (this.chatRunCoordinator.activeRun?.chatId === chatId) {
            this.chatRunCoordinator.setActiveRun(undefined)
          }
          this.chatRunCoordinator.clearActiveDraftSessionId()
          break
        }
      }
    } catch (error) {
      this.emitChatMessage({ type: "chat.error", message: chatErrorMessage(error) }, post)
      await this.postConnectionStateIfAuthRequired(error, post)
      this.chatRunCoordinator.clearActiveRun()
    }
  }

  private async cancelChat(chatId: string | undefined, post: PostMessage): Promise<void> {
    const targetChatId = chatId || this.chatRunCoordinator.activeChatId
    if (!targetChatId) {
      post({ type: "chat.error", message: "当前没有正在运行的会话。" })
      return
    }
    try {
      await this.client.cancelChat(targetChatId, "user_cancelled")
      if (this.chatRunCoordinator.activeRun?.chatId === targetChatId) {
        this.chatRunCoordinator.setActiveRun(undefined)
      }
      this.chatRunCoordinator.clearActiveDraftSessionId()
      this.emitChatMessage({ type: "chat.cancelled", chatId: targetChatId, reason: "user_cancelled" }, post)
    } catch (error) {
      post({ type: "chat.error", message: `停止失败：${errorMessage(error)}` })
    }
  }

  private async runAdminAction(
    post: PostMessage,
    action: () => Promise<Record<string, unknown>>
  ): Promise<boolean> {
    try {
      post({ type: "admin.actionResult", payload: await action() })
      return true
    } catch (error) {
      post({ type: "admin.error", message: errorMessage(error) })
      return false
    }
  }

  private async runToolchainAction(
    post: PostMessage,
    action: () => Promise<Record<string, unknown>>
  ): Promise<boolean> {
    try {
      post({ type: "toolchain.actionResult", payload: await action() })
      return true
    } catch (error) {
      post({ type: "toolchain.error", message: errorMessage(error) })
      return false
    }
  }

  private async openFileTarget(pathValue: string, line?: number, column?: number): Promise<void> {
    const resolved = resolveWorkspacePath(pathValue)
    if (!resolved) {
      void vscode.window.showWarningMessage("无法打开文件：没有可用的工作区路径。")
      return
    }
    if (!fs.existsSync(resolved)) {
      void vscode.window.showWarningMessage(`无法打开文件：${resolved} 不存在。`)
      return
    }

    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(resolved))
    const editor = await vscode.window.showTextDocument(document, {
      preview: false,
      viewColumn: vscode.ViewColumn.Active,
    })
    if (line && line > 0) {
      const position = new vscode.Position(
        Math.min(document.lineCount - 1, Math.max(0, line - 1)),
        Math.max(0, (column || 1) - 1)
      )
      editor.selection = new vscode.Selection(position, position)
      editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenterIfOutsideViewport)
    }
  }

  dispose(): void {
    this.disposed = true
    this.chatRunCoordinator.clearActiveRun()
    this.sessionCoordinator.dispose()
    void this.client.stopPeer()
  }
}

function contextVersion(context: vscode.ExtensionContext): string {
  return String(context.extension.packageJSON?.version || "0.1.0")
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined
}

function textValue(value: unknown, fallback = ""): string {
  return stringValue(value) ?? fallback
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return undefined
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {}
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function retryDelayForChatRun(run: ActiveChatRun): number {
  return CHAT_STREAM_RETRY_DELAYS_MS[
    Math.min(run.reconnectAttempts, CHAT_STREAM_RETRY_DELAYS_MS.length - 1)
  ]
}

function canRetryChatStream(run: ActiveChatRun): boolean {
  const startedAt = run.reconnectStartedAt ?? Date.now()
  return Date.now() - startedAt <= CHAT_STREAM_RECOVERY_DEADLINE_MS
}

function resolveWorkspacePath(pathValue: string): string | undefined {
  const clean = pathValue.trim().replace(/\//g, path.sep)
  if (!clean) return undefined
  if (path.isAbsolute(clean) || /^[A-Za-z]:[\\/]/.test(clean)) {
    return path.normalize(clean)
  }
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
  if (!workspaceRoot) return undefined
  return path.resolve(workspaceRoot, clean)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function chatErrorMessage(error: unknown): string {
  if (classifyRemoteError(error) === "auth_required") {
    return "登录已失效，请重新登录。"
  }
  return errorMessage(error)
}

function postAuthError(post: (message: Record<string, unknown>) => void, error: unknown): void {
  const message = errorMessage(error)
  const payload: Record<string, unknown> = { message }
  if (isRemoteError(error)) {
    payload.status = error.status
    payload.code = error.code
    payload.body = error.body
  }
  post({ type: "auth.error", message, payload })
}

function createEmptyEnvironmentSnapshot(): EnvironmentSnapshot {
  return {
    mode: null,
    running: false,
    status: "idle",
    summary: "环境清单尚未加载。",
    entries: [],
    approvals: [],
    logs: [],
  }
}

function environmentRunHistory(snapshot: EnvironmentSnapshot): Pick<
  EnvironmentSnapshot,
  "lastRunSummary" | "lastRunCompletedAt" | "lastRunStatus"
> {
  if (snapshot.lastRunSummary || snapshot.lastRunCompletedAt || snapshot.lastRunStatus) {
    return {
      lastRunSummary: snapshot.lastRunSummary,
      lastRunCompletedAt: snapshot.lastRunCompletedAt,
      lastRunStatus: snapshot.lastRunStatus,
    }
  }
  if (!snapshot.running && snapshot.status !== "idle" && snapshot.summary) {
    return {
      lastRunSummary: snapshot.summary,
      lastRunCompletedAt: snapshot.completedAt,
      lastRunStatus:
        snapshot.status === "completed" ||
        snapshot.status === "error" ||
        snapshot.status === "canceled"
          ? snapshot.status
          : undefined,
    }
  }
  return {}
}

function normalizeEnvironmentManifest(payload: Record<string, unknown>): Record<string, unknown> {
  return {
    cli_tools: Array.isArray(payload.cli_tools) ? payload.cli_tools : [],
    mcp_servers: Array.isArray(payload.mcp_servers) ? payload.mcp_servers : [],
    skills: Array.isArray(payload.skills) ? payload.skills : [],
    loadedAt: new Date().toISOString(),
  }
}

function buildEnvironmentEntries(
  manifest: Record<string, unknown>
): EnvironmentEntryState[] {
  const cliEntries = (Array.isArray(manifest.cli_tools) ? manifest.cli_tools : [])
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
    .map((item) => ({
      id: environmentEntryId("cli", stringValue(item.name) || ""),
      kind: "cli" as const,
      name: stringValue(item.name) || "",
      description: stringValue(item.description) || "",
      source: stringValue(item.source) || "",
      version: stringValue(item.version) || undefined,
      check: stringValue(item.check) || "",
      install: stringValue(item.install) || "",
      command: stringValue(item.command) || "",
      tags: toStringArray(item.tags),
      status: "unchecked" as const,
    }))
  const mcpEntries = (Array.isArray(manifest.mcp_servers) ? manifest.mcp_servers : [])
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
    .map((item) => ({
      id: environmentEntryId("mcp", stringValue(item.name) || ""),
      kind: "mcp" as const,
      name: stringValue(item.name) || "",
      description: stringValue(item.description) || "",
      source: stringValue(item.source) || "",
      version: stringValue(item.version) || undefined,
      check: stringValue(item.check) || "",
      install: stringValue(item.install) || "",
      command: stringValue(item.command) || "",
      tags: [
        stringValue(item.placement) || "",
        stringValue(item.distribution) || "",
      ].filter(Boolean),
      status: "unchecked" as const,
    }))
  const skillEntries = (Array.isArray(manifest.skills) ? manifest.skills : [])
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
    .map((item) => ({
      id: environmentEntryId("skill", stringValue(item.name) || ""),
      kind: "skill" as const,
      name: stringValue(item.name) || "",
      description: stringValue(item.description) || "",
      source: stringValue(item.source) || "",
      version: stringValue(item.version) || undefined,
      check: stringValue(item.check) || "",
      install: stringValue(item.install) || "",
      command: stringValue(item.path_hint) || "",
      tags: [stringValue(item.scope) || "project"].filter(Boolean),
      status: "unchecked" as const,
      detail: stringValue(item.path_hint) || undefined,
    }))
  return [...cliEntries, ...mcpEntries, ...skillEntries]
}

function filterEnvironmentManifest(
  manifest: Record<string, unknown>,
  entryIds: string[] | undefined
): Record<string, unknown> {
  if (!entryIds?.length) return manifest
  const ids = new Set(entryIds)
  const cliTools = filterManifestItems(manifest.cli_tools, "cli", ids)
  const mcpServers = filterManifestItems(manifest.mcp_servers, "mcp", ids)
  const skills = filterManifestItems(manifest.skills, "skill", ids)
  return {
    ...manifest,
    cli_tools: cliTools,
    mcp_servers: mcpServers,
    skills,
  }
}

function filterManifestItems(
  value: unknown,
  kind: EnvironmentEntryKind,
  ids: Set<string>
): Record<string, unknown>[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
    .filter((item) => ids.has(environmentEntryId(kind, stringValue(item.name) || "")))
}

function buildToolchainIngestPrompt(input: Record<string, unknown>): string {
  const repoUrl = stringValue(input.repoUrl)
  const docsUrl = stringValue(input.docsUrl)
  const docsText = stringValue(input.docsText)
  const kindHint = stringValue(input.kindHint)
  const nameHint = stringValue(input.nameHint)
  const placementHint = stringValue(input.placementHint)
  return [
    "You are the Labrastro capability intake agent.\n",
    "Your only responsibility is to read the repository/documentation context supplied by the user and produce one strict JSON object for the capability manifest candidate.\n",
    "Before deriving fields, call `fetch_capabilities` for every user-provided repository or documentation URL. Treat it as the server-side read-only source reader for capability evidence.\n",
    "If only a documentation URL is provided, work from that source. A repository URL is optional; when fetched documentation reveals an official GitHub/Git/package source link, call `fetch_capabilities` for that source too when it can improve evidence.\n",
    "When the fetched page is an index/navigation page or does not provide enough evidence for install/check/placement, follow relevant same-site documentation links returned by `fetch_capabilities`, especially install, setup, configure, authentication, requirements, CLI, MCP, SDK, and reference pages. If the page advertises an `llms.txt` documentation index, fetch it to discover the precise pages before continuing.\n",
    "Use the normal agent tool/event/logging path for `fetch_capabilities` calls. Do not use browser rendering, shell curl, regex-style guessing, or fallback heuristics when documentation is unreadable or incomplete.\n",
    "Infer the deployment placement/scope from the repository and documentation: whether the tool can run on the server, must be installed on the local peer, needs both sides, or is a user/project skill. Treat the user's deployment hint only as an optional clue.\n",
    "Every inferred field must cite evidence returned by `fetch_capabilities`, including heading/anchor/source_url/content_hash/fetched_at when available. If the evidence cannot support a field, including placement/scope, return `needs_review: true` with a concise `reason` and preserve the evidence you did find. Do not invent commands.\n\n",
    `Repository URL: ${repoUrl || "(optional; may be discovered from docs)"}\n`,
    `Documentation URL: ${docsUrl || "(not provided)"}\n`,
    `Kind hint: ${kindHint || "(none)"}\n`,
    `Name hint: ${nameHint || "(none)"}\n`,
    `Optional deployment hint: ${placementHint || "(none; infer from docs)"}\n`,
    `User supplied documentation text:\n${docsText || "(none)"}\n\n`,
    "Return JSON only. Required schema:\n",
    "{\n",
    '  "kind": "cli | mcp | skill",\n',
    '  "name": "tool name",\n',
    '  "alias": "optional display alias",\n',
    '  "description": "short purpose",\n',
    '  "source": "package/source label",\n',
    '  "repo_url": "repository URL",\n',
    '  "docs": [{"title": "doc title", "url": "doc URL"}],\n',
    '  "evidence": [{"field": "check/install/placement/credentials/risk", "title": "source title", "url": "source URL", "excerpt": "short source-backed evidence", "heading": "source heading", "anchor": "#anchor", "source_url": "exact fetched source", "content_hash": "sha256", "fetched_at": "ISO timestamp"}],\n',
    '  "placement": "server | local | both for CLI, server | peer | both for MCP",\n',
    '  "scope": "user | project for skill",\n',
    '  "command": "primary command or executable; MCP launch command when kind=mcp",\n',
    '  "args": ["optional MCP args"],\n',
    '  "env": {"KEY": "optional MCP env placeholder"},\n',
    '  "cwd": "optional MCP working directory",\n',
    '  "path_hint": "optional skill path",\n',
    '  "check": "exact check command",\n',
    '  "install": "exact install command",\n',
    '  "requirements": {"dependency": "version/range"},\n',
    '  "credentials": ["credential or token names"],\n',
    '  "risk_level": "low | medium | high",\n',
    '  "install_prompt": "approval-facing install rationale",\n',
    '  "verify_prompt": "post-install verification note",\n',
    '  "notes": ["operator note"],\n',
    '  "needs_review": false,\n',
    '  "reason": ""\n',
    "}\n",
  ].join("")
}

function toolchainIngestAssistantText(event: Record<string, unknown>): string {
  const type = stringValue(event.type)
  const payload = objectValue(event.payload)
  if (type === "assistant_delta" || type === "assistant_message") {
    return textValue(payload.content)
  }
  return ""
}

function toolchainIngestChatEndResponse(event: Record<string, unknown>): string {
  if (stringValue(event.type) !== "chat_end") return ""
  return textValue(objectValue(event.payload).response)
}

function toolchainIngestEventLog(
  event: Record<string, unknown>
): { level: "info" | "warning" | "error"; message: string; eventType: string } | undefined {
  const type = stringValue(event.type)
  const payload = objectValue(event.payload)
  if (type === "assistant_delta") return undefined
  if (type === "assistant_message") {
    return { level: "info", message: "Agent 已返回结构化候选内容。", eventType: type }
  }
  if (type === "tool_call_start") {
    return {
      level: "info",
      message: `调用工具：${textValue(payload.tool_name, "tool")}`,
      eventType: type,
    }
  }
  if (type === "tool_call_end") {
    return {
      level: payload.tool_success === false ? "warning" : "info",
      message: `工具完成：${textValue(payload.tool_name, "tool")}`,
      eventType: type,
    }
  }
  if (type === "output") {
    const content = textValue(payload.content).trim()
    if (!content) return undefined
    return { level: "info", message: truncateText(content, 240), eventType: type }
  }
  if (type === "error") {
    return {
      level: "error",
      message: textValue(payload.message, "新增能力 Agent 执行失败。"),
      eventType: type,
    }
  }
  if (type === "chat_end") {
    return { level: "info", message: "新增能力 Agent 已结束。", eventType: type }
  }
  return undefined
}

function parseToolchainIngestResponse(rawResponse: string): Record<string, unknown> {
  const parsed = parseJsonObjectFromText(rawResponse)
  const candidate = objectValue(parsed.candidate)
  if (Object.keys(candidate).length) return candidate
  const candidates = Array.isArray(parsed.candidates) ? parsed.candidates : []
  const first = candidates.find((item) => item && typeof item === "object" && !Array.isArray(item))
  if (first && typeof first === "object") return first as Record<string, unknown>
  return parsed
}

function parseJsonObjectFromText(text: string): Record<string, unknown> {
  const trimmed = text.trim()
  if (!trimmed) {
    throw new Error("新增能力 Agent 没有返回 JSON。")
  }
  try {
    const parsed = JSON.parse(trimmed)
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {
    // Continue to fenced/block extraction below.
  }
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenced?.[1]) {
    const parsed = JSON.parse(fenced[1].trim())
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  }
  const firstBrace = trimmed.indexOf("{")
  const lastBrace = trimmed.lastIndexOf("}")
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    const parsed = JSON.parse(trimmed.slice(firstBrace, lastBrace + 1))
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  }
  throw new Error("新增能力 Agent 返回内容不是可解析的 JSON 对象。")
}

function validateToolchainIngestCandidate(
  candidate: Record<string, unknown>
): { ok: true; kind: EnvironmentEntryKind } | { ok: false; error: string } {
  if (candidate.needs_review === true) {
    return { ok: false, error: textValue(candidate.reason, "解析结果需要人工确认。") }
  }
  const kind = textValue(candidate.kind).toLowerCase()
  if (!["cli", "mcp", "skill"].includes(kind)) {
    return { ok: false, error: "解析结果缺少合法 kind：cli | mcp | skill。" }
  }
  const name = textValue(candidate.name).trim()
  if (!name) return { ok: false, error: "解析结果缺少工具名称。" }
  const docs = Array.isArray(candidate.docs) ? candidate.docs : []
  const evidence = Array.isArray(candidate.evidence) ? candidate.evidence : []
  if (!docs.length && !evidence.length) {
    return { ok: false, error: "解析结果缺少仓库/文档证据。" }
  }
  if (!textValue(candidate.check).trim()) {
    return { ok: false, error: "解析结果缺少检查命令。" }
  }
  if (!textValue(candidate.install).trim()) {
    return { ok: false, error: "解析结果缺少安装命令。" }
  }
  if ((kind === "cli" || kind === "mcp") && !textValue(candidate.command).trim()) {
    return { ok: false, error: "解析结果缺少主命令。" }
  }
  if (kind === "cli") {
    const placement = textValue(candidate.placement)
    if (!["server", "local", "both"].includes(placement)) {
      return { ok: false, error: "CLI 部署属性必须是 server、local 或 both。" }
    }
  }
  if (kind === "mcp") {
    const placement = textValue(candidate.placement)
    if (!["server", "peer", "both"].includes(placement)) {
      return { ok: false, error: "MCP 部署属性必须是 server、peer 或 both。" }
    }
  }
  if (kind === "skill") {
    const scope = textValue(candidate.scope)
    if (!["user", "project"].includes(scope)) {
      return { ok: false, error: "Skill 范围必须是 user 或 project。" }
    }
  }
  return { ok: true, kind: kind as EnvironmentEntryKind }
}

function toolchainPayloadFromIngestCandidate(
  candidate: Record<string, unknown>
): Record<string, unknown> {
  const kind = textValue(candidate.kind).toLowerCase()
  const payload: Record<string, unknown> = {
    name: textValue(candidate.name).trim(),
    enabled: candidate.enabled !== false,
    check: textValue(candidate.check).trim(),
    install: textValue(candidate.install).trim(),
    version: textValue(candidate.version) || undefined,
    source: textValue(candidate.source),
    description: textValue(candidate.description),
    repo_url: textValue(candidate.repo_url),
    docs: normalizeToolchainDocs(candidate.docs),
    evidence: normalizeToolchainEvidence(candidate.evidence),
    requirements: stringMap(candidate.requirements),
    credentials: toStringArray(candidate.credentials),
    risk_level: textValue(candidate.risk_level),
    install_prompt: textValue(candidate.install_prompt),
    verify_prompt: textValue(candidate.verify_prompt),
    notes: toStringArray(candidate.notes),
    last_action: "document_ingest",
    last_updated: new Date().toISOString(),
  }
  if (kind === "cli") {
    payload.command = textValue(candidate.command).trim()
    payload.placement = textValue(candidate.placement)
    payload.tags = toStringArray(candidate.tags)
  } else if (kind === "mcp") {
    payload.command = textValue(candidate.command).trim()
    payload.args = toStringArray(candidate.args)
    payload.env = stringMap(candidate.env)
    payload.cwd = textValue(candidate.cwd) || undefined
    payload.placement = textValue(candidate.placement)
    payload.distribution = textValue(candidate.distribution, "command")
  } else {
    payload.scope = textValue(candidate.scope)
    payload.path_hint = textValue(candidate.path_hint) || undefined
  }
  return payload
}

function normalizeToolchainDocs(value: unknown): Array<{ title: string; url: string }> {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
    .map((item) => ({
      title: textValue(item.title),
      url: textValue(item.url),
    }))
    .filter((item) => item.title || item.url)
}

function normalizeToolchainEvidence(value: unknown): Record<string, string>[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
    .map((item) =>
      Object.entries(item).reduce<Record<string, string>>((acc, [key, val]) => {
        const text = textValue(val).trim()
        if (text) acc[key] = text
        return acc
      }, {})
    )
    .filter((item) => Object.keys(item).length > 0)
}

function stringMap(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  return Object.entries(value as Record<string, unknown>).reduce<Record<string, string>>(
    (acc, [key, val]) => {
      acc[key] = textValue(val)
      return acc
    },
    {}
  )
}

function environmentEntrySummary(entries: EnvironmentEntryState[]): string {
  if (!entries.length) {
    return "当前服务器没有可展示的环境条目。"
  }
  const counts = summarizeEnvironmentEntries(entries)
  return `共 ${entries.length} 项：可用 ${counts.available}，缺失 ${counts.missing}。`
}

function finalizeEnvironmentSummary(
  entries: EnvironmentEntryState[],
  mode: EnvironmentRunMode | null
): string {
  const counts = summarizeEnvironmentEntries(entries)
  if (mode === "configure") {
    return `环境配置完成：已配置 ${counts.configured}，可用 ${counts.available}，失败 ${counts.failed}，缺失 ${counts.missing}。`
  }
  return `环境检查完成：可用 ${counts.available}，已配置 ${counts.configured}，缺失 ${counts.missing}，失败 ${counts.failed}。`
}

function environmentEventDetail(payload: Record<string, unknown>): string {
  return (
    stringValue(payload.error) ||
    stringValue(payload.output) ||
    stringValue(payload.detail) ||
    stringValue(payload.command) ||
    ""
  )
}

function summarizeEnvironmentEntries(entries: EnvironmentEntryState[]): Record<string, number> {
  const summary = {
    available: 0,
    configured: 0,
    missing: 0,
    failed: 0,
  }
  for (const entry of entries) {
    if (entry.status === "available") summary.available += 1
    if (entry.status === "configured") summary.configured += 1
    if (entry.status === "missing") summary.missing += 1
    if (entry.status === "failed") summary.failed += 1
  }
  return summary
}

function environmentEntryId(kind: EnvironmentEntryKind, name: string): string {
  return `${kind}:${name}`
}

function truncateText(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value
  return `${value.slice(0, maxChars - 1)}...`
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item)).filter(Boolean) : []
}
