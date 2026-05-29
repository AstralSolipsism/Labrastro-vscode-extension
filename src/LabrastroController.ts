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
import { SessionRunCoordinator, type ActiveSessionRun } from "./coordinators/SessionRunCoordinator"
import { EnvironmentCoordinator } from "./coordinators/EnvironmentCoordinator"
import { SessionCoordinator } from "./coordinators/SessionCoordinator"
import { normalizeChatLocale, resolveChatLocalePreference } from "./chatLocale"

type EnvironmentRunMode = "check" | "configure"
type EnvironmentEntryKind = "environment_requirement" | "mcp"
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
  requirementKind?: string
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
  sessionRunId?: string
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

interface WorkspaceFileIndex {
  rootsKey: string
  files: string[]
}

const SESSION_RUN_EVENTS_RETRY_DELAYS_MS = [1_000, 2_000, 5_000, 10_000, 15_000]
const SESSION_RUN_EVENTS_RECOVERY_DEADLINE_MS = 5 * 60 * 1000
const CHAT_WEBVIEW_TARGETS: readonly WebviewTarget[] = ["sidebar"]
const SESSION_WEBVIEW_TARGETS: readonly WebviewTarget[] = ["sidebar", "agentManager"]
const WORKSPACE_FILE_EXCLUDE_GLOB = "{**/node_modules/**,**/.git/**,**/dist/**,**/out/**,**/build/**,**/.next/**,**/target/**}"
type AdminErrorScope = "adminState" | "adminAction" | "peerDiagnostics"

export class LabrastroController implements vscode.Disposable {
  private readonly client: LabrastroRemoteClient
  private readonly approvalDocuments: ApprovalDocumentProvider
  private readonly adminCoordinator: AdminCoordinator
  private readonly sessionRunCoordinator: SessionRunCoordinator
  private readonly environmentCoordinator: EnvironmentCoordinator
  private readonly sessionCoordinator: SessionCoordinator
  private backendFeatures: BackendFeatures | null | undefined
  private readonly webviewBus = new WebviewBus()
  private disposed = false
  private workspaceFileIndex: WorkspaceFileIndex | undefined
  private workspaceFileIndexPromise: Promise<WorkspaceFileIndex> | undefined
  private readonly activeSessionRunEventStreams = new Set<string>()

  constructor(private readonly context: vscode.ExtensionContext) {
    this.client = new LabrastroRemoteClient(context)
    this.approvalDocuments = new ApprovalDocumentProvider()
    this.adminCoordinator = new AdminCoordinator({
      client: this.client,
      context: this.context,
      connectionErrorState: this.connectionErrorState.bind(this),
      postConnectionState: this.postConnectionState.bind(this),
      postConnectionStateIfAuthRequired: this.postConnectionStateIfAuthRequired.bind(this),
      postProvidersState: this.postProvidersState.bind(this),
      postModelProfilesState: this.postModelProfilesState.bind(this),
      postChatConfigState: this.postChatConfigState.bind(this),
      postGithubState: this.postGithubState.bind(this),
      refreshBackendFeatures: this.refreshBackendFeatures.bind(this),
      refreshCapabilityState: this.refreshCapabilityState.bind(this),
      refreshEnvironmentManifest: this.refreshEnvironmentManifest.bind(this),
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
      refreshCapabilityState: this.refreshCapabilityState.bind(this),
      refreshEnvironmentManifest: this.refreshEnvironmentManifest.bind(this),
      startEnvironmentRun: this.startEnvironmentRun.bind(this),
      cancelEnvironmentRun: this.cancelEnvironmentRun.bind(this),
      runCapabilityAction: this.runCapabilityAction.bind(this),
    })
    this.sessionCoordinator = new SessionCoordinator({
      client: this.client,
      context: this.context,
      emitSessionMessage: this.emitSessionMessage.bind(this),
      refreshBackendFeatures: this.refreshBackendFeatures.bind(this),
      ensureBackendFeatures: this.ensureBackendFeatures.bind(this),
      getBackendFeatures: () => this.backendFeatures,
      isChatActive: () => this.sessionRunCoordinator.isActive(),
      postConnectionStateIfAuthRequired: this.postConnectionStateIfAuthRequired.bind(this),
    })
    this.sessionRunCoordinator = new SessionRunCoordinator({
      client: this.client,
      context: this.context,
      approvalDocuments: this.approvalDocuments,
      startSessionRun: this.startSessionRun.bind(this),
      cancelSessionRun: this.cancelSessionRun.bind(this),
      recoverSessionRun: this.recoverSessionRun.bind(this),
      postConnectionStateIfAuthRequired: this.postConnectionStateIfAuthRequired.bind(this),
    })
    this.context.subscriptions.push(
      vscode.workspace.registerTextDocumentContentProvider(
        ApprovalDocumentProvider.scheme,
        this.approvalDocuments
      )
    )
    const workspaceFileWatcher = vscode.workspace.createFileSystemWatcher("**/*")
    workspaceFileWatcher.onDidChange(() => this.invalidateWorkspaceFileIndex())
    workspaceFileWatcher.onDidCreate(() => this.invalidateWorkspaceFileIndex())
    workspaceFileWatcher.onDidDelete(() => this.invalidateWorkspaceFileIndex())
    this.context.subscriptions.push(workspaceFileWatcher)
  }

