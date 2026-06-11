export type CapabilityComponentRole = "capability" | "dependency" | "other"
export type SkillComponentStatus = "enabled" | "disabled" | "global_disabled"
export type CapabilityKind = "mcp_server" | "skill"
export type RuntimeRunsOn = "server" | "local_peer" | "both" | "agent_only"
export type RuntimeTarget = "server" | "local_peer"

export interface RuntimeFootprintView {
  runsOn: RuntimeRunsOn
  installRequiredOn: RuntimeTarget[]
  configRequiredOn: RuntimeTarget[]
  userMessage: string
}

export interface CapabilityHookPlacementRuntimeEntry {
  executable: boolean
  unavailableReason: string
}

export type CapabilityHookPlacementRuntimeView = Partial<Record<"server" | "peer", CapabilityHookPlacementRuntimeEntry>>

export interface CapabilityHookView {
  id: string
  event: string
  source: string
  placement: string
  handlerType: string
  displayName: string
  summary: string
  trust: string
  enabled: boolean
  executable: boolean
  canManage: boolean
  unavailableReason: string
  placementRuntime: CapabilityHookPlacementRuntimeView
  permissions: string[]
  credentials: string[]
  riskLevel: string
  recentResult: Record<string, unknown>
  technical: Record<string, unknown>
}

export interface CapabilityComponentView {
  id: string
  kind: string
  role: CapabilityComponentRole
  name: string
  displayName: string
  label: string
  summary: string
  packageIds: string[]
  pathHint: string
  sourcePath: string
  runtimeFootprint: RuntimeFootprintView
  hooks: CapabilityHookView[]
  skillStatus?: SkillComponentStatus
  raw: Record<string, unknown>
}

export interface CapabilityComponentGroups {
  capabilities: CapabilityComponentView[]
  dependencies: CapabilityComponentView[]
  other: CapabilityComponentView[]
}

export interface CapabilityDependencyView extends CapabilityComponentView {
  dependencyKind: string
}

export interface CapabilityComponentGroupOptions {
  skillsEnabled?: boolean
  disabledSkills?: string[]
}

export interface CapabilityView {
  id: string
  kind: CapabilityKind
  name: string
  displayName: string
  label: string
  summary: string
  description: string
  enabled: boolean
  status: string
  runtimeFootprint: RuntimeFootprintView
  sourcePackageIds: string[]
  dependencyIds: string[]
  hooks: CapabilityHookView[]
  raw: Record<string, unknown>
  skill?: {
    pathHint: string
    sourcePath: string
    globalEnabled: boolean
    disabled: boolean
    installPrompt: string
    verifyPrompt: string
    docs: Array<Record<string, unknown>>
    evidence: Array<Record<string, unknown>>
  }
  mcp?: {
    command: string
    args: string[]
    env: Record<string, unknown>
    url: string
    transport: string
    cwd: string
    environmentRequirementRefs: string[]
  }
}

export interface CapabilityCredentialRequirementView {
  requirementId: string
  provider: string
  kind: string
  placement: RuntimeRunsOn
  requiredBy: string[]
  state: string
  statusLabel: string
  scope: string
  scopeLabel: string
  secretRefId: string
  credentialActor: string
  message: string
}

export interface CapabilityPackageStateView {
  installLabel: string
  activationLabel: string
  runtimeLabel: string
  checkLabel: string
  credentialLabel: string
  updateLabel: string
  mappingLabel: string
  serverTargetLabel: string
  localPeerTargetLabel: string
  summaryLabel: string
}

export interface CapabilityViewsFromSourcesOptions extends CapabilityComponentGroupOptions {
  mcpServers?: Record<string, unknown>[]
  skillRecords?: Record<string, unknown>[]
  componentIndex?: Record<string, unknown>
  packages?: Record<string, unknown>
}

export function capabilityInstallStatusLabel(status: string): string {
  const normalized = status.trim().toLowerCase()
  if (!normalized || normalized === "installed" || normalized === "available" || normalized === "ready") return "已安装"
  if (normalized === "installing" || normalized === "pending" || normalized === "pending_install") return "安装中"
  if (normalized === "failed" || normalized === "error") return "安装失败"
  if (normalized === "removed" || normalized === "deleted") return "已移除"
  return status
}

export function capabilityInstallStatusTone(status: string): "success" | "warning" | "muted" | "error" | undefined {
  const normalized = status.trim().toLowerCase()
  if (!normalized || normalized === "installed" || normalized === "available" || normalized === "ready") return "success"
  if (normalized === "installing" || normalized === "pending" || normalized === "pending_install") return "warning"
  if (normalized === "failed" || normalized === "error") return "error"
  if (normalized === "removed" || normalized === "deleted") return "muted"
  return undefined
}

