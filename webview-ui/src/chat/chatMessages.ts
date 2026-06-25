import type { WebviewToHostMessage } from "../protocol/messages"

export interface ChatMessagePort {
  postMessage(message: WebviewToHostMessage): void
}

export type ChatWorkflowMode = "chat" | "taskflow"

export interface ChatSendInput {
  text: string
  sessionId?: string
  draftSessionId?: string
  sessionRunId?: string
  requestId?: string
  operationId: string
  operationKind?: "start" | "continue"
  locale?: string
  branchBindingId?: string
  mode?: string
  workflowMode?: ChatWorkflowMode
  providerId?: string
  modelId?: string
  parameters?: Record<string, unknown>
  mentions?: Record<string, unknown>[]
}

export interface ChatPendingNextTurnSendInput {
  text: string
  sessionRunId: string
  sessionId?: string
  requestId?: string
  locale?: string
  branchBindingId?: string
  mentions?: Record<string, unknown>[]
}

export interface ChatCommandDispatchInput {
  text: string
  commandId?: string
  trigger?: string
  args?: string
  sessionId?: string
  requestId?: string
  mentions?: Record<string, unknown>[]
}

export interface SessionModelSwitchInput {
  sessionId?: string
  providerId: string
  modelId: string
  requestId?: string
  parameters?: Record<string, unknown>
}

export interface ChatRecoverInput {
  sessionRunId: string
  branchBindingId: string
  operationId: string
  action: "continue" | "retry"
}

export interface ChatCancelInput {
  sessionRunId: string
  branchBindingId: string
  operationId: string
  reason?: string
}

export interface ChatPendingNextTurnInput {
  sessionRunId: string
  branchBindingId: string
  clientRequestId?: string
  queuedAt?: string
  text?: string
}

export interface ChatBranchInput {
  sessionRunId: string
  baseSessionItemId: string
  prompt: string
  operationId: string
  sourceBranchBindingId: string
  branchBindingId: string
  sourceLabel?: string
  sourceMessageId?: string
  sourceNodeId?: string
  composeMode?: "edit" | "fork"
}

export interface ChatBranchSelectInput {
  sessionRunId: string
  sourceBranchBindingId: string
  branchBindingId: string
  operationId: string
}

export function routeSelectedChatMode(
  mode: string,
  options: { forceDirect?: boolean } = {},
): Pick<ChatSendInput, "mode" | "workflowMode"> {
  const selected = mode.trim()
  if (!selected) return {}
  if (selected === "taskflow") {
    return options.forceDirect ? {} : { workflowMode: "taskflow" }
  }
  return { mode: selected }
}

export function buildChatSendMessage(input: ChatSendInput): WebviewToHostMessage {
  const text = input.text.trim()
  const mode = input.mode?.trim()
  const workflowMode = input.workflowMode === "taskflow" ? "taskflow" : undefined
  const providerId = input.providerId?.trim()
  const modelId = input.modelId?.trim()
  const locale = input.locale?.trim()
  const branchBindingId = input.branchBindingId?.trim()
  const sessionRunId = input.sessionRunId?.trim()
  const operationId = input.operationId.trim()
  const operationKind = input.operationKind === "start" || input.operationKind === "continue"
    ? input.operationKind
    : undefined
  return {
    type: "chat.send",
    text,
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    ...(input.draftSessionId ? { draftSessionId: input.draftSessionId } : {}),
    ...(sessionRunId ? { sessionRunId, session_run_id: sessionRunId } : {}),
    ...(input.requestId ? { requestId: input.requestId } : {}),
    operationId,
    ...(operationKind ? { operationKind } : {}),
    ...(locale ? { locale } : {}),
    ...(branchBindingId ? { branchBindingId, branch_binding_id: branchBindingId } : {}),
    ...(mode ? { mode } : {}),
    ...(workflowMode ? { workflowMode } : {}),
    ...(providerId && modelId ? { providerId, modelId } : {}),
    ...(providerId && modelId && input.parameters && Object.keys(input.parameters).length ? { parameters: input.parameters } : {}),
    ...(input.mentions?.length ? { mentions: input.mentions } : {}),
  }
}

