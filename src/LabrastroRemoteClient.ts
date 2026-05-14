import * as vscode from "vscode"
import * as fs from "fs/promises"
import { constants as fsConstants } from "fs"
import * as path from "path"
import { spawn, type ChildProcessWithoutNullStreams } from "child_process"
import { buildStartupConnectionState } from "./startup-state"
import {
  DEFAULT_HOST_URL,
  type HostUrlInspection,
  type HostUrlSource,
  type HostUrlState,
  normalizeHostUrl,
  resolveHostUrlState,
  selectLabrastroHostWriteSource,
} from "./host-config"
import {
  RemoteError,
  RemoteTransportError,
  classifyRemoteError,
  errorCode,
  isRemoteError,
  retryInvalidPeerTokenOnce,
} from "./remote-errors"
export {
  RemoteError,
  RemoteTransportError,
  classifyRemoteError,
  isInvalidPeerTokenError,
  isRemoteError,
  retryInvalidPeerTokenOnce,
  type RemoteErrorCategory,
} from "./remote-errors"

export type JsonObject = Record<string, unknown>

export const CHAT_STREAM_TIMEOUT_SEC = 10
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000
const LEGACY_AUTH_SESSION_KEY = "labrastro.authSession"

export interface BackendFeatures {
  ok: boolean
  apiVersion: number
  serverVersion: string
  sessions: boolean
  sessionAutoSave: boolean
  sessionHistoryWritable: boolean
  chatStream: boolean
  taskflow: boolean
  issueAssignment: boolean
  freshSessionWithoutSessionHint: boolean
  peerTokenHeartbeatRefresh: boolean
  agentRuns: AgentRunFeatures
}

export interface AgentRunFeatures {
  executorFeatures: Record<string, ExecutorFeature>
}

export interface ExecutorFeature {
  installed: boolean
  version: string
  streamJson: boolean
  sessionDiscovery: boolean
  resumeById: boolean
  usage: boolean
  mcpConfig: boolean
  runtimeHomeIsolation: string
  modelArg: boolean
  testedVersion?: string
  limitations: string[]
}

export interface ConnectionState {
  hostUrl: string
  hostUrlConfigured: boolean
  hostUrlSource: "default" | "global" | "workspace" | "workspace-folder" | "unknown"
  authReachable: boolean
  authenticated: boolean
  username?: string
  role?: "superadmin" | "admin" | "user"
  scopes?: string[]
  deviceId?: string
  securityWarnings?: string[]
  peerConnected: boolean
  peerId?: string
  status: "checking" | "login-required" | "ready" | "error"
  message?: string
  hostUrlSaveRequested?: string
  hostUrlSaveApplied?: boolean
}

interface StoredAuthSession {
  hostUrl: string
  username: string
  role: "superadmin" | "admin" | "user"
  scopes: string[]
  deviceId: string
  refreshToken: string
}

interface PeerInfo {
  peer_id: string
  peer_token: string
}

interface PeerStartupOutput {
  stdout: string[]
  stderr: string[]
}

export class LabrastroRemoteClient {
  private peerProcess: ChildProcessWithoutNullStreams | undefined
  private peerInfo: PeerInfo | undefined
  private peerStartupPromise: Promise<PeerInfo> | undefined
  private peerStartupGeneration = 0
  private accessToken: string | undefined
  private accessTokenExpiresAt = 0
  private refreshAccessTokenPromise: Promise<string> | undefined

  constructor(private readonly context: vscode.ExtensionContext) {}

  get hostUrl(): string {
    return this.hostUrlState().url
  }

  startupConnectionState(): ConnectionState {
    const host = this.hostUrlState()
    return buildStartupConnectionState({
      hostUrl: host.url,
      hostUrlConfigured: host.configured,
      hostUrlSource: host.source,
      peerConnected: this.isPeerRunning(),
      peerId: this.peerInfo?.peer_id,
    })
  }

  async connectionState(): Promise<ConnectionState> {
    const host = this.hostUrlState()
    if (!host.url) {
      return this.connectionStatePayload(host, {
        authReachable: false,
        authenticated: false,
        status: "login-required",
        message: "Host URL 需要先配置。",
      })
    }
    try {
      await this.authState()
    } catch (error) {
      return this.connectionStatePayload(host, {
        authReachable: false,
        authenticated: false,
        status: "error",
        message: `Auth API unreachable at ${host.url}: ${errorMessage(error)}`,
      })
    }
    const session = await this.storedAuthSession()
    if (!session || session.hostUrl !== host.url) {
      return this.connectionStatePayload(host, {
        authReachable: true,
        authenticated: false,
        status: "login-required",
        message: "请登录 Labrastro Host。",
      })
    }
    try {
      const me = await this.me()
      const user = objectValue(me.user)
      return this.connectionStatePayload(host, {
        authReachable: true,
        authenticated: true,
        username: stringValue(user.username) || session.username,
        role: roleValue(user.role) || session.role,
        scopes: stringArray(user.scopes).length ? stringArray(user.scopes) : session.scopes,
        deviceId: stringValue(objectValue(me.device).id) || session.deviceId,
        status: "ready",
        message: "Labrastro Host 已登录。",
      })
    } catch (error) {
      if (isRemoteError(error, "unauthorized", 401) || isRemoteError(error, "invalid_refresh_token", 401)) {
        await this.clearAuthSession()
        return this.connectionStatePayload(host, {
          authReachable: true,
          authenticated: false,
          status: "login-required",
          message: "登录已失效，请重新登录。",
        })
      }
      return this.connectionStatePayload(host, {
        authReachable: true,
        authenticated: false,
        status: "error",
        message: `Auth session check failed: ${errorMessage(error)}`,
      })
    }
  }

