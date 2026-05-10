import type * as vscode from "vscode"
import type { LabrastroRemoteClient } from "../LabrastroRemoteClient"
import type { ApprovalDocumentProvider } from "../ApprovalDocumentProvider"
import type { PostMessage } from "../WebviewBus"
import type { WebviewToHostMessage } from "../protocol/messages"
import { chatErrorMessage, stringValue } from "../controller-utils"

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
      default:
        return false
    }
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
