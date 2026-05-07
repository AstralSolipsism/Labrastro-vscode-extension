import * as vscode from "vscode"
import * as fs from "fs"
import * as path from "path"
import { BackendCapabilities, LabrastroRemoteClient, isRemoteError } from "./LabrastroRemoteClient"
import { canStartSessionlessChat, LEGACY_BACKEND_UPGRADE_MESSAGE } from "./session-start"

type PostMessage = (message: Record<string, unknown>) => Thenable<boolean> | void
type EnvironmentRunMode = "check" | "configure"
type EnvironmentEntryKind = "cli" | "mcp" | "skill"
type AutoApprovalOptionKey = "readOnly" | "write" | "delete" | "execute" | "mcp" | "unknown"
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

interface SessionMetadataState {
  id: string
  model: string
  savedAt: string
  preview: string
  fingerprint: string
}

interface AutoApprovalState {
  options: Record<AutoApprovalOptionKey, boolean>
  allowedCommands: string[]
  deniedCommands: string[]
  platform: NodeJS.Platform
}

const AUTO_APPROVAL_STATE_KEY = "labrastro.autoApproval"
const DEFAULT_AUTO_APPROVAL_OPTIONS: Record<AutoApprovalOptionKey, boolean> = {
  readOnly: false,
  write: false,
  delete: false,
  execute: false,
  mcp: false,
  unknown: false,
}

export class LabrastroController implements vscode.Disposable {
  private readonly client: LabrastroRemoteClient
  private readonly approvalDocuments: ApprovalDocumentProvider
  private activeChatId: string | undefined
  private currentSessionId: string | undefined
  private backendCapabilities: BackendCapabilities | null | undefined
  private sessionApiAvailable: boolean | undefined
  private sessionFingerprint: string | undefined
  private sessionListEtag: string | undefined
  private sessionInitialization: Promise<void> | undefined
  private sessionInitializationToken = 0
  private sessions: SessionMetadataState[] = []
  private toolchainState: Record<string, unknown> | undefined
  private environmentManifest: Record<string, unknown> | undefined
  private environmentSnapshot: EnvironmentSnapshot = createEmptyEnvironmentSnapshot()
  private activeEnvironmentRun: ActiveEnvironmentRun | undefined
  private activeToolchainIngestChatId: string | undefined
  private readonly webviewPosts = new Set<PostMessage>()
  private disposed = false

  constructor(private readonly context: vscode.ExtensionContext) {
    this.client = new LabrastroRemoteClient(context)
    this.approvalDocuments = new ApprovalDocumentProvider()
    this.context.subscriptions.push(
      vscode.workspace.registerTextDocumentContentProvider(
        ApprovalDocumentProvider.scheme,
        this.approvalDocuments
      )
    )
  }

  registerWebviewPost(post: PostMessage): vscode.Disposable {
    this.webviewPosts.add(post)
    return {
      dispose: () => {
        this.webviewPosts.delete(post)
      },
    }
  }

  async postInitialState(
    post: PostMessage,
    options: { initializeSession?: boolean } = {}
  ): Promise<void> {
    const startedAt = Date.now()
    post({
      type: "ready",
      extensionVersion: contextVersion(this.context),
      workspaceDirectory: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
      platform: process.platform,
    })
    post({ type: "autoApproval.state", payload: this.getAutoApprovalState() })
    post({ type: "connection.state", payload: this.client.startupConnectionState() })
    post({ type: "environment.snapshot", payload: this.environmentSnapshot })
    post({ type: "executorType.state", payload: this.getExecutorType() })
    post({ type: "locale.state", locale: this.context.workspaceState.get<string>("labrastro.locale") || vscode.env.language })
    post({
      type: "startup.metric",
      payload: { name: "initial-state-ready", elapsedMs: Date.now() - startedAt },
    })
    void this.refreshInitialStateInBackground(post, startedAt, {
      initializeSession: options.initializeSession !== false,
    })
  }

  private async refreshInitialStateInBackground(
    post: PostMessage,
    startedAt: number,
    options: { initializeSession: boolean }
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

    const tasks = [
      run("connection-state", () => this.postConnectionState(post)),
      run("admin-state", () => this.postAdminState(post)),
      run("backend-capabilities", () => this.refreshBackendCapabilities(post)),
    ]
    if (options.initializeSession) {
      tasks.push(run("session-initialize", () => this.initializeSessionState(post)))
    }

    await Promise.allSettled(tasks)

    if (this.toolchainState) {
      post({ type: "toolchain.state", payload: this.toolchainState })
    }
    if (this.environmentManifest) {
      post({ type: "environment.manifest", payload: this.environmentManifest })
    }
  }

