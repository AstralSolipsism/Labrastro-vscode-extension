import { objectValue, stringValue } from "./controller-utils"

export interface NormalizedSessionRunStartResult {
  sessionRunId: string
  sessionId: string
  branchBindingId: string
  agentRunId?: string
  activationId?: string
  runtimeState: Record<string, unknown>
}

export const SESSION_RUN_START_BRANCH_BINDING_ID = "main"

export function sessionRunStartTargetBranchBindingId(_requestedBranchBindingId?: string): string {
  return SESSION_RUN_START_BRANCH_BINDING_ID
}

export interface NormalizedBranchCreateResult {
  branchBindingId: string
  agentRunId: string
  activationId?: string
}

export interface NormalizedBranchSelectResult {
  branchBindingId: string
  sessionId: string
  agentRunId?: string
  activationId?: string
  running: boolean
  status: "running" | "idle"
  branches: Record<string, unknown>[]
  runtimeState: Record<string, unknown>
}

export function normalizeSessionRunStartResult(
  value: Record<string, unknown>,
  fallbackSessionId = "",
): NormalizedSessionRunStartResult | undefined {
  const sessionRunId = stringField(value, "session_run_id", "sessionRunId") || ""
  if (!sessionRunId) return undefined
  const runtimeState = objectField(value, "runtime_state", "runtimeState")
  const branchBindingId = stringField(value, "branch_binding_id", "branchBindingId") || ""
  if (branchBindingId !== sessionRunStartTargetBranchBindingId()) return undefined
  const agentRunId = stringField(value, "agent_run_id", "agentRunId")
  const activationId = stringField(value, "activation_id", "activationId")
  return {
    sessionRunId,
    sessionId: stringField(value, "session_id", "sessionId") || fallbackSessionId,
    branchBindingId,
    ...(agentRunId ? { agentRunId } : {}),
    ...(activationId ? { activationId } : {}),
    runtimeState,
  }
}

export function normalizeBranchCreateResult(
  value: Record<string, unknown>,
): NormalizedBranchCreateResult | undefined {
  const agentRun = objectField(value, "agent_run", "agentRun")
  const branchBindingId = stringField(value, "branch_binding_id", "branchBindingId") || ""
  const agentRunId = stringValue(agentRun.id) || stringField(value, "agent_run_id", "agentRunId") || ""
  if (!branchBindingId || !agentRunId) return undefined
  const activationId =
    stringField(agentRun, "current_activation_id", "currentActivationId") ||
    stringField(value, "activation_id", "activationId")
  return {
    branchBindingId,
    agentRunId,
    ...(activationId ? { activationId } : {}),
  }
}

export function normalizeBranchSelectResult(
  value: Record<string, unknown>,
  fallbackSessionId = "",
): NormalizedBranchSelectResult | undefined {
  const branchBindingId = stringField(value, "branch_binding_id", "branchBindingId") || ""
  if (!branchBindingId) return undefined
  const runtimeState = objectField(value, "runtime_state", "runtimeState")
  const running = value.running === true || stringValue(value.status) === "running"
  const status = running ? "running" : "idle"
  const agentRunId =
    stringField(value, "agent_run_id", "agentRunId") ||
    stringField(runtimeState, "agent_run_id", "agentRunId")
  if (!agentRunId) return undefined
  const activationId =
    stringField(value, "activation_id", "activationId") ||
    stringField(runtimeState, "activation_id", "activationId")
  return {
    branchBindingId,
    sessionId: stringField(value, "session_id", "sessionId") || fallbackSessionId,
    ...(agentRunId ? { agentRunId } : {}),
    ...(activationId ? { activationId } : {}),
    running,
    status,
    branches: arrayOfRecords(value.branches),
    runtimeState,
  }
}

function stringField(value: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const field = stringValue(value[key])
    if (field) return field
  }
  return undefined
}

function objectField(value: Record<string, unknown>, ...keys: string[]): Record<string, unknown> {
  for (const key of keys) {
    const raw = value[key]
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      return raw as Record<string, unknown>
    }
  }
  return {}
}

function arrayOfRecords(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> =>
      Boolean(item && typeof item === "object" && !Array.isArray(item))
    )
    : []
}