export function capabilityEnabledStatusLabel(enabled: boolean): string {
  return enabled ? "已启用" : "已停用"
}

export function capabilityEnabledStatusTone(enabled: boolean): "success" | "muted" {
  return enabled ? "success" : "muted"
}

export function capabilityPackageStateView(value: unknown): CapabilityPackageStateView {
  const raw = objectValue(value)
  const installLabel = installStateLabel(stringValue(raw.install_state || raw.installState))
  const activationLabel = activationStateLabel(stringValue(raw.activation_state || raw.activationState))
  const runtimeLabel = runtimeStateLabel(stringValue(raw.runtime_state || raw.runtimeState))
  const checkLabel = checkStateLabel(stringValue(raw.check_state || raw.checkState))
  const credentialLabel = credentialStateLabel(stringValue(raw.credential_state || raw.credentialState))
  const updateLabel = updateStateLabel(stringValue(raw.update_state || raw.updateState))
  const mappingLabel = mappingStateLabel(stringValue(raw.mapping_state || raw.mappingState))
  const serverTargetLabel = targetStatusLabel("server", raw)
  const localPeerTargetLabel = targetStatusLabel("local_peer", raw)
  return {
    installLabel,
    activationLabel,
    runtimeLabel,
    checkLabel,
    credentialLabel,
    updateLabel,
    mappingLabel,
    serverTargetLabel,
    localPeerTargetLabel,
    summaryLabel: [
      installLabel,
      activationLabel,
      credentialLabel,
      updateLabel,
      mappingLabel,
    ].filter(Boolean).join(" · "),
  }
}

export function capabilityPackageStatePayload(value: unknown): Record<string, unknown> {
  const raw = objectValue(value)
  const state = { ...objectValue(raw.state) }
  copyPackageFact(state, raw, "credential_state", "credentialState")
  copyPackageFact(state, raw, "target_facts", "targetFacts")
  copyPackageFact(state, raw, "targets", "targets")
  copyPackageFact(state, raw, "server", "server")
  copyPackageFact(state, raw, "local_peer", "localPeer")
  return state
}

export function capabilityPackageUserStateLabel(value: unknown): string {
  return capabilityPackageStateView(value).summaryLabel
}

function copyPackageFact(
  target: Record<string, unknown>,
  raw: Record<string, unknown>,
  snakeKey: string,
  camelKey: string,
): void {
  if (raw[snakeKey] !== undefined) {
    target[snakeKey] = raw[snakeKey]
    return
  }
  if (raw[camelKey] !== undefined) {
    target[snakeKey] = raw[camelKey]
  }
}

function installStateLabel(state: string): string {
  const normalized = state.trim().toLowerCase()
  if (normalized === "not_installed") return "未安装"
  if (normalized === "registered") return "已登记"
  if (normalized === "materialized") return "已写入"
  if (normalized === "installed") return "已安装"
  if (normalized === "blocked") return "安装受阻"
  if (normalized === "failed") return "安装失败"
  return normalized ? humanizeName(normalized) : "未登记"
}

function activationStateLabel(state: string): string {
  const normalized = state.trim().toLowerCase()
  if (normalized === "inactive") return "未激活"
  if (normalized === "active") return "已激活"
  if (normalized === "degraded") return "部分可用"
  if (normalized === "blocked") return "激活受阻"
  return normalized ? humanizeName(normalized) : "未激活"
}

function runtimeStateLabel(state: string): string {
  const normalized = state.trim().toLowerCase()
  if (normalized === "not_applicable") return "无需运行进程"
  if (normalized === "stopped") return "未运行"
  if (normalized === "starting") return "启动中"
  if (normalized === "running") return "运行中"
  if (normalized === "connected") return "已连接"
  if (normalized === "failed") return "运行失败"
  return normalized ? humanizeName(normalized) : "未返回运行状态"
}

function checkStateLabel(state: string): string {
  const normalized = state.trim().toLowerCase()
  if (normalized === "unknown") return "未检查"
  if (normalized === "pending") return "检查中"
  if (normalized === "passed") return "检查通过"
  if (normalized === "missing") return "缺失"
  if (normalized === "failed") return "检查失败"
  if (normalized === "stale") return "需要重新检查"
  return normalized ? humanizeName(normalized) : "未检查"
}

export function credentialStateLabel(state: string): string {
  const normalized = state.trim().toLowerCase()
  if (normalized === "not_required") return "无需凭据"
  if (normalized === "missing") return "缺少凭据"
  if (normalized === "bound") return "已绑定凭据"
  if (normalized === "verified") return "凭据已验证"
  if (normalized === "failed") return "凭据验证失败"
  return normalized ? humanizeName(normalized) : "无需凭据"
}

