import { agentRunStateFromRuntimeStatus, type AgentRunState } from "./runtimeState"

export type RuntimeStatusTextKey = "tool.shell.queued"

export type RuntimeStatusUiAction =
  | {
    kind: "shell_tool_update"
    toolCallId: string
    nextStatus: "pending" | "running"
    textKey?: "tool.shell.queued"
  }
  | { kind: "agent_run_status"; state: AgentRunState }
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
    const state = agentRunStateFromRuntimeStatus(payload)
    return state ? { kind: "agent_run_status", state } : { kind: "fallback_view" }
  }

  return { kind: "fallback_view" }
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined
}
