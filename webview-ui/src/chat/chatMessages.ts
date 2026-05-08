export interface ChatMessagePort {
  postMessage(message: Record<string, unknown>): void
}

export type ChatWorkflowMode = "chat" | "taskflow"

export interface ChatSendInput {
  text: string
  sessionId?: string
  draftSessionId?: string
  mode?: string
  workflowMode?: ChatWorkflowMode
}

export interface SessionModelSwitchInput {
  sessionId?: string
  providerId: string
  modelId: string
  requestId?: string
  parameters?: Record<string, unknown>
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

export function buildChatSendMessage(input: ChatSendInput): Record<string, unknown> {
  const text = input.text.trim()
  const mode = input.mode?.trim()
  const workflowMode = input.workflowMode === "taskflow" ? "taskflow" : undefined
  return {
    type: "chat.send",
    text,
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    ...(input.draftSessionId ? { draftSessionId: input.draftSessionId } : {}),
    ...(mode ? { mode } : {}),
    ...(workflowMode ? { workflowMode } : {}),
  }
}

export function buildSessionModelSwitchMessage(input: SessionModelSwitchInput): Record<string, unknown> {
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

  openSettings(port: ChatMessagePort, tab?: string): void {
    port.postMessage({
      type: "openSettings",
      ...(tab ? { tab } : {}),
    })
  },

  refreshAdmin(port: ChatMessagePort): void {
    port.postMessage({ type: "admin.refresh" })
  },

  sessionCommand(port: ChatMessagePort, input: Omit<ChatSendInput, "workflowMode">): void {
    port.postMessage(buildChatSendMessage({ ...input, workflowMode: "chat" }))
  },
}