  async handleMessage(
    message: Record<string, unknown>,
    post: PostMessage
  ): Promise<boolean> {
    switch (message.type) {
      case "connection.login":
        {
          const state = await this.client.login({
            hostUrl: stringValue(message.hostUrl),
            username: stringValue(message.username) || "",
            password: stringValue(message.password) || "",
          })
          post({ type: "connection.result", payload: state })
          post({ type: "connection.state", payload: state })
        }
        await this.postAdminState(post)
        await this.refreshBackendCapabilities(post)
        return true
      case "connection.logout":
        {
          const state = await this.client.logout()
          post({ type: "connection.result", payload: state })
          post({ type: "connection.state", payload: state })
        }
        await this.postAdminState(post)
        return true
      case "connection.host.save":
        {
          const state = await this.client.saveHostUrl(stringValue(message.hostUrl) || "")
          post({ type: "connection.result", payload: state })
          post({ type: "connection.state", payload: state })
        }
        return true
      case "auth.password.change":
        try {
          const payload = await this.client.authPasswordChange(
            stringValue(message.currentPassword) || stringValue(message.current_password) || "",
            stringValue(message.newPassword) || stringValue(message.new_password) || ""
          )
          post({ type: "auth.actionResult", payload })
        } catch (error) {
          post({ type: "auth.error", message: errorMessage(error) })
        }
        return true
      case "auth.users.list":
        try {
          post({ type: "auth.users", payload: await this.client.authUsersList() })
        } catch (error) {
          post({ type: "auth.error", message: errorMessage(error) })
        }
        return true
      case "auth.users.create":
        try {
          const payload = await this.client.authUsersCreate(objectValue(message.payload))
          post({ type: "auth.actionResult", payload })
          post({ type: "auth.users", payload: await this.client.authUsersList() })
        } catch (error) {
          post({ type: "auth.error", message: errorMessage(error) })
        }
        return true
      case "auth.users.update":
        try {
          const payload = await this.client.authUsersUpdate(objectValue(message.payload))
          post({ type: "auth.actionResult", payload })
          post({ type: "auth.users", payload: await this.client.authUsersList() })
        } catch (error) {
          post({ type: "auth.error", message: errorMessage(error) })
        }
        return true
      case "auth.users.disable":
        try {
          const payload = await this.client.authUsersDisable(stringValue(message.userId) || stringValue(message.user_id) || "")
          post({ type: "auth.actionResult", payload })
          post({ type: "auth.users", payload: await this.client.authUsersList() })
        } catch (error) {
          post({ type: "auth.error", message: errorMessage(error) })
        }
        return true
      case "auth.users.resetPassword":
        try {
          const payload = await this.client.authUsersResetPassword(
            stringValue(message.userId) || stringValue(message.user_id) || "",
            stringValue(message.password) || ""
          )
          post({ type: "auth.actionResult", payload })
          post({ type: "auth.users", payload: await this.client.authUsersList() })
        } catch (error) {
          post({ type: "auth.error", message: errorMessage(error) })
        }
        return true
      case "auth.devices.list":
        try {
          post({ type: "auth.devices", payload: await this.client.authDevicesList(stringValue(message.userId) || stringValue(message.user_id)) })
        } catch (error) {
          post({ type: "auth.error", message: errorMessage(error) })
        }
        return true
      case "auth.devices.revoke":
        try {
          const payload = await this.client.authDevicesRevoke(stringValue(message.deviceId) || stringValue(message.device_id) || "")
          post({ type: "auth.actionResult", payload })
          post({ type: "auth.devices", payload: await this.client.authDevicesList() })
        } catch (error) {
          post({ type: "auth.error", message: errorMessage(error) })
        }
        return true
      case "auth.audit.list":
        try {
          post({ type: "auth.audit", payload: await this.client.authAuditList(objectValue(message.payload)) })
        } catch (error) {
          post({ type: "auth.error", message: errorMessage(error) })
        }
        return true
      case "autoApproval.get":
        post({ type: "autoApproval.state", payload: this.getAutoApprovalState() })
        return true
      case "autoApproval.update":
        await this.updateAutoApprovalState(message)
        this.broadcastAutoApprovalState()
        return true
      case "admin.refresh":
        await this.postConnectionState(post)
        await this.postAdminState(post)
        return true
      case "serverSettings.read":
        try {
          post({ type: "serverSettings.state", payload: await this.client.serverSettingsRead() })
        } catch (error) {
          post({ type: "serverSettings.error", message: errorMessage(error) })
        }
        return true
      case "serverSettings.update":
        try {
          const payload = await this.client.serverSettingsUpdate(objectValue(message.payload))
          post({ type: "serverSettings.state", payload })
          post({ type: "admin.actionResult", payload })
          await this.postAdminState(post)
        } catch (error) {
          post({ type: "serverSettings.error", message: errorMessage(error) })
        }
        return true
      case "runtime.submit":
        try {
          const payload = this.runtimeSubmitPayload(objectValue(message.payload))
          post({ type: "runtime.task", payload: await this.client.runtimeSubmit(payload) })
        } catch (error) {
          post({ type: "runtime.error", message: errorMessage(error) })
        }
        return true
      case "runtime.events":
        try {
          post({ type: "runtime.events", payload: await this.client.runtimeEvents(objectValue(message.payload)) })
        } catch (error) {
          post({ type: "runtime.error", message: errorMessage(error) })
        }
        return true
      case "runtime.cancel":
        try {
          post({ type: "runtime.cancelled", payload: await this.client.runtimeCancel(objectValue(message.payload)) })
        } catch (error) {
          post({ type: "runtime.error", message: errorMessage(error) })
        }
        return true
      case "runtime.retry":
        try {
          post({ type: "runtime.task", payload: await this.client.runtimeRetry(objectValue(message.payload)) })
        } catch (error) {
          post({ type: "runtime.error", message: errorMessage(error) })
        }
        return true
      case "environment.refreshManifest":
        await this.refreshEnvironmentManifest(post)
        return true
      case "toolchain.refresh":
        await this.refreshToolchainState(post)
        return true
      case "toolchain.record":
        if (
          await this.runToolchainAction(post, () =>
            this.client.toolchainRecord(
              stringValue(message.kind) || "",
              objectValue(message.payload)
            )
          )
        ) {
          await this.refreshToolchainState(post)
          if (!this.activeEnvironmentRun) {
            await this.refreshEnvironmentManifest(post)
          }
        }
        return true
      case "toolchain.delete":
        if (
          await this.runToolchainAction(post, () =>
            this.client.toolchainDelete(
              stringValue(message.kind) || "",
              stringValue(message.name) || ""
            )
          )
        ) {
          await this.refreshToolchainState(post)
          if (!this.activeEnvironmentRun) {
            await this.refreshEnvironmentManifest(post)
          }
        }
        return true
      case "toolchain.enable":
        if (
          await this.runToolchainAction(post, () =>
            this.client.toolchainEnable(
              stringValue(message.kind) || "",
              stringValue(message.name) || "",
              Boolean(message.enabled)
            )
          )
        ) {
          await this.refreshToolchainState(post)
          if (!this.activeEnvironmentRun) {
            await this.refreshEnvironmentManifest(post)
          }
        }
        return true
      case "toolchain.ingest.run":
        void this.startToolchainIngest(objectValue(message.payload), post)
        return true
      case "toolchain.ingest.cancel":
        await this.cancelToolchainIngest(post)
        return true
      case "environment.run":
        if (message.mode === "check" || message.mode === "configure") {
          void this.startEnvironmentRun(
            message.mode,
            post,
            Array.isArray(message.entryIds)
              ? message.entryIds.map((item) => String(item)).filter(Boolean)
              : undefined,
            stringValue(message.agentId) || stringValue(message.agent_id)
          )
        }
        return true
      case "environment.cancel":
        await this.cancelEnvironmentRun(post)
        return true
      case "openFile":
        await this.openFileTarget(
          stringValue(message.path) || "",
          numberValue(message.line),
          numberValue(message.column)
        )
        return true
      case "provider.record":
        if (
          await this.runAdminAction(post, () =>
            this.client.providerRecord(objectValue(message.payload))
          )
        ) {
          await this.postAdminState(post)
        }
        return true
      case "provider.test":
        await this.runAdminAction(post, () =>
          this.client.providerTest(objectValue(message.payload))
        )
        return true
      case "provider.delete":
        if (
          await this.runAdminAction(post, () =>
            this.client.providerDelete(objectValue(message.payload))
          )
        ) {
          await this.postAdminState(post)
        }
        return true
      case "provider.copy":
        if (
          await this.runAdminAction(post, () =>
            this.client.providerCopy(objectValue(message.payload))
          )
        ) {
          await this.postAdminState(post)
        }
        return true
      case "provider.enable":
        if (
          await this.runAdminAction(post, () =>
            this.client.providerEnable(objectValue(message.payload))
          )
        ) {
          await this.postAdminState(post)
        }
        return true
      case "provider.models":
        if (
          await this.runAdminAction(post, () =>
            this.client.providerModels(objectValue(message.payload))
          )
        ) {
          await this.postAdminState(post)
        }
        return true
      case "modelProfile.save":
        if (
          await this.runAdminAction(post, () =>
            this.client.modelProfileRecord(objectValue(message.payload))
          )
        ) {
          await this.postAdminState(post)
        }
        return true
      case "modelProfile.activate":
        if (
          await this.runAdminAction(post, () =>
            this.client.modelProfileActivate(objectValue(message.payload))
          )
        ) {
          await this.postAdminState(post)
        }
        return true
      case "modelProfile.saveAndActivate":
        if (
          await this.runAdminAction(post, async () => {
            const payload = objectValue(message.payload)
            const saved = await this.client.modelProfileRecord(payload)
            const target = stringValue(message.target)
            if (target) {
              await this.client.modelProfileActivate({
                profile_id: stringValue(payload.profile_id) || stringValue(payload.id) || "",
                target,
              })
            }
            return saved
          })
        ) {
          await this.postAdminState(post)
        }
        return true
      case "session.initialize":
        await this.initializeSessionState(post)
        return true
      case "session.list":
        await this.postSessionList(post)
        return true
      case "session.load":
        await this.loadSession(stringValue(message.sessionId) || "", post)
        return true
      case "session.openInChat":
        {
          const sessionId = stringValue(message.sessionId) || ""
          if (!sessionId) {
            post({ type: "session.error", message: "缺少会话 ID。" })
            return true
          }
          await this.loadSession(sessionId, post)
          post({ type: "navigate", view: "chat" })
        }
        return true
      case "session.new":
        await this.createSession(post)
        return true
      case "session.delete":
        await this.deleteSession(stringValue(message.sessionId) || "", post)
        return true
      case "session.saveSnapshot":
        await this.saveSessionSnapshot(
          stringValue(message.sessionId) || "",
          objectValue(message.snapshot),
          stringValue(message.snapshotDigest) || stringValue(message.snapshot_digest),
          post
        )
        return true
      case "session.model.switch":
        await this.switchSessionMainModel(
          stringValue(message.sessionId),
          stringValue(message.providerId) || stringValue(message.provider_id) || "",
          stringValue(message.modelId) || stringValue(message.model_id) || "",
          objectValue(message.parameters),
          stringValue(message.requestId) || stringValue(message.request_id) || "",
          post
        )
        return true
      case "chat.send":
        if (typeof message.text === "string") {
          void this.startChat(message.text, stringValue(message.sessionId), post, {
            mode: stringValue(message.mode),
            workflowMode: stringValue(message.workflowMode) || stringValue(message.workflow_mode),
          })
        }
        return true
      case "chat.cancel":
        await this.cancelChat(stringValue(message.chatId), post)
        return true
      case "approval.reply":
        {
          const chatId =
            stringValue(message.chatId) ||
            this.activeChatId ||
            ""
          try {
            await this.client.approvalReply({
              chat_id: chatId,
              approval_id: stringValue(message.approvalId) || "",
              decision: stringValue(message.decision) || "deny_once",
              reason: stringValue(message.reason),
            })
          } catch (error) {
            const resolvedError = errorMessage(error)
            post({ type: "chat.error", message: resolvedError })
          }
        }
        return true
      case "approval.openDetails":
        await this.approvalDocuments.open(stringValue(message.approvalId) || "")
        return true
      case "executorType.save":
        await this.context.workspaceState.update("labrastro.executorType", {
          location: stringValue(message.location) || "remote",
          engine: stringValue(message.engine) || "labrastro",
        })
        this.broadcastExecutorType()
        return true
      case "executorType.get":
        post({ type: "executorType.state", payload: this.getExecutorType() })
        return true
      case "locale.save":
        await this.context.workspaceState.update("labrastro.locale", stringValue(message.locale) || "")
        return true
      default:
        return false
    }
  }