export function updateStateLabel(state: string): string {
  const normalized = state.trim().toLowerCase()
  if (normalized === "not_checked") return "未检查更新"
  if (normalized === "current") return "已是当前上游版本"
  if (normalized === "update_available") return "有可用更新"
  if (normalized === "candidate_ready") return "更新候选已准备"
  if (normalized === "updating") return "正在更新"
  if (normalized === "rollback_available") return "可回滚"
  if (normalized === "failed") return "更新失败"
  return normalized ? humanizeName(normalized) : "未检查更新"
}

function mappingStateLabel(state: string): string {
  const normalized = state.trim().toLowerCase()
  if (normalized === "mapped") return "映射完成"
  if (normalized === "unmapped") return "存在未映射项"
  if (normalized === "mapping_required") return "需要管理员映射"
  if (normalized === "invalid") return "映射无效"
  return normalized ? humanizeName(normalized) : "映射完成"
}

export function targetStatusLabel(target: RuntimeTarget, state: unknown): string {
  const raw = targetStateValue(target, state)
  const prefix = target === "server" ? "服务端" : "本地端"
  const runtimeLabel = runtimeStateLabel(stringValue(raw.runtime_state || raw.runtimeState))
  const checkLabel = checkStateLabel(stringValue(raw.check_state || raw.checkState))
  return `${prefix}：${runtimeLabel}，${checkLabel}`
}

function targetStateValue(target: RuntimeTarget, state: unknown): Record<string, unknown> {
  const raw = objectValue(state)
  const targetFacts = objectValue(raw.target_facts || raw.targetFacts)
  const fromTargetFacts = objectValue(targetFacts[target])
  if (Object.keys(fromTargetFacts).length) return fromTargetFacts

  const targets = objectValue(raw.targets)
  const fromTargets = objectValue(targets[target])
  if (Object.keys(fromTargets).length) return fromTargets

  const camelTarget = target === "local_peer" ? "localPeer" : target
  const direct = objectValue(raw[target] || raw[camelTarget])
  if (Object.keys(direct).length) return direct

  return {}
}

export function manualStepUserActionLabel(category: string): string {
  const normalized = category.trim().toLowerCase()
  if (normalized === "credential_auth_required") return "需要完成凭据授权"
  if (normalized === "credential_secret_required") return "需要录入凭据"
  if (normalized === "gui_authorization_required") return "需要在授权窗口确认"
  if (normalized === "system_package_install_required") return "需要系统权限安装"
  if (normalized === "manual_command_review_required") return "需要确认命令"
  if (normalized === "license_acceptance_required") return "需要接受许可"
  if (normalized === "path_selection_required") return "需要选择路径"
  return "需要用户处理"
}

const ENVIRONMENT_REQUIREMENT_KINDS = new Set([
  "executable",
  "runtime",
  "sdk",
  "service",
  "env_var",
  "credential",
  "path",
  "project_file",
  "container",
])

const CAPABILITY_KINDS = new Set([
  "skill",
  "mcp",
  "mcp_server",
  "mcp_tool",
  "builtin_tool",
  "prompt_fragment",
])

const DEPENDENCY_KINDS = new Set([
  "environment_requirement",
  "credential",
])

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function stringValue(value: unknown, fallback = ""): string {
  if (value === undefined || value === null) return fallback
  return String(value)
}

function stringArrayValue(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => stringValue(item).trim()).filter(Boolean)
    : []
}

export function credentialBindingScopeLabel(scope: string): string {
  const normalized = scope.trim()
  if (normalized === "user") return "默认使用当前用户凭据"
  if (normalized === "workspace") return "工作区共享凭据"
  if (normalized === "server_global") return "服务端全局凭据"
  return "需要绑定凭据"
}

export function credentialRequirementViews(value: unknown): CapabilityCredentialRequirementView[] {
  return recordArrayValue(value).map((item) => {
    const state = stringValue(item.state, "missing")
    const scope = stringValue(item.scope)
    return {
      requirementId: stringValue(item.requirement_id || item.requirementId || item.id),
      provider: stringValue(item.provider),
      kind: stringValue(item.kind),
      placement: normalizeRunsOn(item.placement, "server"),
      requiredBy: stringArrayValue(item.required_by || item.requiredBy),
      state,
      statusLabel: credentialBindingStatusLabel(state),
      scope,
      scopeLabel: credentialBindingScopeLabel(scope),
      secretRefId: stringValue(item.secret_ref_id || item.secretRefId),
      credentialActor: stringValue(item.credential_actor || item.credentialActor, "user_delegated"),
      message: stringValue(item.message),
    }
  })
}

