export type ProviderType = "openai_chat" | "anthropic_messages" | "openai_responses"
export type ProviderCompat = "generic" | "deepseek" | "kimi" | "glm" | "qwen" | "zenmux"
export type ProviderKind =
  | "openai-compatible"
  | "openai-responses"
  | "anthropic"
  | "deepseek"
  | "kimi"
  | "qwen"
  | "glm"
  | "zenmux"
  | "custom"
export type EnvironmentRequirementKind =
  | "executable"
  | "runtime"
  | "sdk"
  | "service"
  | "env_var"
  | "credential"
  | "path"
  | "project_file"
  | "container"
export type EnvironmentEntryKind = "environment_requirement" | "mcp" | "unsupported"
export type EnvironmentSnapshotStatus = "idle" | "running" | "completed" | "error" | "canceled"
export type ConnectionNoticeTone = "success" | "warning" | "error" | "info"

export interface ConnectionNotice {
  tone: ConnectionNoticeTone
  icon: string
  message: string
}

export interface ProviderKindOption {
  id: ProviderKind
  label: string
  description: string
  aliases: string[]
  defaultBaseUrl?: string
  helpUrl?: string
  type: ProviderType
  compat: ProviderCompat
}

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
  dispatchProfileText: string
  dispatchExamplesText: string
  dispatchAvoidText: string
  systemAppend: string
  capabilityRefsText: string
  credentialRefsText: string
}

export interface ToolchainEditorState {
  kind: EnvironmentEntryKind
  name: string
  enabled: boolean
  command: string
  argsText: string
  envText: string
  tagsText: string
  check: string
  install: string
  repoUrl: string
  docsText: string
}

export interface ChoiceOption {
  id: string
  label?: string
  description?: string
  kind?: string
}

export const PROVIDER_TYPE_OPTIONS: ProviderType[] = ["openai_chat", "anthropic_messages", "openai_responses"]
export const PROVIDER_COMPAT_OPTIONS: ProviderCompat[] = ["generic", "deepseek", "kimi", "glm", "qwen", "zenmux"]
export const PROVIDER_KIND_REGISTRY: ProviderKindOption[] = [
  {
    id: "openai-compatible",
    label: "OpenAI compatible",
    description: "适合 OpenAI 格式网关、One API、LiteLLM、New API。",
    aliases: ["openai", "compatible", "one api", "oneapi", "litellm", "new api", "gateway"],
    type: "openai_chat",
    compat: "generic",
  },
  {
    id: "openai-responses",
    label: "OpenAI Responses",
    description: "使用 OpenAI Responses API 的原生调用路径。",
    aliases: ["openai", "responses"],
    defaultBaseUrl: "https://api.openai.com/v1",
    type: "openai_responses",
    compat: "generic",
  },
  {
    id: "anthropic",
    label: "Anthropic",
    description: "Claude Messages API。",
    aliases: ["anthropic", "claude"],
    defaultBaseUrl: "https://api.anthropic.com",
    type: "anthropic_messages",
    compat: "generic",
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    description: "OpenAI 格式，应用 DeepSeek 兼容差异。",
    aliases: ["deepseek", "deepseek-chat", "deepseek-reasoner"],
    defaultBaseUrl: "https://api.deepseek.com",
    type: "openai_chat",
    compat: "deepseek",
  },
  {
    id: "kimi",
    label: "Kimi",
    description: "OpenAI 格式，应用 Kimi 兼容差异。",
    aliases: ["kimi", "moonshot"],
    defaultBaseUrl: "https://api.moonshot.cn/v1",
    type: "openai_chat",
    compat: "kimi",
  },
  {
    id: "qwen",
    label: "Qwen",
    description: "OpenAI 格式，应用 Qwen 兼容差异。",
    aliases: ["qwen", "dashscope", "aliyun", "alibaba"],
    defaultBaseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    type: "openai_chat",
    compat: "qwen",
  },
  {
    id: "glm",
    label: "GLM",
    description: "OpenAI 格式，应用 GLM 兼容差异。",
    aliases: ["glm", "zhipu", "bigmodel"],
    defaultBaseUrl: "https://open.bigmodel.cn/api/paas/v4",
    type: "openai_chat",
    compat: "glm",
  },
  {
    id: "zenmux",
    label: "ZenMux",
    description: "ZenMux 兼容网关。",
    aliases: ["zenmux"],
    type: "openai_chat",
    compat: "zenmux",
  },
  {
    id: "custom",
    label: "自定义",
    description: "手动指定协议类型与兼容模式。",
    aliases: ["custom", "manual", "自定义", "手动"],
    type: "openai_chat",
    compat: "generic",
  },
]

export function resolveProviderProtocol(kind: ProviderKind): Pick<ProviderDraft, "type" | "compat"> {
  const option = PROVIDER_KIND_REGISTRY.find((item) => item.id === kind)
  return {
    type: option?.type || "openai_chat",
    compat: option?.compat || "generic",
  }
}

