import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount, untrack } from "solid-js"
import { useVSCode } from "../context/vscode"
import { useServer } from "../context/server"
import {
  normalizeHostUrlInput,
  resolveHostSaveResult,
  shouldSyncHostDraft,
  validateHostUrlInput,
} from "../utils/host-url"
import {
  formatAgentConfigList,
  makeUniqueAgentConfigId,
  parseAgentConfigListText,
  renameRecordKey,
  replaceRuntimeProfileReferences,
  resolveNewAgentRunProfile,
  toggleAgentConfigListValue,
  validateAgentConfigId,
} from "../utils/agent-config"
import { t } from "../i18n"
import { updateCommandRuleLists } from "../utils/command-auto-approval"
import { settingsMessages } from "./settingsMessages"
import {
  connectionSaveResultKey,
  sanitizeAutoApproveOptions,
  serverAgentRunSettingsPayload,
} from "./settingsControllerUtils"
import { isAccountAdminRole, resolveConnectionNotice, uniqueCommandRules, type ChoiceOption } from "./utils"
import {
  DEFAULT_AUTO_APPROVE_OPTIONS,
  approvalFromPayload,
  type ApprovalDecision,
  type ApprovalDetails,
} from "../components/chat/ApprovalDetailsDialog"

type ProviderType = "openai_chat" | "anthropic_messages" | "openai_responses"
type ProviderCompat = "generic" | "deepseek" | "kimi" | "glm" | "qwen" | "zenmux"

type SettingsTab = "executors" | "accounts" | "providers" | "toolchains" | "conversation" | "sessionPolicy" | "serverSettings" | "agentConfig" | "autoApproval" | "integrations" | "diagnostics"
/** 主执行器运行位置 */
type ExecutorLocation = "local" | "remote"

/** 执行器引擎类型 */
type ExecutorEngine = "labrastro" | "claude" | "codex" | "gemini" | "astrbot"

interface ExecutorEngineOption {
  id: ExecutorEngine
  label: string
  icon: string
  description: string
  ready: boolean
}

const EXECUTOR_ENGINES: ExecutorEngineOption[] = [
  { id: "labrastro",  label: "Labrastro",  icon: "radio-tower",  description: "Labrastro 执行器",        ready: true  },
  { id: "claude",  label: "Claude",  icon: "sparkle",      description: "Anthropic Claude API",  ready: false },
  { id: "codex",   label: "Codex",   icon: "code",         description: "OpenAI Codex CLI",      ready: false },
  { id: "gemini",  label: "Gemini",  icon: "star-empty",   description: "Google Gemini CLI",     ready: false },
  { id: "astrbot", label: "AstrBot", icon: "rocket",       description: "AstrBot 多平台框架",     ready: false },
]

function executorLocationLabel(location: ExecutorLocation): string {
  return location === "local" ? "本地" : "远端"
}

function executorEngineLabel(engine: ExecutorEngine): string {
  return EXECUTOR_ENGINES.find((e) => e.id === engine)?.label || engine
}
type ModelDetailMode = "fetched" | "custom"
type ModelActionIntent = "" | "savePreset"
type EnvironmentEntryKind = "cli" | "mcp" | "skill"
type ToolchainKind = EnvironmentEntryKind
type ToolchainKindFilter = "all" | ToolchainKind
type ToolchainStatusFilter = "all" | "ready" | "missing" | "stopped" | "awaiting"
const BUILT_IN_ENVIRONMENT_AGENT_ID = "environment_configurator"
type EnvironmentEntryStatus =
  | "unchecked"
  | "checking"
  | "available"
  | "missing"
  | "awaiting_approval"
  | "downloading"
  | "installing"
  | "configured"
  | "failed"
  | "stopped"
  | "parse_failed"
  | "needs_review"
type EnvironmentSnapshotStatus = "idle" | "running" | "completed" | "error" | "canceled"

export interface SettingsViewProps {
  targetTab?: string
  onEnvironmentRun?: (request: EnvironmentRunLaunchRequest) => void
}

interface EnvironmentRunLaunchRequest {
  id: string
  mode: "check" | "configure"
  executionMode: "serial" | "combined"
  items: Array<{ id: string; name: string; kind: EnvironmentEntryKind }>
}

interface ProviderModelEntry {
  id: string
  owned_by?: string
  created?: number

  max_tokens?: number

  max_context_tokens?: number

  capability_source?: string

  capability?: Record<string, unknown>

  supports_tools?: boolean

  supports_structured_outputs?: boolean

  supports_json_output?: boolean

  supports_reasoning?: boolean

  supports_vision?: boolean

  supports_parallel_tool_calls?: boolean
}

function knownModelCapabilityDefaults(
  provider: string,
  model: string,
): Pick<ProviderModelEntry, "max_tokens" | "max_context_tokens" | "capability_source"> {
  const providerText = provider.trim().toLowerCase()
  const modelText = model.trim().toLowerCase()
  if (providerText === "deepseek" && (modelText === "deepseek-v4-flash" || modelText === "deepseek-v4-pro")) {
    return {
      max_context_tokens: 1_000_000,
      max_tokens: 384_000,
      capability_source: "DeepSeek API Docs / Models & Pricing",
    }
  }
  return {}
}

interface EnvironmentEntryState {
  id: string
  kind: EnvironmentEntryKind
  name: string
  description: string
  source: string
  version?: string
  check: string
  install: string
  command?: string
  alias?: string
  tags: string[]
  status: EnvironmentEntryStatus
  detail?: string
  lastAction?: string
  lastUpdated?: string
}

interface EnvironmentApprovalState extends ApprovalDetails {
  approvalId: string
  toolName: string
  command: string
  entryId?: string
}

interface EnvironmentLogState {
  id: string
  level: "info" | "warning" | "error"
  message: string
  createdAt: string
  entryId?: string
}

interface EnvironmentSnapshotState {
  mode: "check" | "configure" | null
  running: boolean
  status: EnvironmentSnapshotStatus
  summary: string
  chatId?: string
  taskId?: string
  agentId?: string
  sessionId?: string
  startedAt?: string
  completedAt?: string
  lastManifestAt?: string
  error?: string
  entries: EnvironmentEntryState[]
  approvals: EnvironmentApprovalState[]
  logs: EnvironmentLogState[]
  lastRunSummary?: string
  lastRunCompletedAt?: string
  lastRunStatus?: "completed" | "error" | "canceled"
}

interface ToolchainRecord {
  kind: ToolchainKind
  name: string
  enabled?: boolean
  command?: string
  tags?: string[]
  args?: string[]
  env?: Record<string, string>
  cwd?: string
  placement?: string
  distribution?: string
  requirements?: Record<string, string>
  scope?: string
  check?: string
  install?: string
  version?: string
  source?: string
  description?: string
  path_hint?: string
  docs?: Array<{ title?: string; url?: string }>
  evidence?: Array<Record<string, string>>
  repo_url?: string
  credentials?: string[]
  risk_level?: string
  last_action?: string
  last_updated?: string
  install_prompt?: string
  verify_prompt?: string
  notes?: string[]
}

interface ToolchainDashboardItem {
  id: string
  kind: ToolchainKind
  name: string
  alias: string
  source: string
  repo_url: string
  docs: Array<{ title?: string; url?: string }>
  evidence: Array<Record<string, string>>
  placement: string
  scope: string
  status: EnvironmentEntryStatus
  status_detail: string
  check: string
  install: string
  command: string
  requirements: Record<string, string>
  credentials: string[]
  risk_level: string
  enabled: boolean
  last_action: string
  last_updated: string
}

interface ExecutorFeatureView {
  installed: boolean
  version: string
  streamJson: boolean
  sessionDiscovery: boolean
  resumeById: boolean
  usage: boolean
  mcpConfig: boolean
  runtimeHomeIsolation: string
  modelArg: boolean
  testedVersion: string
  limitations: string[]
}

interface CapabilityPackageView {
  id: string
  name: string
  description: string
  mcpServers: string[]
  skills: string[]
  cliTools: string[]
  source: string
}

interface ToolchainEditorState {
  mode: "create" | "edit"
  kind: ToolchainKind
  name: string
  enabled: boolean
  command: string
  tagsText: string
  argsText: string
  envText: string
  cwd: string
  placement: string
  distribution: string
  requirementsText: string
  scope: string
  check: string
  install: string
  version: string
  source: string
  description: string
  pathHint: string
  repoUrl: string
  docsText: string
  evidenceText: string
  credentialsText: string
  riskLevel: string
  installPrompt: string
  verifyPrompt: string
  notesText: string
}

/* ── Agent 配置类型 ── */

/** Runtime Profile 编辑器状态 */
interface RuntimeProfileDraft {
  id: string
  executor: string
  execution_location: string
  runtime_home_policy: string
  approval_mode: string
  config_isolation: string
  model: string
  command: string
  argsText: string
  envText: string
  credentialRefsText: string
  mcpServersText: string
}

/** Agent 定义编辑器状态 */
interface AgentDefinitionDraft {
  id: string
  name: string
  description: string
  role: string
  entrypoint: boolean

  runtime_profile: string
  modelKey: string
  dispatchProfileText: string
  dispatchExamplesText: string
  dispatchAvoidText: string
  systemAppend: string
  agentMd: string
  capabilityRefsText: string
  max_concurrent_tasks: number
  credentialRefsText: string
}

interface RuntimeOption {
  value: string
  labelKey: string
  descKey: string
}

const PROFILE_EXECUTOR_OPTIONS: RuntimeOption[] = [
  { value: "reuleauxcoder", labelKey: "agentConfig.profile.executor.reuleauxcoder", descKey: "agentConfig.profile.executor.reuleauxcoder.desc" },
  { value: "codex", labelKey: "agentConfig.profile.executor.codex", descKey: "agentConfig.profile.executor.codex.desc" },
  { value: "claude", labelKey: "agentConfig.profile.executor.claude", descKey: "agentConfig.profile.executor.claude.desc" },
  { value: "gemini", labelKey: "agentConfig.profile.executor.gemini", descKey: "agentConfig.profile.executor.gemini.desc" },
  { value: "fake", labelKey: "agentConfig.profile.executor.fake", descKey: "agentConfig.profile.executor.fake.desc" },
]
const PROFILE_EXECUTION_LOCATION_OPTIONS: RuntimeOption[] = [
  { value: "daemon_worktree", labelKey: "agentConfig.profile.executionLocation.daemonWorktree", descKey: "agentConfig.profile.executionLocation.daemonWorktree.desc" },
  { value: "local_workspace", labelKey: "agentConfig.profile.executionLocation.localWorkspace", descKey: "agentConfig.profile.executionLocation.localWorkspace.desc" },
  { value: "remote_server", labelKey: "agentConfig.profile.executionLocation.remoteServer", descKey: "agentConfig.profile.executionLocation.remoteServer.desc" },
]
const PROFILE_HOME_POLICY_OPTIONS: RuntimeOption[] = [
  { value: "per_task", labelKey: "agentConfig.profile.runtimeHomePolicy.perTask", descKey: "agentConfig.profile.runtimeHomePolicy.perTask.desc" },
  { value: "shared", labelKey: "agentConfig.profile.runtimeHomePolicy.shared", descKey: "agentConfig.profile.runtimeHomePolicy.shared.desc" },
  { value: "inherit", labelKey: "agentConfig.profile.runtimeHomePolicy.inherit", descKey: "agentConfig.profile.runtimeHomePolicy.inherit.desc" },
  { value: "none", labelKey: "agentConfig.profile.runtimeHomePolicy.none", descKey: "agentConfig.profile.runtimeHomePolicy.none.desc" },
]
const PROFILE_APPROVAL_MODE_OPTIONS: RuntimeOption[] = [
  { value: "full", labelKey: "agentConfig.profile.approvalMode.full", descKey: "agentConfig.profile.approvalMode.full.desc" },
  { value: "auto", labelKey: "agentConfig.profile.approvalMode.auto", descKey: "agentConfig.profile.approvalMode.auto.desc" },
  { value: "none", labelKey: "agentConfig.profile.approvalMode.none", descKey: "agentConfig.profile.approvalMode.none.desc" },
]
const PROFILE_CONFIG_ISOLATION_OPTIONS: RuntimeOption[] = [
  { value: "", labelKey: "agentConfig.profile.configIsolation.default", descKey: "agentConfig.profile.configIsolation.default.desc" },
  { value: "per_agent", labelKey: "agentConfig.profile.configIsolation.perAgent", descKey: "agentConfig.profile.configIsolation.perAgent.desc" },
  { value: "per_task", labelKey: "agentConfig.profile.configIsolation.perTask", descKey: "agentConfig.profile.configIsolation.perTask.desc" },
  { value: "shared", labelKey: "agentConfig.profile.configIsolation.shared", descKey: "agentConfig.profile.configIsolation.shared.desc" },
  { value: "inherit", labelKey: "agentConfig.profile.configIsolation.inherit", descKey: "agentConfig.profile.configIsolation.inherit.desc" },
]

function emptyProfileDraft(id = ""): RuntimeProfileDraft {
  return {
    id,
    executor: "reuleauxcoder",
    execution_location: "local_workspace",
    runtime_home_policy: "per_task",
    approval_mode: "full",
    config_isolation: "",
    model: "",
    command: "",
    argsText: "",
    envText: "",
    credentialRefsText: "",
    mcpServersText: "",
  }
}

function emptyAgentDraft(id = ""): AgentDefinitionDraft {
  return {
    id,
    name: "",
    description: "",
    role: "worker",
    entrypoint: false,

    runtime_profile: "",
    modelKey: "",
    dispatchProfileText: "",
    dispatchExamplesText: "",
    dispatchAvoidText: "",
    systemAppend: "",
    agentMd: "",
    capabilityRefsText: "",
    max_concurrent_tasks: 1,
    credentialRefsText: "",
  }
}

/** 将后端 profile 对象转为编辑器 draft */
function profileToDraft(id: string, profile: Record<string, unknown>): RuntimeProfileDraft {
  return {
    id,
    executor: stringValue(profile.executor, "reuleauxcoder"),
    execution_location: stringValue(profile.execution_location, "local_workspace"),
    runtime_home_policy: stringValue(profile.runtime_home_policy, "per_task"),
    approval_mode: stringValue(profile.approval_mode, "full"),
    config_isolation: stringValue(profile.config_isolation),
    model: stringValue(profile.model),
    command: stringValue(profile.command),
    argsText: Array.isArray(profile.args) ? JSON.stringify(profile.args) : "",
    envText: profile.env && typeof profile.env === "object" ? JSON.stringify(profile.env, null, 2) : "",
    credentialRefsText: kvObjectToText(objectValue(profile.credential_refs)),
    mcpServersText: profile.mcp && typeof profile.mcp === "object"
      ? stringArray((profile.mcp as Record<string, unknown>).servers).join("\n")
      : "",
  }
}