function credentialBindingStatusLabel(state: string): string {
  const normalized = state.trim().toLowerCase()
  if (normalized === "bound") return "已绑定"
  if (normalized === "verified") return "已验证"
  if (normalized === "failed") return "凭据验证失败"
  return "需要绑定凭据"
}

function recordArrayValue(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object" && !Array.isArray(item)))
    : []
}

function normalizeLifecycleHookPlacementRuntime(value: unknown): CapabilityHookPlacementRuntimeView {
  const raw = objectValue(value)
  const runtime: CapabilityHookPlacementRuntimeView = {}
  for (const placement of ["server", "peer"] as const) {
    const entry = objectValue(raw[placement])
    if (!Object.keys(entry).length) continue
    runtime[placement] = {
      executable: entry.executable === true,
      unavailableReason: stringValue(entry.unavailable_reason || entry.unavailableReason),
    }
  }
  return runtime
}

export function normalizeLifecycleHookViews(value: unknown): CapabilityHookView[] {
  return recordArrayValue(value).map((hook) => {
    const event = stringValue(hook.event)
    const id = stringValue(hook.id)
    const displayName = stringValue(
      hook.display_name || hook.displayName,
      event ? `${event} Hook` : "Lifecycle Hook",
    )
    const trust = stringValue(hook.trust, "pending_review")
    const technical = {
      ...objectValue(hook.technical),
    }
    const handlerRef = stringValue(hook.handler_ref || hook.handlerRef)
    if (handlerRef) technical.handler_ref = handlerRef
    if (hook.matcher !== undefined) technical.matcher = hook.matcher
    const executable = hook.executable === true
    const canManage = id !== "" && (hook.can_manage === true || hook.canManage === true)
    return {
      id,
      event,
      source: stringValue(hook.source),
      placement: stringValue(hook.placement, "server"),
      handlerType: stringValue(hook.handler_type || hook.handlerType),
      displayName,
      summary: stringValue(hook.summary || hook.description, displayName),
      trust,
      enabled: executable,
      executable,
      canManage,
      unavailableReason: stringValue(hook.unavailable_reason || hook.unavailableReason),
      placementRuntime: normalizeLifecycleHookPlacementRuntime(hook.placement_runtime || hook.placementRuntime),
      permissions: stringArrayValue(hook.permissions),
      credentials: stringArrayValue(hook.credentials),
      riskLevel: stringValue(hook.risk_level || hook.riskLevel),
      recentResult: objectValue(hook.recent_result || hook.recentResult),
      technical,
    }
  })
}

const RUNTIME_TARGET_ORDER: RuntimeTarget[] = ["server", "local_peer"]

function normalizeRunsOn(value: unknown, fallback: RuntimeRunsOn = "agent_only"): RuntimeRunsOn {
  const text = stringValue(value).trim()
  if (text === "peer") return "local_peer"
  if (text === "server" || text === "local_peer" || text === "both" || text === "agent_only") return text
  return fallback
}

function targetsForRunsOn(runsOn: RuntimeRunsOn): RuntimeTarget[] {
  if (runsOn === "server") return ["server"]
  if (runsOn === "local_peer") return ["local_peer"]
  if (runsOn === "both") return ["server", "local_peer"]
  return []
}

function normalizeTargets(value: unknown, fallback: RuntimeTarget[]): RuntimeTarget[] {
  const raw = Array.isArray(value) ? value : fallback
  const set = new Set<RuntimeTarget>()
  for (const item of raw) {
    const text = stringValue(item).trim()
    if (text === "server") set.add("server")
    if (text === "local_peer" || text === "peer") set.add("local_peer")
  }
  return RUNTIME_TARGET_ORDER.filter((target) => set.has(target))
}

function runsOnFromTargets(targets: RuntimeTarget[]): RuntimeRunsOn {
  const set = new Set(targets)
  if (set.has("server") && set.has("local_peer")) return "both"
  if (set.has("server")) return "server"
  if (set.has("local_peer")) return "local_peer"
  return "agent_only"
}

function runsOnFromPlacement(value: unknown, fallback: RuntimeRunsOn): RuntimeRunsOn {
  const text = stringValue(value).trim()
  if (text === "server") return "server"
  if (text === "peer") return "local_peer"
  if (text === "both") return "both"
  return fallback
}

export function runtimeFootprintLabel(value: unknown): string {
  const footprint = normalizeRuntimeFootprint(value)
  return footprint.userMessage
}

export function runtimeFootprintBadgeTone(value: unknown): "success" | "warning" | "muted" | "error" | undefined {
  const footprint = normalizeRuntimeFootprint(value)
  if (footprint.runsOn === "agent_only" || footprint.runsOn === "server") return "success"
  if (footprint.runsOn === "local_peer") return "warning"
  if (footprint.runsOn === "both") return "warning"
  return undefined
}

