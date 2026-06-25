import type * as vscode from "vscode"
import type { LabrastroRemoteClient } from "../LabrastroRemoteClient"
import type { ApprovalDocumentProvider } from "../ApprovalDocumentProvider"
import type { PostMessage } from "../WebviewBus"
import type { WebviewToHostMessage } from "../protocol/messages"
import { chatErrorMessage, numberValue, objectValue, stringValue } from "../controller-utils"
import { sessionRunStartTargetBranchBindingId } from "../sessionRunOperationResults"
import type { SessionRunOperationSourceScope } from "./SessionRunSourceIdentityResolver"

const SELECTED_MAINLINE_SNAPSHOT_KEY = "labrastro.selectedMainlineSnapshot"

function sessionRunOperationIdFromMessage(message: WebviewToHostMessage): string | undefined {
  const record = message as Record<string, unknown>
  return stringValue(record.operationId)
}

function sessionRunSubmitOperationKindFromMessage(
  message: WebviewToHostMessage,
): "start" | "continue" | undefined {
  const record = message as Record<string, unknown>
  const kind = stringValue(record.operationKind) || stringValue(record.operation_kind)
  return kind === "start" || kind === "continue" ? kind : undefined
}

export type SelectedMainlineSnapshotStatus =
  | "starting"
  | "running"
  | "reconnecting"
  | "settled"
  | "waiting_user"
  | "blocked"
  | "closed"
  | "cancelled"
  | "failed"
  | "unrecoverable"

export type SelectedMainlineState =
  | "none"
  | "starting"
  | "executing"
  | "waiting_user"
  | "settled"
  | "closed"
  | "cancelled"
  | "failed"
  | "blocked"
  | "unrecoverable"

export type SelectedActivationState =
  | "none"
  | "queued"
  | "dispatched"
  | "running"
  | "waiting_server"
  | "waiting_user"
  | "completed"
  | "failed"
  | "cancelled"
  | "blocked"

export type SelectedBindingStatus = "none" | "pending" | "active" | "closed" | "deleted"
export type SelectedProjectionState = "live" | "recovered" | "drained" | "unavailable" | "nonrecoverable"
export type SelectedTransportState = "disconnected" | "connecting" | "streaming" | "reconnecting" | "closed" | "error"

export interface SelectedMainlineSnapshot {
  sessionRunId: string
  cursor: number
  sessionId?: string
  draftSessionId?: string
  status: SelectedMainlineSnapshotStatus
  agentRunId?: string
  activationId?: string
  branchBindingId?: string
  mainlineState?: SelectedMainlineState
  agentRunState?: string
  activationState?: SelectedActivationState
  bindingStatus?: SelectedBindingStatus
  projectionState?: SelectedProjectionState
  transportState?: SelectedTransportState
  working?: boolean
  continuable?: boolean
  recoverable?: boolean
  eventStreamAllowed?: boolean
  closedReason?: string
  startedAt: string
  reconnectAttempts: number
  reconnectStartedAt?: number
  lastError?: string
  lastStreamAt?: string
  nextRetryAt?: number
  pendingNextTurn?: PendingNextTurn
  pendingNextTurnsByBranch?: Record<string, PendingNextTurn[]>
  branches?: Record<string, unknown>[]
}

export interface PendingNextTurn {
  text: string
  sessionRunId?: string
  branchBindingId?: string
  clientRequestId?: string
  locale?: string
  mentions?: Record<string, unknown>[]
  queuedAt: string
}

export type HostSessionSubmitDispositionKind =
  | "start"
  | "continue"
  | "queue_next_turn"
  | "blocked"
  | "disabled"

export interface HostSessionSubmitDisposition {
  kind: HostSessionSubmitDispositionKind
  reason: string
  proof: {
    activeSessionRunId?: string
    proofSessionRunId?: string
    proofBranchBindingId?: string
    activeStatus?: SelectedMainlineSnapshot["status"]
    mainlineState?: SelectedMainlineState
    activationState?: SelectedActivationState
    bindingStatus?: SelectedBindingStatus
    working?: boolean
    continuable?: boolean
    recoverable?: boolean
    eventStreamAllowed?: boolean
    projectionState?: SelectedProjectionState
    transportState?: SelectedTransportState
    currentRunSessionMatches: boolean
    startInFlight?: boolean
  }
}

interface PendingNextTurnRemoval {
  clientRequestId?: string
  queuedAt?: string
  text?: string
}

interface PendingSessionRunStart {
  operationId: string
  clientRequestId?: string
  sessionId?: string
  draftSessionId?: string
  createdAt: number
}

export interface SessionRunCoordinatorOptions {
  client: LabrastroRemoteClient
  context: vscode.ExtensionContext
  approvalDocuments: ApprovalDocumentProvider
  startSessionRun: (
    text: string,
    requestedSessionId: string | undefined,
    post: PostMessage,
    options: {
      mode?: string
      workflowMode?: string
      taskflowId?: string
      draftSessionId?: string
      clientRequestId?: string
      operationId: string
      branchBindingId?: string
      locale?: string
      providerId?: string
      modelId?: string
      parameters?: Record<string, unknown>
      mentions?: Record<string, unknown>[]
    }
  ) => Promise<void>
  continueSessionRun: (
    text: string,
    post: PostMessage,
    options: {
      sessionRunId?: string
      branchBindingId?: string
      clientRequestId?: string
      operationId: string
      sourceScope?: SessionRunOperationSourceScope
      locale?: string
      mentions?: Record<string, unknown>[]
    }
  ) => Promise<void>
  steerAgentRun: (
    text: string,
    post: PostMessage,
    options: {
      clientSteerId?: string
      operationId: string
      sessionRunId: string
      branchBindingId: string
      locale?: string
      mentions?: Record<string, unknown>[]
    }
  ) => Promise<void>
  branchSessionRun: (
    request: {
      sessionRunId: string
      baseSessionItemId: string
      prompt: string
      operationId: string
      sourceBranchBindingId?: string
      branchBindingId?: string
      sourceLabel?: string
      sourceMessageId?: string
      sourceNodeId?: string
      composeMode?: "edit" | "fork"
    },
    post: PostMessage
  ) => Promise<void>
  selectSessionRunBranch: (
    request: {
      sessionRunId: string
      sourceBranchBindingId?: string
      branchBindingId: string
      operationId: string
    },
    post: PostMessage
  ) => Promise<void>
  cancelSessionRun: (
    sessionRunId: string,
    branchBindingId: string,
    post: PostMessage,
    options: {
      operationId: string
      reason?: string
    }
  ) => Promise<void>
  stopSessionRun: (
    sessionRunId: string,
    branchBindingId: string,
    post: PostMessage,
    options: {
      operationId: string
    }
  ) => Promise<void>
  recoverSessionRun: (
    sessionRunId: string,
    branchBindingId: string,
    action: "continue" | "retry",
    post: PostMessage,
    options: {
      operationId: string
    }
  ) => Promise<void>
  postConnectionStateIfAuthRequired: (error: unknown, post: PostMessage) => Promise<void>
}

export class SessionRunCoordinator {
  private run: SelectedMainlineSnapshot | undefined
  private draftSessionId: string | undefined
  private runIdentityRevision = 0
  private runProjectionRevision = 0
  private pendingSessionRunStart: PendingSessionRunStart | undefined

  constructor(private readonly options: SessionRunCoordinatorOptions) {
    this.run = selectedMainlineSnapshotFromPayload(
      this.options.context.workspaceState.get<Record<string, unknown>>(SELECTED_MAINLINE_SNAPSHOT_KEY)
    )
    this.draftSessionId = this.run?.draftSessionId
  }

  get selectedMainlineSnapshot(): SelectedMainlineSnapshot | undefined {
    return this.run
  }

  get selectedMainlineIdentityRevision(): number {
    return this.runIdentityRevision
  }

  get selectedMainlineProjectionRevision(): number {
    return this.runProjectionRevision
  }

  get activeSessionRunId(): string | undefined {
    return this.run?.sessionRunId
  }