/** 将后端 agent 对象转为编辑器 draft */
function agentToDraft(id: string, agent: Record<string, unknown>): AgentDefinitionDraft {
  const prompt = objectValue(agent.prompt)
  const model = objectValue(agent.model)
  const dispatch = objectValue(agent.dispatch)
  const providerId = stringValue(model.provider || model.provider_id)
  const modelId = stringValue(model.model || model.model_id)
  return {
    id,
    name: stringValue(agent.name),
    description: stringValue(agent.description),
    role: stringValue(agent.role, "worker"),
    entrypoint: agent.entrypoint === true,

    runtime_profile: stringValue(agent.runtime_profile),
    modelKey: providerId && modelId ? modelOptionKey(providerId, modelId) : "",
    dispatchProfileText: stringValue(dispatch.profile),
    dispatchExamplesText: stringArray(dispatch.examples).join("\n"),
    dispatchAvoidText: stringArray(dispatch.avoid).join("\n"),
    systemAppend: stringValue(prompt.system_append),
    agentMd: stringValue(prompt.agent_md),
    capabilityRefsText: stringArray(agent.capability_refs).join(", "),
    max_concurrent_tasks: numberValue(agent.max_concurrent_tasks, 1),
    credentialRefsText: kvObjectToText(objectValue(agent.credential_refs)),
  }
}

function parseJsonDraftField(text: string, label: string): unknown {
  const trimmed = text.trim()
  if (!trimmed) return undefined
  try {
    return JSON.parse(trimmed) as unknown
  } catch (error) {
    throw new Error(`${label} JSON 无效：${error instanceof Error ? error.message : String(error)}`)
  }
}

/** 将 draft 转回后端 profile payload 格式 */
function profileDraftToPayload(draft: RuntimeProfileDraft): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    executor: draft.executor,
    execution_location: draft.execution_location,
    runtime_home_policy: draft.runtime_home_policy,
    approval_mode: draft.approval_mode,
  }
  if (draft.config_isolation.trim()) payload.config_isolation = draft.config_isolation.trim()
  if (draft.command) payload.command = draft.command
  const args = parseJsonDraftField(draft.argsText, "Args")
  if (args !== undefined && !Array.isArray(args)) throw new Error("Args 必须是 JSON 数组。")
  if (args !== undefined) payload.args = args
  const env = parseJsonDraftField(draft.envText, "Env")
  if (env !== undefined && (!env || typeof env !== "object" || Array.isArray(env))) {
    throw new Error("Env 必须是 JSON 对象。")
  }
  if (env !== undefined) payload.env = env
  const credRefs = textToKvObject(draft.credentialRefsText)
  if (Object.keys(credRefs).length) payload.credential_refs = credRefs
  const mcpServers = parseAgentConfigListText(draft.mcpServersText)
  if (mcpServers.length) payload.mcp = { servers: mcpServers }
  return payload
}

/** 将 draft 转回后端 agent payload 格式 */
function agentDraftToPayload(draft: AgentDefinitionDraft): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    name: draft.name || draft.id,
    max_concurrent_tasks: Math.max(1, Math.floor(draft.max_concurrent_tasks)),
  }
  if (draft.description) payload.description = draft.description
  if (draft.role.trim()) payload.role = draft.role.trim()
  if (draft.entrypoint) payload.entrypoint = true
  if (draft.runtime_profile) payload.runtime_profile = draft.runtime_profile
  const [providerId, modelId] = splitModelOptionKey(draft.modelKey)
  if (providerId && modelId) payload.model = { provider: providerId, model: modelId }
  const dispatch: Record<string, unknown> = {}
  if (draft.dispatchProfileText.trim()) dispatch.profile = draft.dispatchProfileText.trim()
  const dispatchExamples = parseAgentConfigListText(draft.dispatchExamplesText)
  if (dispatchExamples.length) dispatch.examples = dispatchExamples
  const dispatchAvoid = parseAgentConfigListText(draft.dispatchAvoidText)
  if (dispatchAvoid.length) dispatch.avoid = dispatchAvoid
  if (Object.keys(dispatch).length) payload.dispatch = dispatch
  const prompt: Record<string, string> = {}
  if (draft.systemAppend) prompt.system_append = draft.systemAppend
  if (draft.agentMd) prompt.agent_md = draft.agentMd
  if (Object.keys(prompt).length) payload.prompt = prompt
  const capabilityRefs = parseAgentConfigListText(draft.capabilityRefsText)
  if (capabilityRefs.length) payload.capability_refs = capabilityRefs
  const credRefs = textToKvObject(draft.credentialRefsText)
  if (Object.keys(credRefs).length) payload.credential_refs = credRefs
  return payload
}

/** key=value 文本转对象 */
function textToKvObject(text: string): Record<string, string> {
  const result: Record<string, string> = {}
  for (const line of text.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const eq = trimmed.indexOf("=")
    if (eq > 0) {
      result[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim()
    }
  }
  return result
}

/** 对象转 key=value 文本 */
function kvObjectToText(obj: Record<string, unknown>): string {
  return Object.entries(obj)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => `${key}=${String(value)}`)
    .join("\n")
}

function runtimeOptionDescription(options: RuntimeOption[], value: string): string {
  const option = options.find((item) => item.value === value)
  return option ? t(option.descKey) : ""
}

function optionValues(options: RuntimeOption[]): string[] {
  return options.map((item) => item.value)
}

const providerTypes: ProviderType[] = ["openai_chat", "anthropic_messages", "openai_responses"]
const compats: ProviderCompat[] = ["generic", "deepseek", "kimi", "glm", "qwen", "zenmux"]

const settingsTabDefs: Array<{ id: SettingsTab; labelKey: string; icon: string }> = [
  { id: "executors", labelKey: "settings.tab.executors", icon: "radio-tower" },
  { id: "providers", labelKey: "settings.tab.providers", icon: "server-process" },
  { id: "agentConfig", labelKey: "settings.tab.agentConfig", icon: "hubot" },
  { id: "toolchains", labelKey: "settings.tab.toolchains", icon: "tools" },
  { id: "conversation", labelKey: "settings.tab.conversation", icon: "comment-discussion" },
  { id: "sessionPolicy", labelKey: "settings.tab.sessionPolicy", icon: "layers" },
  { id: "autoApproval", labelKey: "settings.tab.autoApproval", icon: "shield" },
  { id: "serverSettings", labelKey: "settings.tab.serverSettings", icon: "server-environment" },
  { id: "integrations", labelKey: "settings.tab.integrations", icon: "plug" },
  { id: "diagnostics", labelKey: "settings.tab.diagnostics", icon: "pulse" },
  { id: "accounts", labelKey: "settings.tab.accounts", icon: "account" },
]

export function normalizeSettingsTab(value: unknown): SettingsTab | undefined {
  switch (value) {
    case "providers":
      return "providers"
    case "executors":
      return "executors"
    case "accounts":
      return "accounts"
    case "toolchains":
      return "toolchains"
    case "conversation":
      return "conversation"
    case "sessionPolicy":
      return "sessionPolicy"
    case "serverSettings":
      return "serverSettings"
    case "agentConfig":
      return "agentConfig"
    case "autoApproval":
      return "autoApproval"
    case "integrations":
      return "integrations"
    case "diagnostics":
      return "diagnostics"
    case "other":
      return "conversation"
    default:
      return undefined
  }
}

function asProviderType(value: unknown): ProviderType {
  return providerTypes.includes(value as ProviderType) ? value as ProviderType : "openai_chat"
}

function asProviderCompat(value: unknown): ProviderCompat {
  return compats.includes(value as ProviderCompat) ? value as ProviderCompat : "generic"
}

function stringValue(value: unknown, fallback = ""): string {
  if (value === undefined || value === null) return fallback
  return String(value)
}

function numberValue(value: unknown, fallback: number): number {
  const parsed = typeof value === "number" ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function boolValue(value: unknown, fallback = true): boolean {
  if (value === undefined || value === null) return fallback
  if (typeof value === "string") {
    return !["0", "false", "no", "off"].includes(value.trim().toLowerCase())
  }
  return Boolean(value)
}

function stringListText(value: unknown): string {
  return Array.isArray(value) ? value.map((item) => String(item)).join("\n") : ""
}

function parseStringList(value: string): string[] {
  return value
    .split(/\r?\n|,/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function mapText(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) return ""
  return Object.entries(value as Record<string, unknown>)
    .map(([key, item]) => `${key}=${String(item)}`)
    .join("\n")
}

function parseMapText(value: string): Record<string, string> {
  const result: Record<string, string> = {}
  for (const line of value.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const index = trimmed.indexOf("=")
    if (index < 0) {
      result[trimmed] = ""
      continue
    }
    result[trimmed.slice(0, index).trim()] = trimmed.slice(index + 1).trim()
  }
  return result
}

function docsText(value: unknown): string {
  if (!Array.isArray(value)) return ""
  return value
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
    .map((item) => `${stringValue(item.title)} | ${stringValue(item.url)}`.trim())
    .join("\n")
}

function parseDocsText(value: string): Array<{ title: string; url: string }> {
  const docs: Array<{ title: string; url: string }> = []
  for (const line of value.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const [titlePart, ...urlParts] = trimmed.split("|")
    const title = titlePart.trim()
    const url = urlParts.join("|").trim()
    if (!title && !url) continue
    docs.push({ title, url })
  }
  return docs
}

function evidenceText(value: unknown): string {
  if (!Array.isArray(value)) return ""
  return value
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
    .map((item) =>
      [
        stringValue(item.field),
        stringValue(item.title),
        stringValue(item.url),
        stringValue(item.excerpt),
      ].join(" | ").trim()
    )
    .join("\n")
}

function parseEvidenceText(value: string): Array<Record<string, string>> {
  const evidence: Array<Record<string, string>> = []
  for (const line of value.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const [field = "", title = "", url = "", ...excerptParts] = trimmed.split("|").map((part) => part.trim())
    const item: Record<string, string> = {}
    if (field) item.field = field
    if (title) item.title = title
    if (url) item.url = url
    const excerpt = excerptParts.join(" | ").trim()
    if (excerpt) item.excerpt = excerpt
    if (Object.keys(item).length) evidence.push(item)
  }
  return evidence
}

function normalizeToolchainList(value: unknown, kind: ToolchainKind): ToolchainRecord[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
    .map((item) => ({ ...item, kind, name: stringValue(item.name || item.id) } as ToolchainRecord))
    .filter((item) => item.name)
}

function emptyToolchainEditor(kind: ToolchainKind): ToolchainEditorState {
  return {
    mode: "create",
    kind,
    name: "",
    enabled: true,
    command: "",
    tagsText: "",
    argsText: "",
    envText: "",
    cwd: "",
    placement: kind === "cli" ? "local" : "peer",
    distribution: "command",
    requirementsText: "",
    scope: "project",
    check: "",
    install: "",
    version: "",
    source: "",
    description: "",
    pathHint: "",
    repoUrl: "",
    docsText: "",
    evidenceText: "",
    credentialsText: "",
    riskLevel: "",
    installPrompt: "",
    verifyPrompt: "",
    notesText: "",
  }
}

function toolchainEditorFromRecord(record: ToolchainRecord): ToolchainEditorState {
  return {
    ...emptyToolchainEditor(record.kind),
    mode: "edit",
    name: record.name,
    enabled: boolValue(record.enabled, true),
    command: stringValue(record.command),
    tagsText: stringListText(record.tags),
    argsText: stringListText(record.args),
    envText: mapText(record.env),
    cwd: stringValue(record.cwd),
    placement: stringValue(record.placement, "peer"),
    distribution: stringValue(record.distribution, "command"),
    requirementsText: mapText(record.requirements),
    scope: stringValue(record.scope, "project"),
    check: stringValue(record.check),
    install: stringValue(record.install),
    version: stringValue(record.version),
    source: stringValue(record.source),
    description: stringValue(record.description),
    pathHint: stringValue(record.path_hint),
    repoUrl: stringValue(record.repo_url),
    docsText: docsText(record.docs),
    evidenceText: evidenceText(record.evidence),
    credentialsText: stringListText(record.credentials),
    riskLevel: stringValue(record.risk_level),
    installPrompt: stringValue(record.install_prompt),
    verifyPrompt: stringValue(record.verify_prompt),
    notesText: stringListText(record.notes),
  }
}

function toolchainPayloadFromEditor(editor: ToolchainEditorState): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    name: editor.name.trim(),
    enabled: editor.enabled,
    check: editor.check.trim(),
    install: editor.install.trim(),
    version: editor.version.trim() || undefined,
    source: editor.source.trim(),
    description: editor.description.trim(),
    repo_url: editor.repoUrl.trim(),
    docs: parseDocsText(editor.docsText),
    evidence: parseEvidenceText(editor.evidenceText),
    requirements: parseMapText(editor.requirementsText),
    credentials: parseStringList(editor.credentialsText),
    risk_level: editor.riskLevel.trim(),
    install_prompt: editor.installPrompt.trim(),
    verify_prompt: editor.verifyPrompt.trim(),
    notes: parseStringList(editor.notesText),
  }
  if (editor.kind === "cli") {
    payload.command = editor.command.trim()
    payload.placement = editor.placement || "local"
    payload.tags = parseStringList(editor.tagsText)
  } else if (editor.kind === "mcp") {
    payload.command = editor.command.trim()
    payload.args = parseStringList(editor.argsText)
    payload.env = parseMapText(editor.envText)
    payload.cwd = editor.cwd.trim() || undefined
    payload.placement = editor.placement || "peer"
    payload.distribution = editor.distribution || "command"
  } else {
    payload.scope = editor.scope || "project"
    payload.path_hint = editor.pathHint.trim() || undefined
  }
  return payload
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item)).filter(Boolean) : []
}

function executorFeatureValue(value: unknown): ExecutorFeatureView {
  const feature = objectValue(value)
  return {
    installed: feature.installed === true,
    version: stringValue(feature.version),
    streamJson: feature.streamJson === true,
    sessionDiscovery: feature.sessionDiscovery === true,
    resumeById: feature.resumeById === true,
    usage: feature.usage === true,
    mcpConfig: feature.mcpConfig === true,
    runtimeHomeIsolation: stringValue(feature.runtimeHomeIsolation),
    modelArg: feature.modelArg === true,
    testedVersion: stringValue(feature.testedVersion),
    limitations: stringArray(feature.limitations),
  }
}