export function buildPendingNextTurnSendMessage(input: ChatPendingNextTurnSendInput): WebviewToHostMessage {
  const text = input.text.trim()
  const locale = input.locale?.trim()
  const sessionRunId = input.sessionRunId.trim()
  const branchBindingId = input.branchBindingId?.trim()
  return {
    type: "chat.send",
    text,
    ...(sessionRunId ? { sessionRunId, session_run_id: sessionRunId } : {}),
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    ...(input.requestId ? { requestId: input.requestId } : {}),
    ...(locale ? { locale } : {}),
    ...(branchBindingId ? { branchBindingId, branch_binding_id: branchBindingId } : {}),
    ...(input.mentions?.length ? { mentions: input.mentions } : {}),
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
    if (!input.operationId.trim()) return
    port.postMessage(buildChatSendMessage(input))
  },

  queuePendingNextTurn(port: ChatMessagePort, input: ChatPendingNextTurnSendInput): void {
    if (!input.sessionRunId.trim() || !input.branchBindingId?.trim()) return
    port.postMessage(buildPendingNextTurnSendMessage(input))
  },

  dispatchCommand(port: ChatMessagePort, input: ChatCommandDispatchInput): void {
    port.postMessage({
      type: "chat.command.dispatch",
      text: input.text.trim(),
      ...(input.commandId ? { commandId: input.commandId, command_id: input.commandId } : {}),
      ...(input.trigger ? { trigger: input.trigger } : {}),
      ...(input.args ? { args: input.args } : {}),
      ...(input.sessionId ? { sessionId: input.sessionId } : {}),
      ...(input.requestId ? { requestId: input.requestId } : {}),
      ...(input.mentions?.length ? { mentions: input.mentions } : {}),
    })
  },

  switchSessionMainModel(port: ChatMessagePort, input: SessionModelSwitchInput): void {
    port.postMessage(buildSessionModelSwitchMessage(input))
  },

  cancel(port: ChatMessagePort, input: ChatCancelInput): void {
    const branchBindingId = input.branchBindingId.trim()
    const operationId = input.operationId.trim()
    if (!input.sessionRunId || !branchBindingId || !operationId) return
    port.postMessage({
      type: "sessionRun.cancel",
      sessionRunId: input.sessionRunId,
      operationId,
      branchBindingId,
      branch_binding_id: branchBindingId,
      reason: input.reason || "user_cancelled",
    })
  },

  stop(port: ChatMessagePort, input: ChatCancelInput): void {
    const branchBindingId = input.branchBindingId.trim()
    const operationId = input.operationId.trim()
    if (!input.sessionRunId || !branchBindingId || !operationId) return
    port.postMessage({
      type: "sessionRun.stop",
      sessionRunId: input.sessionRunId,
      operationId,
      branchBindingId,
      branch_binding_id: branchBindingId,
      reason: input.reason || "user_stop",
    })
  },

  removePendingNextTurn(port: ChatMessagePort, input: ChatPendingNextTurnInput): void {
    const branchBindingId = input.branchBindingId.trim()
    if (!input.sessionRunId || !branchBindingId) return
    port.postMessage({
      type: "sessionRun.pendingNextTurn.remove",
      sessionRunId: input.sessionRunId,
      session_run_id: input.sessionRunId,
      branchBindingId,
      branch_binding_id: branchBindingId,
      ...(input.clientRequestId ? { clientRequestId: input.clientRequestId, client_request_id: input.clientRequestId } : {}),
      ...(input.queuedAt ? { queuedAt: input.queuedAt, queued_at: input.queuedAt } : {}),
      ...(input.text ? { text: input.text } : {}),
    })
  },

  clearPendingNextTurns(port: ChatMessagePort, input: Pick<ChatPendingNextTurnInput, "sessionRunId" | "branchBindingId">): void {
    const branchBindingId = input.branchBindingId.trim()
    if (!input.sessionRunId || !branchBindingId) return
    port.postMessage({
      type: "sessionRun.pendingNextTurn.clear",
      sessionRunId: input.sessionRunId,
      session_run_id: input.sessionRunId,
      branchBindingId,
      branch_binding_id: branchBindingId,
    })
  },

  branch(port: ChatMessagePort, input: ChatBranchInput): void {
    const sessionRunId = input.sessionRunId.trim()
    const operationId = input.operationId.trim()
    const sourceBranchBindingId = input.sourceBranchBindingId.trim()
    const branchBindingId = input.branchBindingId.trim()
    if (!sessionRunId || !operationId || !sourceBranchBindingId || !branchBindingId) return
    port.postMessage({
      type: "sessionRun.branch",
      sessionRunId,
      session_run_id: sessionRunId,
      base_session_item_id: input.baseSessionItemId,
      prompt: input.prompt,
      operationId,
      sourceBranchBindingId,
      source_branch_binding_id: sourceBranchBindingId,
      branchBindingId,
      branch_binding_id: branchBindingId,
      ...(input.sourceLabel ? { source_label: input.sourceLabel } : {}),
      ...(input.sourceMessageId ? { source_message_id: input.sourceMessageId } : {}),
      ...(input.sourceNodeId ? { source_node_id: input.sourceNodeId } : {}),
      ...(input.composeMode ? { compose_mode: input.composeMode } : {}),
    })
  },

  selectBranch(port: ChatMessagePort, input: ChatBranchSelectInput): void {
    const sessionRunId = input.sessionRunId.trim()
    const sourceBranchBindingId = input.sourceBranchBindingId.trim()
    const branchBindingId = input.branchBindingId.trim()
    const operationId = input.operationId.trim()
    if (!sessionRunId || !sourceBranchBindingId || !branchBindingId || !operationId) return
    port.postMessage({
      type: "sessionRun.branch.select",
      sessionRunId,
      session_run_id: sessionRunId,
      sourceBranchBindingId,
      source_branch_binding_id: sourceBranchBindingId,
      branchBindingId,
      branch_binding_id: branchBindingId,
      operationId,
    })
  },

  recover(port: ChatMessagePort, input: ChatRecoverInput): void {
    const branchBindingId = input.branchBindingId.trim()
    const operationId = input.operationId.trim()
    if (!input.sessionRunId || !branchBindingId || !operationId) return
    port.postMessage({
      type: "sessionRun.recover",
      sessionRunId: input.sessionRunId,
      operationId,
      branchBindingId,
      branch_binding_id: branchBindingId,
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

  readChatConfig(port: ChatMessagePort): void {
    port.postMessage({ type: "chatConfig.read" })
  },

  readModelProfiles(port: ChatMessagePort): void {
    port.postMessage({ type: "modelProfiles.list" })
  },

  sessionCommand(port: ChatMessagePort, input: Omit<ChatSendInput, "workflowMode">): void {
    port.postMessage(buildChatSendMessage({ ...input, workflowMode: "chat" }))
  },
}