  private get capabilityState(): Record<string, unknown> | undefined {
    return this.environmentCoordinator.capabilityState
  }

  private set capabilityState(value: Record<string, unknown> | undefined) {
    this.environmentCoordinator.capabilityState = value
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
    const includeSessionRunResume = target === "sidebar" || !target
    post({
      type: "ready",
      extensionVersion: contextVersion(this.context),
      workspaceDirectory: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
      platform: process.platform,
    })
    if (includeAdminState) {
      post({ type: "autoApproval.state", payload: this.adminCoordinator.getAutoApprovalState() })
      post({ type: "reasoningDisplay.state", payload: this.adminCoordinator.getReasoningDisplayState() })
      post({ type: "chat.sendDuringRunMode.state", payload: this.adminCoordinator.getSendDuringRunModeState() })
      post({ type: "peerDiagnosticsLogging.state", payload: this.client.peerDiagnosticsLoggingState() })
      post({ type: "connection.state", payload: this.client.startupConnectionState() })
      post({ type: "environment.snapshot", payload: this.environmentSnapshot })
      post({ type: "executorType.state", payload: this.getExecutorType() })
      post({ type: "locale.state", locale: this.context.workspaceState.get<string>("labrastro.locale") || vscode.env.language })
    }
    if (includeSession) {
      await this.sessionCoordinator.postSessionSyncStatus(post)
    }
    let activeRunPayload = this.sessionRunCoordinator.activeRunPayload()
    if (activeRunPayload && includeSessionRunResume) {
      activeRunPayload = await this.activeRunPayloadWithServerStatus(activeRunPayload)
      if (activeRunPayload) {
        post({ type: "sessionRun.resume", payload: activeRunPayload })
        const sessionRunId = stringValue(activeRunPayload.sessionRunId) || stringValue(activeRunPayload.session_run_id)
        const sessionId =
          stringValue(activeRunPayload.sessionId) ||
          stringValue(activeRunPayload.session_id) ||
          stringValue(activeRunPayload.draftSessionId) ||
          stringValue(activeRunPayload.draft_session_id) ||
          ""
        if (sessionRunId) {
          this.ensureSessionRunEventStream(sessionRunId, sessionId, post)
        }
      }
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

  private async activeRunPayloadWithServerStatus(
    payload: Record<string, unknown>
  ): Promise<Record<string, unknown> | undefined> {
    const sessionRunId = stringValue(payload.sessionRunId) || stringValue(payload.session_run_id)
    if (!sessionRunId) return payload
    try {
      const payloadCursor = Number(payload.cursor ?? 0)
      const cursor = Number.isFinite(payloadCursor) ? payloadCursor : 0
      const status = await this.client.sessionRunStatus(sessionRunId, cursor)
      const approvals = Array.isArray(status.approvals) ? status.approvals : []
      await this.storeStatusApprovals(status.approvals)
      const sessionId =
        stringValue(status.session_id) ||
        stringValue(status.sessionId) ||
        stringValue(payload.sessionId) ||
        stringValue(payload.session_id)
      const statusValue = stringValue(status.status) || stringValue(payload.status) || "running"
      if (isTerminalSessionRunStatus(statusValue) && approvals.length === 0) {
        this.sessionRunCoordinator.clearActiveRun()
        return undefined
      }
      this.sessionRunCoordinator.patchActiveRun({
        sessionId,
        lastStreamAt: new Date().toISOString(),
      })
      const latestRun = this.sessionRunCoordinator.activeRunPayload() || payload
      return {
        ...payload,
        ...latestRun,
        sessionRunId,
        cursor: Number.isFinite(cursor) ? cursor : 0,
        sessionId,
        session_id: sessionId,
        status: statusValue,
        approvals,
      }
    } catch (error) {
      if (isRemoteError(error, "session_run_not_found", 404)) {
        this.sessionRunCoordinator.clearActiveRun()
        return undefined
      }
      return payload
    }
  }

  private async storeStatusApprovals(approvals: unknown): Promise<void> {
    if (!Array.isArray(approvals)) return
    for (const raw of approvals) {
      const payload = objectValue(raw)
      if (payload.state && payload.state !== "requested") continue
      await this.approvalDocuments.store(payload, { openDiff: false })
    }
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
        run("providers-state", () => this.postProvidersState(post)),
        run("model-profiles-state", () => this.postModelProfilesState(post)),
        run("chat-config-state", () => this.postChatConfigState(post)),
        run("github-state", () => this.postGithubState(post)),
        run("backend-features", () => this.refreshBackendFeatures(post))
      )
    } else if (options.includeSession) {
      tasks.push(run("backend-features", () => this.refreshBackendFeatures(post)))
    }
    if (options.includeSession) {
      tasks.push(run("session-initialize", () => this.sessionCoordinator.initializeSessionState(post)))
    }

    await Promise.allSettled(tasks)

    if (options.includeAdminState && this.capabilityState) {
      post({ type: "capability.state", payload: this.capabilityState })
    }
    if (options.includeAdminState && this.environmentManifest) {
      post({ type: "environment.manifest", payload: this.environmentManifest })
    }
  }