  get activeDraftSessionId(): string | undefined {
    return this.draftSessionId
  }

  setActiveDraftSessionId(sessionId: string | undefined): void {
    this.draftSessionId = sessionId
  }

  clearActiveDraftSessionId(): void {
    this.draftSessionId = undefined
  }

  isActive(): boolean {
    return Boolean(this.run?.sessionRunId)
  }

  selectedMainlineSnapshotPayload(): Record<string, unknown> | undefined {
    return this.run ? selectedMainlineSnapshotPayload(this.run) : undefined
  }

  pendingNextTurnForBranch(
    sessionRunId: string | undefined,
    branchBindingId: string | undefined,
  ): PendingNextTurn | undefined {
    if (!sessionRunId || !branchBindingId) return undefined
    const queue = this.run?.pendingNextTurnsByBranch?.[pendingNextTurnKey(sessionRunId, branchBindingId)]
    return queue?.[0]
  }

  pendingNextTurnsForBranch(
    sessionRunId: string | undefined,
    branchBindingId: string | undefined,
  ): PendingNextTurn[] {
    if (!sessionRunId || !branchBindingId) return []
    const queue = this.run?.pendingNextTurnsByBranch?.[pendingNextTurnKey(sessionRunId, branchBindingId)]
    return queue ? [...queue] : []
  }

  private hasPendingSessionRunStart(): boolean {
    return Boolean(this.pendingSessionRunStart)
  }

  private beginPendingSessionRunStart(start: PendingSessionRunStart): void {
    this.pendingSessionRunStart = start
  }

  private clearPendingSessionRunStart(operationId?: string): void {
    if (!this.pendingSessionRunStart) return
    if (operationId && this.pendingSessionRunStart.operationId !== operationId) return
    this.pendingSessionRunStart = undefined
  }

  private postPendingSessionRunStartError(post: PostMessage, operationId: string): void {
    const branchBindingId = sessionRunStartTargetBranchBindingId()
    post({
      type: "sessionRun.operation.error",
      operationId,
      operationKind: "start",
      branchBindingId,
      branch_binding_id: branchBindingId,
      message: "会话运行正在启动，请稍候后再发送。",
    })
  }

  private postBlockedSessionSubmitError(
    post: PostMessage,
    operationId: string,
    disposition: HostSessionSubmitDisposition,
    proof?: { sessionRunId: string; branchBindingId: string },
  ): void {
    post({
      type: "sessionRun.operation.error",
      operationId,
      operationKind: "continue",
      ...(proof?.sessionRunId ? { sessionRunId: proof.sessionRunId } : {}),
      ...(proof?.branchBindingId
        ? {
            branchBindingId: proof.branchBindingId,
            branch_binding_id: proof.branchBindingId,
          }
        : {}),
      message: hostSessionSubmitBlockedMessage(disposition.reason),
      reason: disposition.reason,
    })
  }

  shiftPendingNextTurnForBranch(
    sessionRunId: string | undefined,
    branchBindingId: string | undefined,
  ): PendingNextTurn | undefined {
    if (!this.run || !sessionRunId || !branchBindingId) return undefined
    const key = pendingNextTurnKey(sessionRunId, branchBindingId)
    const current = this.run.pendingNextTurnsByBranch?.[key] || []
    const [nextTurn, ...remaining] = current
    if (!nextTurn) return undefined
    const pendingNextTurnsByBranch = { ...(this.run.pendingNextTurnsByBranch || {}) }
    if (remaining.length) pendingNextTurnsByBranch[key] = remaining
    else delete pendingNextTurnsByBranch[key]
    this.patchSelectedMainlineSnapshot({ pendingNextTurnsByBranch, pendingNextTurn: undefined })
    return nextTurn
  }

  removePendingNextTurnForBranch(
    sessionRunId: string | undefined,
    branchBindingId: string | undefined,
    removal: PendingNextTurnRemoval,
  ): void {
    if (!this.run || !sessionRunId || !branchBindingId) return
    const key = pendingNextTurnKey(sessionRunId, branchBindingId)
    const current = this.run.pendingNextTurnsByBranch?.[key] || []
    const index = current.findIndex((item) => pendingNextTurnMatchesRemoval(item, removal))
    if (index < 0) return
    const remaining = [...current.slice(0, index), ...current.slice(index + 1)]
    const pendingNextTurnsByBranch = { ...(this.run.pendingNextTurnsByBranch || {}) }
    if (remaining.length) pendingNextTurnsByBranch[key] = remaining
    else delete pendingNextTurnsByBranch[key]
    this.patchSelectedMainlineSnapshot({ pendingNextTurnsByBranch, pendingNextTurn: undefined })
  }

  clearPendingNextTurnForBranch(
    sessionRunId: string | undefined,
    branchBindingId: string | undefined,
  ): void {
    if (!this.run || !sessionRunId || !branchBindingId) return
    const key = pendingNextTurnKey(sessionRunId, branchBindingId)
    const pendingNextTurnsByBranch = { ...(this.run.pendingNextTurnsByBranch || {}) }
    delete pendingNextTurnsByBranch[key]
    this.patchSelectedMainlineSnapshot({ pendingNextTurnsByBranch, pendingNextTurn: undefined })
  }

  enqueuePendingNextTurnForBranch(
    sessionRunId: string | undefined,
    branchBindingId: string | undefined,
    pendingNextTurn: PendingNextTurn,
  ): void {
    if (!sessionRunId || !branchBindingId) return
    this.enqueuePendingNextTurn(sessionRunId, branchBindingId, {
      ...pendingNextTurn,
      sessionRunId,
      branchBindingId,
    })
  }

  private enqueuePendingNextTurn(
    sessionRunId: string,
    branchBindingId: string,
    pendingNextTurn: PendingNextTurn,
  ): void {
    const key = pendingNextTurnKey(sessionRunId, branchBindingId)
    const pendingNextTurnsByBranch = { ...(this.run?.pendingNextTurnsByBranch || {}) }
    pendingNextTurnsByBranch[key] = [
      ...(pendingNextTurnsByBranch[key] || []),
      pendingNextTurn,
    ]
    this.patchSelectedMainlineSnapshot({ pendingNextTurnsByBranch })
  }

  setSelectedMainlineSnapshot(run: SelectedMainlineSnapshot | undefined): void {
    const previousIdentity = selectedMainlineIdentityKey(this.run)
    const previousProjection = selectedMainlineStateKey(this.run)
    const nextRun = run ? normalizeSelectedMainlineSnapshot(run) : undefined
    const nextIdentity = selectedMainlineIdentityKey(nextRun)
    const nextProjection = selectedMainlineStateKey(nextRun)
    this.run = nextRun
    if (nextRun?.sessionRunId) this.clearPendingSessionRunStart()
    if (previousIdentity !== nextIdentity) this.runIdentityRevision += 1
    if (previousProjection !== nextProjection) this.runProjectionRevision += 1
    void this.options.context.workspaceState.update(
      SELECTED_MAINLINE_SNAPSHOT_KEY,
      this.run ? selectedMainlineSnapshotPayload(this.run) : undefined
    )
  }

  patchSelectedMainlineSnapshot(patch: Partial<SelectedMainlineSnapshot>): SelectedMainlineSnapshot | undefined {
    if (!this.run) return undefined
    const next = { ...this.run, ...patch }
    this.setSelectedMainlineSnapshot(next)
    return next
  }

  clearSelectedMainlineSnapshot(): void {
    this.clearPendingSessionRunStart()
    this.setSelectedMainlineSnapshot(undefined)
    this.clearActiveDraftSessionId()
  }

