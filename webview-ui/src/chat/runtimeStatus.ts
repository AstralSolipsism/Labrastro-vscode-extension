export type RuntimeStatusTextKey =
  | "tool.shell.queued"
  | "runtime.agentQueue.chatWaiting"
  | "runtime.agentQueue.delegatedRunWaiting"

export type RuntimeStatusUiAction =
  | {
    kind: "shell_tool_update"
    toolCallId: string
    nextStatus: "pending" | "running"
    textKey?: "tool.shell.queued"
  }
  | {
    kind: "append_text"
    prefix: "runtime-agent-queue-chat" | "runtime-agent-queue-delegated-run"
    textKey: "runtime.agentQueue.chatWaiting" | "runtime.agentQueue.delegatedRunWaiting"
  }
  | { kind: "ignore" }
  | { kind: "fallback_view" }

export function resolveRuntimeStatusUiAction(
  payload: Readonly<Record<string, unknown>>,
): RuntimeStatusUiAction {
  const phase = stringValue(payload.phase)
  const status = stringValue(payload.status)

  if (phase === "shell_queue") {
    const toolCallId = stringValue(payload.tool_call_id)
    if (!toolCallId) return { kind: "fallback_view" }
    if (status === "queued") {
      return {
        kind: "shell_tool_update",
        toolCallId,
        nextStatus: "pending",
        textKey: "tool.shell.queued",
      }
    }
    if (status === "running") {
      return {
        kind: "shell_tool_update",
        toolCallId,
        nextStatus: "running",
      }
    }
    return { kind: "fallback_view" }
  }

  if (phase === "agent_queue") {
    if (status === "running") return { kind: "ignore" }
    if (status === "queued") {
      const agentType = stringValue(payload.agent_type) || ""
      if (agentType.startsWith("delegated_run")) {
        return {
          kind: "append_text",
          prefix: "runtime-agent-queue-delegated-run",
          textKey: "runtime.agentQueue.delegatedRunWaiting",
        }
      }
      return {
        kind: "append_text",
        prefix: "runtime-agent-queue-chat",
        textKey: "runtime.agentQueue.chatWaiting",
      }
    }
    return { kind: "fallback_view" }
  }

  return { kind: "fallback_view" }
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined
}
