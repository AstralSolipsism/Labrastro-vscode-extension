import * as vscode from "vscode"
import * as fs from "fs"
import * as path from "path"
import { ApprovalDocumentProvider, type ApprovalCandidateSaveRequest } from "./ApprovalDocumentProvider"
import { DraftDocumentProvider } from "./DraftDocumentProvider"
import {
  BackendFeatures,
  LabrastroRemoteClient,
  type ConnectionState,
  type PeerPreparationState,
} from "./LabrastroRemoteClient"
import { classifyRemoteError, isRemoteError } from "./remote-errors"
import { WebviewBus, type PostMessage, type WebviewTarget } from "./WebviewBus"
import type { WebviewToHostMessage } from "./protocol/messages"
import { AdminCoordinator } from "./coordinators/AdminCoordinator"
import { SessionRunCoordinator } from "./coordinators/SessionRunCoordinator"
import {
  beginSessionRunOperation,
  currentSessionRunOperation,
  type SessionRunLifecycleOperationKind,
  type SessionRunOperationKind,
} from "./coordinators/SessionRunOperationCoordinator"
import {
  resolveSessionRunSourceIdentity,
  type ResolvedSessionRunSourceIdentity,
  type SessionRunOperationSourceScope,
} from "./coordinators/SessionRunSourceIdentityResolver"
import { EnvironmentCoordinator } from "./coordinators/EnvironmentCoordinator"
import { SessionCoordinator } from "./coordinators/SessionCoordinator"
import { normalizeChatLocale, resolveChatLocalePreference } from "./chatLocale"
import { RemoteStateStore, type RemoteStateKey, type RemoteStateSlice } from "./RemoteStateStore"
import { CapabilityPackageLocalPeerRunner } from "./CapabilityPackageLocalPeerRunner"
import { chatSessionRunEvents } from "./sessionRunEventViews"
import { SessionRuntimeStore } from "./sessionRuntime/SessionRuntimeStore"
import type { SessionRuntimeStatus } from "./sessionRuntime/SessionRuntimeModel"
import {
  normalizeBranchCreateResult,
  normalizeBranchSelectResult,
  normalizeSessionRunStartResult,
  sessionRunStartTargetBranchBindingId,
} from "./sessionRunOperationResults"

type EnvironmentRunMode = "check" | "configure"
type SessionRunStreamTerminalStatus = Extract<SessionRuntimeStatus, "cancelled" | "done" | "error" | "interrupted">
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
  requestId?: string
}

interface WorkspaceFileIndex {
  rootsKey: string
  files: string[]
}

const SESSION_RUN_EVENTS_RETRY_DELAYS_MS = [1_000, 2_000, 5_000, 10_000, 15_000]
const SESSION_RUN_EVENTS_RECOVERY_DEADLINE_MS = 5 * 60 * 1000
const CHAT_WEBVIEW_TARGETS: readonly WebviewTarget[] = ["sidebar"]
const SESSION_WEBVIEW_TARGETS: readonly WebviewTarget[] = ["sidebar", "settings", "agentManager"]
const WORKSPACE_FILE_EXCLUDE_GLOB = "{**/node_modules/**,**/.git/**,**/dist/**,**/out/**,**/build/**,**/.next/**,**/target/**}"
type AdminErrorScope = "adminState" | "adminAction" | "peerDiagnostics"

interface SessionRunEventReconnectState {
  attempts: number
  startedAt: number
  lastError?: string
  nextRetryAt?: number
}

export class LabrastroController implements vscode.Disposable {
  private readonly client: LabrastroRemoteClient
  private readonly approvalDocuments: ApprovalDocumentProvider
  private readonly draftDocuments: DraftDocumentProvider
  private readonly adminCoordinator: AdminCoordinator
  private readonly sessionRunCoordinator: SessionRunCoordinator
  private readonly sessionRuntimeStore = new SessionRuntimeStore()
  private readonly environmentCoordinator: EnvironmentCoordinator
  private readonly sessionCoordinator: SessionCoordinator
  private readonly capabilityPackageLocalPeerRunner: CapabilityPackageLocalPeerRunner
  private capabilityPackageLocalPeerRunnerKey: string | undefined
  private backendFeatures: BackendFeatures | null | undefined
  private readonly webviewBus = new WebviewBus()
  private readonly remoteState = new RemoteStateStore()
  private disposed = false
  private workspaceFileIndex: WorkspaceFileIndex | undefined
  private workspaceFileIndexPromise: Promise<WorkspaceFileIndex> | undefined
  private readonly activeSessionRunEventStreams = new Set<string>()
  private readonly sessionRunEventReconnects = new Map<string, SessionRunEventReconnectState>()