  async saveHostUrl(hostUrl: string): Promise<ConnectionState> {
    const requestedHostUrl = normalizeHostUrl(hostUrl)
    try {
      await this.updateLabrastroHostUrl(
        requestedHostUrl,
        selectLabrastroHostWriteSource(this.labrastroHostInspection())
      )
    } catch (error) {
      const host = this.hostUrlState()
      return this.connectionStatePayload(host, {
        authReachable: false,
        authenticated: false,
        status: "error",
        message: `Host URL 保存失败：${errorMessage(error)}`,
        hostUrlSaveRequested: requestedHostUrl,
        hostUrlSaveApplied: false,
      })
    }
    const state = await this.connectionState()
    if (state.hostUrl !== requestedHostUrl) {
      return {
        ...state,
        status: "error",
        hostUrlSaveRequested: requestedHostUrl,
        hostUrlSaveApplied: false,
        message: `Host URL 已请求保存为 ${requestedHostUrl}，但当前 VS Code 生效值仍是 ${state.hostUrl}（来源：${state.hostUrlSource}）。请检查 Workspace/Folder 设置是否覆盖了全局设置。`,
      }
    }
    return {
      ...state,
      hostUrlSaveRequested: requestedHostUrl,
      hostUrlSaveApplied: true,
    }
  }

  async login(options: {
    hostUrl?: string
    username: string
    password: string
  }): Promise<ConnectionState> {
    let requestedHostUrl: string | undefined
    if (options.hostUrl !== undefined && options.hostUrl.trim()) {
      requestedHostUrl = normalizeHostUrl(options.hostUrl)
      try {
        await this.updateLabrastroHostUrl(
          requestedHostUrl,
          selectLabrastroHostWriteSource(this.labrastroHostInspection())
        )
      } catch (error) {
        const host = this.hostUrlState()
        return this.connectionStatePayload(host, {
          authReachable: false,
          authenticated: false,
          status: "error",
          message: `Host URL 保存失败：${errorMessage(error)}`,
          hostUrlSaveRequested: requestedHostUrl,
          hostUrlSaveApplied: false,
        })
      }
    }
    const response = await this.postJson("/remote/auth/login", {
      username: options.username,
      password: options.password,
      device_label: "VS Code",
    })
    await this.storeAuthSession(response)
    const state = await this.connectionState()
    if (requestedHostUrl && state.hostUrl !== requestedHostUrl) {
      return {
        ...state,
        status: "error",
        hostUrlSaveRequested: requestedHostUrl,
        hostUrlSaveApplied: false,
        message: `Host URL 已请求保存为 ${requestedHostUrl}，但当前 VS Code 生效值仍是 ${state.hostUrl}（来源：${state.hostUrlSource}）。请检查 Workspace/Folder 设置是否覆盖了全局设置。`,
      }
    }
    return requestedHostUrl
      ? {
          ...state,
          hostUrlSaveRequested: requestedHostUrl,
          hostUrlSaveApplied: true,
        }
      : state
  }

  async logout(): Promise<ConnectionState> {
    const session = await this.storedAuthSession()
    if (session?.refreshToken) {
      try {
        await this.postJson("/remote/auth/logout", { refresh_token: session.refreshToken })
      } catch {
        // Local cleanup is still the important part when the server is unreachable.
      }
    }
    await this.clearAuthSession()
    await this.stopPeer()
    return this.connectionState()
  }

  async authState(): Promise<JsonObject> {
    return this.getJson("/remote/auth/state")
  }

  async me(): Promise<JsonObject> {
    return this.authenticatedGet("/remote/auth/me")
  }

  async authPasswordChange(currentPassword: string, newPassword: string): Promise<JsonObject> {
    return this.authenticatedPost("/remote/auth/password/change", {
      current_password: currentPassword,
      new_password: newPassword,
    })
  }

  async authUsersList(): Promise<JsonObject> {
    return this.authenticatedPost("/remote/auth/users/list", {})
  }

  async authUsersCreate(payload: JsonObject): Promise<JsonObject> {
    return this.authenticatedPost("/remote/auth/users/create", payload)
  }

  async authUsersUpdate(payload: JsonObject): Promise<JsonObject> {
    return this.authenticatedPost("/remote/auth/users/update", payload)
  }

  async authUsersDisable(userId: string): Promise<JsonObject> {
    return this.authenticatedPost("/remote/auth/users/disable", { user_id: userId })
  }

  async authUsersResetPassword(userId: string, password: string): Promise<JsonObject> {
    return this.authenticatedPost("/remote/auth/users/reset-password", {
      user_id: userId,
      password,
    })
  }

  async authDevicesList(userId?: string): Promise<JsonObject> {
    return this.authenticatedPost("/remote/auth/devices/list", userId ? { user_id: userId } : {})
  }

  async authDevicesRevoke(deviceId: string): Promise<JsonObject> {
    return this.authenticatedPost("/remote/auth/devices/revoke", { device_id: deviceId })
  }

  async authAuditList(payload: JsonObject): Promise<JsonObject> {
    return this.authenticatedPost("/remote/auth/audit/list", payload)
  }

  async adminStatus(): Promise<JsonObject> {
    return this.authenticatedPost("/remote/admin/status", {})
  }

  async serverSettingsRead(): Promise<JsonObject> {
    return this.authenticatedPost("/remote/admin/server-settings/read", {})
  }

  async serverSettingsUpdate(payload: JsonObject): Promise<JsonObject> {
    return this.authenticatedPost("/remote/admin/server-settings/update", payload)
  }

  async agentRunSubmit(payload: JsonObject): Promise<JsonObject> {
    return this.authenticatedPost("/remote/admin/agent-runs/submit", payload)
  }

  async environmentRun(payload: JsonObject): Promise<JsonObject> {
    return this.authenticatedPost("/remote/admin/environment/run", payload)
  }

  async agentRunEvents(payload: JsonObject): Promise<JsonObject> {
    return this.authenticatedPost("/remote/admin/agent-runs/events", payload)
  }

  async agentRunCancel(payload: JsonObject): Promise<JsonObject> {
    return this.authenticatedPost("/remote/admin/agent-runs/cancel", payload)
  }

  async agentRunRetry(payload: JsonObject): Promise<JsonObject> {
    return this.authenticatedPost("/remote/admin/agent-runs/retry", payload)
  }

  async features(): Promise<BackendFeatures> {
    const payload = await this.getJson("/remote/features")
    return normalizeBackendFeatures(payload)
  }

  async providerRecord(payload: JsonObject): Promise<JsonObject> {
    return this.authenticatedPost("/remote/admin/providers/record", payload)
  }

  async providerTest(payload: JsonObject): Promise<JsonObject> {
    return this.authenticatedPost("/remote/admin/providers/test", payload)
  }

  async providerDelete(payload: JsonObject): Promise<JsonObject> {
    return this.authenticatedPost("/remote/admin/providers/delete", payload)
  }

