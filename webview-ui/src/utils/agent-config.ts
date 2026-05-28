export const AGENT_CONFIG_ID_PATTERN = /^[A-Za-z0-9_.-]+$/

export type AgentConfigIdValidation =
  | { ok: true; id: string }
  | { ok: false; code: "empty" | "invalid" | "duplicate"; id: string }

export function normalizeAgentConfigId(value: string): string {
  return value.trim()
}

export function validateAgentConfigId(
  value: string,
  existingIds: Iterable<string>,
  currentId = "",
): AgentConfigIdValidation {
  const id = normalizeAgentConfigId(value)
  if (!id) return { ok: false, code: "empty", id }
  if (!AGENT_CONFIG_ID_PATTERN.test(id)) return { ok: false, code: "invalid", id }
  if (id !== currentId && new Set(existingIds).has(id)) return { ok: false, code: "duplicate", id }
  return { ok: true, id }
}

export function makeUniqueAgentConfigId(prefix: string, existingIds: Iterable<string>): string {
  const existing = new Set(existingIds)
  let index = 1
  let candidate = `${prefix}_${index}`
  while (existing.has(candidate)) {
    index += 1
    candidate = `${prefix}_${index}`
  }
  return candidate
}

export function parseAgentConfigListText(text: string): string[] {
  const seen = new Set<string>()
  const values: string[] = []
  for (const item of text.split(/[\n,]/)) {
    const value = item.trim()
    if (!value || seen.has(value)) continue
    seen.add(value)
    values.push(value)
  }
  return values
}

export function formatAgentConfigList(values: Iterable<string>, delimiter = "\n"): string {
  const seen = new Set<string>()
  const normalized: string[] = []
  for (const item of values) {
    const value = item.trim()
    if (!value || seen.has(value)) continue
    seen.add(value)
    normalized.push(value)
  }
  return normalized.join(delimiter)
}

export function toggleAgentConfigListValue(
  text: string,
  value: string,
  enabled: boolean,
  delimiter = "\n",
): string {
  const normalized = value.trim()
  if (!normalized) return text
  const values = parseAgentConfigListText(text)
  const next = enabled
    ? [...values, normalized]
    : values.filter((item) => item !== normalized)
  return formatAgentConfigList(next, delimiter)
}

export const DEFAULT_AGENT_RUNTIME_PROFILE_ID = "agent_remote"

export function isServerCapableRuntimeProfile(profile: Record<string, unknown> | undefined): boolean {
  const executionLocation = String(profile?.execution_location || "remote_server")
  const workerKind = String(profile?.worker_kind || (executionLocation === "local_workspace" ? "local_peer" : "server_worker"))
  if (executionLocation === "local_workspace") return false
  return workerKind === "server_worker" || workerKind === "sandbox_worker"
}

export function resolveNewAgentRunProfile(
  selectedProfileId: string,
  profileIds: readonly string[],
  profiles: Record<string, Record<string, unknown>> = {},
): string {
  if (selectedProfileId && isServerCapableRuntimeProfile(profiles[selectedProfileId])) {
    return selectedProfileId
  }
  if (
    profileIds.includes(DEFAULT_AGENT_RUNTIME_PROFILE_ID)
    && isServerCapableRuntimeProfile(profiles[DEFAULT_AGENT_RUNTIME_PROFILE_ID])
  ) {
    return DEFAULT_AGENT_RUNTIME_PROFILE_ID
  }
  const serverProfile = profileIds.find((id) => isServerCapableRuntimeProfile(profiles[id]))
  return serverProfile || selectedProfileId || profileIds[0] || ""
}

export function renameRecordKey<T extends { id: string }>(
  records: Record<string, T>,
  oldId: string,
  newId: string,
): Record<string, T> {
  if (oldId === newId) return records
  const next: Record<string, T> = {}
  for (const [id, value] of Object.entries(records)) {
    if (id === oldId) {
      next[newId] = { ...value, id: newId }
    } else {
      next[id] = value
    }
  }
  return next
}

export function replaceRuntimeProfileReferences<T extends { runtime_profile: string }>(
  agents: Record<string, T>,
  oldProfileId: string,
  newProfileId: string,
): Record<string, T> {
  if (oldProfileId === newProfileId) return agents
  const next: Record<string, T> = {}
  for (const [id, agent] of Object.entries(agents)) {
    next[id] = agent.runtime_profile === oldProfileId
      ? { ...agent, runtime_profile: newProfileId }
      : agent
  }
  return next
}