  constructor(private readonly context: vscode.ExtensionContext) {
    this.client = new LabrastroRemoteClient(context)
    this.client.setPeerPreparationListener((state) => this.applyPeerPreparationState(state))
    this.capabilityPackageLocalPeerRunner = new CapabilityPackageLocalPeerRunner({
      client: this.client,
      storageRoot: this.context.globalStorageUri.fsPath,
    })
    this.approvalDocuments = new ApprovalDocumentProvider((request) =>
      this.approveCandidateDocumentSave(request)
    )
    this.draftDocuments = new DraftDocumentProvider()
    this.adminCoordinator = new AdminCoordinator({
      client: this.client,
      context: this.context,
      connectionErrorState: this.connectionErrorState.bind(this),
      setConnectionState: this.setConnectionState.bind(this),
      postConnectionState: this.postConnectionState.bind(this),
      postConnectionStateIfAuthRequired: this.postConnectionStateIfAuthRequired.bind(this),
      postProvidersState: this.postProvidersState.bind(this),
      postModelProfilesState: this.postModelProfilesState.bind(this),
      postChatConfigState: this.postChatConfigState.bind(this),
      postGithubState: this.postGithubState.bind(this),
      postServerSettingsState: this.postServerSettingsState.bind(this),
      updateServerSettingsState: this.updateServerSettingsState.bind(this),
      postModelCapabilitiesState: this.postModelCapabilitiesState.bind(this),
      refreshModelCapabilitiesState: this.refreshModelCapabilitiesState.bind(this),
      listModelCapabilitiesState: this.listModelCapabilitiesState.bind(this),
      refreshBackendFeatures: this.refreshBackendFeatures.bind(this),
      refreshCapabilityState: this.refreshCapabilityState.bind(this),
      refreshEnvironmentManifest: this.refreshEnvironmentManifest.bind(this),
      postSessionList: (post) => this.sessionCoordinator.postSessionList(post),
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
      continueSessionRun: this.continueSessionRun.bind(this),
      steerAgentRun: this.steerAgentRun.bind(this),
      branchSessionRun: this.branchSessionRun.bind(this),
      selectSessionRunBranch: this.selectSessionRunBranch.bind(this),
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
    if (typeof vscode.workspace.registerFileSystemProvider === "function") {
      this.context.subscriptions.push(
        vscode.workspace.registerFileSystemProvider(
          ApprovalDocumentProvider.candidateScheme,
          this.approvalDocuments,
          { isReadonly: false },
        )
      )
    }
    this.context.subscriptions.push(
      vscode.workspace.registerTextDocumentContentProvider(
        DraftDocumentProvider.scheme,
        this.draftDocuments
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
    const includeSessionRunResume = target === "sidebar" || target === "settings" || target === "agentManager" || !target
    this.remoteState.setReady("environmentSnapshot", this.environmentSnapshot as unknown as Record<string, unknown>)
    post({
      type: "ready",
      extensionVersion: contextVersion(this.context),
      workspaceDirectory: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
      platform: process.platform,
    })
    post({ type: "remoteState.snapshot", payload: this.remoteState.snapshot() })
    if (includeAdminState) {
      post({ type: "autoApproval.state", payload: this.adminCoordinator.getAutoApprovalState() })
      post({ type: "reasoningDisplay.state", payload: this.adminCoordinator.getReasoningDisplayState() })
      post({ type: "peerDiagnosticsLogging.state", payload: this.client.peerDiagnosticsLoggingState() })
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
        post({ type: "sessionRun.resume", bootstrapRestore: true, payload: activeRunPayload })
        const sessionRunId = stringValue(activeRunPayload.sessionRunId) || stringValue(activeRunPayload.session_run_id)
        const sessionId =
          stringValue(activeRunPayload.sessionId) ||
          stringValue(activeRunPayload.session_id) ||
          stringValue(activeRunPayload.draftSessionId) ||
          stringValue(activeRunPayload.draft_session_id) ||
          ""
        const branchBindingId =
          stringValue(activeRunPayload.branchBindingId) ||
          stringValue(activeRunPayload.branch_binding_id)
        if (sessionRunId && branchBindingId) {
          this.ensureSessionRunEventStream(sessionRunId, sessionId, post, branchBindingId)
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
      settingsOnly: target === "settings",
    })
  }

  private async activeRunPayloadWithServerStatus(
    payload: Record<string, unknown>
  ): Promise<Record<string, unknown> | undefined> {
    const sessionRunId = stringValue(payload.sessionRunId) || stringValue(payload.session_run_id)
    if (!sessionRunId) {
      this.sessionRunCoordinator.clearActiveRun()
      return undefined
    }
    try {
      const payloadCursor = Number(payload.cursor ?? 0)
      const cursor = Number.isFinite(payloadCursor) ? payloadCursor : 0
      const branchBindingId =
        stringValue(payload.branchBindingId) ||
        stringValue(payload.branch_binding_id)
      if (!branchBindingId) {
        this.sessionRunCoordinator.clearActiveRun()
        return undefined
      }
      const status = await this.client.sessionRunStatus(sessionRunId, cursor, branchBindingId)
      const payloadAgentRunId = stringValue(payload.agentRunId) || stringValue(payload.agent_run_id)
      const branches = arrayOfRecords(status.branches)
      const statusScope = sessionRunStatusScopeProof(status, branches)
      if (!statusScope) return undefined
      const responseSessionRunId = statusScope.sessionRunId
      const responseBranchBindingId = statusScope.branchBindingId
      const responseAgentRunId = statusScope.agentRunId
      const statusValue = stringValue(status.status) || stringValue(payload.status) || "running"
      if (responseSessionRunId !== sessionRunId || responseBranchBindingId !== branchBindingId) {
        return undefined
      }
      if (
        payloadAgentRunId &&
        (!responseAgentRunId || responseAgentRunId !== payloadAgentRunId)
      ) {
        return undefined
      }
      if (!this.activeRunPayloadScopeMatchesOrRestoresBootstrap({
        sessionRunId,
        branchBindingId,
        ...(responseAgentRunId ? { agentRunId: responseAgentRunId } : {}),
        status: activeSessionRunRuntimeStatus(statusValue === "idle" ? "idle" : "running"),
        streamCursor: cursor,
      })) {
        return undefined
      }
      const approvals = Array.isArray(status.approvals) ? status.approvals : []
      await this.storeStatusApprovals(status.approvals)
      const sessionId =
        stringValue(status.session_id) ||
        stringValue(status.sessionId) ||
        stringValue(payload.sessionId) ||
        stringValue(payload.session_id)
      const runtimeState = objectValue(status.runtime_state || status.runtimeState)
      this.sessionRunCoordinator.patchActiveRun({
        sessionId,
        branchBindingId: responseBranchBindingId,
        ...(responseAgentRunId ? { agentRunId: responseAgentRunId } : {}),
        ...(branches.length ? { branches } : {}),
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
        branchBindingId: responseBranchBindingId,
        branch_binding_id: responseBranchBindingId,
        ...(responseAgentRunId
          ? {
              agentRunId: responseAgentRunId,
              agent_run_id: responseAgentRunId,
            }
          : {}),
        status: statusValue,
        ...(branches.length ? { branches } : {}),
        runtimeState,
        runtime_state: runtimeState,
        approvals,
      }
    } catch (error) {
      if (isRemoteError(error, "session_run_not_found", 404)) {
        this.sessionRunCoordinator.clearActiveRun()
        return undefined
      }
      const branchBindingId =
        stringValue(payload.branchBindingId) ||
        stringValue(payload.branch_binding_id)
      const payloadAgentRunId = stringValue(payload.agentRunId) || stringValue(payload.agent_run_id)
      if (
        !branchBindingId ||
        !this.activeRunPayloadScopeMatchesOrRestoresBootstrap({
          sessionRunId,
          branchBindingId,
          ...(payloadAgentRunId ? { agentRunId: payloadAgentRunId } : {}),
          status: activeSessionRunRuntimeStatus(stringValue(payload.status) === "idle" ? "idle" : "running"),
          streamCursor: Number(payload.cursor ?? 0),
        })
      ) {
        return undefined
      }
      return payload
    }
  }

  private activeSessionRunMatches(identity: {
    sessionRunId: string
    branchBindingId: string
    agentRunId?: string
  }): boolean {
    return this.sessionRuntimeStore.selectedScopeMatches(identity)
  }

  private activeRunPayloadScopeMatchesOrRestoresBootstrap(identity: {
    sessionRunId: string
    branchBindingId: string
    agentRunId?: string
    status?: SessionRuntimeStatus
    streamCursor?: number
  }): boolean {
    if (this.sessionRuntimeStore.selectedScopeMatches(identity)) return true
    if (!identity.agentRunId) return false
    return this.sessionRuntimeStore.restoreBootstrapScopeIfUnclaimed({
      sessionRunId: identity.sessionRunId,
      branchBindingId: identity.branchBindingId,
      agentRunId: identity.agentRunId,
      ...(identity.status ? { status: identity.status } : {}),
      ...(Number.isFinite(identity.streamCursor) ? { streamCursor: identity.streamCursor } : {}),
    })
  }

  private upsertBranchRuntimeScopesFromSummaries(
    sessionRunId: string,
    branches: Record<string, unknown>[],
  ): void {
    for (const branch of branches) {
      const branchBindingId = branchBindingIdFromRecord(branch)
      const agentRunId = agentRunIdFromRecord(branch)
      if (!branchBindingId || !agentRunId) continue
      const summarySelected =
        branch.selected === true ||
        stringValue(branch.selected)?.toLowerCase() === "true"
      if (summarySelected || this.sessionRuntimeStore.selectedScopeMatches({ sessionRunId, branchBindingId })) continue
      this.sessionRuntimeStore.ensureBranchRuntimeScope({
        sessionRunId,
        branchBindingId,
        agentRunId,
        status: branchRuntimeStatusFromRecord(branch),
      })
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

  private async approveCandidateDocumentSave(request: ApprovalCandidateSaveRequest): Promise<void> {
    const proof = explicitSessionRunBranchProof(request)
    if (!proof) {
      throw new Error("当前审批缺少会话分支归属，请刷新会话后重试。")
    }
    const { sessionRunId, branchBindingId } = proof
    const payload = await this.client.approvalReply({
      session_run_id: sessionRunId,
      branch_binding_id: branchBindingId,
      approval_id: request.approvalId,
      decision: "allow_once",
      reason: "approved_candidate_save",
      approved_save_candidate: request.approvedSaveCandidate,
    })
    this.emitChatMessage({
      type: "approval.reply.ok",
      sessionRunId,
      branchBindingId,
      branch_binding_id: branchBindingId,
      approvalId: request.approvalId,
      decision: "allow_once",
      payload,
    })
    await this.approvalDocuments.close(request.approvalId)
  }

  private async refreshInitialStateInBackground(
    post: PostMessage,
    startedAt: number,
    options: { includeAdminState: boolean; includeSession: boolean; settingsOnly: boolean }
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
      tasks.push(run("connection-state", () => this.refreshRemoteSliceIfNeeded(
        post,
        "connection",
        () => this.postConnectionState(post)
      )))
      if (!options.settingsOnly) {
        tasks.push(
          run("providers-state", () => this.refreshRemoteSliceIfNeeded(
            post,
            "providers",
            () => this.postProvidersState(post)
          )),
          run("model-profiles-state", () => this.refreshRemoteSliceIfNeeded(
            post,
            "modelProfiles",
            () => this.postModelProfilesState(post)
          )),
          run("chat-config-state", () => this.refreshRemoteSliceIfNeeded(
            post,
            "chatConfig",
            () => this.postChatConfigState(post)
          )),
          run("github-state", () => this.refreshRemoteSliceIfNeeded(
            post,
            "github",
            () => this.postGithubState(post)
          )),
          run("backend-features", () => this.refreshRemoteSliceIfNeeded(
            post,
            "backendFeatures",
            () => this.refreshBackendFeatures(post)
          ))
        )
      }
    } else if (options.includeSession) {
      tasks.push(run("backend-features", () => this.refreshRemoteSliceIfNeeded(
        post,
        "backendFeatures",
        () => this.refreshBackendFeatures(post)
      )))
    }
    if (options.includeSession) {
      tasks.push(run("session-initialize", () => this.sessionCoordinator.initializeSessionState(post)))
    }

    await Promise.allSettled(tasks)

  }

  async handleMessage(
    message: WebviewToHostMessage,
    post: PostMessage
  ): Promise<boolean> {
    if (message.type === "workspace.files.search") {
      await this.searchWorkspaceFiles(message, post)
      return true
    }
    if (message.type === "chat.send") {
      const payload = capabilityPackageIngestPayloadFromChatText(textValue(message.text))
      if (payload) {
        await this.startCapabilityPackageIngestSession({
          type: "capabilityPackage.ingest.session.start",
          payload: {
            ...payload,
            ...(stringValue(message.sessionId) ? { session_id: stringValue(message.sessionId) } : {}),
            ...(stringValue(message.locale) ? { locale: stringValue(message.locale) } : {}),
          },
          ...(stringValue(message.operationId) ? { operationId: stringValue(message.operationId) } : {}),
        } as WebviewToHostMessage, post)
        return true
      }
    }
    if (message.type === "capabilityPackage.ingest.session.start") {
      await this.startCapabilityPackageIngestSession(message, post)
      return true
    }
    if (await this.adminCoordinator.handleMessage(message, post)) return true
    if (await this.environmentCoordinator.handleMessage(message, post)) return true
    if (await this.sessionCoordinator.handleMessage(message, post)) return true
    if (await this.sessionRunCoordinator.handleMessage(message, post)) return true
    return false
  }

  private async refreshRemoteSliceIfNeeded(
    post: PostMessage,
    key: RemoteStateKey,
    refresh: () => Promise<void>
  ): Promise<void> {
    const slice = this.remoteState.slice(key)
    if (slice.inFlight) return
    if (slice.status !== "idle" && slice.status !== "stale" && slice.status !== "error") return
    await refresh()
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
    if (type.startsWith("session.") || type.startsWith("sessionRun.") || type === "traceSnapshot" || type === "traceFocusNode") {
      this.emitSessionMessage(payload, fallbackPost)
      return
    }
    this.emitTargetedMessage(payload, CHAT_WEBVIEW_TARGETS, fallbackPost)
  }

  async postConnectionState(post: PostMessage): Promise<void> {
    const state = await this.postBroadcastRemoteState(post, "connection", async () => ({
      ...(await this.client.connectionState()),
    }))
    if (state) this.updateCapabilityPackageLocalPeerRunner(state)
  }

  private setConnectionState(post: PostMessage, state: ConnectionState): void {
    const slice = this.remoteState.setReady("connection", { ...state })
    this.emitRemoteStatePatch(post, "connection", slice)
    this.updateCapabilityPackageLocalPeerRunner(state)
  }

  private applyPeerPreparationState(state: PeerPreparationState): void {
    const current = this.remoteState.slice("connection").data || this.client.startupConnectionState()
    const next = {
      ...current,
      peerConnected: state.phase === "connected",
      peerId: state.peerId,
      peerPreparation: state,
    }
    const slice = this.remoteState.setReady("connection", next)
    this.emitRemoteStatePatch(undefined, "connection", slice)
    this.updateCapabilityPackageLocalPeerRunner(next)
  }

  private updateCapabilityPackageLocalPeerRunner(state: {
    authenticated?: boolean
    deviceId?: string
    hostUrl?: string
    peerConnected?: boolean
    peerId?: string
    status?: string
    username?: string
  }): void {
    const runnerKey = capabilityPackageLocalPeerRunnerKey(state)
    if (runnerKey) {
      if (this.capabilityPackageLocalPeerRunnerKey !== runnerKey) {
        if (this.capabilityPackageLocalPeerRunnerKey) {
          this.capabilityPackageLocalPeerRunner.stop()
        }
        this.capabilityPackageLocalPeerRunnerKey = runnerKey
        this.capabilityPackageLocalPeerRunner.start()
      }
      return
    }
    this.capabilityPackageLocalPeerRunnerKey = undefined
    this.capabilityPackageLocalPeerRunner.stop()
  }

  private async broadcastConnectionState(): Promise<void> {
    await this.postBroadcastRemoteState(undefined, "connection", async () => ({
      ...(await this.client.connectionState()),
    }))
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
      "providers",
      () => this.client.providersList()
    )
  }

  async postModelProfilesState(post: PostMessage): Promise<void> {
    await this.postBroadcastRemoteState(
      post,
      "modelProfiles",
      () => this.client.modelProfilesList()
    )
  }

  async postChatConfigState(post: PostMessage): Promise<void> {
    await this.postBroadcastRemoteState(
      post,
      "chatConfig",
      () => this.client.chatConfigRead()
    )
  }

  async postGithubState(post: PostMessage): Promise<void> {
    await this.postBroadcastRemoteState(
      post,
      "github",
      () => this.client.githubStatus()
    )
  }

  async postServerSettingsState(post: PostMessage): Promise<Record<string, unknown> | undefined> {
    return this.postBroadcastRemoteState(
      post,
      "serverSettings",
      () => this.client.serverSettingsRead()
    )
  }

  async updateServerSettingsState(
    post: PostMessage,
    payload: Record<string, unknown>
  ): Promise<Record<string, unknown> | undefined> {
    return this.postBroadcastRemoteState(
      post,
      "serverSettings",
      () => this.client.serverSettingsUpdate(payload)
    )
  }

  async postModelCapabilitiesState(post: PostMessage): Promise<Record<string, unknown> | undefined> {
    return this.postBroadcastRemoteState(
      post,
      "modelCapabilities",
      () => this.client.modelCapabilitiesStatus()
    )
  }

  async refreshModelCapabilitiesState(post: PostMessage): Promise<Record<string, unknown> | undefined> {
    return this.postBroadcastRemoteState(
      post,
      "modelCapabilities",
      () => this.client.modelCapabilitiesRefresh()
    )
  }

  async listModelCapabilitiesState(
    post: PostMessage,
    payload: Record<string, unknown>
  ): Promise<Record<string, unknown> | undefined> {
    return this.postBroadcastRemoteState(
      post,
      "modelCapabilities",
      () => this.client.modelCapabilitiesList(payload)
    )
  }

  private async postBroadcastRemoteState(
    post: PostMessage | undefined,
    key: RemoteStateKey,
    fetchState: () => Promise<Record<string, unknown>>
  ): Promise<Record<string, unknown> | undefined> {
    const beforeVersion = this.remoteState.slice(key).version
    const request = this.remoteState.refresh(key, fetchState)
    const startedSlice = this.remoteState.slice(key)
    if (startedSlice.version !== beforeVersion) {
      this.emitRemoteStatePatch(post, key, startedSlice)
    }
    try {
      const payload = await request
      this.emitRemoteStatePatch(post, key, this.remoteState.slice(key))
      return payload
    } catch (error) {
      this.emitRemoteStatePatch(post, key, this.remoteState.slice(key))
      if (post) await this.postConnectionStateIfAuthRequired(error, post)
      return undefined
    }
  }

  private emitRemoteStatePatch(
    post: PostMessage | undefined,
    key: RemoteStateKey,
    slice: RemoteStateSlice
  ): void {
    const payload = {
      type: "remoteState.patch",
      payload: { key, slice },
    }
    if (this.webviewBus.size > 0) {
      this.broadcastWebviewMessage(payload)
      if (post && !this.webviewBus.targetOf(post)) {
        this.postWebviewMessage(post, payload)
      }
      return
    }
    if (post) {
      this.postWebviewMessage(post, payload)
    }
  }

  private async refreshBackendFeatures(post?: PostMessage): Promise<void> {
    try {
      this.backendFeatures = await this.client.features()
      this.emitRemoteStatePatch(
        post,
        "backendFeatures",
        this.remoteState.setReady("backendFeatures", this.backendFeatures as unknown as Record<string, unknown>)
      )
      await this.sessionCoordinator.postSessionSyncStatus(post)
    } catch (error) {
      this.backendFeatures = null
      this.emitRemoteStatePatch(post, "backendFeatures", this.remoteState.setError("backendFeatures", error))
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
      this.emitRemoteStatePatch(
        post,
        "capabilities",
        this.remoteState.setReady("capabilities", this.capabilityState)
      )
    } catch (error) {
      this.emitRemoteStatePatch(post, "capabilities", this.remoteState.setError("capabilities", error))
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
      this.emitRemoteStatePatch(
        post,
        "environmentManifest",
        this.remoteState.setReady("environmentManifest", payload)
      )
      this.emitRemoteStatePatch(
        post,
        "environmentSnapshot",
        this.remoteState.setReady("environmentSnapshot", this.environmentSnapshot as unknown as Record<string, unknown>)
      )
    } catch (error) {
      this.environmentSnapshot = {
        ...this.environmentSnapshot,
        running: false,
        status: "error",
        summary: "环境清单加载失败",
        error: errorMessage(error),
      }
      this.emitRemoteStatePatch(
        post,
        "environmentSnapshot",
        this.remoteState.setReady("environmentSnapshot", this.environmentSnapshot as unknown as Record<string, unknown>)
      )
      this.emitRemoteStatePatch(post, "environmentManifest", this.remoteState.setError("environmentManifest", error))
      post({ type: "environment.run.error", message: errorMessage(error) })
    }
  }

  private emitEnvironmentSnapshot(post: PostMessage | undefined): void {
    this.emitRemoteStatePatch(
      post,
      "environmentSnapshot",
      this.remoteState.setReady("environmentSnapshot", this.environmentSnapshot as unknown as Record<string, unknown>)
    )
  }

  private environmentRunMessageScope(requestId?: string): Record<string, string> {
    return requestId ? { requestId, request_id: requestId } : {}
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
    agentId?: string,
    options: { requestId?: string } = {},
  ): Promise<void> {
    const messageScope = this.environmentRunMessageScope(options.requestId)
    if (this.activeEnvironmentRun) {
      post({
        type: "environment.run.error",
        ...messageScope,
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
        this.emitEnvironmentSnapshot(post)
        post({
          type: "environment.run.error",
          ...messageScope,
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
        ...(options.requestId ? { requestId: options.requestId } : {}),
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
      post({
        type: "environment.run.started",
        ...messageScope,
        payload: { mode, taskId, agentId: selectedAgentId },
      })
      this.emitEnvironmentSnapshot(post)
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
      this.emitEnvironmentSnapshot(post)
      post({
        type: "environment.run.error",
        ...messageScope,
        message: errorMessage(error),
      })
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
        this.emitEnvironmentSnapshot(post)
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
      this.emitEnvironmentSnapshot(post)
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
    this.emitEnvironmentSnapshot(post)
    post({
      type: "environment.run.completed",
      ...this.environmentRunMessageScope(run.requestId),
      payload: this.environmentSnapshot,
    })
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
    const requestId = this.activeEnvironmentRun?.requestId
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
    this.emitEnvironmentSnapshot(post)
    post({
      type: "environment.run.completed",
      ...this.environmentRunMessageScope(requestId),
      payload: this.environmentSnapshot,
    })
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
    this.emitEnvironmentSnapshot(post)
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

  private createSessionRunOperationId(operationKind: SessionRunLifecycleOperationKind): string {
    return `session-run-${operationKind}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  }

  private emitSessionRunOperationPending(
    post: PostMessage,
    operation: {
      operationId: string
      operationKind: SessionRunOperationKind
      sessionRunId?: string
      branchBindingId?: string
      targetBranchBindingId?: string
    },
  ): void {
    this.emitChatMessage({
      type: "sessionRun.operation.pending",
      operationId: operation.operationId,
      operationKind: operation.operationKind,
      ...(operation.sessionRunId ? { sessionRunId: operation.sessionRunId, session_run_id: operation.sessionRunId } : {}),
      ...(operation.branchBindingId ? {
        branchBindingId: operation.branchBindingId,
        branch_binding_id: operation.branchBindingId,
      } : {}),
      ...(operation.targetBranchBindingId ? {
        targetBranchBindingId: operation.targetBranchBindingId,
        target_branch_binding_id: operation.targetBranchBindingId,
      } : {}),
    }, post)
  }

  private emitSessionRunOperationError(
    post: PostMessage,
    operation: {
      operationId: string
      operationKind: SessionRunOperationKind
      message: string
      sessionRunId?: string
      branchBindingId?: string
    },
  ): void {
    this.emitChatMessage({
      type: "sessionRun.operation.error",
      operationId: operation.operationId,
      operationKind: operation.operationKind,
      ...(operation.sessionRunId ? { sessionRunId: operation.sessionRunId, session_run_id: operation.sessionRunId } : {}),
      ...(operation.branchBindingId ? {
        branchBindingId: operation.branchBindingId,
        branch_binding_id: operation.branchBindingId,
      } : {}),
      message: operation.message,
    }, post)
  }

  private emitSessionRunStreamTerminal(
    post: PostMessage,
    terminal: {
      status: SessionRunStreamTerminalStatus
      sessionRunId: string
      branchBindingId: string
      message?: string
    },
  ): void {
    if (terminal.status === "cancelled") {
      this.emitChatMessage({
        type: "sessionRun.cancelled",
        sessionRunId: terminal.sessionRunId,
        branchBindingId: terminal.branchBindingId,
        branch_binding_id: terminal.branchBindingId,
        ...(terminal.message ? { reason: terminal.message } : {}),
      }, post)
      return
    }
    if (terminal.status === "interrupted") {
      this.emitChatMessage({
        type: "sessionRun.interrupted",
        sessionRunId: terminal.sessionRunId,
        branchBindingId: terminal.branchBindingId,
        branch_binding_id: terminal.branchBindingId,
        ...(terminal.message ? { message: terminal.message } : {}),
      }, post)
      return
    }
    if (terminal.status === "error") {
      this.emitChatMessage({
        type: "sessionRun.error",
        sessionRunId: terminal.sessionRunId,
        branchBindingId: terminal.branchBindingId,
        branch_binding_id: terminal.branchBindingId,
        message: terminal.message || "SessionRun failed.",
      }, post)
      return
    }
    this.emitChatMessage({
      type: "sessionRun.done",
      sessionRunId: terminal.sessionRunId,
      branchBindingId: terminal.branchBindingId,
      branch_binding_id: terminal.branchBindingId,
    }, post)
  }

  private acceptVisibleSessionRunOperationOrReport(
    post: PostMessage,
    operation: {
      operationId: string
      operationKind: SessionRunLifecycleOperationKind
      sessionRunId?: string
      branchBindingId?: string
    },
    accept: () => boolean,
  ): boolean {
    const currentScopedOperation = currentSessionRunOperation(this.sessionRuntimeStore)
    const shouldReportRejectedVisibleOperation =
      currentScopedOperation?.operationId === operation.operationId &&
      currentScopedOperation.kind === operation.operationKind
    const accepted = accept()
    if (!accepted && shouldReportRejectedVisibleOperation) {
      this.emitSessionRunOperationError(post, {
        operationId: operation.operationId,
        operationKind: operation.operationKind,
        ...(operation.sessionRunId ? { sessionRunId: operation.sessionRunId } : {}),
        ...(operation.branchBindingId ? { branchBindingId: operation.branchBindingId } : {}),
        message: "操作结果已过期，请重试。",
      })
    }
    return accepted
  }

  private reportSessionRunOperationPreflightFailure(
    post: PostMessage,
    operation: {
      operationId: string
      operationKind: SessionRunOperationKind
      message: string
      sessionRunId?: string
      sourceBranchBindingId?: string
      targetBranchBindingId?: string
    },
  ): void {
    this.emitSessionRunOperationPending(post, {
      operationId: operation.operationId,
      operationKind: operation.operationKind,
      ...(operation.sessionRunId ? { sessionRunId: operation.sessionRunId } : {}),
      ...(operation.sourceBranchBindingId ? { branchBindingId: operation.sourceBranchBindingId } : {}),
      ...(operation.targetBranchBindingId ? { targetBranchBindingId: operation.targetBranchBindingId } : {}),
    })
    this.emitSessionRunOperationError(post, {
      operationId: operation.operationId,
      operationKind: operation.operationKind,
      ...(operation.sessionRunId ? { sessionRunId: operation.sessionRunId } : {}),
      branchBindingId: operation.targetBranchBindingId || operation.sourceBranchBindingId,
      message: operation.message,
    })
  }

  private async reportSessionRunProjectionRecoveryError(
    post: PostMessage,
    failure: {
      sessionRunId: string
      branchBindingId: string
      error: unknown
    },
  ): Promise<void> {
    this.emitChatMessage({
      type: "sessionRun.projection.error",
      sessionRunId: failure.sessionRunId,
      branchBindingId: failure.branchBindingId,
      branch_binding_id: failure.branchBindingId,
      message: chatErrorMessage(failure.error),
    }, post)
    await this.postConnectionStateIfAuthRequired(failure.error, post)
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
      operationId?: string
      branchBindingId?: string
      locale?: string
      providerId?: string
      modelId?: string
      parameters?: Record<string, unknown>
      mentions?: Record<string, unknown>[]
    } = {}
  ): Promise<void> {
    const operationKind: SessionRunOperationKind = "start"
    const operationId = options.operationId?.trim()
    if (!operationId) return
    const targetBranchBindingId = sessionRunStartTargetBranchBindingId(options.branchBindingId)
    let startedSessionRunId = ""
    let startedBranchBindingId = targetBranchBindingId
    const sourceIdentityRevision = this.sessionRunCoordinator.activeRunIdentityRevision
    const activeRun = this.sessionRunCoordinator.activeRun
    beginSessionRunOperation(this.sessionRuntimeStore, {
      operationId,
      operationKind,
      sourceIdentityRevision,
      ...(activeRun?.sessionRunId ? { activeSessionRunId: activeRun.sessionRunId } : {}),
    })
    this.emitSessionRunOperationPending(post, { operationId, operationKind, targetBranchBindingId })
    try {
      const modelError = chatStartupModelError(options)
      if (modelError) {
        if (this.acceptVisibleSessionRunOperationOrReport(
          post,
          { operationId, operationKind, branchBindingId: targetBranchBindingId },
          () => this.sessionRuntimeStore.acceptsFailure({
            operationId,
            operationKind,
            activeRun: this.sessionRunCoordinator.activeRun,
            sourceIdentityRevision: this.sessionRunCoordinator.activeRunIdentityRevision,
          }),
        )) {
          this.emitSessionRunOperationError(post, { operationId, operationKind, branchBindingId: targetBranchBindingId, message: modelError })
        }
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
        if (this.acceptVisibleSessionRunOperationOrReport(
          post,
          { operationId, operationKind, branchBindingId: targetBranchBindingId },
          () => this.sessionRuntimeStore.acceptsFailure({
            operationId,
            operationKind,
            activeRun: this.sessionRunCoordinator.activeRun,
            sourceIdentityRevision: this.sessionRunCoordinator.activeRunIdentityRevision,
          }),
        )) {
          this.emitSessionRunOperationError(post, {
            operationId,
            operationKind,
            branchBindingId: targetBranchBindingId,
            message: "无法准备会话运行。",
          })
        }
        return
      }
      let sessionId = preparedSession.sessionId
      const startOptions = { ...options }
      delete startOptions.branchBindingId
      const start = await this.client.startSessionRun(text, sessionId, {
        ...startOptions,
        locale: this.currentChatLocale(options.locale),
      })
      const startResult = normalizeSessionRunStartResult(start, sessionId)
      if (!startResult) {
        throw new Error("session run start failed: empty session run id")
      }
      sessionId = startResult.sessionId
      const { sessionRunId, agentRunId, activationId, branchBindingId } = startResult
      startedSessionRunId = sessionRunId
      startedBranchBindingId = branchBindingId
      if (!this.acceptVisibleSessionRunOperationOrReport(
        post,
        { operationId, operationKind, sessionRunId, branchBindingId },
        () => this.sessionRuntimeStore.acceptsStartSuccess({
          operationId,
          activeRun: this.sessionRunCoordinator.activeRun,
          sourceIdentityRevision: this.sessionRunCoordinator.activeRunIdentityRevision,
          responseSessionRunId: sessionRunId,
          responseBranchBindingId: branchBindingId,
          responseAgentRunId: agentRunId,
        }),
      )) return
      this.sessionRunCoordinator.setActiveRun({
        sessionRunId,
        cursor: 0,
        sessionId,
        draftSessionId: options.draftSessionId,
        status: "running",
        ...(agentRunId ? { agentRunId } : {}),
        ...(activationId ? { activationId } : {}),
        branchBindingId,
        startedAt: new Date().toISOString(),
        reconnectAttempts: 0,
        lastStreamAt: new Date().toISOString(),
      })
      this.sessionRuntimeStore.ensureBranchRuntimeScope({
        sessionRunId,
        branchBindingId,
        ...(agentRunId ? { agentRunId } : {}),
        ...(activationId ? { activeActivationId: activationId } : {}),
        status: "running",
        streamCursor: 0,
        select: true,
      })
      this.emitChatMessage({
        type: "sessionRun.session",
        operationId,
        operationKind,
        sessionRunId,
        sessionId,
        branchBindingId,
        branch_binding_id: branchBindingId,
      }, post)
      this.ensureSessionRunEventStream(sessionRunId, sessionId || "", post, branchBindingId)
    } catch (error) {
      if (!this.acceptVisibleSessionRunOperationOrReport(
        post,
        {
          operationId,
          operationKind,
          ...(startedSessionRunId ? { sessionRunId: startedSessionRunId } : {}),
          ...(startedBranchBindingId ? { branchBindingId: startedBranchBindingId } : {}),
        },
        () => this.sessionRuntimeStore.acceptsFailure({
          operationId,
          operationKind,
          activeRun: this.sessionRunCoordinator.activeRun,
          sourceIdentityRevision: this.sessionRunCoordinator.activeRunIdentityRevision,
        }),
      )) return
      this.emitSessionRunOperationError(post, {
        operationId,
        operationKind,
        ...(startedSessionRunId ? { sessionRunId: startedSessionRunId } : {}),
        ...(startedBranchBindingId ? { branchBindingId: startedBranchBindingId } : {}),
        message: chatErrorMessage(error),
      })
      await this.postConnectionStateIfAuthRequired(error, post)
    }
  }

  private async continueSessionRun(
    text: string,
    post: PostMessage,
    options: {
      sessionRunId?: string
      branchBindingId?: string
      clientRequestId?: string
      operationId?: string
      sourceScope?: SessionRunOperationSourceScope
      locale?: string
      mentions?: Record<string, unknown>[]
    } = {}
  ): Promise<void> {
    const operationKind = "continue"
    const sourceScope = options.sourceScope || "selected-visible"
    const operationId = options.operationId?.trim() ||
      (sourceScope === "branch-local" ? this.createSessionRunOperationId(operationKind) : undefined)
    if (!operationId) return
    const sourceResolution = resolveSessionRunSourceIdentity({
      activeRun: this.sessionRunCoordinator.activeRun,
      sourceIdentityRevision: this.sessionRunCoordinator.activeRunIdentityRevision,
      sessionRunId: options.sessionRunId,
      branchBindingId: options.branchBindingId,
      scope: sourceScope,
    })
    if (!sourceResolution.ok) {
      if (sourceScope === "branch-local") {
        const snapshotSessionRunId = sourceResolution.sessionRunId
        if (snapshotSessionRunId) {
          this.sessionRunCoordinator.postPendingNextTurnsSnapshot(
            post,
            snapshotSessionRunId,
            sourceResolution.targetBranchBindingId,
          )
        }
      } else {
        this.reportSessionRunOperationPreflightFailure(post, {
          operationId,
          operationKind,
          ...(sourceResolution.sessionRunId ? { sessionRunId: sourceResolution.sessionRunId } : {}),
          ...(sourceResolution.sourceBranchBindingId ? {
            sourceBranchBindingId: sourceResolution.sourceBranchBindingId,
          } : {}),
          targetBranchBindingId: sourceResolution.targetBranchBindingId,
          message: sourceResolution.message,
        })
      }
      return
    }
    const resolvedSource = sourceResolution.value
    const { source, targetBranchBindingId: branchBindingId } = resolvedSource
    const sessionRunId = source.sessionRunId
    beginSessionRunOperation(this.sessionRuntimeStore, {
      operationId,
      operationKind,
      sourceScope: resolvedSource.scope,
      source,
      targetBranchBindingId: branchBindingId,
    })
    if (resolvedSource.emitWebviewOperation) {
      this.emitSessionRunOperationPending(post, {
        operationId,
        operationKind,
        sessionRunId,
        branchBindingId,
        targetBranchBindingId: branchBindingId,
      })
    }
    try {
      const result = await this.client.continueSessionRun({
        sessionRunId,
        branchBindingId,
        prompt: text,
        clientRequestId: options.clientRequestId,
        locale: this.currentChatLocale(options.locale),
        mentions: options.mentions,
      })
      const responseSessionRunId = stringValue(result.session_run_id) || stringValue(result.sessionRunId)
      const responseBranchBindingId = stringValue(result.branch_binding_id) || stringValue(result.branchBindingId)
      const agentRunId = stringValue(result.agent_run_id) || stringValue(result.agentRunId)
      const activationId = stringValue(result.activation_id) || stringValue(result.activationId)
      if (resolvedSource.scope === "branch-local") {
        const accepted = this.sessionRuntimeStore.settleBranchLocalSuccess({
          operationId,
          operationKind,
          ...(responseSessionRunId ? { responseSessionRunId } : {}),
          ...(responseBranchBindingId ? { responseBranchBindingId } : {}),
          ...(agentRunId ? { responseAgentRunId: agentRunId } : {}),
        })
        if (!accepted) return
        this.applySessionRunControlSuccessEffect({
          post,
          operationId,
          operationKind,
          text,
          resolvedSource,
          sessionRunId,
          branchBindingId,
          clientRequestId: options.clientRequestId,
          agentRunId,
          activationId,
        })
        return
      }
      if (!this.acceptVisibleSessionRunOperationOrReport(
        post,
        { operationId, operationKind, sessionRunId, branchBindingId },
        () => this.sessionRuntimeStore.acceptsControlSuccess({
          operationId,
          operationKind,
          activeRun: this.sessionRunCoordinator.activeRun,
          sourceIdentityRevision: this.sessionRunCoordinator.activeRunIdentityRevision,
          ...(responseSessionRunId ? { responseSessionRunId } : {}),
          ...(responseBranchBindingId ? { responseBranchBindingId } : {}),
          ...(agentRunId ? { responseAgentRunId: agentRunId } : {}),
        }),
      )) return
      this.applySessionRunControlSuccessEffect({
        post,
        operationId,
        operationKind,
        text,
        resolvedSource,
        sessionRunId,
        branchBindingId,
        clientRequestId: options.clientRequestId,
        agentRunId,
        activationId,
      })
    } catch (error) {
      await this.applySessionRunControlFailureEffect({
        post,
        error,
        operationId,
        operationKind,
        resolvedSource,
        sessionRunId,
        branchBindingId,
      })
    }
  }

  private applySessionRunControlSuccessEffect(input: {
    post: PostMessage
    operationId: string
    operationKind: SessionRunLifecycleOperationKind
    text: string
    resolvedSource: ResolvedSessionRunSourceIdentity
    sessionRunId: string
    branchBindingId: string
    clientRequestId?: string
    agentRunId?: string
    activationId?: string
  }): void {
    const targetSelectedNow = this.activeSessionRunMatches({
      sessionRunId: input.sessionRunId,
      branchBindingId: input.branchBindingId,
    })
    if (input.resolvedSource.emitWebviewOperation || targetSelectedNow) {
      this.emitChatMessage({
        type: "sessionRun.continued",
        ...(input.resolvedSource.emitWebviewOperation
          ? {
              operationId: input.operationId,
              operationKind: input.operationKind,
            }
          : {}),
        text: input.text,
        sessionRunId: input.sessionRunId,
        branchBindingId: input.branchBindingId,
        branch_binding_id: input.branchBindingId,
      }, input.post)
    }
    this.sessionRunCoordinator.removePendingNextTurnForBranch(input.sessionRunId, input.branchBindingId, {
      clientRequestId: input.clientRequestId,
      text: input.text,
    })
    this.sessionRunCoordinator.postPendingNextTurnsSnapshot(input.post, input.sessionRunId, input.branchBindingId)
    const activeRun = this.sessionRunCoordinator.activeRun
    const streamSessionId = input.resolvedSource.sessionId || activeRun?.sessionId || ""
    this.sessionRuntimeStore.ensureBranchRuntimeScope({
      sessionRunId: input.sessionRunId,
      branchBindingId: input.branchBindingId,
      ...(input.agentRunId ? { agentRunId: input.agentRunId } : {}),
      ...(input.activationId ? { activeActivationId: input.activationId } : {}),
      status: "running",
      ...(targetSelectedNow ? { streamCursor: activeRun?.cursor ?? 0 } : {}),
    })
    this.ensureSessionRunEventStream(
      input.sessionRunId,
      streamSessionId,
      input.post,
      input.branchBindingId,
    )
    if (!targetSelectedNow) return

    this.sessionRunCoordinator.patchActiveRun({
      status: "running",
      cursor: activeRun?.cursor ?? 0,
      branchBindingId: input.branchBindingId,
      ...(input.agentRunId ? { agentRunId: input.agentRunId } : {}),
      ...(input.activationId ? { activationId: input.activationId } : {}),
      reconnectAttempts: 0,
      lastStreamAt: new Date().toISOString(),
    })
  }

  private async applySessionRunControlFailureEffect(input: {
    post: PostMessage
    error: unknown
    operationId: string
    operationKind: SessionRunLifecycleOperationKind
    resolvedSource: ResolvedSessionRunSourceIdentity
    sessionRunId: string
    branchBindingId: string
  }): Promise<void> {
    if (input.resolvedSource.scope === "branch-local") {
      this.sessionRuntimeStore.settleBranchLocalFailure({
        operationId: input.operationId,
        operationKind: input.operationKind,
      })
      this.sessionRunCoordinator.postPendingNextTurnsSnapshot(input.post, input.sessionRunId, input.branchBindingId)
      await this.postConnectionStateIfAuthRequired(input.error, input.post)
      return
    }
    const accepted = this.acceptVisibleSessionRunOperationOrReport(
      input.post,
      {
        operationId: input.operationId,
        operationKind: input.operationKind,
        sessionRunId: input.sessionRunId,
        branchBindingId: input.branchBindingId,
      },
      () => this.sessionRuntimeStore.acceptsFailure({
        operationId: input.operationId,
        operationKind: input.operationKind,
        activeRun: this.sessionRunCoordinator.activeRun,
        sourceIdentityRevision: this.sessionRunCoordinator.activeRunIdentityRevision,
      }),
    )
    if (!accepted) return
    this.emitSessionRunOperationError(input.post, {
      operationId: input.operationId,
      operationKind: input.operationKind,
      sessionRunId: input.sessionRunId,
      branchBindingId: input.branchBindingId,
      message: chatErrorMessage(input.error),
    })
    await this.postConnectionStateIfAuthRequired(input.error, input.post)
  }

  private async steerAgentRun(
    text: string,
    post: PostMessage,
    options: {
      clientSteerId?: string
      operationId?: string
      sessionRunId?: string
      branchBindingId?: string
      locale?: string
      mentions?: Record<string, unknown>[]
    } = {}
  ): Promise<void> {
    const operationKind: SessionRunLifecycleOperationKind = "steer"
    const operationId = options.operationId?.trim()
    if (!operationId) return
    const activeRun = this.sessionRunCoordinator.activeRun
    const requestedSessionRunId = options.sessionRunId?.trim() || ""
    const branchBindingId = options.branchBindingId?.trim() || ""
    if (!requestedSessionRunId || !branchBindingId) {
      this.reportSessionRunOperationPreflightFailure(post, {
        operationId,
        operationKind,
        message: "会话运行操作缺少明确的分支身份。",
      })
      return
    }
    const sourceResolution = resolveSessionRunSourceIdentity({
      activeRun,
      sourceIdentityRevision: this.sessionRunCoordinator.activeRunIdentityRevision,
      sessionRunId: requestedSessionRunId,
      branchBindingId,
      scope: "selected-visible",
    })
    if (!sourceResolution.ok) {
      this.reportSessionRunOperationPreflightFailure(post, {
        operationId,
        operationKind,
        ...(sourceResolution.sessionRunId ? { sessionRunId: sourceResolution.sessionRunId } : {}),
        ...(sourceResolution.sourceBranchBindingId ? {
          sourceBranchBindingId: sourceResolution.sourceBranchBindingId,
        } : {}),
        targetBranchBindingId: sourceResolution.targetBranchBindingId,
        message: sourceResolution.message,
      })
      return
    }
    const { source, targetBranchBindingId: resolvedBranchBindingId } = sourceResolution.value
    const agentRunId = source.agentRunId
    const sessionRunId = source.sessionRunId
    const pendingNextTurn = () => ({
      text,
      sessionRunId,
      branchBindingId: resolvedBranchBindingId,
      ...(options.clientSteerId ? { clientRequestId: options.clientSteerId } : {}),
      ...(options.locale ? { locale: this.currentChatLocale(options.locale) } : {}),
      ...(options.mentions?.length ? { mentions: options.mentions } : {}),
      queuedAt: new Date().toISOString(),
    })
    beginSessionRunOperation(this.sessionRuntimeStore, {
      operationId,
      operationKind,
      source,
      targetBranchBindingId: resolvedBranchBindingId,
    })
    this.emitSessionRunOperationPending(post, {
      operationId,
      operationKind,
      sessionRunId,
      branchBindingId: resolvedBranchBindingId,
      targetBranchBindingId: resolvedBranchBindingId,
    })
    if (!activeRun?.activationId) {
      if (!this.acceptVisibleSessionRunOperationOrReport(
        post,
        { operationId, operationKind, sessionRunId, branchBindingId: resolvedBranchBindingId },
        () => this.sessionRuntimeStore.acceptsControlSuccess({
          operationId,
          operationKind,
          activeRun: this.sessionRunCoordinator.activeRun,
          sourceIdentityRevision: this.sessionRunCoordinator.activeRunIdentityRevision,
          responseSessionRunId: sessionRunId,
          responseBranchBindingId: resolvedBranchBindingId,
          responseAgentRunId: agentRunId,
        }),
      )) return
      const nextTurn = pendingNextTurn()
      this.emitChatMessage({
        type: "sessionRun.pendingNextTurn",
        sessionRunId,
        branchBindingId: resolvedBranchBindingId,
        branch_binding_id: resolvedBranchBindingId,
        pendingNextTurn: nextTurn,
        pending_next_turn: nextTurn,
      }, post)
      this.sessionRunCoordinator.enqueuePendingNextTurnForBranch(
        sessionRunId,
        resolvedBranchBindingId,
        nextTurn
      )
      this.emitChatMessage({
        type: "sessionRun.steer",
        operationId,
        operationKind,
        sessionRunId,
        branchBindingId: resolvedBranchBindingId,
        branch_binding_id: resolvedBranchBindingId,
        agentRunId,
        agent_run_id: agentRunId,
        status: "queued_next_turn",
      }, post)
      return
    }
    try {
      const result = await this.client.steerAgentRun({
        agentRunId,
        sessionRunId,
        text,
        activationId: activeRun.activationId,
        branchBindingId: resolvedBranchBindingId,
        clientSteerId: options.clientSteerId,
      })
      const responseAgentRunId = stringValue(result.agent_run_id) || stringValue(result.agentRunId) || agentRunId
      if (!this.acceptVisibleSessionRunOperationOrReport(
        post,
        { operationId, operationKind, sessionRunId, branchBindingId: resolvedBranchBindingId },
        () => this.sessionRuntimeStore.acceptsControlSuccess({
          operationId,
          operationKind,
          activeRun: this.sessionRunCoordinator.activeRun,
          sourceIdentityRevision: this.sessionRunCoordinator.activeRunIdentityRevision,
          responseSessionRunId: sessionRunId,
          responseBranchBindingId: resolvedBranchBindingId,
          responseAgentRunId,
        }),
      )) return
      this.emitChatMessage({
        type: "sessionRun.steer",
        operationId,
        operationKind,
        sessionRunId,
        branchBindingId: resolvedBranchBindingId,
        branch_binding_id: resolvedBranchBindingId,
        agentRunId,
        agent_run_id: agentRunId,
        status: stringValue(result.status) || "accepted",
        payload: result,
      }, post)
    } catch (error) {
      if (remoteErrorCode(error) === "agent_run_not_steerable") {
        if (!this.acceptVisibleSessionRunOperationOrReport(
          post,
          { operationId, operationKind, sessionRunId, branchBindingId: resolvedBranchBindingId },
          () => this.sessionRuntimeStore.acceptsControlSuccess({
            operationId,
            operationKind,
            activeRun: this.sessionRunCoordinator.activeRun,
            sourceIdentityRevision: this.sessionRunCoordinator.activeRunIdentityRevision,
            responseSessionRunId: sessionRunId,
            responseBranchBindingId: resolvedBranchBindingId,
            responseAgentRunId: agentRunId,
          }),
        )) return
        const nextTurn = pendingNextTurn()
        this.sessionRunCoordinator.enqueuePendingNextTurnForBranch(
          sessionRunId,
          resolvedBranchBindingId,
          nextTurn
        )
        this.emitChatMessage({
          type: "sessionRun.pendingNextTurn",
          sessionRunId,
          branchBindingId: resolvedBranchBindingId,
          branch_binding_id: resolvedBranchBindingId,
          pendingNextTurn: nextTurn,
          pending_next_turn: nextTurn,
        }, post)
        this.emitChatMessage({
          type: "sessionRun.steer",
          operationId,
          operationKind,
          sessionRunId,
          branchBindingId: resolvedBranchBindingId,
          branch_binding_id: resolvedBranchBindingId,
          agentRunId,
          agent_run_id: agentRunId,
          status: "queued_next_turn",
        }, post)
        return
      }
      if (!this.acceptVisibleSessionRunOperationOrReport(
        post,
        { operationId, operationKind, sessionRunId, branchBindingId: resolvedBranchBindingId },
        () => this.sessionRuntimeStore.acceptsFailure({
          operationId,
          operationKind,
          activeRun: this.sessionRunCoordinator.activeRun,
          sourceIdentityRevision: this.sessionRunCoordinator.activeRunIdentityRevision,
        }),
      )) return
      this.emitSessionRunOperationError(post, {
        operationId,
        operationKind,
        sessionRunId,
        branchBindingId: resolvedBranchBindingId,
        message: chatErrorMessage(error),
      })
      await this.postConnectionStateIfAuthRequired(error, post)
    }
  }

  private async branchSessionRun(
    request: {
      sessionRunId?: string
      baseSessionItemId: string
      prompt: string
      operationId?: string
      sourceBranchBindingId?: string
      branchBindingId?: string
      sourceLabel?: string
      sourceMessageId?: string
      sourceNodeId?: string
      composeMode?: "edit" | "fork"
    },
    post: PostMessage
  ): Promise<void> {
    const activeRun = this.sessionRunCoordinator.activeRun
    const baseSessionItemId = request.baseSessionItemId.trim()
    const prompt = request.prompt.trim()
    const runtimeRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || ""
    const operationKind: SessionRunOperationKind = "branch.create"
    const operationId = request.operationId?.trim()
    if (!operationId) return
    const requestedSessionRunId = request.sessionRunId?.trim() || ""
    const sourceBranchBindingId = request.sourceBranchBindingId?.trim() || ""
    const branchBindingId = request.branchBindingId?.trim() || ""
    if (!requestedSessionRunId || !branchBindingId) {
      this.reportSessionRunOperationPreflightFailure(post, {
        operationId,
        operationKind,
        message: "缺少可创建的会话分支。",
      })
      return
    }
    const sourceResolution = resolveSessionRunSourceIdentity({
      activeRun,
      sourceIdentityRevision: this.sessionRunCoordinator.activeRunIdentityRevision,
      sessionRunId: requestedSessionRunId,
      branchBindingId: sourceBranchBindingId,
      scope: "selected-visible",
    })
    if (!sourceResolution.ok) {
      this.reportSessionRunOperationPreflightFailure(post, {
        operationId,
        operationKind,
        ...(sourceResolution.sessionRunId ? { sessionRunId: sourceResolution.sessionRunId } : {}),
        ...(sourceResolution.sourceBranchBindingId ? {
          sourceBranchBindingId: sourceResolution.sourceBranchBindingId,
        } : {}),
        targetBranchBindingId: branchBindingId,
        message: "当前会话没有可分支的 AgentRun mainline。",
      })
      return
    }
    const resolvedSource = sourceResolution.value
    const { source } = resolvedSource
    const sessionRunId = source.sessionRunId
    const sessionId = resolvedSource.sessionId || activeRun?.sessionId || ""
    const resolvedSourceAgentRunId = source.agentRunId
    const resolvedSourceBranchBindingId = source.branchBindingId
    if (!baseSessionItemId) {
      this.reportSessionRunOperationPreflightFailure(post, {
        operationId,
        operationKind,
        sessionRunId,
        sourceBranchBindingId: resolvedSourceBranchBindingId,
        targetBranchBindingId: branchBindingId,
        message: "缺少分支基准消息，无法创建会话分支。",
      })
      return
    }
    if (!prompt) {
      this.reportSessionRunOperationPreflightFailure(post, {
        operationId,
        operationKind,
        sessionRunId,
        sourceBranchBindingId: resolvedSourceBranchBindingId,
        targetBranchBindingId: branchBindingId,
        message: "分支需要新的用户输入。",
      })
      return
    }
    if (!runtimeRoot) {
      this.reportSessionRunOperationPreflightFailure(post, {
        operationId,
        operationKind,
        sessionRunId,
        sourceBranchBindingId: resolvedSourceBranchBindingId,
        targetBranchBindingId: branchBindingId,
        message: "没有可用工作区，无法创建 AgentRun 分支。",
      })
      return
    }
    beginSessionRunOperation(this.sessionRuntimeStore, {
      operationId,
      operationKind,
      source,
      targetBranchBindingId: branchBindingId,
    })
    this.emitSessionRunOperationPending(post, {
      operationId,
      operationKind,
      sessionRunId,
      branchBindingId: resolvedSourceBranchBindingId,
      targetBranchBindingId: branchBindingId,
    })
    try {
      const result = await this.client.branchAgentRun({
        sourceAgentRunId: resolvedSourceAgentRunId,
        baseSessionItemId,
        runtimeRoot,
        prompt,
        branchBindingId,
        selectBranch: true,
        metadata: {
          source: request.composeMode === "edit" ? "chat_message_edit" : "chat_fork_from_here",
          ...(request.sourceLabel ? { source_label: request.sourceLabel } : {}),
          ...(request.sourceMessageId ? { source_message_id: request.sourceMessageId } : {}),
          ...(request.sourceNodeId ? { source_node_id: request.sourceNodeId } : {}),
        },
      })
      const branchResult = normalizeBranchCreateResult(result)
      if (!branchResult) {
        throw new Error("AgentRun branch failed: missing canonical branch result")
      }
      if (!branchResult.agentRunId) {
        throw new Error("AgentRun branch failed: empty target agent run id")
      }
      const agentRunId = branchResult.agentRunId
      const activationId = branchResult.activationId || ""
      const responseBranchBindingId = branchResult.branchBindingId
      if (!this.acceptVisibleSessionRunOperationOrReport(
        post,
        { operationId, operationKind, sessionRunId, branchBindingId },
        () => this.sessionRuntimeStore.acceptsBranchCreateSuccess({
          operationId,
          activeRun: this.sessionRunCoordinator.activeRun,
          sourceIdentityRevision: this.sessionRunCoordinator.activeRunIdentityRevision,
          responseBranchBindingId,
        }),
      )) return
      this.sessionRunCoordinator.patchActiveRun({
        status: "running",
        agentRunId,
        activationId: activationId || undefined,
        branchBindingId: responseBranchBindingId,
        cursor: 0,
        reconnectAttempts: 0,
        lastStreamAt: new Date().toISOString(),
      })
      this.sessionRuntimeStore.ensureBranchRuntimeScope({
        sessionRunId,
        branchBindingId: responseBranchBindingId,
        agentRunId,
        ...(activationId ? { activeActivationId: activationId } : {}),
        status: "running",
        streamCursor: 0,
        select: true,
      })
      this.emitChatMessage({
        type: "sessionRun.branch.started",
        operationId,
        operationKind,
        sessionRunId,
        sessionId,
        agentRunId,
        agent_run_id: agentRunId,
        activationId,
        activation_id: activationId,
        branchBindingId: responseBranchBindingId,
        branch_binding_id: responseBranchBindingId,
        baseSessionItemId,
        base_session_item_id: baseSessionItemId,
        prompt,
        payload: result,
      }, post)
      this.ensureSessionRunEventStreamSoon(sessionRunId, sessionId, post, responseBranchBindingId)
    } catch (error) {
      if (!this.acceptVisibleSessionRunOperationOrReport(
        post,
        { operationId, operationKind, sessionRunId, branchBindingId },
        () => this.sessionRuntimeStore.acceptsFailure({
          operationId,
          operationKind,
          activeRun: this.sessionRunCoordinator.activeRun,
          sourceIdentityRevision: this.sessionRunCoordinator.activeRunIdentityRevision,
        }),
      )) return
      this.emitSessionRunOperationError(post, {
        operationId,
        operationKind,
        sessionRunId,
        branchBindingId,
        message: chatErrorMessage(error),
      })
      await this.postConnectionStateIfAuthRequired(error, post)
    }
  }

  private async selectSessionRunBranch(
    request: { sessionRunId?: string; sourceBranchBindingId?: string; branchBindingId: string; operationId?: string },
    post: PostMessage
  ): Promise<void> {
    const activeRun = this.sessionRunCoordinator.activeRun
    const requestedSessionRunId = request.sessionRunId?.trim() || ""
    const sourceBranchBindingId = request.sourceBranchBindingId?.trim() || ""
    const branchBindingId = request.branchBindingId.trim()
    const operationKind: SessionRunOperationKind = "branch.select"
    const operationId = request.operationId?.trim()
    if (!operationId) return
    const sourceResolution = resolveSessionRunSourceIdentity({
      activeRun,
      sourceIdentityRevision: this.sessionRunCoordinator.activeRunIdentityRevision,
      sessionRunId: requestedSessionRunId,
      branchBindingId: sourceBranchBindingId,
      scope: "selected-visible",
    })
    if (!branchBindingId || !sourceResolution.ok) {
      const sourceBranchBindingId = sourceResolution.ok
        ? sourceResolution.value.source.branchBindingId
        : sourceResolution.sourceBranchBindingId
      this.reportSessionRunOperationPreflightFailure(post, {
        operationId,
        operationKind,
        ...(sourceResolution.ok ? { sessionRunId: sourceResolution.value.source.sessionRunId } : {}),
        ...(sourceBranchBindingId ? { sourceBranchBindingId } : {}),
        targetBranchBindingId: branchBindingId || sourceBranchBindingId,
        message: "缺少可切换的会话分支。",
      })
      return
    }
    const resolvedSource = sourceResolution.value
    const { source } = resolvedSource
    const sessionRunId = source.sessionRunId
    const resolvedSourceBranchBindingId = source.branchBindingId
    if (resolvedSourceBranchBindingId === branchBindingId) {
      this.reportSessionRunOperationPreflightFailure(post, {
        operationId,
        operationKind,
        sessionRunId,
        sourceBranchBindingId: resolvedSourceBranchBindingId,
        targetBranchBindingId: branchBindingId,
        message: "该分支已经是当前会话分支。",
      })
      return
    }
    beginSessionRunOperation(this.sessionRuntimeStore, {
      operationId,
      operationKind,
      source,
      targetBranchBindingId: branchBindingId,
    })
    this.emitSessionRunOperationPending(post, {
      operationId,
      operationKind,
      sessionRunId,
      branchBindingId: resolvedSourceBranchBindingId,
      targetBranchBindingId: branchBindingId,
    })
    try {
      const status = await this.client.selectSessionRunBranch({
        sessionRunId,
        branchBindingId,
        cursor: 0,
      })
      const branchResult = normalizeBranchSelectResult(status, resolvedSource.sessionId || activeRun?.sessionId || "")
      if (!branchResult) throw new Error("SessionRun branch select failed: missing canonical branch result")
      const responseBranchBindingId = branchResult.branchBindingId
      const branchSelectSuccessStillCurrent = () => {
        const accepted = this.sessionRuntimeStore.branchSelectSuccessStillCurrent({
          operationId,
          activeRun: this.sessionRunCoordinator.activeRun,
          sourceIdentityRevision: this.sessionRunCoordinator.activeRunIdentityRevision,
          responseBranchBindingId,
        })
        if (!accepted) {
          this.sessionRuntimeStore.rejectVisibleOperation({ operationId, operationKind })
        }
        return accepted
      }
      if (!this.acceptVisibleSessionRunOperationOrReport(
        post,
        { operationId, operationKind, sessionRunId, branchBindingId },
        branchSelectSuccessStillCurrent,
      )) return
      const sessionId = branchResult.sessionId
      const agentRunId = branchResult.agentRunId
      const activationId = branchResult.activationId
      const branches = branchResult.branches
      const running = branchResult.running
      const batch = await this.client.fetchSessionRunEventsBatch(sessionRunId, 0, responseBranchBindingId, {
        timeoutSec: 1,
        timeoutMs: 2_500,
      })
      if (!this.acceptVisibleSessionRunOperationOrReport(
        post,
        { operationId, operationKind, sessionRunId, branchBindingId },
        branchSelectSuccessStillCurrent,
      )) return
      if (branches.length) {
        this.emitChatMessage({
          type: "sessionRun.branches",
          sessionRunId,
          branchBindingId: responseBranchBindingId,
          branch_binding_id: responseBranchBindingId,
          branches,
        }, post)
      }
      this.sessionRuntimeStore.ensureBranchRuntimeScope({
        sessionRunId,
        branchBindingId: responseBranchBindingId,
        ...(agentRunId ? { agentRunId } : {}),
        ...(activationId ? { activeActivationId: activationId } : {}),
        status: branchResult.status,
        streamCursor: 0,
      })
      if (Object.keys(batch).length) {
        await this.applySessionRunEventsBatch(
          sessionRunId,
          sessionId,
          responseBranchBindingId,
          0,
          batch,
          post,
          { emitScopedEvents: true, applyVisibleSideEffects: false },
        )
      }
      if (!this.acceptVisibleSessionRunOperationOrReport(
        post,
        { operationId, operationKind, sessionRunId, branchBindingId },
        branchSelectSuccessStillCurrent,
      )) return
      this.sessionRuntimeStore.settleBranchSelectSuccess(operationId)
      this.sessionRuntimeStore.ensureBranchRuntimeScope({
        sessionRunId,
        branchBindingId: responseBranchBindingId,
        ...(agentRunId ? { agentRunId } : {}),
        ...(activationId ? { activeActivationId: activationId } : {}),
        status: branchResult.status,
        streamCursor: 0,
        select: true,
      })
      this.sessionRunCoordinator.patchActiveRun({
        sessionId,
        status: branchResult.status,
        cursor: 0,
        branchBindingId: responseBranchBindingId,
        agentRunId,
        activationId,
        ...(branches.length ? { branches } : {}),
        reconnectAttempts: 0,
        lastStreamAt: new Date().toISOString(),
      })
      this.emitChatMessage({
        type: "sessionRun.branch.selected",
        operationId,
        operationKind,
        sessionRunId,
        sessionId,
        branchBindingId: responseBranchBindingId,
        branch_binding_id: responseBranchBindingId,
        running,
        status: branchResult.status,
        branches,
        payload: status,
      }, post)
      if (branches.length) {
        this.emitChatMessage({
          type: "sessionRun.branches",
          sessionRunId,
          branches,
        }, post)
      }
      this.sessionRunCoordinator.postPendingNextTurnsSnapshot(post, sessionRunId, responseBranchBindingId)
      this.ensureSessionRunEventStreamSoon(sessionRunId, sessionId, post, responseBranchBindingId)
    } catch (error) {
      if (!this.acceptVisibleSessionRunOperationOrReport(
        post,
        { operationId, operationKind, sessionRunId, branchBindingId },
        () => this.sessionRuntimeStore.acceptsFailure({
          operationId,
          operationKind,
          activeRun: this.sessionRunCoordinator.activeRun,
          sourceIdentityRevision: this.sessionRunCoordinator.activeRunIdentityRevision,
        }),
      )) return
      this.emitSessionRunOperationError(post, {
        operationId,
        operationKind,
        sessionRunId,
        branchBindingId,
        message: chatErrorMessage(error),
      })
      await this.postConnectionStateIfAuthRequired(error, post)
    }
  }

  private async startCapabilityPackageIngestSession(
    message: WebviewToHostMessage,
    post: PostMessage
  ): Promise<void> {
    const operationKind: SessionRunOperationKind = "start"
    const operationId = stringValue(message.operationId) || this.createSessionRunOperationId(operationKind)
    const targetBranchBindingId = sessionRunStartTargetBranchBindingId()
    let startedSessionRunId = ""
    let startedBranchBindingId = targetBranchBindingId
    const activeRun = this.sessionRunCoordinator.activeRun
    beginSessionRunOperation(this.sessionRuntimeStore, {
      operationId,
      operationKind,
      sourceIdentityRevision: this.sessionRunCoordinator.activeRunIdentityRevision,
      ...(activeRun?.sessionRunId ? { activeSessionRunId: activeRun.sessionRunId } : {}),
    })
    this.emitSessionRunOperationPending(post, { operationId, operationKind, targetBranchBindingId })
    try {
      await vscode.commands.executeCommand("workbench.view.extension.labrastro-ActivityBar")
      const payload = objectValue(message.payload)
      const preparedSession = await this.sessionCoordinator.prepareSessionRunSession(
        stringValue(payload.session_id) || stringValue(payload.sessionId),
        post,
        {
          mode: "capability_package",
          workflowMode: "capability_package_ingest",
        }
      )
      if (!preparedSession.ok) {
        if (this.acceptVisibleSessionRunOperationOrReport(
          post,
          { operationId, operationKind, branchBindingId: targetBranchBindingId },
          () => this.sessionRuntimeStore.acceptsFailure({
            operationId,
            operationKind,
            activeRun: this.sessionRunCoordinator.activeRun,
            sourceIdentityRevision: this.sessionRunCoordinator.activeRunIdentityRevision,
          }),
        )) {
          this.emitSessionRunOperationError(post, {
            operationId,
            operationKind,
            branchBindingId: targetBranchBindingId,
            message: "无法准备能力包会话运行。",
          })
        }
        return
      }
      const sessionId = preparedSession.sessionId
      const locale = this.currentChatLocale(stringValue(payload.locale))
      const start = await this.client.capabilityPackageIngestSessionStart({
        ...payload,
        session_id: sessionId,
        locale,
        client_request_id:
          stringValue(payload.client_request_id) ||
          stringValue(payload.clientRequestId) ||
          `capability-package-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      })
      const startResult = normalizeSessionRunStartResult(start, sessionId || "")
      if (!startResult) {
        throw new Error("capability package session start failed: empty session run id")
      }
      const { sessionRunId } = startResult
      startedSessionRunId = sessionRunId
      startedBranchBindingId = startResult.branchBindingId
      const resolvedSessionId = startResult.sessionId
      if (!this.acceptVisibleSessionRunOperationOrReport(
        post,
        { operationId, operationKind, sessionRunId, branchBindingId: startResult.branchBindingId },
        () => this.sessionRuntimeStore.acceptsStartSuccess({
          operationId,
          activeRun: this.sessionRunCoordinator.activeRun,
          sourceIdentityRevision: this.sessionRunCoordinator.activeRunIdentityRevision,
          responseSessionRunId: sessionRunId,
          responseBranchBindingId: startResult.branchBindingId,
          responseAgentRunId: startResult.agentRunId,
        }),
      )) return
      this.sessionRunCoordinator.setActiveRun({
        sessionRunId,
        cursor: 0,
        sessionId: resolvedSessionId,
        status: "running",
        ...(startResult.agentRunId ? { agentRunId: startResult.agentRunId } : {}),
        ...(startResult.activationId ? { activationId: startResult.activationId } : {}),
        branchBindingId: startResult.branchBindingId,
        startedAt: new Date().toISOString(),
        reconnectAttempts: 0,
        lastStreamAt: new Date().toISOString(),
      })
      this.sessionRuntimeStore.ensureBranchRuntimeScope({
        sessionRunId,
        branchBindingId: startResult.branchBindingId,
        ...(startResult.agentRunId ? { agentRunId: startResult.agentRunId } : {}),
        ...(startResult.activationId ? { activeActivationId: startResult.activationId } : {}),
        status: "running",
        streamCursor: 0,
        select: true,
      })
      this.emitChatMessage({
        type: "sessionRun.session",
        operationId,
        operationKind,
        sessionRunId,
        sessionId: resolvedSessionId,
        branchBindingId: startResult.branchBindingId,
        branch_binding_id: startResult.branchBindingId,
        runtimeState: startResult.runtimeState,
        payload: start,
      }, post)
      post({ type: "capabilityPackage.ingest.session.started", payload: start })
      this.ensureSessionRunEventStream(
        sessionRunId,
        resolvedSessionId,
        post,
        startResult.branchBindingId
      )
    } catch (error) {
      post({ type: "capabilityPackage.error", message: errorMessage(error) })
      if (this.acceptVisibleSessionRunOperationOrReport(
        post,
        {
          operationId,
          operationKind,
          ...(startedSessionRunId ? { sessionRunId: startedSessionRunId } : {}),
          ...(startedBranchBindingId ? { branchBindingId: startedBranchBindingId } : {}),
        },
        () => this.sessionRuntimeStore.acceptsFailure({
          operationId,
          operationKind,
          activeRun: this.sessionRunCoordinator.activeRun,
          sourceIdentityRevision: this.sessionRunCoordinator.activeRunIdentityRevision,
        }),
      )) {
        this.emitSessionRunOperationError(post, {
          operationId,
          operationKind,
          ...(startedSessionRunId ? { sessionRunId: startedSessionRunId } : {}),
          ...(startedBranchBindingId ? { branchBindingId: startedBranchBindingId } : {}),
          message: chatErrorMessage(error),
        })
      }
      await this.postConnectionStateIfAuthRequired(error, post)
    }
  }

  private ensureSessionRunEventStream(
    sessionRunId: string,
    sessionId: string,
    post: PostMessage,
    branchBindingId: string
  ): void {
    const streamKey = sessionRunEventStreamKey(sessionRunId, branchBindingId)
    if (!sessionRunId || this.activeSessionRunEventStreams.has(streamKey)) return
    if (!this.ensureSessionRunStreamScope(sessionRunId, branchBindingId)) return
    void this.consumeSessionRunEventStream(sessionRunId, sessionId, post, branchBindingId).catch(async (error) => {
      if (this.disposed) return
      this.emitChatMessage({
        type: "sessionRun.error",
        sessionRunId,
        branchBindingId,
        branch_binding_id: branchBindingId,
        message: chatErrorMessage(error),
      }, post)
      this.sessionRuntimeStore.reduce({
        type: "sessionRun.error",
        sessionRunId,
        branchBindingId,
        status: "error",
      })
      await this.postConnectionStateIfAuthRequired(error, post)
      if (this.activeSessionRunMatches({ sessionRunId, branchBindingId })) {
        this.sessionRunCoordinator.clearActiveRun()
      }
    })
  }

  private ensureSessionRunEventStreamSoon(
    sessionRunId: string,
    sessionId: string,
    post: PostMessage,
    branchBindingId: string,
    attempts = 8
  ): void {
    if (!sessionRunId || this.disposed) return
    const streamKey = sessionRunEventStreamKey(sessionRunId, branchBindingId)
    if (!this.activeSessionRunEventStreams.has(streamKey)) {
      this.ensureSessionRunEventStream(sessionRunId, sessionId, post, branchBindingId)
      return
    }
    if (attempts <= 0) return
    setTimeout(() => {
      if (!this.sessionRunEventStreamMatches(sessionRunId, branchBindingId)) return
      this.ensureSessionRunEventStreamSoon(sessionRunId, sessionId, post, branchBindingId, attempts - 1)
    }, 100)
  }

  private ensureSessionRunStreamScope(sessionRunId: string, branchBindingId: string): boolean {
    return this.sessionRuntimeStore.streamScopeIsOpen({ sessionRunId, branchBindingId })
  }

  private async consumeSessionRunEventStream(
    sessionRunId: string,
    initialSessionId: string,
    post: PostMessage,
    branchBindingId: string
  ): Promise<void> {
    const streamKey = sessionRunEventStreamKey(sessionRunId, branchBindingId)
    if (!sessionRunId || this.activeSessionRunEventStreams.has(streamKey)) return
    this.activeSessionRunEventStreams.add(streamKey)
    try {
      let sessionId = initialSessionId
      let cursor = this.sessionRuntimeStore.streamCursorForScope({ sessionRunId, branchBindingId })
      while (!this.disposed && this.sessionRunEventStreamMatches(sessionRunId, branchBindingId)) {
        const abortController = new AbortController()
        let completed = false
        const abortInactiveStream = setInterval(() => {
          if (this.disposed || !this.sessionRunEventStreamMatches(sessionRunId, branchBindingId)) {
            abortController.abort()
          }
        }, 250)
        try {
          await this.client.streamSessionRunEvents(
            sessionRunId,
            cursor,
            branchBindingId,
            async (stream) => {
              if (!this.sessionRunEventStreamMatches(sessionRunId, branchBindingId)) {
                abortController.abort()
                return
              }
              this.markSessionRunEventsConnected(sessionRunId, branchBindingId, post)
              const result = await this.applySessionRunEventsBatch(
                sessionRunId,
                sessionId,
                branchBindingId,
                cursor,
                stream,
                post
              )
              sessionId = result.sessionId
              cursor = result.cursor
              completed = result.done
              if (!result.active || !this.sessionRunEventStreamMatches(sessionRunId, branchBindingId)) {
                abortController.abort()
              }
            },
            { timeoutSec: 2, signal: abortController.signal }
          )
          break
        } catch (error) {
          if (completed || (abortController.signal.aborted && !this.sessionRunEventStreamMatches(sessionRunId, branchBindingId))) {
            break
          }
          if (await this.retrySessionRunEventsAfterError(sessionRunId, branchBindingId, error, post)) {
            continue
          }
          throw error
        } finally {
          clearInterval(abortInactiveStream)
        }
      }
    } finally {
      this.activeSessionRunEventStreams.delete(streamKey)
      this.sessionRunEventReconnects.delete(streamKey)
    }
  }

  private sessionRunEventStreamMatches(sessionRunId: string, branchBindingId: string): boolean {
    return this.sessionRuntimeStore.streamScopeIsOpen({ sessionRunId, branchBindingId })
  }

  private markSessionRunEventsConnected(sessionRunId: string, branchBindingId: string, post: PostMessage): void {
    this.sessionRunEventReconnects.delete(sessionRunEventStreamKey(sessionRunId, branchBindingId))
    const activeRun = this.sessionRunCoordinator.activeRun
    const selectedBranch = this.activeSessionRunMatches({ sessionRunId, branchBindingId })
    const reconnecting = selectedBranch && activeRun?.status === "reconnecting"
    if (selectedBranch) {
      this.sessionRunCoordinator.patchActiveRun({
        status: "running",
        reconnectAttempts: 0,
        reconnectStartedAt: undefined,
        lastError: undefined,
        nextRetryAt: undefined,
        lastStreamAt: new Date().toISOString(),
      })
    }
    if (reconnecting && this.sessionRunCoordinator.activeRun) {
      this.emitChatMessage(
        {
          type: "sessionRun.reconnected",
          sessionRunId,
          branchBindingId,
          branch_binding_id: branchBindingId,
          payload: this.sessionRunCoordinator.activeRunPayload(),
        },
        post
      )
    }
  }

  private async retrySessionRunEventsAfterError(
    sessionRunId: string,
    branchBindingId: string,
    error: unknown,
    post: PostMessage
  ): Promise<boolean> {
    if (
      !this.sessionRunEventStreamMatches(sessionRunId, branchBindingId) ||
      classifyRemoteError(error) !== "transient_network"
    ) {
      return false
    }
    const streamKey = sessionRunEventStreamKey(sessionRunId, branchBindingId)
    const current = this.sessionRunEventReconnects.get(streamKey) || {
      attempts: 0,
      startedAt: Date.now(),
    }
    if (!canRetrySessionRunEventsState(current)) {
      this.sessionRunEventReconnects.delete(streamKey)
      return false
    }
    const delayMs = retryDelayForSessionRunState(current)
    const nextReconnectState: SessionRunEventReconnectState = {
      attempts: current.attempts + 1,
      startedAt: current.startedAt,
      lastError: errorMessage(error),
      nextRetryAt: Date.now() + delayMs,
    }
    this.sessionRunEventReconnects.set(streamKey, nextReconnectState)
    if (this.activeSessionRunMatches({ sessionRunId, branchBindingId })) {
      const next = this.sessionRunCoordinator.patchActiveRun({
        status: "reconnecting",
        reconnectAttempts: nextReconnectState.attempts,
        reconnectStartedAt: nextReconnectState.startedAt,
        lastError: nextReconnectState.lastError,
        nextRetryAt: nextReconnectState.nextRetryAt,
      })
      this.emitChatMessage(
        {
          type: "sessionRun.reconnecting",
          sessionRunId,
          branchBindingId,
          branch_binding_id: branchBindingId,
          message: errorMessage(error),
          payload: next ? this.sessionRunCoordinator.activeRunPayload() : undefined,
        },
        post
      )
    }
    await delay(delayMs)
    return true
  }

  private async applySessionRunEventsBatch(
    sessionRunId: string,
    sessionId: string,
    streamBranchBindingId: string,
    cursor: number,
    stream: Record<string, unknown>,
    post: PostMessage,
    options: { emitScopedEvents?: boolean; applyVisibleSideEffects?: boolean } = {},
  ): Promise<{ sessionId: string; cursor: number; done: boolean; active: boolean }> {
    const events = Array.isArray(stream.events) ? stream.events : []
    const nextCursor = Number(stream.next_cursor ?? cursor)
    const activeRun = this.sessionRunCoordinator.activeRun
    const selectedBranch = this.activeSessionRunMatches({ sessionRunId, branchBindingId: streamBranchBindingId })
    const visibleBranch = selectedBranch && options.applyVisibleSideEffects !== false
    const emitScopedEvents = visibleBranch || options.emitScopedEvents === true
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
              type: "sessionRun.projection.error",
              sessionRunId,
              branchBindingId: streamBranchBindingId,
              branch_binding_id: streamBranchBindingId,
              message: `会话绑定异常：当前会话 ${sessionId}，远端返回 ${remoteSessionId}。`,
              stopWorking: true,
            }, post)
            if (visibleBranch) {
              this.sessionRunCoordinator.clearActiveRun()
            }
            return { sessionId, cursor, done: false, active: false }
          }
          if (visibleBranch) {
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
      }
      for (const event of events) {
        const payload = objectValue((event as Record<string, unknown>).payload)
        const agentRunId = stringValue(payload.agent_run_id)
        const activationId = stringValue(payload.activation_id)
        const payloadBranchBindingId = stringValue(payload.branch_binding_id)
        const payloadTargetsStreamBranch = !payloadBranchBindingId || payloadBranchBindingId === streamBranchBindingId
        if (
          payloadTargetsStreamBranch &&
          (agentRunId || activationId) &&
          this.sessionRuntimeStore.hasScope({ sessionRunId, branchBindingId: streamBranchBindingId })
        ) {
          this.sessionRuntimeStore.ensureBranchRuntimeScope({
            sessionRunId,
            branchBindingId: streamBranchBindingId,
            ...(agentRunId ? { agentRunId } : {}),
            ...(activationId ? { activeActivationId: activationId } : {}),
            status: "running",
          })
        }
        if (visibleBranch && payloadTargetsStreamBranch && (agentRunId || activationId)) {
          this.sessionRunCoordinator.patchActiveRun({
            ...(agentRunId ? { agentRunId } : {}),
            ...(activationId ? { activationId } : {}),
          })
        }
        if (visibleBranch && event && event.type === "approval_request") {
          await this.approvalDocuments.store({
            ...payload,
            session_run_id: sessionRunId,
          })
        } else if (visibleBranch &&
          event &&
          (event.type === "approval_resolved" || event.type === "file_change_approval_resolved")
        ) {
          const approvalId = stringValue(objectValue(event.payload).approval_id)
          if (approvalId) {
            await this.approvalDocuments.close(approvalId)
          }
        }
      }
      if (visibleBranch) {
        await this.draftDocuments.applySessionRunEvents(sessionRunId, events)
      }
      if (emitScopedEvents) {
        const chatEvents = chatSessionRunEvents(events)
        for (const batch of splitSessionRunEventBatches(chatEvents)) {
          this.emitChatMessage(
            {
              type: batch.live ? "sessionRun.stream" : "sessionRun.events",
              sessionRunId,
              sessionId,
              branchBindingId: streamBranchBindingId,
              branch_binding_id: streamBranchBindingId,
              events: batch.events,
            },
            post
          )
        }
      }
    }
    cursor = nextCursor
    const branches = arrayOfRecords(stream.branches)
    const streamTerminalStatus = stream.done
      ? sessionRunTerminalStatusFromBranchSummaries(branches, streamBranchBindingId)
      : undefined
    this.upsertBranchRuntimeScopesFromSummaries(sessionRunId, branches)
    this.sessionRuntimeStore.recordStreamCursor({
      sessionRunId,
      branchBindingId: streamBranchBindingId,
      cursor,
      ...(streamTerminalStatus ? { status: streamTerminalStatus } : {}),
    })
    if (visibleBranch) {
      this.sessionRunCoordinator.patchActiveRun({
        cursor,
        lastStreamAt: new Date().toISOString(),
        ...(branches.length ? { branches } : {}),
      })
    }
    if (branches.length) {
      this.emitChatMessage({
        type: "sessionRun.branches",
        sessionRunId,
        branchBindingId: streamBranchBindingId,
        branch_binding_id: streamBranchBindingId,
        branches,
      }, post)
    }
    if (stream.done) {
      await this.sessionCoordinator.refreshSessionListAfterSessionRunDone(post)
      if (streamTerminalStatus) {
        this.emitSessionRunStreamTerminal(post, {
          status: streamTerminalStatus,
          sessionRunId,
          branchBindingId: streamBranchBindingId,
          message: sessionRunTerminalMessageFromBranchSummaries(branches, streamBranchBindingId),
        })
      } else {
        this.emitChatMessage({
          type: "sessionRun.projection.error",
          sessionRunId,
          branchBindingId: streamBranchBindingId,
          branch_binding_id: streamBranchBindingId,
          message: "SessionRun stream completed without scoped branch terminal status.",
        }, post)
      }
      const pendingNextTurn = this.sessionRunCoordinator.pendingNextTurnForBranch(
        sessionRunId,
        streamBranchBindingId
      )
      if (pendingNextTurn) {
        if (visibleBranch) {
          this.sessionRunCoordinator.patchActiveRun({
            status: "idle",
          })
        }
        setTimeout(() => {
          void this.continueSessionRun(pendingNextTurn.text, post, {
            sourceScope: "branch-local",
            sessionRunId: pendingNextTurn.sessionRunId || sessionRunId,
            branchBindingId: streamBranchBindingId,
            clientRequestId: pendingNextTurn.clientRequestId,
            locale: pendingNextTurn.locale,
            mentions: pendingNextTurn.mentions,
          })
        }, 0)
        if (visibleBranch) {
          this.sessionRunCoordinator.clearActiveDraftSessionId()
        }
        return { sessionId, cursor, done: true, active: true }
      }
      if (visibleBranch) {
        this.sessionRunCoordinator.patchActiveRun({
          status: "idle",
        })
        this.sessionRunCoordinator.clearActiveDraftSessionId()
      }
      return { sessionId, cursor, done: true, active: true }
    }
    return {
      sessionId,
      cursor,
      done: false,
      active: this.sessionRunEventStreamMatches(sessionRunId, streamBranchBindingId),
    }
  }

  private async recoverSessionRun(
    sessionRunId: string,
    branchBindingId: string,
    action: "continue" | "retry",
    post: PostMessage,
    options: {
      operationId?: string
    } = {}
  ): Promise<void> {
    const operationKind: SessionRunLifecycleOperationKind = "recover"
    const operationId = options.operationId?.trim()
    if (!operationId) return
    const sourceResolution = resolveSessionRunSourceIdentity({
      activeRun: this.sessionRunCoordinator.activeRun,
      sourceIdentityRevision: this.sessionRunCoordinator.activeRunIdentityRevision,
      sessionRunId,
      branchBindingId,
      scope: "selected-visible",
    })
    if (!sourceResolution.ok) {
      this.reportSessionRunOperationPreflightFailure(post, {
        operationId,
        operationKind,
        sessionRunId,
        ...(sourceResolution.sourceBranchBindingId ? {
          sourceBranchBindingId: sourceResolution.sourceBranchBindingId,
        } : {}),
        targetBranchBindingId: branchBindingId,
        message: "当前会话没有可恢复的 AgentRun mainline。",
      })
      return
    }
    const { source } = sourceResolution.value
    beginSessionRunOperation(this.sessionRuntimeStore, {
      operationId,
      operationKind,
      source,
      targetBranchBindingId: branchBindingId,
    })
    this.emitSessionRunOperationPending(post, {
      operationId,
      operationKind,
      sessionRunId,
      branchBindingId,
      targetBranchBindingId: branchBindingId,
    })
    try {
      await this.client.recoverSessionRun({ sessionRunId, branchBindingId, action })
      const status = await this.client.sessionRunStatus(sessionRunId, undefined, branchBindingId)
      const sessionId = stringValue(status.session_id) || stringValue(status.sessionId) || ""
      const branches = arrayOfRecords(status.branches)
      const statusScope = sessionRunStatusScopeProof(status, branches)
      if (!statusScope) {
        throw new Error("session run status missing scoped proof")
      }
      const responseBranchBindingId = statusScope.branchBindingId
      const responseAgentRunId = statusScope.agentRunId
      if (!this.acceptVisibleSessionRunOperationOrReport(
        post,
        { operationId, operationKind, sessionRunId, branchBindingId },
        () => this.sessionRuntimeStore.acceptsControlSuccess({
          operationId,
          operationKind,
          activeRun: this.sessionRunCoordinator.activeRun,
          sourceIdentityRevision: this.sessionRunCoordinator.activeRunIdentityRevision,
          responseSessionRunId: statusScope.sessionRunId,
          responseBranchBindingId,
          ...(responseAgentRunId ? { responseAgentRunId } : {}),
        }),
      )) return
      const runtimeState = objectValue(status.runtime_state || status.runtimeState)
      const responseActivationId = stringValue(status.activation_id) || stringValue(status.activationId)
      const responseCursor = Number(status.next_cursor ?? status.cursor ?? 0)
      this.sessionRunCoordinator.setActiveRun({
        sessionRunId,
        cursor: responseCursor,
        sessionId,
        branchBindingId: responseBranchBindingId,
        agentRunId: responseAgentRunId,
        activationId: responseActivationId,
        ...(branches.length ? { branches } : {}),
        status: "running",
        startedAt: new Date().toISOString(),
        reconnectAttempts: 0,
        lastStreamAt: new Date().toISOString(),
      })
      this.sessionRuntimeStore.ensureBranchRuntimeScope({
        sessionRunId,
        branchBindingId: responseBranchBindingId,
        ...(responseAgentRunId ? { agentRunId: responseAgentRunId } : {}),
        ...(responseActivationId ? { activeActivationId: responseActivationId } : {}),
        status: "running",
        streamCursor: responseCursor,
        select: true,
      })
      this.emitChatMessage({
        type: "sessionRun.resume",
        operationId,
        operationKind,
        sessionRunId,
        branchBindingId: responseBranchBindingId,
        branch_binding_id: responseBranchBindingId,
        payload: {
          operationId,
          operationKind,
          sessionRunId,
          sessionId,
          branchBindingId: responseBranchBindingId,
          branch_binding_id: responseBranchBindingId,
          status: "running",
          runtimeState,
          runtime_state: runtimeState,
          ...(branches.length ? { branches } : {}),
          approvals: Array.isArray(status.approvals) ? status.approvals : [],
        },
      }, post)
      await this.consumeSessionRunEventStream(
        sessionRunId,
        sessionId,
        post,
        responseBranchBindingId
      )
    } catch (error) {
      if (!this.acceptVisibleSessionRunOperationOrReport(
        post,
        { operationId, operationKind, sessionRunId, branchBindingId },
        () => this.sessionRuntimeStore.acceptsFailure({
          operationId,
          operationKind,
          activeRun: this.sessionRunCoordinator.activeRun,
          sourceIdentityRevision: this.sessionRunCoordinator.activeRunIdentityRevision,
        }),
      )) return
      this.emitSessionRunOperationError(post, {
        operationId,
        operationKind,
        sessionRunId,
        branchBindingId,
        message: chatErrorMessage(error),
      })
      await this.postConnectionStateIfAuthRequired(error, post)
    }
  }

  private async resolveConfiguredDefaultChatModel(): Promise<{
    providerId: string
    modelId: string
    parameters?: Record<string, unknown>
  } | undefined> {
    return defaultChatModelFromChatConfig(await this.client.chatConfigRead())
  }

  private async cancelSessionRun(
    sessionRunId: string,
    branchBindingId: string,
    post: PostMessage,
    options: {
      operationId?: string
    } = {}
  ): Promise<void> {
    const operationKind: SessionRunLifecycleOperationKind = "cancel"
    const operationId = options.operationId?.trim()
    if (!operationId) return
    const targetSessionRunId = sessionRunId
    const targetBranchBindingId = branchBindingId
    if (!targetSessionRunId || !targetBranchBindingId) {
      this.reportSessionRunOperationPreflightFailure(post, {
        operationId,
        operationKind,
        targetBranchBindingId,
        message: "当前没有正在运行的会话。",
      })
      return
    }
    const sourceResolution = resolveSessionRunSourceIdentity({
      activeRun: this.sessionRunCoordinator.activeRun,
      sourceIdentityRevision: this.sessionRunCoordinator.activeRunIdentityRevision,
      sessionRunId: targetSessionRunId,
      branchBindingId: targetBranchBindingId,
      scope: "selected-visible",
    })
    if (!sourceResolution.ok) {
      this.reportSessionRunOperationPreflightFailure(post, {
        operationId,
        operationKind,
        sessionRunId: targetSessionRunId,
        ...(sourceResolution.sourceBranchBindingId ? {
          sourceBranchBindingId: sourceResolution.sourceBranchBindingId,
        } : {}),
        targetBranchBindingId,
        message: "当前会话没有可停止的 AgentRun mainline。",
      })
      return
    }
    const { source } = sourceResolution.value
    beginSessionRunOperation(this.sessionRuntimeStore, {
      operationId,
      operationKind,
      source,
      targetBranchBindingId,
    })
    this.emitSessionRunOperationPending(post, {
      operationId,
      operationKind,
      sessionRunId: targetSessionRunId,
      branchBindingId: targetBranchBindingId,
      targetBranchBindingId,
    })
    try {
      await this.client.cancelSessionRun(targetSessionRunId, "user_cancelled", targetBranchBindingId)
      if (!this.acceptVisibleSessionRunOperationOrReport(
        post,
        {
          operationId,
          operationKind,
          sessionRunId: targetSessionRunId,
          branchBindingId: targetBranchBindingId,
        },
        () => this.sessionRuntimeStore.acceptsControlSuccess({
          operationId,
          operationKind,
          activeRun: this.sessionRunCoordinator.activeRun,
          sourceIdentityRevision: this.sessionRunCoordinator.activeRunIdentityRevision,
          responseSessionRunId: targetSessionRunId,
          responseBranchBindingId: targetBranchBindingId,
          responseAgentRunId: source.agentRunId,
        }),
      )) return
      if (
        this.activeSessionRunMatches({
          sessionRunId: targetSessionRunId,
          branchBindingId: targetBranchBindingId,
        })
      ) {
        this.sessionRunCoordinator.setActiveRun(undefined)
      }
      this.sessionRunCoordinator.clearActiveDraftSessionId()
      this.emitChatMessage({
        type: "sessionRun.cancelled",
        operationId,
        operationKind,
        sessionRunId: targetSessionRunId,
        branchBindingId: targetBranchBindingId,
        branch_binding_id: targetBranchBindingId,
        reason: "user_cancelled",
      }, post)
    } catch (error) {
      if (!this.acceptVisibleSessionRunOperationOrReport(
        post,
        {
          operationId,
          operationKind,
          sessionRunId: targetSessionRunId,
          branchBindingId: targetBranchBindingId,
        },
        () => this.sessionRuntimeStore.acceptsFailure({
          operationId,
          operationKind,
          activeRun: this.sessionRunCoordinator.activeRun,
          sourceIdentityRevision: this.sessionRunCoordinator.activeRunIdentityRevision,
        }),
      )) return
      this.emitSessionRunOperationError(post, {
        operationId,
        operationKind,
        sessionRunId: targetSessionRunId,
        branchBindingId: targetBranchBindingId,
        message: `停止失败：${errorMessage(error)}`,
      })
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
    this.capabilityPackageLocalPeerRunner.dispose()
    this.sessionCoordinator.dispose()
    void this.client.stopPeer("controller.dispose")
  }
}

function contextVersion(context: vscode.ExtensionContext): string {
  return String(context.extension.packageJSON?.version || "0.1.0")
}

function capabilityPackageLocalPeerRunnerKey(state: {
  authenticated?: boolean
  deviceId?: string
  hostUrl?: string
  peerConnected?: boolean
  peerId?: string
  status?: string
  username?: string
}): string {
  if (
    state.peerConnected !== true ||
    state.authenticated !== true ||
    state.status !== "ready"
  ) {
    return ""
  }
  return [
    state.hostUrl || "",
    state.username || "",
    state.deviceId || "",
    state.peerId || "",
  ].join("|")
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

export function capabilityPackageIngestPayloadFromChatText(text: string): { source: Record<string, unknown> } | undefined {
  const trimmed = text.trim()
  if (!trimmed || trimmed.startsWith("/")) return undefined
  const lower = trimmed.toLowerCase()
  if (isStandaloneMcpServersConfig(trimmed)) {
    return {
      source: {
        type: "project_notes",
        notes: trimmed,
      },
    }
  }
  const hasStrongInstallIntent = /(安装|配置|接入|启用|install|setup|configure|enable)/i.test(trimmed)
  const hasWeakAddIntent = /(添加|add)/i.test(trimmed)
  if (!hasStrongInstallIntent && !hasWeakAddIntent) return undefined
  const hasMcpConfig = lower.includes("mcpservers") || lower.includes('"mcpservers"')
  if (hasMcpConfig) {
    return {
      source: {
        type: "project_notes",
        notes: trimmed,
      },
    }
  }
  const url = firstCapabilitySourceUrl(trimmed)
  if (!url) return undefined
  const textWithoutUrls = trimmed.replace(/https?:\/\/[^\s"'<>，。！？)）\]]+/gi, " ")
  if (!hasStrongInstallIntent && !/(skill|mcp|能力|能力包|插件|工具|tool|capability|package|server|服务器|仓库|repo|repository)/i.test(textWithoutUrls)) {
    return undefined
  }
  return {
    source: {
      type: isGitHubUrl(url) ? "github_repo" : "docs_url",
      url,
      notes: trimmed,
    },
  }
}

function isStandaloneMcpServersConfig(text: string): boolean {
  const jsonText = text.startsWith("```") ? text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim() : text
  if (!jsonText.startsWith("{")) return false
  try {
    const parsed = JSON.parse(jsonText) as Record<string, unknown>
    const mcpServers = objectValue(parsed.mcpServers)
    return Object.values(mcpServers).some((server) => {
      const item = objectValue(server)
      return Boolean(stringValue(item.command) || stringValue(item.url))
    })
  } catch {
    return false
  }
}

function firstCapabilitySourceUrl(text: string): string | undefined {
  const match = text.match(/https?:\/\/[^\s"'<>，。！？)）\]]+/i)
  if (!match) return undefined
  return match[0].replace(/[.,;:!?]+$/, "")
}

function isGitHubUrl(url: string): boolean {
  try {
    return new URL(url).hostname.toLowerCase() === "github.com"
  } catch {
    return false
  }
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

function branchBindingIdFromRecord(record: Record<string, unknown>): string | undefined {
  return (
    stringValue(record.branch_binding_id)?.trim() ||
    stringValue(record.branchBindingId)?.trim() ||
    stringValue(record.binding_id)?.trim() ||
    stringValue(record.bindingId)?.trim()
  )
}

function agentRunIdFromRecord(record: Record<string, unknown>): string | undefined {
  return (
    stringValue(record.agent_run_id)?.trim() ||
    stringValue(record.agentRunId)?.trim() ||
    stringValue(objectValue(record.agent_run).id)?.trim() ||
    stringValue(objectValue(record.agentRun).id)?.trim()
  )
}

function agentRunIdForBranch(
  branches: Record<string, unknown>[],
  branchBindingId: string,
): string | undefined {
  const branch = branches.find((item) => branchBindingIdFromRecord(item) === branchBindingId)
  return branch ? agentRunIdFromRecord(branch) : undefined
}

function sessionRunStatusScopeProof(
  status: Record<string, unknown>,
  branches: Record<string, unknown>[],
): { sessionRunId: string; branchBindingId: string; agentRunId?: string } | undefined {
  const sessionRunId = stringValue(status.session_run_id) || stringValue(status.sessionRunId)
  const branchBindingId = stringValue(status.branch_binding_id) || stringValue(status.branchBindingId)
  if (!sessionRunId || !branchBindingId) return undefined
  const agentRunId =
    stringValue(status.agent_run_id) ||
    stringValue(status.agentRunId) ||
    agentRunIdForBranch(branches, branchBindingId)
  return {
    sessionRunId,
    branchBindingId,
    ...(agentRunId ? { agentRunId } : {}),
  }
}

function branchRuntimeStatusFromRecord(record: Record<string, unknown>): SessionRuntimeStatus | undefined {
  const status =
    stringValue(record.runtime_status)?.trim() ||
    stringValue(record.runtimeStatus)?.trim() ||
    stringValue(record.status)?.trim()
  if (status === "failed" || status === "blocked") return "error"
  if (status === "completed" || status === "complete") return "done"
  if (isSessionRuntimeStatus(status)) return status
  if (record.running === false) return "idle"
  if (record.running === true) return "running"
  return undefined
}

function sessionRunTerminalStatusFromBranchSummaries(
  branches: Record<string, unknown>[],
  branchBindingId: string,
): SessionRunStreamTerminalStatus | undefined {
  const branch = branches.find((item) => branchBindingIdFromRecord(item) === branchBindingId)
  const status = branch ? branchRuntimeStatusFromRecord(branch) : undefined
  if (
    status === "done" ||
    status === "cancelled" ||
    status === "error" ||
    status === "interrupted"
  ) {
    return status
  }
  return undefined
}

function sessionRunTerminalMessageFromBranchSummaries(
  branches: Record<string, unknown>[],
  branchBindingId: string,
): string | undefined {
  const branch = branches.find((item) => branchBindingIdFromRecord(item) === branchBindingId)
  if (!branch) return undefined
  const metadata = objectValue(branch.metadata)
  return (
    stringValue(branch.last_error) ||
    stringValue(branch.error) ||
    stringValue(metadata.last_error) ||
    stringValue(metadata.error) ||
    stringValue(metadata.status_reason)
  )
}

function activeSessionRunRuntimeStatus(status: "idle" | "running" | "reconnecting" | undefined): SessionRuntimeStatus {
  return status === "idle" ? "idle" : "running"
}

function isSessionRuntimeStatus(value: string | undefined): value is SessionRuntimeStatus {
  return (
    value === "idle" ||
    value === "queued" ||
    value === "running" ||
    value === "waiting" ||
    value === "stopping" ||
    value === "cancelled" ||
    value === "done" ||
    value === "error" ||
    value === "interrupted"
  )
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

function retryDelayForSessionRunState(state: SessionRunEventReconnectState): number {
  return SESSION_RUN_EVENTS_RETRY_DELAYS_MS[
    Math.min(state.attempts, SESSION_RUN_EVENTS_RETRY_DELAYS_MS.length - 1)
  ]
}

function canRetrySessionRunEventsState(state: SessionRunEventReconnectState): boolean {
  return Date.now() - state.startedAt <= SESSION_RUN_EVENTS_RECOVERY_DEADLINE_MS
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

function remoteErrorCode(error: unknown): string {
  if (isRemoteError(error)) {
    return String(error.code || "")
  }
  const body = error && typeof error === "object" ? (error as Record<string, unknown>).body : undefined
  if (body && typeof body === "object" && !Array.isArray(body)) {
    return stringValue((body as Record<string, unknown>).error) || stringValue((body as Record<string, unknown>).code) || ""
  }
  return ""
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
  "document_draft_preview_chunk",
  "draft_body_stalled",
  "draft_interrupted_recoverable",
  "reasoning_delta",
  "tool_call_delta",
  "tool_arguments_complete",
  "tool_arguments_valid",
  "tool_arguments_invalid",
  "mutation_previewing",
  "mutation_preview_ready",
  "mutation_preview_failed",
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

function sessionRunEventStreamKey(sessionRunId: string, branchBindingId: string): string {
  return `${sessionRunId}:${branchBindingId}`
}

function explicitSessionRunBranchProof(
  value: { sessionRunId?: string; branchBindingId?: string },
): { sessionRunId: string; branchBindingId: string } | undefined {
  const sessionRunId = value.sessionRunId?.trim()
  const branchBindingId = value.branchBindingId?.trim()
  if (!sessionRunId || !branchBindingId) return undefined
  return { sessionRunId, branchBindingId }
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