  async providerCopy(payload: JsonObject): Promise<JsonObject> {
    return this.authenticatedPost("/remote/admin/providers/copy", payload)
  }

  async providerEnable(payload: JsonObject): Promise<JsonObject> {
    return this.authenticatedPost("/remote/admin/providers/enable", payload)
  }

  async providerModels(payload: JsonObject): Promise<JsonObject> {
    return this.authenticatedPost("/remote/admin/providers/models", payload)
  }

  async modelProfileRecord(payload: JsonObject): Promise<JsonObject> {
    return this.authenticatedPost("/remote/admin/models/record", payload)
  }

  async modelProfileActivate(payload: JsonObject): Promise<JsonObject> {
    return this.authenticatedPost("/remote/admin/models/activate", payload)
  }

  async toolchainList(): Promise<JsonObject> {
    return this.authenticatedPost("/remote/admin/toolchains/list", {})
  }

  async toolchainDashboard(): Promise<JsonObject> {
    return this.authenticatedPost("/remote/admin/toolchains/dashboard", {})
  }

  async toolchainRecord(kind: string, payload: JsonObject): Promise<JsonObject> {
    return this.authenticatedPost("/remote/admin/toolchains/record", { kind, payload })
  }

  async toolchainDelete(kind: string, name: string): Promise<JsonObject> {
    return this.authenticatedPost("/remote/admin/toolchains/delete", { kind, name })
  }

  async toolchainEnable(kind: string, name: string, enabled: boolean): Promise<JsonObject> {
    return this.authenticatedPost("/remote/admin/toolchains/enable", { kind, name, enabled })
  }

  async environmentManifest(): Promise<JsonObject> {
    const platform = peerPlatform()
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd()
    return this.postPeerJson("/remote/environment/manifest", (peer) => ({
      peer_token: peer.peer_token,
      os: platform.os,
      arch: platform.arch,
      workspace: workspaceRoot,
    }))
  }

  async listSessions(limit = 20, ifListEtag?: string): Promise<JsonObject> {
    return this.postPeerJson("/remote/sessions/list", (peer) => ({
      peer_token: peer.peer_token,
      limit,
      ...(ifListEtag ? { if_list_etag: ifListEtag } : {}),
    }))
  }

  async loadSession(sessionId: string): Promise<JsonObject> {
    return this.postPeerJson("/remote/sessions/load", (peer) => ({
      peer_token: peer.peer_token,
      session_id: sessionId,
    }))
  }

  async newSession(): Promise<JsonObject> {
    return this.postPeerJson("/remote/sessions/new", (peer) => ({
      peer_token: peer.peer_token,
    }))
  }

  async deleteSession(sessionId: string): Promise<JsonObject> {
    return this.postPeerJson("/remote/sessions/delete", (peer) => ({
      peer_token: peer.peer_token,
      session_id: sessionId,
    }))
  }

  async forkSession(
    sourceSessionId: string,
    keepThroughMessageIndex: number,
    snapshot: JsonObject = {}
  ): Promise<JsonObject> {
    return this.postPeerJson("/remote/sessions/fork", (peer) => ({
      peer_token: peer.peer_token,
      source_session_id: sourceSessionId,
      keep_through_message_index: keepThroughMessageIndex,
      ...(Object.keys(snapshot).length ? { snapshot } : {}),
    }))
  }

  async saveSessionSnapshot(
    sessionId: string,
    snapshot: JsonObject,
    snapshotDigest?: string
  ): Promise<JsonObject> {
    return this.postPeerJson("/remote/sessions/snapshot", (peer) => ({
      peer_token: peer.peer_token,
      session_id: sessionId,
      snapshot,
      ...(snapshotDigest ? { snapshot_digest: snapshotDigest } : {}),
    }))
  }

  async switchSessionMainModel(
    sessionId: string | undefined,
    providerId: string,
    modelId: string,
    parameters: JsonObject = {}
  ): Promise<JsonObject> {
    return this.postPeerJson("/remote/sessions/model", (peer) => ({
      peer_token: peer.peer_token,
      ...(sessionId ? { session_id: sessionId } : {}),
      provider_id: providerId,
      model_id: modelId,
      ...(Object.keys(parameters).length ? { parameters } : {}),
    }))
  }

  async startChat(
    prompt: string,
    sessionId?: string,
    options: {
      mode?: string
      workflowMode?: string
      taskflowId?: string
      providerId?: string
      modelId?: string
      parameters?: JsonObject
    } = {}
  ): Promise<JsonObject> {
    const taskflowId = options.taskflowId?.trim()
    const providerId = options.providerId?.trim()
    const modelId = options.modelId?.trim()
    const parameters = options.parameters && Object.keys(options.parameters).length
      ? options.parameters
      : undefined
    return this.postPeerJson("/remote/chat/start", (peer) => ({
      peer_token: peer.peer_token,
      prompt,
      session_hint: sessionId,
      ...(options.mode?.trim() ? { mode: options.mode.trim() } : {}),
      ...(options.workflowMode?.trim() ? { workflow_mode: options.workflowMode.trim() } : {}),
      ...(taskflowId ? { taskflow_id: taskflowId } : {}),
      ...(providerId && modelId ? { provider_id: providerId, model_id: modelId } : {}),
      ...(providerId && modelId && parameters ? { parameters } : {}),
    }))
  }

  async startTaskflow(options: {
    projectId?: string
    rawGoal?: string
    goal?: string
    sessionId?: string
    taskflowId?: string
    goalId?: string
    metadata?: JsonObject
  }): Promise<JsonObject> {
    return this.postPeerJson("/remote/taskflow/taskflows", (peer) => ({
      peer_token: peer.peer_token,
      project_id: options.projectId || "",
      raw_goal: options.rawGoal || options.goal || "",
      ...(options.sessionId ? { session_id: options.sessionId } : {}),
      ...(options.taskflowId ? { taskflow_id: options.taskflowId } : {}),
      ...(options.goalId ? { goal_id: options.goalId } : {}),
      ...(options.metadata ? { metadata: options.metadata } : {}),
    }))
  }

  async getTaskflowState(taskflowId: string): Promise<JsonObject> {
    return this.getPeerJson(`/remote/taskflow/taskflows/${encodeURIComponent(taskflowId)}`)
  }