  async handleMessage(message: WebviewToHostMessage, post: PostMessage): Promise<boolean> {
    switch (message.type) {
      case "chat.command.dispatch": {
        const text = typeof message.text === "string" ? message.text : ""
        const commandRequestId =
          stringValue(message.clientRequestId) ||
          stringValue(message.client_request_id) ||
          stringValue(message.requestId) ||
          stringValue(message.request_id)
        const commandScope = commandRequestId ? { requestId: commandRequestId } : {}
        if (!text.trim() || !text.startsWith("/")) {
          post({
            type: "chat.command.error",
            ...commandScope,
            message: "无效指令：Chat 指令必须以 / 开头。",
          })
          return true
        }
        try {
          const result = await this.options.client.dispatchChatCommand({
            text,
            commandId: stringValue(message.commandId) || stringValue(message.command_id),
            trigger: stringValue(message.trigger),
            args: stringValue(message.args),
            sessionId: stringValue(message.sessionId) || stringValue(message.session_id),
            clientRequestId: commandRequestId,
            mentions: arrayValue(message.mentions).filter(
              (item): item is Record<string, unknown> =>
                Boolean(item && typeof item === "object" && !Array.isArray(item))
            ),
          })
          const events = arrayValue(result.events)
          if (events.length) post({ type: "chat.command.events", ...commandScope, events })
          if (result.ok === false && !events.length) {
            post({ type: "chat.command.error", ...commandScope, message: stringValue(result.error) || "指令执行失败。" })
          }
          post({ type: "chat.command.done", ...commandScope })
        } catch (error) {
          post({ type: "chat.command.error", ...commandScope, message: chatErrorMessage(error) })
          await this.options.postConnectionStateIfAuthRequired(error, post)
          post({ type: "chat.command.done", ...commandScope })
        }
        return true
      }
      case "chat.send":
        if (typeof message.text === "string") {
          const text = message.text
          const mentions = arrayValue(message.mentions).filter(
            (item): item is Record<string, unknown> =>
              Boolean(item && typeof item === "object" && !Array.isArray(item))
          )
          const clientRequestId =
            stringValue(message.clientRequestId) ||
            stringValue(message.client_request_id) ||
            stringValue(message.requestId) ||
            stringValue(message.request_id)
          const operationId = sessionRunOperationIdFromMessage(message)
          const locale = stringValue(message.locale)
          const proof = explicitSessionRunBranchProof(message)
          const operationKind = sessionRunSubmitOperationKindFromMessage(message)
          const hasSessionRunReference = Boolean(
            stringValue(message.sessionRunId) || stringValue(message.session_run_id)
          )
          const selectedMainlineSnapshot = this.selectedMainlineSnapshot
          if (operationKind === "continue" && !proof) {
            if (operationId) {
              this.postBlockedSessionSubmitError(post, operationId, {
                kind: "blocked",
                reason: "scope_mismatch",
                proof: {
                  activeSessionRunId: selectedMainlineSnapshot?.sessionRunId,
                  currentRunSessionMatches: false,
                },
              })
            }
            return true
          }
          if (selectedMainlineSnapshot?.sessionRunId && proof) {
            const intent = stringValue(message.intent) || stringValue(message.input_intent)
            const disposition = resolveHostSessionSubmitDisposition({
              hasText: Boolean(text.trim()),
              selectedMainlineSnapshot,
              proof,
              intent,
            })
            if (disposition.kind === "disabled") return true
            if (disposition.kind === "blocked") {
              if (operationId) this.postBlockedSessionSubmitError(post, operationId, disposition, proof)
              return true
            }
            if (!proof) return true
            const branchBindingId = proof.branchBindingId
            if (disposition.kind === "queue_next_turn") {
              const pendingNextTurn: PendingNextTurn = {
                text,
                sessionRunId: proof.sessionRunId,
                branchBindingId,
                ...(clientRequestId ? { clientRequestId } : {}),
                ...(locale ? { locale } : {}),
                ...(mentions.length ? { mentions } : {}),
                queuedAt: new Date().toISOString(),
              }
              this.enqueuePendingNextTurn(proof.sessionRunId, branchBindingId, pendingNextTurn)
              post({
                type: "sessionRun.pendingNextTurn",
                sessionRunId: proof.sessionRunId,
                branchBindingId,
                branch_binding_id: branchBindingId,
                pendingNextTurn,
                pending_next_turn: pendingNextTurn,
              })
              return true
            }
            if (!operationId) return true
            void this.options.continueSessionRun(text, post, {
              sessionRunId: proof.sessionRunId,
              branchBindingId,
              ...(clientRequestId ? { clientRequestId } : {}),
              operationId,
              ...(locale ? { locale } : {}),
              ...(mentions.length ? { mentions } : {}),
            })
            return true
          }
          if (operationKind === "continue" && proof) {
            if (!operationId) return true
            void this.options.continueSessionRun(text, post, {
              sessionRunId: proof.sessionRunId,
              branchBindingId: proof.branchBindingId,
              ...(clientRequestId ? { clientRequestId } : {}),
              operationId,
              ...(locale ? { locale } : {}),
              ...(mentions.length ? { mentions } : {}),
            })
            return true
          }
          if (hasSessionRunReference) {
            if (operationId) {
              this.postBlockedSessionSubmitError(post, operationId, {
                kind: "blocked",
                reason: "scope_mismatch",
                proof: {
                  activeSessionRunId: selectedMainlineSnapshot?.sessionRunId,
                  currentRunSessionMatches: false,
                },
              })
            }
            return true
          }
          if (selectedMainlineSnapshot?.sessionRunId && operationKind !== "start") return true
          if (!operationId) return true
          if (this.hasPendingSessionRunStart()) {
            this.postPendingSessionRunStartError(post, operationId)
            return true
          }
          const providerId = stringValue(message.providerId) || stringValue(message.provider_id)
          const modelId = stringValue(message.modelId) || stringValue(message.model_id)
          const requestedSessionId = stringValue(message.sessionId)
          const draftSessionId = stringValue(message.draftSessionId) || stringValue(message.draft_session_id)
          this.beginPendingSessionRunStart({
            operationId,
            ...(clientRequestId ? { clientRequestId } : {}),
            ...(requestedSessionId ? { sessionId: requestedSessionId } : {}),
            ...(draftSessionId ? { draftSessionId } : {}),
            createdAt: Date.now(),
          })
          const startPromise = Promise.resolve(this.options.startSessionRun(message.text, requestedSessionId, post, {
            mode: stringValue(message.mode),
            workflowMode: stringValue(message.workflowMode) || stringValue(message.workflow_mode),
            taskflowId: stringValue(message.taskflowId) || stringValue(message.taskflow_id),
            draftSessionId,
            locale,
            clientRequestId,
            operationId,
            branchBindingId: sessionRunStartTargetBranchBindingId(
              stringValue(message.branchBindingId) || stringValue(message.branch_binding_id)
            ),
            providerId,
            modelId,
            parameters: message.parameters && typeof message.parameters === "object"
              ? message.parameters as Record<string, unknown>
              : {},
            ...(mentions.length ? { mentions } : {}),
          }))
          void startPromise
            .finally(() => this.clearPendingSessionRunStart(operationId))
            .catch(() => undefined)
        }
        return true
      case "sessionRun.pendingNextTurn.remove": {
        const proof = explicitSessionRunBranchProof(message)
        if (!proof) return true
        this.removePendingNextTurnForBranch(proof.sessionRunId, proof.branchBindingId, {
          clientRequestId:
            stringValue(message.clientRequestId) ||
            stringValue(message.client_request_id) ||
            stringValue(message.requestId) ||
            stringValue(message.request_id),
          queuedAt: stringValue(message.queuedAt) || stringValue(message.queued_at),
          text: stringValue(message.text),
        })
        this.postPendingNextTurnsSnapshot(post, proof.sessionRunId, proof.branchBindingId)
        return true
      }
      case "sessionRun.pendingNextTurn.clear": {
        const proof = explicitSessionRunBranchProof(message)
        if (!proof) return true
        this.clearPendingNextTurnForBranch(proof.sessionRunId, proof.branchBindingId)
        this.postPendingNextTurnsSnapshot(post, proof.sessionRunId, proof.branchBindingId)
        return true
      }
      case "sessionRun.cancel": {
        const proof = explicitSessionRunBranchProof(message)
        if (!proof) return true
        const operationId = sessionRunOperationIdFromMessage(message)
        if (!operationId) return true
        const reason = stringValue(message.reason)
        await this.options.cancelSessionRun(
          proof.sessionRunId,
          proof.branchBindingId,
          post,
          { operationId, ...(reason ? { reason } : {}) }
        )
        return true
      }
      case "sessionRun.stop": {
        const proof = explicitSessionRunBranchProof(message)
        if (!proof) return true
        const operationId = sessionRunOperationIdFromMessage(message)
        if (!operationId) return true
        await this.options.stopSessionRun(
          proof.sessionRunId,
          proof.branchBindingId,
          post,
          { operationId }
        )
        return true
      }
      case "sessionRun.branch":
        {
          const proof = explicitSessionRunBranchProof(message)
          if (!proof) return true
          const operationId = sessionRunOperationIdFromMessage(message)
          if (!operationId) return true
          await this.options.branchSessionRun({
            sessionRunId: proof.sessionRunId,
            baseSessionItemId: stringValue(message.baseSessionItemId) || stringValue(message.base_session_item_id) || "",
            prompt: stringValue(message.prompt) || "",
            operationId,
            sourceBranchBindingId: stringValue(message.sourceBranchBindingId) || stringValue(message.source_branch_binding_id),
            branchBindingId: stringValue(message.branchBindingId) || stringValue(message.branch_binding_id),
            sourceLabel: stringValue(message.sourceLabel) || stringValue(message.source_label),
            sourceMessageId: stringValue(message.sourceMessageId) || stringValue(message.source_message_id),
            sourceNodeId: stringValue(message.sourceNodeId) || stringValue(message.source_node_id),
            composeMode: stringValue(message.composeMode) === "edit" || stringValue(message.compose_mode) === "edit"
              ? "edit"
              : "fork",
          }, post)
          return true
        }
      case "sessionRun.branch.select":
        {
          const proof = explicitSessionRunBranchProof(message)
          if (!proof) return true
          const operationId = sessionRunOperationIdFromMessage(message)
          if (!operationId) return true
          await this.options.selectSessionRunBranch({
            sessionRunId: proof.sessionRunId,
            sourceBranchBindingId: stringValue(message.sourceBranchBindingId) || stringValue(message.source_branch_binding_id),
            branchBindingId: proof.branchBindingId,
            operationId,
          }, post)
          return true
        }
      case "sessionRun.recover": {
        const proof = explicitSessionRunBranchProof(message)
        if (!proof) return true
        const operationId = sessionRunOperationIdFromMessage(message)
        if (!operationId) return true
        const rawAction = stringValue(message.action) || "continue"
        const action = rawAction === "retry" ? "retry" : "continue"
        await this.options.recoverSessionRun(proof.sessionRunId, proof.branchBindingId, action, post, { operationId })
        return true
      }
      case "approval.reply": {
        const proof = explicitSessionRunBranchProof(message)
        if (!proof) return true
        const approvalId = stringValue(message.approvalId) || ""
        const decision = stringValue(message.decision) || "deny_once"
        try {
          const explicitCandidate = objectValue(
            message.approved_save_candidate || message.approvedSaveCandidate
          )
          const storedCandidate =
            decision === "allow_once"
              ? this.options.approvalDocuments.approvedSaveCandidateFor(approvalId)
              : undefined
          const approvedSaveCandidate =
            decision === "allow_once"
              ? storedCandidate && Object.keys(storedCandidate).length
                ? storedCandidate
                : explicitCandidate
              : undefined
          const request: Record<string, unknown> = {
            session_run_id: proof.sessionRunId,
            branch_binding_id: proof.branchBindingId,
            approval_id: approvalId,
            decision,
            reason: stringValue(message.reason),
          }
          if (approvedSaveCandidate && Object.keys(approvedSaveCandidate).length) {
            request.approved_save_candidate = approvedSaveCandidate
          }
          const payload = await this.options.client.approvalReply({
            ...request,
          })
          post({
            type: "approval.reply.ok",
            sessionRunId: proof.sessionRunId,
            branchBindingId: proof.branchBindingId,
            branch_binding_id: proof.branchBindingId,
            approvalId,
            decision,
            payload,
          })
          await this.options.approvalDocuments.close(approvalId)
        } catch (error) {
          const resolvedError = chatErrorMessage(error)
          post({
            type: "approval.reply.error",
            sessionRunId: proof.sessionRunId,
            branchBindingId: proof.branchBindingId,
            branch_binding_id: proof.branchBindingId,
            approvalId,
            decision,
            message: resolvedError,
          })
          await this.options.postConnectionStateIfAuthRequired(error, post)
        }
        return true
      }
      case "sessionRun.userInput.reply": {
        const proof = explicitSessionRunBranchProof(message)
        if (!proof) return true
        const inputId = stringValue(message.inputId) || stringValue(message.input_id) || ""
        const action = stringValue(message.action) || "decline"
        const content = objectValue(message.content) || {}
        try {
          const payload = await this.options.client.sessionRunUserInputReply({
            session_run_id: proof.sessionRunId,
            branch_binding_id: proof.branchBindingId,
            input_id: inputId,
            action,
            content,
            reason: stringValue(message.reason),
          })
          post({
            type: "sessionRun.userInput.reply.ok",
            sessionRunId: proof.sessionRunId,
            branchBindingId: proof.branchBindingId,
            branch_binding_id: proof.branchBindingId,
            inputId,
            action,
            payload,
          })
        } catch (error) {
          const resolvedError = chatErrorMessage(error)
          post({
            type: "sessionRun.userInput.reply.error",
            sessionRunId: proof.sessionRunId,
            branchBindingId: proof.branchBindingId,
            branch_binding_id: proof.branchBindingId,
            inputId,
            action,
            message: resolvedError,
          })
          await this.options.postConnectionStateIfAuthRequired(error, post)
        }
        return true
      }
      case "approval.openDetails":
        await this.options.approvalDocuments.open(stringValue(message.approvalId) || "")
        return true
      case "taskflow.state.get":
        return this.handleTaskflowAction(message, post, "taskflow.state", message.type, (taskflowId) =>
          this.options.client.getTaskflowState(taskflowId)
        )
      case "taskflow.workspace.get":
        return this.handleTaskflowAction(message, post, "taskflow.workspace", message.type, (taskflowId) =>
          this.options.client.getTaskflowWorkspace(taskflowId)
        )
      case "taskflow.projectMemory.get":
        return this.handleTaskflowAction(message, post, "taskflow.projectMemory", message.type, (taskflowId) =>
          this.options.client.getTaskflowProjectMemory(taskflowId)
        )
      case "taskflow.runtime.get":
        return this.handleTaskflowAction(message, post, "taskflow.runtime", message.type, (taskflowId) =>
          this.options.client.getTaskflowRuntime(taskflowId)
        )
      case "taskflow.reviewCardV1.action":
        return this.handleTaskflowAction(message, post, "taskflow.workspace", message.type, (taskflowId) =>
          this.options.client.answerTaskflowReviewCardV1(
            taskflowId,
            stringValue(message.cardId) || "",
            {
              action: stringValue(message.action) || "",
              value: message.value,
              actor: stringValue(message.actor),
              comment: stringValue(message.comment) || stringValue(message.reason),
            }
          )
        )
      case "taskflow.projectMemory.patch.preview":
        return this.handleTaskflowAction(message, post, "taskflow.projectMemory.patchPreview", message.type, (taskflowId) =>
          this.options.client.previewTaskflowProjectMemoryPatch(taskflowId, {
            actor: stringValue(message.actor),
            reason: stringValue(message.reason),
            source: stringValue(message.source),
            operations: arrayValue(message.operations),
          })
        )
      case "taskflow.projectMemory.patch.apply":
        return this.handleTaskflowAction(message, post, "taskflow.workspace", message.type, (taskflowId) =>
          this.options.client.applyTaskflowProjectMemoryPatch(
            taskflowId,
            stringValue(message.proposalId) || "",
            {
              actor: stringValue(message.actor),
              reason: stringValue(message.reason),
              source: stringValue(message.source),
              operations: arrayValue(message.operations),
            }
          )
        )
      case "taskflow.compilerDecision.review":
        return this.handleTaskflowAction(message, post, "taskflow.workspace", message.type, (taskflowId) =>
          this.options.client.reviewTaskflowCompilerDecision(
            taskflowId,
            stringValue(message.decisionId) || "",
            {
              action: stringValue(message.action),
              actor: stringValue(message.actor),
              reason: stringValue(message.reason),
              value: message.value,
            }
          )
        )
      case "taskflow.projectorPreview.get":
        return this.handleTaskflowAction(message, post, "taskflow.projectorPreview", message.type, (taskflowId) =>
          this.options.client.getTaskflowProjectorPreview(
            taskflowId,
            stringValue(message.target) || "openspec"
          )
        )
      case "taskflow.brief.compile":
        return this.handleTaskflowAction(message, post, "taskflow.state", message.type, (taskflowId) =>
          this.options.client.compileTaskflowBrief(taskflowId, { actor: stringValue(message.actor) })
        )
      case "taskflow.brief.ready":
        return this.handleTaskflowAction(message, post, "taskflow.state", message.type, (taskflowId) =>
          this.options.client.markTaskflowBriefReady(taskflowId, {
            version: numberValue(message.version),
            actor: stringValue(message.actor),
          })
        )
      case "taskflow.brief.confirm":
        return this.handleTaskflowAction(message, post, "taskflow.state", message.type, (taskflowId) =>
          this.options.client.confirmTaskflowBrief(taskflowId, {
            version: numberValue(message.version),
            actor: stringValue(message.actor),
          })
        )
      case "taskflow.goal.compile":
        return this.handleTaskflowAction(message, post, "taskflow.state", message.type, (taskflowId) =>
          this.options.client.compileTaskflowGoal(taskflowId)
        )
      case "taskflow.dispatch.request":
        return this.handleTaskflowAction(message, post, "taskflow.state", message.type, (taskflowId) =>
          this.options.client.requestTaskflowDispatch(taskflowId, {
            workItemIds: stringList(message.workItemIds),
            actor: stringValue(message.actor),
            rationale: stringValue(message.rationale),
            metadata: message.metadata ? objectValue(message.metadata) : undefined,
          })
        )
      case "taskflow.dispatch.confirm":
        return this.handleTaskflowAction(message, post, "taskflow.state", message.type, (taskflowId) =>
          this.options.client.confirmTaskflowDispatch(
            taskflowId,
            stringValue(message.decisionId) || "",
            { actor: stringValue(message.actor) }
          )
        )
      case "taskflow.dispatch.reject":
        return this.handleTaskflowAction(message, post, "taskflow.state", message.type, (taskflowId) =>
          this.options.client.rejectTaskflowDispatch(
            taskflowId,
            stringValue(message.decisionId) || "",
            { actor: stringValue(message.actor) }
          )
        )
      case "taskflow.workItem.dispatch":
        return this.handleTaskflowAction(message, post, "taskflow.state", message.type, (taskflowId) =>
          this.options.client.dispatchTaskflowWorkItem(
            taskflowId,
            stringValue(message.workItemId) || "",
            {
              dispatchDecisionId: stringValue(message.dispatchDecisionId),
              executorHint: stringValue(message.executorHint),
              metadata: message.metadata ? objectValue(message.metadata) : undefined,
            }
          )
        )
      case "taskflow.complexity.get": {
        const taskflowId = stringValue(message.taskflowId)
        if (!taskflowId) return true
        try {
          const payload = await this.options.client.getTaskflowComplexity(taskflowId)
          post({ type: "taskflow.complexity", taskflowId, payload })
        } catch (error) {
          post({ type: "taskflow.complexity.error", taskflowId, message: chatErrorMessage(error) })
          await this.options.postConnectionStateIfAuthRequired(error, post)
        }
        return true
      }
      case "taskflow.complexity.scan": {
        const taskflowId = stringValue(message.taskflowId)
        if (!taskflowId) return true
        try {
          const payload = await this.options.client.scanTaskflowRepoComplexity(taskflowId, {
            workspacePath: stringValue(message.workspacePath),
            repositoryId: stringValue(message.repositoryId),
          })
          post({ type: "taskflow.complexity", taskflowId, payload })
        } catch (error) {
          post({ type: "taskflow.complexity.error", taskflowId, message: chatErrorMessage(error) })
          await this.options.postConnectionStateIfAuthRequired(error, post)
        }
        return true
      }
      default:
        return false
    }
  }

