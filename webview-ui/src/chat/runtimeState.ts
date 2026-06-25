export type RunPeerStatus = "idle" | "connecting" | "connected" | "error"

export interface RunPeerState {
  status: RunPeerStatus
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

export type ServerEventStreamStatus = "idle" | "connecting" | "reconnecting" | "error"

export interface ServerEventStreamState {
  status: ServerEventStreamStatus
  sessionRunId?: string
  branchBindingId?: string
  attempts?: number
  errorMessage?: string
  nextRetryAt?: number
  updatedAt?: number
}

export type AgentRunPhase = "idle" | "queued" | "running" | "completed" | "error"
export type AgentRunKind = "chat" | "delegated_run"

export interface AgentRunState {
  phase: AgentRunPhase
  kind?: AgentRunKind
  message?: string
  updatedAt?: number
}

export function initialRunPeerState(): RunPeerState {
  return { status: "idle" }
}

export function initialServerEventStreamState(): ServerEventStreamState {
  return { status: "idle" }
}

export function initialAgentRunState(): AgentRunState {
  return { phase: "idle" }
}

export function runPeerStateFromReady(
  payload: Readonly<Record<string, unknown>>,
  now = Date.now(),
): RunPeerState {
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

export function runPeerStateFromError(message: string, now = Date.now()): RunPeerState {
  return {
    status: "error",
    errorMessage: message,
    updatedAt: now,
  }
}

export function remotePeerReadyHasLocalActionProof(payload: Readonly<Record<string, unknown>>): boolean {
  return Boolean(
    stringValue(payload.local_action_id || payload.localActionId) ||
    stringValue(payload.local_action_kind || payload.localActionKind) ||
    stringValue(payload.local_resource_id || payload.localResourceId) ||
    stringValue(payload.local_peer_reason || payload.localPeerReason) ||
    stringValue(payload.scope) === "local_action"
  )
}

export function serverEventStreamConnectingState(
  input: { sessionRunId?: string; branchBindingId?: string },
  now = Date.now(),
): ServerEventStreamState {
  return {
    status: "connecting",
    ...(input.sessionRunId ? { sessionRunId: input.sessionRunId } : {}),
    ...(input.branchBindingId ? { branchBindingId: input.branchBindingId } : {}),
    updatedAt: now,
  }
}

export function serverEventStreamReconnectingState(
  input: {
    sessionRunId?: string
    branchBindingId?: string
    attempts?: number
    errorMessage?: string
    nextRetryAt?: number
  },
  now = Date.now(),
): ServerEventStreamState {
  return {
    status: "reconnecting",
    ...(input.sessionRunId ? { sessionRunId: input.sessionRunId } : {}),
    ...(input.branchBindingId ? { branchBindingId: input.branchBindingId } : {}),
    ...(input.attempts !== undefined ? { attempts: input.attempts } : {}),
    ...(input.errorMessage ? { errorMessage: input.errorMessage } : {}),
    ...(input.nextRetryAt !== undefined ? { nextRetryAt: input.nextRetryAt } : {}),
    updatedAt: now,
  }
}

export function serverEventStreamErrorState(
  input: { sessionRunId?: string; branchBindingId?: string; errorMessage?: string },
  now = Date.now(),
): ServerEventStreamState {
  return {
    status: "error",
    ...(input.sessionRunId ? { sessionRunId: input.sessionRunId } : {}),
    ...(input.branchBindingId ? { branchBindingId: input.branchBindingId } : {}),
    ...(input.errorMessage ? { errorMessage: input.errorMessage } : {}),
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

export function settleAgentRunStateForSessionRunEvent(
  current: AgentRunState,
  eventType: string,
  payload: Readonly<Record<string, unknown>> = {},
  now = Date.now(),
): AgentRunState {
  if (eventType === "session_run_end") return initialAgentRunState()
  if (eventType === "session_run_failed") {
    return {
      phase: "error",
      kind: current.kind,
      message: stringValue(payload.message) || current.message,
      updatedAt: now,
    }
  }
  if (eventType === "session_run_interrupted") {
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
