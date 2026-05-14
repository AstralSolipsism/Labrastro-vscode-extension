import type * as vscode from "vscode"
import type {
  BackendFeatures,
  LabrastroRemoteClient,
} from "../LabrastroRemoteClient"
import {
  SessionSnapshotOutbox,
  isLocalDraftSessionId,
  type SessionSnapshotMetadata,
  type SessionSnapshotOutboxRecord,
  type SessionSnapshotSyncStatus,
} from "../SessionSnapshotOutbox"
import { canStartSessionlessChat, LEGACY_BACKEND_UPGRADE_MESSAGE } from "../session-start"
import {
  mergeSessionBundleWithLocalContent,
  shouldPreserveLocalSessionContent,
} from "../session-bundle-content"
import type { PostMessage } from "../WebviewBus"
import type { WebviewToHostMessage } from "../protocol/messages"
import { isRemoteError } from "../remote-errors"

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
  syncStatus?: SessionSnapshotSyncStatus
  syncError?: string
  source?: "server" | "local" | "merged"
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

const SNAPSHOT_RETRY_DELAYS_MS = [10_000, 30_000, 120_000, 300_000]

export class SessionCoordinator {
  private readonly sessionOutbox: SessionSnapshotOutbox
  private currentSessionId: string | undefined
  private sessionApiAvailable: boolean | undefined
  private sessionFingerprint: string | undefined
  private sessionListEtag: string | undefined
  private sessionInitialization: Promise<void> | undefined
  private sessionInitializationToken = 0
  private sessions: SessionMetadataState[] = []
  private readonly snapshotSyncTimers = new Map<string, NodeJS.Timeout>()
  private readonly snapshotSyncInFlight = new Set<string>()

  constructor(private readonly options: SessionCoordinatorOptions) {
    this.sessionOutbox = new SessionSnapshotOutbox(options.context)
  }

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