export function normalizeRuntimeFootprint(value: unknown, fallbackRunsOn: RuntimeRunsOn = "agent_only"): RuntimeFootprintView {
  const raw = objectValue(value)
  const runsOn = normalizeRunsOn(raw.runs_on || raw.runsOn, fallbackRunsOn)
  const defaultTargets = targetsForRunsOn(runsOn)
  const installRequiredOn = runsOn === "agent_only"
    ? []
    : normalizeTargets(raw.install_required_on || raw.installRequiredOn, defaultTargets)
  const configRequiredOn = runsOn === "agent_only"
    ? []
    : normalizeTargets(raw.config_required_on || raw.configRequiredOn, defaultTargets)
  return {
    runsOn,
    installRequiredOn,
    configRequiredOn,
    userMessage: stringValue(raw.user_message || raw.userMessage, runtimeMessage(runsOn)),
  }
}

export function aggregateRuntimeFootprint(values: unknown[]): RuntimeFootprintView {
  const footprints = values.map((value) => normalizeRuntimeFootprint(value))
  const combinedTargets = normalizeTargets(
    footprints.flatMap((footprint) => [
      ...targetsForRunsOn(footprint.runsOn),
      ...footprint.installRequiredOn,
      ...footprint.configRequiredOn,
    ]),
    [],
  )
  const runsOn = runsOnFromTargets(combinedTargets)
  return normalizeRuntimeFootprint({
    runs_on: runsOn,
    install_required_on: combinedTargets,
    config_required_on: combinedTargets,
  }, runsOn)
}

function runtimeMessage(runsOn: RuntimeRunsOn): string {
  if (runsOn === "server") return "服务端运行，无需本机安装"
  if (runsOn === "local_peer") return "需要在本机安装/配置"
  if (runsOn === "both") return "服务端和本地端都需要配置"
  return "仅 Agent 指令能力，无需外部进程"
}

function runtimeFootprintForComponent(
  component: Record<string, unknown>,
  kind: string,
  config: Record<string, unknown>,
): RuntimeFootprintView {
  const explicit = component.runtime_footprint || config.runtime_footprint
  if (explicit && typeof explicit === "object") {
    return normalizeRuntimeFootprint(explicit)
  }
  if (kind === "skill") return normalizeRuntimeFootprint({}, "agent_only")
  if (kind === "environment_requirement") {
    return normalizeRuntimeFootprint({}, runsOnFromPlacement(config.placement || component.placement, "local_peer"))
  }
  if (kind === "mcp" || kind === "mcp_server") {
    return normalizeRuntimeFootprint({}, runsOnFromPlacement(config.placement || component.placement, "server"))
  }
  return normalizeRuntimeFootprint({})
}

export interface McpInstallPreviewServer {
  name: string
  command: string
  args: string[]
  envKeys: string[]
  runtimeFootprint: RuntimeFootprintView
}

export interface McpInstallPreview {
  ok: boolean
  servers: McpInstallPreviewServer[]
  error?: string
}

export function capabilityInstallPreviewFromMcpJson(raw: string): McpInstallPreview {
  try {
    const parsed = JSON.parse(raw)
    const servers = objectValue(parsed.mcpServers)
    if (!Object.keys(servers).length) {
      return { ok: false, servers: [], error: "MCP 配置需要包含 mcpServers 对象。" }
    }
    const previewServers = Object.entries(servers).map(([name, value]) => {
      const server = objectValue(value)
      const command = stringValue(server.command).trim()
      if (!command) throw new Error(`mcpServers.${name}.command 不能为空。`)
      return {
        name,
        command,
        args: stringArrayValue(server.args),
        envKeys: Object.keys(objectValue(server.env)),
        runtimeFootprint: normalizeRuntimeFootprint(server.runtime_footprint, "server"),
      }
    })
    return { ok: true, servers: previewServers }
  } catch (error) {
    return {
      ok: false,
      servers: [],
      error: error instanceof Error ? error.message : "MCP 配置 JSON 无法解析。",
    }
  }
}

function normalizedKind(component: Record<string, unknown>, fallbackId = ""): string {
  const rawKind = stringValue(component.kind || component.type).trim().toLowerCase()
  if (ENVIRONMENT_REQUIREMENT_KINDS.has(rawKind)) return "environment_requirement"
  if (rawKind) return rawKind
  const id = stringValue(component.id || fallbackId).trim().toLowerCase()
  if (id.startsWith("envreq:")) return "environment_requirement"
  const [prefix] = id.split(":")
  if (prefix === "mcp_server") return "mcp_server"
  if (prefix === "mcp_tool") return "mcp_tool"
  if (prefix === "builtin_tool") return "builtin_tool"
  if (prefix === "prompt_fragment") return "prompt_fragment"
  if (prefix === "credential") return "credential"
  if (prefix === "skill") return "skill"
  if (prefix === "mcp") return "mcp"
  return ""
}

