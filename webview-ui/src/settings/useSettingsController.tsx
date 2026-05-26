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
import { setLocale, t, type Locale } from "../i18n"
import { updateCommandRuleLists } from "../utils/command-auto-approval"
import { settingsMessages } from "./settingsMessages"
import {
  normalizeProviderModelEntries,
  providerModelCacheMessage,
  providerModelRefreshMessage,
  type ProviderModelEntry,
} from "./providerModels"
import {
  connectionSaveResultKey,
  sanitizeAutoApproveOptions,
  serverAgentRunSettingsPayload,
  type SettingsTab,
} from "./settingsControllerUtils"
import {
  getSettingsOperationState,
  initialSettingsOperationStates,
  markSettingsBackgroundRefreshFinished,
  markSettingsBackgroundRefreshStarted,
  markSettingsOperationError,
  markSettingsOperationIdle,
  markSettingsOperationStarted,
  markSettingsOperationSuccess,
  settingsBackgroundRefreshIsBusy,
  settingsAgentRunOperationIsBusy,
  settingsCapabilityIngestOperationIsBusy,
  settingsOperationIsProviderWrite,
  settingsOperationUsesProviderActionResult,
  settingsOperationIsBusy,
  settingsPageIsRefreshing,
  settingsPageOperationKeys,
  settingsProviderActionResultIsBusy,
  settingsProviderModelReadIsBusy,
  settingsProviderWriteIsBusy,
  settingsRefreshShouldMarkForeground,
  settingsRefreshShouldSendRequest,
  settingsServerSettingsReadIsBusy,
  settingsServerSettingsSaveIsBusy,
  type SettingsBackgroundRefreshes,
  type SettingsOperationKey,
  type SettingsOperationState,
  type SettingsOperationStatus,
  type SettingsRefreshMode,
} from "./settingsOperations"
import {
  canUseSettingsAdminData,
  isAccountAdminRole,
  providerListEmptyMessageForState,
  resolveConnectionNotice,
  uniqueCommandRules,
  type ChoiceOption,
} from "./utils"
import {
  DEFAULT_AUTO_APPROVE_OPTIONS,
  approvalFromPayload,
  type ApprovalDecision,
  type ApprovalDetails,
} from "../components/chat/ApprovalDetailsDialog"

type ProviderType = "openai_chat" | "anthropic_messages" | "openai_responses"
type ProviderCompat = "generic" | "deepseek" | "kimi" | "glm" | "qwen" | "zenmux"

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
type ModelActionIntent = "" | "savePreset" | "deletePreset"
type EnvironmentRequirementKind =
  | "executable"
  | "runtime"
  | "sdk"
  | "service"
  | "env_var"
  | "credential"
  | "path"
  | "project_file"
  | "container"
type EnvironmentEntryKind = "environment_requirement" | "mcp" | "unsupported"
type ToolchainKind = "environment_requirement" | "mcp"
type ToolchainResourceKind = EnvironmentRequirementKind | "mcp_server" | "unsupported"
type ToolchainKindFilter = "all" | ToolchainKind
type ToolchainStatusFilter = "all" | "ready" | "missing" | "stopped" | "awaiting"
const BUILT_IN_ENVIRONMENT_AGENT_ID = "environment_configurator"
type AgentVisibility = "user" | "system" | "internal"
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

interface ChatCommandCatalogItem {
  id: string
  name: string
  displayName: string
  featureId: string
  sourceType: string
  registrationPath: string
  description: string
  triggerKind: string
  trigger: string
  uiTargets: string[]
  requiredCapabilities: string[]
  interactive: boolean
  supportsArgs: boolean
  argsHint: string
  selectionBehavior: string
  availableDuringRun: boolean
  visibility: string
}

interface MentionProviderCatalogItem {
  id: string
  name: string
  displayName: string
  sourceType: string
  registrationPath: string
  description: string
  trigger: string
  enabled: boolean
  insertFormat: string
  itemCount: number | null
}

interface UiActionCatalogItem {
  id: string
  name: string
  featureId: string
  sourceType: string
  registrationPath: string
  description: string
  uiTargets: string[]
  requiredCapabilities: string[]
  interactive: boolean
  triggers: Array<{ kind: string; value: string; uiTargets: string[]; requiredCapabilities: string[] }>
}

interface AgentToolCatalogItem {
  id: string
  name: string
  displayName: string
  sourceType: string
  sourceLabel: string
  description: string
  registrationPath: string
  enabled: boolean
  relatedPackageIds: string[]
  relatedComponents: string[]
  modeRefs: string[]
  approvalStatus: string
  executionPolicy: string
  permission: AgentToolPermissionDecision
}

interface AgentToolPermissionDecision {
  action: string
  authorized: boolean
  reason: string
  warning: string
  capabilityMatched: string
  policyMatched: string
  approvalAction: string
}

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

interface RefreshOperationOptions {
  mode?: SettingsRefreshMode
  skip?: readonly SettingsOperationKey[]
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
  requirementKind: EnvironmentRequirementKind | "unsupported"
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
  id?: string
  kind: ToolchainKind
  entryType: ToolchainKind
  resourceKind: ToolchainResourceKind
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
  configure?: string
  version?: string
  runtime?: string
  language?: string
  path?: string
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
  component_id?: string
  package_ids?: string[]
  managed_by?: string
  install_prompt?: string
  verify_prompt?: string
  notes?: string[]
  environment_requirement_refs?: string[]
}

interface ToolchainDashboardItem {
  id: string
  kind: ToolchainKind
  entryType: ToolchainKind
  resourceKind: ToolchainResourceKind
  rawKind: string
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
  configure: string
  command: string
  runtime: string
  language: string
  path: string
  environment_requirement_refs: string[]
  requirements: Record<string, string>
  credentials: string[]
  risk_level: string
  enabled: boolean
  last_action: string
  last_updated: string
  component_id: string
  package_ids: string[]
  managed_by: string
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
  components: string[]
  enabled: boolean
  status: string
  source: Record<string, unknown>
  installPlan: string[]
  usage: string[]
  effectiveCapabilities: string[]
  evidence: Array<Record<string, string>>
  credentials: string[]
  riskLevel: string
}

interface CapabilityPackageIngestState {
  running: boolean
  agentRunId: string
  status: string
  error: string
  draft?: Record<string, unknown>
  source?: Record<string, unknown>
}