  dispose(): void {
    for (const timer of this.snapshotSyncTimers.values()) {
      clearTimeout(timer)
    }
    this.snapshotSyncTimers.clear()
  }

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
          snapshot: objectValue(message.snapshot),
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
      default:
        return false
    }
  }

  async postSessionSyncStatus(post?: PostMessage): Promise<void> {
    const disabled = this.options.getBackendFeatures()?.sessionHistoryWritable === false
    const payload = await this.sessionOutbox.summary(this.options.client.hostUrl, {
      disabled,
      message: disabled ? this.sessionHistoryDisabledMessage() : undefined,
    })
    this.options.emitSessionMessage({ type: "session.syncStatus", payload }, post)
  }

  async syncDueSessionSnapshots(post?: PostMessage): Promise<void> {
    if (this.options.getBackendFeatures() === undefined) {
      await this.options.refreshBackendFeatures(post)
    }
    if (this.options.getBackendFeatures()?.sessionHistoryWritable === false) {
      await this.postSessionSyncStatus(post)
      return
    }
    const hostUrl = this.options.client.hostUrl
    const due = await this.sessionOutbox.due(hostUrl)
    for (const record of due) {
      await this.syncSnapshotRecord(hostUrl, record.sessionId, post)
    }
    await this.postSessionSyncStatus(post)
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
      await this.mergeLocalSessions()
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
      await this.mergeLocalSessions({ includeSyncedLocalOnly: false })
    } catch (error) {
      if (isSessionApiUnavailable(error)) {
        this.sessionApiAvailable = false
        this.sessionFingerprint = undefined
        this.sessionListEtag = undefined
        this.sessions = []
        await this.mergeLocalSessions({ includeSyncedLocalOnly: true })
        return {}
      }
      await this.mergeLocalSessions({ includeSyncedLocalOnly: true })
      return { fingerprint: this.sessionFingerprint }
    }
    return { fingerprint: this.sessionFingerprint }
  }

  async postSessionList(post: PostMessage): Promise<void> {
    try {
      await this.syncDueSessionSnapshots(post)
      await this.refreshSessions(50)
      this.options.emitSessionMessage({
        type: "session.list",
        sessions: this.sessions,
        fingerprint: this.sessionFingerprint,
      }, post)
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
      if (options.isStale?.()) {
        return
      }
      const metadata = normalizeSessionMetadata(payload.metadata)
      let bundle = buildSessionBundle(payload, metadata)
      const localPayload = await this.sessionOutbox.payload(this.options.client.hostUrl, metadata.id || sessionId)
      if (localPayload) {
        const localMetadata = normalizeSessionMetadata(localPayload.metadata)
        const localBundle = buildSessionBundle(localPayload, localMetadata)
        if (shouldPreserveLocalSessionContent(bundle, localBundle)) {
          bundle = mergeSessionBundleWithLocalContent(
            bundle,
            localBundle,
            enrichTurnsWithHistoryMapping(arrayValue(localBundle.turns), arrayValue(payload.messages))
          )
        }
      }
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
        bundle,
        runtimeState: objectValue(payload.runtime_state),
        sessions: this.sessions,
        fingerprint: this.sessionFingerprint,
      }, post)
    } catch (error) {
      const localPayload = await this.sessionOutbox.payload(this.options.client.hostUrl, sessionId)
      if (localPayload) {
        if (options.isStale?.()) {
          return
        }
        const metadata = normalizeSessionMetadata(localPayload.metadata)
        const bundle = buildSessionBundle(localPayload, metadata)
        this.currentSessionId = metadata.id
        await this.options.context.workspaceState.update("labrastro.currentSessionId", metadata.id)
        if (!options.suppressListRefresh) {
          await this.refreshSessions()
        }
        this.options.emitSessionMessage({
          type: "session.loaded",
          sessionId: metadata.id,
          reason: options.reason,
          metadata,
          bundle,
          runtimeState: objectValue(localPayload.runtime_state),
          sessions: this.sessions,
          fingerprint: this.sessionFingerprint,
        }, post)
        return
      }
      post({ type: "session.error", message: errorMessage(error) })
    }
  }

  async createSession(
    post: PostMessage,
    options: { suppressListRefresh?: boolean; fingerprint?: string } = {}
  ): Promise<void> {
    if (this.sessionApiAvailable === false) {
      this.currentSessionId = undefined
      await this.options.context.workspaceState.update("labrastro.currentSessionId", undefined)
      await this.mergeLocalSessions()
      this.options.emitSessionMessage({
        type: "session.list",
        sessions: this.sessions,
        fingerprint: this.sessionFingerprint,
      }, post)
      return
    }
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
        this.options.emitSessionMessage({
          type: "session.list",
          sessions: this.sessions,
          fingerprint: this.sessionFingerprint,
        }, post)
        return
      }
      post({ type: "session.error", message: errorMessage(error) })
    }
  }

  async forkSession(
    request: {
      sourceSessionId: string
      keepThroughMessageIndex: number
      snapshot: Record<string, unknown>
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
    if (!sourceSessionId || isLocalDraftSessionId(sourceSessionId)) {
      post({ type: "session.error", message: "Fork 需要基于真实远端会话。" })
      return
    }
    if (this.sessionApiAvailable === false) {
      post({ type: "session.error", message: "当前后端不支持会话 Fork。" })
      return
    }
    try {
      const payload = await this.options.client.forkSession(
        sourceSessionId,
        request.keepThroughMessageIndex,
        request.snapshot
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
    await this.sessionOutbox.delete(this.options.client.hostUrl, sessionId)

    const postDeleted = async (deletedCurrent: boolean, loadNext = true) => {
      this.sessions = this.sessions.filter((session) => session.id !== sessionId)
      if (deletedCurrent) {
        this.currentSessionId = undefined
        await this.options.context.workspaceState.update("labrastro.currentSessionId", undefined)
      }
      await this.postSessionSyncStatus(post)
      this.options.emitSessionMessage({
        type: "session.deleted",
        sessionId,
        sessions: this.sessions,
        fingerprint: this.sessionFingerprint,
      }, post)
      if (deletedCurrent) {
        const nextSessionId = this.sessions[0]?.id
        if (loadNext && nextSessionId) {
          await this.loadSession(nextSessionId, post, { suppressListRefresh: true })
        } else {
          this.options.emitSessionMessage({
            type: "session.list",
            sessions: this.sessions,
            fingerprint: this.sessionFingerprint,
          }, post)
        }
      }
    }

    if (isLocalDraftSessionId(sessionId) || this.sessionApiAvailable === false) {
      await postDeleted(this.currentSessionId === sessionId, false)
      return
    }
    try {
      await this.options.client.deleteSession(sessionId)
      const deletedCurrent = this.currentSessionId === sessionId
      await this.refreshSessions()
      await postDeleted(deletedCurrent)
    } catch (error) {
      if (
        isRemoteError(error, "session_not_found", 404) ||
        isRemoteError(error, "session_fingerprint_mismatch", 403)
      ) {
        const deletedCurrent = this.currentSessionId === sessionId
        await this.refreshSessions()
        await postDeleted(deletedCurrent)
        return
      }
      post({ type: "session.error", message: errorMessage(error) })
    }
  }

  async saveSessionSnapshot(
    sessionId: string,
    snapshot: Record<string, unknown>,
    snapshotDigest: string | undefined,
    post: PostMessage
  ): Promise<void> {
    if (!sessionId || !Object.keys(snapshot).length) return
    const hostUrl = this.options.client.hostUrl
    const localDraft = isLocalDraftSessionId(sessionId)
    const canUpload =
      !localDraft &&
      this.sessionApiAvailable !== false &&
      this.options.getBackendFeatures()?.sessionHistoryWritable !== false
    const record = await this.sessionOutbox.upsert(
      hostUrl,
      sessionId,
      snapshot,
      snapshotDigest,
      "pending",
      canUpload ? undefined : this.sessionHistoryDisabledMessage()
    )
    this.postSnapshotStored(record, post)
    await this.postSessionSyncStatus(post)
    if (!canUpload) {
      return
    }
    if (this.options.isChatActive()) {
      this.scheduleSnapshotSync(hostUrl, {
        ...record,
        nextAttemptAt: Date.now() + 1_000,
      })
      return
    }
    await this.syncSnapshotRecord(hostUrl, sessionId, post)
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
    if (!sessionId || isLocalDraftSessionId(sessionId)) {
      post({ type: "session.model.error", message: "模型切换需要先绑定真实远端会话。", requestId })
      return
    }
    if (this.sessionApiAvailable === false) {
      post({ type: "session.model.error", message: "当前后端不支持会话模型切换。", requestId })
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
    const requestedRemoteSessionId = requestedSessionId && !isLocalDraftSessionId(requestedSessionId)
      ? requestedSessionId
      : undefined
    if (!requestedRemoteSessionId) {
      this.invalidatePendingInitialization()
    }
    let sessionId = requestedRemoteSessionId
    const startupProviderId = stringValue(options.providerId) || ""
    const startupModelId = stringValue(options.modelId) || ""
    const startupParameters = objectValue(options.parameters)
    const hasStartupModelOverride = Boolean(startupProviderId && startupModelId)
    const features = await this.options.ensureBackendFeatures()
    const supportsFreshSessionWithoutHint =
      features?.freshSessionWithoutSessionHint === true
    if (
      !sessionId &&
      (hasStartupModelOverride || !supportsFreshSessionWithoutHint) &&
      this.sessionApiAvailable !== false
    ) {
      try {
        const created = await this.options.client.newSession()
        this.sessionApiAvailable = true
        const metadata = normalizeSessionMetadata(created.metadata)
        sessionId = metadata.id
        this.currentSessionId = metadata.id
        await this.options.context.workspaceState.update("labrastro.currentSessionId", metadata.id)
        await this.refreshSessions()
        this.options.emitSessionMessage({
          type: "session.created",
          sessionId: metadata.id,
          metadata,
          bundle: buildSessionBundle(created, metadata),
          runtimeState: objectValue(created.runtime_state),
          sessions: this.sessions,
          fingerprint: this.sessionFingerprint,
        }, post)
      } catch (error) {
        if (!isSessionApiUnavailable(error)) {
          throw error
        }
        this.sessionApiAvailable = false
        sessionId = undefined
        this.currentSessionId = undefined
        await this.options.context.workspaceState.update("labrastro.currentSessionId", undefined)
      }
    }
    if (hasStartupModelOverride && (!sessionId || this.sessionApiAvailable === false)) {
      post({ type: "chat.error", message: "当前后端不支持会话模型切换。" })
      return { ok: false }
    }
    if (hasStartupModelOverride && sessionId) {
      const modelPayload = await this.options.client.switchSessionMainModel(
        sessionId,
        startupProviderId,
        startupModelId,
        startupParameters
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
    if (
      !sessionId &&
      !supportsFreshSessionWithoutHint &&
      !canStartSessionlessChat(false, features)
    ) {
      post({ type: "chat.error", message: LEGACY_BACKEND_UPGRADE_MESSAGE })
      return { ok: false }
    }
    return { ok: true, sessionId }
  }

  async adoptRemoteSession(
    remoteSessionId: string | undefined,
    sessionId: string | undefined,
    draftSessionId: string | undefined,
    post: PostMessage
  ): Promise<string | undefined> {
    if (remoteSessionId && remoteSessionId !== this.currentSessionId) {
      if (draftSessionId) {
        const adopted = await this.sessionOutbox.adoptDraft(
          this.options.client.hostUrl,
          draftSessionId,
          remoteSessionId
        )
        if (adopted) {
          this.postSnapshotStored(adopted, post)
        }
      }
      this.options.emitSessionMessage({
        type: "session.adopted",
        sessionId: remoteSessionId,
        previousSessionId: draftSessionId,
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
    try {
      await this.syncDueSessionSnapshots(post)
      await this.refreshSessions()
      const currentSessionId = this.currentSessionId
      if (currentSessionId && !isLocalDraftSessionId(currentSessionId)) {
        await this.loadSession(currentSessionId, post, {
          suppressListRefresh: true,
          reason: "explicit",
        })
      } else {
        this.options.emitSessionMessage({
          type: "session.list",
          sessions: this.sessions,
          fingerprint: this.sessionFingerprint,
        }, post)
      }
    } catch {
      // Chat completion should not fail because history refresh failed.
    }
  }

  private sessionHistoryDisabledMessage(): string | undefined {
    if (this.options.getBackendFeatures()?.sessionHistoryWritable === false) {
      return "服务端会话保存已关闭，当前对话会先保存在本地并等待同步。"
    }
    return undefined
  }

  private async initializeSessionStateCore(post: PostMessage, token: number): Promise<void> {
    try {
      const listPayload = await this.refreshSessions(10)
      if (token !== this.sessionInitializationToken) {
        return
      }
      if (this.sessionApiAvailable === false) {
        this.options.emitSessionMessage({
          type: "session.list",
          sessions: this.sessions,
          fingerprint: this.sessionFingerprint,
        }, post)
        return
      }
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

  private async mergeLocalSessions(
    options: { includeSyncedLocalOnly?: boolean } = {}
  ): Promise<void> {
    this.sessions = await this.sessionOutbox.mergeMetadata(
      this.options.client.hostUrl,
      this.sessions as SessionSnapshotMetadata[],
      options
    )
  }

  private snapshotTimerKey(hostUrl: string, sessionId: string): string {
    return `${hostUrl}\n${sessionId}`
  }

  private scheduleSnapshotSync(hostUrl: string, record: SessionSnapshotOutboxRecord): void {
    const key = this.snapshotTimerKey(hostUrl, record.sessionId)
    const existing = this.snapshotSyncTimers.get(key)
    if (existing) {
      clearTimeout(existing)
      this.snapshotSyncTimers.delete(key)
    }
    if (record.status === "synced" || isLocalDraftSessionId(record.sessionId)) return
    if (this.options.getBackendFeatures()?.sessionHistoryWritable === false) return
    const delayMs = Math.max(0, (record.nextAttemptAt || Date.now()) - Date.now())
    const timer = setTimeout(() => {
      this.snapshotSyncTimers.delete(key)
      void this.syncSnapshotRecord(hostUrl, record.sessionId)
    }, delayMs)
    this.snapshotSyncTimers.set(key, timer)
  }

  private retryDelayMs(record: SessionSnapshotOutboxRecord): number {
    return SNAPSHOT_RETRY_DELAYS_MS[
      Math.min(record.retryCount, SNAPSHOT_RETRY_DELAYS_MS.length - 1)
    ]
  }

  private async syncSnapshotRecord(
    hostUrl: string,
    sessionId: string,
    post?: PostMessage
  ): Promise<void> {
    const key = this.snapshotTimerKey(hostUrl, sessionId)
    if (this.snapshotSyncInFlight.has(key)) return
    const record = await this.sessionOutbox.read(hostUrl, sessionId)
    if (!record || record.status === "synced" || isLocalDraftSessionId(sessionId)) return
    if (this.options.isChatActive()) {
      this.scheduleSnapshotSync(hostUrl, {
        ...record,
        nextAttemptAt: Date.now() + 1_000,
      })
      return
    }
    if (
      this.sessionApiAvailable === false ||
      this.options.getBackendFeatures()?.sessionHistoryWritable === false
    ) {
      const pending = await this.sessionOutbox.markPending(
        hostUrl,
        sessionId,
        this.sessionHistoryDisabledMessage()
      )
      if (pending) {
        this.postSnapshotStored(pending, post)
      }
      await this.postSessionSyncStatus(post)
      return
    }
    this.snapshotSyncInFlight.add(key)
    try {
      const payload = await this.options.client.saveSessionSnapshot(
        sessionId,
        record.snapshot,
        record.snapshotDigest
      )
      this.sessionApiAvailable = true
      const synced = await this.sessionOutbox.markSynced(
        hostUrl,
        sessionId,
        stringValue(payload.snapshot_digest) || record.snapshotDigest
      )
      if (synced) {
        this.postSnapshotStored(synced, post)
      }
    } catch (error) {
      if (isSessionApiUnavailable(error)) {
        this.sessionApiAvailable = false
      }
      const failed = await this.sessionOutbox.markFailed(
        hostUrl,
        sessionId,
        errorMessage(error),
        this.retryDelayMs(record)
      )
      if (failed) {
        this.postSnapshotStored(failed, post)
        this.scheduleSnapshotSync(hostUrl, failed)
      }
    } finally {
      this.snapshotSyncInFlight.delete(key)
      await this.postSessionSyncStatus(post)
    }
  }

  private postSnapshotStored(
    record: SessionSnapshotOutboxRecord,
    post?: PostMessage
  ): void {
    this.options.emitSessionMessage({
      type: "session.snapshotStored",
      sessionId: record.sessionId,
      snapshotDigest: record.snapshotDigest,
      status: record.status,
      message: record.message,
    }, post)
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
  }
}

function normalizeSessionMetadataList(value: unknown): SessionMetadataState[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => normalizeSessionMetadata(item))
    .filter((item) => item.id)
}

function normalizeSyncStatus(value: unknown): SessionSnapshotSyncStatus | undefined {
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

function buildSessionBundle(
  payload: Record<string, unknown>,
  metadata: SessionMetadataState
): Record<string, unknown> {
  const snapshot = objectValue(payload.snapshot)
  const snapshotSession = objectValue(snapshot.session)
  const snapshotStats = objectValue(snapshot.stats)
  const runtimeState = objectValue(payload.runtime_state)
  const modelProfile = objectValue(payload.model_profile)
  const messages = arrayValue(payload.messages)
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
    kind: normalizeSessionKind(snapshotSession.kind) || metadata.kind || "main",
    state: stringValue(snapshotSession.state) || "active",
    parentSessionId: stringValue(snapshotSession.parentSessionId) || metadata.parentSessionId,
    sourceSessionId: stringValue(snapshotSession.sourceSessionId) || metadata.sourceSessionId,
    sourceNodeId: stringValue(snapshotSession.sourceNodeId) || metadata.sourceNodeId,
    returnNodeId: stringValue(snapshotSession.returnNodeId) || metadata.returnNodeId,
    summary: stringValue(snapshotSession.summary) || metadata.summary || metadata.preview,
    syncStatus: metadata.syncStatus,
    syncError: metadata.syncError,
    source: metadata.source,
  }
  const fallback = buildBundleFromMessages(metadata, messages)
  const turns = Array.isArray(snapshot.turns)
    ? mergeSnapshotTurnsWithMessageHistory(snapshot.turns, messages, arrayValue(fallback.turns))
    : arrayValue(fallback.turns)
  const historyMappedTurns = enrichTurnsWithHistoryMapping(turns, messages)
  const replayedTurns = replaySessionEventsIntoTurns(
    historyMappedTurns,
    arrayValue(payload.events_after_snapshot),
    metadata.id
  )
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
    turns: replayedTurns,
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

function replaySessionEventsIntoTurns(
  turns: unknown[],
  events: unknown[],
  sessionId: string
): unknown[] {
  const conversation = cloneArray(turns)
  const hasChatFailed = events.some((event) => stringValue(objectValue(event).type) === "chat_failed")
  for (const rawEvent of events) {
    const event = objectValue(rawEvent)
    const type = stringValue(event.type) || ""
    const payload = objectValue(event.payload)
    const meta = sessionEventMeta(event, type, payload, sessionId)
    if (meta.eventKey && bundleHasEventKey(conversation, meta.eventKey)) {
      continue
    }
    if (type === "remote_peer_ready") {
      appendReplayPart(conversation, {
        id: replayPartId("remote", meta),
        type: "remote_status",
        remotePeerId: stringValue(payload.peer_id) || "",
        remoteSessionId: stringValue(payload.session_id) || "",
        remoteFingerprint: stringValue(payload.fingerprint) || "",
        remoteMode: stringValue(payload.mode) || "",
        remoteModel: stringValue(payload.model) || "",
        remoteWorkspaceRoot: stringValue(payload.workspace_root) || "",
      }, meta)
    } else if (type === "context_event") {
      appendReplayPart(conversation, {
        id: replayPartId("context", meta),
        type: "context_event",
        contextTitle: stringValue(payload.message) || stringValue(payload.phase) || "上下文事件",
        contextPayload: payload,
      }, meta)
    } else if (type === "view") {
      appendReplayPart(conversation, replayViewPart(payload, meta), meta)
    } else if (isReplayStructuredUiEvent(type)) {
      appendReplayPart(conversation, {
        id: replayPartId(type, meta),
        type: "ui_event",
        uiEventKind: stringValue(payload.kind) || type.replace("_event", ""),
        uiEventLevel: stringValue(payload.level) || "info",
        uiEventTitle: stringValue(payload.title) || stringValue(payload.message) || replayUiEventTitle(type),
        uiEventPayload: payload,
      }, meta)
    } else if (type === "runtime_status") {
      appendReplayPart(conversation, replayViewPart({
        title: stringValue(payload.title) || stringValue(payload.message) || "运行状态",
        kind: "runtime_status",
        payload,
      }, meta), meta)
    } else if (type === "output") {
      appendReplayPart(conversation, {
        id: replayPartId("terminal", meta),
        type: stringValue(payload.format) === "terminal" ? "terminal" : "text",
        terminalTitle: "终端输出",
        terminalContent: stringValue(payload.content) || "",
        text: stringValue(payload.content) || "",
        textFormat: stringValue(payload.format) === "markdown" ? "markdown" : "plain",
      }, meta)
    } else if (type === "tool_call_start") {
      replayUpsertToolPart(conversation, stringValue(payload.tool_name) || "tool", {
        status: "running",
        toolCallId: requiredReplayToolCallId(payload),
        toolSource: stringValue(payload.tool_source),
        toolStartedAt: numberValue(payload.started_at),
        toolInput: objectValue(payload.tool_args),
      }, meta)
    } else if (type === "tool_call_stream") {
      const toolCallId = requiredReplayToolCallId(payload)
      const current = findReplayToolPart(conversation, toolCallId)
      replayUpsertToolPart(conversation, stringValue(payload.tool_name) || "tool", {
        status: "running",
        toolCallId,
        toolSource: stringValue(payload.tool_source),
        toolStream: stringValue(payload.stream) || "stdout",
        toolOutputFormat: "plain",
        toolOutput: `${stringValue(current?.toolOutput) || ""}${stringValue(payload.content) || ""}`,
      }, meta)
    } else if (type === "tool_call_protocol_error") {
      const code = stringValue(payload.code)
      const message = stringValue(payload.message) || code || "Remote tool protocol error"
      replayUpsertToolPart(conversation, stringValue(payload.tool_name) || "tool", {
        status: "protocol_error",
        toolCallId: requiredReplayToolCallId(payload),
        toolOutput: code ? `[${code}] ${message}` : message,
        toolOutputFormat: "plain",
        toolResultMeta: { code, message },
      }, meta)
    } else if (type === "tool_call_end") {
      replayUpsertToolPart(conversation, stringValue(payload.tool_name) || "tool", {
        status: "returned",
        toolCallId: requiredReplayToolCallId(payload),
        toolSource: stringValue(payload.tool_source),
        toolEndedAt: numberValue(payload.ended_at),
        toolOutput: stringValue(payload.tool_result) || "",
        toolOutputFormat: "plain",
        toolResultMeta: objectValue(payload.meta),
      }, meta)
    } else if (type === "approval_request") {
      replayUpsertToolPart(conversation, stringValue(payload.tool_name) || "tool", {
        status: "awaiting_approval",
        approvalId: stringValue(payload.approval_id),
        approvalReason: stringValue(payload.reason),
        approvalSections: arrayValue(payload.sections),
        approvalContent: stringValue(payload.content),
        toolCallId: requiredReplayToolCallId(payload),
        toolSource: stringValue(payload.tool_source),
        toolInput: objectValue(payload.tool_args),
      }, meta)
    } else if (type === "approval_resolved") {
      replayPatchToolPart(conversation, requiredReplayToolCallId(payload), stringValue(payload.approval_id), {
        approvalDecision: stringValue(payload.decision),
        approvalResultReason: stringValue(payload.reason),
        status: stringValue(payload.decision) === "allow_once" ? "approved" : "denied",
      }, meta)
    } else if (type === "chat_failed" || (type === "error" && !hasChatFailed)) {
      appendReplayPart(conversation, {
        id: replayPartId("error", meta),
        type: "text",
        text: `错误：${stringValue(payload.message) || "unknown error"}`,
        textFormat: "plain",
        textStreamKey: "error",
      }, meta)
    } else if (type === "chat_cancelled") {
      appendReplayPart(conversation, {
        id: replayPartId("cancelled", meta),
        type: "text",
        text: "已取消当前请求。",
        textFormat: "plain",
        textStreamKey: "cancelled",
      }, meta)
    }
  }
  return conversation
}

function sessionEventMeta(
  event: Record<string, unknown>,
  type: string,
  payload: Record<string, unknown>,
  fallbackSessionId: string
): { eventKey?: string; sessionEventSeq?: number } {
  const sessionEventSeq = numberValue(event.session_event_seq) ?? numberValue(event.sessionEventSeq)
  const chatSeq = numberValue(event.chat_seq) ?? numberValue(event.seq)
  const chatId = stringValue(event.chat_id)
  const eventSessionId = stringValue(event.session_id) || stringValue(payload.session_id) || fallbackSessionId
  const toolCallId = stringValue(payload.tool_call_id)
  const eventKey = sessionEventSeq !== undefined
    ? `session:${eventSessionId || "unknown"}:${sessionEventSeq}`
    : chatId && chatSeq !== undefined
      ? `chat:${chatId}:${chatSeq}:${type}${toolCallId ? `:${toolCallId}` : ""}`
      : undefined
  return { eventKey, sessionEventSeq }
}

function replayPartId(prefix: string, meta: { eventKey?: string; sessionEventSeq?: number }): string {
  return `${prefix}-${meta.sessionEventSeq ?? meta.eventKey ?? Date.now()}`
}

function withReplayEventMeta<T extends Record<string, unknown>>(
  part: T,
  meta: { eventKey?: string; sessionEventSeq?: number }
): T {
  return {
    ...part,
    ...(meta.eventKey ? { eventKey: meta.eventKey } : {}),
    ...(meta.sessionEventSeq !== undefined ? { sessionEventSeq: meta.sessionEventSeq } : {}),
  }
}

function bundleHasEventKey(turns: unknown[], eventKey: string): boolean {
  return turns.some((rawTurn) => {
    const turn = objectValue(rawTurn)
    return [turn.userMessage, ...arrayValue(turn.assistantMessages)].some((rawMessage) =>
      arrayValue(objectValue(rawMessage).parts).some((rawPart) =>
        stringValue(objectValue(rawPart).eventKey) === eventKey
      )
    )
  })
}

function appendReplayPart(
  turns: unknown[],
  part: Record<string, unknown>,
  meta: { eventKey?: string; sessionEventSeq?: number }
): void {
  const assistant = ensureReplayAssistantMessage(turns)
  assistant.parts = [...arrayValue(assistant.parts), withReplayEventMeta(part, meta)]
}

function ensureReplayAssistantMessage(turns: unknown[]): Record<string, unknown> {
  if (!turns.length) {
    turns.push({
      userMessage: {
        id: "replay-user-0",
        role: "user",
        text: "",
        parts: [],
        timestamp: Date.now(),
      },
      assistantMessages: [],
    })
  }
  const turnIndex = turns.length - 1
  const turn = objectValue(turns[turnIndex])
  const assistantMessages = cloneArray(arrayValue(turn.assistantMessages))
  if (!assistantMessages.length) {
    assistantMessages.push({
      id: `replay-assistant-${turnIndex}`,
      role: "assistant",
      text: "",
      parts: [],
      timestamp: Date.now(),
    })
  }
  const messageIndex = assistantMessages.length - 1
  const message = objectValue(assistantMessages[messageIndex])
  message.parts = arrayValue(message.parts)
  assistantMessages[messageIndex] = message
  turn.assistantMessages = assistantMessages
  turns[turnIndex] = turn
  return message
}

function replayViewPart(
  payload: Record<string, unknown>,
  meta: { eventKey?: string; sessionEventSeq?: number }
): Record<string, unknown> {
  const nestedPayload = objectValue(payload.payload)
  return withReplayEventMeta({
    id: replayPartId("view", meta),
    type: "view",
    viewTitle: stringValue(payload.title) || stringValue(payload.message) || "结构化视图",
    viewType: stringValue(payload.view_type) || stringValue(payload.kind) || "view",
    viewLevel: stringValue(payload.level) || "info",
    viewPayload: Object.keys(nestedPayload).length ? nestedPayload : payload,
  }, meta)
}

function replayUpsertToolPart(
  turns: unknown[],
  toolName: string,
  patch: Record<string, unknown>,
  meta: { eventKey?: string; sessionEventSeq?: number }
): void {
  const toolCallId = stringValue(patch.toolCallId)
  if (!toolCallId) return
  const assistant = ensureReplayAssistantMessage(turns)
  const parts = cloneArray(arrayValue(assistant.parts))
  const index = parts.findIndex((rawPart) => {
    const part = objectValue(rawPart)
    return stringValue(part.type) === "tool" && stringValue(part.toolCallId) === toolCallId
  })
  const current = index >= 0 ? objectValue(parts[index]) : {
    id: `tool-${toolCallId}`,
    type: "tool",
    tool: toolName,
    toolCallId,
    status: "running",
    toolOutput: "",
  }
  const next = withReplayEventMeta({
    ...current,
    ...definedRecord(patch),
    id: stringValue(current.id) || `tool-${toolCallId}`,
    type: "tool",
    tool: toolName,
    toolCallId,
  }, meta)
  if (index >= 0) {
    parts[index] = next
  } else {
    parts.push(next)
  }
  assistant.parts = parts
}

function replayPatchToolPart(
  turns: unknown[],
  toolCallId: string | undefined,
  approvalId: string | undefined,
  patch: Record<string, unknown>,
  meta: { eventKey?: string; sessionEventSeq?: number }
): void {
  const assistant = ensureReplayAssistantMessage(turns)
  assistant.parts = arrayValue(assistant.parts).map((rawPart) => {
    const part = objectValue(rawPart)
    if (stringValue(part.type) !== "tool") return rawPart
    if (toolCallId && stringValue(part.toolCallId) !== toolCallId) return rawPart
    if (!toolCallId && approvalId && stringValue(part.approvalId) !== approvalId) return rawPart
    return withReplayEventMeta({ ...part, ...definedRecord(patch) }, meta)
  })
}

function findReplayToolPart(
  turns: unknown[],
  toolCallId: string | undefined
): Record<string, unknown> | undefined {
  if (!toolCallId) return undefined
  for (const rawTurn of turns) {
    const turn = objectValue(rawTurn)
    for (const rawMessage of arrayValue(turn.assistantMessages)) {
      for (const rawPart of arrayValue(objectValue(rawMessage).parts)) {
        const part = objectValue(rawPart)
        if (stringValue(part.type) === "tool" && stringValue(part.toolCallId) === toolCallId) {
          return part
        }
      }
    }
  }
  return undefined
}

function requiredReplayToolCallId(payload: Record<string, unknown>): string | undefined {
  return stringValue(payload.tool_call_id) || stringValue(payload.toolCallId)
}

function definedRecord(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined))
}

function isReplayStructuredUiEvent(type: string): boolean {
  return [
    "remote_event",
    "mcp_event",
    "model_event",
    "session_event",
    "command_event",
    "approval_event",
    "system_event",
    "agent_event",
    "ui_event",
  ].includes(type)
}

function replayUiEventTitle(type: string): string {
  const labels: Record<string, string> = {
    remote_event: "远程事件",
    mcp_event: "MCP 事件",
    model_event: "模型事件",
    session_event: "会话事件",
    command_event: "命令事件",
    approval_event: "审批事件",
    system_event: "系统事件",
    agent_event: "智能体事件",
    ui_event: "运行事件",
  }
  return labels[type] || "运行事件"
}

function mergeSnapshotTurnsWithMessageHistory(
  snapshotTurns: unknown[],
  messages: unknown[],
  fallbackTurns: unknown[]
): unknown[] {
  const turns = cloneArray(snapshotTurns)
  const assistantGroups = assistantContentsByTurn(messages)

  for (let turnIndex = 0; turnIndex < turns.length && turnIndex < assistantGroups.length; turnIndex += 1) {
    const authoritativeFinal = assistantGroups[turnIndex][assistantGroups[turnIndex].length - 1]
    if (!authoritativeFinal) continue
    turns[turnIndex] = patchTurnFinalAssistantText(turns[turnIndex], authoritativeFinal, turnIndex)
  }

  if (turns.length < fallbackTurns.length) {
    turns.push(...cloneArray(fallbackTurns.slice(turns.length)))
  }

  if (assistantTextLength(turns) === 0 && assistantTextLength(fallbackTurns) > 0) {
    return cloneArray(fallbackTurns)
  }
  return turns
}

function assistantContentsByTurn(messages: unknown[]): string[][] {
  const groups: string[][] = []
  let currentTurnIndex = -1
  for (const raw of messages) {
    const message = objectValue(raw)
    const role = stringValue(message.role)
    if (role === "user") {
      groups.push([])
      currentTurnIndex = groups.length - 1
      continue
    }
    if (role !== "assistant") continue
    const content = messageContent(message.content)
    if (!content) continue
    if (currentTurnIndex < 0) {
      groups.push([])
      currentTurnIndex = 0
    }
    groups[currentTurnIndex].push(content)
  }
  return groups
}

function patchTurnFinalAssistantText(
  rawTurn: unknown,
  authoritativeFinal: string,
  turnIndex: number
): Record<string, unknown> {
  const turn = objectValue(rawTurn)
  const assistantMessages = cloneArray(arrayValue(turn.assistantMessages))
  let targetIndex = assistantMessages.length - 1
  if (targetIndex < 0) {
    targetIndex = 0
    assistantMessages.push({
      id: `assistant-final-${turnIndex}`,
      role: "assistant",
      parts: [],
    })
  }
  assistantMessages[targetIndex] = patchAssistantMessageFinalText(
    assistantMessages[targetIndex],
    authoritativeFinal,
    turnIndex,
    targetIndex
  )
  return {
    ...turn,
    assistantMessages,
  }
}

function patchAssistantMessageFinalText(
  rawMessage: unknown,
  authoritativeFinal: string,
  turnIndex: number,
  messageIndex: number
): Record<string, unknown> {
  const message = objectValue(rawMessage)
  const parts = cloneArray(arrayValue(message.parts))
  const textPartIndex = findLastTextPartIndex(parts)
  const currentFinal =
    textPartIndex >= 0
      ? textValue(objectValue(parts[textPartIndex]).text)
      : textValue(message.text)
  if (authoritativeFinal.length <= currentFinal.length) return message

  const nextParts = [...parts]
  if (textPartIndex >= 0) {
    const part = objectValue(nextParts[textPartIndex])
    nextParts[textPartIndex] = {
      ...part,
      type: "text",
      text: authoritativeFinal,
      textFormat: stringValue(part.textFormat) || "markdown",
    }
  } else {
    nextParts.push({
      id: `assistant-final-part-${turnIndex}-${messageIndex}`,
      type: "text",
      text: authoritativeFinal,
      textFormat: "markdown",
    })
  }

  return {
    ...message,
    text: authoritativeFinal,
    parts: nextParts,
  }
}

function findLastTextPartIndex(parts: unknown[]): number {
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    if (stringValue(objectValue(parts[index]).type) === "text") return index
  }
  return -1
}

function assistantTextLength(turns: unknown[]): number {
  return turns.reduce<number>((sum, rawTurn) => {
    const turn = objectValue(rawTurn)
    return sum + arrayValue(turn.assistantMessages).reduce<number>((messageSum, rawMessage) => {
      const message = objectValue(rawMessage)
      const partTextLength = arrayValue(message.parts).reduce<number>((partSum, rawPart) => {
        const part = objectValue(rawPart)
        return partSum + textValue(part.text).length
      }, 0)
      return messageSum + Math.max(textValue(message.text).length, partTextLength)
    }, 0)
  }, 0)
}

function buildBundleFromMessages(
  metadata: SessionMetadataState,
  messages: unknown[]
): Record<string, unknown> {
  const turns: Record<string, unknown>[] = []
  let pendingTurn: Record<string, unknown> | undefined
  let displayIndex = 0
  const ensurePendingTurn = () => {
    if (!pendingTurn) {
      pendingTurn = {
        userMessage: {
          id: `${metadata.id}-user-${displayIndex}`,
          role: "user",
          text: "",
          parts: [],
          timestamp: Date.parse(metadata.savedAt) || Date.now(),
        },
        assistantMessages: [],
      }
      turns.push(pendingTurn)
    }
    return pendingTurn
  }
  for (const raw of messages) {
    const message = objectValue(raw)
    const role = stringValue(message.role)
    const content = messageContent(message.content)
    if (!content || role === "system") continue
    if (role === "user") {
      pendingTurn = {
        userMessage: {
          id: `${metadata.id}-user-${displayIndex}`,
          role: "user",
          text: content,
          parts: [],
          timestamp: Date.parse(metadata.savedAt) || Date.now(),
        },
        assistantMessages: [],
      }
      turns.push(pendingTurn)
      displayIndex += 1
    } else if (role === "assistant") {
      pendingTurn = ensurePendingTurn()
      const assistantMessages = arrayValue(pendingTurn.assistantMessages)
      assistantMessages.push({
        id: `${metadata.id}-assistant-${displayIndex}`,
        role: "assistant",
        text: content,
        parts: [
          {
            id: `${metadata.id}-assistant-part-${displayIndex}`,
            type: "text",
            text: content,
            textFormat: "markdown",
          },
        ],
        timestamp: Date.parse(metadata.savedAt) || Date.now(),
      })
      pendingTurn.assistantMessages = assistantMessages
      displayIndex += 1
    } else if (role === "tool") {
      pendingTurn = ensurePendingTurn()
      const assistantMessages = arrayValue(pendingTurn.assistantMessages)
      assistantMessages.push({
        id: `${metadata.id}-tool-result-${displayIndex}`,
        role: "assistant",
        text: "",
        parts: [
          {
            id: `${metadata.id}-tool-result-part-${displayIndex}`,
            type: "tool",
            tool: stringValue(message.name) || "tool",
            toolCallId: stringValue(message.tool_call_id),
            status: "returned",
            toolOutput: content,
            toolOutputFormat: "plain",
          },
        ],
        timestamp: Date.parse(metadata.savedAt) || Date.now(),
      })
      pendingTurn.assistantMessages = assistantMessages
      displayIndex += 1
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
    turns: enrichTurnsWithHistoryMapping(turns, messages),
    traceNodes: [],
    traceEdges: [],
  }
}

function enrichTurnsWithHistoryMapping(
  turns: unknown[],
  messages: unknown[]
): unknown[] {
  const conversation = cloneArray(turns)
  if (!conversation.length) return conversation

  const conversationIndexes = messages
    .map((rawMessage, rawIndex) => ({
      rawIndex,
      message: objectValue(rawMessage),
    }))
    .filter(({ message }) => isConversationMessage(message))

  const userPositions = conversationIndexes
    .map((entry, position) => ({ ...entry, position }))
    .filter((entry) => stringValue(entry.message.role) === "user")

  for (let turnIndex = 0; turnIndex < conversation.length && turnIndex < userPositions.length; turnIndex += 1) {
    const turn = objectValue(conversation[turnIndex])
    const userPosition = userPositions[turnIndex]
    const nextUserPosition = userPositions[turnIndex + 1]?.position ?? conversationIndexes.length
    const segmentEndEntry = conversationIndexes[Math.max(userPosition.position, nextUserPosition - 1)]
    const firstResponseEntry = conversationIndexes[userPosition.position + 1]
    const historyMessageIndex = firstResponseEntry?.rawIndex ?? segmentEndEntry?.rawIndex ?? userPosition.rawIndex
    const historyCutIndex = segmentEndEntry?.rawIndex ?? userPosition.rawIndex
    const userMessage = objectValue(turn.userMessage)
    turn.userMessage = {
      ...userMessage,
      historyMessageIndex: userPosition.rawIndex,
      historyCutIndex: userPosition.rawIndex,
    }
    turn.assistantMessages = arrayValue(turn.assistantMessages).map((rawAssistantMessage) => {
      const assistantMessage = objectValue(rawAssistantMessage)
      return {
        ...assistantMessage,
        historyMessageIndex,
        historyCutIndex,
        parts: arrayValue(assistantMessage.parts).map((rawPart) =>
          enrichPartHistoryCutIndex(rawPart, historyCutIndex)
        ),
      }
    })
    conversation[turnIndex] = turn
  }

  return conversation
}

function enrichPartHistoryCutIndex(rawPart: unknown, historyCutIndex: number): Record<string, unknown> {
  const part = objectValue(rawPart)
  const type = stringValue(part.type)
  if (
    type !== "tool" &&
    type !== "terminal" &&
    type !== "session" &&
    type !== "parallel_tools" &&
    type !== "parallel_sessions"
  ) {
    return part
  }
  return {
    ...part,
    historyCutIndex,
  }
}

function cloneArray<T>(value: T[]): T[] {
  return JSON.parse(JSON.stringify(value)) as T[]
}

function isConversationMessage(message: Record<string, unknown>): boolean {
  const role = stringValue(message.role)
  if (role !== "user" && role !== "assistant" && role !== "tool") {
    return false
  }
  if (messageContent(message.content)) return true
  if (arrayValue(message.parts).length > 0) return true
  if (arrayValue(message.tool_calls).length > 0) return true
  return role === "tool"
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

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}