  private getAutoApprovalState(): AutoApprovalState {
    const stored = objectValue(this.context.workspaceState.get(AUTO_APPROVAL_STATE_KEY))
    return {
      options: sanitizeAutoApprovalOptions(stored.options),
      allowedCommands: sanitizeCommandRules(stored.allowedCommands),
      deniedCommands: sanitizeCommandRules(stored.deniedCommands),
      platform: process.platform,
    }
  }

  private async updateAutoApprovalState(message: Record<string, unknown>): Promise<void> {
    const current = this.getAutoApprovalState()
    const next: AutoApprovalState = {
      options: Object.prototype.hasOwnProperty.call(message, "options")
        ? sanitizeAutoApprovalOptions(message.options)
        : current.options,
      allowedCommands: Object.prototype.hasOwnProperty.call(message, "allowedCommands")
        ? sanitizeCommandRules(message.allowedCommands)
        : current.allowedCommands,
      deniedCommands: Object.prototype.hasOwnProperty.call(message, "deniedCommands")
        ? sanitizeCommandRules(message.deniedCommands)
        : current.deniedCommands,
      platform: process.platform,
    }
    await this.context.workspaceState.update(AUTO_APPROVAL_STATE_KEY, {
      options: next.options,
      allowedCommands: next.allowedCommands,
      deniedCommands: next.deniedCommands,
    })
  }

