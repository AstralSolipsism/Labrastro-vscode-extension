export type RemotePeerStatus = "idle" | "connecting" | "connected" | "error"

export interface RemotePeerState {
  status: RemotePeerStatus
  peerId?: string
  sessionId?: string
  fingerprint?: string
  mode?: string
  model?: string
  mainAgentId?: string
  agentConfigId?: string
  workspaceRoot?: string
  updatedAt?: number
  errorMessage?: string
}

export type AgentRunPhase = "idle" | "queued" | "running" | "completed" | "error"
export type AgentRunKind = "chat" | "delegated_run"

export interface AgentRunState {
  phase: AgentRunPhase
  kind?: AgentRunKind
  message?: string
  updatedAt?: number
}

export function initialRemotePeerState(): RemotePeerState {
  return { status: "idle" }
}

export function initialAgentRunState(): AgentRunState {
  return { phase: "idle" }
}

export function remotePeerStateFromReady(
  payload: Readonly<Record<string, unknown>>,
  now = Date.now(),
): RemotePeerState {
  return {
    status: "connected",
    peerId: stringValue(payload.peer_id),
    sessionId: stringValue(payload.session_id),
    fingerprint: stringValue(payload.fingerprint),
    mode: stringValue(payload.mode),
    model: stringValue(payload.model),
    mainAgentId: stringValue(payload.main_agent_id || payload.mainAgentId),
    agentConfigId: stringValue(payload.agent_config_id || payload.agentConfigId),
    workspaceRoot: stringValue(payload.workspace_root),
    updatedAt: now,
  }
}

export function remotePeerStateFromError(message: string, now = Date.now()): RemotePeerState {
  return {
    status: "error",
    errorMessage: message,
    updatedAt: now,
  }
}

export function agentRunStateFromRuntimeStatus(
  payload: Readonly<Record<string, unknown>>,
  now = Date.now(),
): AgentRunState | undefined {
  if (stringValue(payload.phase) !== "agent_queue") return undefined

  const kind = agentRunKindFromAgentType(stringValue(payload.agent_type))
  const status = stringValue(payload.status)
  const message = stringValue(payload.message)

  if (status === "queued") {
    return {
      phase: "queued",
      kind,
      message,
      updatedAt: now,
    }
  }

  if (status === "running") {
    return {
      phase: "running",
      kind,
      message,
      updatedAt: now,
    }
  }

  if (status === "completed" || status === "done" || status === "success") {
    return {
      phase: "completed",
      kind,
      message,
      updatedAt: now,
    }
  }

  if (status === "error" || status === "failed" || status === "failure") {
    return {
      phase: "error",
      kind,
      message,
      updatedAt: now,
    }
  }

  return undefined
}

export function settleAgentRunStateForChatEvent(
  current: AgentRunState,
  eventType: string,
  payload: Readonly<Record<string, unknown>> = {},
  now = Date.now(),
): AgentRunState {
  if (eventType === "chat_end") return initialAgentRunState()
  if (eventType === "chat_failed") {
    return {
      phase: "error",
      kind: current.kind,
      message: stringValue(payload.message) || current.message,
      updatedAt: now,
    }
  }
  if (eventType === "chat_interrupted") {
    return {
      phase: "error",
      kind: current.kind,
      message: stringValue(payload.message) || current.message,
      updatedAt: now,
    }
  }
  return current
}

export function agentRunStateFromDelegatedCompletion(
  payload: Readonly<Record<string, unknown>>,
  now = Date.now(),
): AgentRunState {
  const status = stringValue(payload.status)
  return {
    phase: status === "error" || status === "failed" ? "error" : "completed",
    kind: "delegated_run",
    message: stringValue(payload.message) || stringValue(payload.summary),
    updatedAt: now,
  }
}

function agentRunKindFromAgentType(agentType?: string): AgentRunKind {
  return agentType?.startsWith("delegated_run") ? "delegated_run" : "chat"
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}