  async getTaskflowWorkspace(taskflowId: string): Promise<JsonObject> {
    return this.getPeerJson(`/remote/taskflow/taskflows/${encodeURIComponent(taskflowId)}/workspace`)
  }

  async getTaskflowComplexity(taskflowId: string): Promise<JsonObject> {
    return this.getPeerJson(`/remote/taskflow/taskflows/${encodeURIComponent(taskflowId)}/complexity`)
  }

  async getTaskflowReviewCardsV1(taskflowId: string): Promise<JsonObject> {
    return this.getPeerJson(`/remote/taskflow/taskflows/${encodeURIComponent(taskflowId)}/review-cards-v1`)
  }

  async getTaskflowProjectMemory(taskflowId: string): Promise<JsonObject> {
    return this.getPeerJson(`/remote/taskflow/taskflows/${encodeURIComponent(taskflowId)}/project-memory`)
  }

  async getTaskflowProjectorPreview(taskflowId: string, target = "openspec"): Promise<JsonObject> {
    return this.getPeerJson(`/remote/taskflow/taskflows/${encodeURIComponent(taskflowId)}/projector-preview?target=${encodeURIComponent(target)}`)
  }

  async getTaskflowRuntime(taskflowId: string): Promise<JsonObject> {
    return this.getPeerJson(`/remote/taskflow/taskflows/${encodeURIComponent(taskflowId)}/runtime`)
  }

  async recordTaskflowDiscoveryTurn(taskflowId: string, payload: JsonObject): Promise<JsonObject> {
    return this.taskflowPost(taskflowId, "discovery-turn", payload)
  }

  async answerTaskflowReviewCardV1(
    taskflowId: string,
    cardId: string,
    payload: { action?: string; value?: unknown; actor?: string; comment?: string; reason?: string } & JsonObject
  ): Promise<JsonObject> {
    return this.taskflowPost(
      taskflowId,
      `review-cards-v1/${encodeURIComponent(cardId)}/actions`,
      payload
    )
  }

  async previewTaskflowProjectMemoryPatch(
    taskflowId: string,
    payload: {
      actor?: string
      reason?: string
      source?: string
      operations?: unknown[]
    } & JsonObject
  ): Promise<JsonObject> {
    return this.taskflowPost(taskflowId, "project-memory/patches/preview", payload)
  }

  async applyTaskflowProjectMemoryPatch(
    taskflowId: string,
    proposalId: string,
    payload: {
      actor?: string
      reason?: string
      source?: string
      operations?: unknown[]
    } & JsonObject
  ): Promise<JsonObject> {
    return this.taskflowPost(
      taskflowId,
      `project-memory/patches/${encodeURIComponent(proposalId)}/apply`,
      payload
    )
  }

  async reviewTaskflowCompilerDecision(
    taskflowId: string,
    decisionId: string,
    payload: { action?: string; actor?: string; reason?: string; value?: unknown } & JsonObject
  ): Promise<JsonObject> {
    return this.taskflowPost(
      taskflowId,
      `compiler-decisions/${encodeURIComponent(decisionId)}/review`,
      payload
    )
  }

  async compileTaskflowBrief(
    taskflowId: string,
    payload: { actor?: string } & JsonObject = {}
  ): Promise<JsonObject> {
    return this.taskflowPost(taskflowId, "brief/compile", payload)
  }

  async markTaskflowBriefReady(
    taskflowId: string,
    payload: { version?: number; actor?: string } & JsonObject = {}
  ): Promise<JsonObject> {
    return this.taskflowPost(taskflowId, "brief/ready", payload)
  }

  async confirmTaskflowBrief(
    taskflowId: string,
    payload: { version?: number; actor?: string } & JsonObject = {}
  ): Promise<JsonObject> {
    return this.taskflowPost(taskflowId, "brief/confirm", payload)
  }

  async compileTaskflowGoal(taskflowId: string): Promise<JsonObject> {
    return this.taskflowPost(taskflowId, "compile", {})
  }

  async requestTaskflowDispatch(
    taskflowId: string,
    payload: {
      workItemIds?: string[]
      actor?: string
      rationale?: string
      metadata?: JsonObject
    } & JsonObject
  ): Promise<JsonObject> {
    const { workItemIds, ...rest } = payload
    return this.taskflowPost(taskflowId, "dispatch-decisions", {
      ...rest,
      work_item_ids: workItemIds,
    })
  }

  async confirmTaskflowDispatch(
    taskflowId: string,
    decisionId: string,
    payload: { actor?: string } & JsonObject = {}
  ): Promise<JsonObject> {
    return this.taskflowPost(
      taskflowId,
      `dispatch-decisions/${encodeURIComponent(decisionId)}/confirm`,
      payload
    )
  }

  async rejectTaskflowDispatch(
    taskflowId: string,
    decisionId: string,
    payload: { actor?: string } & JsonObject = {}
  ): Promise<JsonObject> {
    return this.taskflowPost(
      taskflowId,
      `dispatch-decisions/${encodeURIComponent(decisionId)}/reject`,
      payload
    )
  }

  async dispatchTaskflowWorkItem(
    taskflowId: string,
    workItemId: string,
    payload: {
      dispatchDecisionId?: string
      executorHint?: string
      metadata?: JsonObject
    } & JsonObject
  ): Promise<JsonObject> {
    const { dispatchDecisionId, executorHint, ...rest } = payload
    return this.taskflowPost(
      taskflowId,
      `work-items/${encodeURIComponent(workItemId)}/dispatch`,
      {
        ...rest,
        dispatch_decision_id: dispatchDecisionId,
        executor_hint: executorHint,
      }
    )
  }

  async scanTaskflowRepoComplexity(
    taskflowId: string,
    options: { workspacePath?: string; repositoryId?: string } = {}
  ): Promise<JsonObject> {
    const workspacePath = options.workspacePath?.trim()
    const repositoryId = options.repositoryId?.trim()
    return this.postPeerJson(`/remote/taskflow/taskflows/${encodeURIComponent(taskflowId)}/complexity/scan-repo`, (peer) => ({
      peer_token: peer.peer_token,
      ...(workspacePath ? { workspace_path: workspacePath } : {}),
      ...(repositoryId ? { repository_id: repositoryId } : {}),
    }))
  }

