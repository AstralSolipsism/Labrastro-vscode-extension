import type { WebviewToHostMessage } from "../protocol/messages"

export interface ChatMessagePort {
  postMessage(message: WebviewToHostMessage): void
}

export type ChatWorkflowMode = "chat" | "taskflow"

export interface ChatSendInput {
  text: string
  sessionId?: string
  draftSessionId?: string
  requestId?: string
  mode?: string
  workflowMode?: ChatWorkflowMode
  providerId?: string
  modelId?: string
  parameters?: Record<string, unknown>
}

export interface SessionModelSwitchInput {
  sessionId?: string
  providerId: string
  modelId: string
  requestId?: string
  parameters?: Record<string, unknown>
}

export interface ChatFollowUpInput {
  chatId: string
  text: string
  followupId: string
  requestId?: string
}

export interface ChatRecoverInput {
  chatId: string
  action: "continue" | "retry"
}

export function routeSelectedChatMode(
  mode: string,
  options: { forceDirect?: boolean } = {},
): Pick<ChatSendInput, "mode" | "workflowMode"> {
  const selected = mode.trim()
  if (!selected) return {}
  if (selected === "taskflow") {
    return options.forceDirect ? {} : { mode: "taskflow", workflowMode: "taskflow" }
  }
  return { mode: selected }
}

export function buildChatSendMessage(input: ChatSendInput): WebviewToHostMessage {
  const text = input.text.trim()
  const mode = input.mode?.trim()
  const workflowMode = input.workflowMode === "taskflow" ? "taskflow" : undefined
  const providerId = input.providerId?.trim()
  const modelId = input.modelId?.trim()
  return {
    type: "chat.send",
    text,
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    ...(input.draftSessionId ? { draftSessionId: input.draftSessionId } : {}),
    ...(input.requestId ? { requestId: input.requestId } : {}),
    ...(mode ? { mode } : {}),
    ...(workflowMode ? { workflowMode } : {}),
    ...(providerId && modelId ? { providerId, modelId } : {}),
    ...(providerId && modelId && input.parameters && Object.keys(input.parameters).length ? { parameters: input.parameters } : {}),
  }
}

export function buildSessionModelSwitchMessage(input: SessionModelSwitchInput): WebviewToHostMessage {
  const providerId = input.providerId.trim()
  const modelId = input.modelId.trim()
  return {
    type: "session.model.switch",
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    providerId,
    modelId,
    ...(input.requestId ? { requestId: input.requestId } : {}),
    ...(input.parameters && Object.keys(input.parameters).length ? { parameters: input.parameters } : {}),
  }
}

export const chatMessages = {
  send(port: ChatMessagePort, input: ChatSendInput): void {
    port.postMessage(buildChatSendMessage(input))
  },

  switchSessionMainModel(port: ChatMessagePort, input: SessionModelSwitchInput): void {
    port.postMessage(buildSessionModelSwitchMessage(input))
  },

  cancel(port: ChatMessagePort, chatId: string | undefined, reason = "user_cancelled"): void {
    port.postMessage({
      type: "chat.cancel",
      ...(chatId ? { chatId } : {}),
      reason,
    })
  },

  followUp(port: ChatMessagePort, input: ChatFollowUpInput): void {
    port.postMessage({
      type: "chat.followup",
      chatId: input.chatId,
      text: input.text,
      followupId: input.followupId,
      ...(input.requestId ? { requestId: input.requestId } : {}),
    })
  },

  cancelFollowUp(port: ChatMessagePort, chatId: string, followupId: string, reason = "user_changed_to_queue"): void {
    port.postMessage({
      type: "chat.followup.cancel",
      chatId,
      followupId,
      reason,
    })
  },

  recover(port: ChatMessagePort, input: ChatRecoverInput): void {
    port.postMessage({
      type: "chat.recover",
      chatId: input.chatId,
      action: input.action,
    })
  },

  openSettings(port: ChatMessagePort, tab?: string): void {
    port.postMessage({
      type: "openSettings",
      ...(tab ? { tab } : {}),
    })
  },

  openTaskflow(port: ChatMessagePort, taskflowId?: string): void {
    port.postMessage({
      type: "openTaskflow",
      ...(taskflowId ? { taskflowId } : {}),
    })
  },

  refreshAdmin(port: ChatMessagePort): void {
    port.postMessage({ type: "admin.refresh" })
  },

  sessionCommand(port: ChatMessagePort, input: Omit<ChatSendInput, "workflowMode">): void {
    port.postMessage(buildChatSendMessage({ ...input, workflowMode: "chat" }))
  },
}
