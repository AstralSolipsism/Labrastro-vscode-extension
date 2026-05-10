import { DEFAULT_AUTO_APPROVE_OPTIONS } from "../components/chat/approval-details"

export function sanitizeAutoApproveOptions(value: unknown): Record<string, boolean> {
  const raw = objectValue(value)
  return Object.keys(DEFAULT_AUTO_APPROVE_OPTIONS).reduce<Record<string, boolean>>((options, key) => {
    options[key] = raw[key] === true
    return options
  }, {})
}

export function connectionSaveResultKey(result: Record<string, unknown> | undefined): string | undefined {
  if (!result) return undefined
  return [
    stringValue(result.hostUrlSaveRequested),
    stringValue(result.hostUrl),
    stringValue(result.hostUrlSaveApplied),
  ].join("|")
}

export function serverAgentRuntimeSettingsPayload(
  maxRunningAgents: number,
  maxShellsPerAgent: number
): Record<string, unknown> {
  return {
    agent_runtime: {
      max_running_agents: Math.max(1, Math.floor(maxRunningAgents)),
      max_shells_per_agent: Math.max(1, Math.floor(maxShellsPerAgent)),
    },
  }
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function stringValue(value: unknown): string {
  if (typeof value === "string") return value
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  return ""
}