  async recordTaskflowComplexityEvidence(
    taskflowId: string,
    evidence: JsonObject[]
  ): Promise<JsonObject> {
    return this.postPeerJson(`/remote/taskflow/taskflows/${encodeURIComponent(taskflowId)}/complexity/evidence`, (peer) => ({
      peer_token: peer.peer_token,
      evidence,
    }))
  }

  async overrideTaskflowComplexity(
    taskflowId: string,
    options: { level: string; reason: string; actor?: string }
  ): Promise<JsonObject> {
    return this.postPeerJson(`/remote/taskflow/taskflows/${encodeURIComponent(taskflowId)}/complexity/override`, (peer) => ({
      peer_token: peer.peer_token,
      level: options.level,
      reason: options.reason,
      ...(options.actor ? { actor: options.actor } : {}),
    }))
  }

  async streamChat(
    chatId: string,
    cursor: number,
    timeoutSec = CHAT_STREAM_TIMEOUT_SEC
  ): Promise<JsonObject> {
    return this.postPeerJson("/remote/chat/stream", (peer) => ({
      peer_token: peer.peer_token,
      chat_id: chatId,
      cursor,
      timeout_sec: timeoutSec,
    }), { timeoutMs: Math.max(DEFAULT_REQUEST_TIMEOUT_MS, (timeoutSec + 10) * 1000) })
  }

  async chatStatus(chatId: string, cursor?: number): Promise<JsonObject> {
    return this.postPeerJson("/remote/chat/status", (peer) => ({
      peer_token: peer.peer_token,
      chat_id: chatId,
      ...(typeof cursor === "number" ? { cursor } : {}),
    }))
  }

  async cancelChat(chatId: string, reason = "user_cancelled"): Promise<JsonObject> {
    return this.postPeerJson("/remote/chat/cancel", (peer) => ({
      peer_token: peer.peer_token,
      chat_id: chatId,
      reason,
    }))
  }

  async approvalReply(payload: JsonObject): Promise<JsonObject> {
    return this.postPeerJson("/remote/approval/reply", (peer) => ({
      ...payload,
      peer_token: peer.peer_token,
    }))
  }

  async stopPeer(): Promise<void> {
    this.peerStartupGeneration += 1
    this.peerStartupPromise = undefined
    const peer = this.peerInfo
    if (peer) {
      try {
        await this.postJson("/remote/disconnect", {
          peer_token: peer.peer_token,
          reason: "peer_shutdown",
        })
      } catch {
        // Ignore disconnect failures; killing the local peer process is still sufficient.
      }
    }
    if (this.peerProcess && this.peerProcess.exitCode === null) {
      this.peerProcess.kill()
    }
    this.peerProcess = undefined
    this.peerInfo = undefined
  }

  private async authenticatedPost(pathname: string, payload: JsonObject): Promise<JsonObject> {
    const token = await this.ensureAccessToken()
    try {
      return await this.postJson(pathname, payload, { Authorization: `Bearer ${token}` })
    } catch (error) {
      if (!isRemoteError(error, "unauthorized", 401)) {
        throw error
      }
      const retryToken = await this.refreshAccessToken()
      return this.postJson(pathname, payload, { Authorization: `Bearer ${retryToken}` })
    }
  }

  private async authenticatedGet(pathname: string): Promise<JsonObject> {
    const token = await this.ensureAccessToken()
    try {
      return await this.getJson(pathname, { Authorization: `Bearer ${token}` })
    } catch (error) {
      if (!isRemoteError(error, "unauthorized", 401)) {
        throw error
      }
      const retryToken = await this.refreshAccessToken()
      return this.getJson(pathname, { Authorization: `Bearer ${retryToken}` })
    }
  }

  private async ensureAccessToken(): Promise<string> {
    if (this.accessToken && this.accessTokenExpiresAt - Date.now() / 1000 > 30) {
      return this.accessToken
    }
    return this.refreshAccessToken()
  }

  private refreshAccessToken(): Promise<string> {
    if (this.refreshAccessTokenPromise) {
      return this.refreshAccessTokenPromise
    }
    const refresh = this.refreshAccessTokenOnce()
    const sharedRefresh = refresh.finally(() => {
      if (this.refreshAccessTokenPromise === sharedRefresh) {
        this.refreshAccessTokenPromise = undefined
      }
    })
    this.refreshAccessTokenPromise = sharedRefresh
    return sharedRefresh
  }

  private async refreshAccessTokenOnce(): Promise<string> {
    const session = await this.storedAuthSession()
    if (!session?.refreshToken) {
      throw new RemoteError(401, "unauthorized", "登录已失效，请重新登录。", {})
    }
    try {
      const response = await this.postJson("/remote/auth/refresh", {
        refresh_token: session.refreshToken,
      })
      await this.storeAuthSession(response)
      if (!this.accessToken) {
        throw new Error("Invalid auth response from Labrastro Host.")
      }
      return this.accessToken
    } catch (error) {
      await this.clearAuthSession()
      if (
        isRemoteError(error, "invalid_refresh_token", 401) ||
        isRemoteError(error, "unauthorized", 401)
      ) {
        throw new RemoteError(401, "unauthorized", "登录已失效，请重新登录。", error.body)
      }
      throw error
    }
  }

  private async storedAuthSession(): Promise<StoredAuthSession | undefined> {
    const key = this.authSessionKey()
    const raw = await this.context.secrets.get(key)
    const session = this.parseStoredAuthSession(raw)
    if (session?.hostUrl === this.hostUrl) {
      return session
    }
    if (raw) {
      await this.context.secrets.delete(key)
    }
    const legacyRaw = await this.context.secrets.get(LEGACY_AUTH_SESSION_KEY)
    if (legacyRaw) {
      await this.context.secrets.delete(LEGACY_AUTH_SESSION_KEY)
    }
    return undefined
  }

