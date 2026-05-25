import type * as vscode from "vscode"
import type {
  BackendFeatures,
  LabrastroRemoteClient,
} from "../LabrastroRemoteClient"
import type { PostMessage } from "../WebviewBus"
import type { WebviewToHostMessage } from "../protocol/messages"
import { classifyRemoteError, isRemoteError } from "../remote-errors"

type SessionSyncStatus = "synced" | "pending" | "failed"
type SessionListStatus = "idle" | "loading" | "unauthenticated" | "unavailable" | "empty" | "ready" | "error"

interface SessionRefreshResult {
  fingerprint?: string
  status: SessionListStatus
  message?: string
  error?: unknown
}

interface SessionMetadataState {
  id: string
  model: string
  savedAt: string
  preview: string
  fingerprint: string
  kind?: "main" | "fork" | "delegated_run"
  parentSessionId?: string
  sourceSessionId?: string
  sourceNodeId?: string
  returnNodeId?: string
  summary?: string
  syncStatus?: SessionSyncStatus
  syncError?: string
  source?: "server" | "local" | "merged"
  runState?: string
}

export interface PrepareChatSessionOptions {
  mode?: string
  workflowMode?: string
  draftSessionId?: string
  providerId?: string
  modelId?: string
  parameters?: Record<string, unknown>
}

export interface SessionCoordinatorOptions {
  client: LabrastroRemoteClient
  context: vscode.ExtensionContext
  emitSessionMessage: (payload: Record<string, unknown>, fallbackPost?: PostMessage) => void
  refreshBackendFeatures: (post?: PostMessage) => Promise<void>
  ensureBackendFeatures: () => Promise<BackendFeatures | null>
  getBackendFeatures: () => BackendFeatures | null | undefined
  isChatActive: () => boolean
  postConnectionStateIfAuthRequired: (error: unknown, post: PostMessage) => Promise<void>
}

const EMPTY_TRACE_UI = {
  activeNodeId: null,
  selectedNodeId: null,
  focusedBranchId: "main",
  showInspector: false,
  showMiniMap: false,
  viewMode: "compact",
}

const EMPTY_STATS = {
  taskText: "",
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
}

export class SessionCoordinator {
  private currentSessionId: string | undefined
  private sessionApiAvailable: boolean | undefined
  private sessionFingerprint: string | undefined
  private sessionListEtag: string | undefined
  private sessionInitialization: Promise<void> | undefined
  private sessionInitializationToken = 0
  private readonly sessionRefreshes = new Map<string, Promise<SessionRefreshResult>>()
  private sessions: SessionMetadataState[] = []

  constructor(private readonly options: SessionCoordinatorOptions) {}

  get currentId(): string | undefined {
    return this.currentSessionId
  }

  get list(): SessionMetadataState[] {
    return this.sessions
  }

  get fingerprint(): string | undefined {
    return this.sessionFingerprint
  }

  invalidatePendingInitialization(): void {
    if (this.sessionInitialization) {
      this.sessionInitializationToken += 1
    }
  }

  dispose(): void {}

  async handleMessage(message: WebviewToHostMessage, post: PostMessage): Promise<boolean> {
    switch (message.type) {
      case "session.initialize":
        await this.initializeSessionState(post)
        return true
      case "session.list":
        await this.postSessionList(post)
        return true
      case "session.load":
        await this.loadSession(stringValue(message.sessionId) || "", post)
        return true
      case "session.openInChat": {
        const sessionId = stringValue(message.sessionId) || ""
        if (!sessionId) {
          post({ type: "session.error", message: "缺少会话 ID。" })
          return true
        }
        await this.loadSession(sessionId, post)
        post({ type: "navigate", view: "chat" })
        return true
      }
      case "session.new":
        await this.createSession(post)
        return true
      case "session.fork":
        await this.forkSession({
          sourceSessionId: stringValue(message.sourceSessionId) || stringValue(message.source_session_id) || "",
          keepThroughMessageIndex:
            numberValue(message.keepThroughMessageIndex) ??
            numberValue(message.keep_through_message_index) ??
            -1,
          composeText: stringValue(message.composeText) || stringValue(message.compose_text),
          composeMode: stringValue(message.composeMode) || stringValue(message.compose_mode),
          sourceLabel: stringValue(message.sourceLabel) || stringValue(message.source_label),
          sourceMessageId: stringValue(message.sourceMessageId) || stringValue(message.source_message_id),
          sourceNodeId: stringValue(message.sourceNodeId) || stringValue(message.source_node_id),
          sessionTitle: stringValue(message.sessionTitle) || stringValue(message.session_title),
          sessionSummary: stringValue(message.sessionSummary) || stringValue(message.session_summary),
          sessionKind: stringValue(message.sessionKind) || stringValue(message.session_kind),
        }, post)
        return true
      case "session.delete":
        await this.deleteSession(stringValue(message.sessionId) || "", post)
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
      default:
        return false
    }
  }

