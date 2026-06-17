import type * as vscode from "vscode"
import type { LabrastroRemoteClient } from "../LabrastroRemoteClient"
import type { ApprovalDocumentProvider } from "../ApprovalDocumentProvider"
import type { PostMessage } from "../WebviewBus"
import type { WebviewToHostMessage } from "../protocol/messages"
import { chatErrorMessage, numberValue, objectValue, stringValue } from "../controller-utils"

const ACTIVE_SESSION_RUN_KEY = "labrastro.activeSessionRun"

export interface ActiveSessionRun {
  sessionRunId: string
  cursor: number
  sessionId?: string
  draftSessionId?: string
  status: "idle" | "running" | "reconnecting"
  agentRunId?: string
  activationId?: string
  branchBindingId?: string
  startedAt: string
  reconnectAttempts: number
  reconnectStartedAt?: number
  lastError?: string
  lastStreamAt?: string
  nextRetryAt?: number
  pendingNextTurn?: PendingNextTurn
  branches?: Record<string, unknown>[]
}

export interface PendingNextTurn {
  text: string
  clientRequestId?: string
  locale?: string
  mentions?: Record<string, unknown>[]
  queuedAt: string
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
      clientRequestId?: string
      locale?: string
      mentions?: Record<string, unknown>[]
    }
  ) => Promise<void>
  steerAgentRun: (
    text: string,
    post: PostMessage,
    options: {
      clientSteerId?: string
      locale?: string
      mentions?: Record<string, unknown>[]
    }
  ) => Promise<void>
  branchSessionRun: (
    request: {
      baseSessionItemId: string
      prompt: string
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
      branchBindingId: string
    },
    post: PostMessage
  ) => Promise<void>
  cancelSessionRun: (sessionRunId: string | undefined, post: PostMessage) => Promise<void>
  recoverSessionRun: (
    sessionRunId: string,
    action: "continue" | "retry",
    post: PostMessage
  ) => Promise<void>
  postConnectionStateIfAuthRequired: (error: unknown, post: PostMessage) => Promise<void>
}

export class SessionRunCoordinator {
  private run: ActiveSessionRun | undefined
  private draftSessionId: string | undefined

  constructor(private readonly options: SessionRunCoordinatorOptions) {
    this.run = activeSessionRunFromPayload(
      this.options.context.workspaceState.get<Record<string, unknown>>(ACTIVE_SESSION_RUN_KEY)
    )
    this.draftSessionId = this.run?.draftSessionId
  }

