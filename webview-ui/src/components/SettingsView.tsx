import { Component, For, JSX, Show, createEffect, createMemo, createSignal, onCleanup, onMount, untrack } from "solid-js"
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
  resolveNewAgentRuntimeProfile,
  toggleAgentConfigListValue,
  validateAgentConfigId,
} from "../utils/agent-config"
import { t, locale, setLocale, LOCALES, type Locale } from "../i18n"
import {
  ApprovalDetailsDialog,
  DEFAULT_AUTO_APPROVE_OPTIONS,
  approvalFromPayload,
  approvalSummary,
  type ApprovalDecision,
  type ApprovalDetails,
} from "./chat/ApprovalDetailsDialog"

type ProviderType = "openai_chat" | "anthropic_messages" | "openai_responses"
type ProviderCompat = "generic" | "deepseek" | "kimi" | "glm" | "qwen" | "zenmux"
type SettingsTab = "executors" | "providers" | "toolchains" | "serverSettings" | "agentConfig" | "autoApproval" | "other"

/** 主执行器运行位置 */
type ExecutorLocation = "local" | "remote"

/** 执行器引擎类型 */
type ExecutorEngine = "ezcode" | "claude" | "codex" | "gemini" | "astrbot"

interface ExecutorEngineOption {
  id: ExecutorEngine
  label: string
  icon: string
  description: string
  ready: boolean
}