function capabilityPackageValue(id: string, value: unknown): CapabilityPackageView {
  const item = objectValue(value)
  return {
    id,
    name: stringValue(item.name, id),
    description: stringValue(item.description),
    mcpServers: stringArray(item.mcp_servers),
    skills: stringArray(item.skills),
    cliTools: stringArray(item.cli_tools),
    source: stringValue(item.source),
  }
}

function stringMapValue(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  return Object.entries(value as Record<string, unknown>).reduce<Record<string, string>>((acc, [key, item]) => {
    acc[key] = stringValue(item)
    return acc
  }, {})
}

function normalizeEvidence(value: unknown): Array<Record<string, string>> {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
    .map((item) => stringMapValue(item))
    .filter((item) => Object.keys(item).length > 0)
}

function normalizeToolchainStatus(value: unknown): EnvironmentEntryStatus {
  const text = stringValue(value)
  if (text === "ready") return "available"
  if ([
    "unchecked",
    "checking",
    "available",
    "missing",
    "awaiting_approval",
    "downloading",
    "installing",
    "configured",
    "failed",
    "stopped",
    "parse_failed",
    "needs_review",
  ].includes(text)) {
    return text as EnvironmentEntryStatus
  }
  return "unchecked"
}

function toolchainRecordToDashboardItem(record: ToolchainRecord): ToolchainDashboardItem {
  const placement =
    record.kind === "skill"
      ? stringValue(record.scope, "project")
      : stringValue(record.placement, record.kind === "cli" ? "local" : "server")
  return {
    id: `${record.kind}:${record.name}`,
    kind: record.kind,
    name: record.name,
    alias: stringValue(record.command || record.path_hint || record.name),
    source: stringValue(record.source),
    repo_url: stringValue(record.repo_url),
    docs: Array.isArray(record.docs) ? record.docs : [],
    evidence: normalizeEvidence(record.evidence),
    placement,
    scope: record.kind === "skill" ? placement : stringValue(record.placement, placement),
    status: boolValue(record.enabled, true) ? "unchecked" : "stopped",
    status_detail: boolValue(record.enabled, true) ? "等待环境检查" : "清单已停用",
    check: stringValue(record.check),
    install: stringValue(record.install),
    command: stringValue(record.command || record.path_hint),
    requirements: stringMapValue(record.requirements),
    credentials: stringArray(record.credentials),
    risk_level: stringValue(record.risk_level),
    enabled: boolValue(record.enabled, true),
    last_action: stringValue(record.last_action),
    last_updated: stringValue(record.last_updated),
  }
}

function normalizeToolchainDashboardItems(
  value: unknown,
  fallbackGroups: Record<ToolchainKind, ToolchainRecord[]>,
  snapshot: EnvironmentSnapshotState,
): ToolchainDashboardItem[] {
  const rawItems = Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
    : []
  const baseItems = rawItems.length
    ? rawItems.map((item) => ({
        id: stringValue(item.id) || `${stringValue(item.kind)}:${stringValue(item.name)}`,
        kind: (["cli", "mcp", "skill"].includes(stringValue(item.kind)) ? stringValue(item.kind) : "cli") as ToolchainKind,
        name: stringValue(item.name),
        alias: stringValue(item.alias || item.command || item.name),
        source: stringValue(item.source),
        repo_url: stringValue(item.repo_url),
        docs: Array.isArray(item.docs) ? item.docs as Array<{ title?: string; url?: string }> : [],
        evidence: normalizeEvidence(item.evidence),
        placement: stringValue(item.placement || item.scope),
        scope: stringValue(item.scope || item.placement),
        status: normalizeToolchainStatus(item.status),
        status_detail: stringValue(item.status_detail),
        check: stringValue(item.check),
        install: stringValue(item.install),
        command: stringValue(item.command),
        requirements: stringMapValue(item.requirements),
        credentials: stringArray(item.credentials),
        risk_level: stringValue(item.risk_level),
        enabled: boolValue(item.enabled, true),
        last_action: stringValue(item.last_action),
        last_updated: stringValue(item.last_updated),
      }))
    : (["cli", "mcp", "skill"] as ToolchainKind[]).flatMap((kind) =>
        fallbackGroups[kind].map(toolchainRecordToDashboardItem)
      )
  const statusById = new Map(snapshot.entries.map((entry) => [entry.id, entry]))
  return baseItems
    .filter((item) => item.name)
    .map((item) => {
      const entry = statusById.get(item.id)
      if (!entry) return item
      return {
        ...item,
        status: normalizeToolchainStatus(entry.status),
        status_detail: entry.detail || environmentStatusLabel(entry.status),
        last_action: entry.lastAction || item.last_action,
        last_updated: entry.lastUpdated || item.last_updated,
      }
    })
}

function toolchainStatusBucket(status: EnvironmentEntryStatus): ToolchainStatusFilter {
  if (status === "available" || status === "configured") return "ready"
  if (status === "missing") return "missing"
  if (status === "stopped") return "stopped"
  if (status === "awaiting_approval" || status === "needs_review" || status === "parse_failed") return "awaiting"
  return "all"
}

function summarizeToolchainDashboard(items: ToolchainDashboardItem[]) {
  return items.reduce(
    (summary, item) => {
      const bucket = toolchainStatusBucket(item.status)
      if (bucket === "ready") summary.ready += 1
      if (bucket === "missing") summary.missing += 1
      if (bucket === "stopped") summary.stopped += 1
      if (bucket === "awaiting") summary.awaiting += 1
      return summary
    },
    { ready: 0, missing: 0, stopped: 0, awaiting: 0 },
  )
}

function placementLabel(item: ToolchainDashboardItem): string {
  if (item.kind === "cli") {
    if (item.placement === "server") return "服务端"
    if (item.placement === "both") return "服务端+本地端"
    return "本地端"
  }
  if (item.kind === "mcp") {
    if (item.placement === "server") return "服务端"
    if (item.placement === "both") return "服务端+本地端"
    return "本地端"
  }
  return item.scope === "user" || item.placement === "user" ? "用户级" : "项目级"
}

function toolchainSourceLabel(item: ToolchainDashboardItem): string {
  const firstDoc = item.docs[0]
  return item.repo_url || stringValue(firstDoc?.url) || item.source || "未记录"
}

function normalizeToolchainUrl(value: string): string {
  const trimmed = value.trim().toLowerCase()
  if (!trimmed) return ""
  try {
    const url = new URL(trimmed)
    url.hash = ""
    if (url.pathname !== "/") {
      url.pathname = url.pathname.replace(/\/+$/, "")
    }
    return url.toString().replace(/\/+$/, "")
  } catch {
    return trimmed.replace(/\/+$/, "")
  }
}

function toolchainDuplicateInputMatches(
  items: ToolchainDashboardItem[],
  repoUrl: string,
  docsUrl: string,
): { repo: ToolchainDashboardItem[]; docs: ToolchainDashboardItem[] } {
  const repo = normalizeToolchainUrl(repoUrl)
  const docs = normalizeToolchainUrl(docsUrl)
  const repoMatches = new Map<string, ToolchainDashboardItem>()
  const docsMatches = new Map<string, ToolchainDashboardItem>()
  for (const item of items) {
    const itemRepo = normalizeToolchainUrl(item.repo_url || (item.source.startsWith("http") ? item.source : ""))
    if (repo && itemRepo && repo === itemRepo) {
      repoMatches.set(item.id, item)
    }
    if (docs) {
      for (const doc of item.docs) {
        if (docs === normalizeToolchainUrl(stringValue(doc.url))) {
          docsMatches.set(item.id, item)
        }
      }
    }
  }
  return {
    repo: [...repoMatches.values()],
    docs: [...docsMatches.values()],
  }
}

function duplicateMatchLabel(item: ToolchainDashboardItem): string {
  return `${environmentKindLabel(item.kind)} ${item.name}`
}

function dashboardItemToRecord(item: ToolchainDashboardItem): ToolchainRecord {
  return {
    kind: item.kind,
    name: item.name,
    enabled: item.enabled,
    command: item.command,
    placement: item.kind === "skill" ? undefined : item.placement,
    scope: item.kind === "skill" ? item.scope || item.placement : undefined,
    requirements: item.requirements,
    check: item.check,
    install: item.install,
    source: item.source,
    description: item.alias,
    docs: item.docs,
    evidence: item.evidence,
    repo_url: item.repo_url,
    credentials: item.credentials,
    risk_level: item.risk_level,
    last_action: item.last_action,
    last_updated: item.last_updated,
  }
}

function makeProfileId(providerId: string, modelId: string): string {
  return `${providerId}-${modelId}`.replace(/[^a-zA-Z0-9_.-]+/g, "-")
}

function modelOptionKey(providerId: string, modelId: string): string {
  return `${providerId.trim()}::${modelId.trim()}`
}

function splitModelOptionKey(value: string): [string, string] {
  const [providerId, ...modelParts] = value.split("::")
  return [providerId?.trim() || "", modelParts.join("::").trim()]
}

function profileMatches(profile: Record<string, unknown>, providerId: string, modelId: string): boolean {
  return stringValue(profile.provider) === providerId && stringValue(profile.model) === modelId
}

function environmentStatusLabel(status: EnvironmentEntryStatus): string {
  switch (status) {
    case "checking":
      return "检查中"
    case "available":
      return "已就绪"
    case "missing":
      return "未安装"
    case "awaiting_approval":
      return "待授权"
    case "downloading":
      return "下载中"
    case "installing":
      return "安装中"
    case "configured":
      return "已就绪"
    case "stopped":
      return "未运行"
    case "parse_failed":
      return "解析失败"
    case "needs_review":
      return "待确认"
    case "failed":
      return "配置失败"
    default:
      return "未检查"
  }
}

function environmentStatusTone(status: EnvironmentEntryStatus): "success" | "warning" | "muted" | "error" {
  switch (status) {
    case "available":
    case "configured":
      return "success"
    case "checking":
    case "awaiting_approval":
    case "downloading":
    case "installing":
    case "needs_review":
      return "warning"
    case "missing":
    case "stopped":
    case "parse_failed":
    case "failed":
      return "error"
    default:
      return "muted"
  }
}

function environmentRunStatusLabel(status: EnvironmentSnapshotStatus): string {
  switch (status) {
    case "running":
      return "运行中"
    case "completed":
      return "已完成"
    case "error":
      return "失败"
    case "canceled":
      return "已停止"
    default:
      return "未开始"
  }
}

function environmentRunTone(status: EnvironmentSnapshotStatus): "success" | "warning" | "muted" | "error" {
  switch (status) {
    case "completed":
      return "success"
    case "running":
      return "warning"
    case "error":
      return "error"
    default:
      return "muted"
  }
}

function environmentKindLabel(kind: EnvironmentEntryKind): string {
  if (kind === "cli") return "CLI"
  if (kind === "mcp") return "MCP"
  return "Skills"
}

function environmentKindIcon(kind: EnvironmentEntryKind): string {
  if (kind === "cli") return "terminal"
  if (kind === "mcp") return "plug"
  return "hubot"
}

function formatTimestamp(value: unknown): string {
  const text = stringValue(value)
  if (!text) return "尚无记录"
  const parsed = new Date(text)
  return Number.isNaN(parsed.getTime()) ? text : parsed.toLocaleString()
}

function normalizeEnvironmentEntries(value: unknown): EnvironmentEntryState[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
    .map((item) => ({
      id: stringValue(item.id),
      kind: (["cli", "mcp", "skill"].includes(stringValue(item.kind)) ? stringValue(item.kind) : "cli") as EnvironmentEntryKind,
      name: stringValue(item.name),
      description: stringValue(item.description),
      source: stringValue(item.source),
      version: stringValue(item.version) || undefined,
      check: stringValue(item.check),
      install: stringValue(item.install),
      command: stringValue(item.command) || undefined,
      tags: stringArray(item.tags),
      status: ([
        "unchecked",
        "checking",
        "available",
        "missing",
        "awaiting_approval",
        "downloading",
        "installing",
        "configured",
        "failed",
        "stopped",
        "parse_failed",
        "needs_review",
      ].includes(stringValue(item.status)) ? stringValue(item.status) : "unchecked") as EnvironmentEntryStatus,
      detail: stringValue(item.detail) || undefined,
      lastAction: stringValue(item.lastAction) || undefined,
      lastUpdated: stringValue(item.lastUpdated) || undefined,
    }))
}

function normalizeEnvironmentApprovals(value: unknown): EnvironmentApprovalState[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
    .map((item) => {
      const rawPayload = objectValue(item.rawPayload)
      const localArgs = objectValue(item.toolArgs)
      const rawArgs = objectValue(rawPayload.tool_args)
      const detail = approvalFromPayload(rawPayload, {
        approvalId: stringValue(item.approvalId),
        toolName: stringValue(item.toolName, "tool"),
        toolSource: stringValue(item.toolSource) || undefined,
        command: stringValue(item.command),
        reason: stringValue(item.reason) || undefined,
        content: stringValue(item.content) || undefined,
        toolArgs: localArgs,
        sections: Array.isArray(item.sections) ? item.sections as Record<string, unknown>[] : [],
        previewUnavailable: item.previewUnavailable === true,
        previewError: stringValue(item.previewError) || undefined,
      })
      return {
        ...detail,
        command: stringValue(item.command) || stringValue(localArgs.command) || stringValue(rawArgs.command) || detail.command || "",
        entryId: stringValue(item.entryId) || undefined,
      }
    })
}

function normalizeEnvironmentLogs(value: unknown): EnvironmentLogState[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
    .map((item) => ({
      id: stringValue(item.id),
      level: (["info", "warning", "error"].includes(stringValue(item.level)) ? stringValue(item.level) : "info") as EnvironmentLogState["level"],
      message: stringValue(item.message),
      createdAt: stringValue(item.createdAt),
      entryId: stringValue(item.entryId) || undefined,
    }))
}

function normalizeEnvironmentSnapshot(value: unknown): EnvironmentSnapshotState {
  const item = value && typeof value === "object" ? value as Record<string, unknown> : {}
  return {
    mode: ["check", "configure"].includes(stringValue(item.mode)) ? stringValue(item.mode) as "check" | "configure" : null,
    running: item.running === true,
    status: (["idle", "running", "completed", "error", "canceled"].includes(stringValue(item.status)) ? stringValue(item.status) : "idle") as EnvironmentSnapshotStatus,
    summary: stringValue(item.summary, "环境清单尚未加载。"),
    chatId: stringValue(item.chatId) || undefined,
    taskId: stringValue(item.taskId) || undefined,
    agentId: stringValue(item.agentId) || undefined,
    sessionId: stringValue(item.sessionId) || undefined,
    startedAt: stringValue(item.startedAt) || undefined,
    completedAt: stringValue(item.completedAt) || undefined,
    lastManifestAt: stringValue(item.lastManifestAt) || undefined,
    error: stringValue(item.error) || undefined,
    entries: normalizeEnvironmentEntries(item.entries),
    approvals: normalizeEnvironmentApprovals(item.approvals),
    logs: normalizeEnvironmentLogs(item.logs),
    lastRunSummary: stringValue(item.lastRunSummary) || undefined,
    lastRunCompletedAt: stringValue(item.lastRunCompletedAt) || undefined,
    lastRunStatus: (["completed", "error", "canceled"].includes(stringValue(item.lastRunStatus)) ? stringValue(item.lastRunStatus) : undefined) as EnvironmentSnapshotState["lastRunStatus"],
  }
}

