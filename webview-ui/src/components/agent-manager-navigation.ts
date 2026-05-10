import type { TraceNavigationIntent } from "../types/trace"

export interface AgentManagerNavigationProps {
  branchId?: string
  nodeId?: string
  sessionId?: string
  intent?: TraceNavigationIntent
}

export function agentManagerNavigationPayload(props: AgentManagerNavigationProps) {
  return {
    sessionId: props.sessionId,
    nodeId: props.nodeId,
    branchId: props.branchId,
    intent: props.intent,
  }
}