  async postSessionSyncStatus(post?: PostMessage): Promise<void> {
    this.options.emitSessionMessage({
      type: "session.syncStatus",
      payload: {
        disabled: false,
        pending: 0,
        failed: 0,
        records: [],
      },
    }, post)
  }

  private sessionListMessage(
    status: SessionListStatus,
    options: {
      message?: string
      fingerprint?: string
      sessions?: SessionMetadataState[]
    } = {}
  ): Record<string, unknown> {
    const sessions = status === "ready" || status === "empty"
      ? options.sessions ?? this.sessions
      : options.sessions ?? []
    return {
      type: "session.list",
      status,
      message: options.message || sessionListStatusMessage(status),
      sessions,
      fingerprint: options.fingerprint || this.sessionFingerprint,
    }
  }

  private clearSessionList(): void {
    this.sessionFingerprint = undefined
    this.sessionListEtag = undefined
    this.sessions = []
  }

  private markSessionsUnavailable(): void {
    this.sessionApiAvailable = false
    this.clearSessionList()
  }

  async initializeSessionState(post: PostMessage): Promise<void> {
    if (this.sessionInitialization) {
      await this.sessionInitialization
      await this.postInitializedSessionState(post)
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

  private async postInitializedSessionState(
    post: PostMessage,
    options: {
      targetSessionId?: string
      status?: SessionListStatus
      message?: string
      fingerprint?: string
      reason?: "initial" | "explicit"
      isStale?: () => boolean
    } = {}
  ): Promise<void> {
    const targetSessionId = options.targetSessionId || this.currentSessionId
    if (targetSessionId) {
      await this.loadSession(targetSessionId, post, {
        suppressListRefresh: true,
        reason: options.reason || "initial",
        isStale: options.isStale,
      })
      return
    }

    this.options.emitSessionMessage(this.sessionListMessage(
      options.status || (this.sessions.length ? "ready" : "empty"),
      {
        message: options.message,
        fingerprint: options.fingerprint || this.sessionFingerprint,
      }
    ), post)
    await this.postSessionSyncStatus(post)
  }

  async refreshSessions(limit = 20): Promise<SessionRefreshResult> {
    const refreshKey = String(limit)
    const existingRefresh = this.sessionRefreshes.get(refreshKey)
    if (existingRefresh) return existingRefresh
    const refresh = this.refreshSessionsCore(limit)
    this.sessionRefreshes.set(refreshKey, refresh)
    try {
      return await refresh
    } finally {
      if (this.sessionRefreshes.get(refreshKey) === refresh) {
        this.sessionRefreshes.delete(refreshKey)
      }
    }
  }

  private async refreshSessionsCore(limit = 20): Promise<SessionRefreshResult> {
    if (this.sessionApiAvailable === false) {
      const knownFeatures = this.options.getBackendFeatures()
      if (knownFeatures?.sessions === true) {
        this.sessionApiAvailable = undefined
      } else {
        return {
          fingerprint: this.sessionFingerprint,
          status: "unavailable",
          message: "当前后端不支持会话历史。",
        }
      }
    }
    const features = this.options.getBackendFeatures() ?? await this.options.ensureBackendFeatures()
    if (features && features.sessions !== true) {
      this.markSessionsUnavailable()
      return {
        status: "unavailable",
        message: "当前后端不支持会话历史。",
      }
    }
    try {
      let payload = await this.options.client.listSessions(limit, this.sessionListEtag)
      this.sessionApiAvailable = true
      const previousFingerprint = this.sessionFingerprint
      const nextFingerprint = stringValue(payload.fingerprint) || this.sessionFingerprint
      const fingerprintChanged = Boolean(
        previousFingerprint &&
        nextFingerprint &&
        previousFingerprint !== nextFingerprint
      )
      if (fingerprintChanged && payload.sessions_unchanged === true) {
        this.sessionListEtag = undefined
        payload = await this.options.client.listSessions(limit)
      }
      this.sessionFingerprint = stringValue(payload.fingerprint) || this.sessionFingerprint
      this.sessionListEtag = stringValue(payload.list_etag) || this.sessionListEtag
      if (payload.sessions_unchanged !== true) {
        this.sessions = normalizeSessionMetadataList(payload.sessions)
      }
    } catch (error) {
      if (isSessionApiUnavailable(error)) {
        this.markSessionsUnavailable()
        return {
          status: "unavailable",
          message: "当前后端不支持会话历史。",
        }
      }
      if (isSessionAuthError(error)) {
        this.clearSessionList()
        return {
          status: "unauthenticated",
          message: "未登录，无法加载会话历史。",
          error,
        }
      }
      return {
        fingerprint: this.sessionFingerprint,
        status: "error",
        message: sessionListErrorMessage(error),
      }
    }
    return {
      fingerprint: this.sessionFingerprint,
      status: this.sessions.length ? "ready" : "empty",
      message: this.sessions.length ? "" : "当前没有可恢复的历史会话。",
    }
  }

  async postSessionList(post: PostMessage): Promise<void> {
    try {
      this.options.emitSessionMessage(this.sessionListMessage("loading", {
        message: "正在加载会话历史。",
        sessions: [],
      }), post)
      const result = await this.refreshSessions(50)
      if (result.status === "unauthenticated") {
        await this.options.postConnectionStateIfAuthRequired(result.error, post)
      }
      this.options.emitSessionMessage(this.sessionListMessage(result.status, {
        message: result.message,
        fingerprint: result.fingerprint,
      }), post)
      await this.postSessionSyncStatus(post)
    } catch (error) {
      post({ type: "session.error", message: errorMessage(error) })
    }
  }

  async loadSession(
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
      const payload = await this.options.client.loadSession(sessionId)
      if (options.isStale?.()) return
      const metadata = normalizePayloadSessionMetadata(payload)
      const bundle = buildSessionBundle(payload, metadata)
      const record = sessionRecordFromPayload(payload)
      this.currentSessionId = metadata.id
      void this.options.context.workspaceState.update("labrastro.currentSessionId", metadata.id)
      if (!options.suppressListRefresh) {
        await this.refreshSessions()
      }
      this.options.emitSessionMessage({
        type: "session.loaded",
        sessionId: metadata.id,
        reason: options.reason,
        metadata,
        record,
        document: sessionDocumentFromPayload(payload),
        bundle,
        runtimeState: sessionRuntimeStateFromPayload(payload),
        sessions: this.sessions,
        fingerprint: this.sessionFingerprint,
      }, post)
    } catch (error) {
      post({ type: "session.error", message: errorMessage(error) })
    }
  }

  async createSession(
    post: PostMessage,
    options: { suppressListRefresh?: boolean; fingerprint?: string } = {}
  ): Promise<void> {
    try {
      const payload = await this.options.client.newSession()
      this.sessionApiAvailable = true
      const metadata = normalizePayloadSessionMetadata(payload)
      const bundle = buildSessionBundle(payload, metadata)
      const record = sessionRecordFromPayload(payload)
      this.currentSessionId = metadata.id
      void this.options.context.workspaceState.update("labrastro.currentSessionId", metadata.id)
      if (!options.suppressListRefresh) {
        await this.refreshSessions()
      }
      if (!this.sessionFingerprint) {
        this.sessionFingerprint = stringValue(payload.fingerprint) || options.fingerprint
      }
      this.options.emitSessionMessage({
        type: "session.created",
        sessionId: metadata.id,
        metadata,
        record,
        document: sessionDocumentFromPayload(payload),
        bundle,
        runtimeState: sessionRuntimeStateFromPayload(payload),
        sessions: this.sessions,
        fingerprint: this.sessionFingerprint,
      }, post)
    } catch (error) {
      if (isSessionApiUnavailable(error)) {
        this.sessionApiAvailable = false
        this.currentSessionId = undefined
        await this.options.context.workspaceState.update("labrastro.currentSessionId", undefined)
      }
      post({ type: "session.error", message: errorMessage(error) })
    }
  }

  async forkSession(
    request: {
      sourceSessionId: string
      keepThroughMessageIndex: number
      composeText?: string
      composeMode?: string
      sourceLabel?: string
      sourceMessageId?: string
      sourceNodeId?: string
      sessionTitle?: string
      sessionSummary?: string
      sessionKind?: string
    },
    post: PostMessage
  ): Promise<void> {
    const sourceSessionId = request.sourceSessionId.trim()
    if (!sourceSessionId) {
      post({ type: "session.error", message: "Fork 需要基于真实远端会话。" })
      return
    }
    try {
      const payload = await this.options.client.forkSession(
        sourceSessionId,
        request.keepThroughMessageIndex
      )
      this.sessionApiAvailable = true
      const metadata = normalizePayloadSessionMetadata(payload)
      const record = sessionRecordFromPayload(payload)
      if (metadata.id) {
        this.currentSessionId = metadata.id
        await this.options.context.workspaceState.update("labrastro.currentSessionId", metadata.id)
      }
      await this.refreshSessions()
      this.options.emitSessionMessage({
        type: "session.forked",
        sessionId: metadata.id,
        metadata,
        record,
        document: sessionDocumentFromPayload(payload),
        bundle: buildSessionBundle(payload, metadata),
        runtimeState: sessionRuntimeStateFromPayload(payload),
        sessions: this.sessions,
        fingerprint: this.sessionFingerprint || stringValue(payload.fingerprint),
        sourceSessionId,
        keepThroughMessageIndex: request.keepThroughMessageIndex,
        composeText: request.composeText,
        composeMode: request.composeMode,
        sourceLabel: request.sourceLabel,
        sourceMessageId: request.sourceMessageId,
        sourceNodeId: request.sourceNodeId,
        sessionTitle: request.sessionTitle,
        sessionSummary: request.sessionSummary,
        sessionKind: request.sessionKind,
      }, post)
    } catch (error) {
      if (isSessionApiUnavailable(error)) {
        this.sessionApiAvailable = false
      }
      post({ type: "session.error", message: errorMessage(error) })
    }
  }

  async deleteSession(sessionId: string, post: PostMessage): Promise<void> {
    if (!sessionId) {
      post({ type: "session.error", message: "Missing session id." })
      return
    }
    try {
      await this.options.client.deleteSession(sessionId)
      const deletedCurrent = this.currentSessionId === sessionId
      await this.refreshSessions()
      this.sessions = this.sessions.filter((session) => session.id !== sessionId)
      if (deletedCurrent) {
        this.currentSessionId = undefined
        await this.options.context.workspaceState.update("labrastro.currentSessionId", undefined)
      }
      this.options.emitSessionMessage({
        type: "session.deleted",
        sessionId,
        sessions: this.sessions,
        fingerprint: this.sessionFingerprint,
      }, post)
      const nextSessionId = deletedCurrent ? this.sessions[0]?.id : undefined
      if (nextSessionId) {
        await this.loadSession(nextSessionId, post, { suppressListRefresh: true })
      }
    } catch (error) {
      if (
        isRemoteError(error, "session_not_found", 404) ||
        isRemoteError(error, "session_fingerprint_mismatch", 403)
      ) {
        await this.refreshSessions()
        this.options.emitSessionMessage({
          type: "session.deleted",
          sessionId,
          sessions: this.sessions,
          fingerprint: this.sessionFingerprint,
        }, post)
        return
      }
      post({ type: "session.error", message: errorMessage(error) })
    }
  }

  async switchSessionMainModel(
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
    if (!sessionId) {
      post({ type: "session.model.error", message: "模型切换需要先绑定真实远端会话。", requestId })
      return
    }
    try {
      const payload = await this.options.client.switchSessionMainModel(sessionId, providerId, modelId, parameters)
      await this.applyModelSwitchPayload(payload, sessionId, providerId, modelId, requestId, post)
    } catch (error) {
      if (isSessionApiUnavailable(error)) {
        this.sessionApiAvailable = false
      }
      post({ type: "session.model.error", message: errorMessage(error), providerId, modelId, requestId })
    }
  }

  async prepareChatSession(
    requestedSessionId: string | undefined,
    post: PostMessage,
    options: PrepareChatSessionOptions
  ): Promise<{ ok: boolean; sessionId?: string }> {
    let sessionId = requestedSessionId?.trim() || undefined
    if (!sessionId) {
      this.invalidatePendingInitialization()
      try {
        const created = await this.options.client.newSession()
        this.sessionApiAvailable = true
        const metadata = normalizePayloadSessionMetadata(created)
        const record = sessionRecordFromPayload(created)
        sessionId = metadata.id
        this.currentSessionId = metadata.id
        await this.options.context.workspaceState.update("labrastro.currentSessionId", metadata.id)
        this.options.emitSessionMessage({
          type: "session.created",
          sessionId: metadata.id,
          metadata,
          record,
          document: sessionDocumentFromPayload(created),
          bundle: buildSessionBundle(created, metadata),
          runtimeState: sessionRuntimeStateFromPayload(created),
          sessions: this.sessions,
          fingerprint: this.sessionFingerprint || stringValue(created.fingerprint),
        }, post)
      } catch (error) {
        post({ type: "chat.error", message: errorMessage(error) })
        return { ok: false }
      }
    }

    const startupProviderId = stringValue(options.providerId) || ""
    const startupModelId = stringValue(options.modelId) || ""
    if (startupProviderId && startupModelId && sessionId) {
      const modelPayload = await this.options.client.switchSessionMainModel(
        sessionId,
        startupProviderId,
        startupModelId,
        objectValue(options.parameters)
      )
      const metadata = await this.applyModelSwitchPayload(
        modelPayload,
        sessionId,
        startupProviderId,
        startupModelId,
        "",
        post
      )
      sessionId = metadata.id || sessionId
    }
    return { ok: true, sessionId }
  }

  async adoptRemoteSession(
    remoteSessionId: string | undefined,
    sessionId: string | undefined,
    _draftSessionId: string | undefined,
    post: PostMessage
  ): Promise<string | undefined> {
    if (remoteSessionId && remoteSessionId !== this.currentSessionId) {
      this.options.emitSessionMessage({
        type: "session.adopted",
        sessionId: remoteSessionId,
      }, post)
    }
    this.currentSessionId = remoteSessionId || sessionId
    if (this.currentSessionId) {
      await this.options.context.workspaceState.update(
        "labrastro.currentSessionId",
        this.currentSessionId
      )
    }
    return this.currentSessionId
  }

  async reloadCurrentAfterChatDone(post: PostMessage): Promise<void> {
    const result = await this.refreshSessions()
    if (result.status === "unauthenticated") {
      await this.options.postConnectionStateIfAuthRequired(result.error, post)
    }
    this.options.emitSessionMessage(this.sessionListMessage(result.status, {
      message: result.message,
      fingerprint: result.fingerprint,
    }), post)
  }

  private async initializeSessionStateCore(post: PostMessage, token: number): Promise<void> {
    try {
      const listPayload = await this.refreshSessions(10)
      if (token !== this.sessionInitializationToken) return
      if (listPayload.status !== "ready" && listPayload.status !== "empty") {
        this.currentSessionId = undefined
        await this.options.context.workspaceState.update("labrastro.currentSessionId", undefined)
        if (listPayload.status === "unauthenticated") {
          await this.options.postConnectionStateIfAuthRequired(listPayload.error, post)
        }
        await this.postInitializedSessionState(post, {
          status: listPayload.status,
          message: listPayload.message,
          fingerprint: listPayload.fingerprint,
        })
        return
      }
      const storedSessionId = this.options.context.workspaceState.get<string>("labrastro.currentSessionId")
      const storedExists = Boolean(
        storedSessionId && this.sessions.some((session) => session.id === storedSessionId)
      )
      const targetSessionId = storedExists ? storedSessionId : this.sessions[0]?.id
      if (targetSessionId) {
        await this.postInitializedSessionState(post, {
          targetSessionId,
          reason: "initial",
          isStale: () => token !== this.sessionInitializationToken,
        })
        return
      }
      this.currentSessionId = undefined
      await this.options.context.workspaceState.update("labrastro.currentSessionId", undefined)
      await this.postInitializedSessionState(post, {
        status: listPayload.status,
        message: listPayload.message,
        fingerprint: listPayload.fingerprint || this.sessionFingerprint,
      })
    } catch (error) {
      post({ type: "session.error", message: errorMessage(error) })
    }
  }

  private async applyModelSwitchPayload(
    payload: Record<string, unknown>,
    fallbackSessionId: string,
    providerId: string,
    modelId: string,
    requestId: string,
    post: PostMessage
  ): Promise<SessionMetadataState> {
    this.sessionApiAvailable = true
    const metadata = normalizePayloadSessionMetadata(payload)
    const record = sessionRecordFromPayload(payload)
    if (metadata.id) {
      this.currentSessionId = metadata.id
      await this.options.context.workspaceState.update("labrastro.currentSessionId", metadata.id)
    }
    await this.refreshSessions()
    if (metadata.id) {
      this.options.emitSessionMessage({
        type: "session.state",
        sessionId: metadata.id,
        metadata,
        record,
        document: sessionDocumentFromPayload(payload),
        bundle: buildSessionBundle(payload, metadata),
        runtimeState: sessionRuntimeStateFromPayload(payload),
        sessions: this.sessions,
        fingerprint: this.sessionFingerprint || stringValue(payload.fingerprint),
      }, post)
    }
    post({
      type: "session.model.state",
      sessionId: metadata.id || fallbackSessionId,
      payload,
      runtimeState: sessionRuntimeStateFromPayload(payload),
      providerId,
      modelId,
      requestId,
    })
    return metadata
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isSessionApiUnavailable(error: unknown): boolean {
  return isRemoteError(error, "not_found", 404) || isRemoteError(error, "sessions_unavailable", 503)
}

function isSessionAuthError(error: unknown): boolean {
  return classifyRemoteError(error) === "auth_required" || isRemoteError(error, undefined, 403)
}

function sessionListErrorMessage(error: unknown): string {
  if (classifyRemoteError(error) === "transient_network") {
    return `会话历史加载失败：${errorMessage(error)}`
  }
  return `会话历史加载失败：${errorMessage(error)}`
}

function sessionListStatusMessage(status: SessionListStatus): string {
  if (status === "loading") return "正在加载会话历史。"
  if (status === "unauthenticated") return "未登录，无法加载会话历史。"
  if (status === "unavailable") return "当前后端不支持会话历史。"
  if (status === "empty") return "当前没有可恢复的历史会话。"
  if (status === "error") return "会话历史加载失败。"
  return ""
}

function normalizeSessionMetadata(value: unknown): SessionMetadataState {
  const payload = objectValue(value)
  return {
    id: stringValue(payload.id) || "",
    model: stringValue(payload.model) || "",
    savedAt: stringValue(payload.savedAt) || stringValue(payload.saved_at) || "",
    preview: stringValue(payload.preview) || "",
    fingerprint: stringValue(payload.fingerprint) || "",
    kind: normalizeSessionKind(payload.kind),
    parentSessionId: stringValue(payload.parentSessionId) || stringValue(payload.parent_session_id) || undefined,
    sourceSessionId: stringValue(payload.sourceSessionId) || stringValue(payload.source_session_id) || undefined,
    sourceNodeId: stringValue(payload.sourceNodeId) || stringValue(payload.source_node_id) || undefined,
    returnNodeId: stringValue(payload.returnNodeId) || stringValue(payload.return_node_id) || undefined,
    summary: stringValue(payload.summary) || undefined,
    syncStatus: normalizeSyncStatus(payload.syncStatus) || normalizeSyncStatus(payload.sync_status),
    syncError: stringValue(payload.syncError) || stringValue(payload.sync_error) || undefined,
    source: normalizeSessionSource(payload.source),
    runState: stringValue(payload.run_state) || undefined,
  }
}

function normalizePayloadSessionMetadata(payload: Record<string, unknown>): SessionMetadataState {
  const recordMetadata = objectValue(sessionRecordFromPayload(payload).metadata)
  return normalizeSessionMetadata({
    ...recordMetadata,
    ...objectValue(payload.metadata),
  })
}

function sessionRecordFromPayload(payload: Record<string, unknown>): Record<string, unknown> {
  return objectValue(payload.record)
}

function sessionDocumentFromPayload(payload: Record<string, unknown>): Record<string, unknown> {
  const transcript = objectValue(sessionRecordFromPayload(payload).transcript)
  if (Object.keys(transcript).length > 0) return transcript
  return objectValue(payload.document)
}

function sessionRuntimeStateFromPayload(payload: Record<string, unknown>): Record<string, unknown> {
  const runtimeState = objectValue(payload.runtime_state)
  if (Object.keys(runtimeState).length > 0) return runtimeState
  const camelRuntimeState = objectValue(payload.runtimeState)
  if (Object.keys(camelRuntimeState).length > 0) return camelRuntimeState
  return objectValue(sessionRecordFromPayload(payload).runtime_state)
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
  const document = sessionDocumentFromPayload(payload)
  const documentSession = objectValue(document.session)
  const documentStats = objectValue(document.stats)
  const trace = objectValue(document.trace)
  const runtimeState = sessionRuntimeStateFromPayload(payload)
  const modelProfile = objectValue(payload.model_profile)
  const session = {
    id: metadata.id,
    title:
      stringValue(documentSession.title) ||
      metadata.preview ||
      "新会话",
    updatedAt:
      stringValue(documentSession.updatedAt) ||
      metadata.savedAt ||
      new Date().toISOString(),
    kind: normalizeSessionKind(documentSession.kind) || metadata.kind || "main",
    state: normalizeSessionState(documentSession.state) || runStateToSessionState(metadata.runState) || "active",
    parentSessionId: stringValue(documentSession.parentSessionId) || metadata.parentSessionId,
    sourceSessionId: stringValue(documentSession.sourceSessionId) || metadata.sourceSessionId,
    sourceNodeId: stringValue(documentSession.sourceNodeId) || metadata.sourceNodeId,
    returnNodeId: stringValue(documentSession.returnNodeId) || metadata.returnNodeId,
    summary: stringValue(documentSession.summary) || metadata.summary || metadata.preview,
    syncStatus: metadata.syncStatus,
    syncError: metadata.syncError,
    source: metadata.source,
  }
  return {
    session,
    stats: {
      ...EMPTY_STATS,
      ...documentStats,
      model:
        stringValue(documentStats.model) ||
        stringValue(modelProfile.model) ||
        stringValue(runtimeState.model) ||
        metadata.model,
      mode:
        stringValue(documentStats.mode) ||
        stringValue(runtimeState.active_mode),
      contextWindow:
        numberValue(documentStats.contextWindow) ||
        numberValue(modelProfile.max_context_tokens) ||
        numberValue(runtimeState.max_context_tokens) ||
        0,
      maxOutputTokens:
        numberValue(documentStats.maxOutputTokens) ||
        numberValue(modelProfile.max_tokens) ||
        0,
    },
    turns: arrayValue(document.turns),
    traceNodes: arrayValue(document.traceNodes).length
      ? arrayValue(document.traceNodes)
      : arrayValue(trace.nodes),
    traceEdges: arrayValue(document.traceEdges).length
      ? arrayValue(document.traceEdges)
      : arrayValue(trace.edges),
    traceUI: {
      ...EMPTY_TRACE_UI,
      ...objectValue(trace.ui),
      ...objectValue(document.traceUI),
    },
  }
}

function normalizeSyncStatus(value: unknown): SessionSyncStatus | undefined {
  return value === "synced" || value === "pending" || value === "failed"
    ? value
    : undefined
}

function normalizeSessionSource(value: unknown): "server" | "local" | "merged" | undefined {
  return value === "server" || value === "local" || value === "merged"
    ? value
    : undefined
}

function normalizeSessionKind(value: unknown): SessionMetadataState["kind"] | undefined {
  return value === "main" || value === "fork" || value === "delegated_run"
    ? value
    : undefined
}

function normalizeSessionState(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined
}

function runStateToSessionState(value: unknown): string | undefined {
  if (value === "done") return "success"
  if (value === "running" || value === "stopping") return "streaming"
  if (value === "cancelled") return "cancelled"
  if (value === "error" || value === "failed") return "error"
  return undefined
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return undefined
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}