function summarizeEnvironmentEntries(entries: EnvironmentEntryState[]) {
  return entries.reduce(
    (summary, entry) => {
      summary.total += 1
      if (entry.status === "available") summary.available += 1
      if (entry.status === "configured") summary.configured += 1
      if (entry.status === "missing") summary.missing += 1
      if (entry.status === "failed") summary.failed += 1
      return summary
    },
    { total: 0, available: 0, configured: 0, missing: 0, failed: 0 },
  )
}

function formatActionResult(
  result: Record<string, unknown> | undefined,
  intent: ModelActionIntent,
): string | undefined {
  if (!result) return undefined

  const provider = result.provider
  const modelProfile = result.model_profile

  if (result.unsupported === true) {
    return stringValue(result.message, "当前服务商无法自动获取模型列表。")
  }
  if (Array.isArray(result.blockers) && result.blockers.length > 0) {
    return `操作被阻止：仍有 ${result.blockers.length} 个已保存预设引用该服务商。`
  }
  if (Array.isArray(result.models)) {
    return result.models.length > 0
      ? `模型列表已刷新：${result.models.length} 个模型。`
      : "当前服务商未返回模型列表，请使用“自定义模型名”。"
  }
  if (provider && typeof provider === "object") {
    const id = stringValue((provider as Record<string, unknown>).id, stringValue(result.provider_id))
    return id ? `服务商 ${id} 已保存。` : "服务商已保存。"
  }
  if (result.provider_id && result.enabled !== undefined) {
    return `服务商 ${String(result.provider_id)} 已${result.enabled === false ? "停用" : "启用"}。`
  }
  if (result.deleted === true && result.provider_id) {
    return `服务商 ${String(result.provider_id)} 已删除。`
  }
  if (modelProfile && typeof modelProfile === "object") {
    const profile = modelProfile as Record<string, unknown>
    const presetId = stringValue(profile.id, stringValue(result.profile_id))
    if (intent === "savePreset") {
      return presetId ? `预设 ${presetId} 已保存。` : "模型预设已保存。"
    }
  }
  if (result.ok === true) {
    return "操作已完成。"
  }
  return undefined
}

function formatConnectionSaveResult(result: Record<string, unknown> | undefined): string | undefined {
  if (!result) return undefined
  const requested = stringValue(result.hostUrlSaveRequested)
  const effective = stringValue(result.hostUrl)
  const source = stringValue(result.hostUrlSource, "unknown")
  const status = stringValue(result.status)
  if (status === "error") {
    return undefined
  }
  if (requested && (result.hostUrlSaveApplied !== true || effective !== requested)) {
    return `保存未生效：请求保存 ${requested}，当前实际请求 Host 仍是 ${effective || "未配置"}（来源：${source}）。`
  }
  if (requested) {
    return `已生效：${effective}（来源：${source}）。`
  }
  return undefined
}

