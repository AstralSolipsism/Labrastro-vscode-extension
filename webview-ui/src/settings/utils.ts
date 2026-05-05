export type ProviderType = "openai_chat" | "anthropic_messages" | "openai_responses"
export type ProviderCompat = "generic" | "deepseek" | "kimi" | "glm" | "qwen" | "zenmux"
export type EnvironmentEntryKind = "cli" | "mcp" | "skill"
export type EnvironmentSnapshotStatus = "idle" | "running" | "completed" | "error" | "canceled"

export interface ProviderDraft {
  providerId: string
  type: ProviderType
  compat: ProviderCompat
  baseUrl: string
  apiKey?: string
  enabled: boolean
}

export interface RuntimeProfileDraft {
  id: string
  executor: string
  execution_location: string
  model: string
  command: string
  argsText: string
  envText: string
  mcpServersText: string
  allowedToolsText: string
  deniedToolsText: string
  homePolicy: string
  approvalMode: string
  configIsolation: string
  credentialRefsText: string
}

export interface AgentDefinitionDraft {
  id: string
  name: string
  description: string
  runtime_profile: string
  max_concurrent_tasks: number
  capabilitiesText: string
  systemAppend: string
  mcpServersText: string
  skillsText: string
  credentialRefsText: string
}

export interface ToolchainEditorState {
  kind: EnvironmentEntryKind
  name: string
  enabled: boolean
  command: string
  argsText: string
  envText: string
  capabilitiesText: string
  check: string
  install: string
  repoUrl: string
  docsText: string
}

export function providerDraftToPayload(draft: ProviderDraft): Record<string, unknown> {
  return {
    provider_id: draft.providerId,
    type: draft.type,
    compat: draft.compat,
    base_url: draft.baseUrl,
    api_key: draft.apiKey || undefined,
    enabled: draft.enabled,
  }
}

export function modelProfilePayload(input: {
  profileId: string
  provider: string
  model: string
  maxTokens: number
  maxContextTokens: number
  temperature: number
  reasoningEffort?: string
  thinkingEnabled: boolean
}): Record<string, unknown> {
  return {
    profile_id: input.profileId,
    provider: input.provider,
    model: input.model,
    max_tokens: input.maxTokens,
    max_context_tokens: input.maxContextTokens,
    temperature: input.temperature,
    reasoning_effort: input.reasoningEffort || undefined,
    thinking_enabled: input.thinkingEnabled,
  }
}

export function parseStringList(text: string): string[] {
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

export function uniqueCommandRules(values: string[]): string[] {
  const seen = new Set<string>()
  const rules: string[] = []
  for (const value of values) {
    const rule = value.trim()
    if (!rule || seen.has(rule)) continue
    seen.add(rule)
    rules.push(rule)
  }
  return rules
}

export function runtimeProfileDraftToPayload(draft: RuntimeProfileDraft): Record<string, unknown> {
  return {
    executor: draft.executor,
    execution_location: draft.execution_location,
    model: draft.model || undefined,
    command: draft.command || undefined,
    args: parseStringList(draft.argsText),
    env: parseKvText(draft.envText),
    mcp: { servers: parseStringList(draft.mcpServersText) },
    allowed_tools: parseStringList(draft.allowedToolsText),
    denied_tools: parseStringList(draft.deniedToolsText),
    home_policy: draft.homePolicy,
    approval_mode: draft.approvalMode,
    config_isolation: draft.configIsolation,
    credential_refs: parseStringList(draft.credentialRefsText),
  }
}

export function agentDefinitionDraftToPayload(draft: AgentDefinitionDraft): Record<string, unknown> {
  return {
    name: draft.name,
    description: draft.description || undefined,
    runtime_profile: draft.runtime_profile || undefined,
    max_concurrent_tasks: Math.max(1, Math.floor(draft.max_concurrent_tasks || 1)),
    capabilities: parseStringList(draft.capabilitiesText),
    system_append: draft.systemAppend || undefined,
    mcp: { servers: parseStringList(draft.mcpServersText) },
    skills: parseStringList(draft.skillsText),
    credential_refs: parseStringList(draft.credentialRefsText),
  }
}

export function toolchainEditorToPayload(editor: ToolchainEditorState): Record<string, unknown> {
  return {
    kind: editor.kind,
    name: editor.name.trim(),
    enabled: editor.enabled,
    command: editor.command || undefined,
    args: parseStringList(editor.argsText),
    env: parseKvText(editor.envText),
    capabilities: parseStringList(editor.capabilitiesText),
    check: editor.check || undefined,
    install: editor.install || undefined,
    repo_url: editor.repoUrl || undefined,
    docs: parseDocsText(editor.docsText),
  }
}

export function normalizeEnvironmentSnapshot(value: unknown): {
  running: boolean
  status: EnvironmentSnapshotStatus
  summary: string
  entries: Array<{ id: string; kind: EnvironmentEntryKind; name: string }>
} {
  const item = objectValue(value)
  return {
    running: item.running === true,
    status: normalizeSnapshotStatus(item.status),
    summary: stringValue(item.summary, "尚未运行。"),
    entries: Array.isArray(item.entries)
      ? item.entries.map(objectValue).map((entry) => ({
          id: stringValue(entry.id),
          kind: normalizeEntryKind(entry.kind),
          name: stringValue(entry.name),
        }))
      : [],
  }
}

function parseKvText(text: string): Record<string, string> {
  const result: Record<string, string> = {}
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const index = trimmed.indexOf("=")
    if (index <= 0) continue
    result[trimmed.slice(0, index).trim()] = trimmed.slice(index + 1).trim()
  }
  return result
}

function parseDocsText(text: string): Array<{ title: string; url: string }> {
  return text.split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [title, url] = line.includes("|")
        ? line.split("|").map((part) => part.trim())
        : [line, line]
      return { title, url }
    })
    .filter((item) => item.url)
}

function normalizeSnapshotStatus(value: unknown): EnvironmentSnapshotStatus {
  const status = stringValue(value, "idle")
  return ["idle", "running", "completed", "error", "canceled"].includes(status)
    ? status as EnvironmentSnapshotStatus
    : "idle"
}

function normalizeEntryKind(value: unknown): EnvironmentEntryKind {
  const kind = stringValue(value)
  return kind === "mcp" || kind === "skill" ? kind : "cli"
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function stringValue(value: unknown, fallback = ""): string {
  if (value === undefined || value === null) return fallback
  return String(value)
}