function nameFromId(id: string): string {
  if (id.startsWith("envreq:")) {
    const parts = id.split(":")
    return parts.slice(2).join(":")
  }
  const index = id.indexOf(":")
  return index >= 0 ? id.slice(index + 1) : id
}

function humanizeName(value: string): string {
  const text = nameFromId(value).replace(/[_-]+/g, " ").trim()
  if (!text) return value
  return text.replace(/\b[\p{L}\p{N}]/gu, (match) => match.toUpperCase())
}

function displayNameForComponent(
  component: Record<string, unknown>,
  config: Record<string, unknown>,
  fallbackName: string,
): string {
  return stringValue(
    component.display_name ||
    config.display_name ||
    component.title ||
    config.title,
    humanizeName(fallbackName),
  )
}

function componentIds(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => typeof item === "string" ? item : stringValue(objectValue(item).id))
    .map((item) => item.trim())
    .filter(Boolean)
}

function packageIdsForComponent(
  componentId: string,
  component: Record<string, unknown>,
  packages: Record<string, unknown> = {},
): string[] {
  const direct = stringArrayValue(component.package_ids)
  if (direct.length) return direct
  return Object.entries(packages)
    .filter(([, raw]) => componentIds(objectValue(raw).components).includes(componentId))
    .map(([id]) => id)
}

function environmentRequirementKind(component: Record<string, unknown>): string {
  const config = objectValue(component.config)
  const componentKind = stringValue(component.kind).trim().toLowerCase()
  const id = stringValue(component.id).trim().toLowerCase()
  const idParts = id.startsWith("envreq:") ? id.split(":") : []
  const rawKind = stringValue(
    config.kind ||
    config.resource_kind ||
    component.resource_kind ||
    component.requirement_kind ||
    (ENVIRONMENT_REQUIREMENT_KINDS.has(componentKind) ? componentKind : "") ||
    (idParts.length > 2 ? idParts[1] : "") ||
    "runtime",
  ).trim().toLowerCase()
  return rawKind || "runtime"
}

function titleCaseKind(kind: string): string {
  return kind.replace(/_/g, " ").replace(/\b\w/g, (match) => match.toUpperCase())
}

export function resourceKindLabel(kind: string): string {
  switch (kind) {
    case "executable": return "Executable"
    case "runtime": return "Runtime"
    case "sdk": return "SDK"
    case "service": return "Service"
    case "env_var": return "Environment Variable"
    case "credential": return "Credential"
    case "path": return "Path"
    case "project_file": return "Project File"
    case "container": return "Container"
    case "mcp_server": return "MCP Server"
    default: return kind ? titleCaseKind(kind) : "Dependency"
  }
}

export function capabilityComponentKindLabel(kind: string): string {
  switch (kind) {
    case "skill": return "Skill"
    case "mcp":
    case "mcp_server": return "MCP Server"
    case "mcp_tool": return "MCP Tool"
    case "builtin_tool": return "Builtin Tool"
    case "prompt_fragment": return "Prompt Fragment"
    case "credential": return "Credential"
    case "environment_requirement": return "Dependency"
    default: return kind ? titleCaseKind(kind) : "Component"
  }
}

export function capabilityComponentRole(kind: string): CapabilityComponentRole {
  if (CAPABILITY_KINDS.has(kind)) return "capability"
  if (DEPENDENCY_KINDS.has(kind)) return "dependency"
  return "other"
}

export function capabilityComponentSummary(
  component: Record<string, unknown>,
  fallbackName = "",
): string {
  const kind = normalizedKind(component, fallbackName)
  const config = objectValue(component.config)
  const id = stringValue(component.id || fallbackName)
  const name = stringValue(component.name || config.name, nameFromId(id) || fallbackName)
  const displayName = displayNameForComponent(component, config, name)
  if (kind === "environment_requirement") {
    const resourceKind = environmentRequirementKind(component)
    const requirements = objectValue(config.requirements || component.requirements)
    const requirementText = Object.entries(requirements)
      .map(([key, value]) => `${key} ${String(value)}`.trim())
      .join(", ")
    const command = stringValue(config.command || component.command)
    return [
      resourceKindLabel(resourceKind),
      name,
      requirementText,
      command ? `command=${command}` : "",
    ].filter(Boolean).join(" · ")
  }
  if (kind === "skill") {
    const summary = stringValue(component.summary || config.summary || component.description || config.description)
    return [
      "Skill",
      summary || displayName,
    ].filter(Boolean).join(" · ")
  }
  const summary = stringValue(component.summary || config.summary || component.description || config.description)
  return [
    capabilityComponentKindLabel(kind),
    summary || displayName,
  ].filter(Boolean).join(" · ")
}