const EXECUTOR_ENGINES: ExecutorEngineOption[] = [
  { id: "ezcode",  label: "EZCode",  icon: "radio-tower",  description: "dogcode 执行器",        ready: true  },
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
type ModelTarget = "main" | "sub" | "both"
type ModelDetailMode = "fetched" | "custom"
type ModelActionIntent = "" | "savePreset" | "activateMain" | "activateSub" | "activateBoth"
type EnvironmentEntryKind = "cli" | "mcp" | "skill"
type ToolchainKind = EnvironmentEntryKind
type ToolchainKindFilter = "all" | ToolchainKind
type ToolchainStatusFilter = "all" | "ready" | "missing" | "stopped" | "awaiting"
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

interface SettingsViewProps {
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
  capabilities?: string[]
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

interface ToolchainEditorState {
  mode: "create" | "edit"
  kind: ToolchainKind
  name: string
  enabled: boolean
  command: string
  capabilitiesText: string
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
  runtime_profile: string
  capabilitiesText: string
  systemAppend: string
  agentMd: string
  mcpServersText: string
  skillsText: string
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
const AGENT_CAPABILITY_OPTIONS: RuntimeOption[] = [
  { value: "read_repo", labelKey: "agentConfig.agent.capability.readRepo", descKey: "agentConfig.agent.capability.readRepo.desc" },
  { value: "code_review", labelKey: "agentConfig.agent.capability.codeReview", descKey: "agentConfig.agent.capability.codeReview.desc" },
  { value: "edit_code", labelKey: "agentConfig.agent.capability.editCode", descKey: "agentConfig.agent.capability.editCode.desc" },
  { value: "run_tests", labelKey: "agentConfig.agent.capability.runTests", descKey: "agentConfig.agent.capability.runTests.desc" },
  { value: "open_pr", labelKey: "agentConfig.agent.capability.openPr", descKey: "agentConfig.agent.capability.openPr.desc" },
  { value: "use_mcp", labelKey: "agentConfig.agent.capability.useMcp", descKey: "agentConfig.agent.capability.useMcp.desc" },
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
    runtime_profile: "",
    capabilitiesText: "",
    systemAppend: "",
    agentMd: "",
    mcpServersText: "",
    skillsText: "",
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
  const mcp = objectValue(agent.mcp)
  return {
    id,
    name: stringValue(agent.name),
    description: stringValue(agent.description),
    runtime_profile: stringValue(agent.runtime_profile),
    capabilitiesText: stringArray(agent.capabilities).join(", "),
    systemAppend: stringValue(prompt.system_append),
    agentMd: stringValue(prompt.agent_md),
    mcpServersText: stringArray(mcp.servers).join("\n"),
    skillsText: stringArray(agent.skills).join(", "),
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
  if (draft.model) payload.model = draft.model
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
  if (draft.runtime_profile) payload.runtime_profile = draft.runtime_profile
  const capabilities = parseAgentConfigListText(draft.capabilitiesText)
  if (capabilities.length) payload.capabilities = capabilities
  const prompt: Record<string, string> = {}
  if (draft.systemAppend) prompt.system_append = draft.systemAppend
  if (draft.agentMd) prompt.agent_md = draft.agentMd
  if (Object.keys(prompt).length) payload.prompt = prompt
  const mcpServers = parseAgentConfigListText(draft.mcpServersText)
  if (mcpServers.length) payload.mcp = { servers: mcpServers }
  const skills = parseAgentConfigListText(draft.skillsText)
  if (skills.length) payload.skills = skills
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
  { id: "toolchains", labelKey: "settings.tab.toolchains", icon: "tools" },
  { id: "serverSettings", labelKey: "settings.tab.serverSettings", icon: "server-environment" },
  { id: "agentConfig", labelKey: "settings.tab.agentConfig", icon: "hubot" },
  { id: "autoApproval", labelKey: "settings.tab.autoApproval", icon: "shield" },
  { id: "other", labelKey: "settings.tab.other", icon: "settings" },
]

function normalizeSettingsTab(value: unknown): SettingsTab | undefined {
  switch (value) {
    case "providers":
      return "providers"
    case "executors":
      return "executors"
    case "toolchains":
      return "toolchains"
    case "serverSettings":
      return "serverSettings"
    case "agentConfig":
      return "agentConfig"
    case "autoApproval":
      return "autoApproval"
    case "other":
      return "other"
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
    capabilitiesText: "",
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
    capabilitiesText: stringListText(record.capabilities),
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
    payload.capabilities = parseStringList(editor.capabilitiesText)
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

function uniqueCommandRules(values: string[]): string[] {
  const seen = new Set<string>()
  const rules: string[] = []
  for (const value of values) {
    const rule = value.trim().replace(/\s+/g, " ")
    if (!rule || seen.has(rule.toLowerCase())) continue
    seen.add(rule.toLowerCase())
    rules.push(rule)
  }
  return rules
}

function sanitizeAutoApproveOptions(value: unknown): Record<string, boolean> {
  const raw = objectValue(value)
  return Object.keys(DEFAULT_AUTO_APPROVE_OPTIONS).reduce<Record<string, boolean>>((options, key) => {
    options[key] = raw[key] === true
    return options
  }, {})
}

function makeProfileId(providerId: string, modelId: string): string {
  return `${providerId}-${modelId}`.replace(/[^a-zA-Z0-9_.-]+/g, "-")
}

function profileMatches(profile: Record<string, unknown>, providerId: string, modelId: string): boolean {
  return stringValue(profile.provider) === providerId && stringValue(profile.model) === modelId
}

function targetLabel(target: ModelTarget): string {
  if (target === "main") return "主模型"
  if (target === "sub") return "副模型"
  return "主+副模型"
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
  modelName: string,
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
    const resolvedModelName = stringValue(profile.model, modelName)
    if (intent === "savePreset") {
      return presetId ? `预设 ${presetId} 已保存。` : "模型预设已保存。"
    }
    if (intent === "activateMain") {
      return resolvedModelName ? `${resolvedModelName} 已设为主模型。` : "主模型已更新。"
    }
    if (intent === "activateSub") {
      return resolvedModelName ? `${resolvedModelName} 已设为副模型。` : "副模型已更新。"
    }
    if (intent === "activateBoth") {
      return resolvedModelName ? `${resolvedModelName} 已设为主+副模型。` : "主/副模型已更新。"
    }
  }
  if (result.profile_id && result.target) {
    return `预设 ${String(result.profile_id)} 已设为 ${targetLabel(result.target as ModelTarget)}。`
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
  if (result.hostUrlMigratedFromEzcode === true) {
    const legacyHost = stringValue(result.legacyHostUrl, effective)
    return `已从 EZCode 旧配置迁移到 dogcode：${legacyHost}。当前实际请求 Host：${effective}（来源：${source}）。`
  }
  if (requested && (result.hostUrlSaveApplied !== true || effective !== requested)) {
    return `保存未生效：请求保存 ${requested}，当前实际请求 Host 仍是 ${effective || "未配置"}（来源：${source}）。`
  }
  if (requested) {
    return `已生效：${effective}（来源：${source}）。`
  }
  return undefined
}

function connectionSaveResultKey(result: Record<string, unknown> | undefined): string | undefined {
  if (!result) return undefined
  return [
    stringValue(result.hostUrlSaveRequested),
    stringValue(result.hostUrl),
    stringValue(result.hostUrlSaveApplied),
    stringValue(result.message),
  ].join("|")
}

const StatusBadge: Component<{ tone?: "success" | "warning" | "muted" | "error"; children: JSX.Element }> = (props) => {
  return <span class={`settings-badge settings-badge--${props.tone || "muted"}`}>{props.children}</span>
}

const SettingsView: Component<SettingsViewProps> = (props) => {
  const vscode = useVSCode()
  const server = useServer()

  const [activeTab, setActiveTab] = createSignal<SettingsTab>("providers")

  /* ── 主执行器选择器状态 ── */
  const [executorPickerOpen, setExecutorPickerOpen] = createSignal(false)
  const [pickerLocation, setPickerLocation] = createSignal<ExecutorLocation>("remote")
  const [pickerEngine, setPickerEngine] = createSignal<ExecutorEngine>("ezcode")

  /* ── 按钮 loading 状态 ── */
  const [refreshLoading, setRefreshLoading] = createSignal(false)
  const [saveLoading, setSaveLoading] = createSignal(false)
  const [saveSuccess, setSaveSuccess] = createSignal(false)

  const [hostUrl, setHostUrl] = createSignal("")
  const [adminSecret, setAdminSecret] = createSignal("")
  const [bootstrapSecret, setBootstrapSecret] = createSignal("")
  const [hostUrlDirty, setHostUrlDirty] = createSignal(false)
  const [pendingHostSave, setPendingHostSave] = createSignal<string | undefined>()
  const [hostUrlError, setHostUrlError] = createSignal<string | undefined>()
  const [hostUrlSyncLock, setHostUrlSyncLock] = createSignal<string | undefined>()
  const [dismissedConnectionSaveResultKey, setDismissedConnectionSaveResultKey] = createSignal<string | undefined>()

  const [providerId, setProviderId] = createSignal("deepseek")
  const [providerType, setProviderType] = createSignal<ProviderType>("openai_chat")
  const [providerCompat, setProviderCompat] = createSignal<ProviderCompat>("deepseek")
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
  const [runtimeTask, setRuntimeTask] = createSignal<Record<string, unknown> | undefined>()
  const [runtimeEvents, setRuntimeEvents] = createSignal<Record<string, unknown>[]>([])
  const [runtimeError, setRuntimeError] = createSignal("")
  const [runtimeSubmitting, setRuntimeSubmitting] = createSignal(false)
  const [runtimePolling, setRuntimePolling] = createSignal(false)
  let profileExecutorSelect: HTMLSelectElement | undefined
  let agentNameInput: HTMLInputElement | undefined
  const [runtimePrompt, setRuntimePrompt] = createSignal("请用一句话回复 EZCode runtime smoke")

  const [profileId, setProfileId] = createSignal("")
  const [profileProvider, setProfileProvider] = createSignal("deepseek")
  const [profileModel, setProfileModel] = createSignal("")
  const [maxTokens, setMaxTokens] = createSignal(4096)
  const [maxContextTokens, setMaxContextTokens] = createSignal(128000)
  const [temperature, setTemperature] = createSignal(0)
  const [reasoningEffort, setReasoningEffort] = createSignal("")
  const [thinkingEnabled, setThinkingEnabled] = createSignal(true)

  const providers = createMemo(() => {
    const items = server.adminState().providers
    return Array.isArray(items) ? items as Record<string, unknown>[] : []
  })
  const profiles = createMemo(() => {
    const items = server.adminState().model_profiles
    return Array.isArray(items) ? items as Record<string, unknown>[] : []
  })
  const activeMain = createMemo(() => stringValue(server.adminState().active_main, "-"))
  const activeSub = createMemo(() => stringValue(server.adminState().active_sub, "-"))
  const activeMainProfile = createMemo(() => profiles().find((profile) => stringValue(profile.id) === activeMain()))
  const activeSubProfile = createMemo(() => profiles().find((profile) => stringValue(profile.id) === activeSub()))
  const selectedProviderProfiles = createMemo(() =>
    profiles().filter((profile) => stringValue(profile.provider) === providerId())
  )
  const selectedProvider = createMemo(() =>
    providers().find((provider) => stringValue(provider.id) === providerId())
  )
  const filteredFetchedModels = createMemo(() => {
    const query = modelSearch().trim().toLowerCase()
    if (!query) return fetchedModels()
    return fetchedModels().filter((model) => model.id.toLowerCase().includes(query))
  })
  const actionFeedback = createMemo(() =>
    formatActionResult(server.actionResult(), actionIntent(), profileModel())
  )
  const providerErrorMessage = createMemo(() => {
    const message = server.adminError()
    if (!message) return undefined
    if (message.includes("config_reload_failed")) {
      return `${message}。保存已回滚，host 配置未生效。`
    }
    return message
  })
  const connectionStatus = createMemo(() => stringValue(server.connectionState().status, "missing-config"))
  const connectionMessage = createMemo(() => stringValue(server.connectionState().message))
  const connectionMigrationMessage = createMemo(() => {
    const state = server.connectionState()
    if (state.hostUrlMigratedFromEzcode !== true) return undefined
    const legacyHost = stringValue(state.legacyHostUrl, stringValue(state.hostUrl))
    const source = stringValue(state.legacyHostUrlSource, stringValue(state.hostUrlSource, "unknown"))
    return `已从 EZCode 旧配置迁移到 dogcode：${legacyHost}（来源：${source}）。`
  })
  const connectionSaveMessage = createMemo(() => {
    const result = server.connectionSaveResult()
    const key = connectionSaveResultKey(result)
    if (key && key === dismissedConnectionSaveResultKey()) return undefined
    return formatConnectionSaveResult(result)
  })
  const currentHostUrl = createMemo(() => stringValue(server.connectionState().hostUrl))
  const hostUrlSource = createMemo(() => stringValue(server.connectionState().hostUrlSource, "unknown"))
  const hostUrlConfigured = createMemo(() => server.connectionState().hostUrlConfigured === true)
  const adminUsable = createMemo(() => server.connectionState().adminReachable === true)
  const hostUrlDraftDiffers = createMemo(() => {
    const draft = normalizeHostUrlInput(hostUrl())
    const effective = currentHostUrl()
    return Boolean(draft && effective && draft !== effective)
  })
  const isDefaultLocalHost = createMemo(() => {
    const host = currentHostUrl()
    return !hostUrlConfigured() && (host === "http://127.0.0.1:8765" || host === "http://localhost:8765")
  })
  const currentDetailHasSavedPreset = createMemo(() =>
    selectedProviderProfiles().some((profile) => profileMatches(profile, profileProvider(), profileModel()))
  )
  const currentDetailIsMain = createMemo(() =>
    selectedProviderProfiles().some((profile) =>
      profileMatches(profile, profileProvider(), profileModel()) && stringValue(profile.id) === activeMain()
    )
  )
  const currentDetailIsSub = createMemo(() =>
    selectedProviderProfiles().some((profile) =>
      profileMatches(profile, profileProvider(), profileModel()) && stringValue(profile.id) === activeSub()
    )
  )
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
      runtime: objectValue(admin.agent_runtime),
    }
  })
  const agentRuntimeSettings = createMemo(() =>
    objectValue(objectValue(serverSettingsPayload().settings).agent_runtime)
  )
  const agentRuntimeState = createMemo(() =>
    objectValue(serverSettingsPayload().runtime || server.adminState().agent_runtime)

  )  /* ── Agent 配置 computed ── */
  const agentRuntimeProfiles = createMemo(() => {
    const settings = agentRuntimeSettings()
    const profiles = objectValue(settings.runtime_profiles)
    return Object.entries(profiles).map(([id, value]) => ({
      id,
      ...(typeof value === "object" && value ? value as Record<string, unknown> : {}),
    }))
  })
  const agentRuntimeAgents = createMemo(() => {
    const settings = agentRuntimeSettings()
    const agents = objectValue(settings.agents)
    return Object.entries(agents).map(([id, value]) => ({
      id,
      ...(typeof value === "object" && value ? value as Record<string, unknown> : {}),
    }))
  })
  const registeredMcpServers = createMemo(() => {
    const groups = toolchainGroups()
    return groups.mcp.map((item) => item.name)
  })
  const profileIdList = createMemo(() => Object.keys(profileDrafts()))
  const currentProfileDraft = createMemo(() => profileDrafts()[selectedProfileId()])
  const currentAgentDraft = createMemo(() => agentDrafts()[selectedAgentId()])
  const savedProfileIdSet = createMemo(() => new Set(agentRuntimeProfiles().map((profile) => profile.id)))
  const savedAgentIdSet = createMemo(() => new Set(agentRuntimeAgents().map((agent) => agent.id)))
  const currentProfileIdLocked = createMemo(() => savedProfileIdSet().has(selectedProfileId()))
  const currentAgentIdLocked = createMemo(() => savedAgentIdSet().has(selectedAgentId()))
  const runtimeModelOptions = createMemo(() => {
    const seen = new Set<string>()
    const result: Array<{ value: string; label: string; detail: string }> = []
    for (const profile of profiles()) {
      const model = stringValue(profile.model)
      if (!model || seen.has(model)) continue
      seen.add(model)
      const id = stringValue(profile.id)
      const provider = stringValue(profile.provider)
      const marks = [
        id === activeMain() ? t("agentConfig.profile.model.activeMain") : "",
        id === activeSub() ? t("agentConfig.profile.model.activeSub") : "",
      ].filter(Boolean)
      result.push({
        value: model,
        label: model,
        detail: [provider, id, ...marks].filter(Boolean).join(" / "),
      })
    }
    const current = currentProfileDraft()?.model.trim()
    if (current && !seen.has(current)) {
      result.push({
        value: current,
        label: current,
        detail: t("agentConfig.profile.model.currentCustom"),
      })
    }
    return result
  })
  const skillNameOptions = createMemo(() =>
    toolchainGroups().skill.map((item) => item.name).filter(Boolean)
  )
  const profileMcpValidationWarnings = createMemo(() => {
    const draft = currentProfileDraft()
    if (!draft) return []
    const registered = registeredMcpServers()
    return draft.mcpServersText.split("\n").map((s) => s.trim()).filter(Boolean)
      .filter((name) => !registered.includes(name))
  })
  const agentMcpValidationWarnings = createMemo(() => {
    const draft = currentAgentDraft()
    if (!draft) return []
    const registered = registeredMcpServers()
    return draft.mcpServersText.split("\n").map((s) => s.trim()).filter(Boolean)
      .filter((name) => !registered.includes(name))
  })
  const selectedRuntimeTaskId = createMemo(() => stringValue(runtimeTask()?.id))
  const runtimeLastSeq = createMemo(() =>
    runtimeEvents().reduce((max, event) => Math.max(max, numberValue(event.seq, 0)), 0)
  )
  const runtimeTerminal = createMemo(() =>
    runtimeEvents().some((event) => ["completed", "failed", "cancelled", "canceled"].includes(stringValue(event.type)))
  )
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

  const modelProfilesFor = (modelId: string) =>
    selectedProviderProfiles().filter((profile) => profileMatches(profile, providerId(), modelId))

  const openModelDetail = (modelId: string, mode: ModelDetailMode) => {
    const existing = profiles().find((profile) => profileMatches(profile, providerId(), modelId))
    setModelDetailMode(mode)
    setProviderModel(modelId)
    if (existing) {
      setProfileId(stringValue(existing.id))
      setProfileProvider(stringValue(existing.provider))
      setProfileModel(stringValue(existing.model))
      setMaxTokens(numberValue(existing.max_tokens, 4096))
      setMaxContextTokens(numberValue(existing.max_context_tokens, 128000))
      setTemperature(numberValue(existing.temperature, 0))
      setReasoningEffort(stringValue(existing.reasoning_effort))
      setThinkingEnabled(existing.thinking_enabled !== false)
    } else {
      setProfileId(makeProfileId(providerId(), modelId))
      setProfileProvider(providerId())
      setProfileModel(modelId)
      setMaxTokens(4096)
      setMaxContextTokens(128000)
      setTemperature(0)
      setReasoningEffort("")
      setThinkingEnabled(true)
    }
    setModelDetailOpen(true)
    setCustomModelDialogOpen(false)
  }

  const openSavedPreset = (profile: Record<string, unknown>) => {
    const modelId = stringValue(profile.model)
    const hasFetchedModel = fetchedModels().some((item) => item.id === modelId)
    setModelDetailMode(hasFetchedModel ? "fetched" : "custom")
    setProviderModel(modelId)
    setProfileId(stringValue(profile.id))
    setProfileProvider(stringValue(profile.provider))
    setProfileModel(modelId)
    setMaxTokens(numberValue(profile.max_tokens, 4096))
    setMaxContextTokens(numberValue(profile.max_context_tokens, 128000))
    setTemperature(numberValue(profile.temperature, 0))
    setReasoningEffort(stringValue(profile.reasoning_effort))
    setThinkingEnabled(profile.thinking_enabled !== false)
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
    const profiles = agentRuntimeProfiles()
    const agents = agentRuntimeAgents()
    if (!agentConfigDirty()) {
      const pDrafts: Record<string, RuntimeProfileDraft> = {}
      for (const p of profiles) pDrafts[p.id] = profileToDraft(p.id, p)
      setProfileDrafts(pDrafts)
      const aDrafts: Record<string, AgentDefinitionDraft> = {}
      for (const a of agents) aDrafts[a.id] = agentToDraft(a.id, a)
      setAgentDrafts(aDrafts)
    }
  })

  let runtimePollTimer: ReturnType<typeof setInterval> | undefined

  const stopRuntimePolling = () => {
    if (runtimePollTimer) {
      clearInterval(runtimePollTimer)
      runtimePollTimer = undefined
    }
    setRuntimePolling(false)
  }

  const requestRuntimeEvents = (taskId: string, afterSeq = runtimeLastSeq()) => {
    if (!taskId) return
    vscode.postMessage({
      type: "runtime.events",
      payload: {
        task_id: taskId,
        after_seq: afterSeq,
      },
    })
  }

  const startRuntimePolling = (taskId: string) => {
    stopRuntimePolling()
    if (!taskId) return
    setRuntimePolling(true)
    requestRuntimeEvents(taskId, 0)
    runtimePollTimer = setInterval(() => requestRuntimeEvents(taskId), 1500)
  }

  onCleanup(stopRuntimePolling)

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
      if (msg.type === "runtime.task" && typeof msg.payload === "object" && msg.payload) {
        const payload = objectValue(msg.payload)
        const task = objectValue(payload.task)
        setRuntimeTask(task)
        setRuntimeEvents([])
        setRuntimeError("")
        setRuntimeSubmitting(false)
        startRuntimePolling(stringValue(task.id))
      }
      if (msg.type === "runtime.events" && typeof msg.payload === "object" && msg.payload) {
        const events = Array.isArray(objectValue(msg.payload).events)
          ? objectValue(msg.payload).events as Record<string, unknown>[]
          : []
        if (events.length) {
          setRuntimeEvents((current) => {
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
      if (msg.type === "runtime.cancelled" && typeof msg.payload === "object" && msg.payload) {
        setRuntimeError("")
        requestRuntimeEvents(selectedRuntimeTaskId())
      }
      if (msg.type === "runtime.error") {
        setRuntimeSubmitting(false)
        stopRuntimePolling()
        setRuntimeError(typeof msg.message === "string" ? msg.message : "Runtime request failed")
      }
    })
    onCleanup(unsubscribe)
  })

  createEffect(() => {
    if (runtimeTerminal()) stopRuntimePolling()
  })

const switchTab = (tab: SettingsTab) => {
    setActiveTab(tab)
    vscode.postMessage({ type: "settingsTabChanged", tab })
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
        agent_runtime_update_mode: "replace",
        agent_runtime: {
          max_running_agents: maxAgents,
          max_shells_per_agent: maxShells,
          runtime_profiles: profiles,
          agents,
        },
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
    draft.runtime_profile = resolveNewAgentRuntimeProfile(selectedProfileId(), profileIdList())
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

  const submitRuntimeAgentTask = () => {
    const agentId = selectedAgentId()
    if (!agentId) {
      setRuntimeError("请先选择一个 Agent。")
      return
    }
    const prompt = runtimePrompt().trim()
    if (!prompt) {
      setRuntimeError("请输入测试任务。")
      return
    }
    setRuntimeSubmitting(true)
    setRuntimeError("")
    setRuntimeTask(undefined)
    setRuntimeEvents([])
    stopRuntimePolling()
    vscode.postMessage({
      type: "runtime.submit",
      payload: {
        agent_id: agentId,
        issue_id: `manual-smoke-${Date.now()}`,
        prompt,
        metadata: {
          workspace_root: server.workspaceDirectory() || "",
        },
      },
    })
  }

  const cancelRuntimeAgentTask = () => {
    const taskId = selectedRuntimeTaskId()
    if (!taskId) return
    vscode.postMessage({
      type: "runtime.cancel",
      payload: {
        task_id: taskId,
        reason: "user_cancelled",
      },
    })
  }

  const retryRuntimeAgentTask = () => {
    const taskId = selectedRuntimeTaskId()
    if (!taskId) return
    setRuntimeSubmitting(true)
    setRuntimeEvents([])
    stopRuntimePolling()
    vscode.postMessage({
      type: "runtime.retry",
      payload: {
        task_id: taskId,
        new_task_id: `${taskId}-retry-${Date.now()}`,
      },
    })
  }

const refreshAdmin = () => {
    setRefreshLoading(true)
    vscode.postMessage({ type: "admin.refresh" })
    setTimeout(() => setRefreshLoading(false), 1200)
  }

  /* ── 主执行器相关 ── */
  const executorLocation = createMemo(() => {
    const loc = server.executorType().location
    return (loc === "local" || loc === "remote") ? loc as ExecutorLocation : "remote"
  })
  const executorEngine = createMemo(() => {
    const eng = server.executorType().engine
    const valid: ExecutorEngine[] = ["ezcode", "claude", "codex", "gemini", "astrbot"]
    return valid.includes(eng as ExecutorEngine) ? eng as ExecutorEngine : "ezcode"
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

  const refreshEnvironmentManifest = () => vscode.postMessage({ type: "environment.refreshManifest" })
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
    const request = {
      id: `environment-${mode}-${Date.now()}`,
      mode,
      executionMode:
        entryIds?.length === 1 ? "combined" : toolchainRunSerial() ? "serial" : "combined",
      items,
    } satisfies EnvironmentRunLaunchRequest
    if (props.onEnvironmentRun) {
      props.onEnvironmentRun(request)
    } else {
      vscode.postMessage({ type: "environment.chatRun", mode, entryIds: items.map((item) => item.id) })
    }
  }
  const stopEnvironmentRun = () => vscode.postMessage({ type: "environment.cancel" })

  const refreshServerSettings = () => {
    setServerSettingsBootstrapped(true)
    vscode.postMessage({ type: "serverSettings.read" })
  }
  const saveServerSettings = () => {
    const maxAgents = Math.max(1, Math.floor(serverMaxRunningAgents()))
    const maxShells = Math.max(1, Math.floor(serverMaxShellsPerAgent()))
    setServerMaxRunningAgents(maxAgents)
    setServerMaxShellsPerAgent(maxShells)
    setServerSettingsDirty(false)
    vscode.postMessage({
      type: "serverSettings.update",
      payload: {
        agent_runtime: {
          max_running_agents: maxAgents,
          max_shells_per_agent: maxShells,
        },
      },
    })
  }
  const runToolchainIngest = () => {
    vscode.postMessage({
      type: "toolchain.ingest.run",
      payload: {
        repoUrl: ingestRepoUrl().trim(),
        docsUrl: ingestDocsUrl().trim(),
        docsText: ingestDocsText().trim(),
        kindHint: ingestKindHint() === "all" ? "" : ingestKindHint(),
        nameHint: ingestNameHint().trim(),
        placementHint: ingestPlacementHint().trim(),
      },
    })
  }
  const cancelToolchainIngest = () => vscode.postMessage({ type: "toolchain.ingest.cancel" })
  const updateAutoApproval = (patch: {
    options?: Record<string, boolean>
    allowedCommands?: string[]
    deniedCommands?: string[]
  }) => {
    vscode.postMessage({
      type: "autoApproval.update",
      ...patch,
    })
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

  const requestProviderModels = (message = "正在获取模型列表...") => {
    const id = providerId()
    if (!id || !selectedProvider() || !adminUsable()) return
    setFetchedModels([])
    setModelFetchMessage(message)
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
    const requestedHostUrl = validation.value
    setHostUrl(requestedHostUrl)
    setPendingHostSave(requestedHostUrl)
    setHostUrlError(undefined)
    setDismissedConnectionSaveResultKey(undefined)
    vscode.postMessage({
      type: "connection.save",
      hostUrl: requestedHostUrl,
      adminSecret: adminSecret(),
      bootstrapSecret: bootstrapSecret(),
    })
    setAdminSecret("")
    setBootstrapSecret("")
    setTimeout(() => {
      setSaveLoading(false)
      setSaveSuccess(true)
      setTimeout(() => setSaveSuccess(false), 1500)
    }, 800)
  }

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

  const testProvider = (model = profileModel() || providerModel()) => {
    if (!model) return
    setProviderModel(model)
    setProfileModel(model)
    setActionIntent("")
    vscode.postMessage({
      type: "provider.test",
      payload: {
        provider_id: providerId(),
        model,
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
    const nextProfileId = profileId().trim() || makeProfileId(provider, model)
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
      },
    })
  }

  const activateModelPreset = (target: ModelTarget) => {
    const provider = profileProvider() || providerId()
    const model = profileModel().trim()
    if (!provider || !model) return
    const existing = profiles().find((profile) => profileMatches(profile, provider, model))
    const nextProfileId = stringValue(existing?.id, profileId().trim() || makeProfileId(provider, model))
    setProfileId(nextProfileId)
    setProfileProvider(provider)
    setProfileModel(model)
    setActionIntent(target === "main" ? "activateMain" : target === "sub" ? "activateSub" : "activateBoth")
    vscode.postMessage({
      type: "modelProfile.saveAndActivate",
      target,
      payload: {
        profile_id: nextProfileId,
        provider,
        model,
        max_tokens: numberValue(existing?.max_tokens, maxTokens()),
        max_context_tokens: numberValue(existing?.max_context_tokens, maxContextTokens()),
        temperature: numberValue(existing?.temperature, temperature()),
        reasoning_effort: stringValue(existing?.reasoning_effort, reasoningEffort()) || undefined,
        thinking_enabled: existing?.thinking_enabled === undefined ? thinkingEnabled() : existing.thinking_enabled !== false,
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
    if (activeTab() !== "toolchains") return
    if (!toolchainBootstrapped()) {
      setToolchainBootstrapped(true)
      vscode.postMessage({ type: "toolchain.refresh" })
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
      vscode.postMessage({ type: "serverSettings.read" })
    }
  })

  createEffect(() => {
    if (serverSettingsDirty()) return
    const settings = agentRuntimeSettings()
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
    vscode.postMessage({ type: "admin.refresh" })
    vscode.postMessage({ type: "autoApproval.get" })
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

  const profileBadges = (profileIdValue: string) => (
    <>
      <Show when={profileIdValue === activeMain()}>
        <StatusBadge tone="success">主</StatusBadge>
      </Show>
      <Show when={profileIdValue === activeSub()}>
        <StatusBadge tone="warning">副</StatusBadge>
      </Show>
    </>
  )

  const renderActiveModelCard = (
    title: string,
    profile: Record<string, unknown> | undefined,
    tone: "success" | "warning",
  ) => (
    <div class="active-model-card">
      <div>
        <StatusBadge tone={tone}>{title}</StatusBadge>
      </div>
      <strong>{profile ? stringValue(profile.model, "未配置模型") : "未配置"}</strong>
      <small>{profile ? `${stringValue(profile.provider, "-")} · ${stringValue(profile.id, "-")}` : "从模型列表选择后可一键设置"}</small>
    </div>
  )

  const renderCustomModelDialog = () => (
    <Show when={customModelDialogOpen()}>
      <div class="settings-overlay settings-overlay--center" onClick={closeCustomModelDialog}>
        <div class="settings-modal" role="dialog" aria-modal="true" aria-label="自定义模型名" onClick={(event) => event.stopPropagation()}>
              <div class="settings-modal__header">
            <div>
              <h3>自定义模型名</h3>
              <p>用于补充模型列表里没有返回的模型，或直接按自定义名称创建模型入口。</p>
            </div>
            <button class="ez-icon-button" type="button" title="关闭" onClick={closeCustomModelDialog}>
              <span class="codicon codicon-close" aria-hidden="true" />
            </button>
          </div>
          <label class="field-label">
            <span>模型名</span>
            <input
              class="setting-input"
              value={customModelDraft()}
              placeholder="例如 deepseek-chat"
              onInput={(event) => setCustomModelDraft(event.currentTarget.value)}
            />
          </label>
          <div class="settings-actions settings-actions--right">
            <button class="btn btn-secondary" type="button" onClick={closeCustomModelDialog}>
              取消
            </button>
            <button class="btn btn-primary" type="button" onClick={confirmCustomModelDialog} disabled={!customModelDraft().trim()}>
              继续
            </button>
          </div>
        </div>
      </div>
    </Show>
  )

  const renderModelDetailDrawer = () => (
    <Show when={modelDetailOpen()}>
      <div class="settings-overlay" onClick={closeModelDetail}>
        <aside class="model-detail-drawer" role="dialog" aria-modal="true" aria-label="模型详情" onClick={(event) => event.stopPropagation()}>
          <div class="model-detail-drawer__header">
            <div>
              <div class="settings-badge-group">
                <StatusBadge>{modelDetailMode() === "custom" ? "自定义模型名" : "模型详情"}</StatusBadge>
                <Show when={currentDetailHasSavedPreset()}>
                  <StatusBadge>{t("model.savedPresets")}</StatusBadge>
                </Show>
                <Show when={currentDetailIsMain()}>
                  <StatusBadge tone="success">当前主模型</StatusBadge>
                </Show>
                <Show when={currentDetailIsSub()}>
                  <StatusBadge tone="warning">当前副模型</StatusBadge>
                </Show>
              </div>
              <h3>{profileModel() || "模型详情"}</h3>
              <p>{profileProvider() || providerId()} · {modelDetailMode() === "custom" ? "手动指定模型名" : "来自当前服务商模型列表"}</p>
            </div>
            <button class="ez-icon-button" type="button" title="关闭" onClick={closeModelDetail}>
              <span class="codicon codicon-close" aria-hidden="true" />
            </button>
          </div>

          <div class="model-detail-drawer__content">
            <div class="model-detail-meta">
              <div class="model-detail-meta__item">
                <span>服务商</span>
                <strong>{profileProvider() || providerId() || "未选择"}</strong>
              </div>
              <div class="model-detail-meta__item">
                <span>预设名称</span>
                <strong>{profileId() || "自动生成"}</strong>
              </div>
            </div>

            <Show when={modelDetailMode() === "custom"}>
              <label class="field-label">
                <span>模型名</span>
                <input
                  class="setting-input"
                  value={profileModel()}
                  placeholder="例如 deepseek-chat"
                  onInput={(event) => {
                    setProfileModel(event.currentTarget.value)
                    setProviderModel(event.currentTarget.value)
                  }}
                />
                <small>用于补充列表里没有返回的模型，或直接按已知模型名创建入口。</small>
              </label>
            </Show>

            <div class="settings-actions model-detail-actions">
              <button class="btn btn-secondary" type="button" onClick={() => testProvider(profileModel())} disabled={!profileModel().trim() || !adminUsable()}>
                <span class="codicon codicon-beaker" aria-hidden="true" />
                测试连接
              </button>
              <button class="btn btn-primary" type="button" onClick={() => activateModelPreset("main")} disabled={!profileModel().trim() || !adminUsable()}>
                设为主模型
              </button>
              <button class="btn btn-secondary" type="button" onClick={() => activateModelPreset("sub")} disabled={!profileModel().trim() || !adminUsable()}>
                设为副模型
              </button>
              <button class="btn btn-secondary" type="button" onClick={() => activateModelPreset("both")} disabled={!profileModel().trim() || !adminUsable()}>
                设为主+副
              </button>
            </div>

            <details class="settings-details model-detail-advanced">
              <summary>
                <span class="codicon codicon-settings-gear" aria-hidden="true" />
                高级参数
              </summary>
              <div class="settings-form-grid settings-form-grid--two">
                <label class="field-label">
                  <span>预设名称（可选）</span>
                  <input class="setting-input" value={profileId()} placeholder="deepseek-main" onInput={(event) => setProfileId(event.currentTarget.value)} />
                  <small>留空时按服务商和模型自动生成。</small>
                </label>
                <label class="field-label">
                  <span>Max tokens</span>
                  <input class="setting-input" type="number" value={maxTokens()} onInput={(event) => setMaxTokens(Number(event.currentTarget.value))} />
                </label>
                <label class="field-label">
                  <span>Max context tokens</span>
                  <input class="setting-input" type="number" value={maxContextTokens()} onInput={(event) => setMaxContextTokens(Number(event.currentTarget.value))} />
                </label>
                <label class="field-label">
                  <span>Temperature</span>
                  <input class="setting-input" type="number" step="0.1" value={temperature()} onInput={(event) => setTemperature(Number(event.currentTarget.value))} />
                </label>
                <label class="field-label">
                  <span>Reasoning effort</span>
                  <input class="setting-input" value={reasoningEffort()} placeholder="high，可空" onInput={(event) => setReasoningEffort(event.currentTarget.value)} />
                </label>
                <label class="field-label field-label--checkbox">
                  <input type="checkbox" checked={thinkingEnabled()} onChange={(event) => setThinkingEnabled(event.currentTarget.checked)} />
                  <span>启用 thinking</span>
                </label>
              </div>
              <div class="settings-actions">
                <button class="btn btn-primary" type="button" onClick={saveModelPreset} disabled={!profileModel().trim() || !profileProvider() || !adminUsable()}>
                  <span class="codicon codicon-save" aria-hidden="true" />
                  保存预设
                </button>
              </div>
            </details>
          </div>
        </aside>
      </div>
    </Show>
  )

  const renderExecutors = () => (
    <div class="settings-page settings-page--narrow">
      <div class="settings-page-header">
        <div>
          <h2>{t("executor.title")}</h2>
          <p>{t("executor.description")}</p>
        </div>
        <button
          class={`btn btn-secondary ${refreshLoading() ? "btn--loading" : ""}`}
          onClick={refreshAdmin}
          disabled={refreshLoading()}
        >
          <span class={`codicon codicon-${refreshLoading() ? "loading" : "refresh"}`} aria-hidden="true" />
          {refreshLoading() ? "刷新中…" : "刷新状态"}
        </button>
      </div>

      {/* ── ① 状态总览 ── */}
      <section class="executor-status-bar">
        <div class="executor-status-card">
          <div class="executor-status-card__icon">
            <span class={`codicon codicon-${executorLocation() === "local" ? "device-desktop" : "cloud"}`} aria-hidden="true" />
          </div>
          <div class="executor-status-card__body">
            <small>{t("executor.location.label")}</small>
            <strong>{executorLocationLabel(executorLocation())}</strong>
          </div>
        </div>
        <div class="executor-status-card">
          <div class="executor-status-card__icon">
            <span class={`codicon codicon-${executorEngineOption().icon}`} aria-hidden="true" />
          </div>
          <div class="executor-status-card__body">
            <small>{t("executor.engine.label")}</small>
            <strong>{executorEngineOption().label}</strong>
          </div>
        </div>
        <div class="executor-status-card">
          <div class="executor-status-card__icon">
            <span
              class={`codicon codicon-${connectionStatus() === "ready" ? "pass-filled" : connectionStatus() === "error" ? "error" : "circle-large-outline"}`}
              aria-hidden="true"
              style={connectionStatus() === "ready" ? "color:var(--ez-success)" : connectionStatus() === "error" ? "color:var(--ez-error)" : "color:var(--ez-muted)"}
            />
          </div>
          <div class="executor-status-card__body">
            <small>{t("executor.status.connectionStatus")}</small>
            <strong>{connectionStatus() === "ready" ? t("executor.status.connected") : connectionStatus() === "error" ? t("executor.status.unavailable") : t("executor.status.disconnected")}</strong>
          </div>
        </div>
      </section>

      <div class="settings-actions" style="margin:12px 0">
        <button class="btn btn-primary" onClick={openExecutorPicker}>
          <span class="codicon codicon-settings-gear" aria-hidden="true" />
          切换主执行器
        </button>
        <button
          class={`btn btn-secondary ${refreshLoading() ? "btn--loading" : ""}`}
          onClick={refreshAdmin}
          disabled={refreshLoading()}
        >
          <span class={`codicon codicon-${refreshLoading() ? "loading" : "refresh"}`} aria-hidden="true" />
          {refreshLoading() ? "刷新中…" : "刷新"}
        </button>
      </div>

      {/* ── ② 弹出式两步选择卡片 ── */}
      <Show when={executorPickerOpen()}>
        <div class="settings-overlay settings-overlay--center" onClick={closeExecutorPicker}>
          <div class="executor-picker-modal" role="dialog" aria-modal="true" aria-label="选择主执行器" onClick={(e) => e.stopPropagation()}>
            <div class="settings-modal__header">
              <div>
                <h3>{t("executor.picker.title")}</h3>
                <p>{t("executor.picker.subtitle")}</p>
              </div>
              <button class="ez-icon-button" type="button" title="关闭" onClick={closeExecutorPicker}>
                <span class="codicon codicon-close" aria-hidden="true" />
              </button>
            </div>

            {/* 第 1 步：位置 */}
            <div class="executor-picker-step">
              <div class="executor-picker-step__title">
                <StatusBadge>1</StatusBadge>
                <span>{t("executor.location.label")}</span>
              </div>
              <div class="executor-location-grid">
                <button
                  type="button"
                  class={`executor-location-card ${pickerLocation() === "local" ? "executor-location-card--active" : ""}`}
                  onClick={() => setPickerLocation("local")}
                >
                  <span class="codicon codicon-device-desktop" aria-hidden="true" />
                  <div>
                    <strong>本地</strong>
                    <small>在本机运行执行器</small>
                  </div>
                </button>
                <button
                  type="button"
                  class={`executor-location-card ${pickerLocation() === "remote" ? "executor-location-card--active" : ""}`}
                  onClick={() => setPickerLocation("remote")}
                >
                  <span class="codicon codicon-cloud" aria-hidden="true" />
                  <div>
                    <strong>远端</strong>
                    <small>连接远程服务</small>
                  </div>
                </button>
              </div>
            </div>

            {/* 第 2 步：引擎 */}
            <div class="executor-picker-step">
              <div class="executor-picker-step__title">
                <StatusBadge>2</StatusBadge>
                <span>{t("executor.engine.label")}</span>
              </div>
              <div class="executor-engine-grid">
                <For each={EXECUTOR_ENGINES}>
                  {(engine) => (
                    <button
                      type="button"
                      class={[
                        "executor-engine-card",
                        pickerEngine() === engine.id ? "executor-engine-card--active" : "",
                        !engine.ready ? "executor-engine-card--disabled" : "",
                      ].filter(Boolean).join(" ")}
                      disabled={!engine.ready}
                      onClick={() => { if (engine.ready) setPickerEngine(engine.id) }}
                    >
                      <span class={`codicon codicon-${engine.icon}`} aria-hidden="true" />
                      <div>
                        <strong>{engine.label}</strong>
                        <small>{engine.description}</small>
                      </div>
                      <Show when={!engine.ready}>
                        <span class="executor-engine-card__badge">{t("executor.comingSoon")}</span>
                      </Show>
                    </button>
                  )}
                </For>
              </div>
            </div>

            <div class="settings-actions settings-actions--right">
              <button class="btn btn-secondary" type="button" onClick={closeExecutorPicker}>
                取消
              </button>
              <button
                class="btn btn-primary"
                type="button"
                onClick={confirmExecutorPicker}
                disabled={!EXECUTOR_ENGINES.find((e) => e.id === pickerEngine())?.ready}
              >
                <span class="codicon codicon-check" aria-hidden="true" />
                确认选择
              </button>
            </div>
          </div>
        </div>
      </Show>

      {/* ── ③ 按组合分发的配置面板 ── */}
      <Show
        when={executorEngineOption().ready}
        fallback={
          <section class="executor-coming-soon">
            <span class="codicon codicon-tools" aria-hidden="true" />
            <div>
              <strong>{executorEngineOption().label} 执行器正在建设中</strong>
              <p>该执行器引擎尚未实现，敬请期待。当前可使用 EZCode 执行器。</p>
            </div>
          </section>
        }
      >
        {/* EZCode 远端配置 */}
        <Show when={executorEngine() === "ezcode" && executorLocation() === "remote"}>
          <section class="executor-config-panel">
            <div class="executor-config-panel__header">
              <span class="codicon codicon-radio-tower" aria-hidden="true" />
              <div>
                <strong>{t("executor.remote.title")}</strong>
                <small>{t("executor.remote.desc")}</small>
              </div>
            </div>

            {/* 连接详情卡片 */}
            <div class="executor-config-detail">
              <div class="executor-config-detail__row">
                <span class="executor-config-detail__label">{t("executor.remote.requestUrl")}</span>
                <span class="executor-config-detail__value">{stringValue(server.connectionState().hostUrl, "未配置")}</span>
              </div>
              <div class="executor-config-detail__row">
                <span class="executor-config-detail__label">{t("executor.remote.hostSource")}</span>
                <StatusBadge tone={hostUrlConfigured() ? "success" : "warning"}>{hostUrlSource()}</StatusBadge>
              </div>
              <div class="executor-config-detail__row">
                <span class="executor-config-detail__label">Admin secret</span>
                <StatusBadge tone={server.connectionState().adminSecretSet ? "success" : "warning"}>
                  {server.connectionState().adminSecretSet ? t("executor.remote.saved") : t("executor.remote.notSaved")}
                </StatusBadge>
              </div>
              <div class="executor-config-detail__row">
                <span class="executor-config-detail__label">Bootstrap secret</span>
                <StatusBadge tone={server.connectionState().bootstrapSecretSet ? "success" : "warning"}>
                  {server.connectionState().bootstrapSecretSet ? t("executor.remote.saved") : t("executor.remote.notSaved")}
                </StatusBadge>
              </div>
            </div>

            {/* 提示信息区 */}
            <Show when={hostUrlError()}>
              <div class="executor-config-notice executor-config-notice--error">
                <span class="codicon codicon-error" aria-hidden="true" />
                <span>{hostUrlError()}</span>
              </div>
            </Show>
            <Show when={connectionMigrationMessage()}>
              <div class="executor-config-notice executor-config-notice--info">
                <span class="codicon codicon-info" aria-hidden="true" />
                <div>
                  <strong>{t("executor.remote.migrated")}</strong>
                  <span>{connectionMigrationMessage()}</span>
                </div>
              </div>
            </Show>
            <Show when={connectionMessage() && !connectionMigrationMessage()}>
              <div class="executor-config-notice executor-config-notice--error">
                <span class="codicon codicon-warning" aria-hidden="true" />
                <span>{connectionMessage()}</span>
              </div>
            </Show>
            <Show when={connectionSaveMessage()}>
              <div class="executor-config-notice executor-config-notice--success">
                <span class="codicon codicon-check" aria-hidden="true" />
                <div>
                  <strong>{t("executor.remote.saveResult")}</strong>
                  <span>{connectionSaveMessage()}</span>
                </div>
              </div>
            </Show>
            <Show when={hostUrlDraftDiffers()}>
              <div class="executor-config-notice executor-config-notice--warning">
                <span class="codicon codicon-warning" aria-hidden="true" />
                <span>输入框内容尚未生效，实际请求仍使用 {currentHostUrl()}。</span>
              </div>
            </Show>
            <Show when={isDefaultLocalHost()}>
              <div class="executor-config-notice executor-config-notice--info">
                <span class="codicon codicon-info" aria-hidden="true" />
                <span>当前为本机默认地址。如需连接远程服务器，请修改为对应地址，如 http://192.168.50.149:8765。</span>
              </div>
            </Show>

            {/* 表单 */}
            <div class="executor-config-form">
              <label class="executor-config-field">
                <span class="executor-config-field__label">
                  <span class="codicon codicon-globe" aria-hidden="true" />
                  Host URL
                </span>
                <input class="executor-config-field__input" value={hostUrl()} placeholder="http://192.168.50.149:8765" onInput={(event) => {
                  setHostUrlDirty(true)
                  setHostUrl(event.currentTarget.value)
                  setPendingHostSave(undefined)
                  setHostUrlError(undefined)
                  setHostUrlSyncLock(undefined)
                  const key = connectionSaveResultKey(server.connectionSaveResult())
                  if (key) setDismissedConnectionSaveResultKey(key)
                }} />
              </label>
              <div class="executor-config-form__secrets">
                <label class="executor-config-field">
                  <span class="executor-config-field__label">
                    <span class="codicon codicon-key" aria-hidden="true" />
                    Admin secret
                  </span>
                  <input class="executor-config-field__input" value={adminSecret()} type="password" placeholder={t("provider.apiKeyPlaceholder")} onInput={(event) => setAdminSecret(event.currentTarget.value)} />
                </label>
                <label class="executor-config-field">
                  <span class="executor-config-field__label">
                    <span class="codicon codicon-shield" aria-hidden="true" />
                    Bootstrap secret
                  </span>
                  <input class="executor-config-field__input" value={bootstrapSecret()} type="password" placeholder={t("provider.apiKeyPlaceholder")} onInput={(event) => setBootstrapSecret(event.currentTarget.value)} />
                </label>
              </div>
            </div>

            <div class="executor-config-panel__footer">
              <button
                class={`btn btn-primary ${saveLoading() ? "btn--loading" : ""} ${saveSuccess() ? "btn--success" : ""}`}
                onClick={saveConnection}
                disabled={saveLoading()}
              >
                <span class={`codicon codicon-${saveLoading() ? "loading" : saveSuccess() ? "check" : "save"}`} aria-hidden="true" />
                {saveLoading() ? "保存中…" : saveSuccess() ? t("executor.remote.saved") : "保存连接配置"}
              </button>
              <button
                class={`btn btn-secondary ${refreshLoading() ? "btn--loading" : ""}`}
                onClick={refreshAdmin}
                disabled={refreshLoading()}
              >
                <span class={`codicon codicon-${refreshLoading() ? "loading" : "refresh"}`} aria-hidden="true" />
                {refreshLoading() ? "刷新中…" : "测试连接"}
              </button>
            </div>
          </section>
        </Show>

        {/* EZCode 本地配置 */}
        <Show when={executorEngine() === "ezcode" && executorLocation() === "local"}>
          <section class="executor-coming-soon">
            <span class="codicon codicon-device-desktop" aria-hidden="true" />
            <div>
              <strong>{t("executor.local.title")}</strong>
              <p>{t("executor.local.desc")}</p>
            </div>
          </section>
        </Show>
      </Show>
    </div>
  )

  const renderProviderManagement = () => (
    <div class="settings-page settings-page--wide">
      <div class="settings-page-header">
        <div>
          <h2>{t("provider.title")}</h2>
          <p>按“服务商 → 模型 → 主/副模型”的路径完成配置，API Key 保存在 host 配置中，前端不回显明文。</p>
          <p class="setting-description">
            实际请求 Host：{stringValue(server.connectionState().hostUrl, "未配置")} · Admin：
            {adminUsable() ? "可用" : t("executor.status.unavailable")} · 最近刷新：{server.adminStateUpdatedAt() || "尚未刷新"}
          </p>
        </div>
        <div class="settings-actions settings-actions--right">
          <button class="btn btn-secondary" onClick={resetProviderForm}>
            <span class="codicon codicon-add" aria-hidden="true" />
            新增服务商
          </button>
          <button class="btn btn-secondary" onClick={refreshAdmin}>
            <span class="codicon codicon-refresh" aria-hidden="true" />
            刷新
          </button>
        </div>
      </div>

      <Show when={providerErrorMessage()}>
        <div class="settings-error">{providerErrorMessage()}</div>
      </Show>
      <Show when={connectionStatus() === "error" && connectionMessage()}>
        <div class="settings-error">{connectionMessage()}</div>
      </Show>
      <Show when={isDefaultLocalHost()}>
        <div class="settings-action-result">
          <div>
            <strong>服务商管理请求会发送到当前执行器</strong>
            <small>当前仍是默认本机地址；中心化 host 在服务器时需要先到“执行器管理”页保存服务器 Host URL。</small>
          </div>
        </div>
      </Show>
      <Show when={actionFeedback()}>
        <div class="settings-action-result">
          <div>
            <strong>{actionFeedback()}</strong>
          </div>
        </div>
      </Show>

      <div class="provider-workbench">
        <aside class="provider-list-panel">
          <div class="settings-panel-title">
            <span>服务商</span>
            <StatusBadge>{String(providers().length)}</StatusBadge>
          </div>
          <div class="provider-list">
            <Show when={providers().length} fallback={<p class="settings-empty-note">暂无服务商，使用右侧表单新增。</p>}>
              <For each={providers()}>
                {(provider) => {
                  const id = stringValue(provider.id)
                  const selected = id === providerId()
                  const enabled = provider.enabled !== false
                  return (
                    <button
                      type="button"
                      class={`provider-list-item ${selected ? "provider-list-item--active" : ""}`}
                      onClick={() => selectProvider(provider)}
                    >
                      <span class="provider-list-item__icon codicon codicon-server-process" aria-hidden="true" />
                      <span class="provider-list-item__body">
                        <strong>{id}</strong>
                        <small>{stringValue(provider.base_url, "未配置 base URL")}</small>
                      </span>
                      <span class="provider-list-item__meta">
                        {stringValue(provider.compat, "generic")}
                        <StatusBadge tone={enabled ? "success" : "warning"}>
                          {enabled ? "启用" : "停用"}
                        </StatusBadge>
                      </span>
                    </button>
                  )
                }}
              </For>
            </Show>
          </div>
        </aside>

        <section class="provider-editor-panel">
          <div class="settings-editor-header">
            <div>
              <h3>{providerId() || "新服务商"}</h3>
              <p>{providerBaseUrl() || "填写协议、兼容模式和 API Base URL 后保存。"}</p>
            </div>
            <div class="settings-actions settings-actions--right">
              <button class="btn btn-secondary" onClick={() => toggleProviderEnabled(!providerEnabled())} disabled={!selectedProvider() || !adminUsable()}>
                <span class={`codicon codicon-${providerEnabled() ? "circle-slash" : "pass"}`} aria-hidden="true" />
                {providerEnabled() ? "停用" : "启用"}
              </button>
              <button class="btn btn-primary" onClick={saveProvider} disabled={!providerId() || !adminUsable()}>
                <span class="codicon codicon-save" aria-hidden="true" />
                保存服务商
              </button>
            </div>
          </div>

          <div class="settings-summary-grid">
            {renderActiveModelCard("主模型", activeMainProfile(), "success")}
            {renderActiveModelCard("副模型", activeSubProfile(), "warning")}
          </div>

          <div class="settings-section settings-section--flat">
            <div class="settings-section-heading">服务商设置</div>
            <div class="settings-form-grid settings-form-grid--two settings-form-grid--bounded">
              <label class="field-label">
                <span>服务商名称</span>
                <input class="setting-input" value={providerId()} placeholder="deepseek" onInput={(event) => setProviderId(event.currentTarget.value)} />
                <small>用于区分不同服务商，建议使用英文或拼音。</small>
              </label>
              <label class="field-label">
                <span>协议类型</span>
                <select class="setting-select" value={providerType()} onChange={(event) => setProviderType(event.currentTarget.value as ProviderType)}>
                  <For each={providerTypes}>{(item) => <option value={item}>{item}</option>}</For>
                </select>
              </label>
              <label class="field-label">
                <span>{t("provider.compat")}</span>
                <select class="setting-select" value={providerCompat()} onChange={(event) => setProviderCompat(event.currentTarget.value as ProviderCompat)}>
                  <For each={compats}>{(item) => <option value={item}>{item}</option>}</For>
                </select>
              </label>
              <label class="field-label">
                <span>API Base URL</span>
                <input class="setting-input" value={providerBaseUrl()} placeholder="https://api.deepseek.com" onInput={(event) => setProviderBaseUrl(event.currentTarget.value)} />
              </label>
              <label class="field-label">
                <span>API Key</span>
                <input class="setting-input" value={providerApiKey()} type="password" placeholder="留空保留旧值" onInput={(event) => setProviderApiKey(event.currentTarget.value)} />
                <small>保存到 host 配置；保存成功后会清空输入框。</small>
              </label>
              <label class="field-label field-label--checkbox">
                <input type="checkbox" checked={providerEnabled()} onChange={(event) => setProviderEnabled(event.currentTarget.checked)} />
                <span>启用服务商</span>
              </label>
            </div>
          </div>

          <div class="settings-section settings-section--flat">
            <div class="settings-section-heading">
              <span>模型列表</span>
              <div class="settings-actions settings-actions--right">
                <button class="btn btn-secondary" type="button" onClick={openCustomModelDialog} disabled={!selectedProvider() || !adminUsable()}>
                  <span class="codicon codicon-edit" aria-hidden="true" />
                  自定义模型名
                </button>
                <button class="btn btn-secondary" onClick={() => requestProviderModels()} disabled={!selectedProvider() || !adminUsable()}>
                  <span class="codicon codicon-cloud-download" aria-hidden="true" />
                  刷新模型列表
                </button>
              </div>
            </div>
            <div class="settings-inline-form">
              <input class="setting-input" value={modelSearch()} placeholder="搜索模型" onInput={(event) => setModelSearch(event.currentTarget.value)} />
            </div>
            <Show when={modelFetchMessage()}>
              <p class="settings-empty-note">{modelFetchMessage()}</p>
            </Show>
            <Show when={filteredFetchedModels().length} fallback={
              <div class="settings-empty-state">
                <span class="codicon codicon-symbol-string" aria-hidden="true" />
                <strong>{emptyModelListMessage()}</strong>
                <small>
                  {showCustomModelFallback()
                    ? "当前服务商无法给出模型清单时，可手动指定模型名。"
                    : "换个关键词搜索，或清空搜索后重试。"}
                </small>
                <div class="settings-actions">
                  <button class="btn btn-secondary" type="button" onClick={openCustomModelDialog} disabled={!selectedProvider() || !adminUsable()}>
                    <span class="codicon codicon-edit" aria-hidden="true" />
                    自定义模型名
                  </button>
                  <Show when={!showCustomModelFallback() && modelSearch().trim()}>
                    <button class="btn btn-secondary" type="button" onClick={() => setModelSearch("")}>
                      清空搜索
                    </button>
                  </Show>
                </div>
              </div>
            }>
              <div class="provider-model-list">
                <For each={filteredFetchedModels()}>
                  {(model) => {
                    const relatedProfiles = modelProfilesFor(model.id)
                    const presetCount = relatedProfiles.length
                    const firstPresetId = presetCount > 0 ? stringValue(relatedProfiles[0].id) : ""
                    const isMain = relatedProfiles.some((profile) => stringValue(profile.id) === activeMain())
                    const isSub = relatedProfiles.some((profile) => stringValue(profile.id) === activeSub())
                    return (
                      <button
                        type="button"
                        class={`provider-model-row ${profileModel() === model.id && modelDetailOpen() ? "provider-model-row--selected" : ""}`}
                        onClick={() => openModelDetail(model.id, "fetched")}
                      >
                        <span class="provider-model-row__body">
                          <strong>{model.id}</strong>
                          <small>
                            {presetCount > 0
                              ? `已保存预设 ${firstPresetId}${presetCount > 1 ? ` +${presetCount - 1}` : ""}`
                              : model.owned_by || "provider model"}
                          </small>
                        </span>
                        <span class="settings-badge-group provider-model-row__meta">
                          <Show when={presetCount > 0}>
                            <StatusBadge>{t("model.savedPresets")}</StatusBadge>
                          </Show>
                          <Show when={isMain}>
                            <StatusBadge tone="success">主</StatusBadge>
                          </Show>
                          <Show when={isSub}>
                            <StatusBadge tone="warning">副</StatusBadge>
                          </Show>
                        </span>
                      </button>
                    )
                  }}
                </For>
              </div>
            </Show>
          </div>

          <details class="settings-details">
            <summary>
              <span class="codicon codicon-list-tree" aria-hidden="true" />
              已保存预设
            </summary>
            <Show when={selectedProviderProfiles().length} fallback={<p class="settings-empty-note">当前服务商还没有保存预设。</p>}>
              <div class="compact-list">
                <For each={selectedProviderProfiles()}>
                  {(profile) => {
                    const id = stringValue(profile.id)
                    return (
                      <button type="button" class="compact-row" onClick={() => openSavedPreset(profile)}>
                        <span>
                          <strong>{id}</strong>
                          <small>{stringValue(profile.model)}</small>
                        </span>
                        <span class="settings-badge-group">{profileBadges(id)}</span>
                      </button>
                    )
                  }}
                </For>
              </div>
            </Show>
          </details>

          <details class="settings-details">
            <summary>
              <span class="codicon codicon-copy" aria-hidden="true" />
              高级操作
            </summary>
            <div class="settings-inline-form">
              <input class="setting-input" value={providerCopyId()} placeholder="复制后的服务商 ID" onInput={(event) => setProviderCopyId(event.currentTarget.value)} />
              <button class="btn btn-secondary" onClick={copyProvider} disabled={!selectedProvider() || !adminUsable()}>
                <span class="codicon codicon-copy" aria-hidden="true" />
                复制服务商
              </button>
            </div>
            <p class="settings-empty-note">复制用于基于当前服务商配置创建另一个 provider id；不会自动切换主/副模型。</p>
          </details>

          <div class="settings-section settings-section--flat danger-zone">
            <div class="settings-section-heading">危险区</div>
            <p class="settings-empty-note">删除服务商前，后端会检查是否仍被已保存预设引用。</p>
            <button class="btn btn-danger" onClick={deleteProvider} disabled={!selectedProvider() || !adminUsable()}>
              <span class="codicon codicon-trash" aria-hidden="true" />
              删除服务商
            </button>
          </div>
        </section>
      </div>

      {renderCustomModelDialog()}
      {renderModelDetailDrawer()}
    </div>
  )

  const renderEnvironmentSection = (
    kind: EnvironmentEntryKind,
    title: string,
    description: string,
  ) => {
    const entries = () => environmentEntriesByKind()[kind]
    return (
      <section class="settings-section settings-section--flat environment-section">
        <div class="settings-section-heading">
          <div>
            <span>{title}</span>
            <small class="setting-description">{description}</small>
          </div>
          <StatusBadge>{String(entries().length)}</StatusBadge>
        </div>
        <Show when={entries().length} fallback={<p class="settings-empty-note">当前没有 {title} 条目。</p>}>
          <div class="environment-entry-list">
            <For each={entries()}>
              {(entry) => (
                <details class="environment-entry">
                  <summary class="environment-entry__summary">
                    <div class="environment-entry__main">
                      <span class={`codicon codicon-${environmentKindIcon(kind)}`} aria-hidden="true" />
                      <span class="environment-entry__title">
                        <strong>{entry.name}</strong>
                        <small>{entry.description || entry.source || "未提供描述"}</small>
                      </span>
                    </div>
                    <div class="environment-entry__meta">
                      <Show when={entry.tags.length}>
                        <span class="settings-badge-group">
                          <For each={entry.tags.slice(0, 3)}>
                            {(tag) => <StatusBadge>{tag}</StatusBadge>}
                          </For>
                        </span>
                      </Show>
                      <StatusBadge tone={environmentStatusTone(entry.status)}>
                        {environmentStatusLabel(entry.status)}
                      </StatusBadge>
                    </div>
                  </summary>
                  <div class="environment-entry__details">
                    <div class="environment-entry__grid">
                      <div class="environment-entry__field">
                        <span>来源</span>
                        <strong>{entry.source || "未提供"}</strong>
                      </div>
                      <div class="environment-entry__field">
                        <span>版本</span>
                        <strong>{entry.version || "未提供"}</strong>
                      </div>
                      <div class="environment-entry__field">
                        <span>最后动作</span>
                        <strong>{entry.lastAction || "尚未开始"}</strong>
                      </div>
                      <div class="environment-entry__field">
                        <span>更新时间</span>
                        <strong>{formatTimestamp(entry.lastUpdated)}</strong>
                      </div>
                    </div>
                    <Show when={entry.check}>
                      <label class="field-label">
                        <span>检查命令</span>
                        <code class="environment-command">{entry.check}</code>
                      </label>
                    </Show>
                    <Show when={entry.install}>
                      <label class="field-label">
                        <span>安装命令</span>
                        <code class="environment-command">{entry.install}</code>
                      </label>
                    </Show>
                    <Show when={entry.detail}>
                      <label class="field-label">
                        <span>最近输出</span>
                        <pre class="settings-result environment-command environment-command--multiline">{entry.detail}</pre>
                      </label>
                    </Show>
                  </div>
                </details>
              )}
            </For>
          </div>
        </Show>
      </section>
    )
  }

  const refreshToolchains = () => {
    vscode.postMessage({ type: "toolchain.refresh" })
    refreshEnvironmentManifest()
  }

  const openCreateToolchain = (kind: ToolchainKind) => {
    setToolchainEditor(emptyToolchainEditor(kind))
  }

  const openEditToolchain = (record: ToolchainRecord) => {
    setToolchainEditor(toolchainEditorFromRecord(record))
  }

  const patchToolchainEditor = (patch: Partial<ToolchainEditorState>) => {
    setToolchainEditor((current) => current ? { ...current, ...patch } : current)
  }

  const saveToolchain = () => {
    const editor = toolchainEditor()
    if (!editor) return
    const payload = toolchainPayloadFromEditor(editor)
    if (!stringValue(payload.name).trim()) return
    vscode.postMessage({
      type: "toolchain.record",
      kind: editor.kind,
      payload,
    })
    setToolchainEditor(undefined)
  }

  const enableToolchain = (record: ToolchainRecord, enabled: boolean) => {
    vscode.postMessage({
      type: "toolchain.enable",
      kind: record.kind,
      name: record.name,
      enabled,
    })
  }

  const deleteToolchain = (record: ToolchainRecord) => {
    if (!globalThis.confirm(`删除 ${record.name}？此操作会从服务器能力清单移除该条目。`)) return
    vscode.postMessage({
      type: "toolchain.delete",
      kind: record.kind,
      name: record.name,
    })
  }

  const renderToolchainGroup = (
    kind: ToolchainKind,
    title: string,
    description: string,
    items: ToolchainRecord[],
  ) => (
    <section class="settings-section settings-section--flat">
      <div class="settings-section-heading">
        <div>
          <span>{title}</span>
          <small>{description}</small>
        </div>
        <StatusBadge>{String(items.length)}</StatusBadge>
      </div>
      <Show when={items.length} fallback={<p class="settings-empty-note">尚未配置 {title} 条目。</p>}>
        <div class="toolchain-list">
          <For each={items}>
            {(item) => (
              <div class={`toolchain-row ${item.enabled === false ? "toolchain-row--disabled" : ""}`}>
                <div class="toolchain-row__main">
                  <div class="toolchain-row__title">
                    <strong>{item.name}</strong>
                    <StatusBadge tone={item.enabled === false ? "muted" : "success"}>
                      {item.enabled === false ? t("provider.disabled") : t("provider.enabled")}
                    </StatusBadge>
                    <Show when={item.version}>
                      <StatusBadge>{item.version}</StatusBadge>
                    </Show>
                  </div>
                  <span>{item.description || item.source || item.command || item.check || "未填写说明"}</span>
                  <small>{item.check ? `检查：${item.check}` : "未填写检查命令"}</small>
                </div>
                <div class="settings-actions settings-actions--right">
                  <button class="btn btn-secondary" onClick={() => enableToolchain(item, item.enabled === false)}>
                    {item.enabled === false ? "启用" : "停用"}
                  </button>
                  <button class="btn btn-secondary" onClick={() => openEditToolchain(item)}>
                    编辑
                  </button>
                  <button class="btn btn-danger" onClick={() => deleteToolchain(item)}>
                    删除
                  </button>
                </div>
              </div>
            )}
          </For>
        </div>
      </Show>
    </section>
  )

  const renderToolchainEditor = () => {
    const editor = toolchainEditor()
    if (!editor) return null
    const title = `${editor.mode === "create" ? "新增" : "编辑"} ${
      editor.kind === "cli" ? "CLI" : editor.kind === "mcp" ? "MCP" : "Skill"
    }`
    return (
      <div class="settings-overlay settings-overlay--center" role="dialog" aria-modal="true" onClick={() => setToolchainEditor(undefined)}>
        <div class="settings-modal toolchain-editor" onClick={(event) => event.stopPropagation()}>
          <div class="settings-modal__header">
            <div>
              <h3>{title}</h3>
              <p>保存只更新服务器 manifest；实际安装仍由“配置环境”智能体执行。</p>
            </div>
            <button class="ez-icon-button" onClick={() => setToolchainEditor(undefined)} aria-label="关闭">
              <span class="codicon codicon-close" aria-hidden="true" />
            </button>
          </div>
          <div class="toolchain-editor__grid">
            <label class="field-label">
              <span>{t("toolchain.editor.name")}</span>
              <input value={editor.name} disabled={editor.mode === "edit"} onInput={(event) => patchToolchainEditor({ name: event.currentTarget.value })} />
            </label>
            <label class="field-label">
              <span>{t("toolchain.filterStatus")}</span>
              <select value={editor.enabled ? "true" : "false"} onChange={(event) => patchToolchainEditor({ enabled: event.currentTarget.value === "true" })}>
                <option value="true">{t("provider.enable")}</option>
                <option value="false">{t("provider.disable")}</option>
              </select>
            </label>
            <label class="field-label">
              <span>来源</span>
              <input value={editor.source} onInput={(event) => patchToolchainEditor({ source: event.currentTarget.value })} />
            </label>
            <label class="field-label">
              <span>版本</span>
              <input value={editor.version} onInput={(event) => patchToolchainEditor({ version: event.currentTarget.value })} />
            </label>
            <label class="field-label">
              <span>仓库地址</span>
              <input value={editor.repoUrl} onInput={(event) => patchToolchainEditor({ repoUrl: event.currentTarget.value })} />
            </label>
            <label class="field-label">
              <span>风险等级</span>
              <input value={editor.riskLevel} placeholder="low / medium / high" onInput={(event) => patchToolchainEditor({ riskLevel: event.currentTarget.value })} />
            </label>
          </div>
          <label class="field-label">
            <span>说明</span>
            <input value={editor.description} onInput={(event) => patchToolchainEditor({ description: event.currentTarget.value })} />
          </label>

          <Show when={editor.kind !== "skill"}>
            <label class="field-label">
              <span>{editor.kind === "mcp" ? "启动命令" : "命令"}</span>
              <input value={editor.command} onInput={(event) => patchToolchainEditor({ command: event.currentTarget.value })} />
            </label>
          </Show>

          <Show when={editor.kind === "cli"}>
            <label class="field-label">
              <span>部署属性</span>
              <select value={editor.placement} onChange={(event) => patchToolchainEditor({ placement: event.currentTarget.value })}>
                <option value="local">local</option>
                <option value="server">server</option>
                <option value="both">both</option>
              </select>
            </label>
            <label class="field-label">
              <span>能力标签</span>
              <textarea rows={3} value={editor.capabilitiesText} placeholder="每行一个能力，例如 code-search" onInput={(event) => patchToolchainEditor({ capabilitiesText: event.currentTarget.value })} />
            </label>
          </Show>

          <Show when={editor.kind === "mcp"}>
            <div class="toolchain-editor__grid">
              <label class="field-label">
                <span>安装位置</span>
                <select value={editor.placement} onChange={(event) => patchToolchainEditor({ placement: event.currentTarget.value })}>
                  <option value="peer">peer</option>
                  <option value="both">both</option>
                  <option value="server">server</option>
                </select>
              </label>
              <label class="field-label">
                <span>分发方式</span>
                <select value={editor.distribution} onChange={(event) => patchToolchainEditor({ distribution: event.currentTarget.value })}>
                  <option value="command">command</option>
                  <option value="artifact">artifact</option>
                </select>
              </label>
              <label class="field-label">
                <span>工作目录</span>
                <input value={editor.cwd} onInput={(event) => patchToolchainEditor({ cwd: event.currentTarget.value })} />
              </label>
            </div>
            <label class="field-label">
              <span>参数</span>
              <textarea rows={3} value={editor.argsText} placeholder="每行一个参数" onInput={(event) => patchToolchainEditor({ argsText: event.currentTarget.value })} />
            </label>
            <label class="field-label">
              <span>环境变量</span>
              <textarea rows={3} value={editor.envText} placeholder="KEY=value，每行一个" onInput={(event) => patchToolchainEditor({ envText: event.currentTarget.value })} />
            </label>
          </Show>

          <Show when={editor.kind === "skill"}>
            <div class="toolchain-editor__grid">
              <label class="field-label">
                <span>作用域</span>
                <select value={editor.scope} onChange={(event) => patchToolchainEditor({ scope: event.currentTarget.value })}>
                  <option value="project">project</option>
                  <option value="user">user</option>
                </select>
              </label>
              <label class="field-label">
                <span>路径提示</span>
                <input value={editor.pathHint} onInput={(event) => patchToolchainEditor({ pathHint: event.currentTarget.value })} />
              </label>
            </div>
          </Show>

          <div class="toolchain-editor__grid">
            <label class="field-label">
              <span>检查命令</span>
              <textarea rows={3} value={editor.check} onInput={(event) => patchToolchainEditor({ check: event.currentTarget.value })} />
            </label>
            <label class="field-label">
              <span>安装命令</span>
              <textarea rows={3} value={editor.install} onInput={(event) => patchToolchainEditor({ install: event.currentTarget.value })} />
            </label>
          </div>
          <label class="field-label">
            <span>文档链接</span>
            <textarea rows={3} value={editor.docsText} placeholder="标题 | URL，每行一个" onInput={(event) => patchToolchainEditor({ docsText: event.currentTarget.value })} />
          </label>
          <label class="field-label">
            <span>LLM 提取依据</span>
            <textarea rows={3} value={editor.evidenceText} placeholder="field | title | url | excerpt，每行一条" onInput={(event) => patchToolchainEditor({ evidenceText: event.currentTarget.value })} />
          </label>
          <div class="toolchain-editor__grid">
            <label class="field-label">
              <span>运行要求</span>
              <textarea rows={3} value={editor.requirementsText} placeholder="KEY=value，每行一个" onInput={(event) => patchToolchainEditor({ requirementsText: event.currentTarget.value })} />
            </label>
            <label class="field-label">
              <span>凭据需求</span>
              <textarea rows={3} value={editor.credentialsText} placeholder="每行一个凭据名，例如 GITHUB_TOKEN" onInput={(event) => patchToolchainEditor({ credentialsText: event.currentTarget.value })} />
            </label>
          </div>
          <label class="field-label">
            <span>安装指导 prompt</span>
            <textarea rows={4} value={editor.installPrompt} onInput={(event) => patchToolchainEditor({ installPrompt: event.currentTarget.value })} />
          </label>
          <label class="field-label">
            <span>验证指导 prompt</span>
            <textarea rows={4} value={editor.verifyPrompt} onInput={(event) => patchToolchainEditor({ verifyPrompt: event.currentTarget.value })} />
          </label>
          <label class="field-label">
            <span>注意事项</span>
            <textarea rows={3} value={editor.notesText} placeholder="每行一条，例如不要自动安装 Node" onInput={(event) => patchToolchainEditor({ notesText: event.currentTarget.value })} />
          </label>
          <div class="toolchain-editor__footer">
            <button class="btn btn-secondary" onClick={() => setToolchainEditor(undefined)}>{t("executor.picker.cancel")}</button>
            <button class="btn btn-primary" onClick={saveToolchain} disabled={!editor.name.trim()}>
              保存
            </button>
          </div>
        </div>
      </div>
    )
  }

  const renderToolchainsLegacy = () => (
    <div class="settings-page settings-page--wide">
      <div class="settings-page-header">
        <div>
          <h2>{t("toolchain.title")}</h2>
          <p>按服务器给出的权威清单检查和配置本地能力，执行结果直接留在当前页面。</p>
          <p class="setting-description">
            当前状态：{environmentRunStatusLabel(environmentSnapshot().status)} · 最近清单刷新：{formatTimestamp(environmentSnapshot().lastManifestAt)}
          </p>
        </div>
        <div class="settings-actions settings-actions--right">
          <button class="btn btn-secondary" onClick={refreshToolchains} disabled={environmentSnapshot().running}>
            <span class="codicon codicon-refresh" aria-hidden="true" />
            刷新清单
          </button>
          <button class="btn btn-secondary" onClick={() => openCreateToolchain("cli")}>
            新增 CLI 能力
          </button>
          <button class="btn btn-secondary" onClick={() => openCreateToolchain("mcp")}>
            新增 MCP 能力
          </button>
          <button class="btn btn-secondary" onClick={() => openCreateToolchain("skill")}>
            新增 Skill 能力
          </button>
          <Show
            when={!environmentSnapshot().running}
            fallback={
              <button class="btn btn-danger" onClick={stopEnvironmentRun}>
                <span class="codicon codicon-debug-stop" aria-hidden="true" />
                停止
              </button>
            }
          >
            <>
              <button class="btn btn-secondary" onClick={() => runEnvironment("check")} disabled={!environmentSnapshot().entries.length}>
                <span class="codicon codicon-search" aria-hidden="true" />
                检查当前环境
              </button>
              <button class="btn btn-primary" onClick={() => runEnvironment("configure")} disabled={!environmentSnapshot().entries.length}>
                <span class="codicon codicon-tools" aria-hidden="true" />
                配置环境
              </button>
            </>
          </Show>
        </div>
      </div>

      <Show when={environmentError()}>
        <div class="settings-error">{environmentError()}</div>
      </Show>
      <Show when={toolchainError()}>
        <div class="settings-error">{toolchainError()}</div>
      </Show>
      <Show when={toolchainActionFeedback()}>
        <div class="settings-success">{toolchainActionFeedback()}</div>
      </Show>

      <section class="settings-section settings-section--flat">
        <div class="settings-section-heading">
          <div>
            <span>服务器能力 Manifest</span>
            <small>这里维护服务器权威清单、文档信息和安装/验证指导；保存不会直接安装。</small>
          </div>
          <button class="btn btn-secondary" onClick={() => vscode.postMessage({ type: "toolchain.refresh" })}>
            <span class="codicon codicon-refresh" aria-hidden="true" />
            刷新管理列表
          </button>
        </div>
      </section>
      {renderToolchainGroup("cli", "CLI", "命令行工具、可执行程序和本地二进制依赖。", toolchainGroups().cli)}
      {renderToolchainGroup("mcp", "MCP", "需要注册到本地或项目环境中的 MCP 服务。", toolchainGroups().mcp)}
      {renderToolchainGroup("skill", "Skills", "服务器要求可用的技能包和协作能力。", toolchainGroups().skill)}

      <section class="settings-section settings-section--flat environment-banner">
        <div class="settings-status-line">
          <StatusBadge tone={environmentRunTone(environmentSnapshot().status)}>
            {environmentRunStatusLabel(environmentSnapshot().status)}
          </StatusBadge>
          <StatusBadge>总计 {String(environmentCounts().total)}</StatusBadge>
          <StatusBadge tone="success">可用 {String(environmentCounts().available + environmentCounts().configured)}</StatusBadge>
          <StatusBadge tone="warning">缺失 {String(environmentCounts().missing)}</StatusBadge>
          <Show when={environmentCounts().failed > 0}>
            <StatusBadge tone="error">失败 {String(environmentCounts().failed)}</StatusBadge>
          </Show>
        </div>
        <div class="environment-banner__content">
          <div class="environment-banner__block">
            <span>当前摘要</span>
            <strong>{environmentSnapshot().summary}</strong>
            <small>
              {environmentSnapshot().mode
                ? `${environmentSnapshot().mode === "check" ? "检查" : "配置"} · 开始于 ${formatTimestamp(environmentSnapshot().startedAt)}`
                : "尚未启动环境任务"}
            </small>
          </div>
          <div class="environment-banner__block">
            <span>最近一次运行</span>
            <strong>{environmentSnapshot().lastRunSummary || "尚无记录"}</strong>
            <small>
              {environmentSnapshot().lastRunStatus
                ? `${environmentRunStatusLabel(environmentSnapshot().lastRunStatus || "idle")} · ${formatTimestamp(environmentSnapshot().lastRunCompletedAt)}`
                : "完成后会在这里保留结果摘要"}
            </small>
          </div>
        </div>
      </section>

      <Show when={environmentSnapshot().approvals.length}>
        <section class="settings-section settings-section--flat">
          <div class="settings-section-heading">
            <span>等待批准</span>
            <StatusBadge tone="warning">{String(environmentSnapshot().approvals.length)}</StatusBadge>
          </div>
          <div class="environment-approval-list">
            <For each={environmentSnapshot().approvals}>
              {(approval) => {
                const summary = () => approvalSummary(approval)
                return (
                  <div class="environment-approval-card">
                    <div class="environment-approval-card__body">
                      <strong>{summary().title}</strong>
                      <span>{summary().primary}</span>
                      <small>{summary().secondary}</small>
                    </div>
                    <div class="settings-actions settings-actions--right">
                      <button class="btn btn-secondary" onClick={() => setSelectedEnvironmentApproval(approval)}>
                        <span class="codicon codicon-file-diff" aria-hidden="true" />
                        查看详情
                      </button>
                      <button class="btn btn-primary" onClick={() => replyEnvironmentApproval(approval, "allow_once")}>
                        批准一次
                      </button>
                      <button class="btn btn-secondary" onClick={() => replyEnvironmentApproval(approval, "deny_once")}>
                        拒绝
                      </button>
                    </div>
                  </div>
                )
              }}
            </For>
          </div>
        </section>
      </Show>

      <Show
        when={environmentSnapshot().entries.length}
        fallback={
          <div class="settings-empty-state">
            <span class="codicon codicon-tools" aria-hidden="true" />
          <strong>环境清单尚未加载。</strong>
          <small>进入本页后会尝试读取服务器环境清单，也可以手动刷新。</small>
          </div>
        }
      >
        {renderEnvironmentSection("cli", "CLI", "命令行工具、可执行程序和本地二进制依赖。")}
        {renderEnvironmentSection("mcp", "MCP", "需要注册到本地或项目环境中的 MCP 服务。")}
        {renderEnvironmentSection("skill", "Skills", "服务器要求可用的技能包和协作能力。")}
      </Show>

      <section class="settings-section settings-section--flat">
        <div class="settings-section-heading">
          <span>运行日志</span>
          <StatusBadge>{String(environmentSnapshot().logs.length)}</StatusBadge>
        </div>
        <Show when={environmentSnapshot().logs.length} fallback={<p class="settings-empty-note">环境任务开始后，这里会显示关键事件和最近输出。</p>}>
          <div class="environment-log-list">
            <For each={environmentSnapshot().logs}>
              {(log) => (
                <div class={`environment-log environment-log--${log.level}`}>
                  <div class="environment-log__meta">
                    <StatusBadge tone={log.level === "error" ? "error" : log.level === "warning" ? "warning" : "muted"}>
                      {log.level === "error" ? "错误" : log.level === "warning" ? "提示" : "输出"}
                    </StatusBadge>
                    <small>{formatTimestamp(log.createdAt)}</small>
                  </div>
                  <pre class="environment-log__message">{log.message}</pre>
                </div>
              )}
            </For>
          </div>
        </Show>
      </section>
      <Show when={selectedEnvironmentApproval()}>
        {(approval) => (
          <ApprovalDetailsDialog
            approval={approval()}
            onClose={() => setSelectedEnvironmentApproval(undefined)}
            onDecision={(decision) => replyEnvironmentApproval(approval(), decision)}
          />
        )}
      </Show>
      {renderToolchainEditor()}
    </div>
  )

  const renderToolchains = () => (
      <div class="settings-page settings-page--wide toolchain-dashboard-page">
        <div class="settings-page-header">
          <div>
            <h2>{t("toolchain.title")}</h2>
            <p>按 CLI / MCP / Skill 管理能力清单；部署属性、安装位置和运行结果在条目内展示。</p>
            <p class="setting-description">
              当前状态：{environmentRunStatusLabel(environmentSnapshot().status)} · 最近清单刷新：{formatTimestamp(environmentSnapshot().lastManifestAt)}
            </p>
          </div>
          <div class="settings-actions settings-actions--right">
            <label class="settings-inline-toggle">
              <input
                type="checkbox"
                checked={toolchainRunSerial()}
                onChange={(event) => setToolchainRunSerial(event.currentTarget.checked)}
              />
              <span>全部操作串行执行</span>
            </label>
            <button class="btn btn-secondary" onClick={refreshToolchains} disabled={environmentSnapshot().running}>
              <span class="codicon codicon-refresh" aria-hidden="true" />
              刷新
            </button>
            <button class="btn btn-secondary" onClick={() => runEnvironment("check")} disabled={!environmentSnapshot().entries.length || environmentSnapshot().running}>
              <span class="codicon codicon-search" aria-hidden="true" />
              检查全部
            </button>
            <button class="btn btn-primary" onClick={() => runEnvironment("configure")} disabled={!environmentSnapshot().entries.length || environmentSnapshot().running}>
              <span class="codicon codicon-tools" aria-hidden="true" />
              配置全部
            </button>
          </div>
        </div>

        <Show when={environmentError()}>
          <div class="settings-error">{environmentError()}</div>
        </Show>
        <Show when={toolchainError()}>
          <div class="settings-error">{toolchainError()}</div>
        </Show>
        <Show when={toolchainActionFeedback()}>
          <div class="settings-success">{toolchainActionFeedback()}</div>
        </Show>

        <div class="toolchain-summary-grid">
          <button class="toolchain-summary-card" classList={{ "is-active": toolchainStatusFilter() === "ready" }} onClick={() => setToolchainStatusFilter(toolchainStatusFilter() === "ready" ? "all" : "ready")}>
            <span>已就绪</span>
            <strong>{String(toolchainSummary().ready)}</strong>
          </button>
          <button class="toolchain-summary-card" classList={{ "is-active": toolchainStatusFilter() === "missing" }} onClick={() => setToolchainStatusFilter(toolchainStatusFilter() === "missing" ? "all" : "missing")}>
            <span>未安装</span>
            <strong>{String(toolchainSummary().missing)}</strong>
          </button>
          <button class="toolchain-summary-card" classList={{ "is-active": toolchainStatusFilter() === "stopped" }} onClick={() => setToolchainStatusFilter(toolchainStatusFilter() === "stopped" ? "all" : "stopped")}>
            <span>未运行</span>
            <strong>{String(toolchainSummary().stopped)}</strong>
          </button>
          <button class="toolchain-summary-card" classList={{ "is-active": toolchainStatusFilter() === "awaiting" }} onClick={() => setToolchainStatusFilter(toolchainStatusFilter() === "awaiting" ? "all" : "awaiting")}>
            <span>待授权/待确认</span>
            <strong>{String(toolchainSummary().awaiting)}</strong>
          </button>
        </div>

        <section class="settings-section settings-section--flat toolchain-ingest-panel">
          <div class="settings-section-heading">
            <div>
              <span>新增能力</span>
              <small>通过 fetch_Capabilities 读取文档资料并自动发现官方仓库，识别 CLI / MCP / Skill、部署属性和安装信息。</small>
            </div>
            <StatusBadge tone={toolchainIngestState().running === true ? "warning" : toolchainIngestState().persisted === true ? "success" : "muted"}>
              {toolchainIngestState().running === true ? "运行中" : toolchainIngestState().persisted === true ? "已写入" : "待命"}
            </StatusBadge>
          </div>
          <div class="toolchain-ingest-grid">
            <label class="field-label">
              <span>仓库地址（可选）</span>
              <input value={ingestRepoUrl()} placeholder="可留空，Agent 可从文档发现" onInput={(event) => setIngestRepoUrl(event.currentTarget.value)} />
            </label>
            <label class="field-label">
              <span>文档地址 / 资料链接</span>
              <input value={ingestDocsUrl()} placeholder="官方文档、README、安装指南 URL" onInput={(event) => setIngestDocsUrl(event.currentTarget.value)} />
            </label>
            <label class="field-label">
              <span>类型提示</span>
              <select value={ingestKindHint()} onChange={(event) => setIngestKindHint(event.currentTarget.value as ToolchainKindFilter)}>
                <option value="all">自动判断</option>
                <option value="cli">CLI</option>
                <option value="mcp">MCP</option>
                <option value="skill">Skill</option>
              </select>
            </label>
            <label class="field-label">
              <span>名称提示</span>
              <input value={ingestNameHint()} onInput={(event) => setIngestNameHint(event.currentTarget.value)} />
            </label>
            <label class="field-label">
              <span>可选部署提示</span>
              <input value={ingestPlacementHint()} placeholder="留空由 Agent 根据 fetch_Capabilities 证据判断" onInput={(event) => setIngestPlacementHint(event.currentTarget.value)} />
            </label>
            <div class="toolchain-ingest-actions">
              <button class="btn btn-primary" onClick={runToolchainIngest} disabled={toolchainIngestState().running === true || (!ingestRepoUrl().trim() && !ingestDocsUrl().trim() && !ingestDocsText().trim())}>
                <span class="codicon codicon-sparkle" aria-hidden="true" />
                {hasToolchainIngestDuplicates() ? "仍然新增能力" : "新增能力"}
              </button>
              <Show when={toolchainIngestState().running === true}>
                <button class="btn btn-danger" onClick={cancelToolchainIngest}>
                  <span class="codicon codicon-debug-stop" aria-hidden="true" />
                  停止
                </button>
              </Show>
            </div>
          </div>
          <label class="field-label">
            <span>补充文档片段</span>
            <textarea rows={3} value={ingestDocsText()} placeholder="可粘贴 README 安装段落、凭据说明或风险提示" onInput={(event) => setIngestDocsText(event.currentTarget.value)} />
          </label>
          <Show when={hasToolchainIngestDuplicates()}>
            <div class="settings-warning toolchain-duplicate-warning">
              <span class="codicon codicon-warning" aria-hidden="true" />
              <div>
                <strong>可能已存在相关能力</strong>
                <Show when={toolchainIngestDuplicates().repo.length}>
                  <p>相同仓库：{toolchainIngestDuplicates().repo.map(duplicateMatchLabel).join("、")}</p>
                </Show>
                <Show when={toolchainIngestDuplicates().docs.length}>
                  <p>相同文档：{toolchainIngestDuplicates().docs.map(duplicateMatchLabel).join("、")}</p>
                </Show>
              </div>
            </div>
          </Show>
        </section>

        <section class="toolchain-workbench">
          <div class="toolchain-list-pane">
            <div class="toolchain-toolbar">
              <div class="toolchain-kind-tabs" role="tablist" aria-label="工具类型筛选">
                <For each={[
                  ["all", "全部"],
                  ["cli", "CLI"],
                  ["mcp", "MCP"],
                  ["skill", "Skill"],
                ] as Array<[ToolchainKindFilter, string]>}>
                  {([id, label]) => (
                    <button classList={{ "is-active": toolchainKindFilter() === id }} onClick={() => setToolchainKindFilter(id)}>
                      {label}
                    </button>
                  )}
                </For>
              </div>
              <div class="toolchain-toolbar__search">
                <span class="codicon codicon-search" aria-hidden="true" />
                <input value={toolchainSearch()} placeholder="搜索工具、文档、命令" onInput={(event) => setToolchainSearch(event.currentTarget.value)} />
              </div>
            </div>

            <div class="toolchain-table" role="table" aria-label="能力清单">
              <div class="toolchain-table__row toolchain-table__row--head" role="row">
                <span>能力名称</span>
                <span>{t("toolchain.filterKind")}</span>
                <span>来源/文档</span>
                <span>部署属性</span>
                <span>安装/运行状态</span>
                <span>操作</span>
              </div>
              <Show when={filteredToolchainItems().length} fallback={<div class="toolchain-empty">没有匹配的能力条目。</div>}>
                <For each={filteredToolchainItems()}>
                  {(item) => {
                    const record = () => dashboardItemToRecord(item)
                    return (
                      <div
                        class="toolchain-table__row toolchain-table__row--item"
                        classList={{ "is-selected": selectedToolchainId() === item.id }}
                        role="row"
                        tabIndex={0}
                        onClick={() => setSelectedToolchainId(item.id)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault()
                            setSelectedToolchainId(item.id)
                          }
                        }}
                      >
                        <span class="toolchain-name-cell">
                          <strong>{item.name}</strong>
                          <small>{item.alias || item.command || "未记录别名"}</small>
                        </span>
                        <span><StatusBadge>{environmentKindLabel(item.kind)}</StatusBadge></span>
                        <span class="toolchain-source-cell">{toolchainSourceLabel(item)}</span>
                        <span>{placementLabel(item)}</span>
                        <span>
                          <StatusBadge tone={environmentStatusTone(item.status)}>
                            {environmentStatusLabel(item.status)}
                          </StatusBadge>
                        </span>
                        <span class="toolchain-row-actions">
                          <button class="ez-icon-button" title="检查" onClick={(event) => { event.stopPropagation(); runEnvironment("check", [item.id]) }}>
                            <span class="codicon codicon-search" aria-hidden="true" />
                          </button>
                          <button class="ez-icon-button" title="配置" onClick={(event) => { event.stopPropagation(); runEnvironment("configure", [item.id]) }}>
                            <span class="codicon codicon-tools" aria-hidden="true" />
                          </button>
                          <button class="ez-icon-button" title="编辑" onClick={(event) => { event.stopPropagation(); openEditToolchain(record()) }}>
                            <span class="codicon codicon-edit" aria-hidden="true" />
                          </button>
                          <button class="ez-icon-button" title={item.enabled ? "停用" : "启用"} onClick={(event) => { event.stopPropagation(); enableToolchain(record(), !item.enabled) }}>
                            <span class={`codicon codicon-${item.enabled ? "debug-pause" : "debug-start"}`} aria-hidden="true" />
                          </button>
                          <button class="ez-icon-button" title="删除" onClick={(event) => { event.stopPropagation(); deleteToolchain(record()) }}>
                            <span class="codicon codicon-trash" aria-hidden="true" />
                          </button>
                        </span>
                      </div>
                    )
                  }}
                </For>
              </Show>
            </div>
          </div>

          <aside class="toolchain-detail-pane">
            <Show when={selectedToolchain()} fallback={<div class="toolchain-empty">选择一个工具查看详情。</div>}>
              {(item) => (
                <>
                  <div class="toolchain-detail-header">
                    <div>
                      <span class="settings-badge">{environmentKindLabel(item().kind)}</span>
                      <h3>{item().name}</h3>
                      <p>{item().alias || item().source || "未记录说明"}</p>
                    </div>
                    <StatusBadge tone={environmentStatusTone(item().status)}>
                      {environmentStatusLabel(item().status)}
                    </StatusBadge>
                  </div>
                  <div class="toolchain-detail-actions">
                    <button class="btn btn-secondary" onClick={() => runEnvironment("check", [item().id])}>
                      <span class="codicon codicon-search" aria-hidden="true" />
                      检查
                    </button>
                    <button class="btn btn-primary" onClick={() => runEnvironment("configure", [item().id])}>
                      <span class="codicon codicon-tools" aria-hidden="true" />
                      配置
                    </button>
                    <button class="btn btn-secondary" onClick={() => openEditToolchain(dashboardItemToRecord(item()))}>
                      编辑
                    </button>
                  </div>

                  <div class="toolchain-detail-grid">
                    <div class="toolchain-detail-block">
                      <span>部署属性</span>
                      <strong>{placementLabel(item())}</strong>
                    </div>
                    <div class="toolchain-detail-block">
                      <span>结构化写入状态</span>
                      <strong>{item().last_action || (item().enabled ? "manifest" : "disabled")}</strong>
                      <small>{formatTimestamp(item().last_updated)}</small>
                    </div>
                  </div>

                  <div class="toolchain-detail-section">
                    <span>仓库/文档证据</span>
                    <Show when={item().repo_url || item().docs.length || item().source} fallback={<small>未记录。</small>}>
                      <div class="toolchain-link-list">
                        <Show when={item().repo_url}>
                          <a href={item().repo_url}>{item().repo_url}</a>
                        </Show>
                        <For each={item().docs}>
                          {(doc) => <a href={stringValue(doc.url)}>{stringValue(doc.title) || stringValue(doc.url)}</a>}
                        </For>
                        <Show when={!item().repo_url && !item().docs.length && item().source}>
                          <small>{item().source}</small>
                        </Show>
                      </div>
                    </Show>
                  </div>

                  <div class="toolchain-detail-section">
                    <span>LLM 提取依据</span>
                    <Show when={item().evidence.length} fallback={<small>尚未写入证据片段。</small>}>
                      <div class="toolchain-evidence-list">
                        <For each={item().evidence.slice(0, 4)}>
                          {(evidence) => (
                            <div>
                              <strong>{evidence.field || evidence.title || "evidence"}</strong>
                              <small>{evidence.excerpt || evidence.url || evidence.title}</small>
                            </div>
                          )}
                        </For>
                      </div>
                    </Show>
                  </div>

                  <div class="toolchain-detail-section">
                    <span>检查命令</span>
                    <code class="environment-command">{item().check || "未记录"}</code>
                  </div>
                  <div class="toolchain-detail-section">
                    <span>安装命令</span>
                    <code class="environment-command">{item().install || "未记录"}</code>
                  </div>
                  <div class="toolchain-detail-section">
                    <span>风险说明</span>
                    <small>
                      {item().risk_level || "未标注"}
                      {item().credentials.length ? ` · 需要凭据：${item().credentials.join(", ")}` : ""}
                    </small>
                  </div>
                  <div class="toolchain-detail-section">
                    <span>解析 Agent 日志</span>
                    <Show when={toolchainIngestLogs().length} fallback={<small>尚未运行新增能力 Agent。</small>}>
                      <div class="toolchain-ingest-log-list">
                        <For each={toolchainIngestLogs().slice(-6)}>
                          {(log) => (
                            <div class={`toolchain-ingest-log toolchain-ingest-log--${stringValue(log.level, "info")}`}>
                              <small>{formatTimestamp(log.createdAt)}</small>
                              <span>{stringValue(log.message)}</span>
                            </div>
                          )}
                        </For>
                      </div>
                    </Show>
                  </div>
                </>
              )}
            </Show>
          </aside>
        </section>

        <Show when={selectedEnvironmentApproval()}>
          {(approval) => (
            <ApprovalDetailsDialog
              approval={approval()}
              onClose={() => setSelectedEnvironmentApproval(undefined)}
              onDecision={(decision) => replyEnvironmentApproval(approval(), decision)}
            />
          )}
        </Show>
        {renderToolchainEditor()}
      </div>
    )

  const renderServerSettings = () => {
    const runtime = agentRuntimeState()
    return (
      <div class="settings-page">
        <div class="settings-page-header">
          <div>
            <h2>{t("serverSettings.title")}</h2>
            <p>管理所有 Agent 类型共享的服务端运行并发和 shell 执行并发。</p>
          </div>
          <div class="settings-actions settings-actions--right">
            <button class="btn btn-secondary" onClick={refreshServerSettings}>
              <span class="codicon codicon-refresh" aria-hidden="true" />
              刷新
            </button>
            <button class="btn btn-primary" onClick={saveServerSettings} disabled={!serverSettingsDirty()}>
              <span class="codicon codicon-save" aria-hidden="true" />
              保存
            </button>
          </div>
        </div>

        <Show when={server.serverSettingsError()}>
          <div class="settings-error">{server.serverSettingsError()}</div>
        </Show>
        <Show when={server.actionResult()?.ok === true && Object.keys(objectValue(objectValue(server.actionResult()?.settings).agent_runtime)).length > 0 && !serverSettingsDirty()}>
          <div class="settings-success">服务端设置已保存并重载。</div>
        </Show>

        <section class="settings-section settings-section--flat">
          <div class="settings-section-heading">
            <span>Agent 运行限制</span>
            <StatusBadge tone="muted">全局</StatusBadge>
          </div>
          <div class="settings-form-grid settings-form-grid--two">
            <label class="field-label">
              <span>同时允许运行的 Agent 数</span>
              <input
                type="number"
                min="1"
                step="1"
                value={serverMaxRunningAgents()}
                onInput={(event) => {
                  setServerMaxRunningAgents(Math.max(1, Math.floor(Number(event.currentTarget.value) || 1)))
                  setServerSettingsDirty(true)
                }}
              />
            </label>
            <label class="field-label">
              <span>每个 Agent 同时允许的 shell 执行数</span>
              <input
                type="number"
                min="1"
                step="1"
                value={serverMaxShellsPerAgent()}
                onInput={(event) => {
                  setServerMaxShellsPerAgent(Math.max(1, Math.floor(Number(event.currentTarget.value) || 1)))
                  setServerSettingsDirty(true)
                }}
              />
            </label>
          </div>
        </section>

        <section class="settings-section settings-section--flat">
          <div class="settings-section-heading">
            <span>当前运行态</span>
            <StatusBadge tone={numberValue(runtime.queued_agents, 0) > 0 ? "warning" : "success"}>
              {numberValue(runtime.running_agents, 0)} / {numberValue(runtime.max_running_agents, serverMaxRunningAgents())}
            </StatusBadge>
          </div>
          <div class="toolchain-detail-grid">
            <div class="toolchain-detail-block">
              <span>{t("serverSettings.runningAgents")}</span>
              <strong>{String(numberValue(runtime.running_agents, 0))}</strong>
            </div>
            <div class="toolchain-detail-block">
              <span>排队 Agent</span>
              <strong>{String(numberValue(runtime.queued_agents, 0))}</strong>
            </div>
            <div class="toolchain-detail-block">
              <span>shell 使用</span>
              <strong>{String(Object.keys(objectValue(runtime.shell_usage)).length)}</strong>
            </div>
            <div class="toolchain-detail-block">
              <span>shell 排队</span>
              <strong>{String(Object.values(objectValue(runtime.queued_shells)).reduce<number>((sum, item) => sum + numberValue(item, 0), 0))}</strong>
            </div>
          </div>
        </section>
      </div>
    )
  }

    const renderAgentConfig = () => (
    <div class="settings-page">
      <div class="settings-page-header">
        <div>
          <h2>{t("agentConfig.title")}</h2>
          <p>{t("agentConfig.desc")}</p>
        </div>
        <div class="settings-actions settings-actions--right">
          <button class="btn btn-secondary" onClick={refreshServerSettings}>
            <span class="codicon codicon-refresh" aria-hidden="true" />
            刷新
          </button>
          <button class="btn btn-primary" onClick={saveAgentConfig} disabled={!agentConfigDirty() || agentConfigSavePending()}>
            <span class="codicon codicon-save" aria-hidden="true" />
            {agentConfigSavePending() ? t("agentConfig.saving") : t("agentConfig.save")}
          </button>
        </div>
      </div>

      <Show when={server.serverSettingsError()}>
        <div class="settings-error">{server.serverSettingsError()}</div>
      </Show>
      <Show when={agentConfigError()}>
        <div class="settings-error">{agentConfigError()}</div>
      </Show>
      <Show when={agentConfigSaved()}>
        <div class="settings-success">{t("agentConfig.saved")}</div>
      </Show>

      {/* ── Runtime Profiles Section ── */}
      <section class="settings-section settings-section--flat">
        <div class="settings-section-heading">
          <span>{t("agentConfig.profiles")}</span>
          <StatusBadge tone="muted">{String(Object.keys(profileDrafts()).length)}</StatusBadge>
        </div>
        <p class="settings-empty-note">{t("agentConfig.profiles.desc")}</p>
        <div class="settings-master-detail">
          <div class="settings-master-list">
            <div class="settings-master-actions">
              <button class="btn btn-secondary" onClick={addProfile}>
                <span class="codicon codicon-add" aria-hidden="true" />
                {t("agentConfig.profile.add")}
              </button>
            </div>
            <Show when={Object.keys(profileDrafts()).length === 0}>
              <p class="settings-empty-note">{t("agentConfig.profile.empty")}</p>
            </Show>
            <For each={Object.keys(profileDrafts())}>
              {(pid) => (
                <div
                  class={`settings-master-item ${selectedProfileId() === pid ? "settings-master-item--active" : ""}`}
                  onClick={() => setSelectedProfileId(pid)}
                >
                  <div class="settings-master-item__info">
                    <strong>{pid}</strong>
                    <small>{profileDrafts()[pid]?.executor} · {profileDrafts()[pid]?.execution_location}</small>
                  </div>
                  <button class="btn-icon" onClick={(e) => { e.stopPropagation(); deleteProfile(pid) }} title={t("agentConfig.profile.delete")}>
                    <span class="codicon codicon-trash" aria-hidden="true" />
                  </button>
                </div>
              )}
            </For>
          </div>
          <div class="settings-detail-panel">
            <Show when={currentProfileDraft()} fallback={<p class="settings-empty-note">{t("agentConfig.profile.noSelection")}</p>}>
              <div class="settings-form-grid">
                <label class="field-label field-label--full"><span>{t("agentConfig.profile.id")}</span>
                  <input
                    value={currentProfileDraft()!.id}
                    disabled={currentProfileIdLocked()}
                    onChange={(e) => renameProfile(e.currentTarget.value, e.currentTarget)}
                  />
                  <small class="field-help">
                    {currentProfileIdLocked() ? t("agentConfig.profile.idLocked") : t("agentConfig.profile.idHelp")}
                  </small>
                </label>
                <label class="field-label"><span>{t("agentConfig.profile.executor")}</span>
                  <select ref={profileExecutorSelect} value={currentProfileDraft()!.executor} onChange={(e) => updateProfileField("executor", e.currentTarget.value)}>
                    <For each={PROFILE_EXECUTOR_OPTIONS}>{(option) => <option value={option.value}>{t(option.labelKey)}</option>}</For>
                  </select>
                  <small class="field-help">{runtimeOptionDescription(PROFILE_EXECUTOR_OPTIONS, currentProfileDraft()!.executor)}</small>
                </label>
                <label class="field-label"><span>{t("agentConfig.profile.executionLocation")}</span>
                  <select value={currentProfileDraft()!.execution_location} onChange={(e) => updateProfileField("execution_location", e.currentTarget.value)}>
                    <For each={PROFILE_EXECUTION_LOCATION_OPTIONS}>{(option) => <option value={option.value}>{t(option.labelKey)}</option>}</For>
                  </select>
                  <small class="field-help">{runtimeOptionDescription(PROFILE_EXECUTION_LOCATION_OPTIONS, currentProfileDraft()!.execution_location)}</small>
                </label>
                <label class="field-label"><span>{t("agentConfig.profile.model")}</span>
                  <select value={currentProfileDraft()!.model} onChange={(e) => updateProfileField("model", e.currentTarget.value)}>
                    <option value="">{t("agentConfig.profile.model.default")}</option>
                    <For each={runtimeModelOptions()}>{(option) => (
                      <option value={option.value}>{option.label} · {option.detail}</option>
                    )}</For>
                  </select>
                  <small class="field-help">
                    {runtimeModelOptions().length > 0 ? t("agentConfig.profile.model.help") : t("agentConfig.profile.model.empty")}
                  </small>
                </label>
                <label class="field-label"><span>{t("agentConfig.profile.runtimeHomePolicy")}</span>
                  <select value={currentProfileDraft()!.runtime_home_policy} onChange={(e) => updateProfileField("runtime_home_policy", e.currentTarget.value)}>
                    <For each={PROFILE_HOME_POLICY_OPTIONS}>{(option) => <option value={option.value}>{t(option.labelKey)}</option>}</For>
                  </select>
                  <small class="field-help">{runtimeOptionDescription(PROFILE_HOME_POLICY_OPTIONS, currentProfileDraft()!.runtime_home_policy)}</small>
                </label>
                <label class="field-label"><span>{t("agentConfig.profile.approvalMode")}</span>
                  <select value={currentProfileDraft()!.approval_mode} onChange={(e) => updateProfileField("approval_mode", e.currentTarget.value)}>
                    <For each={PROFILE_APPROVAL_MODE_OPTIONS}>{(option) => <option value={option.value}>{t(option.labelKey)}</option>}</For>
                  </select>
                  <small class="field-help">{runtimeOptionDescription(PROFILE_APPROVAL_MODE_OPTIONS, currentProfileDraft()!.approval_mode)}</small>
                </label>
                <label class="field-label field-label--full"><span>{t("agentConfig.profile.mcpServers")}</span>
                  {renderStringChoiceList(
                    registeredMcpServers(),
                    currentProfileDraft()!.mcpServersText,
                    (next) => updateProfileField("mcpServersText", next),
                    t("agentConfig.profile.mcpServers.empty"),
                  )}
                  <small class="field-help">{t("agentConfig.profile.mcpServersDesc")}</small>
                </label>
                <Show when={profileMcpValidationWarnings().length > 0}>
                  <div class="settings-warning">
                    <span class="codicon codicon-warning" aria-hidden="true" />
                    <span>{t("agentConfig.profile.mcpNotRegistered")}: {profileMcpValidationWarnings().join(", ")}</span>
                  </div>
                </Show>
                <details class="settings-details settings-details--embedded field-label--full">
                  <summary>
                    <span class="codicon codicon-settings-gear" aria-hidden="true" />
                    {t("agentConfig.advanced")}
                  </summary>
                  <div class="settings-form-grid">
                    <label class="field-label"><span>{t("agentConfig.profile.command")}</span>
                      <input value={currentProfileDraft()!.command} onInput={(e) => updateProfileField("command", e.currentTarget.value)} placeholder={currentProfileDraft()!.executor} />
                      <small class="field-help">{t("agentConfig.profile.commandDesc")}</small>
                    </label>
                    <label class="field-label"><span>{t("agentConfig.profile.configIsolation")}</span>
                      <select value={currentProfileDraft()!.config_isolation} onChange={(e) => updateProfileField("config_isolation", e.currentTarget.value)}>
                        <For each={PROFILE_CONFIG_ISOLATION_OPTIONS}>{(option) => <option value={option.value}>{t(option.labelKey)}</option>}</For>
                      </select>
                      <small class="field-help">{runtimeOptionDescription(PROFILE_CONFIG_ISOLATION_OPTIONS, currentProfileDraft()!.config_isolation)}</small>
                    </label>
                    <label class="field-label"><span>{t("agentConfig.profile.args")}</span>
                      <textarea rows={3} value={currentProfileDraft()!.argsText} onInput={(e) => updateProfileField("argsText", e.currentTarget.value)} placeholder={'["--flag"]'} />
                      <small class="field-help">{t("agentConfig.profile.argsDesc")}</small>
                    </label>
                    <label class="field-label"><span>{t("agentConfig.profile.env")}</span>
                      <textarea rows={3} value={currentProfileDraft()!.envText} onInput={(e) => updateProfileField("envText", e.currentTarget.value)} placeholder={'{"KEY":"value"}'} />
                      <small class="field-help">{t("agentConfig.profile.envDesc")}</small>
                    </label>
                    <label class="field-label field-label--full"><span>{t("agentConfig.profile.credentialRefs")}</span>
                      <textarea rows={3} value={currentProfileDraft()!.credentialRefsText} onInput={(e) => updateProfileField("credentialRefsText", e.currentTarget.value)} placeholder={t("agentConfig.profile.credentialRefsDesc")} />
                      <small class="field-help">{t("agentConfig.profile.credentialRefsHelp")}</small>
                    </label>
                  </div>
                </details>
              </div>
            </Show>
          </div>
        </div>
      </section>

      {/* ── Agents Section ── */}
      <section class="settings-section settings-section--flat">
        <div class="settings-section-heading">
          <span>{t("agentConfig.agents")}</span>
          <StatusBadge tone="muted">{String(Object.keys(agentDrafts()).length)}</StatusBadge>
        </div>
        <p class="settings-empty-note">{t("agentConfig.agents.desc")}</p>
        <div class="settings-master-detail">
          <div class="settings-master-list">
            <div class="settings-master-actions">
              <button class="btn btn-secondary" onClick={addAgent}>
                <span class="codicon codicon-add" aria-hidden="true" />
                {t("agentConfig.agent.add")}
              </button>
            </div>
            <Show when={Object.keys(agentDrafts()).length === 0}>
              <p class="settings-empty-note">{t("agentConfig.agent.empty")}</p>
            </Show>
            <For each={Object.keys(agentDrafts())}>
              {(aid) => (
                <div
                  class={`settings-master-item ${selectedAgentId() === aid ? "settings-master-item--active" : ""}`}
                  onClick={() => setSelectedAgentId(aid)}
                >
                  <div class="settings-master-item__info">
                    <strong>{agentDrafts()[aid]?.name || aid}</strong>
                    <small>{agentDrafts()[aid]?.runtime_profile || "—"}</small>
                  </div>
                  <button class="btn-icon" onClick={(e) => { e.stopPropagation(); deleteAgent(aid) }} title={t("agentConfig.agent.delete")}>
                    <span class="codicon codicon-trash" aria-hidden="true" />
                  </button>
                </div>
              )}
            </For>
          </div>
          <div class="settings-detail-panel">
            <Show when={currentAgentDraft()} fallback={<p class="settings-empty-note">{t("agentConfig.agent.noSelection")}</p>}>
              <div class="settings-form-grid">
                <label class="field-label field-label--full"><span>{t("agentConfig.agent.id")}</span>
                  <input
                    value={currentAgentDraft()!.id}
                    disabled={currentAgentIdLocked()}
                    onChange={(e) => renameAgent(e.currentTarget.value, e.currentTarget)}
                  />
                  <small class="field-help">
                    {currentAgentIdLocked() ? t("agentConfig.agent.idLocked") : t("agentConfig.agent.idHelp")}
                  </small>
                </label>
                <label class="field-label"><span>{t("agentConfig.agent.name")}</span>
                  <input ref={agentNameInput} value={currentAgentDraft()!.name} onInput={(e) => updateAgentField("name", e.currentTarget.value)} />
                </label>
                <label class="field-label"><span>{t("agentConfig.agent.description")}</span>
                  <input value={currentAgentDraft()!.description} onInput={(e) => updateAgentField("description", e.currentTarget.value)} />
                </label>
                <label class="field-label"><span>{t("agentConfig.agent.runtimeProfile")}</span>
                  <select value={currentAgentDraft()!.runtime_profile} onChange={(e) => updateAgentField("runtime_profile", e.currentTarget.value)}>
                    <option value="">{t("agentConfig.agent.runtimeProfile.none")}</option>
                    <For each={profileIdList()}>{(pid) => <option value={pid}>{pid}</option>}</For>
                  </select>
                  <small class="field-help">{t("agentConfig.agent.runtimeProfileDesc")}</small>
                </label>
                <label class="field-label"><span>{t("agentConfig.agent.maxConcurrentTasks")}</span>
                  <input type="number" min="1" step="1" value={currentAgentDraft()!.max_concurrent_tasks} onInput={(e) => updateAgentField("max_concurrent_tasks", Math.max(1, Math.floor(Number(e.currentTarget.value) || 1)))} />
                  <small class="field-help">{t("agentConfig.agent.maxConcurrentTasksDesc")}</small>
                </label>
                <label class="field-label field-label--full"><span>{t("agentConfig.agent.capabilities")}</span>
                  {renderRuntimeChoiceList(
                    AGENT_CAPABILITY_OPTIONS,
                    currentAgentDraft()!.capabilitiesText,
                    (next) => updateAgentField("capabilitiesText", next),
                    ", ",
                  )}
                  <small class="field-help">{t("agentConfig.agent.capabilitiesDesc")}</small>
                </label>
                <label class="field-label field-label--full"><span>{t("agentConfig.agent.systemAppend")}</span>
                  <textarea rows={4} value={currentAgentDraft()!.systemAppend} onInput={(e) => updateAgentField("systemAppend", e.currentTarget.value)} />
                  <small class="field-help">{t("agentConfig.agent.systemAppendDesc")}</small>
                </label>
                <label class="field-label field-label--full"><span>{t("agentConfig.agent.mcpServers")}</span>
                  {renderStringChoiceList(
                    registeredMcpServers(),
                    currentAgentDraft()!.mcpServersText,
                    (next) => updateAgentField("mcpServersText", next),
                    t("agentConfig.profile.mcpServers.empty"),
                  )}
                  <small class="field-help">{t("agentConfig.agent.mcpServersDesc")}</small>
                </label>
                <Show when={agentMcpValidationWarnings().length > 0}>
                  <div class="settings-warning">
                    <span class="codicon codicon-warning" aria-hidden="true" />
                    <span>{t("agentConfig.profile.mcpNotRegistered")}: {agentMcpValidationWarnings().join(", ")}</span>
                  </div>
                </Show>
                <label class="field-label field-label--full"><span>{t("agentConfig.agent.skills")}</span>
                  {renderStringChoiceList(
                    skillNameOptions(),
                    currentAgentDraft()!.skillsText,
                    (next) => updateAgentField("skillsText", formatAgentConfigList(parseAgentConfigListText(next), ", ")),
                    t("agentConfig.agent.skills.empty"),
                    ", ",
                  )}
                  <small class="field-help">{t("agentConfig.agent.skillsDesc")}</small>
                </label>
                <details class="settings-details settings-details--embedded field-label--full">
                  <summary>
                    <span class="codicon codicon-settings-gear" aria-hidden="true" />
                    {t("agentConfig.advanced")}
                  </summary>
                  <div class="settings-form-grid">
                    <label class="field-label field-label--full"><span>{t("agentConfig.agent.credentialRefs")}</span>
                      <textarea rows={3} value={currentAgentDraft()!.credentialRefsText} onInput={(e) => updateAgentField("credentialRefsText", e.currentTarget.value)} placeholder={t("agentConfig.agent.credentialRefsPlaceholder")} />
                      <small class="field-help">{t("agentConfig.agent.credentialRefsDesc")}</small>
                    </label>
                  </div>
                </details>
              </div>
            </Show>
          </div>
        </div>
      </section>

      <section class="settings-section settings-section--flat">
        <div class="settings-section-heading">
          <span>{t("agentConfig.runtimeTest.title")}</span>
          <StatusBadge tone={runtimePolling() ? "warning" : runtimeTerminal() ? "success" : "muted"}>
            {selectedRuntimeTaskId() || t("agentConfig.runtimeTest.idle")}
          </StatusBadge>
        </div>
        <p class="settings-empty-note">{t("agentConfig.runtimeTest.desc")}</p>
        <div class="settings-form-grid">
          <label class="field-label field-label--full"><span>{t("agentConfig.runtimeTest.prompt")}</span>
            <textarea rows={4} value={runtimePrompt()} onInput={(e) => setRuntimePrompt(e.currentTarget.value)} />
          </label>
          <div class="settings-actions settings-actions--left field-label--full">
            <button class="btn btn-primary" onClick={submitRuntimeAgentTask} disabled={runtimeSubmitting() || !selectedAgentId()}>
              <span class="codicon codicon-play" aria-hidden="true" />
              {runtimeSubmitting() ? t("agentConfig.runtimeTest.submitting") : t("agentConfig.runtimeTest.submit")}
            </button>
            <button class="btn btn-secondary" onClick={cancelRuntimeAgentTask} disabled={!selectedRuntimeTaskId() || runtimeTerminal()}>
              <span class="codicon codicon-debug-stop" aria-hidden="true" />
              {t("agentConfig.runtimeTest.cancel")}
            </button>
            <button class="btn btn-secondary" onClick={retryRuntimeAgentTask} disabled={!selectedRuntimeTaskId() || runtimeSubmitting()}>
              <span class="codicon codicon-refresh" aria-hidden="true" />
              {t("agentConfig.runtimeTest.retry")}
            </button>
          </div>
        </div>
        <Show when={runtimeError()}>
          <div class="settings-error">{runtimeError()}</div>
        </Show>
        <Show when={runtimeTask()}>
          <pre class="settings-result">{JSON.stringify(runtimeTask(), null, 2)}</pre>
        </Show>
        <div class="runtime-event-list">
          <Show when={runtimeEvents().length > 0} fallback={<p class="settings-empty-note">{t("agentConfig.runtimeTest.noEvents")}</p>}>
            <For each={runtimeEvents()}>
              {(event) => (
                <div class="runtime-event">
                  <span class="runtime-event__seq">#{String(numberValue(event.seq, 0))}</span>
                  <strong>{stringValue(event.type)}</strong>
                  <code>{JSON.stringify(objectValue(event.payload))}</code>
                </div>
              )}
            </For>
          </Show>
        </div>
      </section>
    </div>
  )

const renderCommandRuleEditor = (
    kind: "allow" | "deny",
    title: string,
    description: string,
    rules: string[],
    value: string,
    setValue: (value: string) => void,
  ) => (
    <div class="command-rule-editor">
      <div class="command-rule-editor__header">
        <strong>{title}</strong>
        <small>{description}</small>
      </div>
      <div class="command-rule-editor__input">
        <input
          value={value}
          placeholder={kind === "allow" ? "例如：git status" : "例如：git push"}
          onInput={(event) => setValue(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return
            event.preventDefault()
            addCommandRule(kind)
          }}
        />
        <button class="btn btn-secondary" type="button" onClick={() => addCommandRule(kind)}>
          添加
        </button>
      </div>
      <Show when={rules.length} fallback={<p class="settings-empty-note">尚未配置。</p>}>
        <div class="command-rule-chips">
          <For each={rules}>
            {(rule) => (
              <span class="command-rule-chip">
                <code>{rule}</code>
                <button type="button" onClick={() => removeCommandRule(kind, rule)} aria-label={`删除 ${rule}`}>
                  <span class="codicon codicon-close" aria-hidden="true" />
                </button>
              </span>
            )}
          </For>
        </div>
      </Show>
    </div>
  )

  const renderAutoApproval = () => (
    <div class="settings-page settings-page--narrow">
      <div class="settings-page-header">
        <div>
          <h2>自动批准</h2>
          <p>管理聊天中的自动批准规则。执行命令仍按白名单、黑名单和危险模式判定。</p>
        </div>
        <button class="btn btn-secondary" onClick={() => vscode.postMessage({ type: "autoApproval.get" })}>
          <span class="codicon codicon-refresh" aria-hidden="true" />
          刷新
        </button>
      </div>

      <section class="settings-section settings-section--flat command-approval-section">
        <div class="settings-section-heading">
          <span>{t("autoApproval.execute")}</span>
          <div class="settings-badge-group">
            <StatusBadge tone={autoApprovalOptions().execute ? "warning" : "muted"}>
              {autoApprovalOptions().execute ? t("autoApproval.enabled") : t("autoApproval.disabled")}
            </StatusBadge>
            <StatusBadge>{autoApprovalPlatform()}</StatusBadge>
          </div>
        </div>
        <p class="settings-empty-note">
          聊天栏开启“执行”后，只会自动批准命中白名单且未被更具体黑名单覆盖的命令。白名单为空时不会自动批准 shell 命令。
        </p>
        <div class="command-rule-grid">
          {renderCommandRuleEditor(
            "allow",
            t("autoApproval.allowList"),
            t("autoApproval.allowListDesc"),
            allowedCommands(),
            allowedCommandInput(),
            setAllowedCommandInput
          )}
          {renderCommandRuleEditor(
            "deny",
            t("autoApproval.denyList"),
            t("autoApproval.denyListDesc"),
            deniedCommands(),
            deniedCommandInput(),
            setDeniedCommandInput
          )}
        </div>
        <div class="command-rule-examples">
          <span>{t("autoApproval.examples")}</span>
          <code>git status</code>
          <code>npm test</code>
          <code>pytest</code>
          <code>npx tsc --noEmit</code>
        </div>
        <Show when={allowedCommands().includes("*")}>
          <div class="settings-warning">
            <span class="codicon codicon-warning" aria-hidden="true" />
            <span>{t("autoApproval.wildcardWarning")}</span>
          </div>
        </Show>
        <Show when={autoApprovalOptions().execute && allowedCommands().length === 0}>
          <div class="settings-warning">
            <span class="codicon codicon-warning" aria-hidden="true" />
            <span>{t("autoApproval.emptyAllowListWarning")}</span>
          </div>
        </Show>
      </section>
    </div>
  )

  const renderOther = () => (
    <div class="settings-page settings-page--narrow">
      <div class="settings-page-header">
        <div>
          <h2>{t("other.title")}</h2>
          <p>{t("other.desc")}</p>
        </div>
        <button class="btn btn-secondary" onClick={refreshAdmin}>
          <span class="codicon codicon-refresh" aria-hidden="true" />
          刷新
        </button>
      </div>

      <section class="settings-section settings-section--flat language-section">
        <div class="settings-section-heading">
          <span class="codicon codicon-globe" aria-hidden="true" />
          <span>{t("other.language")}</span>
        </div>
        <p class="settings-empty-note">{t("other.languageDesc")}</p>
        <div class="language-picker">
          <For each={LOCALES as unknown as { id: string; label: string; nativeLabel: string }[]}>
            {(loc) => (
              <button
                type="button"
                class={`language-option ${locale() === loc.id ? "language-option--active" : ""}`}
                onClick={() => setLocale(loc.id as Locale, (msg) => vscode.postMessage(msg))}
              >
                <span class="language-option__native">{loc.nativeLabel}</span>
                <span class="language-option__label">{loc.label}</span>
                <Show when={locale() === loc.id}>
                  <span class="codicon codicon-check" aria-hidden="true" />
                </Show>
              </button>
            )}
          </For>
        </div>
      </section>

      <Show when={server.adminError()}>
        <div class="settings-error">{server.adminError()}</div>
      </Show>
      <details class="settings-details">
        <summary>
          <span class="codicon codicon-output" aria-hidden="true" />
          {t("other.lastAction")}
        </summary>
        <pre class="settings-result">{JSON.stringify(server.actionResult() || {}, null, 2)}</pre>
      </details>
      <details class="settings-details">
        <summary>
          <span class="codicon codicon-radio-tower" aria-hidden="true" />
          {t("other.connectionState")}
        </summary>
        <pre class="settings-result">{JSON.stringify(server.connectionState(), null, 2)}</pre>
      </details>
      <details class="settings-details">
        <summary>
          <span class="codicon codicon-server-process" aria-hidden="true" />
          {t("other.adminState")}
        </summary>
        <pre class="settings-result">{JSON.stringify(server.adminState(), null, 2)}</pre>
      </details>
    </div>
  )

  const renderActiveTab = () => {
    switch (activeTab()) {
      case "executors":
        return renderExecutors()
      case "providers":
        return renderProviderManagement()
      case "toolchains":
        return renderToolchains()
      case "serverSettings":
        return renderServerSettings()
      case "agentConfig":
        return renderAgentConfig()
      case "autoApproval":
        return renderAutoApproval()
      case "other":
        return renderOther()
    }
  }

  return (
    <div class="settings-view">
      <div class="settings-shell-header">
        <div>
          <h1>
            <span class="codicon codicon-settings-gear" aria-hidden="true" />
            {t("settings.title")}
          </h1>
          <p>{t("settings.subtitle")}</p>
        </div>
        <span class="settings-version">v{server.extensionVersion() || "0.0.0"}</span>
      </div>

      <div class="settings-shell">
        <nav class="settings-tab-list" aria-label="dogcode settings">
          <For each={settingsTabDefs}>
            {(tab) => (
              <button
                type="button"
                class={`settings-tab ${activeTab() === tab.id ? "settings-tab--active" : ""}`}
                aria-current={activeTab() === tab.id ? "page" : undefined}
                title={t(tab.labelKey)}
                onClick={() => switchTab(tab.id)}
              >
                <span class={`codicon codicon-${tab.icon}`} aria-hidden="true" />
                <span class="settings-tab__label">{t(tab.labelKey)}</span>
              </button>
            )}
          </For>
        </nav>
        <main class="settings-tab-content">{renderActiveTab()}</main>
      </div>
    </div>
  )
}

export default SettingsView