  private parseStoredAuthSession(raw: string | undefined): StoredAuthSession | undefined {
    if (!raw) return undefined
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>
      const role = roleValue(parsed.role)
      const session: StoredAuthSession = {
        hostUrl: stringValue(parsed.hostUrl),
        username: stringValue(parsed.username),
        role: role || "user",
        scopes: stringArray(parsed.scopes),
        deviceId: stringValue(parsed.deviceId),
        refreshToken: stringValue(parsed.refreshToken),
      }
      return session.hostUrl && session.refreshToken ? session : undefined
    } catch {
      return undefined
    }
  }

  private async storeAuthSession(response: JsonObject): Promise<void> {
    const user = objectValue(response.user)
    const device = objectValue(response.device)
    const role = roleValue(user.role) || "user"
    const session: StoredAuthSession = {
      hostUrl: this.hostUrl,
      username: stringValue(user.username),
      role,
      scopes: stringArray(user.scopes),
      deviceId: stringValue(device.id),
      refreshToken: stringValue(response.refresh_token),
    }
    const accessToken = stringValue(response.access_token)
    if (!accessToken || !session.refreshToken || !session.username) {
      throw new Error("Invalid auth response from Labrastro Host.")
    }
    this.accessToken = accessToken
    this.accessTokenExpiresAt = numberValue(response.access_expires_at) || 0
    await this.context.secrets.store(this.authSessionKey(), JSON.stringify(session))
    await this.context.secrets.delete(LEGACY_AUTH_SESSION_KEY)
  }

  private async clearAuthSession(): Promise<void> {
    this.accessToken = undefined
    this.accessTokenExpiresAt = 0
    await this.context.secrets.delete(this.authSessionKey())
    await this.context.secrets.delete(LEGACY_AUTH_SESSION_KEY)
  }

  private authSessionKey(hostUrl = this.hostUrl): string {
    return `labrastro.authSession.${Buffer.from(hostUrl).toString("base64url")}`
  }

  private connectionStatePayload(
    host: HostUrlState,
    patch: Omit<Partial<ConnectionState>, "hostUrl" | "hostUrlConfigured" | "hostUrlSource" | "peerConnected" | "peerId">
  ): ConnectionState {
    return {
      hostUrl: host.url,
      hostUrlConfigured: host.configured,
      hostUrlSource: host.source,
      securityWarnings: hostSecurityWarnings(host.url),
      authReachable: false,
      authenticated: false,
      peerConnected: this.isPeerRunning(),
      peerId: this.peerInfo?.peer_id,
      status: "login-required",
      ...patch,
    }
  }

  private async postPeerJson(
    pathname: string,
    payload: (peer: PeerInfo) => JsonObject,
    options: { timeoutMs?: number } = {}
  ): Promise<JsonObject> {
    let peer = await this.ensurePeer()
    return retryInvalidPeerTokenOnce(
      () => this.postJson(pathname, payload(peer), {}, options),
      async () => {
        await this.stopPeer()
        peer = await this.ensurePeer()
      }
    )
  }

  private async getPeerJson(pathname: string): Promise<JsonObject> {
    let peer = await this.ensurePeer()
    const separator = pathname.includes("?") ? "&" : "?"
    return retryInvalidPeerTokenOnce(
      () => this.getJson(`${pathname}${separator}peer_token=${encodeURIComponent(peer.peer_token)}`),
      async () => {
        await this.stopPeer()
        peer = await this.ensurePeer()
      }
    )
  }

  private async taskflowPost(
    taskflowId: string,
    pathSuffix: string,
    payload: JsonObject
  ): Promise<JsonObject> {
    const cleanPayload = stripUndefined(payload)
    return this.postPeerJson(
      `/remote/taskflow/taskflows/${encodeURIComponent(taskflowId)}/${pathSuffix}`,
      (peer) => ({
        peer_token: peer.peer_token,
        ...cleanPayload,
      })
    )
  }

  private async ensurePeer(): Promise<PeerInfo> {
    if (this.peerInfo && this.isPeerRunning()) {
      return this.peerInfo
    }
    if (this.peerStartupPromise) {
      return this.peerStartupPromise
    }

    const generation = this.peerStartupGeneration
    const startup = this.startPeer(generation)
    this.peerStartupPromise = startup
    try {
      return await startup
    } finally {
      if (this.peerStartupPromise === startup) {
        this.peerStartupPromise = undefined
      }
    }
  }

  private async startPeer(generation: number): Promise<PeerInfo> {
    await fs.mkdir(this.context.globalStorageUri.fsPath, { recursive: true })
    const bootstrap = await this.authenticatedPost("/remote/auth/bootstrap-token", {})
    const token = stringValue(bootstrap.bootstrap_token)
    if (!token) {
      throw new Error("Unable to obtain bootstrap token from host.")
    }
    if (this.peerStartupGeneration !== generation) {
      throw new Error("Peer startup was cancelled.")
    }
    const binaryPath = await this.ensurePeerBinary()
    const peerInfoPath = path.join(this.context.globalStorageUri.fsPath, "peer-info.json")
    await fs.rm(peerInfoPath, { force: true })

    if (this.peerStartupGeneration !== generation) {
      throw new Error("Peer startup was cancelled.")
    }

    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd()
    const peerProcess = spawn(
      binaryPath,
      [
        "--host",
        this.hostUrl,
        "--bootstrap-token",
        token,
        "--cwd",
        workspaceRoot,
        "--workspace-root",
        workspaceRoot,
        "--peer-info-file",
        peerInfoPath,
      ],
      { cwd: workspaceRoot }
    )
    if (this.peerStartupGeneration !== generation) {
      if (peerProcess.exitCode === null) {
        peerProcess.kill()
      }
      throw new Error("Peer startup was cancelled.")
    }
    this.peerProcess = peerProcess
    const peerOutput: PeerStartupOutput = { stdout: [], stderr: [] }
    peerProcess.stdout.on("data", (chunk) => {
      const text = String(chunk)
      appendPeerOutput(peerOutput.stdout, text)
      console.log(`[labrastro peer] ${text}`)
    })
    peerProcess.stderr.on("data", (chunk) => {
      const text = String(chunk)
      appendPeerOutput(peerOutput.stderr, text)
      console.warn(`[labrastro peer] ${text}`)
    })
    peerProcess.on("exit", () => {
      if (this.peerProcess === peerProcess) {
        this.peerProcess = undefined
        this.peerInfo = undefined
      }
    })

    const peerInfo = await waitForPeerInfo(peerInfoPath, peerProcess, peerOutput)
    if (this.peerStartupGeneration !== generation) {
      if (peerProcess.exitCode === null) {
        peerProcess.kill()
      }
      throw new Error("Peer startup was cancelled.")
    }
    this.peerInfo = peerInfo
    return peerInfo
  }

  private isPeerRunning(): boolean {
    return Boolean(this.peerProcess && this.peerProcess.exitCode === null && this.peerInfo)
  }

  private hostUrlState(): HostUrlState {
    const config = this.labrastroConfig()
    return resolveHostUrlState(
      this.labrastroHostInspection(config),
      config.get<string>("hostUrl", DEFAULT_HOST_URL)
    )
  }

  private labrastroConfig(source?: HostUrlSource): vscode.WorkspaceConfiguration {
    const resource = source === "workspace-folder"
      ? vscode.workspace.workspaceFolders?.[0]?.uri
      : undefined
    return vscode.workspace.getConfiguration("labrastro", resource)
  }

  private labrastroHostInspection(config = this.labrastroConfig()): HostUrlInspection | undefined {
    return config.inspect<string>("hostUrl")
  }

  private async updateLabrastroHostUrl(value: string, source: HostUrlSource): Promise<void> {
    const normalizedSource =
      source === "workspace-folder" && vscode.workspace.workspaceFolders?.[0]
        ? "workspace-folder"
        : source === "workspace"
          ? "workspace"
          : "global"
    const target =
      normalizedSource === "workspace-folder"
        ? vscode.ConfigurationTarget.WorkspaceFolder
        : normalizedSource === "workspace"
          ? vscode.ConfigurationTarget.Workspace
          : vscode.ConfigurationTarget.Global
    await this.labrastroConfig(normalizedSource).update("hostUrl", value, target)
  }

  private async ensurePeerBinary(): Promise<string> {
    const platform = peerPlatform()
    const filename = process.platform === "win32" ? "rcoder-peer.exe" : "rcoder-peer"
    const version = await this.peerArtifactVersionSegment()
    const binaryPath = path.join(
      this.context.globalStorageUri.fsPath,
      "bin",
      `${platform.os}-${platform.arch}`,
      version,
      filename
    )
    const artifactPath = `/remote/artifacts/${platform.os}/${platform.arch}/rcoder-peer`
    const content = await this.requestBuffer(artifactPath)
    try {
      await fs.mkdir(path.dirname(binaryPath), { recursive: true })
      if (await isUsableFile(binaryPath)) {
        const existing = await fs.readFile(binaryPath)
        if (existing.equals(content)) {
          await this.ensurePeerBinaryExecutable(binaryPath)
          return binaryPath
        }
        return await this.installPeerBinary(binaryPath, content, true)
      }
      await removeEmptyFile(binaryPath)
    } catch (error) {
      throw peerBinaryAccessError(error, binaryPath)
    }

    try {
      return await this.installPeerBinary(binaryPath, content, false)
    } catch (error) {
      throw peerBinaryAccessError(error, binaryPath)
    }
  }

  private async peerArtifactVersionSegment(): Promise<string> {
    try {
      const backendFeatures = await this.features()
      return safePathSegment(backendFeatures.serverVersion, "unknown")
    } catch (error) {
      console.warn("[labrastro] unable to read backend version for peer artifact cache", error)
      return "unknown"
    }
  }

  private async installPeerBinary(binaryPath: string, content: Buffer, replaceExisting: boolean): Promise<string> {
    const tempPath = path.join(
      path.dirname(binaryPath),
      `${path.basename(binaryPath)}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`
    )
    try {
      await fs.writeFile(tempPath, content, { flag: "wx" })
      if (replaceExisting) {
        await fs.rename(tempPath, binaryPath)
        await this.ensurePeerBinaryExecutable(binaryPath)
        return binaryPath
      }
      try {
        await fs.copyFile(tempPath, binaryPath, fsConstants.COPYFILE_EXCL)
      } catch (error) {
        if (errorCode(error) === "EEXIST" && await isUsableFile(binaryPath)) {
          await this.ensurePeerBinaryExecutable(binaryPath)
          return binaryPath
        }
        throw error
      }
      await this.ensurePeerBinaryExecutable(binaryPath)
      return binaryPath
    } finally {
      await fs.rm(tempPath, { force: true })
    }
  }

  private async ensurePeerBinaryExecutable(binaryPath: string): Promise<void> {
    if (process.platform !== "win32") {
      await fs.chmod(binaryPath, 0o755)
    }
  }

  private async postJson(
    pathname: string,
    payload: JsonObject,
    headers: Record<string, string> = {},
    options: { timeoutMs?: number } = {}
  ): Promise<JsonObject> {
    const response = await fetchWithTimeout(this.hostUrl + pathname, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...headers,
      },
      body: JSON.stringify(payload),
    }, options.timeoutMs)
    return parseJsonResponse(response)
  }

  private async getJson(pathname: string, headers: Record<string, string> = {}): Promise<JsonObject> {
    const response = await fetchWithTimeout(this.hostUrl + pathname, { headers })
    return parseJsonResponse(response)
  }

  private async requestBuffer(pathname: string): Promise<Buffer> {
    const response = await fetchWithTimeout(this.hostUrl + pathname)
    if (!response.ok) {
      throw new Error(`${response.status} ${await response.text()}`)
    }
    return Buffer.from(await response.arrayBuffer())
  }
}