  private broadcastAutoApprovalState(): void {
    const payload = { type: "autoApproval.state", payload: this.getAutoApprovalState() }
    for (const post of this.webviewPosts) {
      this.postWebviewMessage(post, payload)
    }
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
    for (const post of this.webviewPosts) {
      this.postWebviewMessage(post, payload)
    }
  }

  private runtimeSubmitPayload(payload: Record<string, unknown>): Record<string, unknown> {
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
    try {
      const sent = post(payload)
      if (sent && typeof (sent as Thenable<boolean>).then === "function") {
        void (sent as Thenable<boolean>).then(undefined, () => {
          this.webviewPosts.delete(post)
        })
      }
    } catch {
      this.webviewPosts.delete(post)
    }
  }

  async postConnectionState(post: PostMessage): Promise<void> {
    try {
      post({ type: "connection.state", payload: await this.client.connectionState() })
    } catch (error) {
      post({
        type: "connection.state",
        payload: { status: "error", message: errorMessage(error) },
      })
    }
  }

  async postAdminState(post: PostMessage): Promise<void> {
    try {
      post({ type: "admin.state", payload: await this.client.adminStatus() })
    } catch (error) {
      post({ type: "admin.error", message: errorMessage(error) })
    }
  }

  private async refreshBackendCapabilities(post?: PostMessage): Promise<void> {
    try {
      this.backendCapabilities = await this.client.capabilities()
      post?.({ type: "backend.capabilities", payload: this.backendCapabilities })
    } catch {
      this.backendCapabilities = null
    }
  }

