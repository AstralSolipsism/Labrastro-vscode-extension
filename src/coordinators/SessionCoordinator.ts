import type * as vscode from "vscode"
import type {
  BackendFeatures,
  LabrastroRemoteClient,
} from "../LabrastroRemoteClient"
import type { PostMessage } from "../WebviewBus"
import type { WebviewToHostMessage } from "../protocol/messages"
import { isRemoteError } from "../remote-errors"

type SessionSyncStatus = "synced" | "pending" | "failed"

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

  async initializeSessionState(post: PostMessage): Promise<void> {
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

  async refreshSessions(limit = 20): Promise<{ fingerprint?: string }> {
    if (this.sessionApiAvailable === false) {
      return { fingerprint: this.sessionFingerprint }
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
        this.sessionApiAvailable = false
        this.sessionFingerprint = undefined
        this.sessionListEtag = undefined
        this.sessions = []
        return {}
      }
      return { fingerprint: this.sessionFingerprint }
    }
    return { fingerprint: this.sessionFingerprint }
  }

  async postSessionList(post: PostMessage): Promise<void> {
    try {
      await this.refreshSessions(50)
      this.options.emitSessionMessage({
        type: "session.list",
        sessions: this.sessions,
        fingerprint: this.sessionFingerprint,
      }, post)
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
      const metadata = normalizeSessionMetadata(payload.metadata)
      const bundle = buildSessionBundle(payload, metadata)
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
        document: objectValue(payload.document),
        bundle,
        runtimeState: objectValue(payload.runtime_state),
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
      const metadata = normalizeSessionMetadata(payload.metadata)
      const bundle = buildSessionBundle(payload, metadata)
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
        document: objectValue(payload.document),
        bundle,
        runtimeState: objectValue(payload.runtime_state),
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
      const metadata = normalizeSessionMetadata(payload.metadata)
      if (metadata.id) {
        this.currentSessionId = metadata.id
        await this.options.context.workspaceState.update("labrastro.currentSessionId", metadata.id)
      }
      await this.refreshSessions()
      this.options.emitSessionMessage({
        type: "session.forked",
        sessionId: metadata.id,
        metadata,
        document: objectValue(payload.document),
        bundle: buildSessionBundle(payload, metadata),
        runtimeState: objectValue(payload.runtime_state),
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
        const metadata = normalizeSessionMetadata(created.metadata)
        sessionId = metadata.id
        this.currentSessionId = metadata.id
        await this.options.context.workspaceState.update("labrastro.currentSessionId", metadata.id)
        this.options.emitSessionMessage({
          type: "session.created",
          sessionId: metadata.id,
          metadata,
          document: objectValue(created.document),
          bundle: buildSessionBundle(created, metadata),
          runtimeState: objectValue(created.runtime_state),
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
    await this.refreshSessions()
    this.options.emitSessionMessage({
      type: "session.list",
      sessions: this.sessions,
      fingerprint: this.sessionFingerprint,
    }, post)
  }

  private async initializeSessionStateCore(post: PostMessage, token: number): Promise<void> {
    try {
      const listPayload = await this.refreshSessions(10)
      if (token !== this.sessionInitializationToken) return
      const storedSessionId = this.options.context.workspaceState.get<string>("labrastro.currentSessionId")
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
      await this.options.context.workspaceState.update("labrastro.currentSessionId", undefined)
      this.options.emitSessionMessage({
        type: "session.list",
        sessions: this.sessions,
        fingerprint: listPayload.fingerprint || this.sessionFingerprint,
      }, post)
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
    const metadata = normalizeSessionMetadata(payload.metadata)
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
        document: objectValue(payload.document),
        bundle: buildSessionBundle(payload, metadata),
        runtimeState: objectValue(payload.runtime_state),
        sessions: this.sessions,
        fingerprint: this.sessionFingerprint || stringValue(payload.fingerprint),
      }, post)
    }
    post({
      type: "session.model.state",
      sessionId: metadata.id || fallbackSessionId,
      payload,
      runtimeState: objectValue(payload.runtime_state),
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
  const document = objectValue(payload.document)
  const documentSession = objectValue(document.session)
  const documentStats = objectValue(document.stats)
  const trace = objectValue(document.trace)
  const runtimeState = objectValue(payload.runtime_state)
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