interface ToolchainEditorState {
  mode: "create" | "edit"
  kind: ToolchainKind
  id: string
  entryType: ToolchainKind
  resourceKind: ToolchainResourceKind
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
  configure: string
  version: string
  runtime: string
  language: string
  path: string
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
  requirementRefsText: string
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
  chat_entrypoint: boolean
  visibility: AgentVisibility
  delegable: boolean
  taskflow_eligible: boolean
  systemFlowOnlyText: string

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
    chat_entrypoint: false,
    visibility: "user",
    delegable: true,
    taskflow_eligible: true,
    systemFlowOnlyText: "",

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
  const visibility = agentVisibilityValue(agent.visibility)
  const userVisible = visibility === "user"
  return {
    id,
    name: stringValue(agent.name),
    description: stringValue(agent.description),
    role: stringValue(agent.role, "worker"),
    chat_entrypoint: agent.chat_entrypoint === true || agent.entrypoint === true,
    visibility,
    delegable: boolValue(agent.delegable, userVisible),
    taskflow_eligible: boolValue(agent.taskflow_eligible, userVisible),
    systemFlowOnlyText: stringArray(agent.system_flow_only).join("\n"),

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
  if (draft.visibility !== "user") payload.visibility = draft.visibility
  if (draft.chat_entrypoint) payload.chat_entrypoint = true
  const userVisible = draft.visibility === "user"
  if (draft.delegable !== userVisible) payload.delegable = draft.delegable
  if (draft.taskflow_eligible !== userVisible) payload.taskflow_eligible = draft.taskflow_eligible
  const systemFlowOnly = parseAgentConfigListText(draft.systemFlowOnlyText)
  if (systemFlowOnly.length) payload.system_flow_only = systemFlowOnly
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

function agentVisibilityValue(value: unknown): AgentVisibility {
  const visibility = stringValue(value, "user")
  return visibility === "system" || visibility === "internal" ? visibility : "user"
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
    .map((item) => {
      const resourceKind: ToolchainResourceKind = kind === "environment_requirement"
        ? normalizeRequirementKind(item.kind || item.resource_kind)
        : "mcp_server"
      return {
        ...item,
        id: stringValue(item.id),
        kind,
        entryType: kind,
        resourceKind,
        name: stringValue(item.name || item.id),
      } as ToolchainRecord
    })
    .filter((item) => item.name)
}

function emptyToolchainEditor(kind: ToolchainKind): ToolchainEditorState {
  return {
    mode: "create",
    kind,
    id: "",
    entryType: kind,
    resourceKind: kind === "environment_requirement" ? "executable" : "mcp_server",
    name: "",
    enabled: true,
    command: "",

    tagsText: "",
    argsText: "",
    envText: "",
    cwd: "",
    placement: "peer",
    distribution: "command",
    requirementsText: "",
    scope: "project",
    check: "",
    install: "",
    configure: "",
    version: "",
    runtime: "",
    language: "",
    path: "",
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
    requirementRefsText: "",
  }
}

function toolchainEditorFromRecord(record: ToolchainRecord): ToolchainEditorState {
  return {
    ...emptyToolchainEditor(record.kind),
    mode: "edit",
    id: stringValue(record.id),
    entryType: record.entryType || record.kind,
    resourceKind: record.resourceKind || (record.kind === "mcp" ? "mcp_server" : normalizeRequirementKind(record.kind)),
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
    configure: stringValue(record.configure),
    version: stringValue(record.version),
    runtime: stringValue(record.runtime),
    language: stringValue(record.language),
    path: stringValue(record.path),
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
    requirementRefsText: stringListText(record.environment_requirement_refs),
  }
}

function toolchainPayloadFromEditor(editor: ToolchainEditorState): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    id: editor.id.trim() || undefined,
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
    credentials: parseStringList(editor.credentialsText),
    risk_level: editor.riskLevel.trim(),
    install_prompt: editor.installPrompt.trim(),
    verify_prompt: editor.verifyPrompt.trim(),
    notes: parseStringList(editor.notesText),
  }
  if (editor.kind === "environment_requirement") {
    payload.kind = editor.resourceKind === "unsupported" ? undefined : editor.resourceKind
    payload.command = editor.command.trim()
    payload.placement = editor.placement || "peer"
    payload.configure = editor.configure.trim()
    payload.runtime = editor.runtime.trim()
    payload.language = editor.language.trim()
    payload.path = editor.path.trim()
    payload.requirements = parseMapText(editor.requirementsText)
    payload.tags = parseStringList(editor.tagsText)
  } else if (editor.kind === "mcp") {
    payload.command = editor.command.trim()
    payload.args = parseStringList(editor.argsText)
    payload.env = parseMapText(editor.envText)
    payload.cwd = editor.cwd.trim() || undefined
    payload.placement = editor.placement || "peer"
    payload.distribution = editor.distribution || "command"
    payload.environment_requirement_refs = parseStringList(editor.requirementRefsText)
  }
  return payload
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item)).filter(Boolean) : []
}

function normalizeBehaviorTrigger(value: unknown): UiActionCatalogItem["triggers"][number] {
  const item = objectValue(value)
  return {
    kind: stringValue(item.kind),
    value: stringValue(item.value),
    uiTargets: stringArray(item.ui_targets),
    requiredCapabilities: stringArray(item.required_capabilities),
  }
}

function normalizeChatCommandCatalog(value: unknown): ChatCommandCatalogItem[] {
  return Array.isArray(value)
    ? value
      .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
      .map((item) => ({
        id: stringValue(item.id),
        name: stringValue(item.name) || stringValue(item.id),
        displayName: stringValue(item.display_name) || stringValue(item.trigger) || stringValue(item.name) || stringValue(item.id),
        featureId: stringValue(item.feature_id),
        sourceType: stringValue(item.source_type),
        registrationPath: stringValue(item.registration_path),
        description: stringValue(item.description),
        triggerKind: stringValue(item.trigger_kind),
        trigger: stringValue(item.trigger),
        uiTargets: stringArray(item.ui_targets),
        requiredCapabilities: stringArray(item.required_capabilities),
        interactive: item.interactive === true,
        supportsArgs: item.supports_args === true,
        argsHint: stringValue(item.args_hint),
        selectionBehavior: stringValue(item.selection_behavior),
        availableDuringRun: item.available_during_run === true,
        visibility: stringValue(item.visibility, "visible"),
      }))
      .filter((item) => item.id)
    : []
}

function normalizeMentionProviderCatalog(value: unknown): MentionProviderCatalogItem[] {
  return Array.isArray(value)
    ? value
      .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
      .map((item) => ({
        id: stringValue(item.id),
        name: stringValue(item.name) || stringValue(item.id),
        displayName: stringValue(item.display_name) || stringValue(item.name) || stringValue(item.id),
        sourceType: stringValue(item.source_type),
        registrationPath: stringValue(item.registration_path),
        description: stringValue(item.description),
        trigger: stringValue(item.trigger),
        enabled: boolValue(item.enabled, true),
        insertFormat: stringValue(item.insert_format),
        itemCount: item.item_count === null || item.item_count === undefined ? null : numberValue(item.item_count, 0),
      }))
      .filter((item) => item.id)
    : []
}

function normalizeUiActionCatalog(value: unknown): UiActionCatalogItem[] {
  return Array.isArray(value)
    ? value
      .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
      .map((item) => ({
        id: stringValue(item.id),
        name: stringValue(item.name) || stringValue(item.id),
        featureId: stringValue(item.feature_id),
        sourceType: stringValue(item.source_type),
        registrationPath: stringValue(item.registration_path),
        description: stringValue(item.description),
        uiTargets: stringArray(item.ui_targets),
        requiredCapabilities: stringArray(item.required_capabilities),
        interactive: item.interactive === true,
        triggers: Array.isArray(item.triggers)
          ? item.triggers.map(normalizeBehaviorTrigger)
          : [],
      }))
      .filter((item) => item.id)
    : []
}

function normalizeAgentToolCatalog(value: unknown): AgentToolCatalogItem[] {
  return Array.isArray(value)
    ? value
      .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
      .map((item) => ({
        id: stringValue(item.id),
        name: stringValue(item.name) || stringValue(item.id),
        displayName: stringValue(item.display_name) || stringValue(item.name) || stringValue(item.id),
        sourceType: stringValue(item.source_type),
        sourceLabel: stringValue(item.source_label) || stringValue(item.source_type),
        description: stringValue(item.description),
        registrationPath: stringValue(item.registration_path),
        enabled: boolValue(item.enabled, true),
        relatedPackageIds: stringArray(item.related_package_ids),
        relatedComponents: stringArray(item.related_components),
        modeRefs: stringArray(item.mode_refs),
        approvalStatus: stringValue(item.approval_status),
        executionPolicy: stringValue(item.execution_policy) || stringValue(item.approval_status),
        permission: normalizeAgentToolPermission(item.permission),
      }))
      .filter((item) => item.id)
    : []
}

function normalizeAgentToolPermission(value: unknown): AgentToolPermissionDecision {
  const item = objectValue(value)
  return {
    action: stringValue(item.action),
    authorized: item.authorized === true,
    reason: stringValue(item.reason),
    warning: stringValue(item.warning),
    capabilityMatched: stringValue(item.capability_matched || item.capabilityMatched),
    policyMatched: stringValue(item.policy_matched || item.policyMatched),
    approvalAction: stringValue(item.approval_action || item.approvalAction),
  }
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
  const source = objectValue(item.source)
  return {
    id,
    name: stringValue(item.name, id),
    description: stringValue(item.description),
    components: stringArray(item.components),
    enabled: item.enabled !== false,
    status: stringValue(item.status),
    source,
    installPlan: stringArray(item.install_plan),
    usage: stringArray(item.usage),
    effectiveCapabilities: stringArray(item.effective_capabilities),
    evidence: normalizeEvidence(item.evidence),
    credentials: stringArray(item.credentials),
    riskLevel: stringValue(item.risk_level),
  }
}

function stringMapValue(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  return Object.entries(value as Record<string, unknown>).reduce<Record<string, string>>((acc, [key, item]) => {
    acc[key] = stringValue(item)
    return acc
  }, {})
}

const ENVIRONMENT_REQUIREMENT_KIND_VALUES: EnvironmentRequirementKind[] = [
  "executable",
  "runtime",
  "sdk",
  "service",
  "env_var",
  "credential",
  "path",
  "project_file",
  "container",
]

function normalizeRequirementKind(value: unknown): EnvironmentRequirementKind | "unsupported" {
  const text = stringValue(value).trim().toLowerCase()
  return (ENVIRONMENT_REQUIREMENT_KIND_VALUES as string[]).includes(text)
    ? text as EnvironmentRequirementKind
    : "unsupported"
}