  postPendingNextTurnsSnapshot(
    post: PostMessage,
    sessionRunId: string,
    branchBindingId: string,
  ): void {
    const items = this.pendingNextTurnsForBranch(sessionRunId, branchBindingId)
    post({
      type: "sessionRun.pendingNextTurns",
      sessionRunId,
      session_run_id: sessionRunId,
      branchBindingId,
      branch_binding_id: branchBindingId,
      items,
      pendingNextTurn: items[0],
      pending_next_turn: items[0],
    })
  }

  private async handleTaskflowAction(
    message: WebviewToHostMessage,
    post: PostMessage,
    responseType: "taskflow.state" | "taskflow.workspace" | "taskflow.projectMemory" | "taskflow.projectMemory.patchPreview" | "taskflow.projectorPreview" | "taskflow.runtime",
    action: string,
    invoke: (taskflowId: string) => Promise<Record<string, unknown>>
  ): Promise<boolean> {
    const taskflowId = stringValue(message.taskflowId)
    if (!taskflowId) return true
    try {
      const payload = await invoke(taskflowId)
      if (responseType === "taskflow.state") {
        post({ type: responseType, taskflowId, action, payload })
      } else {
        post({ type: responseType, taskflowId, payload })
      }
    } catch (error) {
      post({
        type: "taskflow.action.error",
        taskflowId,
        action,
        message: chatErrorMessage(error),
      })
      await this.options.postConnectionStateIfAuthRequired(error, post)
    }
    return true
  }
}

