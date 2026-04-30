import { Component, For, JSX, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js"
import { useVSCode } from "../context/vscode"
import { useServer } from "../context/server"
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
type SettingsTab = "executors" | "providers" | "toolchains" | "autoApproval" | "other"
type ModelTarget = "main" | "sub" | "both"
type ModelDetailMode = "fetched" | "custom"
type ModelActionIntent = "" | "savePreset" | "activateMain" | "activateSub" | "activateBoth"
type EnvironmentEntryKind = "cli" | "mcp" | "skill"
type ToolchainKind = EnvironmentEntryKind
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
type EnvironmentSnapshotStatus = "idle" | "running" | "completed" | "error" | "canceled"

interface SettingsViewProps {
  targetTab?: string
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
  install_prompt?: string
  verify_prompt?: string
  notes?: string[]
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
  docsText: string
  installPrompt: string
  verifyPrompt: string
  notesText: string
}

const providerTypes: ProviderType[] = ["openai_chat", "anthropic_messages", "openai_responses"]
const compats: ProviderCompat[] = ["generic", "deepseek", "kimi", "glm", "qwen", "zenmux"]

const settingsTabs: Array<{ id: SettingsTab; label: string; icon: string }> = [
  { id: "executors", label: "执行器管理", icon: "radio-tower" },
  { id: "providers", label: "服务商管理", icon: "server-process" },
  { id: "toolchains", label: "工具链管理", icon: "tools" },
  { id: "autoApproval", label: "自动批准", icon: "shield" },
  { id: "other", label: "其他", icon: "settings" },
]

function normalizeSettingsTab(value: unknown): SettingsTab | undefined {
  switch (value) {
    case "providers":
      return "providers"
    case "executors":
      return "executors"
    case "toolchains":
      return "toolchains"
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

function normalizeHostUrl(value: string): string {
  return value.trim().replace(/\/+$/, "")
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
    placement: "peer",
    distribution: "command",
    requirementsText: "",
    scope: "project",
    check: "",
    install: "",
    version: "",
    source: "",
    description: "",
    pathHint: "",
    docsText: "",
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
    docsText: docsText(record.docs),
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
    docs: parseDocsText(editor.docsText),
    install_prompt: editor.installPrompt.trim(),
    verify_prompt: editor.verifyPrompt.trim(),
    notes: parseStringList(editor.notesText),
  }
  if (editor.kind === "cli") {
    payload.command = editor.command.trim()
    payload.capabilities = parseStringList(editor.capabilitiesText)
  } else if (editor.kind === "mcp") {
    payload.command = editor.command.trim()
    payload.args = parseStringList(editor.argsText)
    payload.env = parseMapText(editor.envText)
    payload.cwd = editor.cwd.trim() || undefined
    payload.placement = editor.placement || "peer"
    payload.distribution = editor.distribution || "command"
    payload.requirements = parseMapText(editor.requirementsText)
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
      return "可用"
    case "missing":
      return "缺失"
    case "awaiting_approval":
      return "等待批准"
    case "downloading":
      return "下载中"
    case "installing":
      return "安装中"
    case "configured":
      return "已配置"
    case "failed":
      return "失败"
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
      return "warning"
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

const StatusBadge: Component<{ tone?: "success" | "warning" | "muted" | "error"; children: JSX.Element }> = (props) => {
  return <span class={`settings-badge settings-badge--${props.tone || "muted"}`}>{props.children}</span>
}

const SettingsView: Component<SettingsViewProps> = (props) => {
  const vscode = useVSCode()
  const server = useServer()

  const [activeTab, setActiveTab] = createSignal<SettingsTab>("providers")

  const [hostUrl, setHostUrl] = createSignal("")
  const [adminSecret, setAdminSecret] = createSignal("")
  const [bootstrapSecret, setBootstrapSecret] = createSignal("")
  const [hostUrlDirty, setHostUrlDirty] = createSignal(false)

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
  const [selectedEnvironmentApproval, setSelectedEnvironmentApproval] = createSignal<EnvironmentApprovalState | undefined>()
  const [toolchainBootstrapped, setToolchainBootstrapped] = createSignal(false)
  const [toolchainEditor, setToolchainEditor] = createSignal<ToolchainEditorState | undefined>()
  const [autoApprovalOptions, setAutoApprovalOptions] = createSignal<Record<string, boolean>>(DEFAULT_AUTO_APPROVE_OPTIONS)
  const [allowedCommandInput, setAllowedCommandInput] = createSignal("")
  const [deniedCommandInput, setDeniedCommandInput] = createSignal("")
  const [allowedCommands, setAllowedCommands] = createSignal<string[]>([])
  const [deniedCommands, setDeniedCommands] = createSignal<string[]>([])
  const [autoApprovalPlatform, setAutoApprovalPlatform] = createSignal("browser")

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
  const currentHostUrl = createMemo(() => stringValue(server.connectionState().hostUrl))
  const hostUrlSource = createMemo(() => stringValue(server.connectionState().hostUrlSource, "unknown"))
  const hostUrlConfigured = createMemo(() => server.connectionState().hostUrlConfigured === true)
  const adminUsable = createMemo(() => server.connectionState().adminReachable === true)
  const hostUrlDraftDiffers = createMemo(() => {
    const draft = normalizeHostUrl(hostUrl())
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
    const label = kind === "cli" ? "CLI" : kind === "mcp" ? "MCP" : kind === "skill" ? "Skill" : "工具链"
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

  const switchTab = (tab: SettingsTab) => {
    setActiveTab(tab)
    vscode.postMessage({ type: "settingsTabChanged", tab })
  }

  const refreshAdmin = () => vscode.postMessage({ type: "admin.refresh" })
  const refreshEnvironmentManifest = () => vscode.postMessage({ type: "environment.refreshManifest" })
  const runEnvironment = (mode: "check" | "configure") => vscode.postMessage({ type: "environment.run", mode })
  const stopEnvironmentRun = () => vscode.postMessage({ type: "environment.cancel" })
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
    setHostUrlDirty(false)
    vscode.postMessage({
      type: "connection.save",
      hostUrl: normalizeHostUrl(hostUrl()),
      adminSecret: adminSecret(),
      bootstrapSecret: bootstrapSecret(),
    })
    setAdminSecret("")
    setBootstrapSecret("")
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
    const current = currentHostUrl()
    if (!hostUrlDirty() && current) {
      setHostUrl(current)
    }
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
                  <StatusBadge>已保存预设</StatusBadge>
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
          <h2>执行器管理</h2>
          <p>管理当前 VS Code 前端连接的 EZCode 执行器地址和密钥；后续可在这里接入更多 agent 执行器。</p>
        </div>
        <button class="btn btn-secondary" onClick={refreshAdmin}>
          <span class="codicon codicon-refresh" aria-hidden="true" />
          刷新
        </button>
      </div>

      <section class="settings-section">
        <div class="settings-status-line">
          <StatusBadge tone={connectionStatus() === "ready" ? "success" : connectionStatus() === "error" ? "warning" : "muted"}>
            {connectionStatus() === "ready" ? "执行器可用" : connectionStatus() === "error" ? "执行器不可用" : "执行器连接未完成"}
          </StatusBadge>
          <StatusBadge tone={hostUrlConfigured() ? "success" : "warning"}>
            Host 来源：{hostUrlSource()}
          </StatusBadge>
          <StatusBadge tone={server.connectionState().adminSecretSet ? "success" : "warning"}>
            Admin secret {server.connectionState().adminSecretSet ? "已保存" : "未保存"}
          </StatusBadge>
          <StatusBadge tone={server.connectionState().bootstrapSecretSet ? "success" : "warning"}>
            Bootstrap secret {server.connectionState().bootstrapSecretSet ? "已保存" : "未保存"}
          </StatusBadge>
        </div>
        <p class="setting-description">当前实际请求执行器：{stringValue(server.connectionState().hostUrl, "未配置")}</p>
        <Show when={connectionMessage()}>
          <div class="settings-error">{connectionMessage()}</div>
        </Show>
        <Show when={hostUrlDraftDiffers()}>
          <div class="settings-action-result">
            <div>
              <strong>Host URL 输入框尚未生效</strong>
              <small>实际请求仍使用 {currentHostUrl()}；点击“保存执行器连接”后才会切换。</small>
            </div>
          </div>
        </Show>
        <Show when={isDefaultLocalHost()}>
          <div class="settings-action-result">
            <div>
              <strong>当前执行器是本机默认地址</strong>
              <small>如果 EZCode 执行器部署在服务器，请改为服务器地址，例如 http://192.168.50.149:8765。</small>
            </div>
          </div>
        </Show>
        <div class="settings-form-grid">
          <label class="field-label">
            <span>Host URL</span>
            <input class="setting-input" value={hostUrl()} placeholder="http://192.168.50.149:8765" onInput={(event) => {
              setHostUrlDirty(true)
              setHostUrl(event.currentTarget.value)
            }} />
          </label>
          <label class="field-label">
            <span>Admin secret</span>
            <input class="setting-input" value={adminSecret()} type="password" placeholder="留空则保留本地已保存值" onInput={(event) => setAdminSecret(event.currentTarget.value)} />
          </label>
          <label class="field-label">
            <span>Bootstrap secret</span>
            <input class="setting-input" value={bootstrapSecret()} type="password" placeholder="留空则保留本地已保存值" onInput={(event) => setBootstrapSecret(event.currentTarget.value)} />
          </label>
        </div>
        <div class="settings-actions">
          <button class="btn btn-primary" onClick={saveConnection}>
            <span class="codicon codicon-save" aria-hidden="true" />
            保存执行器连接
          </button>
        </div>
      </section>
    </div>
  )

  const renderProviderManagement = () => (
    <div class="settings-page settings-page--wide">
      <div class="settings-page-header">
        <div>
          <h2>服务商管理</h2>
          <p>按“服务商 → 模型 → 主/副模型”的路径完成配置，API Key 保存在 host 配置中，前端不回显明文。</p>
          <p class="setting-description">
            实际请求 Host：{stringValue(server.connectionState().hostUrl, "未配置")} · Admin：
            {adminUsable() ? "可用" : "不可用"} · 最近刷新：{server.adminStateUpdatedAt() || "尚未刷新"}
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
                <span>兼容模式</span>
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
                            <StatusBadge>已保存预设</StatusBadge>
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
    if (!globalThis.confirm(`删除 ${record.name}？此操作会从服务器工具链清单移除该条目。`)) return
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
                      {item.enabled === false ? "已停用" : "已启用"}
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
              <span>名称</span>
              <input value={editor.name} disabled={editor.mode === "edit"} onInput={(event) => patchToolchainEditor({ name: event.currentTarget.value })} />
            </label>
            <label class="field-label">
              <span>状态</span>
              <select value={editor.enabled ? "true" : "false"} onChange={(event) => patchToolchainEditor({ enabled: event.currentTarget.value === "true" })}>
                <option value="true">启用</option>
                <option value="false">停用</option>
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
            <label class="field-label">
              <span>运行要求</span>
              <textarea rows={3} value={editor.requirementsText} placeholder="KEY=value，每行一个" onInput={(event) => patchToolchainEditor({ requirementsText: event.currentTarget.value })} />
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
            <button class="btn btn-secondary" onClick={() => setToolchainEditor(undefined)}>取消</button>
            <button class="btn btn-primary" onClick={saveToolchain} disabled={!editor.name.trim()}>
              保存
            </button>
          </div>
        </div>
      </div>
    )
  }

  const renderToolchains = () => (
    <div class="settings-page settings-page--wide">
      <div class="settings-page-header">
        <div>
          <h2>工具链管理</h2>
          <p>按服务器给出的权威清单检查和配置本地工具链，执行结果直接留在当前页面。</p>
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
            新增 CLI
          </button>
          <button class="btn btn-secondary" onClick={() => openCreateToolchain("mcp")}>
            新增 MCP
          </button>
          <button class="btn btn-secondary" onClick={() => openCreateToolchain("skill")}>
            新增 Skill
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
            <span>服务器工具链 Manifest</span>
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
          <span>执行命令</span>
          <div class="settings-badge-group">
            <StatusBadge tone={autoApprovalOptions().execute ? "warning" : "muted"}>
              {autoApprovalOptions().execute ? "聊天栏已开启" : "聊天栏未开启"}
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
            "命令白名单",
            "支持前缀匹配与 *。每个子命令都必须命中。",
            allowedCommands(),
            allowedCommandInput(),
            setAllowedCommandInput
          )}
          {renderCommandRuleEditor(
            "deny",
            "命令黑名单",
            "更具体的黑名单会自动拒绝命令。",
            deniedCommands(),
            deniedCommandInput(),
            setDeniedCommandInput
          )}
        </div>
        <div class="command-rule-examples">
          <span>示例</span>
          <code>git status</code>
          <code>npm test</code>
          <code>pytest</code>
          <code>npx tsc --noEmit</code>
        </div>
        <Show when={allowedCommands().includes("*")}>
          <div class="settings-warning">
            <span class="codicon codicon-warning" aria-hidden="true" />
            <span>* 会允许普通命令全匹配，请用黑名单覆盖高风险命令；危险 shell 替换仍会进入人工审批。</span>
          </div>
        </Show>
        <Show when={autoApprovalOptions().execute && allowedCommands().length === 0}>
          <div class="settings-warning">
            <span class="codicon codicon-warning" aria-hidden="true" />
            <span>执行自动批准已开启，但命令白名单为空，shell 审批仍会要求人工确认。</span>
          </div>
        </Show>
      </section>
    </div>
  )

  const renderOther = () => (
    <div class="settings-page settings-page--narrow">
      <div class="settings-page-header">
        <div>
          <h2>其他</h2>
          <p>维护与排查入口。普通执行器、服务商和工具链配置不需要使用这里。</p>
        </div>
        <button class="btn btn-secondary" onClick={refreshAdmin}>
          <span class="codicon codicon-refresh" aria-hidden="true" />
          刷新
        </button>
      </div>
      <Show when={server.adminError()}>
        <div class="settings-error">{server.adminError()}</div>
      </Show>
      <details class="settings-details">
        <summary>
          <span class="codicon codicon-output" aria-hidden="true" />
          最近一次操作
        </summary>
        <pre class="settings-result">{JSON.stringify(server.actionResult() || {}, null, 2)}</pre>
      </details>
      <details class="settings-details">
        <summary>
          <span class="codicon codicon-radio-tower" aria-hidden="true" />
          连接状态
        </summary>
        <pre class="settings-result">{JSON.stringify(server.connectionState(), null, 2)}</pre>
      </details>
      <details class="settings-details">
        <summary>
          <span class="codicon codicon-server-process" aria-hidden="true" />
          Admin 状态
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
            EZCode 设置
          </h1>
          <p>执行器、服务商、工具链、自动批准和其他维护入口。</p>
        </div>
        <span class="settings-version">v{server.extensionVersion() || "0.0.0"}</span>
      </div>

      <div class="settings-shell">
        <nav class="settings-tab-list" aria-label="EZCode settings">
          <For each={settingsTabs}>
            {(tab) => (
              <button
                type="button"
                class={`settings-tab ${activeTab() === tab.id ? "settings-tab--active" : ""}`}
                aria-current={activeTab() === tab.id ? "page" : undefined}
                title={tab.label}
                onClick={() => switchTab(tab.id)}
              >
                <span class={`codicon codicon-${tab.icon}`} aria-hidden="true" />
                <span class="settings-tab__label">{tab.label}</span>
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