  get activeRun(): ActiveSessionRun | undefined {
    return this.run
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

  activeRunPayload(): Record<string, unknown> | undefined {
    return this.run ? activeSessionRunPayload(this.run) : undefined
  }

  setActiveRun(run: ActiveSessionRun | undefined): void {
    this.run = run
    void this.options.context.workspaceState.update(
      ACTIVE_SESSION_RUN_KEY,
      run ? activeSessionRunPayload(run) : undefined
    )
  }

  patchActiveRun(patch: Partial<ActiveSessionRun>): ActiveSessionRun | undefined {
    if (!this.run) return undefined
    const next = { ...this.run, ...patch }
    this.setActiveRun(next)
    return next
  }

  clearActiveRun(): void {
    this.setActiveRun(undefined)
    this.clearActiveDraftSessionId()
  }

  async handleMessage(message: WebviewToHostMessage, post: PostMessage): Promise<boolean> {
    switch (message.type) {
      case "chat.command.dispatch": {
        const text = typeof message.text === "string" ? message.text : ""
        if (!text.trim() || !text.startsWith("/")) {
          post({ type: "sessionRun.error", message: "无效指令：Chat 指令必须以 / 开头。" })
          return true
        }
        const clientRequestId =
          stringValue(message.clientRequestId) ||
          stringValue(message.client_request_id) ||
          stringValue(message.requestId) ||
          stringValue(message.request_id)
        try {
          const result = await this.options.client.dispatchChatCommand({
            text,
            commandId: stringValue(message.commandId) || stringValue(message.command_id),
            trigger: stringValue(message.trigger),
            args: stringValue(message.args),
            sessionId: stringValue(message.sessionId) || stringValue(message.session_id),
            clientRequestId,
            mentions: arrayValue(message.mentions).filter(
              (item): item is Record<string, unknown> =>
                Boolean(item && typeof item === "object" && !Array.isArray(item))
            ),
          })
          const events = arrayValue(result.events)
          if (events.length) post({ type: "sessionRun.events", events })
          if (result.ok === false && !events.length) {
            post({ type: "sessionRun.error", message: stringValue(result.error) || "指令执行失败。" })
          }
          post({ type: "sessionRun.done" })
        } catch (error) {
          post({ type: "sessionRun.error", message: chatErrorMessage(error) })
          await this.options.postConnectionStateIfAuthRequired(error, post)
          post({ type: "sessionRun.done" })
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
          const locale = stringValue(message.locale)
          const activeRun = this.activeRun
          if (activeRun?.sessionRunId) {
            const intent = stringValue(message.intent) || stringValue(message.input_intent)
            if (intent === "steer" || intent === "current_activation") {
              if (activeSessionRunIsExecuting(activeRun)) {
                void this.options.steerAgentRun(text, post, {
                  ...(clientRequestId ? { clientSteerId: clientRequestId } : {}),
                  ...(locale ? { locale } : {}),
                  ...(mentions.length ? { mentions } : {}),
                })
              } else {
                void this.options.continueSessionRun(text, post, {
                  ...(clientRequestId ? { clientRequestId } : {}),
                  ...(locale ? { locale } : {}),
                  ...(mentions.length ? { mentions } : {}),
                })
              }
              return true
            }
            if (activeSessionRunIsExecuting(activeRun)) {
              const pendingNextTurn: PendingNextTurn = {
                text,
                ...(clientRequestId ? { clientRequestId } : {}),
                ...(locale ? { locale } : {}),
                ...(mentions.length ? { mentions } : {}),
                queuedAt: new Date().toISOString(),
              }
              this.patchActiveRun({ pendingNextTurn })
              post({
                type: "sessionRun.pendingNextTurn",
                sessionRunId: activeRun.sessionRunId,
                branchBindingId: activeRun.branchBindingId,
                branch_binding_id: activeRun.branchBindingId,
                pendingNextTurn,
                pending_next_turn: pendingNextTurn,
              })
              return true
            }
            void this.options.continueSessionRun(text, post, {
              ...(clientRequestId ? { clientRequestId } : {}),
              ...(locale ? { locale } : {}),
              ...(mentions.length ? { mentions } : {}),
            })
            return true
          }
          const providerId = stringValue(message.providerId) || stringValue(message.provider_id)
          const modelId = stringValue(message.modelId) || stringValue(message.model_id)
          if (!providerId || !modelId) {
            post({
              type: "sessionRun.error",
              message: providerId || modelId
                ? "模型选择不完整，请重新选择会话模型。"
                : "请选择会话模型后再发送。",
            })
            return true
          }
          void this.options.startSessionRun(message.text, stringValue(message.sessionId), post, {
            mode: stringValue(message.mode),
            workflowMode: stringValue(message.workflowMode) || stringValue(message.workflow_mode),
            taskflowId: stringValue(message.taskflowId) || stringValue(message.taskflow_id),
            draftSessionId: stringValue(message.draftSessionId) || stringValue(message.draft_session_id),
            locale,
            clientRequestId,
            providerId,
            modelId,
            parameters: message.parameters && typeof message.parameters === "object"
              ? message.parameters as Record<string, unknown>
              : {},
            ...(mentions.length ? { mentions } : {}),
          })
        }
        return true
      case "sessionRun.cancel":
        await this.options.cancelSessionRun(
          stringValue(message.sessionRunId) || stringValue(message.session_run_id) || this.activeSessionRunId,
          post
        )
        return true
      case "sessionRun.branch":
        await this.options.branchSessionRun({
          baseSessionItemId: stringValue(message.baseSessionItemId) || stringValue(message.base_session_item_id) || "",
          prompt: stringValue(message.prompt) || "",
          branchBindingId: stringValue(message.branchBindingId) || stringValue(message.branch_binding_id),
          sourceLabel: stringValue(message.sourceLabel) || stringValue(message.source_label),
          sourceMessageId: stringValue(message.sourceMessageId) || stringValue(message.source_message_id),
          sourceNodeId: stringValue(message.sourceNodeId) || stringValue(message.source_node_id),
          composeMode: stringValue(message.composeMode) === "edit" || stringValue(message.compose_mode) === "edit"
            ? "edit"
            : "fork",
        }, post)
        return true
      case "sessionRun.branch.select":
        await this.options.selectSessionRunBranch({
          branchBindingId: stringValue(message.branchBindingId) || stringValue(message.branch_binding_id) || "",
        }, post)
        return true
      case "sessionRun.recover": {
        const sessionRunId = stringValue(message.sessionRunId) || stringValue(message.session_run_id) || this.activeSessionRunId || ""
        const rawAction = stringValue(message.action) || "continue"
        const action = rawAction === "retry" ? "retry" : "continue"
        if (!sessionRunId) return true
        await this.options.recoverSessionRun(sessionRunId, action, post)
        return true
      }
      case "approval.reply": {
        const sessionRunId =
          stringValue(message.sessionRunId) ||
          stringValue(message.session_run_id) ||
          this.activeSessionRunId ||
          ""
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
            session_run_id: sessionRunId,
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
            sessionRunId,
            approvalId,
            decision,
            payload,
          })
          await this.options.approvalDocuments.close(approvalId)
        } catch (error) {
          const resolvedError = chatErrorMessage(error)
          post({
            type: "approval.reply.error",
            sessionRunId,
            approvalId,
            decision,
            message: resolvedError,
          })
          await this.options.postConnectionStateIfAuthRequired(error, post)
        }
        return true
      }
      case "sessionRun.userInput.reply": {
        const sessionRunId =
          stringValue(message.sessionRunId) ||
          stringValue(message.session_run_id) ||
          this.activeSessionRunId ||
          ""
        const inputId = stringValue(message.inputId) || stringValue(message.input_id) || ""
        const action = stringValue(message.action) || "decline"
        const content = objectValue(message.content) || {}
        try {
          const payload = await this.options.client.sessionRunUserInputReply({
            session_run_id: sessionRunId,
            input_id: inputId,
            action,
            content,
            reason: stringValue(message.reason),
          })
          post({
            type: "sessionRun.userInput.reply.ok",
            sessionRunId,
            inputId,
            action,
            payload,
          })
        } catch (error) {
          const resolvedError = chatErrorMessage(error)
          post({
            type: "sessionRun.userInput.reply.error",
            sessionRunId,
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

export function activeSessionRunPayload(run: ActiveSessionRun): Record<string, unknown> {
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
    pendingNextTurn: run.pendingNextTurn,
    pending_next_turn: run.pendingNextTurn,
    branches: run.branches,
  }
}

export function activeSessionRunFromPayload(payload: unknown): ActiveSessionRun | undefined {
  const value = objectValue(payload)
  const sessionRunId = stringValue(value.sessionRunId) || stringValue(value.session_run_id)
  if (!sessionRunId) return undefined
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
  const statusValue = stringValue(value.status)
  const status: ActiveSessionRun["status"] =
    statusValue === "reconnecting" ? "reconnecting" : statusValue === "idle" ? "idle" : "running"
  const camelPendingNextTurn = objectValue(value.pendingNextTurn)
  const pendingNextTurnValue = Object.keys(camelPendingNextTurn).length
    ? camelPendingNextTurn
    : objectValue(value.pending_next_turn)
  const pendingNextTurn = pendingNextTurnFromPayload(pendingNextTurnValue)
  return {
    sessionRunId,
    cursor,
    sessionId: stringValue(value.sessionId) || stringValue(value.session_id),
    draftSessionId: stringValue(value.draftSessionId) || stringValue(value.draft_session_id),
    agentRunId: stringValue(value.agentRunId) || stringValue(value.agent_run_id),
    activationId: stringValue(value.activationId) || stringValue(value.activation_id),
    branchBindingId: stringValue(value.branchBindingId) || stringValue(value.branch_binding_id),
    status,
    startedAt:
      stringValue(value.startedAt) ||
      stringValue(value.started_at) ||
      new Date().toISOString(),
    reconnectAttempts,
    reconnectStartedAt,
    lastError: stringValue(value.lastError) || stringValue(value.last_error),
    lastStreamAt: stringValue(value.lastStreamAt) || stringValue(value.last_stream_at),
    nextRetryAt,
    ...(pendingNextTurn ? { pendingNextTurn } : {}),
    branches: arrayValue(value.branches).filter(
      (item): item is Record<string, unknown> =>
        Boolean(item && typeof item === "object" && !Array.isArray(item))
    ),
  }
}

function activeSessionRunIsExecuting(run: ActiveSessionRun): boolean {
  return run.status === "running" || run.status === "reconnecting"
}

function pendingNextTurnFromPayload(value: Record<string, unknown>): PendingNextTurn | undefined {
  const text = stringValue(value.text)
  if (!text) return undefined
  const clientRequestId = stringValue(value.clientRequestId) || stringValue(value.client_request_id)
  const locale = stringValue(value.locale)
  const mentions = arrayValue(value.mentions).filter(
    (item): item is Record<string, unknown> =>
      Boolean(item && typeof item === "object" && !Array.isArray(item))
  )
  return {
    text,
    ...(clientRequestId ? { clientRequestId } : {}),
    ...(locale ? { locale } : {}),
    ...(mentions.length ? { mentions } : {}),
    queuedAt: stringValue(value.queuedAt) || stringValue(value.queued_at) || new Date().toISOString(),
  }
}

function stringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const values = value.map((item) => String(item)).filter((item) => item.trim())
  return values.length ? values : undefined
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}