export function selectedMainlineSnapshotPayload(run: SelectedMainlineSnapshot): Record<string, unknown> {
  return {
    sessionRunId: run.sessionRunId,
    session_run_id: run.sessionRunId,
    cursor: run.cursor,
    sessionId: run.sessionId,
    session_id: run.sessionId,
    draftSessionId: run.draftSessionId,
    draft_session_id: run.draftSessionId,
    agentRunId: run.agentRunId,
    agent_run_id: run.agentRunId,
    activationId: run.activationId,
    activation_id: run.activationId,
    branchBindingId: run.branchBindingId,
    branch_binding_id: run.branchBindingId,
    status: run.status,
    mainlineState: run.mainlineState,
    mainline_state: run.mainlineState,
    agentRunState: run.agentRunState,
    agent_run_state: run.agentRunState,
    activationState: run.activationState,
    activation_state: run.activationState,
    bindingStatus: run.bindingStatus,
    binding_status: run.bindingStatus,
    projectionState: run.projectionState,
    projection_state: run.projectionState,
    transportState: run.transportState,
    transport_state: run.transportState,
    working: run.working,
    continuable: run.continuable,
    recoverable: run.recoverable,
    eventStreamAllowed: run.eventStreamAllowed,
    event_stream_allowed: run.eventStreamAllowed,
    closedReason: run.closedReason,
    closed_reason: run.closedReason,
    startedAt: run.startedAt,
    started_at: run.startedAt,
    reconnectAttempts: run.reconnectAttempts,
    reconnect_attempts: run.reconnectAttempts,
    reconnectStartedAt: run.reconnectStartedAt,
    reconnect_started_at: run.reconnectStartedAt,
    lastError: run.lastError,
    last_error: run.lastError,
    lastStreamAt: run.lastStreamAt,
    last_stream_at: run.lastStreamAt,
    nextRetryAt: run.nextRetryAt,
    next_retry_at: run.nextRetryAt,
    pendingNextTurn: selectedPendingNextTurn(run),
    pending_next_turn: selectedPendingNextTurn(run),
    pendingNextTurnsByBranch: run.pendingNextTurnsByBranch,
    pending_next_turns_by_branch: run.pendingNextTurnsByBranch,
    branches: run.branches,
  }
}