async function fetchWithTimeout(
  input: string,
  init: RequestInit = {},
  timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), Math.max(1, timeoutMs))
  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    })
  } catch (error) {
    if (classifyRemoteError(error) === "transient_network") {
      throw new RemoteTransportError(errorMessage(error), "transient_network", error)
    }
    throw error
  } finally {
    clearTimeout(timer)
  }
}

export async function parseJsonResponse(response: Response): Promise<JsonObject> {
  const text = await response.text()
  let body: unknown = {}
  try {
    body = text ? JSON.parse(text) : {}
  } catch {
    body = { message: text }
  }
  if (!response.ok) {
    const payload = body && typeof body === "object" ? (body as JsonObject) : {}
    const code = typeof payload.error === "string" ? payload.error : ""
    const detail = typeof payload.message === "string" ? payload.message : text
    const message = [response.status, code || detail].filter(Boolean).join(" ")
    throw new RemoteError(response.status, code, message, body)
  }
  return body && typeof body === "object" ? (body as JsonObject) : {}
}

function normalizeBackendFeatures(payload: JsonObject): BackendFeatures {
  const features =
    payload.features && typeof payload.features === "object"
      ? (payload.features as JsonObject)
      : {}
  return {
    ok: payload.ok === true,
    apiVersion: numberValue(payload.api_version) ?? 0,
    serverVersion: typeof payload.server_version === "string" ? payload.server_version : "",
    sessions: features.sessions === true,
    sessionAutoSave: features.session_auto_save !== false,
    sessionHistoryWritable:
      features.session_history_writable === false
        ? false
        : features.sessions === true,
    chatStream: features.chat_stream === true,
    taskflow: features.taskflow === true,
    issueAssignment: features.issue_assignment === true,
    freshSessionWithoutSessionHint: features.fresh_session_without_session_hint === true,
    peerTokenHeartbeatRefresh: features.peer_token_heartbeat_refresh === true,
    agentRuns: normalizeAgentRunFeatures(features.agent_runs),
  }
}

