import * as vscode from "vscode"
import * as fs from "fs/promises"
import { constants as fsConstants } from "fs"
import * as path from "path"
import { spawn, type ChildProcessWithoutNullStreams } from "child_process"
import { createHash } from "crypto"
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
import {
  PeerDiagnosticsLogger,
  type PeerDiagnosticsLoggingState,
} from "./PeerDiagnosticsLogger"
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

export const SESSION_RUN_EVENTS_TIMEOUT_SEC = 10
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000
const LEGACY_AUTH_SESSION_KEY = "labrastro.authSession"
const PEER_INFO_WAIT_TIMEOUT_MS = 35_000
const PEER_INFO_POLL_INTERVAL_MS = 200
const PEER_STARTUP_MAX_ATTEMPTS = 3
const PEER_STARTUP_RETRY_DELAYS_MS = [500, 1500]
const PEER_STARTUP_RETRYABLE_FRAGMENTS = [
  "context deadline exceeded",
  "client.timeout",
  "this operation was aborted",
  "timeout",
  "timed out",
  "econnreset",
  "etimedout",
  "econnrefused",
  "socket hang up",
  "http 408",
  "http 429",
  "http 500",
  "http 502",
  "http 503",
  "http 504",
]

export interface BackendFeatures {
  ok: boolean
  apiVersion: number
  serverVersion: string
  sessions: boolean
  sessionAutoSave: boolean
  sessionHistoryWritable: boolean
  sessionRuns: boolean
  taskflow: boolean
  issueAssignment: boolean
  freshSessionWithoutSessionHint: boolean
  peerTokenHeartbeatRefresh: boolean
  agentRuns: AgentRunFeatures
}

export interface SessionRunEventsOptions {
  timeoutSec?: number
  signal?: AbortSignal
}

export interface SessionRunEventsBatchOptions extends SessionRunEventsOptions {
  timeoutMs?: number
}

export type SessionRunEventsHandler = (batch: JsonObject) => void | Promise<void>

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
  peerPreparation: PeerPreparationState
  status: "checking" | "login-required" | "ready" | "error"
  message?: string
  hostUrlSaveRequested?: string
  hostUrlSaveApplied?: boolean
}

export type PeerPreparationPhase =
  | "idle"
  | "checking"
  | "downloading"
  | "installing"
  | "starting"
  | "connected"
  | "error"

export interface PeerPreparationState {
  phase: PeerPreparationPhase
  label: string
  detail?: string
  loadedBytes?: number
  totalBytes?: number
  progressPercent?: number
  peerId?: string
  updatedAt: string
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
  heartbeat_interval_ms?: number
}

interface PeerStartupOutput {
  stdout: string[]
  stderr: string[]
}

class PeerStartupError extends Error {
  constructor(
    message: string,
    public readonly retryable: boolean
  ) {
    super(message)
    this.name = "PeerStartupError"
  }
}

export class LabrastroRemoteClient {
  private peerProcess: ChildProcessWithoutNullStreams | undefined
  private peerInfo: PeerInfo | undefined
  private peerStartupPromise: Promise<PeerInfo> | undefined
  private peerStartupGeneration = 0
  private peerPreparation: PeerPreparationState = idlePeerPreparationState()
  private peerPreparationListener: ((state: PeerPreparationState) => void) | undefined
  private lastPeerStopCaller: string | undefined
  private readonly peerStopCallers = new WeakMap<ChildProcessWithoutNullStreams, string>()
  private readonly peerDiagnosticsLogger: PeerDiagnosticsLogger
  private accessToken: string | undefined
  private accessTokenExpiresAt = 0
  private refreshAccessTokenPromise: Promise<string> | undefined

  constructor(private readonly context: vscode.ExtensionContext) {
    this.peerDiagnosticsLogger = new PeerDiagnosticsLogger(context)
  }

  setPeerPreparationListener(listener: ((state: PeerPreparationState) => void) | undefined): void {
    this.peerPreparationListener = listener
  }

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
      peerPreparation: this.peerPreparationSnapshot(),
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
    await this.stopPeer("logout")
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

  async providersList(): Promise<JsonObject> {
    return this.authenticatedPost("/remote/admin/providers/list", {})
  }

  async modelProfilesList(): Promise<JsonObject> {
    return this.authenticatedPost("/remote/admin/models/list", {})
  }

  async chatConfigRead(): Promise<JsonObject> {
    return this.authenticatedPost("/remote/admin/chat-config/read", {})
  }

  async githubStatus(): Promise<JsonObject> {
    return this.authenticatedPost("/remote/admin/github/status", {})
  }

  async serverSettingsRead(): Promise<JsonObject> {
    return this.authenticatedPost("/remote/admin/server-settings/read", {})
  }

  async serverSettingsUpdate(payload: JsonObject): Promise<JsonObject> {
    return this.authenticatedPost("/remote/admin/server-settings/update", payload)
  }

  async toolDiagnosticsStats(): Promise<JsonObject> {
    return this.authenticatedPost("/remote/admin/diagnostics/tool-diagnostics/stats", {})
  }

  async modelCapabilitiesStatus(): Promise<JsonObject> {
    return this.authenticatedPost("/remote/admin/model-capabilities/status", {})
  }

  async modelCapabilitiesList(payload: JsonObject = {}): Promise<JsonObject> {
    return this.authenticatedPost("/remote/admin/model-capabilities/list", payload)
  }

  async modelCapabilitiesRefresh(): Promise<JsonObject> {
    return this.authenticatedPost("/remote/admin/model-capabilities/refresh", {})
  }