export function createSettingsController(props: SettingsViewProps) {
  const vscode = useVSCode()
  const server = useServer()

  const [activeTab, setActiveTab] = createSignal<SettingsTab>("providers")

  /* ── 主执行器选择器状态 ── */
  const [executorPickerOpen, setExecutorPickerOpen] = createSignal(false)
  const [pickerLocation, setPickerLocation] = createSignal<ExecutorLocation>("remote")
  const [pickerEngine, setPickerEngine] = createSignal<ExecutorEngine>("labrastro")

  /* ── 按钮 loading 状态 ── */
  const [refreshLoading, setRefreshLoading] = createSignal(false)
  const [saveLoading, setSaveLoading] = createSignal(false)
  const [saveSuccess, setSaveSuccess] = createSignal(false)

  const [hostUrl, setHostUrl] = createSignal("")
  const [loginUsername, setLoginUsername] = createSignal("")
  const [loginPassword, setLoginPassword] = createSignal("")
  const [currentPassword, setCurrentPassword] = createSignal("")
  const [newPassword, setNewPassword] = createSignal("")
  const [newUserUsername, setNewUserUsername] = createSignal("")
  const [newUserPassword, setNewUserPassword] = createSignal("")
  const [newUserRole, setNewUserRole] = createSignal<"user" | "admin" | "superadmin">("user")
  const [resetPasswordUserId, setResetPasswordUserId] = createSignal("")
  const [resetPasswordValue, setResetPasswordValue] = createSignal("")
  const [auditEventType, setAuditEventType] = createSignal("")
  const [accountsBootstrapped, setAccountsBootstrapped] = createSignal(false)
  const [hostUrlDirty, setHostUrlDirty] = createSignal(false)
  const [pendingHostSave, setPendingHostSave] = createSignal<string | undefined>()
  const [hostUrlError, setHostUrlError] = createSignal<string | undefined>()
  const [hostUrlSyncLock, setHostUrlSyncLock] = createSignal<string | undefined>()
  const [dismissedConnectionSaveResultKey, setDismissedConnectionSaveResultKey] = createSignal<string | undefined>()

  const [providerId, setProviderId] = createSignal("deepseek")
  const [providerType, setProviderType] = createSignal<ProviderType>("openai_chat")
  const [providerCompat, setProviderCompat] = createSignal<ProviderCompat>("generic")
  const [providerBaseUrl, setProviderBaseUrl] = createSignal("https://api.deepseek.com")
  const [providerApiKey, setProviderApiKey] = createSignal("")
  const [providerModel, setProviderModel] = createSignal("")
  const [providerEnabled, setProviderEnabled] = createSignal(true)
  const [providerCopyId, setProviderCopyId] = createSignal("")
  const [modelSearch, setModelSearch] = createSignal("")
  const [fetchedModels, setFetchedModels] = createSignal<ProviderModelEntry[]>([])
  const [modelFetchMessage, setModelFetchMessage] = createSignal("")
  const [lastModelFetchProvider, setLastModelFetchProvider] = createSignal("")

  const [modelDetailOpen, setModelDetailOpen] = createSignal(false)
  const [modelDetailMode, setModelDetailMode] = createSignal<ModelDetailMode>("fetched")
  const [customModelDialogOpen, setCustomModelDialogOpen] = createSignal(false)
  const [customModelDraft, setCustomModelDraft] = createSignal("")
  const [actionIntent, setActionIntent] = createSignal<ModelActionIntent>("")
  const [environmentBootstrapped, setEnvironmentBootstrapped] = createSignal(false)
  const [selectedEnvironmentAgentId, setSelectedEnvironmentAgentId] = createSignal("")
  const [serverSettingsBootstrapped, setServerSettingsBootstrapped] = createSignal(false)
  const [selectedEnvironmentApproval, setSelectedEnvironmentApproval] = createSignal<EnvironmentApprovalState | undefined>()
  const [toolchainBootstrapped, setToolchainBootstrapped] = createSignal(false)
  const [toolchainEditor, setToolchainEditor] = createSignal<ToolchainEditorState | undefined>()
  const [toolchainKindFilter, setToolchainKindFilter] = createSignal<ToolchainKindFilter>("all")
  const [toolchainStatusFilter, setToolchainStatusFilter] = createSignal<ToolchainStatusFilter>("all")
  const [toolchainSearch, setToolchainSearch] = createSignal("")
  const [selectedToolchainId, setSelectedToolchainId] = createSignal("")
  const [ingestRepoUrl, setIngestRepoUrl] = createSignal("")
  const [ingestDocsUrl, setIngestDocsUrl] = createSignal("")
  const [ingestDocsText, setIngestDocsText] = createSignal("")
  const [ingestKindHint, setIngestKindHint] = createSignal<ToolchainKindFilter>("all")
  const [ingestNameHint, setIngestNameHint] = createSignal("")
  const [ingestPlacementHint, setIngestPlacementHint] = createSignal("")
  const [toolchainRunSerial, setToolchainRunSerial] = createSignal(true)
  const [serverMaxRunningAgents, setServerMaxRunningAgents] = createSignal(4)
  const [serverMaxShellsPerAgent, setServerMaxShellsPerAgent] = createSignal(1)
  const [serverSettingsDirty, setServerSettingsDirty] = createSignal(false)
  const [autoApprovalOptions, setAutoApprovalOptions] = createSignal<Record<string, boolean>>(DEFAULT_AUTO_APPROVE_OPTIONS)
  const [allowedCommandInput, setAllowedCommandInput] = createSignal("")
  const [deniedCommandInput, setDeniedCommandInput] = createSignal("")
  const [allowedCommands, setAllowedCommands] = createSignal<string[]>([])
  const [deniedCommands, setDeniedCommands] = createSignal<string[]>([])
  const [autoApprovalPlatform, setAutoApprovalPlatform] = createSignal("browser")

  /* ── Agent 配置编辑器状态 ── */
  const [agentConfigBootstrapped, setAgentConfigBootstrapped] = createSignal(false)
  const [agentConfigDirty, setAgentConfigDirty] = createSignal(false)
  const [selectedProfileId, setSelectedProfileId] = createSignal("")
  const [selectedAgentId, setSelectedAgentId] = createSignal("")
  const [profileDrafts, setProfileDrafts] = createSignal<Record<string, RuntimeProfileDraft>>({})
  const [agentDrafts, setAgentDrafts] = createSignal<Record<string, AgentDefinitionDraft>>({})
  const [agentConfigSavePending, setAgentConfigSavePending] = createSignal(false)
  const [agentConfigSaved, setAgentConfigSaved] = createSignal(false)
  const [agentConfigError, setAgentConfigError] = createSignal("")
  const [agentRun, setAgentRun] = createSignal<Record<string, unknown> | undefined>()
  const [agentRunEvents, setAgentRunEvents] = createSignal<Record<string, unknown>[]>([])
  const [agentRunError, setAgentRunError] = createSignal("")
  const [agentRunSubmitting, setAgentRunSubmitting] = createSignal(false)
  const [agentRunPolling, setAgentRunPolling] = createSignal(false)
  let profileExecutorSelect: HTMLSelectElement | undefined
  let agentNameInput: HTMLInputElement | undefined
  const setProfileExecutorSelect = (element: HTMLSelectElement) => {
    profileExecutorSelect = element
  }
  const setAgentNameInput = (element: HTMLInputElement) => {
    agentNameInput = element
  }
  const [agentRunPrompt, setAgentRunPrompt] = createSignal("请用一句话回复 Labrastro AgentRun smoke")

  const [profileId, setProfileId] = createSignal("")
  const [profileProvider, setProfileProvider] = createSignal("deepseek")
  const [profileModel, setProfileModel] = createSignal("")
  const [maxTokens, setMaxTokens] = createSignal(0)
  const [maxContextTokens, setMaxContextTokens] = createSignal(0)
  const [temperature, setTemperature] = createSignal(0)
  const [reasoningEffort, setReasoningEffort] = createSignal("")
  const [thinkingEnabled, setThinkingEnabled] = createSignal(true)

  const [modelCapabilityRecommendation, setModelCapabilityRecommendation] = createSignal<Record<string, unknown>>({})

  const [modelCapabilityDefaultMaxTokens, setModelCapabilityDefaultMaxTokens] = createSignal(0)

  const [modelCapabilityDefaultMaxContextTokens, setModelCapabilityDefaultMaxContextTokens] = createSignal(0)
  const [providerValidationError, setProviderValidationError] = createSignal("")

  const providers = createMemo(() => {
    const items = server.adminState().providers
    return Array.isArray(items) ? items as Record<string, unknown>[] : []
  })
  const profiles = createMemo(() => {
    const items = server.adminState().model_profiles
    return Array.isArray(items) ? items as Record<string, unknown>[] : []
  })
  const selectedProvider = createMemo(() =>
    providers().find((provider) => stringValue(provider.id) === providerId())
  )
  const filteredFetchedModels = createMemo(() => {
    const query = modelSearch().trim().toLowerCase()
    if (!query) return fetchedModels()
    return fetchedModels().filter((model) => model.id.toLowerCase().includes(query))
  })
  const actionFeedback = createMemo(() =>
    formatActionResult(server.actionResult(), actionIntent())
  )
  const providerErrorMessage = createMemo(() => {
    const localMessage = providerValidationError()
    if (localMessage) return localMessage

    const message = server.adminError()
    if (!message) return undefined
    if (message.includes("config_reload_failed")) {
      return `${message}。保存已回滚，host 配置未生效。`
    }
    return message
  })
  const connectionStatus = createMemo(() => stringValue(server.connectionState().status, "login-required"))
  const connectionMessage = createMemo(() => stringValue(server.connectionState().message))
  const connectionNotice = createMemo(() => resolveConnectionNotice({
    status: connectionStatus(),
    message: connectionMessage(),
    authenticated: server.connectionState().authenticated === true,
  }))
  const connectionSaveMessage = createMemo(() => {
    const result = server.connectionSaveResult()
    const key = connectionSaveResultKey(result)
    if (key && key === dismissedConnectionSaveResultKey()) return undefined
    return formatConnectionSaveResult(result)
  })
  const currentHostUrl = createMemo(() => stringValue(server.connectionState().hostUrl))
  const hostUrlSource = createMemo(() => stringValue(server.connectionState().hostUrlSource, "unknown"))
  const hostUrlConfigured = createMemo(() => server.connectionState().hostUrlConfigured === true)
  const adminUsable = createMemo(() => server.connectionState().authenticated === true && isAccountAdminRole(server.connectionState().role))
  const settingsTabDefsVisible = createMemo(() => settingsTabDefs.filter((tab) => tab.id !== "accounts" || adminUsable()))
  const connectionScopes = createMemo(() => stringArray(server.connectionState().scopes))
  const connectionSecurityWarnings = createMemo(() => stringArray(server.connectionState().securityWarnings))
  const canManageUsers = createMemo(() => connectionScopes().includes("users:manage"))
  const canReadAudit = createMemo(() => connectionScopes().includes("audit:read"))
  const canManageDevices = createMemo(() => connectionScopes().includes("devices:read") || connectionScopes().includes("devices:revoke"))
  const authUsers = createMemo(() => {
    const items = server.authUsersState()?.users
    return Array.isArray(items) ? items as Record<string, unknown>[] : []
  })
  const authDevices = createMemo(() => {
    const items = server.authDevicesState()?.devices
    return Array.isArray(items) ? items as Record<string, unknown>[] : []
  })
  const authAuditEvents = createMemo(() => {
    const items = server.authAuditState()?.events
    return Array.isArray(items) ? items as Record<string, unknown>[] : []
  })
  const hostUrlDraftDiffers = createMemo(() => {
    const draft = normalizeHostUrlInput(hostUrl())
    const effective = currentHostUrl()
    return Boolean(draft && effective && draft !== effective)
  })
  const isDefaultLocalHost = createMemo(() => {
    const host = currentHostUrl()
    return !hostUrlConfigured() && (host === "http://127.0.0.1:8765" || host === "http://localhost:8765")
  })
  const showCustomModelFallback = createMemo(() => fetchedModels().length === 0)
  const emptyModelListMessage = createMemo(() => {
    if (showCustomModelFallback()) {
      return modelFetchMessage() || "当前服务商无法自动提供模型列表，请使用“自定义模型名”。"
    }
    return "没有匹配的模型。"
  })
  const environmentManifest = createMemo(() => server.environmentManifest())
  const environmentSnapshot = createMemo(() => normalizeEnvironmentSnapshot(server.environmentSnapshot()))
  const environmentError = createMemo(() =>
    stringValue(server.environmentError()) || environmentSnapshot().error
  )
  const toolchainError = createMemo(() => stringValue(server.toolchainError()))
  const toolchainActionFeedback = createMemo(() => {
    const result = server.toolchainActionResult()
    if (!result?.ok) return undefined
    const kind = stringValue(result.kind)
    const name = stringValue(result.name)
    const label = kind === "cli" ? "CLI" : kind === "mcp" ? "MCP" : kind === "skill" ? "Skill" : "能力"
    if (result.created === true) return `${label} ${name} 已新增。`
    if (result.toolchain) return `${label} ${name} 已保存。`
    return `${label} ${name} 操作已完成。`
  })
  const toolchainGroups = createMemo(() => {
    const state = server.toolchainState() || {}
    return {
      cli: normalizeToolchainList(state.cli_tools, "cli"),
      mcp: normalizeToolchainList(state.mcp_servers, "mcp"),
      skill: normalizeToolchainList(state.skills, "skill"),
    }
  })
  const environmentCounts = createMemo(() => summarizeEnvironmentEntries(environmentSnapshot().entries))
  const environmentEntriesByKind = createMemo(() => ({
    cli: environmentSnapshot().entries.filter((entry) => entry.kind === "cli"),
    mcp: environmentSnapshot().entries.filter((entry) => entry.kind === "mcp"),
    skill: environmentSnapshot().entries.filter((entry) => entry.kind === "skill"),
  }))
  const toolchainDashboardItems = createMemo(() => {
    const state = server.toolchainState() || {}
    return normalizeToolchainDashboardItems(
      state.dashboard_items,
      toolchainGroups(),
      environmentSnapshot(),
    )
  })
  const filteredToolchainItems = createMemo(() => {
    const query = toolchainSearch().trim().toLowerCase()
    return toolchainDashboardItems().filter((item) => {
      if (toolchainKindFilter() !== "all" && item.kind !== toolchainKindFilter()) return false
      if (toolchainStatusFilter() !== "all" && toolchainStatusBucket(item.status) !== toolchainStatusFilter()) {
        return false
      }
      if (!query) return true
      return [
        item.name,
        item.alias,
        item.source,
        item.repo_url,
        item.command,
        ...item.docs.map((doc) => `${stringValue(doc.title)} ${stringValue(doc.url)}`),
      ].join(" ").toLowerCase().includes(query)
    })
  })
  const selectedToolchain = createMemo(() =>
    toolchainDashboardItems().find((item) => item.id === selectedToolchainId()) ||
    filteredToolchainItems()[0] ||
    toolchainDashboardItems()[0]
  )
  const toolchainSummary = createMemo(() => summarizeToolchainDashboard(toolchainDashboardItems()))
  const serverSettingsPayload = createMemo(() => {
    const direct = server.serverSettingsState()
    if (direct && Object.keys(direct).length) return direct
    const admin = server.adminState()
    return {
      settings: objectValue(admin.server_settings),
      runtime: objectValue(admin.agent_runs),
    }
  })
  const agentRunsSettings = createMemo<Record<string, unknown>>(() => {
    const settings = objectValue(serverSettingsPayload().settings)
    return {
      ...objectValue(settings.run_limits),
      runtime_profiles: objectValue(settings.runtime_profiles),
      agents: objectValue(objectValue(settings.agent_registry).agents),
    }
  })
  const capabilityPackageViews = createMemo<CapabilityPackageView[]>(() => {
    const settings = objectValue(serverSettingsPayload().settings)
    const packages = objectValue(settings.capability_packages)
    return Object.entries(packages)
      .map(([id, value]) => capabilityPackageValue(id, value))
      .sort((a, b) => a.id.localeCompare(b.id))
  })
  const capabilityPackageOptions = createMemo(() =>
    capabilityPackageViews().map((item) => item.id)
  )
  const agentRunsState = createMemo(() =>
    objectValue(serverSettingsPayload().runtime || server.adminState().agent_runs)

  )
  const modelCapabilitiesStatus = createMemo(() => {
    const direct = objectValue(server.modelCapabilitiesState()?.model_capabilities)
    if (Object.keys(direct).length) return direct
    const admin = objectValue(server.adminState().model_capabilities)
    if (Object.keys(admin).length) return admin
    const settings = objectValue(serverSettingsPayload().settings)
    const modelCapabilities = objectValue(settings.model_capabilities)
    return objectValue(modelCapabilities.status)
  })

  /* ── Agent 配置 computed ── */
  const executorFeatures = createMemo<Record<string, ExecutorFeatureView>>(() => {
    const agentRuns = objectValue(server.backendFeatures().agentRuns)
    const raw = objectValue(agentRuns.executorFeatures)
    const result: Record<string, ExecutorFeatureView> = {}
    for (const [executor, feature] of Object.entries(raw)) {
      result[executor] = executorFeatureValue(feature)
    }
    return result
  })

  const agentRunsProfiles = createMemo<Array<Record<string, unknown> & { id: string }>>(() => {
    const settings = agentRunsSettings()
    const profiles = objectValue(settings.runtime_profiles)
    return Object.entries(profiles).map(([id, value]) => ({
      id,
      ...(typeof value === "object" && value ? value as Record<string, unknown> : {}),
    }))
  })
  const agentRunsAgents = createMemo<Array<Record<string, unknown> & { id: string }>>(() => {
    const settings = agentRunsSettings()
    const agents = objectValue(settings.agents)
    return Object.entries(agents).map(([id, value]) => ({
      id,
      ...(typeof value === "object" && value ? value as Record<string, unknown> : {}),
    }))
  })
  const environmentAgentCandidates = createMemo<Array<Record<string, unknown> & { id: string }>>(() => {
    return agentRunsAgents().filter((agent) => agent.id === BUILT_IN_ENVIRONMENT_AGENT_ID)
  })
  const registeredMcpServers = createMemo(() => {
    const groups = toolchainGroups()
    return groups.mcp.map((item) => item.name)
  })
  const registeredToolOptions = createMemo<ChoiceOption[]>(() => {
    const groups = toolchainGroups()
    const seen = new Set<string>()
    const options: ChoiceOption[] = []
    const add = (id: unknown, kind: string, description?: unknown) => {
      const value = stringValue(id).trim()
      if (!value || seen.has(value)) return
      seen.add(value)
      options.push({
        id: value,
        label: value,
        kind,
        description: stringValue(description),
      })
    }
    for (const item of groups.cli) add(item.name, "CLI", item.command || stringValue((item as unknown as Record<string, unknown>).alias))
    for (const item of groups.mcp) add(item.name, "MCP", item.command || stringValue((item as unknown as Record<string, unknown>).alias))
    for (const item of groups.skill) add(item.name, "Skill", item.source || stringValue((item as unknown as Record<string, unknown>).alias))
    for (const item of capabilityPackageViews()) add(item.id, "能力包", item.description || item.name)
    return options.sort((a, b) => `${a.kind}:${a.id}`.localeCompare(`${b.kind}:${b.id}`))
  })
  const profileIdList = createMemo(() => Object.keys(profileDrafts()))
  const currentProfileDraft = createMemo(() => profileDrafts()[selectedProfileId()])
  const currentAgentDraft = createMemo(() => agentDrafts()[selectedAgentId()])
  const selectedAgentCapabilityPackages = createMemo(() => {
    const draft = currentAgentDraft()
    if (!draft) return []
    const byId = new Map(capabilityPackageViews().map((item) => [item.id, item]))
    return parseAgentConfigListText(draft.capabilityRefsText)
      .map((id) => byId.get(id))
      .filter((item): item is CapabilityPackageView => Boolean(item))
  })
  const selectedProfileExecutorFeature = createMemo(() => {
    const executor = currentProfileDraft()?.executor || ""
    return executor ? executorFeatures()[executor] : undefined
  })
  const savedProfileIdSet = createMemo(() => new Set(agentRunsProfiles().map((profile) => profile.id)))
  const savedAgentIdSet = createMemo(() => new Set(agentRunsAgents().map((agent) => agent.id)))
  const currentProfileIdLocked = createMemo(() => savedProfileIdSet().has(selectedProfileId()))
  const currentAgentIdLocked = createMemo(() => savedAgentIdSet().has(selectedAgentId()))
  const runtimeModelOptions = createMemo(() => {
    const seen = new Set<string>()
    const result: Array<{ value: string; label: string; detail: string }> = []
    const catalog = server.adminState().provider_model_catalog
    const items = Array.isArray(catalog) ? catalog as Record<string, unknown>[] : []
    for (const item of items) {
      const provider = stringValue(item.provider_id || item.provider)
      const model = stringValue(item.model_id || item.model || item.id)
      const value = modelOptionKey(provider, model)
      if (!provider || !model || seen.has(value)) continue
      seen.add(value)
      result.push({
        value,
        label: stringValue(item.label || item.display_name, model),
        detail: `${provider} / ${model}`,
      })
    }
    const current = currentAgentDraft()?.modelKey.trim()
    if (current && !seen.has(current)) {
      const [provider, model] = splitModelOptionKey(current)
      result.push({
        value: current,
        label: model || current,
        detail: provider ? `${provider} / ${model}` : t("agentConfig.profile.model.currentCustom"),
      })
    }
    return result
  })
  const profileMcpValidationWarnings = createMemo(() => {
    const draft = currentProfileDraft()
    if (!draft) return []
    const registered = registeredMcpServers()
    return draft.mcpServersText.split("\n").map((s) => s.trim()).filter(Boolean)
      .filter((name) => !registered.includes(name))
  })
  const selectedAgentRunId = createMemo(() => stringValue(agentRun()?.id))
  const agentRunLastSeq = createMemo(() =>
    agentRunEvents().reduce((max, event) => Math.max(max, numberValue(event.seq, 0)), 0)
  )
  const agentRunTerminal = createMemo(() =>
    agentRunEvents().some((event) => ["completed", "failed", "cancelled", "canceled"].includes(stringValue(event.type)))
  )
  const agentRunCanResume = createMemo(() => {
    const task = agentRun()
    const executor = stringValue(task?.executor)
    const sessionId = stringValue(task?.executor_session_id)
    return Boolean(executor && sessionId && executorFeatures()[executor]?.resumeById)
  })
  const toolchainIngestState = createMemo(() => server.toolchainIngestState())
  const toolchainIngestLogs = createMemo(() => {
    const logs = toolchainIngestState().logs
    return Array.isArray(logs)
      ? logs.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
      : []
  })
  const toolchainIngestDuplicates = createMemo(() =>
    toolchainDuplicateInputMatches(
      toolchainDashboardItems(),
      ingestRepoUrl(),
      ingestDocsUrl(),
    )
  )
  const hasToolchainIngestDuplicates = createMemo(() =>
    toolchainIngestDuplicates().repo.length > 0 || toolchainIngestDuplicates().docs.length > 0
  )

  createEffect(() => {
    const selected = selectedToolchainId()
    const items = toolchainDashboardItems()
    if (!items.length) {
      if (selected) setSelectedToolchainId("")
      return
    }
    if (!items.some((item) => item.id === selected)) {
      setSelectedToolchainId(items[0].id)
    }
  })

  createEffect(() => {
    const candidates = environmentAgentCandidates()
    const selected = selectedEnvironmentAgentId()
    if (!candidates.length) {
      if (selected) setSelectedEnvironmentAgentId("")
      return
    }
    if (!selected || !candidates.some((agent) => agent.id === selected)) {
      setSelectedEnvironmentAgentId(candidates[0].id)
    }
  })

  const openModelDetail = (modelId: string, mode: ModelDetailMode) => {
    const existing = profiles().find((profile) => profileMatches(profile, providerId(), modelId))
    setProviderValidationError("")
    setModelDetailMode(mode)
    setProviderModel(modelId)
    if (existing) {
      setProfileId(stringValue(existing.id))
      setProfileProvider(stringValue(existing.provider))
      setProfileModel(stringValue(existing.model))
      setMaxTokens(numberValue(existing.max_tokens, 0))
      setMaxContextTokens(numberValue(existing.max_context_tokens, 0))
      setTemperature(numberValue(existing.temperature, 0))
      setReasoningEffort(stringValue(existing.reasoning_effort))
      setThinkingEnabled(existing.thinking_enabled !== false)
      const recommendation = objectValue(existing.capability_recommendation)
      setModelCapabilityRecommendation(Object.keys(recommendation).length ? recommendation : {})
      setModelCapabilityDefaultMaxTokens(0)
      setModelCapabilityDefaultMaxContextTokens(0)
    } else {
      const fetched = fetchedModels().find((model) => model.id === modelId)
      const defaults = {
        ...knownModelCapabilityDefaults(providerId(), modelId),
        ...(fetched ? {
          max_tokens: numberValue(fetched.max_tokens, 0) || undefined,
          max_context_tokens: numberValue(fetched.max_context_tokens, 0) || undefined,
          capability_source: fetched.capability_source,
        } : {}),
      }
      setProfileId(makeProfileId(providerId(), modelId))
      setProfileProvider(providerId())
      setProfileModel(modelId)
      setMaxTokens(numberValue(defaults.max_tokens, 0))
      setMaxContextTokens(numberValue(defaults.max_context_tokens, 0))
      setModelCapabilityDefaultMaxTokens(numberValue(defaults.max_tokens, 0))
      setModelCapabilityDefaultMaxContextTokens(numberValue(defaults.max_context_tokens, 0))
      setTemperature(0)
      setReasoningEffort("")
      setThinkingEnabled(true)
      setModelCapabilityRecommendation({})
    }
    setModelDetailOpen(true)
    setCustomModelDialogOpen(false)
  }

  const openCustomModelDialog = () => {
    setCustomModelDraft(profileModel() || providerModel() || "")
    setCustomModelDialogOpen(true)
  }

  const closeCustomModelDialog = () => setCustomModelDialogOpen(false)

  const confirmCustomModelDialog = () => {
    const modelId = customModelDraft().trim()
    if (!modelId) return
    openModelDetail(modelId, "custom")
  }

  const closeModelDetail = () => setModelDetailOpen(false)

    /* ── Agent 配置 tab 切换初始化 ── */
  createEffect(() => {
    if (activeTab() === "agentConfig" && !agentConfigBootstrapped()) {
      setAgentConfigBootstrapped(true)
      refreshServerSettings()
    }
  })
  createEffect(() => {
    const profiles = agentRunsProfiles()
    const agents = agentRunsAgents()
    if (!agentConfigDirty()) {
      const pDrafts: Record<string, RuntimeProfileDraft> = {}
      for (const p of profiles) pDrafts[p.id] = profileToDraft(p.id, p)
      setProfileDrafts(pDrafts)
      const aDrafts: Record<string, AgentDefinitionDraft> = {}
      for (const a of agents) aDrafts[a.id] = agentToDraft(a.id, a)
      setAgentDrafts(aDrafts)
    }
  })

  let agentRunPollTimer: ReturnType<typeof setInterval> | undefined

  const stopAgentRunPolling = () => {
    if (agentRunPollTimer) {
      clearInterval(agentRunPollTimer)
      agentRunPollTimer = undefined
    }
    setAgentRunPolling(false)
  }

  const requestAgentRunEvents = (taskId: string, afterSeq = agentRunLastSeq()) => {
    if (!taskId) return
    vscode.postMessage({
      type: "agentRun.events",
      payload: {
        agent_run_id: taskId,
        after_seq: afterSeq,
      },
    })
  }

  const startAgentRunPolling = (taskId: string) => {
    stopAgentRunPolling()
    if (!taskId) return
    setAgentRunPolling(true)
    requestAgentRunEvents(taskId, 0)
    agentRunPollTimer = setInterval(() => requestAgentRunEvents(taskId), 1500)
  }

  onCleanup(stopAgentRunPolling)

  onMount(() => {
    const unsubscribe = vscode.onMessage((msg) => {
      if (msg.type === "serverSettings.state" && agentConfigSavePending()) {
        setAgentConfigSavePending(false)
        setAgentConfigDirty(false)
        setAgentConfigSaved(true)
        setAgentConfigError("")
      }
      if (msg.type === "serverSettings.error" && agentConfigSavePending()) {
        setAgentConfigSavePending(false)
        setAgentConfigSaved(false)
        setAgentConfigError(typeof msg.message === "string" ? msg.message : "Server settings request failed")
      }
      if (msg.type === "agentRun.submitted" && typeof msg.payload === "object" && msg.payload) {
        const payload = objectValue(msg.payload)
        const task = objectValue(payload.agent_run || payload.task)
        setAgentRun(task)
        setAgentRunEvents([])
        setAgentRunError("")
        setAgentRunSubmitting(false)
        startAgentRunPolling(stringValue(task.id))
      }
      if (msg.type === "agentRun.events" && typeof msg.payload === "object" && msg.payload) {
        const events = Array.isArray(objectValue(msg.payload).events)
          ? objectValue(msg.payload).events as Record<string, unknown>[]
          : []
        if (events.length) {
          setAgentRunEvents((current) => {
            const next = [...current]
            const seen = new Set(next.map((event) => numberValue(event.seq, 0)))
            for (const event of events) {
              const seq = numberValue(event.seq, 0)
              if (!seen.has(seq)) next.push(event)
            }
            return next.sort((a, b) => numberValue(a.seq, 0) - numberValue(b.seq, 0))
          })
        }
      }
      if (msg.type === "agentRun.cancelled" && typeof msg.payload === "object" && msg.payload) {
        setAgentRunError("")
        requestAgentRunEvents(selectedAgentRunId())
      }
      if (msg.type === "agentRun.error") {
        setAgentRunSubmitting(false)
        stopAgentRunPolling()
        setAgentRunError(typeof msg.message === "string" ? msg.message : "Runtime request failed")
      }
    })
    onCleanup(unsubscribe)
  })

  createEffect(() => {
    if (agentRunTerminal()) stopAgentRunPolling()
  })

const switchTab = (tab: SettingsTab) => {
    if (tab === "accounts" && !adminUsable()) return
    setActiveTab(tab)
    settingsMessages.settingsTabChanged(vscode, tab)
  }

    /* ── Agent 配置 CRUD ── */
  const markAgentConfigDirty = () => {
    setAgentConfigDirty(true)
    setAgentConfigSaved(false)
    setAgentConfigError("")
  }

  const focusAfterRender = (focus: () => void) => {
    setTimeout(focus, 0)
  }

  const agentConfigIdErrorMessage = (code: "empty" | "invalid" | "duplicate", id: string) => {
    if (code === "empty") return t("agentConfig.id.empty")
    if (code === "invalid") return t("agentConfig.id.invalid")
    return t("agentConfig.id.duplicate", { id })
  }

  const validateAgentConfigDrafts = () => {
    const profiles = profileDrafts()
    const agents = agentDrafts()
    for (const [id, profile] of Object.entries(profiles)) {
      const validation = validateAgentConfigId(profile.id || id, Object.keys(profiles), id)
      if (!validation.ok) throw new Error(agentConfigIdErrorMessage(validation.code, validation.id || id))
    }
    for (const [id, agent] of Object.entries(agents)) {
      const validation = validateAgentConfigId(agent.id || id, Object.keys(agents), id)
      if (!validation.ok) throw new Error(agentConfigIdErrorMessage(validation.code, validation.id || id))
    }
    for (const [id, agent] of Object.entries(agents)) {
      if (agent.runtime_profile && !profiles[agent.runtime_profile]) {
        throw new Error(`Agent ${id} 引用的 Runtime Profile 不存在：${agent.runtime_profile}`)
      }
    }
  }

  const saveAgentConfig = () => {
    let profiles: Record<string, unknown>
    let agents: Record<string, unknown>
    try {
      validateAgentConfigDrafts()
      profiles = {}
      for (const [id, draft] of Object.entries(profileDrafts())) {
        profiles[id] = profileDraftToPayload(draft)
      }
      agents = {}
      for (const [id, draft] of Object.entries(agentDrafts())) {
        agents[id] = agentDraftToPayload(draft)
      }
    } catch (error) {
      setAgentConfigError(error instanceof Error ? error.message : String(error))
      setAgentConfigSaved(false)
      return
    }
    const maxAgents = Math.max(1, Math.floor(serverMaxRunningAgents()))
    const maxShells = Math.max(1, Math.floor(serverMaxShellsPerAgent()))
    setAgentConfigSavePending(true)
    setAgentConfigSaved(false)
    setAgentConfigError("")
    vscode.postMessage({
      type: "serverSettings.update",
      payload: {
        run_limits: {
          max_running_agents: maxAgents,
          max_shells_per_agent: maxShells,
        },
        runtime_profiles: profiles,
        agent_registry: { agents },
      },
    })
  }
  const addProfile = () => {
    const id = makeUniqueAgentConfigId("runtime_profile", [
      ...Object.keys(profileDrafts()),
      ...savedProfileIdSet(),
    ])
    setProfileDrafts((prev) => ({ ...prev, [id]: emptyProfileDraft(id) }))
    setSelectedProfileId(id)
    markAgentConfigDirty()
    focusAfterRender(() => profileExecutorSelect?.focus())
  }
  const renameProfile = (rawId: string, input: HTMLInputElement) => {
    const oldId = selectedProfileId()
    if (!oldId || currentProfileIdLocked()) {
      input.value = oldId
      return
    }
    const validation = validateAgentConfigId(rawId, [
      ...Object.keys(profileDrafts()),
      ...savedProfileIdSet(),
    ], oldId)
    if (!validation.ok) {
      setAgentConfigSaved(false)
      setAgentConfigError(agentConfigIdErrorMessage(validation.code, validation.id || oldId))
      input.value = oldId
      return
    }
    const newId = validation.id
    if (newId === oldId) {
      input.value = oldId
      return
    }
    setProfileDrafts((prev) => renameRecordKey(prev, oldId, newId))
    setAgentDrafts((prev) => replaceRuntimeProfileReferences(prev, oldId, newId))
    setSelectedProfileId(newId)
    markAgentConfigDirty()
  }
  const deleteProfile = (id: string) => {
    const referencedBy = Object.entries(agentDrafts())
      .filter(([, agent]) => agent.runtime_profile === id)
      .map(([agentId]) => agentId)
    if (referencedBy.length) {
      setAgentConfigError(`Profile ${id} 正被 Agent 引用：${referencedBy.join(", ")}。请先迁移或清空引用。`)
      return
    }
    setProfileDrafts((prev) => {
      const next = { ...prev }
      delete next[id]
      return next
    })
    if (selectedProfileId() === id) setSelectedProfileId("")
    markAgentConfigDirty()
  }
  const updateProfileField = <K extends keyof RuntimeProfileDraft>(field: K, value: RuntimeProfileDraft[K]) => {
    const id = selectedProfileId()
    if (!id) return
    setProfileDrafts((prev) => ({
      ...prev,
      [id]: { ...prev[id], [field]: value },
    }))
    markAgentConfigDirty()
  }
  const addAgent = () => {
    const id = makeUniqueAgentConfigId("agent", [
      ...Object.keys(agentDrafts()),
      ...savedAgentIdSet(),
    ])
    const draft = emptyAgentDraft(id)
    draft.runtime_profile = resolveNewAgentRunProfile(selectedProfileId(), profileIdList())
    setAgentDrafts((prev) => ({ ...prev, [id]: draft }))
    setSelectedAgentId(id)
    markAgentConfigDirty()
    focusAfterRender(() => agentNameInput?.focus())
  }
  const renameAgent = (rawId: string, input: HTMLInputElement) => {
    const oldId = selectedAgentId()
    if (!oldId || currentAgentIdLocked()) {
      input.value = oldId
      return
    }
    const validation = validateAgentConfigId(rawId, [
      ...Object.keys(agentDrafts()),
      ...savedAgentIdSet(),
    ], oldId)
    if (!validation.ok) {
      setAgentConfigSaved(false)
      setAgentConfigError(agentConfigIdErrorMessage(validation.code, validation.id || oldId))
      input.value = oldId
      return
    }
    const newId = validation.id
    if (newId === oldId) {
      input.value = oldId
      return
    }
    setAgentDrafts((prev) => renameRecordKey(prev, oldId, newId))
    setSelectedAgentId(newId)
    markAgentConfigDirty()
  }
  const deleteAgent = (id: string) => {
    setAgentDrafts((prev) => {
      const next = { ...prev }
      delete next[id]
      return next
    })
    if (selectedAgentId() === id) setSelectedAgentId("")
    markAgentConfigDirty()
  }
  const updateAgentField = <K extends keyof AgentDefinitionDraft>(field: K, value: AgentDefinitionDraft[K]) => {
    const id = selectedAgentId()
    if (!id) return
    setAgentDrafts((prev) => ({
      ...prev,
      [id]: { ...prev[id], [field]: value },
    }))
    markAgentConfigDirty()
  }

  const renderStringChoiceList = (
    values: string[],
    selectedText: string,
    onChange: (next: string) => void,
    emptyMessage: string,
    delimiter = "\n",
  ) => {
    const selected = parseAgentConfigListText(selectedText)
    const known = values.filter(Boolean)
    const choices = [
      ...known,
      ...selected.filter((value) => !known.includes(value)),
    ]
    return (
      <Show when={choices.length > 0} fallback={<p class="settings-empty-note">{emptyMessage}</p>}>
        <div class="agent-config-choice-list">
          <For each={choices}>
            {(value) => {
              const checked = selected.includes(value)
              const unknown = !known.includes(value)
              return (
                <label class={`agent-config-choice ${unknown ? "agent-config-choice--unknown" : ""}`}>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) => onChange(toggleAgentConfigListValue(selectedText, value, e.currentTarget.checked, delimiter))}
                  />
                  <span>{value}</span>
                  <Show when={unknown}>
                    <small>{t("agentConfig.choice.unregistered")}</small>
                  </Show>
                </label>
              )
            }}
          </For>
        </div>
      </Show>
    )
  }

  const renderRuntimeChoiceList = (
    options: RuntimeOption[],
    selectedText: string,
    onChange: (next: string) => void,
    delimiter = ", ",
  ) => {
    const selected = parseAgentConfigListText(selectedText)
    const knownValues = optionValues(options)
    const choices: RuntimeOption[] = [
      ...options,
      ...selected
        .filter((value) => !knownValues.includes(value))
        .map((value) => ({ value, labelKey: value, descKey: "" })),
    ]
    return (
      <div class="agent-config-choice-list agent-config-choice-list--cards">
        <For each={choices}>
          {(option) => {
            const checked = selected.includes(option.value)
            const known = knownValues.includes(option.value)
            return (
              <label class={`agent-config-choice ${known ? "" : "agent-config-choice--unknown"}`}>
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(e) => onChange(toggleAgentConfigListValue(selectedText, option.value, e.currentTarget.checked, delimiter))}
                />
                <span>{known ? t(option.labelKey) : option.value}</span>
                <small>{known ? t(option.descKey) : t("agentConfig.choice.custom")}</small>
              </label>
            )
          }}
        </For>
      </div>
    )
  }

  const submitAgentRunTest = () => {
    const agentId = selectedAgentId()
    if (!agentId) {
      setAgentRunError("请先选择一个 Agent。")
      return
    }
    const prompt = agentRunPrompt().trim()
    if (!prompt) {
      setAgentRunError("请输入测试任务。")
      return
    }
    setAgentRunSubmitting(true)
    setAgentRunError("")
    setAgentRun(undefined)
    setAgentRunEvents([])
    stopAgentRunPolling()
    vscode.postMessage({
      type: "agentRun.submit",
      payload: {
        agent_id: agentId,
        source: "manual",
        issue_id: `manual-smoke-${Date.now()}`,
        prompt,
        metadata: {
          agent_run_source: "manual",
          workspace_root: server.workspaceDirectory() || "",
        },
      },
    })
  }

  const cancelAgentRunTest = () => {
    const taskId = selectedAgentRunId()
    if (!taskId) return
    vscode.postMessage({
      type: "agentRun.cancel",
      payload: {
        agent_run_id: taskId,
        reason: "user_cancelled",
      },
    })
  }

  const retryAgentRunTest = (resumeSession = false) => {
    const taskId = selectedAgentRunId()
    if (!taskId) return
    setAgentRunSubmitting(true)
    setAgentRunEvents([])
    stopAgentRunPolling()
    vscode.postMessage({
      type: "agentRun.retry",
      payload: {
        agent_run_id: taskId,
        new_agent_run_id: `${taskId}-retry-${Date.now()}`,
        resume_session: resumeSession === true,
      },
    })
  }