export function selectedMainlineSnapshotFromPayload(payload: unknown): SelectedMainlineSnapshot | undefined {
  const value = objectValue(payload)
  const sessionRunId = stringValue(value.sessionRunId) || stringValue(value.session_run_id)
  if (!sessionRunId) return undefined
  const branchBindingId = stringValue(value.branchBindingId) || stringValue(value.branch_binding_id)
  if (!branchBindingId) return undefined
  const cursor = numberValue(value.cursor) ?? 0
  const reconnectAttempts =
    numberValue(value.reconnectAttempts) ??
    numberValue(value.reconnect_attempts) ??
    0
  const reconnectStartedAt =
    numberValue(value.reconnectStartedAt) ??
    numberValue(value.reconnect_started_at)
  const nextRetryAt =
    numberValue(value.nextRetryAt) ??
    numberValue(value.next_retry_at)
  const status = selectedMainlineSnapshotStatusFromPayload(value)
  const mainlineState = selectedMainlineStateFromPayload(value, status)
  const activationState = selectedActivationStateFromPayload(value, status)
  const bindingStatus = selectedBindingStatusFromPayload(value, mainlineState)
  const working = booleanValue(value.working) ?? selectedActivationStateIsExecuting(activationState)
  const continuable = booleanValue(value.continuable) ?? (
    mainlineState === "settled" && bindingStatus === "active"
  )
  const recoverable = booleanValue(value.recoverable) ?? (
    bindingStatus === "active" &&
    mainlineState !== "cancelled" &&
    mainlineState !== "closed" &&
    mainlineState !== "failed" &&
    mainlineState !== "unrecoverable"
  )
  const eventStreamAllowed = booleanValue(value.eventStreamAllowed ?? value.event_stream_allowed) ?? (
    working && bindingStatus === "active"
  )
  const projectionState = selectedProjectionStateFromPayload(value, mainlineState, eventStreamAllowed)
  const transportState = selectedTransportStateFromPayload(value, eventStreamAllowed)
  const camelPendingNextTurn = objectValue(value.pendingNextTurn)
  const pendingNextTurnValue = Object.keys(camelPendingNextTurn).length
    ? camelPendingNextTurn
    : objectValue(value.pending_next_turn)
  const pendingNextTurn = pendingNextTurnFromPayload(pendingNextTurnValue)
  const branchQueues = pendingNextTurnsByBranchFromPayload(
    objectValue(value.pendingNextTurnsByBranch || value.pending_next_turns_by_branch)
  )
  if (pendingNextTurn && branchBindingId && !Object.keys(branchQueues).length) {
    const key = pendingNextTurnKey(sessionRunId, branchBindingId)
    branchQueues[key] = branchQueues[key]?.length ? branchQueues[key] : [{
      ...pendingNextTurn,
      sessionRunId,
      branchBindingId,
    }]
  }
  return {
    sessionRunId,
    cursor,
    sessionId: stringValue(value.sessionId) || stringValue(value.session_id),
    draftSessionId: stringValue(value.draftSessionId) || stringValue(value.draft_session_id),
    agentRunId: stringValue(value.agentRunId) || stringValue(value.agent_run_id),
    activationId: stringValue(value.activationId) || stringValue(value.activation_id),
    branchBindingId,
    status,
    mainlineState,
    agentRunState: stringValue(value.agentRunState) || stringValue(value.agent_run_state),
    activationState,
    bindingStatus,
    projectionState,
    transportState,
    working,
    continuable,
    recoverable,
    eventStreamAllowed,
    closedReason: stringValue(value.closedReason) || stringValue(value.closed_reason),
    startedAt:
      stringValue(value.startedAt) ||
      stringValue(value.started_at) ||
      new Date().toISOString(),
    reconnectAttempts,
    reconnectStartedAt,
    lastError: stringValue(value.lastError) || stringValue(value.last_error),
    lastStreamAt: stringValue(value.lastStreamAt) || stringValue(value.last_stream_at),
    nextRetryAt,
    pendingNextTurnsByBranch: branchQueues,
    pendingNextTurn: selectedPendingNextTurn({
      sessionRunId,
      branchBindingId,
      pendingNextTurnsByBranch: branchQueues,
    } as SelectedMainlineSnapshot),
    branches: arrayValue(value.branches).filter(
      (item): item is Record<string, unknown> =>
        Boolean(item && typeof item === "object" && !Array.isArray(item))
    ),
  }
}

export function resolveHostSessionSubmitDisposition(input: {
  hasText: boolean
  selectedMainlineSnapshot?: SelectedMainlineSnapshot
  proof?: { sessionRunId: string; branchBindingId: string }
  intent?: string
  disabled?: boolean
  startInFlight?: boolean
}): HostSessionSubmitDisposition {
  const currentRunSessionMatches = Boolean(
    input.selectedMainlineSnapshot?.sessionRunId &&
    input.proof?.sessionRunId === input.selectedMainlineSnapshot.sessionRunId
  )
  const mainlineState = selectedMainlineState(input.selectedMainlineSnapshot)
  const activationState = selectedActivationState(input.selectedMainlineSnapshot)
  const bindingStatus = selectedBindingStatus(input.selectedMainlineSnapshot, mainlineState)
  const working = input.selectedMainlineSnapshot?.working ?? selectedActivationStateIsExecuting(activationState)
  const continuable = input.selectedMainlineSnapshot?.continuable ?? (
    mainlineState === "settled" && bindingStatus === "active"
  )
  const recoverable = input.selectedMainlineSnapshot?.recoverable ?? (
    bindingStatus === "active" &&
    mainlineState !== "none" &&
    mainlineState !== "cancelled" &&
    mainlineState !== "closed" &&
    mainlineState !== "failed" &&
    mainlineState !== "unrecoverable"
  )
  const eventStreamAllowed = input.selectedMainlineSnapshot?.eventStreamAllowed ?? (
    working && bindingStatus === "active"
  )
  const projectionState = input.selectedMainlineSnapshot?.projectionState || (
    mainlineState === "settled" ? "drained" : eventStreamAllowed ? "live" : "unavailable"
  )
  const transportState = input.selectedMainlineSnapshot?.transportState || (
    eventStreamAllowed
      ? input.selectedMainlineSnapshot?.status === "reconnecting" ? "reconnecting" : "streaming"
      : "disconnected"
  )
  const proof = {
    ...(input.selectedMainlineSnapshot?.sessionRunId ? { activeSessionRunId: input.selectedMainlineSnapshot.sessionRunId } : {}),
    ...(input.proof?.sessionRunId ? { proofSessionRunId: input.proof.sessionRunId } : {}),
    ...(input.proof?.branchBindingId ? { proofBranchBindingId: input.proof.branchBindingId } : {}),
    ...(input.selectedMainlineSnapshot?.status ? { activeStatus: input.selectedMainlineSnapshot.status } : {}),
    mainlineState,
    activationState,
    bindingStatus,
    working,
    continuable,
    recoverable,
    eventStreamAllowed,
    projectionState,
    transportState,
    currentRunSessionMatches,
    ...(input.startInFlight ? { startInFlight: true } : {}),
  }
  if (input.disabled) return { kind: "disabled", reason: "composer_disabled", proof }
  if (!input.hasText) return { kind: "disabled", reason: "empty_text", proof }
  if (input.startInFlight) return { kind: "blocked", reason: "session_run_start_pending", proof }
  if (!input.selectedMainlineSnapshot?.sessionRunId) return { kind: "start", reason: "no_active_session_run", proof }
  if (!currentRunSessionMatches) return { kind: "blocked", reason: "active_run_not_visible", proof }

  if (selectedActivationStateIsExecuting(activationState)) {
    return {
      kind: "queue_next_turn",
      reason: "selected_branch_not_accepting_continuation",
      proof,
    }
  }
  if (mainlineState === "settled" && continuable && bindingStatus === "active") {
    return { kind: "continue", reason: "selected_branch_settled", proof }
  }
  if (mainlineState === "waiting_user") {
    return { kind: "blocked", reason: "waiting_user_action", proof }
  }
  if (mainlineState === "blocked") {
    return { kind: "blocked", reason: recoverable ? "repair_required" : "nonrecoverable", proof }
  }
  if (mainlineState === "unrecoverable") {
    return { kind: "blocked", reason: "nonrecoverable", proof }
  }
  if (
    mainlineState === "closed" ||
    mainlineState === "cancelled" ||
    mainlineState === "failed" ||
    bindingStatus === "closed" ||
    bindingStatus === "deleted"
  ) {
    return { kind: "blocked", reason: "start_new_task_required", proof }
  }
  if (projectionState === "nonrecoverable") {
    return { kind: "blocked", reason: "nonrecoverable", proof }
  }
  return { kind: "blocked", reason: "selected_mainline_state_missing", proof }
}