function normalizeEntryType(value: unknown): ToolchainKind | "" {
  const text = stringValue(value).trim().toLowerCase()
  if (text === "environment_requirement") return "environment_requirement"
  if (text === "mcp" || text === "mcp_server") return "mcp"
  return ""
}

function entryTypeFromResourceKind(value: unknown): ToolchainKind | "" {
  const text = stringValue(value).trim().toLowerCase()
  if (text === "mcp" || text === "mcp_server") return "mcp"
  if ((ENVIRONMENT_REQUIREMENT_KIND_VALUES as string[]).includes(text)) return "environment_requirement"
  return ""
}

function resourceKindLabel(kind: ToolchainResourceKind): string {
  switch (kind) {
    case "executable":
      return "Executable"
    case "runtime":
      return "Runtime"
    case "sdk":
      return "SDK"
    case "service":
      return "Service"
    case "env_var":
      return "Environment Variable"
    case "credential":
      return "Credential"
    case "path":
      return "Path"
    case "project_file":
      return "Project File"
    case "container":
      return "Container"
    case "mcp_server":
      return "MCP Server"
    default:
      return "Unsupported"
  }
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
  const placement = stringValue(record.placement, record.kind === "mcp" ? "server" : "peer")
  const resourceKind = record.resourceKind || (record.kind === "mcp" ? "mcp_server" : normalizeRequirementKind(record.kind))
  const id = stringValue(record.id) || (
    record.kind === "environment_requirement"
      ? `envreq:${resourceKind}:${record.name}`
      : `mcp:${record.name}`
  )
  return {
    id,
    kind: record.kind,
    entryType: record.entryType || record.kind,
    resourceKind,
    rawKind: resourceKind,
    name: record.name,
    alias: stringValue(record.command || record.path_hint || record.name),
    source: stringValue(record.source),
    repo_url: stringValue(record.repo_url),
    docs: Array.isArray(record.docs) ? record.docs : [],
    evidence: normalizeEvidence(record.evidence),
    placement,
    scope: stringValue(record.scope || record.placement, placement),
    status: boolValue(record.enabled, true) ? "unchecked" : "stopped",
    status_detail: boolValue(record.enabled, true) ? "等待环境检查" : "清单已停用",
    check: stringValue(record.check),
    install: stringValue(record.install),
    configure: stringValue(record.configure),
    command: stringValue(record.command || record.path_hint),
    runtime: stringValue(record.runtime),
    language: stringValue(record.language),
    path: stringValue(record.path),
    environment_requirement_refs: stringArray(record.environment_requirement_refs),
    requirements: stringMapValue(record.requirements),
    credentials: stringArray(record.credentials),
    risk_level: stringValue(record.risk_level),
    enabled: boolValue(record.enabled, true),
    last_action: stringValue(record.last_action),
    last_updated: stringValue(record.last_updated),
    component_id: stringValue(record.component_id),
    package_ids: stringArray(record.package_ids),
    managed_by: stringValue(record.managed_by),
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
  const baseItems = (["environment_requirement", "mcp"] as ToolchainKind[]).flatMap((kind) =>
    fallbackGroups[kind].map(toolchainRecordToDashboardItem)
  )
  const byId = new Map(baseItems.map((item) => [item.id, item]))
  for (const rawItem of rawItems) {
    const summary = dashboardSummaryItem(rawItem)
    const existing = byId.get(summary.id)
    if (!existing) {
      byId.set(summary.id, summary)
      continue
    }
    byId.set(summary.id, {
      ...existing,
      status: summary.status,
      status_detail: summary.status_detail,
      enabled: summary.enabled,
      last_action: summary.last_action,
      last_updated: summary.last_updated,
    })
  }
  const mergedItems = [...byId.values()]
  const statusById = new Map(snapshot.entries.map((entry) => [entry.id, entry]))
  return mergedItems
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

function dashboardSummaryItem(item: Record<string, unknown>): ToolchainDashboardItem {
  const name = stringValue(item.name)
  const entryType = (normalizeEntryType(item.entry_type) || entryTypeFromResourceKind(item.kind) || "environment_requirement") as ToolchainKind
  const resourceKind = (
    entryType === "mcp"
      ? "mcp_server"
      : normalizeRequirementKind(item.kind || item.resource_kind)
  ) as ToolchainResourceKind
  const id = stringValue(item.id) || (
    entryType === "mcp"
      ? `mcp:${name}`
      : `envreq:${resourceKind}:${name}`
  )
  return {
    id,
    kind: entryType,
    entryType,
    resourceKind,
    rawKind: stringValue(item.kind),
    name,
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
    configure: stringValue(item.configure),
    command: stringValue(item.command),
    runtime: stringValue(item.runtime),
    language: stringValue(item.language),
    path: stringValue(item.path),
    environment_requirement_refs: stringArray(item.environment_requirement_refs),
    requirements: stringMapValue(item.requirements),
    credentials: stringArray(item.credentials),
    risk_level: stringValue(item.risk_level),
    enabled: boolValue(item.enabled, true),
    last_action: stringValue(item.last_action),
    last_updated: stringValue(item.last_updated),
    component_id: stringValue(item.component_id),
    package_ids: stringArray(item.package_ids),
    managed_by: stringValue(item.managed_by),
  }
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
  if (item.kind === "environment_requirement") {
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

function dashboardItemToRecord(item: ToolchainDashboardItem): ToolchainRecord {
  return {
    id: item.id,
    kind: item.kind,
    entryType: item.entryType,
    resourceKind: item.resourceKind,
    name: item.name,
    enabled: item.enabled,
    command: item.command,
    placement: item.placement,
    scope: item.scope || item.placement,
    requirements: item.requirements,
    check: item.check,
    install: item.install,
    configure: item.configure,
    runtime: item.runtime,
    language: item.language,
    path: item.path,
    environment_requirement_refs: item.environment_requirement_refs,
    source: item.source,
    description: item.alias,
    docs: item.docs,
    evidence: item.evidence,
    repo_url: item.repo_url,
    credentials: item.credentials,
    risk_level: item.risk_level,
    last_action: item.last_action,
    last_updated: item.last_updated,
    component_id: item.component_id,
    package_ids: item.package_ids,
    managed_by: item.managed_by,
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
  const profileProvider = stringValue(profile.provider) || stringValue(profile.provider_id) || stringValue(profile.providerId)
  const profileModel = stringValue(profile.model) || stringValue(profile.model_id) || stringValue(profile.modelId)
  return profileProvider === providerId && profileModel === modelId
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

function environmentKindLabel(kind: EnvironmentEntryKind | ToolchainKind): string {
  if (kind === "environment_requirement") return "环境要求"
  if (kind === "mcp") return "MCP"
  return "不支持"
}

function environmentKindIcon(kind: EnvironmentEntryKind | ToolchainKind): string {
  if (kind === "environment_requirement") return "terminal"
  if (kind === "mcp") return "plug"
  return "warning"
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
      kind: (normalizeEntryType(item.kind) || entryTypeFromResourceKind(item.requirement_kind || item.resource_kind || item.kind) || "unsupported") as EnvironmentEntryKind,
      requirementKind: normalizeRequirementKind(item.requirement_kind || item.resource_kind || item.kind),
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
  if (result.deleted === true && (result.profile_id || result.id)) {
    const presetId = stringValue(result.profile_id, stringValue(result.id))
    return presetId
      ? `预设 ${presetId} 已移除。模型仍保留在服务商模型目录中。`
      : "模型预设已移除。模型仍保留在服务商模型目录中。"
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

function isProviderModelResult(result: Record<string, unknown>): boolean {
  return Boolean(
    stringValue(result.provider_id)
    && (Array.isArray(result.models) || result.unsupported === true)
  )
}

function providerActionKeyForResult(
  result: Record<string, unknown>,
  pendingKeys: SettingsOperationKey[],
): SettingsOperationKey | undefined {
  if (pendingKeys.includes("providerTest") && result.model && result.response !== undefined) {
    return "providerTest"
  }
  if (pendingKeys.includes("modelProfileSave") && result.model_profile && typeof result.model_profile === "object") {
    return "modelProfileSave"
  }
  if (pendingKeys.includes("modelProfileDelete") && result.deleted === true && (result.profile_id || result.id)) {
    return "modelProfileDelete"
  }
  if (pendingKeys.includes("providerCopy") && result.provider && result.copied_from !== undefined) {
    return "providerCopy"
  }
  if (pendingKeys.includes("providerSave") && result.provider && Object.prototype.hasOwnProperty.call(result, "created")) {
    return "providerSave"
  }
  if (pendingKeys.includes("providerEnable") && result.provider && !Object.prototype.hasOwnProperty.call(result, "created")) {
    return "providerEnable"
  }
  if (pendingKeys.includes("providerDelete") && result.provider_id && !result.model && !result.provider) {
    return "providerDelete"
  }
  return pendingKeys.length === 1 ? pendingKeys[0] : undefined
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
  const [operationStates, setOperationStates] = createSignal(initialSettingsOperationStates())
  const [backgroundRefreshes, setBackgroundRefreshes] = createSignal<SettingsBackgroundRefreshes>({})
  const [pendingServerSettingsSaveKey, setPendingServerSettingsSaveKey] = createSignal<SettingsOperationKey | undefined>()
  const [pendingProviderActionKeys, setPendingProviderActionKeys] = createSignal<Partial<Record<SettingsOperationKey, true>>>({})
  const [pendingProviderModelRequests, setPendingProviderModelRequests] = createSignal<Record<string, { providerId: string; requestId: string }>>({})
  let providerModelRequestSeq = 0

  const operationState = (key: SettingsOperationKey): SettingsOperationState =>
    getSettingsOperationState(operationStates(), key)
  const operationError = (key: SettingsOperationKey): string | undefined => operationState(key).error
  const operationBusy = (key: SettingsOperationKey): boolean =>
    settingsOperationIsBusy(operationStates(), key)
  const backgroundRefreshBusy = (key: SettingsOperationKey): boolean =>
    settingsBackgroundRefreshIsBusy(backgroundRefreshes(), key)

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
  const [capabilitySourceType, setCapabilitySourceType] = createSignal<"github_repo" | "docs_url" | "project_notes">("github_repo")
  const [capabilitySourceUrl, setCapabilitySourceUrl] = createSignal("")
  const [capabilitySourceNotes, setCapabilitySourceNotes] = createSignal("")
  const [capabilityPackageIdHint, setCapabilityPackageIdHint] = createSignal("")
  const [capabilityPackageIngestState, setCapabilityPackageIngestState] = createSignal<CapabilityPackageIngestState>({
    running: false,
    agentRunId: "",
    status: "idle",
    error: "",
  })
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

  const adminDataUsable = createMemo(() => canUseSettingsAdminData(server.connectionState()))

  const providers = createMemo(() => {
    if (!adminDataUsable()) return []
    const items = server.providersState()?.providers
    return Array.isArray(items) ? items as Record<string, unknown>[] : []
  })
  const profiles = createMemo(() => {
    if (!adminDataUsable()) return []
    const items = server.modelProfilesState()?.model_profiles
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
  const adminUsable = createMemo(() => adminDataUsable())
  const providerListEmptyMessage = createMemo(() => {
    return providerListEmptyMessageForState({
      connectionStatus: connectionStatus(),
      authenticated: server.connectionState().authenticated,
      adminUsable: adminUsable(),
      loading: operationBusy("providers") || backgroundRefreshBusy("providers"),
      adminError: server.providersError() || server.modelProfilesError(),
    })
  })
  const settingsTabDefsVisible = createMemo(() => settingsTabDefs.filter((tab) => tab.id !== "accounts" || adminUsable()))
  const connectionScopes = createMemo(() => stringArray(server.connectionState().scopes))
  const connectionSecurityWarnings = createMemo(() => stringArray(server.connectionState().securityWarnings))
  const canManageUsers = createMemo(() => connectionScopes().includes("users:manage"))
  const canReadAudit = createMemo(() => connectionScopes().includes("audit:read"))
  const canManageDevices = createMemo(() => connectionScopes().includes("devices:read") || connectionScopes().includes("devices:revoke"))
  const serverSettingsSaveBusy = (): boolean =>
    settingsServerSettingsSaveIsBusy(operationStates())
    || settingsServerSettingsReadIsBusy(operationStates())
    || backgroundRefreshBusy("serverSettings")
  const providerWriteBusy = (): boolean =>
    settingsProviderWriteIsBusy(operationStates())
  const providerActionResultBusy = (): boolean =>
    settingsProviderActionResultIsBusy(operationStates())
  const providerModelRefreshBusy = (targetProviderId = providerId()): boolean => {
    const id = targetProviderId.trim()
    if (id && pendingProviderModelRequests()[id]) return true
    return settingsProviderModelReadIsBusy(operationStates(), id || undefined)
  }
  const agentRunOperationBusy = (): boolean =>
    settingsAgentRunOperationIsBusy(operationStates())
  const capabilityIngestOperationBusy = (): boolean =>
    settingsCapabilityIngestOperationIsBusy(operationStates())
  const markOperationStarted = (
    key: SettingsOperationKey,
    status: Extract<SettingsOperationStatus, "loading" | "saving"> = "loading",
    metadata: Pick<SettingsOperationState, "targetId" | "requestId"> = {},
  ) => {
    setOperationStates((states) => markSettingsOperationStarted(states, key, status, Date.now(), metadata))
  }
  const markOperationSuccess = (key: SettingsOperationKey) => {
    setOperationStates((states) => markSettingsOperationSuccess(states, key))
  }
  const markAuthOperationSuccess = (key: "authDevices" | "authUsers" | "authAudit") => {
    clearBackgroundRefresh(key)
    setOperationStates((states) => {
      if (!settingsOperationIsBusy(states, key)) return states
      const next = markSettingsOperationSuccess(states, key)
      return ["authDevices", "authUsers", "authAudit"].some((authKey) =>
        settingsOperationIsBusy(next, authKey as SettingsOperationKey)
      )
        ? next
        : markSettingsOperationSuccess(next, "accounts")
    })
  }
  const markOperationError = (key: SettingsOperationKey, error: string) => {
    setOperationStates((states) => markSettingsOperationError(states, key, error))
  }
  const markBackgroundRefreshStarted = (key: SettingsOperationKey) => {
    setBackgroundRefreshes((states) => markSettingsBackgroundRefreshStarted(states, key))
  }
  const clearBackgroundRefresh = (key: SettingsOperationKey) => {
    setBackgroundRefreshes((states) => markSettingsBackgroundRefreshFinished(states, key))
  }
  const settleRefreshSuccess = (key: SettingsOperationKey) => {
    clearBackgroundRefresh(key)
    if (operationBusy(key)) markOperationSuccess(key)
  }
  const settleRefreshError = (key: SettingsOperationKey, error: string) => {
    clearBackgroundRefresh(key)
    if (operationBusy(key)) markOperationError(key, error)
  }
  const settleAuthOperationError = (message: string) => {
    clearBackgroundRefresh("authDevices")
    clearBackgroundRefresh("authUsers")
    clearBackgroundRefresh("authAudit")
    for (const key of ["authDevices", "authUsers", "authAudit"] as const) {
      if (operationBusy(key)) markOperationError(key, message)
    }
    if (operationBusy("accounts")) markOperationError("accounts", message)
  }
  const pendingProviderActionKeyList = (): SettingsOperationKey[] =>
    Object.keys(pendingProviderActionKeys()) as SettingsOperationKey[]
  const addPendingProviderActionKey = (key: SettingsOperationKey) => {
    setPendingProviderActionKeys((current) => ({ ...current, [key]: true }))
  }
  const clearPendingProviderActionKey = (key: SettingsOperationKey) => {
    setPendingProviderActionKeys((current) => {
      const next = { ...current }
      delete next[key]
      return next
    })
  }
  const settlePendingProviderActionError = (message: string) => {
    for (const key of pendingProviderActionKeyList()) {
      markOperationError(key, message)
    }
    setPendingProviderActionKeys({})
  }
  const providerModelReadRequestIds = createMemo(() => Object.keys(pendingProviderModelRequests()))
  const beginProviderModelRead = (targetProviderId: string, message: string): boolean => {
    const id = targetProviderId.trim()
    if (!id || !selectedProvider() || !adminUsable()) return false
    if (pendingProviderModelRequests()[id]) return false
    const requestId = `${id}:${++providerModelRequestSeq}`
    setPendingProviderModelRequests((current) => ({
      ...current,
      [id]: { providerId: id, requestId },
    }))
    markOperationStarted("providerModels", "loading", { targetId: id, requestId })
    setFetchedModels([])
    setModelFetchMessage(message)
    setProviderValidationError("")
    setActionIntent("")
    settingsMessages.providerModels(vscode, id)
    return true
  }
  const finishProviderModelRead = (targetProviderId: string, message?: string) => {
    const id = targetProviderId.trim()
    let remainingRequests: Record<string, { providerId: string; requestId: string }> = {}
    setPendingProviderModelRequests((current) => {
      const next = { ...current }
      delete next[id]
      remainingRequests = next
      return next
    })
    const remaining = Object.keys(remainingRequests)
    if (remaining.length === 0) markOperationSuccess("providerModels")
    else {
      const nextId = remaining[0]
      const nextRequest = remainingRequests[nextId]
      if (nextRequest) markOperationStarted("providerModels", "loading", {
        targetId: nextRequest.providerId,
        requestId: nextRequest.requestId,
      })
    }
    if (message && id === providerId()) setModelFetchMessage(message)
  }
  const failPendingProviderModelReads = (message: string) => {
    const pendingIds = providerModelReadRequestIds()
    if (!pendingIds.length) return
    setPendingProviderModelRequests({})
    markOperationError("providerModels", message)
    if (pendingIds.includes(providerId())) setModelFetchMessage(message || "模型列表刷新失败")
  }
  const loadProviderModelCache = (provider: Record<string, unknown>) => {
    const models = normalizeProviderModelEntries(provider.models)
    setFetchedModels(models)
    setModelFetchMessage(providerModelCacheMessage(models))
  }
  const pageRefreshing = (tab: SettingsTab): boolean => settingsPageIsRefreshing(operationStates(), tab)
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
    const label = kind === "environment_requirement" ? "环境要求" : kind === "mcp_server" || kind === "mcp" ? "MCP" : "能力"
    if (result.created === true) return `${label} ${name} 已新增。`
    if (result.toolchain) return `${label} ${name} 已保存。`
    return `${label} ${name} 操作已完成。`
  })
  const toolchainGroups = createMemo(() => {
    const state = server.toolchainState() || {}
    return {
      environment_requirement: normalizeToolchainList(state.environment_requirements, "environment_requirement"),
      mcp: normalizeToolchainList(state.mcp_servers, "mcp"),
    }
  })
  const environmentCounts = createMemo(() => summarizeEnvironmentEntries(environmentSnapshot().entries))
  const environmentEntriesByKind = createMemo(() => ({
    environment_requirement: environmentSnapshot().entries.filter((entry) => entry.kind === "environment_requirement"),
    mcp: environmentSnapshot().entries.filter((entry) => entry.kind === "mcp"),
    unsupported: environmentSnapshot().entries.filter((entry) => entry.kind === "unsupported"),
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
  const behaviorCatalog = createMemo(() =>
    objectValue(server.toolchainState()?.behavior_catalog)
  )
  const toolchainBehaviorError = createMemo(() =>
    stringValue(server.toolchainState()?.behavior_catalog_error) ||
    stringValue(behaviorCatalog().error)
  )
  const chatCommandCatalogItems = createMemo(() =>
    normalizeChatCommandCatalog(
      server.toolchainState()?.chat_commands || behaviorCatalog().chat_commands
    )
  )
  const mentionProviderCatalogItems = createMemo(() =>
    normalizeMentionProviderCatalog(
      server.toolchainState()?.mention_providers || behaviorCatalog().mention_providers
    )
  )
  const uiActionCatalogItems = createMemo(() =>
    normalizeUiActionCatalog(
      server.toolchainState()?.ui_actions || behaviorCatalog().ui_actions
    )
  )
  const agentToolCatalogItems = createMemo(() =>
    normalizeAgentToolCatalog(
      server.toolchainState()?.agent_tools || behaviorCatalog().agent_tools
    )
  )
  const serverSettingsPayload = createMemo(() => {
    const direct = server.serverSettingsState()
    if (direct && Object.keys(direct).length) {
      return {
        ...direct,
        runtime: objectValue(direct.runtime || direct.agent_runs),
      }
    }
    return { settings: {}, runtime: {} }
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
  const agentRunsState = createMemo(() => objectValue(serverSettingsPayload().runtime))
  const modelCapabilitiesStatus = createMemo(() => {
    const direct = objectValue(server.modelCapabilitiesState()?.model_capabilities)
    if (Object.keys(direct).length) return direct
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
    for (const item of groups.environment_requirement) add(item.id || item.name, resourceKindLabel(item.resourceKind), item.command || stringValue((item as unknown as Record<string, unknown>).alias))
    for (const item of groups.mcp) add(item.name, "MCP", item.command || stringValue((item as unknown as Record<string, unknown>).alias))
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
    for (const item of profiles()) {
      const provider = stringValue(item.provider_id || item.provider)
      const model = stringValue(item.model_id || item.model || item.id)
      const value = modelOptionKey(provider, model)
      if (!provider || !model || seen.has(value)) continue
      seen.add(value)
      result.push({
        value,
        label: stringValue(item.label || item.display_name || item.id, model),
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
      refreshOperation("serverSettings", { mode: "background" })
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
  let capabilityIngestPollTimer: ReturnType<typeof setInterval> | undefined

  const stopAgentRunPolling = () => {
    if (agentRunPollTimer) {
      clearInterval(agentRunPollTimer)
      agentRunPollTimer = undefined
    }
    setAgentRunPolling(false)
  }

  const requestAgentRunEvents = (taskId: string, afterSeq = agentRunLastSeq()) => {
    if (!taskId) return
    settingsMessages.agentRunEvents(vscode, {
      agent_run_id: taskId,
      after_seq: afterSeq,
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

  const stopCapabilityIngestPolling = () => {
    if (capabilityIngestPollTimer) {
      clearInterval(capabilityIngestPollTimer)
      capabilityIngestPollTimer = undefined
    }
  }

  const startCapabilityIngestPolling = (agentRunId: string) => {
    stopCapabilityIngestPolling()
    if (!agentRunId) return
    settingsMessages.capabilityPackageIngestStatus(vscode, agentRunId)
    capabilityIngestPollTimer = setInterval(() => {
      settingsMessages.capabilityPackageIngestStatus(vscode, agentRunId)
    }, 2000)
  }

  onCleanup(stopCapabilityIngestPolling)

  onMount(() => {
    const unsubscribe = vscode.onMessage((msg) => {
      const rawMessage = msg as unknown as Record<string, unknown>
      const message = typeof rawMessage.message === "string" ? rawMessage.message : "Settings request failed"
      if (msg.type === "admin.error") {
        settlePendingProviderActionError(message)
        failPendingProviderModelReads(message)
      }
      if (msg.type === "providers.state") settleRefreshSuccess("providers")
      if (msg.type === "providers.error") settleRefreshError("providers", message)
      if (msg.type === "modelProfiles.state") settleRefreshSuccess("modelProfiles")
      if (msg.type === "modelProfiles.error") settleRefreshError("modelProfiles", message)
      if (msg.type === "chatConfig.state") settleRefreshSuccess("chatConfig")
      if (msg.type === "chatConfig.error") settleRefreshError("chatConfig", message)
      if (msg.type === "github.state") settleRefreshSuccess("github")
      if (msg.type === "github.error") settleRefreshError("github", message)
      if (msg.type === "serverSettings.state") {
        settleRefreshSuccess("serverSettings")
        const pending = pendingServerSettingsSaveKey()
        if (pending) {
          markOperationSuccess(pending)
          setPendingServerSettingsSaveKey(undefined)
          if (pending === "agentConfigSave") {
            setAgentConfigSavePending(false)
            setAgentConfigDirty(false)
            setAgentConfigSaved(true)
            setAgentConfigError("")
          }
        }
      }
      if (msg.type === "serverSettings.error") {
        const pending = pendingServerSettingsSaveKey()
        if (pending) {
          markOperationError(pending, message)
          setPendingServerSettingsSaveKey(undefined)
          if (pending === "agentConfigSave") {
            setAgentConfigSavePending(false)
            setAgentConfigSaved(false)
            setAgentConfigError(message)
          }
        } else {
          settleRefreshError("serverSettings", message)
        }
      }
      if (msg.type === "autoApproval.state") settleRefreshSuccess("autoApproval")
      if (msg.type === "reasoningDisplay.state") settleRefreshSuccess("reasoningDisplay")
      if (msg.type === "chat.sendDuringRunMode.state") settleRefreshSuccess("chatSendDuringRunMode")
      if (msg.type === "peerDiagnosticsLogging.state") settleRefreshSuccess("peerDiagnosticsLogging")
      if (msg.type === "diagnostics.toolDiagnostics.state") settleRefreshSuccess("toolDiagnostics")
      if (msg.type === "diagnostics.toolDiagnostics.error") settleRefreshError("toolDiagnostics", message)
      if (msg.type === "modelCapabilities.state") settleRefreshSuccess("modelCapabilities")
      if (msg.type === "modelCapabilities.error") settleRefreshError("modelCapabilities", message)
      if (msg.type === "toolchain.state" || msg.type === "toolchain.actionResult") settleRefreshSuccess("toolchains")
      if (msg.type === "toolchain.error") settleRefreshError("toolchains", message)
      if (msg.type === "environment.manifest" || msg.type === "environment.snapshot") settleRefreshSuccess("environmentManifest")
      if (msg.type === "environment.run.error") settleRefreshError("environmentManifest", message)
      if (msg.type === "auth.devices") markAuthOperationSuccess("authDevices")
      if (msg.type === "auth.users") markAuthOperationSuccess("authUsers")
      if (msg.type === "auth.audit") markAuthOperationSuccess("authAudit")
      if (msg.type === "auth.error") {
        settleAuthOperationError(message)
      }
      if (msg.type === "admin.actionResult") {
        const payload = objectValue(msg.payload)
        const result = Object.keys(payload).length ? payload : objectValue(msg)
        if (isProviderModelResult(result)) {
          finishProviderModelRead(stringValue(result.provider_id))
        } else {
          const key = providerActionKeyForResult(result, pendingProviderActionKeyList())
          if (key) {
            markOperationSuccess(key)
            clearPendingProviderActionKey(key)
          }
        }
      }
      if (msg.type === "agentRun.submitted" && typeof msg.payload === "object" && msg.payload) {
        const payload = objectValue(msg.payload)
        const task = objectValue(payload.agent_run || payload.task)
        if (operationBusy("agentRunSubmit")) markOperationSuccess("agentRunSubmit")
        if (operationBusy("agentRunRetry")) markOperationSuccess("agentRunRetry")
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
        markOperationSuccess("agentRunCancel")
        setAgentRunError("")
        requestAgentRunEvents(selectedAgentRunId())
      }
      if (msg.type === "agentRun.error") {
        if (operationBusy("agentRunSubmit")) markOperationError("agentRunSubmit", message)
        if (operationBusy("agentRunRetry")) markOperationError("agentRunRetry", message)
        if (operationBusy("agentRunCancel")) markOperationError("agentRunCancel", message)
        setAgentRunSubmitting(false)
        stopAgentRunPolling()
        setAgentRunError(message || "Runtime request failed")
      }
      if (msg.type === "capabilityPackage.ingest.started" && typeof msg.payload === "object" && msg.payload) {
        const payload = objectValue(msg.payload)
        const task = objectValue(payload.agent_run)
        const agentRunId = stringValue(task.id || task.agent_run_id)
        markOperationSuccess("capabilityIngestStart")
        setCapabilityPackageIngestState((current) => ({
          ...current,
          running: true,
          agentRunId,
          status: stringValue(task.status, "queued"),
          source: objectValue(payload.source),
          error: "",
        }))
        if (agentRunId) startCapabilityIngestPolling(agentRunId)
      }
      if (msg.type === "capabilityPackage.ingest.status" && typeof msg.payload === "object" && msg.payload) {
        const payload = objectValue(msg.payload)
        const task = objectValue(payload.agent_run)
        const status = stringValue(task.status, "queued")
        const draft = objectValue(payload.draft)
        markOperationSuccess("capabilityIngestStatus")
        setCapabilityPackageIngestState((current) => ({
          ...current,
          running: !["completed", "failed", "cancelled", "blocked"].includes(status),
          agentRunId: stringValue(task.id || task.agent_run_id, current.agentRunId),
          status,
          draft: Object.keys(draft).length ? draft : current.draft,
          error: "",
        }))
        if (["completed", "failed", "cancelled", "blocked"].includes(status)) {
          stopCapabilityIngestPolling()
        }
      }
      if (msg.type === "capabilityPackage.actionResult") {
        setCapabilityPackageIngestState((current) => ({
          ...current,
          error: "",
        }))
      }
      if (msg.type === "capabilityPackage.error") {
        if (operationBusy("capabilityIngestStart")) markOperationError("capabilityIngestStart", message)
        if (operationBusy("capabilityIngestStatus")) markOperationError("capabilityIngestStatus", message)
        stopCapabilityIngestPolling()
        setCapabilityPackageIngestState((current) => ({
          ...current,
          running: false,
          error: message || "Capability package request failed",
        }))
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

  const setConversationLocale = (loc: Locale) => setLocale(loc, vscode.postMessage)

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
    if (serverSettingsSaveBusy()) return
    setAgentConfigSavePending(true)
    setAgentConfigSaved(false)
    setAgentConfigError("")
    updateServerSettingsForOperation("agentConfigSave", {
      run_limits: {
        max_running_agents: maxAgents,
        max_shells_per_agent: maxShells,
      },
      runtime_profiles: profiles,
      agent_registry: { agents },
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
    if (agentRunOperationBusy()) return
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
    markOperationStarted("agentRunSubmit", "saving")
    setAgentRunError("")
    setAgentRun(undefined)
    setAgentRunEvents([])
    stopAgentRunPolling()
    settingsMessages.submitAgentRun(vscode, {
        agent_id: agentId,
        source: "manual",
        issue_id: `manual-smoke-${Date.now()}`,
        prompt,
        metadata: {
          agent_run_source: "manual",
          workspace_root: server.workspaceDirectory() || "",
        },
    })
  }

  const cancelAgentRunTest = () => {
    if (agentRunOperationBusy()) return
    const taskId = selectedAgentRunId()
    if (!taskId) return
    markOperationStarted("agentRunCancel", "saving")
    settingsMessages.cancelAgentRun(vscode, {
      agent_run_id: taskId,
      reason: "user_cancelled",
    })
  }

  const retryAgentRunTest = (resumeSession = false) => {
    if (agentRunOperationBusy()) return
    const taskId = selectedAgentRunId()
    if (!taskId) return
    setAgentRunSubmitting(true)
    markOperationStarted("agentRunRetry", "saving")
    setAgentRunEvents([])
    stopAgentRunPolling()
    settingsMessages.retryAgentRun(vscode, {
      agent_run_id: taskId,
      new_agent_run_id: `${taskId}-retry-${Date.now()}`,
      resume_session: resumeSession === true,
    })
  }

  function refreshOperation(key: SettingsOperationKey, options: RefreshOperationOptions = {}) {
    if (options.skip?.includes(key)) return
    const mode = options.mode || "foreground"
    const completeWithoutRequest = () => {
      if (mode === "background") clearBackgroundRefresh(key)
      else markOperationSuccess(key)
    }

    if (key === "accounts") {
      if (mode === "foreground") {
        if (operationBusy(key)) return
        markOperationStarted(key, "loading")
      }
    } else if (key === "providerModels") {
      if (mode === "background" || providerModelRefreshBusy()) return
    } else {
      const shouldMarkForeground = settingsRefreshShouldMarkForeground(
        operationStates(),
        backgroundRefreshes(),
        key,
        mode,
      )
      const shouldSendRequest = settingsRefreshShouldSendRequest(
        operationStates(),
        backgroundRefreshes(),
        key,
        mode,
      )
      if (shouldMarkForeground) markOperationStarted(key, "loading")
      if (!shouldSendRequest) return
      if (mode === "background") markBackgroundRefreshStarted(key)
    }

    switch (key) {
      case "providers":
        settingsMessages.readProviders(vscode)
        return
      case "modelProfiles":
        settingsMessages.readModelProfiles(vscode)
        return
      case "chatConfig":
        settingsMessages.readChatConfig(vscode)
        return
      case "github":
        settingsMessages.readGithubStatus(vscode)
        return
      case "serverSettings":
        if (pendingServerSettingsSaveKey()) {
          completeWithoutRequest()
          return
        }
        setServerSettingsBootstrapped(true)
        settingsMessages.readServerSettings(vscode)
        return
      case "autoApproval":
        settingsMessages.getAutoApproval(vscode)
        return
      case "reasoningDisplay":
        settingsMessages.getReasoningDisplay(vscode)
        return
      case "chatSendDuringRunMode":
        settingsMessages.getChatSendDuringRunMode(vscode)
        return
      case "peerDiagnosticsLogging":
        settingsMessages.getPeerDiagnosticsLogging(vscode)
        return
      case "toolDiagnostics":
        settingsMessages.readToolDiagnosticsStats(vscode)
        return
      case "modelCapabilities":
        settingsMessages.modelCapabilitiesStatus(vscode)
        return
      case "providerModels":
        if (!providerId() || !selectedProvider() || !adminUsable()) {
          markOperationSuccess(key)
          return
        }
        if (!beginProviderModelRead(providerId(), "正在获取模型列表...")) {
          markOperationSuccess(key)
        }
        return
      case "toolchains":
        setToolchainBootstrapped(true)
        settingsMessages.refreshToolchains(vscode)
        return
      case "environmentManifest":
        setEnvironmentBootstrapped(true)
        settingsMessages.refreshEnvironmentManifest(vscode)
        return
      case "authDevices":
        if (canManageDevices()) settingsMessages.listAuthDevices(vscode)
        else completeWithoutRequest()
        return
      case "authUsers":
        if (canManageUsers()) settingsMessages.listAuthUsers(vscode)
        else completeWithoutRequest()
        return
      case "authAudit":
        if (canReadAudit()) {
          settingsMessages.listAuthAudit(vscode, {
            limit: 100,
            event_type: auditEventType().trim() || undefined,
          })
        } else {
          completeWithoutRequest()
        }
        return
      case "accounts":
        if (!adminUsable()) {
          completeWithoutRequest()
          return
        }
        let requestedAccountResource = false
        if (canManageDevices()) refreshOperation("authDevices", options)
        requestedAccountResource = requestedAccountResource || canManageDevices()
        if (canManageUsers()) refreshOperation("authUsers", options)
        requestedAccountResource = requestedAccountResource || canManageUsers()
        if (canReadAudit()) refreshOperation("authAudit", options)
        requestedAccountResource = requestedAccountResource || canReadAudit()
        if (!requestedAccountResource) completeWithoutRequest()
        return
      default:
        completeWithoutRequest()
    }
  }

  function refreshPage(tab: SettingsTab, options: RefreshOperationOptions = {}) {
    for (const key of settingsPageOperationKeys(tab)) refreshOperation(key, options)
  }

  const updateServerSettingsForOperation = (key: SettingsOperationKey, payload: Record<string, unknown>) => {
    if (
      pendingServerSettingsSaveKey()
      || operationState("serverSettings").status === "loading"
      || backgroundRefreshBusy("serverSettings")
    ) return
    markOperationStarted(key, "saving")
    setPendingServerSettingsSaveKey(key)
    settingsMessages.updateServerSettings(vscode, payload)
  }

  const runProviderAdminAction = (
    key: SettingsOperationKey,
    intent: ModelActionIntent,
    action: () => void,
    status: Extract<SettingsOperationStatus, "loading" | "saving"> = "saving",
  ) => {
    if (!settingsOperationUsesProviderActionResult(key)) return
    if (settingsOperationIsProviderWrite(key) && providerWriteBusy()) return
    if (!settingsOperationIsProviderWrite(key) && operationBusy(key)) return
    addPendingProviderActionKey(key)
    markOperationStarted(key, status)
    setActionIntent(intent)
    action()
  }

  const refreshExecutorStatus = () => {
    if (refreshLoading()) return
    setRefreshLoading(true)
    settingsMessages.getExecutorType(vscode)
    settingsMessages.readChatConfig(vscode)
    setTimeout(() => setRefreshLoading(false), 250)
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
    settingsMessages.saveExecutorType(vscode, pickerLocation(), pickerEngine())
  }

  const refreshEnvironmentManifest = () => refreshOperation("environmentManifest")
  const environmentRunItems = (entryIds?: string[]) => {
    const selected = entryIds?.length
      ? toolchainDashboardItems().filter((item) => entryIds.includes(item.id))
      : toolchainDashboardItems()
    return selected
      .filter((item) => item.kind === "environment_requirement")
      .map((item) => ({
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

  const refreshServerSettings = () => refreshOperation("serverSettings")
  const refreshModelCapabilities = () => {
    if (operationBusy("modelCapabilities")) return
    markOperationStarted("modelCapabilities", "loading")
    settingsMessages.modelCapabilitiesRefresh(vscode)
  }
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
    updateServerSettingsForOperation(
      "serverSettingsSave",
      serverAgentRunSettingsPayload(maxAgents, maxShells)
    )
  }
  const startCapabilityPackageIngest = () => {
    if (capabilityIngestOperationBusy()) return
    const sourceType = capabilitySourceType()
    const url = capabilitySourceUrl().trim()
    const notes = capabilitySourceNotes().trim()
    if (sourceType !== "project_notes" && !url) return
    if (sourceType === "project_notes" && !notes) return
    setCapabilityPackageIngestState({
      running: true,
      agentRunId: "",
      status: "starting",
      error: "",
    })
    markOperationStarted("capabilityIngestStart", "saving")
    settingsMessages.startCapabilityPackageIngest(vscode, {
      source: {
        type: sourceType,
        url,
        notes,
        package_id_hint: capabilityPackageIdHint().trim(),
      },
    })
  }
  const refreshCapabilityPackageIngestStatus = () => {
    const agentRunId = capabilityPackageIngestState().agentRunId
    if (!agentRunId) return
    if (operationBusy("capabilityIngestStatus")) return
    markOperationStarted("capabilityIngestStatus", "loading")
    settingsMessages.capabilityPackageIngestStatus(vscode, agentRunId)
  }
  const acceptCapabilityPackageDraft = () => {
    const draft = capabilityPackageIngestState().draft
    if (!draft) return
    settingsMessages.acceptCapabilityPackageDraft(vscode, draft)
  }
  const deleteCapabilityPackage = (packageId: string) => {
    if (!packageId || packageId === "environment") return
    settingsMessages.deleteCapabilityPackage(vscode, packageId)
  }
  const enableCapabilityPackage = (packageId: string, enabled: boolean) => {
    if (!packageId) return
    settingsMessages.enableCapabilityPackage(vscode, packageId, enabled)
  }
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
    settingsMessages.replyApproval(vscode, {
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

  const requestProviderModels = (message = "正在获取模型列表..."): boolean => {
    const id = providerId()
    if (!id || !selectedProvider() || !adminUsable()) return false
    if (providerModelRefreshBusy(id)) return false
    return beginProviderModelRead(id, message)
  }

  const saveConnection = () => {
    const validation = validateHostUrlInput(hostUrl())
    if (!validation.ok) {
      setHostUrlError(validation.error)
      setHostUrlDirty(true)
      setPendingHostSave(undefined)
      return
    }
    markOperationStarted("connectionSave", "saving")
    const requestedHostUrl = validation.value
    setHostUrl(requestedHostUrl)
    setPendingHostSave(requestedHostUrl)
    setHostUrlError(undefined)
    setDismissedConnectionSaveResultKey(undefined)
    settingsMessages.loginConnection(vscode, {
      hostUrl: requestedHostUrl,
      username: loginUsername(),
      password: loginPassword(),
    })
    setLoginPassword("")
  }

  const logoutConnection = () => {
    settingsMessages.logoutConnection(vscode)
  }

  const refreshAuthDevices = () => refreshOperation("authDevices")
  const refreshAuthUsers = () => {
    refreshOperation("authUsers")
  }
  const refreshAuthAudit = () => {
    refreshOperation("authAudit")
  }
  const refreshAccounts = () => {
    refreshOperation("accounts")
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
    setModelSearch("")
    loadProviderModelCache(provider)
    setModelDetailOpen(false)
    setCustomModelDialogOpen(false)
  }

  const saveProvider = () => {
    runProviderAdminAction("providerSave", "", () => {
      settingsMessages.recordProvider(vscode, {
        provider_id: providerId(),
        type: providerType(),
        compat: providerCompat(),
        base_url: providerBaseUrl(),
        api_key: providerApiKey() || undefined,
        enabled: providerEnabled(),
      })
    })
  }

  const testProvider = (model = providerModel()) => {
    const modelId = model.trim()

    if (!modelId) return
    setProviderModel(modelId)
    runProviderAdminAction("providerTest", "", () => {
      settingsMessages.testProvider(vscode, {
        provider_id: providerId(),
        model: modelId,
        prompt: "ping",
      })
    }, "loading")
  }

  const copyProvider = () => {
    runProviderAdminAction("providerCopy", "", () => {
      settingsMessages.copyProvider(vscode, {
        provider_id: providerId(),
        target_id: providerCopyId() || undefined,
      })
    })
  }

  const deleteProvider = () => {
    const id = providerId()
    if (!id) return
    if (!window.confirm(`删除服务商 "${id}"？已有保存预设引用时后端会阻止删除。`)) return
    runProviderAdminAction("providerDelete", "", () => {
      settingsMessages.deleteProvider(vscode, id)
    })
  }

  const toggleProviderEnabled = (enabled: boolean) => {
    if (providerWriteBusy()) return
    setProviderEnabled(enabled)
    runProviderAdminAction("providerEnable", "", () => {
      settingsMessages.enableProvider(vscode, providerId(), enabled)
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
    runProviderAdminAction("modelProfileSave", "savePreset", () => {
      settingsMessages.saveModelProfile(vscode, {
        profile_id: nextProfileId,
        provider,
        model,
        max_tokens: maxTokens(),
        max_context_tokens: maxContextTokens(),
        temperature: temperature(),
        reasoning_effort: reasoningEffort() || undefined,
        thinking_enabled: thinkingEnabled(),
        capability_user_configured: !usesCapabilityDefaults,
      })
    })
  }

  const deleteModelPreset = (profileIdOverride = profileId()) => {
    const id = profileIdOverride.trim()
    if (!id || providerWriteBusy()) return
    if (!window.confirm(`移除预设 "${id}"？只删除模型预设，不删除服务商模型目录。`)) return
    setProviderValidationError("")
    runProviderAdminAction("modelProfileDelete", "deletePreset", () => {
      settingsMessages.deleteModelProfile(vscode, id)
    })
    setModelDetailOpen(false)
  }

  const deleteModelPresetByModel = (modelId: string) => {
    const provider = providerId()
    const existing = profiles().find((profile) => profileMatches(profile, provider, modelId))
    const id = existing ? stringValue(existing.id || existing.profile_id) : ""
    deleteModelPreset(id)
  }

  const visitedSettingsTabs = new Set<SettingsTab>()

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
    const tab = activeTab()
    if (visitedSettingsTabs.has(tab)) return
    visitedSettingsTabs.add(tab)
    refreshPage(tab, { mode: "background" })
  })

  createEffect(() => {
    if (activeTab() !== "toolchains") return
    if (!toolchainBootstrapped()) {
      setToolchainBootstrapped(true)
      refreshOperation("toolchains", { mode: "background" })
    }
    if (!environmentBootstrapped()) {
      setEnvironmentBootstrapped(true)
      refreshOperation("environmentManifest", { mode: "background" })
    }
  })

  createEffect(() => {
    if (activeTab() !== "serverSettings") return
    if (!serverSettingsBootstrapped()) {
      setServerSettingsBootstrapped(true)
      refreshOperation("serverSettings", { mode: "background" })
    }
  })

  createEffect(() => {
    if (activeTab() !== "accounts") return
    if (!adminUsable()) return
    if (accountsBootstrapped()) return
    setAccountsBootstrapped(true)
    refreshOperation("accounts", { mode: "background" })
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
    if (resolved.error) markOperationError("connectionSave", resolved.error)
    else markOperationSuccess("connectionSave")
    const loginSucceeded = stringValue(result.status) === "ready" && result.authenticated === true
    if (loginSucceeded) {
      setTimeout(() => {
        setOperationStates((states) => markSettingsOperationIdle(states, "connectionSave"))
      }, 1500)
    }
    setPendingHostSave(undefined)
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
      const models = normalizeProviderModelEntries(result.models)
      setFetchedModels(models)
      setModelFetchMessage(providerModelRefreshMessage(models))
    }
    if (result?.unsupported === true && result?.provider_id === providerId()) {
      setFetchedModels([])
      setModelFetchMessage(stringValue(result.message, "当前服务商无法自动获取模型列表，请使用“自定义模型名”。"))
    }
  })

  onMount(() => {
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

  const operations = {
    state: operationState,
    isBusy: operationBusy,
    error: operationError,
    markStarted: markOperationStarted,
    markSuccess: markOperationSuccess,
    markError: markOperationError,
    refresh: refreshOperation,
  }

  const saveConversationSettings = (payload: Record<string, unknown>) =>
    updateServerSettingsForOperation("conversationSave", payload)
  const saveSessionPolicySettings = (payload: Record<string, unknown>) =>
    updateServerSettingsForOperation("sessionPolicySave", payload)
  const saveAutoApprovalServerSettings = (payload: Record<string, unknown>) =>
    updateServerSettingsForOperation("autoApprovalSave", payload)
  const saveIntegrationsSettings = (payload: Record<string, unknown>) =>
    updateServerSettingsForOperation("integrationsSave", payload)
  const saveInfrastructureSettings = (payload: Record<string, unknown>) =>
    updateServerSettingsForOperation("serverSettingsSave", payload)
  const saveToolchainsCapabilitySettings = (payload: Record<string, unknown>) =>
    updateServerSettingsForOperation("toolchainsCapabilitySave", payload)
  const saveDiagnosticsSettings = (payload: Record<string, unknown>) =>
    updateServerSettingsForOperation("diagnosticsSave", payload)
  const saveCapabilitySyncSettings = (payload: Record<string, unknown>) =>
    updateServerSettingsForOperation("capabilitySyncSave", payload)
  const saveReasoningDisplay = (defaultOpen: boolean) => {
    markOperationStarted("reasoningDisplay", "saving")
    settingsMessages.saveReasoningDisplay(vscode, defaultOpen)
  }
  const updateChatSendDuringRunMode = (mode: "guide" | "queue") => {
    markOperationStarted("chatSendDuringRunMode", "saving")
    settingsMessages.updateChatSendDuringRunMode(vscode, mode)
  }
  const savePeerDiagnosticsLogging = (payload: Record<string, unknown>) => {
    markOperationStarted("peerDiagnosticsLogging", "saving")
    settingsMessages.savePeerDiagnosticsLogging(vscode, payload)
  }
  const openPeerDiagnosticsLog = () => settingsMessages.openPeerDiagnosticsLog(vscode)
  const clearPeerDiagnosticsLog = () => settingsMessages.clearPeerDiagnosticsLog(vscode)
  const readToolDiagnosticsStats = () => refreshOperation("toolDiagnostics")
  const refreshToolchains = () => {
    refreshOperation("toolchains")
    refreshOperation("environmentManifest")
  }
  const recordToolchain = (kind: string, payload: Record<string, unknown>) => {
    markOperationStarted("toolchains", "saving")
    settingsMessages.recordToolchain(vscode, kind, payload)
  }
  const enableToolchain = (kind: string, name: string, enabled: boolean) => {
    markOperationStarted("toolchains", "saving")
    settingsMessages.enableToolchain(vscode, kind, name, enabled)
  }
  const deleteToolchainRecord = (kind: string, name: string) => {
    markOperationStarted("toolchains", "saving")
    settingsMessages.deleteToolchain(vscode, kind, name)
  }

  return {
    vscode,
    operations,
    refreshPage,
    pageRefreshing,
    serverSettingsSaveBusy,
    providerWriteBusy,
    providerModelRefreshBusy,
    providerActionResultBusy,
    server,
    activeTab,
    setActiveTab,
    switchTab,
    setConversationLocale,
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
    saveLoading: () => operationBusy("connectionSave"),
    saveSuccess: () => operationState("connectionSave").status === "success",
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
    capabilitySourceType,
    setCapabilitySourceType,
    capabilitySourceUrl,
    setCapabilitySourceUrl,
    capabilitySourceNotes,
    setCapabilitySourceNotes,
    capabilityPackageIdHint,
    setCapabilityPackageIdHint,
    capabilityPackageIngestState,
    setCapabilityPackageIngestState,
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
    agentRunSubmitting: () => agentRunSubmitting() || agentRunOperationBusy(),
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
    providerListEmptyMessage,
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
    behaviorCatalog,
    toolchainBehaviorError,
    chatCommandCatalogItems,
    mentionProviderCatalogItems,
    uiActionCatalogItems,
    agentToolCatalogItems,
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
    refreshExecutorStatus,
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
    saveConversationSettings,
    saveSessionPolicySettings,
    saveAutoApprovalServerSettings,
    saveIntegrationsSettings,
    saveInfrastructureSettings,
    saveToolchainsCapabilitySettings,
    saveDiagnosticsSettings,
    saveCapabilitySyncSettings,
    saveReasoningDisplay,
    updateChatSendDuringRunMode,
    savePeerDiagnosticsLogging,
    openPeerDiagnosticsLog,
    clearPeerDiagnosticsLog,
    readToolDiagnosticsStats,
    refreshToolchains,
    recordToolchain,
    enableToolchain,
    deleteToolchainRecord,
    startCapabilityPackageIngest,
    refreshCapabilityPackageIngestStatus,
    acceptCapabilityPackageDraft,
    deleteCapabilityPackage,
    enableCapabilityPackage,
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
    deleteModelPreset,
    deleteModelPresetByModel,
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
    toolchainStatusBucket,
    runtimeOptionDescription,
  }
}

export type SettingsController = ReturnType<typeof createSettingsController>