function capabilityComponentUserSummary(
  component: Record<string, unknown>,
  fallbackId = "",
): string {
  const config = objectValue(component.config)
  const explicit = stringValue(component.summary || config.summary || component.description || config.description)
  return explicit || capabilityComponentSummary(component, fallbackId)
}

export function capabilityComponentView(
  component: Record<string, unknown>,
  fallbackId = "",
  options: CapabilityComponentGroupOptions = {},
): CapabilityComponentView {
  const id = stringValue(component.id || fallbackId)
  const kind = normalizedKind(component, id)
  const config = objectValue(component.config)
  const name = stringValue(component.name || config.name, nameFromId(id) || id)
  const displayName = displayNameForComponent(component, config, name)
  const runtimeFootprint = runtimeFootprintForComponent(component, kind, config)
  const pathHint = stringValue(config.path_hint || component.path_hint)
  const sourcePath = stringValue(component.source_path || config.source_path)
  const hooks = normalizeLifecycleHookViews(component.hook_views)
  const disabled = new Set((options.disabledSkills || []).map((item) => item.trim()).filter(Boolean))
  const componentDisabled = component.enabled === false || config.enabled === false
  const skillStatus = kind === "skill"
    ? options.skillsEnabled === false
      ? "global_disabled"
      : componentDisabled || disabled.has(name) || disabled.has(id)
        ? "disabled"
        : "enabled"
    : undefined
  return {
    id,
    kind,
    role: capabilityComponentRole(kind),
    name,
    displayName,
    label: kind === "environment_requirement"
      ? resourceKindLabel(environmentRequirementKind(component))
      : capabilityComponentKindLabel(kind),
    summary: capabilityComponentUserSummary({ ...component, id }, id),
    packageIds: stringArrayValue(component.package_ids),
    pathHint,
    sourcePath,
    runtimeFootprint,
    hooks,
    skillStatus,
    raw: component,
  }
}

function skillCapabilityView(
  component: Record<string, unknown>,
  fallbackId: string,
  packages: Record<string, unknown>,
  options: CapabilityComponentGroupOptions,
  componentIndex: Record<string, unknown>,
): CapabilityView {
  const view = capabilityComponentView(component, fallbackId, options)
  const config = objectValue(component.config)
  const disabled = new Set((options.disabledSkills || []).map((item) => item.trim()).filter(Boolean))
  const docs = recordArrayValue(config.docs || component.docs)
  const evidence = recordArrayValue(config.evidence || component.evidence)
  const installPrompt = stringValue(config.install_prompt || component.install_prompt)
  const verifyPrompt = stringValue(config.verify_prompt || component.verify_prompt)
  const dependencyIds = stringArrayValue(
    component.environment_requirement_refs || config.environment_requirement_refs,
  )
  const dependencyFootprints = dependencyIds
    .map((dependencyId) => {
      const dependency = objectValue(componentIndex[dependencyId])
      if (!Object.keys(dependency).length) return undefined
      const dependencyConfig = objectValue(dependency.config)
      return runtimeFootprintForComponent(
        dependency,
        normalizedKind(dependency, dependencyId),
        dependencyConfig,
      )
    })
    .filter((item): item is RuntimeFootprintView => Boolean(item))
  const runtimeFootprint = dependencyFootprints.length
    ? aggregateRuntimeFootprint([view.runtimeFootprint, ...dependencyFootprints])
    : view.runtimeFootprint
  const packageLookupId = stringValue(component.component_id || view.id)
  const recordStatus = stringValue(component.status).toLowerCase()
  const recordDisabled = component.enabled === false || recordStatus === "disabled" || recordStatus === "stopped"
  const disabledBySettings = disabled.has(view.name) || disabled.has(view.id)
  const skillDisabled = recordDisabled || disabledBySettings
  const status = options.skillsEnabled === false
    ? "global_disabled"
    : skillDisabled
      ? "disabled"
      : "enabled"
  return {
    id: view.id,
    kind: "skill",
    name: view.name,
    displayName: view.displayName,
    label: "Skill",
    summary: view.summary,
    description: stringValue(component.description || config.description),
    enabled: status === "enabled",
    status,
    runtimeFootprint,
    sourcePackageIds: packageIdsForComponent(packageLookupId, component, packages),
    dependencyIds,
    hooks: normalizeLifecycleHookViews(component.hook_views),
    raw: component,
    skill: {
      pathHint: view.pathHint || stringValue(config.path_hint || component.path_hint || component.source_path),
      sourcePath: view.sourcePath,
      globalEnabled: options.skillsEnabled !== false,
      disabled: skillDisabled,
      installPrompt,
      verifyPrompt,
      docs,
      evidence,
    },
  }
}