function selectedMainlineSnapshotStatusFromPayload(value: Record<string, unknown>): SelectedMainlineSnapshotStatus {
  const status = stringValue(value.status)
  const mainlineState = stringValue(value.mainlineState) || stringValue(value.mainline_state)
  if (mainlineState === "starting") return "starting"
  if (mainlineState === "executing") return "running"
  if (mainlineState === "waiting_user") return "waiting_user"
  if (mainlineState === "settled") return "settled"
  if (mainlineState === "blocked") return "blocked"
  if (mainlineState === "cancelled") return "cancelled"
  if (mainlineState === "closed") return "closed"
  if (mainlineState === "failed") return "failed"
  if (mainlineState === "unrecoverable") return "unrecoverable"
  if (status === "starting") return "starting"
  if (status === "reconnecting") return "reconnecting"
  if (
    status === "running" ||
    status === "queued" ||
    status === "waiting" ||
    status === "stopping"
  ) {
    return "running"
  }
  if (status === "settled" || status === "done" || status === "completed" || status === "complete" || status === "success" || status === "idle") {
    return "settled"
  }
  if (status === "waiting_user") return "waiting_user"
  if (status === "blocked") return "blocked"
  if (status === "cancelled" || status === "canceled") return "cancelled"
  if (status === "closed") return "closed"
  if (status === "failed" || status === "failure" || status === "error" || status === "interrupted") return "failed"
  if (status === "unrecoverable") return "unrecoverable"
  return "running"
}

function selectedMainlineStateFromPayload(
  value: Record<string, unknown>,
  status: SelectedMainlineSnapshotStatus,
): SelectedMainlineState {
  const parsed = stringValue(value.mainlineState) || stringValue(value.mainline_state)
  if (isSelectedMainlineState(parsed)) return parsed
  if (status === "starting") return "starting"
  if (status === "running") return "executing"
  if (
    status === "reconnecting" &&
    booleanValue(value.working) === true &&
    booleanValue(value.eventStreamAllowed ?? value.event_stream_allowed) === true
  ) {
    return "executing"
  }
  if (status === "settled") return "settled"
  if (status === "waiting_user") return "waiting_user"
  if (status === "blocked") return "blocked"
  if (status === "cancelled") return "cancelled"
  if (status === "closed") return "closed"
  if (status === "failed") return "failed"
  if (status === "unrecoverable") return "unrecoverable"
  return "none"
}

function selectedActivationStateFromPayload(
  value: Record<string, unknown>,
  status: SelectedMainlineSnapshotStatus,
): SelectedActivationState {
  const parsed = stringValue(value.activationState) || stringValue(value.activation_state)
  if (isSelectedActivationState(parsed)) return parsed
  if (status === "starting") return "queued"
  if (status === "running") return "running"
  if (
    status === "reconnecting" &&
    booleanValue(value.working) === true &&
    booleanValue(value.eventStreamAllowed ?? value.event_stream_allowed) === true
  ) {
    return "running"
  }
  if (status === "settled") return "completed"
  if (status === "waiting_user") return "waiting_user"
  if (status === "blocked") return "blocked"
  if (status === "cancelled") return "cancelled"
  if (status === "failed" || status === "unrecoverable") return "failed"
  return "none"
}

function selectedBindingStatusFromPayload(
  value: Record<string, unknown>,
  mainlineState: SelectedMainlineState,
): SelectedBindingStatus {
  const parsed = stringValue(value.bindingStatus) || stringValue(value.binding_status)
  if (isSelectedBindingStatus(parsed)) return parsed
  return selectedBindingStatus(undefined, mainlineState)
}

function selectedProjectionStateFromPayload(
  value: Record<string, unknown>,
  mainlineState: SelectedMainlineState,
  eventStreamAllowed: boolean,
): SelectedProjectionState {
  const parsed = stringValue(value.projectionState) || stringValue(value.projection_state)
  if (isSelectedProjectionState(parsed)) return parsed
  if (mainlineState === "unrecoverable") return "nonrecoverable"
  if (mainlineState === "settled") return "drained"
  return eventStreamAllowed ? "live" : "unavailable"
}

function selectedTransportStateFromPayload(
  value: Record<string, unknown>,
  eventStreamAllowed: boolean,
): SelectedTransportState {
  const parsed = stringValue(value.transportState) || stringValue(value.transport_state)
  if (isSelectedTransportState(parsed)) return parsed
  const status = stringValue(value.status)
  if (!eventStreamAllowed) return "disconnected"
  return status === "reconnecting" ? "reconnecting" : "streaming"
}

function selectedMainlineState(run: SelectedMainlineSnapshot | undefined): SelectedMainlineState {
  if (!run) return "none"
  if (run.mainlineState) return run.mainlineState
  if (run.status === "starting") return "starting"
  if (run.status === "running") return "executing"
  if (run.status === "reconnecting" && run.working === true && run.eventStreamAllowed === true) return "executing"
  if (run.status === "settled") return "settled"
  if (run.status === "waiting_user") return "waiting_user"
  if (run.status === "blocked") return "blocked"
  if (run.status === "cancelled") return "cancelled"
  if (run.status === "closed") return "closed"
  if (run.status === "failed") return "failed"
  if (run.status === "unrecoverable") return "unrecoverable"
  return "none"
}

function selectedActivationState(run: SelectedMainlineSnapshot | undefined): SelectedActivationState {
  if (!run) return "none"
  if (run.activationState) return run.activationState
  if (run.status === "starting") return "queued"
  if (run.status === "running") return "running"
  if (run.status === "reconnecting" && run.working === true && run.eventStreamAllowed === true) return "running"
  if (run.status === "settled") return "completed"
  if (run.status === "waiting_user") return "waiting_user"
  if (run.status === "blocked") return "blocked"
  if (run.status === "cancelled") return "cancelled"
  if (run.status === "failed" || run.status === "unrecoverable") return "failed"
  return "none"
}

function selectedBindingStatus(
  run: SelectedMainlineSnapshot | undefined,
  mainlineState: SelectedMainlineState,
): SelectedBindingStatus {
  if (run?.bindingStatus) return run.bindingStatus
  if (mainlineState === "none") return "none"
  if (
    mainlineState === "closed" ||
    mainlineState === "cancelled" ||
    mainlineState === "failed" ||
    mainlineState === "unrecoverable"
  ) {
    return "closed"
  }
  return "active"
}

function selectedActivationStateIsExecuting(status: SelectedActivationState): boolean {
  return status === "queued" || status === "dispatched" || status === "running" || status === "waiting_server"
}

function isSelectedMainlineState(value: string | undefined): value is SelectedMainlineState {
  return Boolean(value && [
    "none",
    "starting",
    "executing",
    "waiting_user",
    "settled",
    "closed",
    "cancelled",
    "failed",
    "blocked",
    "unrecoverable",
  ].includes(value))
}

function isSelectedActivationState(value: string | undefined): value is SelectedActivationState {
  return Boolean(value && [
    "none",
    "queued",
    "dispatched",
    "running",
    "waiting_server",
    "waiting_user",
    "completed",
    "failed",
    "cancelled",
    "blocked",
  ].includes(value))
}

function isSelectedBindingStatus(value: string | undefined): value is SelectedBindingStatus {
  return Boolean(value && ["none", "pending", "active", "closed", "deleted"].includes(value))
}

