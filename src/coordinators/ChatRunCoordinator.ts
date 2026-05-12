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
      providerId?: string
      modelId?: string
      parameters?: Record<string, unknown>
    }
  ) => Promise<void>
  cancelChat: (chatId: string | undefined, post: PostMessage) => Promise<void>
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
      case "chat.send":
        if (typeof message.text === "string") {
          void this.options.startChat(message.text, stringValue(message.sessionId), post, {
            mode: stringValue(message.mode),
            workflowMode: stringValue(message.workflowMode) || stringValue(message.workflow_mode),
            taskflowId: stringValue(message.taskflowId) || stringValue(message.taskflow_id),
            draftSessionId: stringValue(message.draftSessionId) || stringValue(message.draft_session_id),
            providerId: stringValue(message.providerId) || stringValue(message.provider_id),
            modelId: stringValue(message.modelId) || stringValue(message.model_id),
            parameters: message.parameters && typeof message.parameters === "object"
              ? message.parameters as Record<string, unknown>
              : {},
          })
        }
        return true
      case "chat.cancel":
        await this.options.cancelChat(stringValue(message.chatId), post)
        return true
      case "approval.reply": {
        const chatId =
          stringValue(message.chatId) ||
          this.activeChatId ||
          ""
        try {
          await this.options.client.approvalReply({
            chat_id: chatId,
            approval_id: stringValue(message.approvalId) || "",
            decision: stringValue(message.decision) || "deny_once",
            reason: stringValue(message.reason),
          })
        } catch (error) {
          const resolvedError = chatErrorMessage(error)
          post({ type: "chat.error", message: resolvedError })
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
      case "taskflow.reviewCards.get":
        return this.handleTaskflowAction(message, post, "taskflow.reviewCards", message.type, (taskflowId) =>
          this.options.client.getTaskflowReviewCards(taskflowId)
        )
      case "taskflow.runtime.get":
        return this.handleTaskflowAction(message, post, "taskflow.runtime", message.type, (taskflowId) =>
          this.options.client.getTaskflowRuntime(taskflowId)
        )
      case "taskflow.question.answer":
        return this.handleTaskflowAction(message, post, "taskflow.state", message.type, (taskflowId) =>
          this.options.client.answerTaskflowQuestion(
            taskflowId,
            stringValue(message.questionId) || stringValue(message.question_id) || "",
            {
              answer: stringValue(message.answer) || "",
              actor: stringValue(message.actor),
              rationale: stringValue(message.rationale),
              confidence: numberValue(message.confidence),
            }
          )
        )
      case "taskflow.decision.answer":
        return this.handleTaskflowAction(message, post, "taskflow.state", message.type, (taskflowId) =>
          this.options.client.answerTaskflowDecision(
            taskflowId,
            stringValue(message.decisionId) || stringValue(message.decision_id) || "",
            {
              selectedOptionId: stringValue(message.selectedOptionId) || stringValue(message.selected_option_id),
              answer: stringValue(message.answer),
              rationale: stringValue(message.rationale),
              actor: stringValue(message.actor),
            }
          )
        )
      case "taskflow.reviewCard.answer":
        return this.handleTaskflowAction(message, post, "taskflow.state", message.type, (taskflowId) =>
          this.options.client.answerTaskflowReviewCard(
            taskflowId,
            stringValue(message.cardId) || stringValue(message.card_id) || "",
            {
              action: stringValue(message.action) || "",
              value: message.value,
              actor: stringValue(message.actor),
              comment: stringValue(message.comment),
            }
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
            workItemIds: stringList(message.workItemIds) || stringList(message.work_item_ids),
            actor: stringValue(message.actor),
            rationale: stringValue(message.rationale),
            metadata: message.metadata ? objectValue(message.metadata) : undefined,
          })
        )
      case "taskflow.dispatch.confirm":
        return this.handleTaskflowAction(message, post, "taskflow.state", message.type, (taskflowId) =>
          this.options.client.confirmTaskflowDispatch(
            taskflowId,
            stringValue(message.decisionId) || stringValue(message.decision_id) || "",
            { actor: stringValue(message.actor) }
          )
        )
      case "taskflow.dispatch.reject":
        return this.handleTaskflowAction(message, post, "taskflow.state", message.type, (taskflowId) =>
          this.options.client.rejectTaskflowDispatch(
            taskflowId,
            stringValue(message.decisionId) || stringValue(message.decision_id) || "",
            { actor: stringValue(message.actor) }
          )
        )
      case "taskflow.workItem.dispatch":
        return this.handleTaskflowAction(message, post, "taskflow.state", message.type, (taskflowId) =>
          this.options.client.dispatchTaskflowWorkItem(
            taskflowId,
            stringValue(message.workItemId) || stringValue(message.work_item_id) || "",
            {
              dispatchDecisionId: stringValue(message.dispatchDecisionId) || stringValue(message.dispatch_decision_id),
              executorHint: stringValue(message.executorHint) || stringValue(message.executor_hint),
              metadata: message.metadata ? objectValue(message.metadata) : undefined,
            }
          )
        )
      case "taskflow.complexity.get": {
        const taskflowId = stringValue(message.taskflowId) || stringValue(message.taskflow_id)
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
        const taskflowId = stringValue(message.taskflowId) || stringValue(message.taskflow_id)
        if (!taskflowId) return true
        try {
          const payload = await this.options.client.scanTaskflowRepoComplexity(taskflowId, {
            workspacePath: stringValue(message.workspacePath) || stringValue(message.workspace_path),
            repositoryId: stringValue(message.repositoryId) || stringValue(message.repository_id),
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
    responseType: "taskflow.state" | "taskflow.reviewCards" | "taskflow.runtime",
    action: string,
    invoke: (taskflowId: string) => Promise<Record<string, unknown>>
  ): Promise<boolean> {
    const taskflowId = stringValue(message.taskflowId) || stringValue(message.taskflow_id)
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