function mcpCapabilityView(
  record: Record<string, unknown>,
  componentIndex: Record<string, unknown>,
  packages: Record<string, unknown>,
): CapabilityView {
  const id = stringValue(record.id || record.component_id) || `mcp:${stringValue(record.name)}`
  const component = objectValue(componentIndex[id] || componentIndex[stringValue(record.component_id)])
  const config = objectValue(component.config)
  const name = stringValue(record.name || component.name || config.name, nameFromId(id) || id)
  const displayName = stringValue(
    record.display_name ||
    component.display_name ||
    config.display_name,
    humanizeName(name),
  )
  const dependencyIds = stringArrayValue(
    record.environment_requirement_refs ||
    component.environment_requirement_refs ||
    config.environment_requirement_refs,
  )
  const sourcePackageIds = stringArrayValue(record.package_ids).length
    ? stringArrayValue(record.package_ids)
    : packageIdsForComponent(id, component, packages)
  const command = stringValue(record.command || config.command || component.command)
  const runtimeFootprint = normalizeRuntimeFootprint(
    record.runtime_footprint || component.runtime_footprint || config.runtime_footprint,
    runsOnFromPlacement(record.placement || component.placement || config.placement, "server"),
  )
  return {
    id,
    kind: "mcp_server",
    name,
    displayName,
    label: "MCP Server",
    summary: stringValue(record.summary || component.summary || config.summary, `MCP Server · ${displayName}`),
    description: stringValue(record.description || component.description || config.description || record.alias || record.source),
    enabled: record.enabled !== false && component.enabled !== false,
    status: stringValue(record.status || component.status, record.enabled === false ? "stopped" : "unchecked"),
    runtimeFootprint,
    sourcePackageIds,
    dependencyIds,
    hooks: normalizeLifecycleHookViews(record.hook_views || component.hook_views),
    raw: record,
    mcp: {
      command,
      args: stringArrayValue(record.args || config.args || component.args),
      env: objectValue(record.env || config.env || component.env),
      url: stringValue(record.url || config.url || component.url),
      transport: stringValue(record.transport || record.distribution || config.transport || component.transport),
      cwd: stringValue(record.cwd || config.cwd || component.cwd),
      environmentRequirementRefs: dependencyIds,
    },
  }
}

export function capabilityViewsFromSources(options: CapabilityViewsFromSourcesOptions = {}): CapabilityView[] {
  const componentIndex = options.componentIndex || {}
  const packages = options.packages || {}
  const mcpCapabilities = (options.mcpServers || []).map((record) =>
    mcpCapabilityView(record, componentIndex, packages)
  )
  const registeredSkillKeys = new Set<string>()
  const registeredSkillCapabilities = (options.skillRecords || []).map((record) => {
    const fallbackId = stringValue(record.id || record.component_id) || `skill:${stringValue(record.name)}`
    const capability = skillCapabilityView(record, fallbackId, packages, options, componentIndex)
    const componentId = stringValue(record.component_id)
    ;[capability.id, capability.name, `skill:${capability.name}`, componentId].filter(Boolean).forEach((key) => {
      registeredSkillKeys.add(key)
    })
    return capability
  })
  const componentSkillCapabilities = Object.entries(componentIndex)
    .map(([id, raw]) => ({ id, component: objectValue(raw) }))
    .filter(({ id, component }) => normalizedKind(component, id) === "skill")
    .filter(({ id, component }) => {
      const name = stringValue(component.name || objectValue(component.config).name, nameFromId(id) || id)
      return !registeredSkillKeys.has(id) && !registeredSkillKeys.has(name) && !registeredSkillKeys.has(`skill:${name}`)
    })
    .map(({ id, component }) => skillCapabilityView(component, id, packages, options, componentIndex))
  return [...mcpCapabilities, ...registeredSkillCapabilities, ...componentSkillCapabilities]
}

export function groupCapabilityPackageComponents(
  items: Array<string | Record<string, unknown>>,
  componentIndex: Record<string, unknown> = {},
  options: CapabilityComponentGroupOptions = {},
): CapabilityComponentGroups {
  const groups: CapabilityComponentGroups = {
    capabilities: [],
    dependencies: [],
    other: [],
  }
  for (const item of items) {
    const id = typeof item === "string" ? item : stringValue(item.id)
    const raw = typeof item === "string"
      ? objectValue(componentIndex[item])
      : item
    const component = capabilityComponentView(raw, id, options)
    if (component.role === "capability") groups.capabilities.push(component)
    else if (component.role === "dependency") groups.dependencies.push(component)
    else groups.other.push(component)
  }
  return groups
}