  async handleMessage(
    message: WebviewToHostMessage,
    post: PostMessage
  ): Promise<boolean> {
    if (message.type === "workspace.files.search") {
      await this.searchWorkspaceFiles(message, post)
      return true
    }
    if (await this.adminCoordinator.handleMessage(message, post)) return true
    if (await this.environmentCoordinator.handleMessage(message, post)) return true
    if (await this.sessionCoordinator.handleMessage(message, post)) return true
    if (await this.sessionRunCoordinator.handleMessage(message, post)) return true
    return false
  }

  private async searchWorkspaceFiles(message: WebviewToHostMessage, post: PostMessage): Promise<void> {
    const query = textValue(message.query).trim().replace(/^@/, "")
    const requestId = textValue(message.requestId)
    const index = await this.getWorkspaceFileIndex()
    const needle = query.toLowerCase()
    const files = index.files
      .map((file) => ({ file, score: workspaceFileMentionScore(file, needle) }))
      .filter((item) => Number.isFinite(item.score))
      .sort((left, right) => left.score - right.score || left.file.length - right.file.length || left.file.localeCompare(right.file))
      .map((item) => item.file)
      .slice(0, 50)

    post({
      type: "workspace.files",
      requestId,
      query,
      files,
    })
  }

  private invalidateWorkspaceFileIndex(): void {
    this.workspaceFileIndex = undefined
    this.workspaceFileIndexPromise = undefined
  }

  private async getWorkspaceFileIndex(): Promise<WorkspaceFileIndex> {
    const rootsKey = workspaceFoldersKey()
    if (!rootsKey) return { rootsKey: "", files: [] }
    if (this.workspaceFileIndex?.rootsKey === rootsKey) return this.workspaceFileIndex
    if (!this.workspaceFileIndexPromise) {
      this.workspaceFileIndexPromise = this.buildWorkspaceFileIndex(rootsKey).finally(() => {
        this.workspaceFileIndexPromise = undefined
      })
    }
    return this.workspaceFileIndexPromise
  }