function isSelectedProjectionState(value: string | undefined): value is SelectedProjectionState {
  return Boolean(value && ["live", "recovered", "drained", "unavailable", "nonrecoverable"].includes(value))
}

function isSelectedTransportState(value: string | undefined): value is SelectedTransportState {
  return Boolean(value && ["disconnected", "connecting", "streaming", "reconnecting", "closed", "error"].includes(value))
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined
}

function hostSessionSubmitBlockedMessage(reason: string): string {
  if (reason === "session_run_start_pending") return "会话运行正在启动，请稍候后再发送。"
  if (reason === "waiting_user_action") return "当前任务正在等待审批或专用输入，请先处理等待项。"
  if (reason === "repair_required") return "当前任务需要通过修复或反馈入口继续，普通输入不会直接发送。"
  if (reason === "nonrecoverable") return "当前任务状态不可恢复，请先开启新任务。"
  if (reason === "start_new_task_required") return "当前任务已结束或取消，请先明确开启新任务。"
  if (reason === "active_run_not_visible") return "当前可继续主线不属于正在查看的会话。"
  return "当前会话运行状态不接受普通输入。"
}

function pendingNextTurnFromPayload(value: Record<string, unknown>): PendingNextTurn | undefined {
  const text = stringValue(value.text)
  if (!text) return undefined
  const clientRequestId = stringValue(value.clientRequestId) || stringValue(value.client_request_id)
  const locale = stringValue(value.locale)
  const sessionRunId = stringValue(value.sessionRunId) || stringValue(value.session_run_id)
  const branchBindingId = stringValue(value.branchBindingId) || stringValue(value.branch_binding_id)
  const mentions = arrayValue(value.mentions).filter(
    (item): item is Record<string, unknown> =>
      Boolean(item && typeof item === "object" && !Array.isArray(item))
  )
  return {
    text,
    ...(sessionRunId ? { sessionRunId } : {}),
    ...(branchBindingId ? { branchBindingId } : {}),
    ...(clientRequestId ? { clientRequestId } : {}),
    ...(locale ? { locale } : {}),
    ...(mentions.length ? { mentions } : {}),
    queuedAt: stringValue(value.queuedAt) || stringValue(value.queued_at) || new Date().toISOString(),
  }
}

function pendingNextTurnsByBranchFromPayload(value: Record<string, unknown>): Record<string, PendingNextTurn[]> {
  const queues: Record<string, PendingNextTurn[]> = {}
  for (const [key, rawQueue] of Object.entries(value)) {
    const queue = arrayValue(rawQueue)
      .map((item) => pendingNextTurnFromPayload(objectValue(item)))
      .filter((item): item is PendingNextTurn => Boolean(item))
    if (queue.length) queues[key] = queue
  }
  return queues
}

function pendingNextTurnKey(sessionRunId: string, branchBindingId: string): string {
  return `${sessionRunId}:${branchBindingId}`
}

function selectedPendingNextTurn(run: Pick<SelectedMainlineSnapshot, "sessionRunId" | "branchBindingId" | "pendingNextTurnsByBranch">): PendingNextTurn | undefined {
  const branchBindingId = run.branchBindingId
  if (!branchBindingId) return undefined
  return run.pendingNextTurnsByBranch?.[pendingNextTurnKey(run.sessionRunId, branchBindingId)]?.[0]
}

function selectedMainlineStateKey(run: SelectedMainlineSnapshot | undefined): string {
  return run ? JSON.stringify(selectedMainlineSnapshotPayload(run)) : ""
}

function selectedMainlineIdentityKey(run: SelectedMainlineSnapshot | undefined): string {
  if (!run) return ""
  return JSON.stringify({
    sessionRunId: run.sessionRunId || "",
    branchBindingId: run.branchBindingId || "",
    agentRunId: run.agentRunId || "",
  })
}

function pendingNextTurnMatchesRemoval(
  item: PendingNextTurn,
  removal: PendingNextTurnRemoval,
): boolean {
  if (removal.clientRequestId && item.clientRequestId === removal.clientRequestId) {
    return true
  }
  if (removal.queuedAt && removal.text) {
    return item.queuedAt === removal.queuedAt && item.text === removal.text
  }
  return Boolean(!removal.clientRequestId && !removal.queuedAt && removal.text && item.text === removal.text)
}

function normalizeSelectedMainlineSnapshot(run: SelectedMainlineSnapshot): SelectedMainlineSnapshot | undefined {
  const branchBindingId = run.branchBindingId
  if (!branchBindingId) return undefined
  const pendingNextTurnsByBranch = { ...(run.pendingNextTurnsByBranch || {}) }
  if (run.pendingNextTurn && !Object.keys(pendingNextTurnsByBranch).length) {
    const key = pendingNextTurnKey(run.sessionRunId, branchBindingId)
    pendingNextTurnsByBranch[key] = pendingNextTurnsByBranch[key]?.length
      ? pendingNextTurnsByBranch[key]
      : [{
          ...run.pendingNextTurn,
          sessionRunId: run.sessionRunId,
          branchBindingId,
        }]
  }
  const normalized: SelectedMainlineSnapshot = {
    ...run,
    branchBindingId,
    pendingNextTurnsByBranch,
  }
  const mainlineState = selectedMainlineState(normalized)
  const activationState = selectedActivationState(normalized)
  const bindingStatus = selectedBindingStatus(normalized, mainlineState)
  const working = normalized.working ?? selectedActivationStateIsExecuting(activationState)
  const continuable = normalized.continuable ?? (
    mainlineState === "settled" && bindingStatus === "active"
  )
  const recoverable = normalized.recoverable ?? (
    bindingStatus === "active" &&
    mainlineState !== "cancelled" &&
    mainlineState !== "closed" &&
    mainlineState !== "failed" &&
    mainlineState !== "unrecoverable"
  )
  const eventStreamAllowed = normalized.eventStreamAllowed ?? (working && bindingStatus === "active")
  return {
    ...normalized,
    status: statusFromSelectedMainlineFacts(normalized.status, mainlineState, activationState),
    mainlineState,
    activationState,
    bindingStatus,
    working,
    continuable,
    recoverable,
    eventStreamAllowed,
    projectionState: normalized.projectionState || (
      mainlineState === "settled" ? "drained" : eventStreamAllowed ? "live" : "unavailable"
    ),
    transportState: normalized.transportState || (
      eventStreamAllowed
        ? normalized.status === "reconnecting" ? "reconnecting" : "streaming"
        : "disconnected"
    ),
    pendingNextTurn: selectedPendingNextTurn(normalized),
  }
}

function statusFromSelectedMainlineFacts(
  fallback: SelectedMainlineSnapshotStatus,
  mainlineState: SelectedMainlineState,
  activationState: SelectedActivationState,
): SelectedMainlineSnapshotStatus {
  if (fallback === "reconnecting" && selectedActivationStateIsExecuting(activationState)) return "reconnecting"
  if (mainlineState === "starting") return "starting"
  if (selectedActivationStateIsExecuting(activationState) || mainlineState === "executing") return "running"
  if (mainlineState === "settled") return "settled"
  if (mainlineState === "waiting_user") return "waiting_user"
  if (mainlineState === "blocked") return "blocked"
  if (mainlineState === "closed") return "closed"
  if (mainlineState === "cancelled") return "cancelled"
  if (mainlineState === "failed") return "failed"
  if (mainlineState === "unrecoverable") return "unrecoverable"
  return fallback
}

function explicitSessionRunBranchProof(
  message: WebviewToHostMessage,
): { sessionRunId: string; branchBindingId: string } | undefined {
  const sessionRunId = stringValue(message.sessionRunId) || stringValue(message.session_run_id)
  const branchBindingId = stringValue(message.branchBindingId) || stringValue(message.branch_binding_id)
  if (!sessionRunId || !branchBindingId) return undefined
  return { sessionRunId, branchBindingId }
}

function stringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const values = value.map((item) => String(item)).filter((item) => item.trim())
  return values.length ? values : undefined
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}