export function inferProviderKind(input: {
  providerId?: string
  baseUrl?: string
  type?: ProviderType
  compat?: ProviderCompat
}): ProviderKind {
  const text = `${input.providerId || ""} ${input.baseUrl || ""}`.toLowerCase()
  if (input.type === "anthropic_messages" || text.includes("anthropic") || text.includes("claude")) return "anthropic"
  if (input.type === "openai_responses") return "openai-responses"
  if (input.compat && input.compat !== "generic") return input.compat
  if (text.includes("deepseek")) return "deepseek"
  if (text.includes("moonshot") || text.includes("kimi")) return "kimi"
  if (text.includes("dashscope") || text.includes("qwen") || text.includes("aliyun")) return "qwen"
  if (text.includes("bigmodel") || text.includes("zhipu") || text.includes("glm")) return "glm"
  if (text.includes("zenmux")) return "zenmux"
  return "openai-compatible"
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

export function textToChoiceList(text: string): string[] {
  return parseStringList(text)
}

export function choiceListToText(values: string[], delimiter = "\n"): string {
  const seen = new Set<string>()
  const next: string[] = []
  for (const item of values) {
    const value = String(item).trim()
    if (!value || seen.has(value)) continue
    seen.add(value)
    next.push(value)
  }
  return next.join(delimiter)
}

export function modelOwnerDisplay(owner: unknown, providerId: unknown): string | undefined {
  const value = stringValue(owner).trim()
  const provider = stringValue(providerId).trim()
  if (!value || value.toLowerCase() === provider.toLowerCase() || value === "provider") return undefined
  return value
}

export function approvalRuleDraftToPayload(rule: Record<string, unknown>): Record<string, string> {
  const next: Record<string, string> = {
    action: stringValue(rule.action, "require_approval") || "require_approval",
  }
  for (const field of ["tool_name", "tool_source", "mcp_server", "effect_class", "profile"]) {
    const value = stringValue(rule[field]).trim()
    if (value) next[field] = value
  }
  return next
}

export function uniqueCommandRules(values: string[]): string[] {
  const seen = new Set<string>()
  const rules: string[] = []
  for (const value of values) {
    const rule = value.trim().replace(/\s+/g, " ")
    const key = rule.toLowerCase()
    if (!rule || seen.has(key)) continue
    seen.add(key)
    rules.push(rule)
  }
  return rules
}

export function resolveConnectionNotice(input: {
  status?: unknown
  message?: unknown
  authenticated?: unknown
}): ConnectionNotice | undefined {
  const message = stringValue(input.message).trim()
  if (!message) return undefined

  const status = stringValue(input.status)
  if (status === "ready" && input.authenticated === true) return undefined
  if (status === "error") return { tone: "error", icon: "error", message }
  if (status === "login-required") return { tone: "warning", icon: "warning", message }
  if (status === "checking") return { tone: "info", icon: "info", message }
  return { tone: "info", icon: "info", message }
}

export function isAccountAdminRole(role: unknown): boolean {
  return role === "admin" || role === "superadmin"
}

export function canUseSettingsAdminData(connectionState: Record<string, unknown>): boolean {
  return connectionState.authenticated === true && isAccountAdminRole(connectionState.role)
}

export function settingsAdminRecordList(
  adminState: Record<string, unknown>,
  key: string,
  adminDataUsable: boolean,
): Record<string, unknown>[] {
  if (!adminDataUsable) return []
  const items = adminState[key]
  return Array.isArray(items) ? items as Record<string, unknown>[] : []
}

export function providerListEmptyMessageForState(input: {
  connectionStatus?: unknown
  authenticated?: unknown
  adminUsable?: boolean
  loading?: boolean
  adminError?: unknown
}): string {
  if (input.connectionStatus === "checking") return "正在检查登录状态。"
  if (input.authenticated !== true) return "未登录，无法加载服务商。"
  if (input.adminUsable !== true) return "当前账号没有管理服务商的权限。"
  if (input.loading === true) return "正在加载服务商..."
  if (input.adminError) return "服务商列表加载失败。"
  return "暂无服务商"
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
  const dispatch: Record<string, unknown> = {}
  if (draft.dispatchProfileText.trim()) dispatch.profile = draft.dispatchProfileText.trim()
  const examples = parseStringList(draft.dispatchExamplesText)
  if (examples.length) dispatch.examples = examples
  const avoid = parseStringList(draft.dispatchAvoidText)
  if (avoid.length) dispatch.avoid = avoid
  return {
    name: draft.name,
    description: draft.description || undefined,
    runtime_profile: draft.runtime_profile || undefined,
    max_concurrent_tasks: Math.max(1, Math.floor(draft.max_concurrent_tasks || 1)),
    dispatch: Object.keys(dispatch).length ? dispatch : undefined,
    system_append: draft.systemAppend || undefined,
    capability_refs: parseStringList(draft.capabilityRefsText),
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
    tags: parseStringList(editor.tagsText),
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
  entries: Array<{ id: string; kind: EnvironmentEntryKind; requirementKind: EnvironmentRequirementKind | "unsupported"; name: string }>
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
            requirementKind: normalizeRequirementKind(entry.requirement_kind || entry.resource_kind || entry.kind),
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
  if (kind === "environment_requirement" || kind === "mcp") return kind
  return "unsupported"
}

function normalizeRequirementKind(value: unknown): EnvironmentRequirementKind | "unsupported" {
  const kind = stringValue(value)
  return [
    "executable",
    "runtime",
    "sdk",
    "service",
    "env_var",
    "credential",
    "path",
    "project_file",
    "container",
  ].includes(kind) ? kind as EnvironmentRequirementKind : "unsupported"
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function stringValue(value: unknown, fallback = ""): string {
  if (value === undefined || value === null) return fallback
  return String(value)
}