  private async buildWorkspaceFileIndex(rootsKey: string): Promise<WorkspaceFileIndex> {
    const uris = await vscode.workspace.findFiles("**/*", WORKSPACE_FILE_EXCLUDE_GLOB)
    const seen = new Set<string>()
    const files = uris
      .map((uri) => vscode.workspace.asRelativePath(uri, false).replace(/\\/g, "/"))
      .filter((file) => {
        if (!file || seen.has(file)) return false
        seen.add(file)
        return true
      })
      .sort((left, right) => left.localeCompare(right))
    const index = { rootsKey, files }
    this.workspaceFileIndex = index
    return index
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
      const payload = { type: "admin.state", payload: await this.client.adminStatus() }
      if (this.webviewBus.size > 0) {
        this.broadcastWebviewMessage(payload)
        if (!this.webviewBus.targetOf(post)) {
          this.postWebviewMessage(post, payload)
        }
        return
      }
      this.postWebviewMessage(post, payload)
    } catch (error) {
      post(adminErrorPayload(error, "adminState"))
      await this.postConnectionStateIfAuthRequired(error, post)
    }
  }

  async postProvidersState(post: PostMessage): Promise<void> {
    await this.postBroadcastRemoteState(
      post,
      "providers.state",
      "providers.error",
      () => this.client.providersList()
    )
  }

  async postModelProfilesState(post: PostMessage): Promise<void> {
    await this.postBroadcastRemoteState(
      post,
      "modelProfiles.state",
      "modelProfiles.error",
      () => this.client.modelProfilesList()
    )
  }

  async postChatConfigState(post: PostMessage): Promise<void> {
    await this.postBroadcastRemoteState(
      post,
      "chatConfig.state",
      "chatConfig.error",
      () => this.client.chatConfigRead()
    )
  }

  async postGithubState(post: PostMessage): Promise<void> {
    await this.postBroadcastRemoteState(
      post,
      "github.state",
      "github.error",
      () => this.client.githubStatus()
    )
  }

  private async postBroadcastRemoteState(
    post: PostMessage,
    stateType: string,
    errorType: string,
    fetchState: () => Promise<Record<string, unknown>>
  ): Promise<void> {
    try {
      const payload = { type: stateType, payload: await fetchState() }
      if (this.webviewBus.size > 0) {
        this.broadcastWebviewMessage(payload)
        if (!this.webviewBus.targetOf(post)) {
          this.postWebviewMessage(post, payload)
        }
        return
      }
      this.postWebviewMessage(post, payload)
    } catch (error) {
      post({ type: errorType, message: errorMessage(error) })
      await this.postConnectionStateIfAuthRequired(error, post)
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
    if (classifyRemoteError(error) === "auth_required" || isRemoteError(error, undefined, 403)) {
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

  private async refreshCapabilityState(post: PostMessage): Promise<void> {
    try {
      const [environmentRequirements, mcpServers, skills] = await Promise.all([
        this.client.environmentRequirementsList(),
        this.client.mcpServersList(),
        this.client.skillsList(),
      ])
      let environmentDashboard: Record<string, unknown> | undefined
      try {
        environmentDashboard = await this.client.environmentRequirementsDashboard()
      } catch (error) {
        environmentDashboard = {
          error: errorMessage(error),
          items: [],
          summary: {},
        }
      }
      let mcpDashboard: Record<string, unknown> | undefined
      try {
        mcpDashboard = await this.client.mcpServersDashboard()
      } catch (error) {
        mcpDashboard = {
          error: errorMessage(error),
          items: [],
          summary: {},
        }
      }
      let skillsDashboard: Record<string, unknown> | undefined
      try {
        skillsDashboard = await this.client.skillsDashboard()
      } catch (error) {
        skillsDashboard = {
          error: errorMessage(error),
          items: [],
          summary: {},
        }
      }
      let behaviorCatalog: Record<string, unknown> | undefined
      try {
        behaviorCatalog = await this.client.behaviorCatalog()
      } catch (error) {
        behaviorCatalog = {
          error: errorMessage(error),
          chat_commands: [],
          mention_providers: [],
          ui_actions: [],
          agent_tools: [],
        }
      }
      const environmentDashboardPayload = environmentDashboard || {}
      const mcpDashboardPayload = mcpDashboard || {}
      const skillsDashboardPayload = skillsDashboard || {}
      const dashboardItems = [
        ...(Array.isArray(environmentDashboardPayload.items) ? environmentDashboardPayload.items : []),
        ...(Array.isArray(mcpDashboardPayload.items) ? mcpDashboardPayload.items : []),
        ...(Array.isArray(skillsDashboardPayload.items) ? skillsDashboardPayload.items : []),
      ]
      const behaviorPayload = behaviorCatalog || {}
      this.capabilityState = {
        environment_requirements: Array.isArray(environmentRequirements.environment_requirements)
          ? environmentRequirements.environment_requirements
          : [],
        mcp_servers: Array.isArray(mcpServers.mcp_servers) ? mcpServers.mcp_servers : [],
        skills: Array.isArray(skills.skills) ? skills.skills : [],
        dashboard: {
          environment_requirements: environmentDashboardPayload,
          mcp_servers: mcpDashboardPayload,
          skills: skillsDashboardPayload,
          items: dashboardItems,
        },
        dashboard_items: dashboardItems,
        dashboard_summary: summarizeDashboardItems(dashboardItems),
        behavior_catalog: behaviorPayload,
        chat_commands: Array.isArray(behaviorPayload.chat_commands) ? behaviorPayload.chat_commands : [],
        mention_providers: Array.isArray(behaviorPayload.mention_providers) ? behaviorPayload.mention_providers : [],
        ui_actions: Array.isArray(behaviorPayload.ui_actions) ? behaviorPayload.ui_actions : [],
        agent_tools: Array.isArray(behaviorPayload.agent_tools) ? behaviorPayload.agent_tools : [],
        behavior_catalog_error: typeof behaviorPayload.error === "string" ? behaviorPayload.error : "",
      }
      post({ type: "capability.state", payload: this.capabilityState })
    } catch (error) {
      post({ type: "capability.error", message: errorMessage(error) })
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
      await this.sessionCoordinator.postSessionList(post)
    } catch {
      // Session history refresh should not mask the environment run result.
    }
  }

  private currentChatLocale(requestLocale?: string): "zh-CN" | "en" {
    if (requestLocale && requestLocale.trim()) {
      return normalizeChatLocale(requestLocale)
    }
    return resolveChatLocalePreference(
      this.context.workspaceState.get<string>("labrastro.locale"),
      vscode.env.language,
    )
  }

  private async startSessionRun(
    text: string,
    requestedSessionId: string | undefined,
    post: PostMessage,
    options: {
      mode?: string
      workflowMode?: string
      taskflowId?: string
      draftSessionId?: string
      clientRequestId?: string
      locale?: string
      providerId?: string
      modelId?: string
      parameters?: Record<string, unknown>
      mentions?: Record<string, unknown>[]
    } = {}
  ): Promise<void> {
    try {
      const modelError = chatStartupModelError(options)
      if (modelError) {
        post({ type: "sessionRun.error", message: modelError })
        return
      }
      this.sessionRunCoordinator.setActiveDraftSessionId(options.draftSessionId)
      const preparedSession = await this.sessionCoordinator.prepareSessionRunSession(
        requestedSessionId,
        post,
        options
      )
      if (!preparedSession.ok) {
        this.sessionRunCoordinator.clearActiveDraftSessionId()
        return
      }
      let sessionId = preparedSession.sessionId
      this.emitChatMessage({ type: "sessionRun.started", text }, post)
      const start = await this.client.startSessionRun(text, sessionId, {
        ...options,
        locale: this.currentChatLocale(options.locale),
      })
      sessionId = stringValue(start.session_id) || sessionId
      const sessionRunId = String(start.session_run_id || "")
      this.sessionRunCoordinator.setActiveRun({
        sessionRunId,
        cursor: 0,
        sessionId,
        draftSessionId: options.draftSessionId,
        status: "running",
        startedAt: new Date().toISOString(),
        reconnectAttempts: 0,
        lastStreamAt: new Date().toISOString(),
      })
      this.emitChatMessage({ type: "sessionRun.session", sessionRunId, sessionId }, post)
      await this.consumeSessionRunEventStream(sessionRunId, sessionId || "", post)
    } catch (error) {
      this.emitChatMessage({ type: "sessionRun.error", message: chatErrorMessage(error) }, post)
      await this.postConnectionStateIfAuthRequired(error, post)
      this.sessionRunCoordinator.clearActiveRun()
    }
  }

  private ensureSessionRunEventStream(sessionRunId: string, sessionId: string, post: PostMessage): void {
    if (!sessionRunId || this.activeSessionRunEventStreams.has(sessionRunId)) return
    void this.consumeSessionRunEventStream(sessionRunId, sessionId, post).catch(async (error) => {
      if (this.disposed) return
      this.emitChatMessage({ type: "sessionRun.error", message: chatErrorMessage(error) }, post)
      await this.postConnectionStateIfAuthRequired(error, post)
      if (this.sessionRunCoordinator.activeRun?.sessionRunId === sessionRunId) {
        this.sessionRunCoordinator.clearActiveRun()
      }
    })
  }

  private async consumeSessionRunEventStream(
    sessionRunId: string,
    initialSessionId: string,
    post: PostMessage
  ): Promise<void> {
    if (!sessionRunId || this.activeSessionRunEventStreams.has(sessionRunId)) return
    this.activeSessionRunEventStreams.add(sessionRunId)
    try {
      let sessionId = initialSessionId
      let cursor = this.sessionRunCoordinator.activeRun?.cursor ?? 0
      while (!this.disposed && this.sessionRunCoordinator.activeRun?.sessionRunId === sessionRunId) {
        const abortController = new AbortController()
        let completed = false
        const abortInactiveStream = setInterval(() => {
          if (this.disposed || this.sessionRunCoordinator.activeRun?.sessionRunId !== sessionRunId) {
            abortController.abort()
          }
        }, 250)
        try {
          await this.client.streamSessionRunEvents(
            sessionRunId,
            cursor,
            async (stream) => {
              this.markSessionRunEventsConnected(sessionRunId, post)
              const result = await this.applySessionRunEventsBatch(
                sessionRunId,
                sessionId,
                cursor,
                stream,
                post
              )
              sessionId = result.sessionId
              cursor = result.cursor
              completed = result.done
              if (!result.active) {
                abortController.abort()
              }
            },
            { timeoutSec: 2, signal: abortController.signal }
          )
          break
        } catch (error) {
          if (completed || (abortController.signal.aborted && this.sessionRunCoordinator.activeRun?.sessionRunId !== sessionRunId)) {
            break
          }
          if (await this.retrySessionRunEventsAfterError(sessionRunId, error, post)) {
            continue
          }
          throw error
        } finally {
          clearInterval(abortInactiveStream)
        }
      }
    } finally {
      this.activeSessionRunEventStreams.delete(sessionRunId)
    }
  }

  private markSessionRunEventsConnected(sessionRunId: string, post: PostMessage): void {
    const reconnecting = this.sessionRunCoordinator.activeRun?.status === "reconnecting"
    this.sessionRunCoordinator.patchActiveRun({
      status: "running",
      reconnectAttempts: 0,
      reconnectStartedAt: undefined,
      lastError: undefined,
      nextRetryAt: undefined,
      lastStreamAt: new Date().toISOString(),
    })
    if (reconnecting && this.sessionRunCoordinator.activeRun) {
      this.emitChatMessage(
        {
          type: "sessionRun.reconnected",
          sessionRunId,
          payload: this.sessionRunCoordinator.activeRunPayload(),
        },
        post
      )
    }
  }

  private async retrySessionRunEventsAfterError(
    sessionRunId: string,
    error: unknown,
    post: PostMessage
  ): Promise<boolean> {
    const activeRun = this.sessionRunCoordinator.activeRun
    if (
      activeRun?.sessionRunId !== sessionRunId ||
      classifyRemoteError(error) !== "transient_network" ||
      !canRetrySessionRunEvents(activeRun)
    ) {
      return false
    }
    const delayMs = retryDelayForSessionRun(activeRun)
    const reconnectStartedAt = activeRun.reconnectStartedAt ?? Date.now()
    const next = this.sessionRunCoordinator.patchActiveRun({
      status: "reconnecting",
      reconnectAttempts: activeRun.reconnectAttempts + 1,
      reconnectStartedAt,
      lastError: errorMessage(error),
      nextRetryAt: Date.now() + delayMs,
    })
    this.emitChatMessage(
      {
        type: "sessionRun.reconnecting",
        sessionRunId,
        message: errorMessage(error),
        payload: next ? this.sessionRunCoordinator.activeRunPayload() : undefined,
      },
      post
    )
    await delay(delayMs)
    return true
  }

  private async applySessionRunEventsBatch(
    sessionRunId: string,
    sessionId: string,
    cursor: number,
    stream: Record<string, unknown>,
    post: PostMessage
  ): Promise<{ sessionId: string; cursor: number; done: boolean; active: boolean }> {
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
              type: "sessionRun.error",
              message: `会话绑定异常：当前会话 ${sessionId}，远端返回 ${remoteSessionId}。`,
            }, post)
            this.sessionRunCoordinator.clearActiveRun()
            return { sessionId, cursor, done: false, active: false }
          }
          sessionId = (await this.sessionCoordinator.adoptRemoteSession(
            remoteSessionId,
            sessionId,
            this.sessionRunCoordinator.activeDraftSessionId,
            post
          )) || sessionId
          this.sessionRunCoordinator.patchActiveRun({
            sessionId,
            draftSessionId: undefined,
          })
        }
      }
      for (const event of events) {
        if (event && event.type === "approval_request") {
          await this.approvalDocuments.store(objectValue(event.payload))
        }
      }
      for (const batch of splitSessionRunEventBatches(events)) {
        this.emitChatMessage(
          { type: batch.live ? "sessionRun.stream" : "sessionRun.events", sessionRunId, events: batch.events },
          post
        )
      }
    }
    cursor = nextCursor
    this.sessionRunCoordinator.patchActiveRun({
      cursor,
      lastStreamAt: new Date().toISOString(),
    })
    if (stream.done) {
      await this.sessionCoordinator.reloadCurrentAfterSessionRunDone(post)
      this.emitChatMessage({ type: "sessionRun.done", sessionRunId }, post)
      if (this.sessionRunCoordinator.activeRun?.sessionRunId === sessionRunId) {
        this.sessionRunCoordinator.setActiveRun(undefined)
      }
      this.sessionRunCoordinator.clearActiveDraftSessionId()
      return { sessionId, cursor, done: true, active: false }
    }
    return {
      sessionId,
      cursor,
      done: false,
      active: this.sessionRunCoordinator.activeRun?.sessionRunId === sessionRunId,
    }
  }

  private async recoverSessionRun(
    sessionRunId: string,
    action: "continue" | "retry",
    post: PostMessage
  ): Promise<void> {
    try {
      await this.client.recoverSessionRun({ sessionRunId, action })
      const status = await this.client.sessionRunStatus(sessionRunId)
      const sessionId = stringValue(status.session_id) || stringValue(status.sessionId) || ""
      this.sessionRunCoordinator.setActiveRun({
        sessionRunId,
        cursor: Number(status.next_cursor ?? status.cursor ?? 0),
        sessionId,
        status: "running",
        startedAt: new Date().toISOString(),
        reconnectAttempts: 0,
        lastStreamAt: new Date().toISOString(),
      })
      this.emitChatMessage({
        type: "sessionRun.resume",
        payload: {
          sessionRunId,
          sessionId,
          status: "running",
          approvals: Array.isArray(status.approvals) ? status.approvals : [],
        },
      }, post)
      await this.consumeSessionRunEventStream(sessionRunId, sessionId, post)
    } catch (error) {
      this.emitChatMessage({ type: "sessionRun.error", message: chatErrorMessage(error) }, post)
      await this.postConnectionStateIfAuthRequired(error, post)
      this.sessionRunCoordinator.clearActiveRun()
    }
  }

  private async resolveConfiguredDefaultChatModel(): Promise<{
    providerId: string
    modelId: string
    parameters?: Record<string, unknown>
  } | undefined> {
    return defaultChatModelFromChatConfig(await this.client.chatConfigRead())
  }

  private async cancelSessionRun(sessionRunId: string | undefined, post: PostMessage): Promise<void> {
    const targetSessionRunId = sessionRunId || this.sessionRunCoordinator.activeSessionRunId
    if (!targetSessionRunId) {
      post({ type: "sessionRun.error", message: "当前没有正在运行的会话。" })
      return
    }
    try {
      await this.client.cancelSessionRun(targetSessionRunId, "user_cancelled")
      if (this.sessionRunCoordinator.activeRun?.sessionRunId === targetSessionRunId) {
        this.sessionRunCoordinator.setActiveRun(undefined)
      }
      this.sessionRunCoordinator.clearActiveDraftSessionId()
      this.emitChatMessage({ type: "sessionRun.cancelled", sessionRunId: targetSessionRunId, reason: "user_cancelled" }, post)
    } catch (error) {
      post({ type: "sessionRun.error", message: `停止失败：${errorMessage(error)}` })
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
      post(adminErrorPayload(error, "adminAction"))
      await this.postConnectionStateIfAuthRequired(error, post)
      return false
    }
  }

  private async runCapabilityAction(
    post: PostMessage,
    action: () => Promise<Record<string, unknown>>
  ): Promise<boolean> {
    try {
      post({ type: "capability.actionResult", payload: await action() })
      return true
    } catch (error) {
      post({ type: "capability.error", message: adminErrorMessage(error) })
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
    this.sessionCoordinator.dispose()
    void this.client.stopPeer("controller.dispose")
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

function isTerminalSessionRunStatus(status: string | undefined): boolean {
  if (!status) return false
  return [
    "cancelled",
    "canceled",
    "complete",
    "completed",
    "done",
    "error",
    "failed",
    "finished",
  ].includes(status.toLowerCase())
}

function workspaceFoldersKey(): string {
  return (vscode.workspace.workspaceFolders || [])
    .map((folder) => folder.uri.fsPath)
    .join("|")
}

function workspaceFileMentionScore(filePath: string, needle: string): number {
  const normalizedNeedle = needle.trim().replace(/\\/g, "/").toLowerCase()
  if (!normalizedNeedle) return filePath.split("/").length
  const lower = filePath.toLowerCase()
  const base = lower.split("/").pop() || lower
  if (base.startsWith(normalizedNeedle)) return 0
  if (lower.startsWith(normalizedNeedle)) return 1
  const index = lower.indexOf(normalizedNeedle)
  if (index >= 0) return 10 + index
  const baseFuzzy = fuzzySubsequenceScore(base, normalizedNeedle)
  if (baseFuzzy !== undefined) return 100 + baseFuzzy
  const pathFuzzy = fuzzySubsequenceScore(lower, normalizedNeedle)
  return pathFuzzy === undefined ? Number.POSITIVE_INFINITY : 200 + pathFuzzy
}

function fuzzySubsequenceScore(value: string, needle: string): number | undefined {
  let lastIndex = -1
  let gapPenalty = 0
  for (const char of needle) {
    const index = value.indexOf(char, lastIndex + 1)
    if (index < 0) return undefined
    gapPenalty += index - lastIndex - 1
    lastIndex = index
  }
  return gapPenalty + value.length / 1000
}

function chatStartupModelError(options: {
  providerId?: string
  modelId?: string
}): string {
  const providerId = stringValue(options.providerId)?.trim() || ""
  const modelId = stringValue(options.modelId)?.trim() || ""
  if (providerId && modelId) return ""
  if (providerId || modelId) return "模型选择不完整，请重新选择会话模型。"
  return "请选择会话模型后再发送。"
}

function defaultChatModelFromChatConfig(chatConfig: Record<string, unknown>): {
  providerId: string
  modelId: string
  parameters?: Record<string, unknown>
} | undefined {
  const activeAgentModel = chatModelFromRecord(objectValue(chatConfig.active_agent_model))
  if (activeAgentModel) return activeAgentModel

  const activeMain = stringValue(chatConfig.active_main)?.trim() || ""
  const profiles = arrayOfRecords(chatConfig.model_profiles)
  if (activeMain) {
    const profile = profiles.find((item) =>
      [item.id, item.name, item.profile_id].some((value) => stringValue(value)?.trim() === activeMain)
    )
    const profileModel = chatModelFromRecord(profile)
    if (profileModel) return profileModel
  }

  return undefined
}

function chatModelFromRecord(record: Record<string, unknown> | undefined): {
  providerId: string
  modelId: string
  parameters?: Record<string, unknown>
} | undefined {
  if (!record) return undefined
  const providerId = (
    stringValue(record.provider) ||
    stringValue(record.provider_id) ||
    stringValue(record.providerId) ||
    ""
  ).trim()
  const modelId = (
    stringValue(record.model) ||
    stringValue(record.model_id) ||
    stringValue(record.modelId) ||
    ""
  ).trim()
  if (!providerId || !modelId) return undefined
  const parameters = modelParametersFromRecord(record)
  return {
    providerId,
    modelId,
    ...(Object.keys(parameters).length ? { parameters } : {}),
  }
}

function arrayOfRecords(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> =>
      Boolean(item && typeof item === "object" && !Array.isArray(item))
    )
    : []
}

function modelParametersFromRecord(record: Record<string, unknown>): Record<string, unknown> {
  const parameters = { ...objectValue(record.parameters) }
  assignNumberParameter(parameters, "max_tokens", record.max_tokens)
  assignNumberParameter(parameters, "max_context_tokens", record.max_context_tokens)
  assignNumberParameter(parameters, "temperature", record.temperature)
  const reasoningEffort = stringValue(record.reasoning_effort)?.trim()
  if (reasoningEffort) parameters.reasoning_effort = reasoningEffort
  const thinkingEnabled = booleanValue(record.thinking_enabled)
  if (thinkingEnabled !== undefined) parameters.thinking_enabled = thinkingEnabled
  return parameters
}

function assignNumberParameter(parameters: Record<string, unknown>, key: string, value: unknown): void {
  const parsed = numberValue(value)
  if (parsed !== undefined) parameters[key] = parsed
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function retryDelayForSessionRun(run: ActiveSessionRun): number {
  return SESSION_RUN_EVENTS_RETRY_DELAYS_MS[
    Math.min(run.reconnectAttempts, SESSION_RUN_EVENTS_RETRY_DELAYS_MS.length - 1)
  ]
}

function canRetrySessionRunEvents(run: ActiveSessionRun): boolean {
  const startedAt = run.reconnectStartedAt ?? Date.now()
  return Date.now() - startedAt <= SESSION_RUN_EVENTS_RECOVERY_DEADLINE_MS
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

function adminErrorPayload(error: unknown, scope?: AdminErrorScope): Record<string, unknown> {
  const message = adminErrorMessage(error)
  const category = adminErrorCategory(error)
  const clearsState = adminErrorClearsState(category, scope)
  const payload: Record<string, unknown> = {
    type: "admin.error",
    message,
    category,
    stale: clearsState,
    clearsState,
  }
  if (scope) {
    payload.scope = scope
  }
  if (isRemoteError(error)) {
    payload.status = error.status
    payload.code = error.code
    payload.body = error.body
  }
  return payload
}

function adminErrorMessage(error: unknown): string {
  if (!isRemoteError(error)) return errorMessage(error)
  const detail = stringValue(objectValue(error.body).message)
  if (!detail || error.message.includes(detail)) return error.message
  return `${error.message}: ${detail}`
}

function summarizeDashboardItems(items: unknown[]): Record<string, number> {
  const summary = { total: 0, ready: 0, missing: 0, stopped: 0, awaiting: 0 }
  for (const item of items) {
    const record = objectValue(item)
    summary.total += 1
    const status = stringValue(record.status) || ""
    if (status === "available" || status === "configured" || status === "ready") summary.ready += 1
    else if (status === "missing") summary.missing += 1
    else if (status === "stopped") summary.stopped += 1
    else if (status === "awaiting_approval" || status === "needs_review" || status === "parse_failed") summary.awaiting += 1
  }
  return summary
}

function adminErrorCategory(error: unknown): "unauthenticated" | "forbidden" | "unavailable" | "network" | "unknown" {
  if (isRemoteError(error) && error.status === 403) return "forbidden"
  if (classifyRemoteError(error) === "auth_required") return "unauthenticated"
  if (isRemoteError(error) && [404, 408, 429, 500, 502, 503, 504].includes(error.status)) return "unavailable"
  if (classifyRemoteError(error) === "transient_network") return "network"
  return "unknown"
}

function adminErrorClearsState(
  category: "unauthenticated" | "forbidden" | "unavailable" | "network" | "unknown",
  scope?: AdminErrorScope
): boolean {
  if (category === "unauthenticated" || category === "forbidden") return true
  if (scope === "adminAction" || scope === "peerDiagnostics") return false
  return scope === "adminState" && (category === "unavailable" || category === "network")
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
  const environment = objectValue(payload.environment)
  const requirementsMap = objectValue(environment.requirements)
  const environmentRequirements = Array.isArray(payload.environment_requirements)
    ? payload.environment_requirements
    : Object.entries(requirementsMap).map(([id, value]) => ({
        ...objectValue(value),
        id: stringValue(objectValue(value).id) || id,
      }))
  return {
    environment_requirements: environmentRequirements,
    mcp_servers: Array.isArray(payload.mcp_servers) ? payload.mcp_servers : [],
    loadedAt: new Date().toISOString(),
  }
}

function buildEnvironmentEntries(
  manifest: Record<string, unknown>
): EnvironmentEntryState[] {
  const requirementEntries = (Array.isArray(manifest.environment_requirements) ? manifest.environment_requirements : [])
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
    .map((item) => {
      const requirementKind = stringValue(item.kind || item.resource_kind) || "runtime"
      const name = stringValue(item.name || item.id) || ""
      const requirements = objectValue(item.requirements)
      const requirementText = Object.entries(requirements)
        .map(([key, value]) => `${key} ${String(value)}`.trim())
        .join(", ")
      return {
        id: stringValue(item.id) || `envreq:${requirementKind}:${name}`,
        kind: "environment_requirement" as const,
        requirementKind,
        name,
        description: stringValue(item.description) || "",
        source: stringValue(item.source) || "",
        version: stringValue(item.version) || undefined,
        check: stringValue(item.check) || "",
        install: stringValue(item.install) || "",
        command: stringValue(item.command) || "",
        tags: [requirementKind, ...toStringArray(item.tags)].filter(Boolean),
        status: "unchecked" as const,
        detail: requirementText || undefined,
      }
    })
  const mcpEntries = (Array.isArray(manifest.mcp_servers) ? manifest.mcp_servers : [])
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
    .map((item) => ({
      id: stringValue(item.id) || `mcp:${stringValue(item.name) || ""}`,
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
        ...toStringArray(item.environment_requirement_refs),
      ].filter(Boolean),
      status: "unchecked" as const,
    }))
  return [...requirementEntries, ...mcpEntries]
}

function filterEnvironmentManifest(
  manifest: Record<string, unknown>,
  entryIds: string[] | undefined
): Record<string, unknown> {
  if (!entryIds?.length) return manifest
  const ids = new Set(entryIds)
  const environmentRequirements = filterManifestItems(manifest.environment_requirements, ids)
  const mcpServers = filterManifestItems(manifest.mcp_servers, ids)
  return {
    ...manifest,
    environment_requirements: environmentRequirements,
    mcp_servers: mcpServers,
  }
}

function filterManifestItems(
  value: unknown,
  ids: Set<string>
): Record<string, unknown>[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
    .filter((item) => {
      const id = stringValue(item.id)
      if (id && ids.has(id)) return true
      const name = stringValue(item.name) || ""
      const kind = stringValue(item.kind || item.resource_kind)
      if (kind && ids.has(`envreq:${kind}:${name}`)) return true
      return ids.has(`mcp:${name}`)
    })
}

const LIVE_SESSION_RUN_EVENT_TYPES = new Set([
  "assistant_delta",
  "reasoning_delta",
  "tool_call_stream",
])

function isLiveSessionRunEvent(event: unknown): boolean {
  if (!event || typeof event !== "object") return false
  return LIVE_SESSION_RUN_EVENT_TYPES.has(stringValue((event as Record<string, unknown>).type) || "")
}

function splitSessionRunEventBatches(events: unknown[]): Array<{ live: boolean; events: unknown[] }> {
  const batches: Array<{ live: boolean; events: unknown[] }> = []
  for (const event of events) {
    const live = isLiveSessionRunEvent(event)
    const last = batches[batches.length - 1]
    if (last && last.live === live) {
      last.events.push(event)
      continue
    }
    batches.push({ live, events: [event] })
  }
  return batches
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

function truncateText(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value
  return `${value.slice(0, maxChars - 1)}...`
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item)).filter(Boolean) : []
}