  private async ensureBackendCapabilities(): Promise<BackendCapabilities | null> {
    if (this.backendCapabilities !== undefined) {
      return this.backendCapabilities
    }
    await this.refreshBackendCapabilities()
    return this.backendCapabilities ?? null
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

  private async initializeSessionState(post: PostMessage): Promise<void> {
    if (this.sessionInitialization) {
      await this.sessionInitialization
      if (this.currentSessionId) {
        await this.loadSession(this.currentSessionId, post)
      } else {
        await this.postSessionList(post)
      }
      return
    }
    const token = ++this.sessionInitializationToken
    this.sessionInitialization = this.initializeSessionStateCore(post, token)
    try {
      await this.sessionInitialization
    } finally {
      this.sessionInitialization = undefined
    }
  }

  private async initializeSessionStateCore(post: PostMessage, token: number): Promise<void> {
    try {
      const listPayload = await this.refreshSessions(10)
      if (token !== this.sessionInitializationToken) {
        return
      }
      if (this.sessionApiAvailable === false) {
        post({
          type: "session.list",
          sessions: this.sessions,
          fingerprint: this.sessionFingerprint,
        })
        return
      }
      const storedSessionId = this.context.workspaceState.get<string>("labrastro.currentSessionId")
      const storedExists = Boolean(
        storedSessionId && this.sessions.some((session) => session.id === storedSessionId)
      )
      const targetSessionId = storedExists ? storedSessionId : this.sessions[0]?.id
      if (targetSessionId) {
        await this.loadSession(targetSessionId, post, {
          suppressListRefresh: true,
          reason: "initial",
          isStale: () => token !== this.sessionInitializationToken,
        })
        return
      }
      this.currentSessionId = undefined
      await this.context.workspaceState.update("labrastro.currentSessionId", undefined)
      post({
        type: "session.list",
        sessions: this.sessions,
        fingerprint: listPayload.fingerprint || this.sessionFingerprint,
      })
    } catch (error) {
      post({ type: "session.error", message: errorMessage(error) })
    }
  }

  private async refreshSessions(limit = 20): Promise<{ fingerprint?: string }> {
    if (this.sessionApiAvailable === false) {
      return { fingerprint: this.sessionFingerprint }
    }
    try {
      const payload = await this.client.listSessions(limit, this.sessionListEtag)
      this.sessionApiAvailable = true
      this.sessionFingerprint = stringValue(payload.fingerprint) || this.sessionFingerprint
      this.sessionListEtag = stringValue(payload.list_etag) || this.sessionListEtag
      if (payload.sessions_unchanged !== true) {
        this.sessions = normalizeSessionMetadataList(payload.sessions)
      }
    } catch (error) {
      if (isSessionApiUnavailable(error)) {
        this.sessionApiAvailable = false
        this.sessionFingerprint = undefined
        this.sessionListEtag = undefined
        this.sessions = []
        return {}
      }
      throw error
    }
    return { fingerprint: this.sessionFingerprint }
  }

  private async postSessionList(post: PostMessage): Promise<void> {
    try {
      await this.refreshSessions(50)
      post({
        type: "session.list",
        sessions: this.sessions,
        fingerprint: this.sessionFingerprint,
      })
    } catch (error) {
      post({ type: "session.error", message: errorMessage(error) })
    }
  }

  private async loadSession(
    sessionId: string,
    post: PostMessage,
    options: {
      suppressListRefresh?: boolean
      reason?: "initial" | "explicit"
      isStale?: () => boolean
    } = {}
  ): Promise<void> {
    if (!sessionId) {
      post({ type: "session.error", message: "Missing session id." })
      return
    }
    try {
      const payload = await this.client.loadSession(sessionId)
      if (options.isStale?.()) {
        return
      }
      const metadata = normalizeSessionMetadata(payload.metadata)
      const bundle = buildSessionBundle(payload, metadata)
      this.currentSessionId = metadata.id
      this.context.workspaceState.update("labrastro.currentSessionId", metadata.id)
      if (!options.suppressListRefresh) {
        await this.refreshSessions()
      }
      post({
        type: "session.loaded",
        sessionId: metadata.id,
        reason: options.reason,
        metadata,
        bundle,
        runtimeState: objectValue(payload.runtime_state),
        sessions: this.sessions,
        fingerprint: this.sessionFingerprint,
      })
    } catch (error) {
      post({ type: "session.error", message: errorMessage(error) })
    }
  }

  private async createSession(
    post: PostMessage,
    options: { suppressListRefresh?: boolean; fingerprint?: string } = {}
  ): Promise<void> {
    if (this.sessionApiAvailable === false) {
      this.currentSessionId = undefined
      await this.context.workspaceState.update("labrastro.currentSessionId", undefined)
      post({
        type: "session.list",
        sessions: this.sessions,
        fingerprint: this.sessionFingerprint,
      })
      return
    }
    try {
      const payload = await this.client.newSession()
      this.sessionApiAvailable = true
      const metadata = normalizeSessionMetadata(payload.metadata)
      const bundle = buildSessionBundle(payload, metadata)
      this.currentSessionId = metadata.id
      this.context.workspaceState.update("labrastro.currentSessionId", metadata.id)
      if (!options.suppressListRefresh) {
        await this.refreshSessions()
      }
      if (!this.sessionFingerprint) {
        this.sessionFingerprint = stringValue(payload.fingerprint) || options.fingerprint
      }
      post({
        type: "session.created",
        sessionId: metadata.id,
        metadata,
        bundle,
        runtimeState: objectValue(payload.runtime_state),
        sessions: this.sessions,
        fingerprint: this.sessionFingerprint,
      })
    } catch (error) {
      if (isSessionApiUnavailable(error)) {
        this.sessionApiAvailable = false
        this.currentSessionId = undefined
        await this.context.workspaceState.update("labrastro.currentSessionId", undefined)
        post({
          type: "session.list",
          sessions: this.sessions,
          fingerprint: this.sessionFingerprint,
        })
        return
      }
      post({ type: "session.error", message: errorMessage(error) })
    }
  }

  private async deleteSession(sessionId: string, post: PostMessage): Promise<void> {
    if (!sessionId) {
      post({ type: "session.error", message: "Missing session id." })
      return
    }
    if (this.sessionApiAvailable === false) {
      this.sessions = this.sessions.filter((session) => session.id !== sessionId)
      post({ type: "session.deleted", sessionId, sessions: this.sessions })
      return
    }
    try {
      await this.client.deleteSession(sessionId)
      const deletedCurrent = this.currentSessionId === sessionId
      if (deletedCurrent) {
        this.currentSessionId = undefined
        await this.context.workspaceState.update("labrastro.currentSessionId", undefined)
      }
      await this.refreshSessions()
      post({
        type: "session.deleted",
        sessionId,
        sessions: this.sessions,
        fingerprint: this.sessionFingerprint,
      })
      if (deletedCurrent) {
        const nextSessionId = this.sessions[0]?.id
        if (nextSessionId) {
          await this.loadSession(nextSessionId, post, { suppressListRefresh: true })
        } else {
          post({
            type: "session.list",
            sessions: this.sessions,
            fingerprint: this.sessionFingerprint,
          })
        }
      }
    } catch (error) {
      post({ type: "session.error", message: errorMessage(error) })
    }
  }

  private async saveSessionSnapshot(
    sessionId: string,
    snapshot: Record<string, unknown>,
    snapshotDigest: string | undefined,
    post: PostMessage
  ): Promise<void> {
    if (!sessionId || !Object.keys(snapshot).length) return
    if (this.sessionApiAvailable === false) return
    try {
      await this.client.saveSessionSnapshot(sessionId, snapshot, snapshotDigest)
    } catch (error) {
      if (isSessionApiUnavailable(error)) {
        this.sessionApiAvailable = false
        return
      }
      post({ type: "session.error", message: `会话视图保存失败：${errorMessage(error)}` })
    }
  }

  private async switchSessionMainModel(
    sessionId: string | undefined,
    providerId: string,
    modelId: string,
    parameters: Record<string, unknown>,
    requestId: string,
    post: PostMessage
  ): Promise<void> {
    if (!providerId || !modelId) {
      post({ type: "session.model.error", message: "缺少服务商或模型 ID。", requestId })
      return
    }
    if (this.sessionApiAvailable === false) {
      post({ type: "session.model.error", message: "当前后端不支持会话模型切换。", requestId })
      return
    }
    try {
      const payload = await this.client.switchSessionMainModel(sessionId, providerId, modelId, parameters)
      this.sessionApiAvailable = true
      const metadata = normalizeSessionMetadata(payload.metadata)
      if (metadata.id) {
        this.currentSessionId = metadata.id
        await this.context.workspaceState.update("labrastro.currentSessionId", metadata.id)
      }
      await this.refreshSessions()
      if (metadata.id) {
        post({
          type: "session.state",
          sessionId: metadata.id,
          metadata,
          bundle: buildSessionBundle(payload, metadata),
          runtimeState: objectValue(payload.runtime_state),
          sessions: this.sessions,
          fingerprint: this.sessionFingerprint || stringValue(payload.fingerprint),
        })
      }
      post({
        type: "session.model.state",
        sessionId: metadata.id || sessionId,
        payload,
        runtimeState: objectValue(payload.runtime_state),
        providerId,
        modelId,
        requestId,
      })
    } catch (error) {
      if (isSessionApiUnavailable(error)) {
        this.sessionApiAvailable = false
      }
      post({ type: "session.model.error", message: errorMessage(error), providerId, modelId, requestId })
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
      const task = objectValue(start.task)
      taskId = stringValue(task.id) || stringValue(start.task_id) || ""
      if (!taskId) {
        throw new Error("environment_task_id_missing")
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
      const payload = await this.client.runtimeEvents({
        task_id: taskId,
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
        await this.client.runtimeCancel({
          task_id: run.taskId,
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
      await this.refreshSessions()
      post({
        type: "session.list",
        sessions: this.sessions,
        fingerprint: this.sessionFingerprint,
      })
    } catch {
      // Session history refresh should not mask the environment run result.
    }
  }

  private async startChat(
    text: string,
    requestedSessionId: string | undefined,
    post: PostMessage,
    options: { mode?: string; workflowMode?: string } = {}
  ): Promise<void> {
    try {
      if (!requestedSessionId && this.sessionInitialization) {
        this.sessionInitializationToken += 1
      }
      let sessionId = requestedSessionId
      const capabilities = await this.ensureBackendCapabilities()
      const supportsFreshSessionWithoutHint =
        capabilities?.freshSessionWithoutSessionHint === true
      if (
        !sessionId &&
        !supportsFreshSessionWithoutHint &&
        this.sessionApiAvailable !== false
      ) {
        try {
          const created = await this.client.newSession()
          this.sessionApiAvailable = true
          const metadata = normalizeSessionMetadata(created.metadata)
          sessionId = metadata.id
          this.currentSessionId = metadata.id
          await this.context.workspaceState.update("labrastro.currentSessionId", metadata.id)
          await this.refreshSessions()
          post({
            type: "session.created",
            sessionId: metadata.id,
            metadata,
            bundle: buildSessionBundle(created, metadata),
            runtimeState: objectValue(created.runtime_state),
            sessions: this.sessions,
            fingerprint: this.sessionFingerprint,
          })
        } catch (error) {
          if (!isSessionApiUnavailable(error)) {
            throw error
          }
          this.sessionApiAvailable = false
          sessionId = undefined
          this.currentSessionId = undefined
          await this.context.workspaceState.update("labrastro.currentSessionId", undefined)
        }
      }
      if (
        !sessionId &&
        !supportsFreshSessionWithoutHint &&
        !canStartSessionlessChat(
          false,
          capabilities
        )
      ) {
        post({ type: "chat.error", message: LEGACY_BACKEND_UPGRADE_MESSAGE })
        return
      }
      post({ type: "chat.started", text })
      const start = await this.client.startChat(text, sessionId, options)
      const chatId = String(start.chat_id || "")
      this.activeChatId = chatId
      post({ type: "chat.session", chatId, sessionId })
      let cursor = 0
      while (!this.disposed) {
        const stream = await this.client.streamChat(chatId, cursor, 2)
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
                post({
                  type: "chat.error",
                  message: `会话绑定异常：当前会话 ${sessionId}，远端返回 ${remoteSessionId}。`,
                })
                return
              }
              if (remoteSessionId && remoteSessionId !== this.currentSessionId) {
                post({
                  type: "session.adopted",
                  sessionId: remoteSessionId,
                })
              }
              this.currentSessionId = remoteSessionId || sessionId
              if (this.currentSessionId) {
                await this.context.workspaceState.update(
                  "labrastro.currentSessionId",
                  this.currentSessionId
                )
              }
            }
          }
          for (const event of events) {
            if (event && event.type === "approval_request") {
              await this.approvalDocuments.store(objectValue(event.payload))
            }
          }
          post({ type: "chat.events", chatId, events })
        }
        cursor = nextCursor
        if (stream.done) {
          try {
            await this.refreshSessions()
            post({
              type: "session.list",
              sessions: this.sessions,
              fingerprint: this.sessionFingerprint,
            })
          } catch {
            // Chat completion should not fail because history refresh failed.
          }
          post({ type: "chat.done", chatId })
          if (this.activeChatId === chatId) {
            this.activeChatId = undefined
          }
          break
        }
      }
    } catch (error) {
      post({ type: "chat.error", message: errorMessage(error) })
      this.activeChatId = undefined
    }
  }

  private async cancelChat(chatId: string | undefined, post: PostMessage): Promise<void> {
    const targetChatId = chatId || this.activeChatId
    if (!targetChatId) {
      post({ type: "chat.error", message: "当前没有正在运行的会话。" })
      return
    }
    try {
      await this.client.cancelChat(targetChatId, "user_cancelled")
      post({ type: "chat.cancelled", chatId: targetChatId, reason: "user_cancelled" })
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

function sanitizeAutoApprovalOptions(value: unknown): Record<AutoApprovalOptionKey, boolean> {
  const raw = objectValue(value)
  return (Object.keys(DEFAULT_AUTO_APPROVAL_OPTIONS) as AutoApprovalOptionKey[]).reduce<Record<AutoApprovalOptionKey, boolean>>(
    (options, key) => {
      options[key] = raw[key] === true
      return options
    },
    { ...DEFAULT_AUTO_APPROVAL_OPTIONS }
  )
}

function sanitizeCommandRules(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const rules: string[] = []
  for (const item of value) {
    const rule = String(item).trim().replace(/\s+/g, " ")
    const key = rule.toLowerCase()
    if (!rule || seen.has(key)) continue
    seen.add(key)
    rules.push(rule)
  }
  return rules
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

function isSessionApiUnavailable(error: unknown): boolean {
  return isRemoteError(error, "not_found", 404) || isRemoteError(error, "sessions_unavailable", 503)
}

function normalizeSessionMetadata(value: unknown): SessionMetadataState {
  const payload = objectValue(value)
  return {
    id: stringValue(payload.id) || "",
    model: stringValue(payload.model) || "",
    savedAt: stringValue(payload.savedAt) || stringValue(payload.saved_at) || "",
    preview: stringValue(payload.preview) || "",
    fingerprint: stringValue(payload.fingerprint) || "",
  }
}

function normalizeSessionMetadataList(value: unknown): SessionMetadataState[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => normalizeSessionMetadata(item))
    .filter((item) => item.id)
}

function buildSessionBundle(
  payload: Record<string, unknown>,
  metadata: SessionMetadataState
): Record<string, unknown> {
  const snapshot = objectValue(payload.snapshot)
  const snapshotSession = objectValue(snapshot.session)
  const snapshotStats = objectValue(snapshot.stats)
  const runtimeState = objectValue(payload.runtime_state)
  const modelProfile = objectValue(payload.model_profile)
  const session = {
    id: metadata.id,
    title:
      stringValue(snapshotSession.title) ||
      metadata.preview ||
      "新会话",
    updatedAt:
      stringValue(snapshotSession.updatedAt) ||
      metadata.savedAt ||
      new Date().toISOString(),
    kind: stringValue(snapshotSession.kind) || "main",
    state: stringValue(snapshotSession.state) || "active",
    summary: stringValue(snapshotSession.summary) || metadata.preview,
  }
  const fallback = buildBundleFromMessages(metadata, arrayValue(payload.messages))
  const fallbackStats = objectValue(fallback.stats)
  return {
    session,
    stats: {
      ...(Object.keys(snapshotStats).length ? snapshotStats : fallbackStats),
      model:
        stringValue(snapshotStats.model) ||
        stringValue(modelProfile.model) ||
        stringValue(runtimeState.model) ||
        metadata.model,
      mode:
        stringValue(snapshotStats.mode) ||
        stringValue(runtimeState.active_mode),
      contextWindow:
        numberValue(snapshotStats.contextWindow) ||
        numberValue(modelProfile.max_context_tokens) ||
        numberValue(runtimeState.max_context_tokens) ||
        numberValue(fallbackStats.contextWindow) ||
        0,
      maxOutputTokens:
        numberValue(snapshotStats.maxOutputTokens) ||
        numberValue(modelProfile.max_tokens) ||
        numberValue(fallbackStats.maxOutputTokens) ||
        0,
    },
    turns: Array.isArray(snapshot.turns) ? snapshot.turns : fallback.turns,
    traceNodes: Array.isArray(snapshot.traceNodes)
      ? snapshot.traceNodes
      : fallback.traceNodes,
    traceEdges: Array.isArray(snapshot.traceEdges)
      ? snapshot.traceEdges
      : fallback.traceEdges,
    traceUI: {
      activeNodeId: null,
      selectedNodeId: null,
      focusedBranchId: "main",
      showInspector: false,
      showMiniMap: false,
      viewMode: "compact",
      ...objectValue(snapshot.traceUI),
    },
  }
}

function buildBundleFromMessages(
  metadata: SessionMetadataState,
  messages: unknown[]
): Record<string, unknown> {
  const turns: Record<string, unknown>[] = []
  let pendingTurn: Record<string, unknown> | undefined
  let index = 0
  for (const raw of messages) {
    const message = objectValue(raw)
    const role = stringValue(message.role)
    const content = messageContent(message.content)
    if (!content || role === "system") continue
    if (role === "user") {
      pendingTurn = {
        userMessage: {
          id: `${metadata.id}-user-${index}`,
          role: "user",
          text: content,
          parts: [],
          timestamp: Date.parse(metadata.savedAt) || Date.now(),
        },
        assistantMessages: [],
      }
      turns.push(pendingTurn)
      index += 1
    } else if (role === "assistant") {
      if (!pendingTurn) {
        pendingTurn = {
          userMessage: {
            id: `${metadata.id}-user-${index}`,
            role: "user",
            text: "",
            parts: [],
            timestamp: Date.parse(metadata.savedAt) || Date.now(),
          },
          assistantMessages: [],
        }
        turns.push(pendingTurn)
      }
      const assistantMessages = arrayValue(pendingTurn.assistantMessages)
      assistantMessages.push({
        id: `${metadata.id}-assistant-${index}`,
        role: "assistant",
        text: content,
        parts: [
          {
            id: `${metadata.id}-assistant-part-${index}`,
            type: "text",
            text: content,
            textFormat: "markdown",
          },
        ],
        timestamp: Date.parse(metadata.savedAt) || Date.now(),
      })
      pendingTurn.assistantMessages = assistantMessages
      index += 1
    }
  }
  return {
    stats: {
      taskText: metadata.preview || "新会话",
      tokensIn: 0,
      tokensOut: 0,
      cacheReads: null,
      cacheWrites: null,
      totalCost: null,
      costStatus: "unavailable",
      contextTokens: 0,
      contextWindow: 0,
      maxOutputTokens: 0,
      runStatus: "idle",
    },
    turns,
    traceNodes: [],
    traceEdges: [],
  }
}

function messageContent(value: unknown): string {
  if (typeof value === "string") return value
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === "string") return item
        const payload = objectValue(item)
        return stringValue(payload.text) || stringValue(payload.content) || ""
      })
      .filter(Boolean)
      .join("\n")
  }
  return ""
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
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
      tags: toStringArray(item.capabilities),
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
    payload.capabilities = toStringArray(candidate.capabilities)
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

class ApprovalDocumentProvider implements vscode.TextDocumentContentProvider {
  static readonly scheme = "labrastro-approval"
  private readonly documents = new Map<string, string>()
  private readonly approvals = new Map<string, ApprovalDetail>()

  provideTextDocumentContent(uri: vscode.Uri): string {
    return this.documents.get(uri.toString()) || ""
  }

  async store(payload: Record<string, unknown>): Promise<void> {
    const detail = this.toDetail(payload)
    if (!detail.approvalId) return
    this.approvals.set(detail.approvalId, detail)
    if (detail.diff) {
      await this.open(detail.approvalId)
    }
  }

  async open(approvalId: string): Promise<void> {
    const detail = this.approvals.get(approvalId)
    if (!detail) {
      void vscode.window.showWarningMessage("Labrastro approval details are no longer available.")
      return
    }
    const targetColumn =
      vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.Active
    if (detail.diff) {
      const originalUri = this.putDocument(
        `${detail.approvalId}/original/${detail.fileName}`,
        detail.diff.originalText
      )
      const modifiedUri = this.putDocument(
        `${detail.approvalId}/modified/${detail.fileName}`,
        detail.diff.modifiedText
      )
      await vscode.commands.executeCommand(
        "vscode.diff",
        originalUri,
        modifiedUri,
        detail.title,
        { preview: false, viewColumn: targetColumn }
      )
      return
    }

    const markdownUri = this.putDocument(
      `${detail.approvalId}/approval.md`,
      detail.markdown
    )
    const doc = await vscode.workspace.openTextDocument(markdownUri)
    await vscode.languages.setTextDocumentLanguage(doc, "markdown")
    await vscode.window.showTextDocument(doc, {
      preview: false,
      viewColumn: targetColumn,
    })
  }

  private putDocument(path: string, content: string): vscode.Uri {
    const uri = vscode.Uri.from({
      scheme: ApprovalDocumentProvider.scheme,
      path: "/" + path.replace(/^\/+/, ""),
    })
    this.documents.set(uri.toString(), content)
    return uri
  }

  private toDetail(payload: Record<string, unknown>): ApprovalDetail {
    const approvalId = stringValue(payload.approval_id) || ""
    const toolName = stringValue(payload.tool_name) || "tool"
    const sections = Array.isArray(payload.sections) ? payload.sections : []
    const diffSection = sections.find(
      (section): section is Record<string, unknown> =>
        Boolean(
          section &&
            typeof section === "object" &&
            (section as Record<string, unknown>).kind === "diff" &&
            typeof (section as Record<string, unknown>).original_text === "string" &&
            typeof (section as Record<string, unknown>).modified_text === "string"
        )
    )
    const pathValue =
      stringValue(diffSection?.resolved_path) ||
      stringValue(diffSection?.path) ||
      `${toolName}.txt`
    const fileName = sanitizeFileName(pathValue.split(/[\\/]/).pop() || `${toolName}.txt`)
    return {
      approvalId,
      title: `Labrastro Approval: ${toolName} ${fileName}`,
      fileName,
      markdown:
        stringValue(payload.content) ||
        [
          `## Approval required: ${toolName}`,
          stringValue(payload.reason) || "",
          "```json",
          JSON.stringify(payload, null, 2),
          "```",
        ]
          .filter(Boolean)
          .join("\n\n"),
      rawPayload: payload,
      diff: diffSection
        ? {
            originalText: stringValue(diffSection.original_text) || "",
            modifiedText: stringValue(diffSection.modified_text) || "",
          }
        : undefined,
    }
  }
}

interface ApprovalDetail {
  approvalId: string
  title: string
  fileName: string
  markdown: string
  rawPayload: Record<string, unknown>
  diff?: {
    originalText: string
    modifiedText: string
  }
}

function sanitizeFileName(value: string): string {
  const clean = value.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").trim()
  return clean || "approval.txt"
}
