import type * as vscode from "vscode"
import type { LabrastroRemoteClient } from "../LabrastroRemoteClient"
import type { ApprovalDocumentProvider } from "../ApprovalDocumentProvider"
import type { PostMessage } from "../WebviewBus"
import type { WebviewToHostMessage } from "../protocol/messages"
import { chatErrorMessage, numberValue, objectValue, stringValue } from "../controller-utils"

const ACTIVE_CHAT_RUN_KEY = "labrastro.activeChatRun"

export interface ActiveChatRun {
  chatId: string
  cursor: number
  sessionId?: string
  draftSessionId?: string
  status: "running" | "reconnecting"
  startedAt: string
  reconnectAttempts: number
  reconnectStartedAt?: number
  lastError?: string
  lastStreamAt?: string
  nextRetryAt?: number
}

export interface ChatRunCoordinatorOptions {
  client: LabrastroRemoteClient
  context: vscode.ExtensionContext
  approvalDocuments: ApprovalDocumentProvider
  startChat: (
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
  cancelChat: (chatId: string | undefined, post: PostMessage) => Promise<void>
  recoverChat: (
    chatId: string,
    action: "continue" | "retry",
    post: PostMessage
  ) => Promise<void>
  postConnectionStateIfAuthRequired: (error: unknown, post: PostMessage) => Promise<void>
}

export class ChatRunCoordinator {
  private run: ActiveChatRun | undefined
  private draftSessionId: string | undefined

  constructor(private readonly options: ChatRunCoordinatorOptions) {}

  get activeRun(): ActiveChatRun | undefined {
    return this.run
  }

  get activeChatId(): string | undefined {
    return this.run?.chatId
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
    return Boolean(this.run?.chatId)
  }

  activeRunPayload(): Record<string, unknown> | undefined {
    return this.run ? activeChatRunPayload(this.run) : undefined
  }

  setActiveRun(run: ActiveChatRun | undefined): void {
    this.run = run
    void this.options.context.workspaceState.update(
      ACTIVE_CHAT_RUN_KEY,
      run ? activeChatRunPayload(run) : undefined
    )
  }

  patchActiveRun(patch: Partial<ActiveChatRun>): ActiveChatRun | undefined {
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
          post({ type: "chat.error", message: "无效指令：Chat 指令必须以 / 开头。" })
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
          if (events.length) post({ type: "chat.events", events })
          if (result.ok === false && !events.length) {
            post({ type: "chat.error", message: stringValue(result.error) || "指令执行失败。" })
          }
          post({ type: "chat.done" })
        } catch (error) {
          post({ type: "chat.error", message: chatErrorMessage(error) })
          await this.options.postConnectionStateIfAuthRequired(error, post)
          post({ type: "chat.done" })
        }
        return true
      }
      case "chat.send":
        if (typeof message.text === "string") {
          const providerId = stringValue(message.providerId) || stringValue(message.provider_id)
          const modelId = stringValue(message.modelId) || stringValue(message.model_id)
          if (!providerId || !modelId) {
            post({
              type: "chat.error",
              message: providerId || modelId
                ? "模型选择不完整，请重新选择会话模型。"
                : "请选择会话模型后再发送。",
            })
            return true
          }
          const mentions = arrayValue(message.mentions).filter(
            (item): item is Record<string, unknown> =>
              Boolean(item && typeof item === "object" && !Array.isArray(item))
          )
          void this.options.startChat(message.text, stringValue(message.sessionId), post, {
            mode: stringValue(message.mode),
            workflowMode: stringValue(message.workflowMode) || stringValue(message.workflow_mode),
            taskflowId: stringValue(message.taskflowId) || stringValue(message.taskflow_id),
            draftSessionId: stringValue(message.draftSessionId) || stringValue(message.draft_session_id),
            locale: stringValue(message.locale),
            clientRequestId:
              stringValue(message.clientRequestId) ||
              stringValue(message.client_request_id) ||
              stringValue(message.requestId) ||
              stringValue(message.request_id),
            providerId,
            modelId,
            parameters: message.parameters && typeof message.parameters === "object"
              ? message.parameters as Record<string, unknown>
              : {},
            ...(mentions.length ? { mentions } : {}),
          })
        }
        return true
      case "chat.cancel":
        await this.options.cancelChat(stringValue(message.chatId), post)
        return true
      case "chat.recover": {
        const chatId = stringValue(message.chatId) || stringValue(message.chat_id) || this.activeChatId || ""
        const rawAction = stringValue(message.action) || "continue"
        const action = rawAction === "retry" ? "retry" : "continue"
        if (!chatId) return true
        await this.options.recoverChat(chatId, action, post)
        return true
      }
      case "chat.followup": {
        const chatId = stringValue(message.chatId) || stringValue(message.chat_id) || this.activeChatId || ""
        const text = stringValue(message.text) || ""
        if (!chatId || !text.trim()) return true
        const followupId = stringValue(message.followupId) || stringValue(message.followup_id)
        const clientRequestId =
          stringValue(message.clientRequestId) ||
          stringValue(message.client_request_id) ||
          stringValue(message.requestId) ||
          stringValue(message.request_id)
        try {
          await this.options.client.followUpChat({
            chatId,
            text,
            ...(followupId ? { followupId } : {}),
            ...(clientRequestId ? { clientRequestId } : {}),
          })
        } catch (error) {
          post({ type: "chat.error", message: chatErrorMessage(error) })
          await this.options.postConnectionStateIfAuthRequired(error, post)
        }
        return true
      }
      case "chat.followup.cancel": {
        const chatId = stringValue(message.chatId) || stringValue(message.chat_id) || this.activeChatId || ""
        const followupId = stringValue(message.followupId) || stringValue(message.followup_id)
        if (!chatId || !followupId) return true
        try {
          await this.options.client.cancelChatFollowUp({
            chatId,
            followupId,
            reason: stringValue(message.reason) || "user_changed_to_queue",
          })
        } catch (error) {
          post({ type: "chat.error", message: chatErrorMessage(error) })
          await this.options.postConnectionStateIfAuthRequired(error, post)
        }
        return true
      }
      case "approval.reply": {
        const chatId =
          stringValue(message.chatId) ||
          this.activeChatId ||
          ""
        const approvalId = stringValue(message.approvalId) || ""
        const decision = stringValue(message.decision) || "deny_once"
        try {
          const payload = await this.options.client.approvalReply({
            chat_id: chatId,
            approval_id: approvalId,
            decision,
            reason: stringValue(message.reason),
          })
          post({
            type: "approval.reply.ok",
            chatId,
            approvalId,
            decision,
            payload,
          })
        } catch (error) {
          const resolvedError = chatErrorMessage(error)
          post({
            type: "approval.reply.error",
            chatId,
            approvalId,
            decision,
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

export function activeChatRunPayload(run: ActiveChatRun): Record<string, unknown> {
  return {
    chatId: run.chatId,
    chat_id: run.chatId,
    cursor: run.cursor,
    sessionId: run.sessionId,
    session_id: run.sessionId,
    draftSessionId: run.draftSessionId,
    draft_session_id: run.draftSessionId,
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