  async modelCapabilitiesApply(payload: JsonObject): Promise<JsonObject> {
    return this.authenticatedPost("/remote/admin/model-capabilities/apply", payload)
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

  async branchAgentRun(payload: {
    sourceAgentRunId: string
    baseSessionItemId: string
    runtimeRoot: string
    prompt: string
    agentRunId?: string
    branchBindingId: string
    selectBranch?: boolean
    metadata?: JsonObject
  }): Promise<JsonObject> {
    const branchBindingId = requiredBranchBindingId(payload.branchBindingId)
    return this.authenticatedPost("/remote/admin/agent-runs/branch", {
      source_agent_run_id: payload.sourceAgentRunId,
      base_session_item_id: payload.baseSessionItemId,
      runtime_root: payload.runtimeRoot,
      prompt: payload.prompt,
      ...(payload.agentRunId ? { agent_run_id: payload.agentRunId } : {}),
      branch_binding_id: branchBindingId,
      select_branch: payload.selectBranch !== false,
      ...(payload.metadata && Object.keys(payload.metadata).length ? { metadata: payload.metadata } : {}),
    })
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

  async modelProfileDelete(payload: JsonObject): Promise<JsonObject> {
    return this.authenticatedPost("/remote/admin/models/delete", payload)
  }

  async modelProfileActivate(payload: JsonObject): Promise<JsonObject> {
    return this.authenticatedPost("/remote/admin/models/activate", payload)
  }

  async capabilityPackageIngestSessionStart(payload: JsonObject): Promise<JsonObject> {
    return this.authenticatedPeerPost("/remote/admin/capability-packages/ingest/session/start", (peer) => ({
      ...payload,
      peer_token: peer.peer_token,
    }))
  }

  async claimLocalActions(options: {
    features?: string[]
    maxActions?: number
    workspaceRoot?: string
  } = {}): Promise<JsonObject> {
    const workspaceRoot = options.workspaceRoot
      ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
      ?? process.cwd()
    return this.postPeerJson("/remote/local-actions/claim", (peer) => ({
      peer_token: peer.peer_token,
      peer_id: peer.peer_id,
      worker_kind: "local_peer",
      features: options.features ?? ["local_actions"],
      max_actions: options.maxActions ?? 1,
      workspace_root: workspaceRoot,
    }))
  }

  async completeLocalAction(payload: {
    localActionId: string
    leaseId: string
    status: string
    result?: JsonObject
    error?: string
  }): Promise<JsonObject> {
    return this.postPeerJson("/remote/local-actions/complete", (peer) =>
      stripUndefined({
        peer_token: peer.peer_token,
        local_action_id: payload.localActionId,
        lease_id: payload.leaseId,
        status: payload.status,
        result: payload.result ?? {},
        error: payload.error,
      })
    )
  }

  async capabilityPackageDelete(payload: JsonObject): Promise<JsonObject> {
    return this.authenticatedPost("/remote/admin/capability-packages/delete", payload)
  }

  async capabilityPackageEnable(payload: JsonObject): Promise<JsonObject> {
    return this.authenticatedPost("/remote/admin/capability-packages/enable", payload)
  }

  async environmentRequirementsList(): Promise<JsonObject> {
    return this.authenticatedPost("/remote/admin/environment-requirements/list", {})
  }

  async environmentRequirementsDashboard(): Promise<JsonObject> {
    return this.authenticatedPost("/remote/admin/environment-requirements/dashboard", {})
  }

  async behaviorCatalog(): Promise<JsonObject> {
    return this.authenticatedPost("/remote/admin/behavior/catalog", {})
  }

  async environmentRequirementRecord(payload: JsonObject): Promise<JsonObject> {
    return this.authenticatedPost("/remote/admin/environment-requirements/record", { environment_requirement: payload })
  }

  async environmentRequirementDelete(id: string): Promise<JsonObject> {
    return this.authenticatedPost("/remote/admin/environment-requirements/delete", { id })
  }

  async environmentRequirementEnable(id: string, enabled: boolean): Promise<JsonObject> {
    return this.authenticatedPost("/remote/admin/environment-requirements/enable", { id, enabled })
  }

  async mcpServersList(): Promise<JsonObject> {
    return this.authenticatedPost("/remote/admin/mcp-servers/list", {})
  }

  async mcpServersDashboard(): Promise<JsonObject> {
    return this.authenticatedPost("/remote/admin/mcp-servers/dashboard", {})
  }

  async mcpServerRecord(payload: JsonObject): Promise<JsonObject> {
    return this.authenticatedPost("/remote/admin/mcp-servers/record", { mcp_server: payload })
  }

  async mcpServerDelete(name: string): Promise<JsonObject> {
    return this.authenticatedPost("/remote/admin/mcp-servers/delete", { name })
  }

  async mcpServerEnable(name: string, enabled: boolean): Promise<JsonObject> {
    return this.authenticatedPost("/remote/admin/mcp-servers/enable", { name, enabled })
  }

  async skillsList(): Promise<JsonObject> {
    return this.authenticatedPost("/remote/admin/skills/list", {})
  }

  async skillsDashboard(): Promise<JsonObject> {
    return this.authenticatedPost("/remote/admin/skills/dashboard", {})
  }

  async skillRecord(payload: JsonObject): Promise<JsonObject> {
    return this.authenticatedPost("/remote/admin/skills/record", { skill: payload })
  }

  async skillDelete(name: string): Promise<JsonObject> {
    return this.authenticatedPost("/remote/admin/skills/delete", { name })
  }

  async skillEnable(name: string, enabled: boolean): Promise<JsonObject> {
    return this.authenticatedPost("/remote/admin/skills/enable", { name, enabled })
  }

  async lifecycleHookTrust(payload: JsonObject): Promise<JsonObject> {
    return this.authenticatedPost("/remote/admin/lifecycle-hooks/trust", payload)
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
    keepThroughMessageIndex: number
  ): Promise<JsonObject> {
    return this.postPeerJson("/remote/sessions/fork", (peer) => ({
      peer_token: peer.peer_token,
      source_session_id: sourceSessionId,
      keep_through_message_index: keepThroughMessageIndex,
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

  async startSessionRun(
    prompt: string,
    sessionId?: string,
    options: {
      mode?: string
      workflowMode?: string
      taskflowId?: string
      providerId?: string
      modelId?: string
      parameters?: JsonObject
      locale?: string
      clientRequestId?: string
      mentions?: JsonObject[]
    } = {}
  ): Promise<JsonObject> {
    const taskflowId = options.taskflowId?.trim()
    const providerId = options.providerId?.trim()
    const modelId = options.modelId?.trim()
    const locale = options.locale?.trim()
    const parameters = options.parameters && Object.keys(options.parameters).length
      ? options.parameters
      : undefined
    return this.postPeerJson("/remote/session-runs/start", (peer) => ({
      peer_token: peer.peer_token,
      prompt,
      session_hint: sessionId,
      client_request_id: options.clientRequestId || `session-run-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      ...(options.mode?.trim() ? { mode: options.mode.trim() } : {}),
      ...(options.workflowMode?.trim() ? { workflow_mode: options.workflowMode.trim() } : {}),
      ...(taskflowId ? { taskflow_id: taskflowId } : {}),
      ...(providerId && modelId ? { provider_id: providerId, model_id: modelId } : {}),
      ...(providerId && modelId && parameters ? { parameters } : {}),
      ...(locale ? { locale } : {}),
      ...(options.mentions?.length ? { mentions: options.mentions } : {}),
    }))
  }

  async continueSessionRun(payload: {
    sessionRunId: string
    branchBindingId: string
    prompt: string
    clientRequestId?: string
    locale?: string
    mentions?: JsonObject[]
  }): Promise<JsonObject> {
    const locale = payload.locale?.trim()
    const sessionRunId = requiredSessionRunId(payload.sessionRunId)
    const branchBindingId = requiredBranchBindingId(payload.branchBindingId)
    return this.postPeerJson("/remote/session-runs/continue", (peer) => ({
      peer_token: peer.peer_token,
      session_run_id: sessionRunId,
      branch_binding_id: branchBindingId,
      prompt: payload.prompt,
      client_request_id: payload.clientRequestId || `session-run-continue-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      ...(locale ? { locale } : {}),
      ...(payload.mentions?.length ? { mentions: payload.mentions } : {}),
    }))
  }

  async dispatchChatCommand(payload: {
    text: string
    commandId?: string
    trigger?: string
    args?: string
    sessionId?: string
    clientRequestId?: string
    mentions?: JsonObject[]
  }): Promise<JsonObject> {
    return this.postPeerJson("/remote/chat/command", (peer) => ({
      peer_token: peer.peer_token,
      text: payload.text,
      ...(payload.commandId ? { command_id: payload.commandId } : {}),
      ...(payload.trigger ? { trigger: payload.trigger } : {}),
      ...(payload.args ? { args: payload.args } : {}),
      ...(payload.sessionId ? { session_hint: payload.sessionId } : {}),
      ...(payload.clientRequestId ? { client_request_id: payload.clientRequestId } : {}),
      ...(payload.mentions?.length ? { mentions: payload.mentions } : {}),
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

  peerDiagnosticsLoggingState(): PeerDiagnosticsLoggingState {
    return this.peerDiagnosticsLogger.state()
  }

  async savePeerDiagnosticsLoggingState(
    patch: Record<string, unknown>
  ): Promise<PeerDiagnosticsLoggingState> {
    return this.peerDiagnosticsLogger.save(patch)
  }

  async openPeerDiagnosticsLog(): Promise<PeerDiagnosticsLoggingState> {
    return this.peerDiagnosticsLogger.open()
  }

  async clearPeerDiagnosticsLog(): Promise<PeerDiagnosticsLoggingState> {
    return this.peerDiagnosticsLogger.clear()
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

  async streamSessionRunEvents(
    sessionRunId: string,
    cursor: number,
    branchBindingId: string,
    onBatch: SessionRunEventsHandler,
    options: SessionRunEventsOptions = {}
  ): Promise<void> {
    const streamSessionRunId = requiredSessionRunId(sessionRunId)
    const streamBranchBindingId = requiredBranchBindingId(branchBindingId)
    let peer = await this.ensurePeer()
    return retryInvalidPeerTokenOnce(
      () => this.openSessionRunEventStream(peer, streamSessionRunId, cursor, streamBranchBindingId, onBatch, options),
      async () => {
        await this.stopPeer("invalid_peer_token_retry")
        peer = await this.ensurePeer()
      }
    )
  }

  async fetchSessionRunEventsBatch(
    sessionRunId: string,
    cursor: number,
    branchBindingId: string,
    options: SessionRunEventsBatchOptions = {}
  ): Promise<JsonObject> {
    const batchSessionRunId = requiredSessionRunId(sessionRunId)
    const batchBranchBindingId = requiredBranchBindingId(branchBindingId)
    let peer = await this.ensurePeer()
    return retryInvalidPeerTokenOnce(
      () => this.openSessionRunEventsBatch(peer, batchSessionRunId, cursor, batchBranchBindingId, options),
      async () => {
        await this.stopPeer("invalid_peer_token_retry")
        peer = await this.ensurePeer()
      }
    )
  }

  async sessionRunStatus(
    sessionRunId: string,
    cursor: number | undefined,
    branchBindingId: string,
  ): Promise<JsonObject> {
    const statusSessionRunId = requiredSessionRunId(sessionRunId)
    const statusBranchBindingId = requiredBranchBindingId(branchBindingId)
    return this.postPeerJson("/remote/session-runs/status", (peer) => ({
      peer_token: peer.peer_token,
      session_run_id: statusSessionRunId,
      branch_binding_id: statusBranchBindingId,
      ...(typeof cursor === "number" ? { cursor } : {}),
    }))
  }

  async selectSessionRunBranch(payload: {
    sessionRunId: string
    branchBindingId: string
    cursor?: number
  }): Promise<JsonObject> {
    const sessionRunId = requiredSessionRunId(payload.sessionRunId)
    const branchBindingId = requiredBranchBindingId(payload.branchBindingId)
    return this.postPeerJson("/remote/session-runs/branches/select", (peer) => ({
      peer_token: peer.peer_token,
      session_run_id: sessionRunId,
      branch_binding_id: branchBindingId,
      ...(typeof payload.cursor === "number" ? { cursor: payload.cursor } : {}),
    }))
  }

  async cancelSessionRun(
    sessionRunId: string,
    reason = "user_cancelled",
    branchBindingId: string,
  ): Promise<JsonObject> {
    const cancelSessionRunId = requiredSessionRunId(sessionRunId)
    const cancelBranchBindingId = requiredBranchBindingId(branchBindingId)
    return this.postPeerJson("/remote/session-runs/cancel", (peer) => ({
      peer_token: peer.peer_token,
      session_run_id: cancelSessionRunId,
      branch_binding_id: cancelBranchBindingId,
      reason,
    }))
  }

  async steerAgentRun(payload: {
    agentRunId: string
    sessionRunId: string
    text: string
    activationId?: string
    branchBindingId: string
    clientSteerId?: string
    idempotencyKey?: string
  }): Promise<JsonObject> {
    const agentRunId = encodeURIComponent(payload.agentRunId)
    const sessionRunId = requiredSessionRunId(payload.sessionRunId)
    const branchBindingId = requiredBranchBindingId(payload.branchBindingId)
    return this.postPeerJson(`/remote/agent-runs/${agentRunId}/steer`, (peer) => ({
      peer_token: peer.peer_token,
      session_run_id: sessionRunId,
      branch_binding_id: branchBindingId,
      ...(payload.activationId ? { activation_id: payload.activationId } : {}),
      source: "user",
      payload: {
        type: "user_text",
        text: payload.text,
      },
      idempotency_key: payload.idempotencyKey || payload.clientSteerId || `activation-steer-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      ...(payload.clientSteerId ? { client_steer_id: payload.clientSteerId } : {}),
    }))
  }


  async recoverSessionRun(payload: {
    sessionRunId: string
    branchBindingId: string
    action: "continue" | "retry"
  }): Promise<JsonObject> {
    const sessionRunId = requiredSessionRunId(payload.sessionRunId)
    const branchBindingId = requiredBranchBindingId(payload.branchBindingId)
    return this.postPeerJson("/remote/session-runs/recover", (peer) => ({
      peer_token: peer.peer_token,
      session_run_id: sessionRunId,
      branch_binding_id: branchBindingId,
      action: payload.action,
    }))
  }

  async approvalReply(payload: JsonObject): Promise<JsonObject> {
    const sessionRunId = requiredSessionRunId(payload.session_run_id ?? payload.sessionRunId)
    const branchBindingId = requiredBranchBindingId(payload.branch_binding_id ?? payload.branchBindingId)
    return this.postPeerJson("/remote/approval/reply", (peer) => ({
      ...payload,
      peer_token: peer.peer_token,
      session_run_id: sessionRunId,
      branch_binding_id: branchBindingId,
    }))
  }

  async sessionRunUserInputReply(payload: JsonObject): Promise<JsonObject> {
    const sessionRunId = requiredSessionRunId(payload.session_run_id ?? payload.sessionRunId)
    const branchBindingId = requiredBranchBindingId(payload.branch_binding_id ?? payload.branchBindingId)
    return this.postPeerJson("/remote/session-runs/user-input/reply", (peer) => ({
      ...payload,
      peer_token: peer.peer_token,
      session_run_id: sessionRunId,
      branch_binding_id: branchBindingId,
    }))
  }

  async stopPeer(caller = "unknown"): Promise<void> {
    this.lastPeerStopCaller = caller
    this.peerStartupGeneration += 1
    this.peerStartupPromise = undefined
    this.updatePeerPreparation({
      phase: "idle",
      label: "未触发",
      detail: "peer 已停止；需要会话、环境依赖或本机工作区任务时会自动准备。",
      loadedBytes: undefined,
      totalBytes: undefined,
      progressPercent: undefined,
      peerId: undefined,
    })
    const peer = this.peerInfo
    const peerProcess = this.peerProcess
    const pid = peerProcess?.pid
    if (peerProcess) {
      this.peerStopCallers.set(peerProcess, caller)
    }
    await this.peerDiagnosticsLogger.log("lifecycle", "peer.stop.request", "Local peer stop requested.", {
      caller,
      peerId: peer?.peer_id,
      pid,
      hasPeerInfo: Boolean(peer),
      hasProcess: Boolean(this.peerProcess),
    })
    if (peer) {
      try {
        await this.postJson("/remote/disconnect", {
          peer_token: peer.peer_token,
          reason: "peer_shutdown",
        })
        await this.peerDiagnosticsLogger.log("lifecycle", "peer.stop.disconnect.ok", "Remote peer disconnect acknowledged.", {
          caller,
          peerId: peer.peer_id,
          pid,
        })
      } catch (error) {
        await this.peerDiagnosticsLogger.log("lifecycle", "peer.stop.disconnect.failed", "Remote peer disconnect failed.", {
          caller,
          peerId: peer.peer_id,
          pid,
          error: errorDiagnostics(error),
        }, "warn")
        // Ignore disconnect failures; killing the local peer process is still sufficient.
      }
    }
    if (this.peerProcess && this.peerProcess.exitCode === null) {
      await this.peerDiagnosticsLogger.log("lifecycle", "peer.stop.kill", "Killing local peer process.", {
        caller,
        peerId: peer?.peer_id,
        pid: this.peerProcess.pid,
      })
      this.peerProcess.kill()
    }
    this.peerProcess = undefined
    this.peerInfo = undefined
    await this.peerDiagnosticsLogger.log("lifecycle", "peer.stop.done", "Local peer stop completed.", {
      caller,
      peerId: peer?.peer_id,
      pid,
    })
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

  private async authenticatedPeerPost(
    pathname: string,
    payload: (peer: PeerInfo) => JsonObject
  ): Promise<JsonObject> {
    let peer = await this.ensurePeer()
    return retryInvalidPeerTokenOnce(
      () => this.authenticatedPost(pathname, payload(peer)),
      async () => {
        await this.stopPeer("invalid_peer_token_retry")
        peer = await this.ensurePeer()
      }
    )
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
      if (
        isRemoteError(error, "invalid_refresh_token", 401) ||
        isRemoteError(error, "unauthorized", 401)
      ) {
        await this.clearAuthSession()
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
    patch: Omit<Partial<ConnectionState>, "hostUrl" | "hostUrlConfigured" | "hostUrlSource" | "peerConnected" | "peerId" | "peerPreparation">
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
      peerPreparation: this.peerPreparationSnapshot(),
      status: "login-required",
      ...patch,
    }
  }

  private peerPreparationSnapshot(): PeerPreparationState {
    if (this.isPeerRunning()) {
      return {
        phase: "connected",
        label: "已就绪",
        detail: "peer 已连接，可以处理依赖它的本机工作区请求。",
        peerId: this.peerInfo?.peer_id,
        progressPercent: 100,
        updatedAt: new Date().toISOString(),
      }
    }
    return { ...this.peerPreparation }
  }

  private updatePeerPreparation(
    patch: Omit<Partial<PeerPreparationState>, "updatedAt">
  ): PeerPreparationState {
    const next: PeerPreparationState = {
      ...this.peerPreparation,
      ...patch,
      updatedAt: new Date().toISOString(),
    }
    if (
      next.phase === this.peerPreparation.phase &&
      next.label === this.peerPreparation.label &&
      next.detail === this.peerPreparation.detail &&
      next.loadedBytes === this.peerPreparation.loadedBytes &&
      next.totalBytes === this.peerPreparation.totalBytes &&
      next.progressPercent === this.peerPreparation.progressPercent &&
      next.peerId === this.peerPreparation.peerId
    ) {
      return this.peerPreparation
    }
    this.peerPreparation = next
    this.peerPreparationListener?.({ ...next })
    return next
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
        await this.stopPeer("invalid_peer_token_retry")
        peer = await this.ensurePeer()
      }
    )
  }

  private async openSessionRunEventStream(
    peer: PeerInfo,
    sessionRunId: string,
    cursor: number,
    branchBindingId: string,
    onBatch: SessionRunEventsHandler,
    options: SessionRunEventsOptions
  ): Promise<void> {
    const streamBranchBindingId = requiredBranchBindingId(branchBindingId)
    const pathname = "/remote/session-runs/events"
    const startedAt = Date.now()
    let status: number | undefined
    try {
      const response = await fetchStreaming(this.hostUrl + pathname, {
        method: "POST",
        headers: {
          "Accept": "text/event-stream",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          peer_token: peer.peer_token,
          session_run_id: sessionRunId,
          branch_binding_id: streamBranchBindingId,
          cursor,
          timeout_sec: options.timeoutSec ?? SESSION_RUN_EVENTS_TIMEOUT_SEC,
        }),
        signal: options.signal,
      })
      status = response.status
      if (!response.ok) {
        await parseJsonResponse(response)
        return
      }
      if (!response.body) {
        throw new RemoteTransportError(
          "Session run event stream response did not include a readable body.",
          "transient_network"
        )
      }
      let completed = false
      await readSseStream(response.body, async (frame) => {
        if (frame.event !== "session_run" && frame.event !== "message" && frame.event !== "done") {
          return
        }
        const batch = parseSseJson(frame.data)
        await onBatch(batch)
        if (batch.done === true || frame.event === "done") {
          completed = true
        }
      })
      if (!completed) {
        throw new RemoteTransportError(
          "Session run event stream closed before the done frame.",
          "transient_network"
        )
      }
      await this.peerDiagnosticsLogger.log("http", "http.sse.ok", "Extension SSE stream completed.", {
        method: "POST",
        pathname: diagnosticPathname(pathname),
        status,
        durationMs: Date.now() - startedAt,
      })
    } catch (error) {
      await this.peerDiagnosticsLogger.log("http", "http.sse.error", "Extension SSE stream failed.", {
        method: "POST",
        pathname: diagnosticPathname(pathname),
        status: remoteStatus(error, status),
        durationMs: Date.now() - startedAt,
        error: errorDiagnostics(error),
      }, "warn")
      if (error instanceof RemoteError || error instanceof RemoteTransportError) {
        throw error
      }
      if (classifyRemoteError(error) === "transient_network") {
        throw new RemoteTransportError(errorMessage(error), "transient_network", error)
      }
      throw error
    }
  }

  private async openSessionRunEventsBatch(
    peer: PeerInfo,
    sessionRunId: string,
    cursor: number,
    branchBindingId: string,
    options: SessionRunEventsBatchOptions
  ): Promise<JsonObject> {
    const batchBranchBindingId = requiredBranchBindingId(branchBindingId)
    const pathname = "/remote/session-runs/events"
    const abortController = new AbortController()
    const abortFromParent = () => abortController.abort()
    if (options.signal?.aborted) {
      abortController.abort()
    } else {
      options.signal?.addEventListener("abort", abortFromParent, { once: true })
    }
    const timer = setTimeout(
      () => abortController.abort(),
      Math.max(1, options.timeoutMs ?? 2_000)
    )
    let firstBatch: JsonObject | undefined
    try {
      const response = await fetchStreaming(this.hostUrl + pathname, {
        method: "POST",
        headers: {
          "Accept": "text/event-stream",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          peer_token: peer.peer_token,
          session_run_id: sessionRunId,
          branch_binding_id: batchBranchBindingId,
          cursor,
          timeout_sec: options.timeoutSec ?? 1,
        }),
        signal: abortController.signal,
      })
      if (!response.ok) {
        await parseJsonResponse(response)
        return {}
      }
      if (!response.body) {
        throw new RemoteTransportError(
          "Session run event stream response did not include a readable body.",
          "transient_network"
        )
      }
      await readSseStream(response.body, async (frame) => {
        if (frame.event !== "session_run" && frame.event !== "message" && frame.event !== "done") {
          return
        }
        firstBatch = parseSseJson(frame.data)
        abortController.abort()
      })
      return firstBatch || {}
    } catch (error) {
      if (firstBatch || abortController.signal.aborted) {
        return firstBatch || {}
      }
      throw error
    } finally {
      clearTimeout(timer)
      options.signal?.removeEventListener("abort", abortFromParent)
    }
  }

  private async getPeerJson(pathname: string): Promise<JsonObject> {
    let peer = await this.ensurePeer()
    const separator = pathname.includes("?") ? "&" : "?"
    return retryInvalidPeerTokenOnce(
      () => this.getJson(`${pathname}${separator}peer_token=${encodeURIComponent(peer.peer_token)}`),
      async () => {
        await this.stopPeer("invalid_peer_token_retry")
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
      this.updatePeerPreparation({
        phase: "connected",
        label: "已就绪",
        detail: "peer 已连接，可以处理依赖它的本机工作区请求。",
        loadedBytes: undefined,
        totalBytes: undefined,
        progressPercent: 100,
        peerId: this.peerInfo.peer_id,
      })
      return this.peerInfo
    }
    if (this.peerStartupPromise) {
      return this.peerStartupPromise
    }

    const generation = this.peerStartupGeneration
    const startup = this.startPeerWithRetries(generation)
    this.peerStartupPromise = startup
    try {
      return await startup
    } catch (error) {
      this.updatePeerPreparation({
        phase: "error",
        label: "准备失败",
        detail: errorMessage(error),
        loadedBytes: undefined,
        totalBytes: undefined,
        progressPercent: undefined,
        peerId: undefined,
      })
      throw error
    } finally {
      if (this.peerStartupPromise === startup) {
        this.peerStartupPromise = undefined
      }
    }
  }

  private async startPeerWithRetries(generation: number): Promise<PeerInfo> {
    let lastError: unknown
    for (let attempt = 1; attempt <= PEER_STARTUP_MAX_ATTEMPTS; attempt += 1) {
      try {
        return await this.startPeer(generation)
      } catch (error) {
        lastError = error
        if (
          this.peerStartupGeneration !== generation ||
          attempt >= PEER_STARTUP_MAX_ATTEMPTS ||
          !isRetryablePeerStartupError(error)
        ) {
          throw error
        }
        const nextAttempt = attempt + 1
        this.updatePeerPreparation({
          phase: "starting",
          label: "正在重试",
          detail: `peer 注册暂时失败，正在自动重试（${nextAttempt}/${PEER_STARTUP_MAX_ATTEMPTS}）。`,
          loadedBytes: undefined,
          totalBytes: undefined,
          progressPercent: undefined,
          peerId: undefined,
        })
        await this.peerDiagnosticsLogger.log("lifecycle", "peer.start.retry", "Retrying local peer startup after a transient registration failure.", {
          attempt,
          nextAttempt,
          maxAttempts: PEER_STARTUP_MAX_ATTEMPTS,
          error: errorDiagnostics(error),
        }, "warn")
        await delay(
          PEER_STARTUP_RETRY_DELAYS_MS[attempt - 1] ??
          PEER_STARTUP_RETRY_DELAYS_MS[PEER_STARTUP_RETRY_DELAYS_MS.length - 1] ??
          1500
        )
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError))
  }

  private async startPeer(generation: number): Promise<PeerInfo> {
    await fs.mkdir(this.context.globalStorageUri.fsPath, { recursive: true })
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd()
    this.updatePeerPreparation({
      phase: "checking",
      label: "正在检查",
      detail: "正在获取 peer 启动令牌。",
      loadedBytes: undefined,
      totalBytes: undefined,
      progressPercent: undefined,
      peerId: undefined,
    })
    await this.peerDiagnosticsLogger.log("lifecycle", "peer.start.request", "Starting local peer process.", {
      host: this.hostUrl,
      workspaceRoot,
    })
    const bootstrap = await this.authenticatedPost("/remote/auth/bootstrap-token", {})
    const token = stringValue(bootstrap.bootstrap_token)
    if (!token) {
      throw new Error("Unable to obtain bootstrap token from host.")
    }
    if (this.peerStartupGeneration !== generation) {
      throw new Error("Peer startup was cancelled.")
    }
    this.updatePeerPreparation({
      phase: "checking",
      label: "正在检查",
      detail: "正在检查 peer 二进制。",
    })
    const binaryPath = await this.ensurePeerBinary()
    const peerInfoPath = path.join(this.context.globalStorageUri.fsPath, "peer-info.json")
    await fs.rm(peerInfoPath, { force: true })

    if (this.peerStartupGeneration !== generation) {
      throw new Error("Peer startup was cancelled.")
    }

    this.updatePeerPreparation({
      phase: "starting",
      label: "正在启动",
      detail: "正在启动 peer 并等待注册。",
      loadedBytes: undefined,
      totalBytes: undefined,
      progressPercent: undefined,
    })
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
    void this.peerDiagnosticsLogger.log("lifecycle", "peer.spawned", "Local peer process spawned.", {
      binaryPath,
      workspaceRoot,
      host: this.hostUrl,
      pid: peerProcess.pid,
      peerInfoPath,
    })
    const peerOutput: PeerStartupOutput = { stdout: [], stderr: [] }
    peerProcess.stdout.on("data", (chunk) => {
      const text = String(chunk)
      appendPeerOutput(peerOutput.stdout, text)
      void this.peerDiagnosticsLogger.log("processOutput", "peer.stdout", "Local peer stdout.", {
        pid: peerProcess.pid,
        text,
      })
      console.log(`[labrastro peer] ${text}`)
    })
    peerProcess.stderr.on("data", (chunk) => {
      const text = String(chunk)
      appendPeerOutput(peerOutput.stderr, text)
      void this.peerDiagnosticsLogger.log("processOutput", "peer.stderr", "Local peer stderr.", {
        pid: peerProcess.pid,
        text,
      }, "warn")
      console.warn(`[labrastro peer] ${text}`)
    })
    peerProcess.on("exit", (code, signal) => {
      const stopCaller = this.peerStopCallers.get(peerProcess)
      this.peerStopCallers.delete(peerProcess)
      void this.peerDiagnosticsLogger.log(
        "lifecycle",
        "peer.exit",
        "Local peer process exited.",
        {
          code,
          signal,
          pid: peerProcess.pid,
          peerId: this.peerInfo?.peer_id,
          stopCaller,
          recentStopCaller: this.lastPeerStopCaller,
          stoppedByPlugin: Boolean(stopCaller),
        },
        code === 0 ? "info" : "error"
      )
      if (this.peerProcess === peerProcess) {
        this.peerProcess = undefined
        this.peerInfo = undefined
        this.updatePeerPreparation({
          phase: stopCaller ? "idle" : "error",
          label: stopCaller ? "未触发" : "准备失败",
          detail: stopCaller ? "peer 已停止。" : "peer 进程已退出。",
          loadedBytes: undefined,
          totalBytes: undefined,
          progressPercent: undefined,
          peerId: undefined,
        })
      }
    })

    let peerInfo: PeerInfo
    try {
      peerInfo = await waitForPeerInfo(peerInfoPath, peerProcess, peerOutput)
    } catch (error) {
      await this.peerDiagnosticsLogger.log("lifecycle", "peer.start.failed", "Local peer failed before registration.", {
        binaryPath,
        workspaceRoot,
        host: this.hostUrl,
        pid: peerProcess.pid,
        exitCode: peerProcess.exitCode,
        signalCode: peerProcess.signalCode,
        error: errorDiagnostics(error),
      }, "error")
      if (this.peerProcess === peerProcess) {
        this.peerProcess = undefined
        this.peerInfo = undefined
      }
      if (!peerProcessExited(peerProcess)) {
        this.peerStopCallers.set(peerProcess, "startup_failure")
        peerProcess.kill()
      }
      throw error
    }
    if (this.peerStartupGeneration !== generation) {
      if (peerProcess.exitCode === null) {
        peerProcess.kill()
      }
      throw new Error("Peer startup was cancelled.")
    }
    this.peerInfo = peerInfo
    this.updatePeerPreparation({
      phase: "connected",
      label: "已就绪",
      detail: "peer 已连接，可以处理依赖它的本机工作区请求。",
      loadedBytes: undefined,
      totalBytes: undefined,
      progressPercent: 100,
      peerId: peerInfo.peer_id,
    })
    await this.peerDiagnosticsLogger.log("lifecycle", "peer.registered", "Local peer registered with host.", {
      peerId: peerInfo.peer_id,
      heartbeatIntervalMs: peerInfo.heartbeat_interval_ms,
      pid: peerProcess.pid,
    })
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
    let existingEtag: string | undefined
    let hasExistingBinary = false
    this.updatePeerPreparation({
      phase: "checking",
      label: "正在检查",
      detail: `正在检查 peer 二进制缓存（${platform.os}/${platform.arch}）。`,
      loadedBytes: undefined,
      totalBytes: undefined,
      progressPercent: undefined,
    })
    try {
      await fs.mkdir(path.dirname(binaryPath), { recursive: true })
      if (await isUsableFile(binaryPath)) {
        existingEtag = await fileStrongEtag(binaryPath)
        hasExistingBinary = true
      } else {
        await removeEmptyFile(binaryPath)
      }
    } catch (error) {
      throw peerBinaryAccessError(error, binaryPath)
    }

    this.updatePeerPreparation({
      phase: "downloading",
      label: "正在下载",
      detail: hasExistingBinary ? "正在校验 peer 二进制版本。" : "正在下载 peer 二进制。",
      loadedBytes: 0,
      totalBytes: undefined,
      progressPercent: undefined,
    })
    const artifact = await this.requestArtifactBuffer(artifactPath, existingEtag, (progress) => {
      this.updatePeerPreparation({
        phase: "downloading",
        label: "正在下载",
        detail: hasExistingBinary ? "正在校验 peer 二进制版本。" : "正在下载 peer 二进制。",
        loadedBytes: progress.loadedBytes,
        totalBytes: progress.totalBytes,
        progressPercent: progress.progressPercent,
      })
    })
    if (artifact.notModified) {
      try {
        if (await isUsableFile(binaryPath)) {
          await this.ensurePeerBinaryExecutable(binaryPath)
          this.updatePeerPreparation({
            phase: "starting",
            label: "正在启动",
            detail: "peer 二进制缓存可用，准备启动。",
            loadedBytes: undefined,
            totalBytes: undefined,
            progressPercent: 100,
          })
          return binaryPath
        }
      } catch (error) {
        throw peerBinaryAccessError(error, binaryPath)
      }
    }

    const content = artifact.notModified
      ? (await this.requestArtifactBuffer(artifactPath, undefined, (progress) => {
          this.updatePeerPreparation({
            phase: "downloading",
            label: "正在下载",
            detail: "正在重新下载 peer 二进制。",
            loadedBytes: progress.loadedBytes,
            totalBytes: progress.totalBytes,
            progressPercent: progress.progressPercent,
          })
        })).content
      : artifact.content
    if (!content) {
      throw new Error("Peer artifact response did not include binary content.")
    }
    if (hasExistingBinary && existingEtag && bufferStrongEtag(content) === existingEtag) {
      try {
        await this.ensurePeerBinaryExecutable(binaryPath)
        this.updatePeerPreparation({
          phase: "starting",
          label: "正在启动",
          detail: "peer 二进制已是最新，准备启动。",
          loadedBytes: undefined,
          totalBytes: undefined,
          progressPercent: 100,
        })
        return binaryPath
      } catch (error) {
        throw peerBinaryAccessError(error, binaryPath)
      }
    }
    try {
      this.updatePeerPreparation({
        phase: "installing",
        label: "正在安装",
        detail: "正在写入 peer 二进制。",
        loadedBytes: content.byteLength,
        totalBytes: content.byteLength,
        progressPercent: 100,
      })
      return await this.installPeerBinary(binaryPath, content, hasExistingBinary)
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
    const startedAt = Date.now()
    let status: number | undefined
    try {
      const response = await fetchWithTimeout(this.hostUrl + pathname, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...headers,
        },
        body: JSON.stringify(payload),
      }, options.timeoutMs)
      status = response.status
      const body = await parseJsonResponse(response)
      await this.peerDiagnosticsLogger.log("http", "http.post.ok", "Extension HTTP request completed.", {
        method: "POST",
        pathname: diagnosticPathname(pathname),
        status,
        durationMs: Date.now() - startedAt,
      })
      return body
    } catch (error) {
      await this.peerDiagnosticsLogger.log("http", "http.post.error", "Extension HTTP request failed.", {
        method: "POST",
        pathname: diagnosticPathname(pathname),
        status: remoteStatus(error, status),
        durationMs: Date.now() - startedAt,
        error: errorDiagnostics(error),
      }, "warn")
      throw error
    }
  }

  private async getJson(pathname: string, headers: Record<string, string> = {}): Promise<JsonObject> {
    const startedAt = Date.now()
    let status: number | undefined
    try {
      const response = await fetchWithTimeout(this.hostUrl + pathname, { headers })
      status = response.status
      const body = await parseJsonResponse(response)
      await this.peerDiagnosticsLogger.log("http", "http.get.ok", "Extension HTTP request completed.", {
        method: "GET",
        pathname: diagnosticPathname(pathname),
        status,
        durationMs: Date.now() - startedAt,
      })
      return body
    } catch (error) {
      await this.peerDiagnosticsLogger.log("http", "http.get.error", "Extension HTTP request failed.", {
        method: "GET",
        pathname: diagnosticPathname(pathname),
        status: remoteStatus(error, status),
        durationMs: Date.now() - startedAt,
        error: errorDiagnostics(error),
      }, "warn")
      throw error
    }
  }

  private async requestArtifactBuffer(
    pathname: string,
    ifNoneMatch?: string,
    onProgress?: (progress: { loadedBytes: number; totalBytes?: number; progressPercent?: number }) => void
  ): Promise<{ content?: Buffer; notModified: boolean }> {
    const startedAt = Date.now()
    let status: number | undefined
    const headers = ifNoneMatch ? { "If-None-Match": ifNoneMatch } : undefined
    try {
      const response = await fetchWithTimeout(this.hostUrl + pathname, headers ? { headers } : {})
      status = response.status
      if (status === 304) {
        await this.peerDiagnosticsLogger.log("http", "http.get.buffer.not_modified", "Extension HTTP artifact cache hit.", {
          method: "GET",
          pathname: diagnosticPathname(pathname),
          status,
          durationMs: Date.now() - startedAt,
          bytes: 0,
          etagSent: Boolean(ifNoneMatch),
          etagMatched: true,
        })
        return { notModified: true }
      }
      if (!response.ok) {
        throw new Error(`${response.status} ${await response.text()}`)
      }
      const totalBytes = responseContentLength(response)
      const buffer = await responseBufferWithProgress(response, totalBytes, onProgress)
      await this.peerDiagnosticsLogger.log("http", "http.get.buffer.ok", "Extension HTTP request completed.", {
        method: "GET",
        pathname: diagnosticPathname(pathname),
        status,
        durationMs: Date.now() - startedAt,
        bytes: buffer.byteLength,
        etagSent: Boolean(ifNoneMatch),
        etagMatched: false,
      })
      return { content: buffer, notModified: false }
    } catch (error) {
      await this.peerDiagnosticsLogger.log("http", "http.get.buffer.error", "Extension HTTP request failed.", {
        method: "GET",
        pathname: diagnosticPathname(pathname),
        status: remoteStatus(error, status),
        durationMs: Date.now() - startedAt,
        etagSent: Boolean(ifNoneMatch),
        error: errorDiagnostics(error),
      }, "warn")
      throw error
    }
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

async function fetchStreaming(input: string, init: RequestInit = {}): Promise<Response> {
  try {
    return await fetch(input, init)
  } catch (error) {
    if (classifyRemoteError(error) === "transient_network") {
      throw new RemoteTransportError(errorMessage(error), "transient_network", error)
    }
    throw error
  }
}

interface SseFrame {
  event: string
  data: string
}

async function readSseStream(
  body: NonNullable<Response["body"]>,
  onFrame: (frame: SseFrame) => void | Promise<void>
): Promise<void> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      buffer = normalizeSseNewlines(buffer)
      let frameEnd = buffer.indexOf("\n\n")
      while (frameEnd >= 0) {
        const rawFrame = buffer.slice(0, frameEnd)
        buffer = buffer.slice(frameEnd + 2)
        const frame = parseSseFrame(rawFrame)
        if (frame) {
          await onFrame(frame)
        }
        frameEnd = buffer.indexOf("\n\n")
      }
    }
    buffer += decoder.decode()
  } finally {
    reader.releaseLock()
  }
}

function normalizeSseNewlines(value: string): string {
  return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n")
}

function parseSseFrame(rawFrame: string): SseFrame | undefined {
  let event = "message"
  const dataLines: string[] = []
  for (const rawLine of rawFrame.split("\n")) {
    if (!rawLine || rawLine.startsWith(":")) continue
    const separator = rawLine.indexOf(":")
    if (separator < 0) continue
    const field = rawLine.slice(0, separator)
    let value = rawLine.slice(separator + 1)
    if (value.startsWith(" ")) {
      value = value.slice(1)
    }
    if (field === "event") {
      event = value
    } else if (field === "data") {
      dataLines.push(value)
    }
  }
  if (!dataLines.length) return undefined
  return { event, data: dataLines.join("\n") }
}

function parseSseJson(data: string): JsonObject {
  try {
    const parsed = JSON.parse(data)
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as JsonObject
    }
  } catch (error) {
    throw new RemoteTransportError(errorMessage(error), "fatal_session_run", error)
  }
  throw new RemoteTransportError("Session run event stream data must be a JSON object.", "fatal_session_run")
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
    const message = detail || code || `HTTP ${response.status}`
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
    sessionRuns: features.session_runs === true,
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

function requiredBranchBindingId(value: unknown): string {
  const branchBindingId = stringValue(value).trim()
  if (!branchBindingId) {
    throw new Error("branch_binding_id_required")
  }
  return branchBindingId
}

function requiredSessionRunId(value: unknown): string {
  const sessionRunId = stringValue(value).trim()
  if (!sessionRunId) {
    throw new Error("session_run_id_required")
  }
  return sessionRunId
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

function diagnosticPathname(pathname: string): string {
  try {
    return new URL(pathname, DEFAULT_HOST_URL).pathname
  } catch {
    return pathname.split("?")[0] || pathname
  }
}

function remoteStatus(error: unknown, fallback?: number): number | undefined {
  return isRemoteError(error) ? error.status : fallback
}

function errorDiagnostics(error: unknown): JsonObject {
  if (isRemoteError(error)) {
    const body = error.body && typeof error.body === "object" && !Array.isArray(error.body)
      ? error.body as JsonObject
      : {}
    const bodyMessage = typeof body.message === "string" ? body.message : undefined
    return {
      status: error.status,
      code: error.code,
      message: error.message,
      bodyMessage,
    }
  }
  return {
    code: errorCode(error) || undefined,
    message: errorMessage(error),
  }
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

function idlePeerPreparationState(): PeerPreparationState {
  return {
    phase: "idle",
    label: "未触发",
    detail: "需要会话、环境依赖或本机工作区任务时会自动准备。",
    updatedAt: new Date().toISOString(),
  }
}

function responseContentLength(response: Response): number | undefined {
  const value = response.headers.get("content-length")
  if (!value) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}

async function responseBufferWithProgress(
  response: Response,
  totalBytes: number | undefined,
  onProgress?: (progress: { loadedBytes: number; totalBytes?: number; progressPercent?: number }) => void
): Promise<Buffer> {
  const progress = (loadedBytes: number, force = false) => {
    if (!onProgress) return
    const progressPercent = totalBytes ? Math.round((loadedBytes / totalBytes) * 100) : undefined
    if (!force && progressPercent === undefined) return
    onProgress({ loadedBytes, totalBytes, progressPercent })
  }
  if (!response.body) {
    const buffer = Buffer.from(await response.arrayBuffer())
    progress(buffer.byteLength, true)
    return buffer
  }

  const reader = response.body.getReader()
  const chunks: Buffer[] = []
  let loadedBytes = 0
  let lastProgressPercent = -1
  let lastProgressAt = 0
  progress(0, true)
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (!value) continue
    const chunk = Buffer.from(value)
    chunks.push(chunk)
    loadedBytes += chunk.byteLength
    const progressPercent = totalBytes ? Math.round((loadedBytes / totalBytes) * 100) : undefined
    const now = Date.now()
    if (
      progressPercent !== lastProgressPercent ||
      now - lastProgressAt > 250
    ) {
      onProgress?.({ loadedBytes, totalBytes, progressPercent })
      lastProgressPercent = progressPercent ?? lastProgressPercent
      lastProgressAt = now
    }
  }
  progress(loadedBytes, true)
  return Buffer.concat(chunks)
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

async function fileStrongEtag(filePath: string): Promise<string> {
  const content = await fs.readFile(filePath)
  return bufferStrongEtag(content)
}

function bufferStrongEtag(content: Buffer): string {
  return `"sha256-${createHash("sha256").update(content).digest("hex")}"`
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
  const deadline = Date.now() + PEER_INFO_WAIT_TIMEOUT_MS
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
      throw peerStartupFailure(peerProcess, output, lastError, false)
    }
    await delay(PEER_INFO_POLL_INTERVAL_MS)
  }
  throw peerStartupFailure(peerProcess, output, lastError, true)
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

function peerStartupFailure(
  peerProcess: ChildProcessWithoutNullStreams,
  output: PeerStartupOutput,
  lastError: unknown,
  timedOut: boolean
): PeerStartupError {
  return new PeerStartupError(
    peerStartupFailureMessage(peerProcess, output, timedOut),
    isRetryablePeerStartupFailure(output, lastError, timedOut)
  )
}

function peerStartupFailureMessage(
  peerProcess: ChildProcessWithoutNullStreams,
  output: PeerStartupOutput,
  timedOut: boolean
): string {
  const hasPeerOutput = output.stderr.length > 0 || output.stdout.length > 0
  if (!hasPeerOutput) {
    return timedOut
      ? "peer 注册超时：未能在限定时间内完成注册，系统会自动重试。"
      : "peer 注册失败：peer 进程退出但未完成注册。"
  }
  const reason = timedOut
    ? "Peer did not report registration info in time"
    : `Peer exited before reporting registration info (exit=${peerProcess.exitCode ?? "null"}, signal=${peerProcess.signalCode ?? "null"})`
  const details = [
    peerOutputDetail("stderr", output.stderr),
    peerOutputDetail("stdout", output.stdout),
  ].filter(Boolean)
  return `${reason}. ${details.join(" ")}`
}

function peerOutputDetail(label: string, chunks: string[]): string {
  const text = chunks.join("").trim()
  return text ? `${label}: ${text}` : ""
}

function isRetryablePeerStartupError(error: unknown): boolean {
  if (error instanceof PeerStartupError) {
    return error.retryable
  }
  if (classifyRemoteError(error) === "transient_network") {
    return true
  }
  return isRetryablePeerStartupText(errorMessage(error))
}

function isRetryablePeerStartupFailure(
  output: PeerStartupOutput,
  lastError: unknown,
  timedOut: boolean
): boolean {
  if (timedOut) return true
  const outputText = `${output.stderr.join("")}\n${output.stdout.join("")}`
  if (outputText.trim()) {
    return isRetryablePeerStartupText(outputText)
  }
  const code = errorCode(lastError)
  return !code || code === "ENOENT"
}

function isRetryablePeerStartupText(text: string): boolean {
  const lower = text.toLowerCase()
  return PEER_STARTUP_RETRYABLE_FRAGMENTS.some((fragment) => lower.includes(fragment))
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