function normalizeAgentRunFeatures(value: unknown): AgentRunFeatures {
  const runtime = objectValue(value)
  const executorFeatures: Record<string, ExecutorFeature> = {}
  for (const [executor, feature] of Object.entries(objectValue(runtime.executor_features))) {
    executorFeatures[executor] = normalizeExecutorFeature(feature)
  }
  return { executorFeatures }
}

function normalizeExecutorFeature(value: unknown): ExecutorFeature {
  const feature = objectValue(value)
  const testedVersion = stringValue(feature.tested_version)
  return {
    installed: feature.installed === true,
    version: stringValue(feature.version),
    streamJson: feature.stream_json === true,
    sessionDiscovery: feature.session_discovery === true,
    resumeById: feature.resume_by_id === true,
    usage: feature.usage === true,
    mcpConfig: feature.mcp_config === true,
    runtimeHomeIsolation: stringValue(feature.runtime_home_isolation),
    modelArg: feature.model_arg === true,
    ...(testedVersion ? { testedVersion } : {}),
    limitations: stringArray(feature.limitations),
  }
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function objectValue(value: unknown): JsonObject {
  return value && typeof value === "object" ? (value as JsonObject) : {}
}

function stripUndefined(value: JsonObject): JsonObject {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined)
  )
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : ""
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => String(item)).filter((item) => item.trim())
    : []
}

function roleValue(value: unknown): StoredAuthSession["role"] | undefined {
  return value === "superadmin" || value === "admin" || value === "user"
    ? value
    : undefined
}

function hostSecurityWarnings(hostUrl: string): string[] {
  try {
    const url = new URL(hostUrl)
    const hostname = url.hostname.toLowerCase()
    const local = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1"
    if (url.protocol === "http:" && !local) {
      return ["当前 Host 使用非 localhost HTTP，生产环境建议放在 HTTPS 反向代理后。"]
    }
  } catch {
    return []
  }
  return []
}

function peerPlatform(): { os: string; arch: string } {
  const osName =
    process.platform === "win32" ? "windows" : process.platform === "darwin" ? "darwin" : "linux"
  const arch = process.arch === "arm64" ? "arm64" : "amd64"
  return { os: osName, arch }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function peerBinaryAccessError(error: unknown, binaryPath: string): Error {
  const code = errorCode(error)
  if (code === "EBUSY" || code === "EPERM" || code === "EACCES") {
    return new Error(
      `本地 peer 二进制无法写入：${binaryPath} 被占用或无权限访问。请结束旧的 rcoder-peer.exe 进程，或执行 Developer: Reload Window 后重试。原始错误：${errorMessage(error)}`
    )
  }
  return error instanceof Error ? error : new Error(String(error))
}

function safePathSegment(value: string, fallback: string): string {
  const sanitized = value
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "")
  return sanitized || fallback
}

async function isUsableFile(filePath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(filePath)
    return stat.isFile() && stat.size > 0
  } catch (error) {
    if (errorCode(error) === "ENOENT") {
      return false
    }
    throw error
  }
}

async function removeEmptyFile(filePath: string): Promise<void> {
  try {
    const stat = await fs.stat(filePath)
    if (stat.isFile() && stat.size === 0) {
      await fs.rm(filePath, { force: true })
    }
  } catch (error) {
    if (errorCode(error) !== "ENOENT") {
      throw error
    }
  }
}


async function waitForPeerInfo(
  peerInfoPath: string,
  peerProcess: ChildProcessWithoutNullStreams,
  output: PeerStartupOutput
): Promise<PeerInfo> {
  const deadline = Date.now() + 15000
  let lastError: unknown
  while (Date.now() < deadline) {
    try {
      const raw = await fs.readFile(peerInfoPath, "utf-8")
      const parsed = JSON.parse(raw) as PeerInfo
      if (parsed.peer_id && parsed.peer_token) {
        return parsed
      }
    } catch (error) {
      lastError = error
    }
    if (peerProcessExited(peerProcess)) {
      throw new Error(peerStartupFailureMessage(peerInfoPath, peerProcess, output, lastError, false))
    }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error(peerStartupFailureMessage(peerInfoPath, peerProcess, output, lastError, true))
}

function peerProcessExited(peerProcess: ChildProcessWithoutNullStreams): boolean {
  return peerProcess.exitCode !== null || peerProcess.signalCode != null
}

function appendPeerOutput(target: string[], text: string): void {
  target.push(text)
  while (target.join("").length > 4000) {
    target.shift()
  }
}

function peerStartupFailureMessage(
  peerInfoPath: string,
  peerProcess: ChildProcessWithoutNullStreams,
  output: PeerStartupOutput,
  lastError: unknown,
  timedOut: boolean
): string {
  const reason = timedOut
    ? "Peer did not report registration info in time"
    : `Peer exited before reporting registration info (exit=${peerProcess.exitCode ?? "null"}, signal=${peerProcess.signalCode ?? "null"})`
  const hasPeerOutput = output.stderr.length > 0 || output.stdout.length > 0
  const details = [
    peerOutputDetail("stderr", output.stderr),
    peerOutputDetail("stdout", output.stdout),
    lastError && !hasPeerOutput ? `last file read error: ${errorMessage(lastError)}` : "",
    `peer info path: ${peerInfoPath}`,
  ].filter(Boolean)
  return `${reason}. ${details.join(" ")}`
}

function peerOutputDetail(label: string, chunks: string[]): string {
  const text = chunks.join("").trim()
  return text ? `${label}: ${text}` : ""
}