const refreshAdmin = () => {
    setRefreshLoading(true)
    settingsMessages.refreshAdmin(vscode)
    setTimeout(() => setRefreshLoading(false), 1200)
  }

  /* ── 主执行器相关 ── */
  const executorLocation = createMemo(() => {
    const loc = server.executorType().location
    return (loc === "local" || loc === "remote") ? loc as ExecutorLocation : "remote"
  })
  const executorEngine = createMemo(() => {
    const eng = server.executorType().engine
    const valid: ExecutorEngine[] = ["labrastro", "claude", "codex", "gemini", "astrbot"]
    return valid.includes(eng as ExecutorEngine) ? eng as ExecutorEngine : "labrastro"
  })
  const executorEngineOption = createMemo(() =>
    EXECUTOR_ENGINES.find((e) => e.id === executorEngine()) || EXECUTOR_ENGINES[0]
  )

  const openExecutorPicker = () => {
    setPickerLocation(executorLocation())
    setPickerEngine(executorEngine())
    setExecutorPickerOpen(true)
  }
  const closeExecutorPicker = () => setExecutorPickerOpen(false)
  const confirmExecutorPicker = () => {
    const selectedEngine = EXECUTOR_ENGINES.find((e) => e.id === pickerEngine())
    if (selectedEngine && !selectedEngine.ready) return
    setExecutorPickerOpen(false)
    vscode.postMessage({
      type: "executorType.save",
      location: pickerLocation(),
      engine: pickerEngine(),
    })
  }

  const refreshEnvironmentManifest = () => settingsMessages.refreshEnvironmentManifest(vscode)
  const environmentRunItems = (entryIds?: string[]) => {
    const selected = entryIds?.length
      ? toolchainDashboardItems().filter((item) => entryIds.includes(item.id))
      : toolchainDashboardItems()
    return selected.map((item) => ({
      id: item.id,
      name: item.name,
      kind: item.kind,
    }))
  }
  const runEnvironment = (mode: "check" | "configure", entryIds?: string[]) => {
    const items = environmentRunItems(entryIds)
    if (!items.length) return
    const agentId = environmentAgentCandidates()[0]?.id || BUILT_IN_ENVIRONMENT_AGENT_ID
    if (!agentId) {
      return
    }
    settingsMessages.runEnvironment(vscode, mode, items.map((item) => item.id), agentId)
  }
  const stopEnvironmentRun = () => settingsMessages.cancelEnvironment(vscode)

  const refreshServerSettings = () => {
    setServerSettingsBootstrapped(true)
    settingsMessages.readServerSettings(vscode)
  }
  const refreshModelCapabilities = () => settingsMessages.modelCapabilitiesRefresh(vscode)
  const applyModelCapabilityRecommendation = (targetProfileId = profileId()) => {
    const id = targetProfileId.trim()
    if (!id) return
    settingsMessages.modelCapabilitiesApply(vscode, id)
  }
  const saveServerSettings = () => {
    const maxAgents = Math.max(1, Math.floor(serverMaxRunningAgents()))
    const maxShells = Math.max(1, Math.floor(serverMaxShellsPerAgent()))
    setServerMaxRunningAgents(maxAgents)
    setServerMaxShellsPerAgent(maxShells)
    setServerSettingsDirty(false)
    settingsMessages.updateServerSettings(
      vscode,
      serverAgentRunSettingsPayload(maxAgents, maxShells)
    )
  }
  const runToolchainIngest = () => {
    settingsMessages.runToolchainIngest(vscode, {
      repoUrl: ingestRepoUrl().trim(),
      docsUrl: ingestDocsUrl().trim(),
      docsText: ingestDocsText().trim(),
      kindHint: ingestKindHint() === "all" ? "" : ingestKindHint(),
      nameHint: ingestNameHint().trim(),
      placementHint: ingestPlacementHint().trim(),
    })
  }
  const cancelToolchainIngest = () => settingsMessages.cancelToolchainIngest(vscode)
  const updateAutoApproval = (patch: {
    options?: Record<string, boolean>
    allowedCommands?: string[]
    deniedCommands?: string[]
  }) => {
    settingsMessages.updateAutoApproval(vscode, patch)
  }
  const addCommandRule = (kind: "allow" | "deny") => {
    const value = (kind === "allow" ? allowedCommandInput() : deniedCommandInput()).trim()
    if (!value) return
    if (kind === "allow") {
      const next = uniqueCommandRules([...allowedCommands(), value])
      setAllowedCommands(next)
      setAllowedCommandInput("")
      updateAutoApproval({ allowedCommands: next })
      return
    }
    const next = uniqueCommandRules([...deniedCommands(), value])
    setDeniedCommands(next)
    setDeniedCommandInput("")
    updateAutoApproval({ deniedCommands: next })
  }
  const removeCommandRule = (kind: "allow" | "deny", rule: string) => {
    if (kind === "allow") {
      const next = allowedCommands().filter((item) => item !== rule)
      setAllowedCommands(next)
      updateAutoApproval({ allowedCommands: next })
      return
    }
    const next = deniedCommands().filter((item) => item !== rule)
    setDeniedCommands(next)
    updateAutoApproval({ deniedCommands: next })
  }
  const replyEnvironmentApproval = (
    approval: EnvironmentApprovalState,
    decision: ApprovalDecision,
  ) => {
    if (selectedEnvironmentApproval()?.approvalId === approval.approvalId) {
      setSelectedEnvironmentApproval(undefined)
    }
    vscode.postMessage({
      type: "approval.reply",
      chatId: environmentSnapshot().chatId,
      approvalId: approval.approvalId,
      decision,
    })
  }

  const rememberEnvironmentApprovalDecision = (
    approval: EnvironmentApprovalState,
    decision: ApprovalDecision,
    rules: string[],
  ) => {
    const nextRules = updateCommandRuleLists(
      decision === "allow_once" ? "allow" : "deny",
      rules,
      allowedCommands(),
      deniedCommands(),
    )
    const nextOptions = { ...autoApprovalOptions(), execute: true }
    setAutoApprovalOptions(nextOptions)
    setAllowedCommands(nextRules.allowedCommands)
    setDeniedCommands(nextRules.deniedCommands)
    updateAutoApproval({
      options: nextOptions,
      allowedCommands: nextRules.allowedCommands,
      deniedCommands: nextRules.deniedCommands,
    })
    replyEnvironmentApproval(approval, decision)
  }

  const requestProviderModels = (message = "正在获取模型列表...") => {
    const id = providerId()
    if (!id || !selectedProvider() || !adminUsable()) return
    setFetchedModels([])
    setModelFetchMessage(message)
    setProviderValidationError("")
    setActionIntent("")
    vscode.postMessage({
      type: "provider.models",
      payload: { provider_id: id },
    })
  }

  const saveConnection = () => {
    const validation = validateHostUrlInput(hostUrl())
    if (!validation.ok) {
      setHostUrlError(validation.error)
      setHostUrlDirty(true)
      setPendingHostSave(undefined)
      return
    }
    setSaveLoading(true)
    setSaveSuccess(false)
    const requestedHostUrl = validation.value
    setHostUrl(requestedHostUrl)
    setPendingHostSave(requestedHostUrl)
    setHostUrlError(undefined)
    setDismissedConnectionSaveResultKey(undefined)
    vscode.postMessage({
      type: "connection.login",
      hostUrl: requestedHostUrl,
      username: loginUsername(),
      password: loginPassword(),
    })
    setLoginPassword("")
  }

  const logoutConnection = () => {
    vscode.postMessage({ type: "connection.logout" })
  }

  const refreshAuthDevices = () => settingsMessages.listAuthDevices(vscode)
  const refreshAuthUsers = () => {
    if (canManageUsers()) settingsMessages.listAuthUsers(vscode)
  }
  const refreshAuthAudit = () => {
    if (!canReadAudit()) return
    settingsMessages.listAuthAudit(vscode, {
      limit: 100,
      event_type: auditEventType().trim() || undefined,
    })
  }
  const refreshAccounts = () => {
    if (!adminUsable()) return
    if (canManageDevices()) refreshAuthDevices()
    refreshAuthUsers()
    refreshAuthAudit()
  }
  const changePassword = () => {
    settingsMessages.changeAuthPassword(vscode, currentPassword(), newPassword())
    setCurrentPassword("")
    setNewPassword("")
  }
  const createAuthUser = () => {
    settingsMessages.createAuthUser(vscode, {
      username: newUserUsername().trim(),
      password: newUserPassword(),
      role: newUserRole(),
      scopes: [],
      enabled: true,
    })
    setNewUserPassword("")
  }
  const updateAuthUserScopes = (userId: string, scopes: string[]) =>
    settingsMessages.updateAuthUser(vscode, { user_id: userId, scopes })
  const disableAuthUser = (userId: string) => settingsMessages.disableAuthUser(vscode, userId)
  const resetAuthUserPassword = () => {
    if (!resetPasswordUserId() || !resetPasswordValue()) return
    settingsMessages.resetAuthUserPassword(vscode, resetPasswordUserId(), resetPasswordValue())
    setResetPasswordValue("")
  }
  const revokeAuthDevice = (deviceId: string) => settingsMessages.revokeAuthDevice(vscode, deviceId)

  const resetProviderForm = () => {
    setProviderId("")
    setProviderType("openai_chat")
    setProviderCompat("generic")
    setProviderBaseUrl("")
    setProviderApiKey("")
    setProviderModel("")
    setProviderEnabled(true)
    setProviderCopyId("")
    setFetchedModels([])
    setModelSearch("")
    setModelFetchMessage("")
    setLastModelFetchProvider("")
    setModelDetailOpen(false)
    setCustomModelDialogOpen(false)
  }

  const selectProvider = (provider: Record<string, unknown>) => {
    const id = stringValue(provider.id)
    const firstProfile = profiles().find((profile) => stringValue(profile.provider) === id)
    setProviderId(id)
    setProviderBaseUrl(stringValue(provider.base_url))
    setProviderType(asProviderType(provider.type))
    setProviderCompat(asProviderCompat(provider.compat))
    setProviderApiKey("")
    setProviderEnabled(provider.enabled !== false)
    setProviderCopyId(`${id}-copy`)
    setProviderModel(stringValue(firstProfile?.model))
    setFetchedModels([])
    setModelSearch("")
    setModelFetchMessage("")
    setLastModelFetchProvider("")
    setModelDetailOpen(false)
    setCustomModelDialogOpen(false)
  }

  const saveProvider = () => {
    setActionIntent("")
    vscode.postMessage({
      type: "provider.record",
      payload: {
        provider_id: providerId(),
        type: providerType(),
        compat: providerCompat(),
        base_url: providerBaseUrl(),
        api_key: providerApiKey() || undefined,
        enabled: providerEnabled(),
      },
    })
  }

  const testProvider = (model = providerModel()) => {
    const modelId = model.trim()

    if (!modelId) return
    setProviderModel(modelId)
    setActionIntent("")
    vscode.postMessage({
      type: "provider.test",
      payload: {
        provider_id: providerId(),
        model: modelId,
        prompt: "ping",
      },
    })
  }

  const copyProvider = () => {
    setActionIntent("")
    vscode.postMessage({
      type: "provider.copy",
      payload: {
        provider_id: providerId(),
        target_id: providerCopyId() || undefined,
      },
    })
  }

  const deleteProvider = () => {
    const id = providerId()
    if (!id) return
    if (!window.confirm(`删除服务商 "${id}"？已有保存预设引用时后端会阻止删除。`)) {
      return
    }
    setActionIntent("")
    vscode.postMessage({
      type: "provider.delete",
      payload: { provider_id: id },
    })
  }

  const toggleProviderEnabled = (enabled: boolean) => {
    setProviderEnabled(enabled)
    setActionIntent("")
    vscode.postMessage({
      type: "provider.enable",
      payload: { provider_id: providerId(), enabled },
    })
  }

  const saveModelPreset = () => {
    const provider = profileProvider() || providerId()
    const model = profileModel().trim()
    if (!provider || !model) return
    if (maxTokens() < 1 || maxContextTokens() < 1) {
      setProviderValidationError("请先同步模型能力表，或手动填写最大输出 tokens 和最大上下文 tokens。")
      return
    }
    setProviderValidationError("")
    const nextProfileId = profileId().trim() || makeProfileId(provider, model)
    const existing = profiles().find((profile) => profileMatches(profile, provider, model))
    const defaultMaxTokens = modelCapabilityDefaultMaxTokens()
    const defaultMaxContextTokens = modelCapabilityDefaultMaxContextTokens()
    const usesCapabilityDefaults = !existing
      && defaultMaxTokens > 0
      && defaultMaxContextTokens > 0
      && maxTokens() === defaultMaxTokens
      && maxContextTokens() === defaultMaxContextTokens
    setProfileId(nextProfileId)
    setProfileProvider(provider)
    setProfileModel(model)
    setActionIntent("savePreset")
    vscode.postMessage({
      type: "modelProfile.save",
      payload: {
        profile_id: nextProfileId,
        provider,
        model,
        max_tokens: maxTokens(),
        max_context_tokens: maxContextTokens(),
        temperature: temperature(),
        reasoning_effort: reasoningEffort() || undefined,
        thinking_enabled: thinkingEnabled(),
        capability_user_configured: !usesCapabilityDefaults,
      },
    })
  }

  createEffect(() => {
    const tab = normalizeSettingsTab(props.targetTab)
    if (tab) {
      setActiveTab(tab)
    }
  })

  createEffect(() => {
    if (activeTab() === "accounts" && !adminUsable() && connectionStatus() !== "checking") {
      setActiveTab("executors")
      settingsMessages.settingsTabChanged(vscode, "executors")
    }
  })

  createEffect(() => {
    if (activeTab() !== "toolchains") return
    if (!toolchainBootstrapped()) {
      setToolchainBootstrapped(true)
      settingsMessages.refreshToolchains(vscode)
    }
    if (!environmentBootstrapped()) {
      setEnvironmentBootstrapped(true)
      refreshEnvironmentManifest()
    }
  })

  createEffect(() => {
    if (activeTab() !== "serverSettings") return
    if (!serverSettingsBootstrapped()) {
      setServerSettingsBootstrapped(true)
      settingsMessages.readServerSettings(vscode)
    }
  })

  createEffect(() => {
    if (activeTab() !== "accounts") return
    if (!adminUsable()) return
    if (accountsBootstrapped()) return
    setAccountsBootstrapped(true)
    refreshAccounts()
  })

  createEffect(() => {
    if (!adminUsable()) {
      setAccountsBootstrapped(false)
    }
  })

  createEffect(() => {
    if (serverSettingsDirty()) return
    const settings = agentRunsSettings()
    const maxAgents = numberValue(settings.max_running_agents, 4)
    const maxShells = numberValue(settings.max_shells_per_agent, 1)
    setServerMaxRunningAgents(Math.max(1, Math.floor(maxAgents)))
    setServerMaxShellsPerAgent(Math.max(1, Math.floor(maxShells)))
  })

  createEffect(() => {
    const current = currentHostUrl()
    const lock = hostUrlSyncLock()
    if (lock && current === lock) {
      setHostUrlSyncLock(undefined)
    }
    if (shouldSyncHostDraft({
      currentHostUrl: current,
      dirty: hostUrlDirty(),
      pendingHostSave: pendingHostSave(),
      localError: hostUrlError(),
      syncLock: lock,
    })) {
      setHostUrl(current)
    }
  })

  createEffect(() => {
    const result = server.connectionSaveResult()
    const pending = pendingHostSave()
    if (!result || !pending || stringValue(result.hostUrlSaveRequested) !== pending) return
    const resolved = resolveHostSaveResult(result, untrack(hostUrl))
    setHostUrl(resolved.hostUrl)
    setHostUrlDirty(resolved.dirty)
    setHostUrlError(resolved.error)
    setHostUrlSyncLock(resolved.syncLock)
    setSaveLoading(false)
    const loginSucceeded = stringValue(result.status) === "ready" && result.authenticated === true
    setSaveSuccess(loginSucceeded)
    if (loginSucceeded) {
      setTimeout(() => setSaveSuccess(false), 1500)
    }
    setPendingHostSave(undefined)
  })

  createEffect(() => {
    const id = providerId()
    if (!id || !selectedProvider() || !adminUsable()) return
    if (lastModelFetchProvider() === id) return
    setLastModelFetchProvider(id)
    requestProviderModels("正在读取该服务商的模型列表...")
  })

  createEffect(() => {
    const result = server.actionResult()
    const provider = result?.provider
    if (
      result?.ok === true &&
      provider &&
      typeof provider === "object" &&
      stringValue((provider as Record<string, unknown>).id) === providerId()
    ) {
      setProviderApiKey("")
    }
    if (result?.ok === true && provider && typeof provider === "object") {
      const id = stringValue((provider as Record<string, unknown>).id)
      if (id) {
        setProviderId(id)
        selectProvider(provider as Record<string, unknown>)
      }
    }
    if (result?.provider_id && result.provider_id === providerId() && Array.isArray(result.models)) {
      const models: ProviderModelEntry[] = []
      for (const item of result.models) {
        if (!item || typeof item !== "object") continue
        const model = item as Record<string, unknown>
        const id = stringValue(model.id)
        if (!id) continue
        models.push({
          id,
          owned_by: stringValue(model.owned_by),
          created: numberValue(model.created, 0),
          max_tokens: numberValue(model.max_tokens, 0) || undefined,
          max_context_tokens: numberValue(model.max_context_tokens, 0) || undefined,
          capability_source: stringValue(model.capability_source),
          capability: objectValue(model.capability),
          supports_tools: model.supports_tools === true,
          supports_structured_outputs: model.supports_structured_outputs === true,
          supports_json_output: model.supports_json_output === true,
          supports_reasoning: model.supports_reasoning === true,
          supports_vision: model.supports_vision === true,
          supports_parallel_tool_calls: model.supports_parallel_tool_calls === true,
        })
      }
      setFetchedModels(models)
      setModelFetchMessage(
        models.length > 0
          ? `已获取 ${models.length} 个模型。`
          : "当前服务商未返回模型列表，请使用“自定义模型名”。"
      )
    }
    if (result?.unsupported === true && result?.provider_id === providerId()) {
      setFetchedModels([])
      setModelFetchMessage(stringValue(result.message, "当前服务商无法自动获取模型列表，请使用“自定义模型名”。"))
    }
  })

  onMount(() => {
    settingsMessages.refreshAdmin(vscode)
    settingsMessages.modelCapabilitiesStatus(vscode)
    settingsMessages.getAutoApproval(vscode)
    const unsubscribe = vscode.onMessage((msg) => {
      if (msg.type !== "autoApproval.state") return
      const payload = objectValue(msg.payload)
      setAutoApprovalOptions(sanitizeAutoApproveOptions(payload.options))
      setAllowedCommands(uniqueCommandRules(stringArray(payload.allowedCommands)))
      setDeniedCommands(uniqueCommandRules(stringArray(payload.deniedCommands)))
      setAutoApprovalPlatform(stringValue(payload.platform, "browser"))
    })
    onCleanup(unsubscribe)
  })

  return {
    vscode,
    server,
    activeTab,
    setActiveTab,
    switchTab,
    settingsTabDefs: settingsTabDefsVisible,
    EXECUTOR_ENGINES,
    PROFILE_EXECUTOR_OPTIONS,
    PROFILE_EXECUTION_LOCATION_OPTIONS,
    PROFILE_HOME_POLICY_OPTIONS,
    PROFILE_APPROVAL_MODE_OPTIONS,
    PROFILE_CONFIG_ISOLATION_OPTIONS,
    setProfileExecutorSelect,
    setAgentNameInput,
    executorPickerOpen,
    setExecutorPickerOpen,
    pickerLocation,
    setPickerLocation,
    pickerEngine,
    setPickerEngine,
    refreshLoading,
    setRefreshLoading,
    saveLoading,
    setSaveLoading,
    saveSuccess,
    setSaveSuccess,
    hostUrl,
    setHostUrl,
    loginUsername,
    setLoginUsername,
    loginPassword,
    setLoginPassword,
    currentPassword,
    setCurrentPassword,
    newPassword,
    setNewPassword,
    newUserUsername,
    setNewUserUsername,
    newUserPassword,
    setNewUserPassword,
    newUserRole,
    setNewUserRole,
    resetPasswordUserId,
    setResetPasswordUserId,
    resetPasswordValue,
    setResetPasswordValue,
    auditEventType,
    setAuditEventType,
    hostUrlDirty,
    setHostUrlDirty,
    pendingHostSave,
    setPendingHostSave,
    hostUrlError,
    setHostUrlError,
    hostUrlSyncLock,
    setHostUrlSyncLock,
    dismissedConnectionSaveResultKey,
    setDismissedConnectionSaveResultKey,
    providerId,
    setProviderId,
    providerType,
    setProviderType,
    providerCompat,
    setProviderCompat,
    providerBaseUrl,
    setProviderBaseUrl,
    providerApiKey,
    setProviderApiKey,
    providerModel,
    setProviderModel,
    providerEnabled,
    setProviderEnabled,
    providerCopyId,
    setProviderCopyId,
    modelSearch,
    setModelSearch,
    fetchedModels,
    setFetchedModels,
    modelFetchMessage,
    setModelFetchMessage,
    lastModelFetchProvider,
    setLastModelFetchProvider,
    modelDetailOpen,
    setModelDetailOpen,
    modelDetailMode,
    setModelDetailMode,
    customModelDialogOpen,
    setCustomModelDialogOpen,
    customModelDraft,
    setCustomModelDraft,
    actionIntent,
    setActionIntent,
    environmentBootstrapped,
    setEnvironmentBootstrapped,
    selectedEnvironmentAgentId,
    setSelectedEnvironmentAgentId,
    serverSettingsBootstrapped,
    setServerSettingsBootstrapped,
    selectedEnvironmentApproval,
    setSelectedEnvironmentApproval,
    toolchainBootstrapped,
    setToolchainBootstrapped,
    toolchainEditor,
    setToolchainEditor,
    toolchainKindFilter,
    setToolchainKindFilter,
    toolchainStatusFilter,
    setToolchainStatusFilter,
    toolchainSearch,
    setToolchainSearch,
    selectedToolchainId,
    setSelectedToolchainId,
    ingestRepoUrl,
    setIngestRepoUrl,
    ingestDocsUrl,
    setIngestDocsUrl,
    ingestDocsText,
    setIngestDocsText,
    ingestKindHint,
    setIngestKindHint,
    ingestNameHint,
    setIngestNameHint,
    ingestPlacementHint,
    setIngestPlacementHint,
    toolchainRunSerial,
    setToolchainRunSerial,
    serverMaxRunningAgents,
    setServerMaxRunningAgents,
    serverMaxShellsPerAgent,
    setServerMaxShellsPerAgent,
    serverSettingsDirty,
    setServerSettingsDirty,
    autoApprovalOptions,
    setAutoApprovalOptions,
    allowedCommandInput,
    setAllowedCommandInput,
    deniedCommandInput,
    setDeniedCommandInput,
    allowedCommands,
    setAllowedCommands,
    deniedCommands,
    setDeniedCommands,
    autoApprovalPlatform,
    setAutoApprovalPlatform,
    agentConfigBootstrapped,
    setAgentConfigBootstrapped,
    agentConfigDirty,
    setAgentConfigDirty,
    selectedProfileId,
    setSelectedProfileId,
    selectedAgentId,
    setSelectedAgentId,
    profileDrafts,
    setProfileDrafts,
    agentDrafts,
    setAgentDrafts,
    agentConfigSavePending,
    setAgentConfigSavePending,
    agentConfigSaved,
    setAgentConfigSaved,
    agentConfigError,
    setAgentConfigError,
    agentRun,
    setAgentRun,
    agentRunEvents,
    setAgentRunEvents,
    agentRunError,
    setAgentRunError,
    agentRunSubmitting,
    setAgentRunSubmitting,
    agentRunPolling,
    setAgentRunPolling,
    agentRunPrompt,
    setAgentRunPrompt,
    profileId,
    setProfileId,
    profileProvider,
    setProfileProvider,
    profileModel,
    setProfileModel,
    maxTokens,
    setMaxTokens,
    maxContextTokens,
    setMaxContextTokens,
    temperature,
    setTemperature,
    reasoningEffort,
    setReasoningEffort,
    thinkingEnabled,
    setThinkingEnabled,
    modelCapabilityRecommendation,
    providers,
    profiles,
    selectedProvider,
    filteredFetchedModels,
    actionFeedback,
    providerErrorMessage,
    connectionStatus,
    connectionMessage,
    connectionNotice,
    connectionSaveMessage,
    currentHostUrl,
    hostUrlSource,
    hostUrlConfigured,
    adminUsable,
    connectionScopes,
    connectionSecurityWarnings,
    refreshAccounts,
    canManageUsers,
    canReadAudit,
    canManageDevices,
    authUsers,
    authDevices,
    authAuditEvents,
    hostUrlDraftDiffers,
    isDefaultLocalHost,
    showCustomModelFallback,
    emptyModelListMessage,
    environmentManifest,
    environmentSnapshot,
    environmentError,
    toolchainError,
    toolchainActionFeedback,
    toolchainGroups,
    environmentCounts,
    environmentEntriesByKind,
    toolchainDashboardItems,
    filteredToolchainItems,
    selectedToolchain,
    toolchainSummary,
    serverSettingsPayload,
    agentRunsSettings,
    agentRunsState,
    modelCapabilitiesStatus,
    executorFeatures,
    agentRunsProfiles,
    agentRunsAgents,
    environmentAgentCandidates,
    registeredMcpServers,
    registeredToolOptions,
    profileIdList,
    currentProfileDraft,
    currentAgentDraft,
    selectedProfileExecutorFeature,
    savedProfileIdSet,
    savedAgentIdSet,
    currentProfileIdLocked,
    currentAgentIdLocked,
    runtimeModelOptions,
    profileMcpValidationWarnings,
    capabilityPackageOptions,
    selectedAgentCapabilityPackages,
    selectedAgentRunId,
    agentRunLastSeq,
    agentRunTerminal,
    agentRunCanResume,
    toolchainIngestState,
    toolchainIngestLogs,
    toolchainIngestDuplicates,
    hasToolchainIngestDuplicates,
    openModelDetail,
    openCustomModelDialog,
    closeCustomModelDialog,
    confirmCustomModelDialog,
    closeModelDetail,
    markAgentConfigDirty,
    focusAfterRender,
    agentConfigIdErrorMessage,
    validateAgentConfigDrafts,
    saveAgentConfig,
    addProfile,
    renameProfile,
    deleteProfile,
    updateProfileField,
    addAgent,
    renameAgent,
    deleteAgent,
    updateAgentField,
    renderStringChoiceList,
    renderRuntimeChoiceList,
    submitAgentRunTest,
    cancelAgentRunTest,
    retryAgentRunTest,
    refreshAdmin,
    executorLocation,
    executorEngine,
    executorEngineOption,
    openExecutorPicker,
    closeExecutorPicker,
    confirmExecutorPicker,
    refreshEnvironmentManifest,
    environmentRunItems,
    runEnvironment,
    stopEnvironmentRun,
    refreshServerSettings,
    refreshModelCapabilities,
    applyModelCapabilityRecommendation,
    saveServerSettings,
    runToolchainIngest,
    cancelToolchainIngest,
    updateAutoApproval,
    addCommandRule,
    removeCommandRule,
    replyEnvironmentApproval,
    rememberEnvironmentApprovalDecision,
    requestProviderModels,
    saveConnection,
    logoutConnection,
    refreshAuthDevices,
    refreshAuthUsers,
    refreshAuthAudit,
    changePassword,
    createAuthUser,
    updateAuthUserScopes,
    disableAuthUser,
    resetAuthUserPassword,
    revokeAuthDevice,
    resetProviderForm,
    selectProvider,
    saveProvider,
    testProvider,
    copyProvider,
    deleteProvider,
    toggleProviderEnabled,
    saveModelPreset,
    executorLocationLabel,
    executorEngineLabel,
    environmentStatusLabel,
    environmentStatusTone,
    environmentRunStatusLabel,
    environmentRunTone,
    environmentKindLabel,
    environmentKindIcon,
    formatTimestamp,
    formatActionResult,
    formatConnectionSaveResult,
    connectionSaveResultKey,
    objectValue,
    stringValue,
    numberValue,
    boolValue,
    stringArray,
    parseAgentConfigListText,
    formatAgentConfigList,
    toolchainPayloadFromEditor,
    emptyToolchainEditor,
    toolchainEditorFromRecord,
    dashboardItemToRecord,
    placementLabel,
    toolchainSourceLabel,
    duplicateMatchLabel,
    toolchainStatusBucket,
    runtimeOptionDescription,
  }
}

export type SettingsController = ReturnType<typeof createSettingsController>
