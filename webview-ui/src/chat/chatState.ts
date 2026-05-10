export interface ChatModeOption {
  id: string
  label: string
  description: string
}

export interface ChatModelOption {
  id: string
  providerId: string
  modelId: string
  label: string
  model: string
  provider: string
  description: string
  activeDefault: boolean
  activeSession: boolean
  parameters?: Record<string, unknown>
}

export interface HostTargetSummary {
  label: string
  detail: string
  title: string
  tone: "ready" | "warning" | "error" | "muted"
}

export const FALLBACK_CHAT_MODE_OPTIONS: ChatModeOption[] = [
  {
    id: "coder",
    label: "Coder",
    description: "代码实现与验证",
  },
  {
    id: "planner",
    label: "Planner",
    description: "规划、分析与拆解",
  },
  {
    id: "debugger",
    label: "Debugger",
    description: "诊断、复现与修复",
  },
]

const TASKFLOW_CHAT_MODE_OPTION: ChatModeOption = {
  id: "taskflow",
  label: "Taskflow",
  description: "后台长任务规划/执行",
}

export function normalizeModeOptions(adminState: Record<string, unknown>): ChatModeOption[] {
  const rawModes = adminState.modes
  if (Array.isArray(rawModes)) {
    return uniqueModes(
      rawModes
        .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
        .map((item) => {
          const id = stringValue(item.name) || stringValue(item.id)
          return {
            id,
            label: stringValue(item.label) || builtinModeLabel(id),
            description: stringValue(item.description) || "",
          }
        })
        .filter((item) => item.id)
    )
  }

  if (rawModes && typeof rawModes === "object") {
    return uniqueModes(
      Object.entries(rawModes as Record<string, unknown>).map(([id, value]) => {
        const mode = value && typeof value === "object" ? value as Record<string, unknown> : {}
        return {
          id,
          label: stringValue(mode.label) || builtinModeLabel(id),
          description: stringValue(mode.description) || "",
        }
      })
    )
  }

  return []
}

export function resolveChatModeOptions(
  adminState: Record<string, unknown>,
  remoteMode?: string,
  taskflowAvailable = false,
): ChatModeOption[] {
  const normalized = normalizeModeOptions(adminState)
  const baseOptions = normalized.length ? normalized : FALLBACK_CHAT_MODE_OPTIONS
  const options = taskflowAvailable || baseOptions.some((option) => option.id === "taskflow")
    ? uniqueModes([...baseOptions, TASKFLOW_CHAT_MODE_OPTION])
    : baseOptions
  const remote = remoteMode?.trim()
  if (remote && !options.some((option) => option.id === remote)) {
    return uniqueModes([
      { id: remote, label: remote, description: "" },
      ...options,
    ])
  }
  return options
}

export function resolveModeSelection(
  current: string,
  options: ChatModeOption[],
  adminState: Record<string, unknown>,
  remoteMode?: string,
): string {
  if (current && options.some((option) => option.id === current)) return current
  const active = stringValue(adminState.active_mode)
  if (active && options.some((option) => option.id === active)) return active
  const remote = remoteMode?.trim()
  if (remote && options.some((option) => option.id === remote)) return remote
  return options[0]?.id || current || ""
}

export function modeLabel(modeId: string, options: ChatModeOption[]): string {
  return options.find((option) => option.id === modeId)?.label || modeId || "Mode"
}

export function normalizeModelOptions(
  adminState: Record<string, unknown>,
  runtimeState?: Record<string, unknown>,
): ChatModelOption[] {
  return uniqueModels([
    ...modelOptionsFromCatalog(adminState.provider_model_catalog),
    ...modelOptionsFromProviders(adminState.providers),
    ...modelOptionsFromRuntime(runtimeState),
  ])
}

export function resolveModelSelection(
  current: string,
  options: ChatModelOption[],
  adminState: Record<string, unknown>,
  runtimeState?: Record<string, unknown>,
): string {
  if (current && options.some((option) => option.id === current)) return current
  const runtimeModelId = modelSelectionId(runtimeState)
  if (runtimeModelId && options.some((option) => option.id === runtimeModelId)) return runtimeModelId
  const activeModelId = modelSelectionId(resolveActiveAgentModel(adminState, runtimeState))
  if (activeModelId && options.some((option) => option.id === activeModelId)) return activeModelId
  const active = options.find((option) => option.activeSession || option.activeDefault)
  return active?.id || options[0]?.id || current || ""
}

export function modelLabel(profileId: string, options: ChatModelOption[], fallbackModel = ""): string {
  return options.find((option) => option.id === profileId)?.label || fallbackModel || profileId || "Model"
}

export function modelDescription(profileId: string, options: ChatModelOption[], fallbackModel = ""): string {
  const option = options.find((item) => item.id === profileId)
  if (option) return option.description || ""
  return fallbackModel || ""
}

export function modelSwitchAction(
  nextModelId: string,
  currentModelId: string,
  options: ChatModelOption[],
  state: { working?: boolean; switching?: boolean },
): "ignore" | "queue" | "switch" {
  const next = nextModelId.trim()
  if (!next || next === currentModelId || !options.some((option) => option.id === next)) return "ignore"
  if (state.working) return "queue"
  if (state.switching) return "ignore"
  return "switch"
}

export function shouldAcceptModelSwitchResponse(
  currentRequestId: string,
  responseRequestId: string,
): boolean {
  return !currentRequestId || !responseRequestId || currentRequestId === responseRequestId
}

export function resolveHostTargetSummary(
  connectionState: Record<string, unknown>,
  executorType: { location?: string; engine?: string },
): HostTargetSummary {
  const engine = executorEngineLabel(executorType.engine)
  const location = executorType.location === "local" ? "Local" : "Remote"
  const hostUrl = stringValue(connectionState.hostUrl) || "未配置"
  const source = stringValue(connectionState.hostUrlSource) || "unknown"
  const status = stringValue(connectionState.status)
  const authenticated = connectionState.authenticated === true
  const label = `${engine} · ${location}`
  const detail = executorType.location === "local" ? "本地执行" : hostUrl
  const tone =
    status === "error"
      ? "error"
      : authenticated || status === "ready"
        ? "ready"
        : hostUrl === "未配置"
          ? "warning"
          : "muted"
  return {
    label,
    detail,
    title: [
      `执行器：${label}`,
      `Host：${hostUrl}`,
      `来源：${source}`,
      `状态：${status || "unknown"}`,
    ].join("\n"),
    tone,
  }
}

export function canUseTaskflow(features: Record<string, unknown>): boolean {
  return features.taskflow === true || features.taskFlow === true
}

function uniqueModes(items: ChatModeOption[]): ChatModeOption[] {
  const seen = new Set<string>()
  const result: ChatModeOption[] = []
  for (const item of items) {
    if (!item.id || seen.has(item.id)) continue
    seen.add(item.id)
    result.push(item)
  }
  return result
}

function uniqueModels(items: ChatModelOption[]): ChatModelOption[] {
  const seen = new Set<string>()
  const result: ChatModelOption[] = []
  for (const item of items) {
    if (!item.id || !item.providerId || !item.modelId || seen.has(item.id)) continue
    seen.add(item.id)
    result.push(item)
    continue
  }
  for (const item of items) {
    if (!item.id) continue
    const existing = result.find((candidate) => candidate.id === item.id)
    if (!existing) continue
    existing.activeDefault = existing.activeDefault || item.activeDefault
    existing.activeSession = existing.activeSession || item.activeSession
  }
  return result
}

export function modelOptionId(providerId: string, modelId: string): string {
  return `${providerId.trim()}::${modelId.trim()}`
}

function modelOptionsFromCatalog(value: unknown): ChatModelOption[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
    .map((item) => {
      const providerId = stringValue(item.provider_id) || stringValue(item.providerId) || stringValue(item.provider)
      const modelId = stringValue(item.model_id) || stringValue(item.modelId) || stringValue(item.model) || stringValue(item.id)
      const modelName = stringValue(item.label) || stringValue(item.display_name) || modelId
      const parameters = objectValue(item.parameters)
      return {
        id: modelOptionId(providerId, modelId),
        providerId,
        modelId,
        label: modelDisplayLabel(providerId, modelName),
        model: modelId,
        provider: providerId,
        description: "",
        activeDefault: item.active_default === true,
        activeSession: item.active_session === true,
        ...(Object.keys(parameters).length ? { parameters } : {}),
      }
    })
}

function modelOptionsFromProviders(value: unknown): ChatModelOption[] {
  if (!Array.isArray(value)) return []
  const options: ChatModelOption[] = []
  for (const provider of value) {
    if (!provider || typeof provider !== "object") continue
    const providerRecord = provider as Record<string, unknown>
    if (providerRecord.enabled === false) continue
    const providerId = stringValue(providerRecord.id) || stringValue(providerRecord.provider_id)
    const rawModels = Array.isArray(providerRecord.models) ? providerRecord.models : []
    for (const rawModel of rawModels) {
      const modelRecord = typeof rawModel === "string"
        ? { id: rawModel }
        : rawModel && typeof rawModel === "object"
          ? rawModel as Record<string, unknown>
          : {}
      const modelId = stringValue(modelRecord.model_id) || stringValue(modelRecord.model) || stringValue(modelRecord.id)
      if (!modelId) continue
      const parameters = objectValue(modelRecord.parameters)
      options.push({
        id: modelOptionId(providerId, modelId),
        providerId,
        modelId,
        label: modelDisplayLabel(
          providerId,
          stringValue(modelRecord.label) || stringValue(modelRecord.display_name) || modelId,
        ),
        model: modelId,
        provider: providerId,
        description: "",
        activeDefault: modelRecord.active_default === true,
        activeSession: modelRecord.active_session === true,
        ...(Object.keys(parameters).length ? { parameters } : {}),
      })
    }
  }
  return options
}

function modelOptionsFromRuntime(value: unknown): ChatModelOption[] {
  const payload = objectValue(value)
  const providerId =
    stringValue(payload.active_model_provider) ||
    stringValue(payload.provider_id) ||
    stringValue(payload.providerId) ||
    stringValue(payload.provider)
  const modelId =
    stringValue(payload.active_model) ||
    stringValue(payload.model_id) ||
    stringValue(payload.modelId) ||
    stringValue(payload.model)
  if (!providerId || !modelId) return []
  const displayName = stringValue(payload.active_model_display_name) || modelId
  const parameters = objectValue(payload.active_model_parameters)
  return [{
    id: modelOptionId(providerId, modelId),
    providerId,
    modelId,
    label: modelDisplayLabel(providerId, displayName),
    model: modelId,
    provider: providerId,
    description: "",
    activeDefault: false,
    activeSession: true,
    ...(Object.keys(parameters).length ? { parameters } : {}),
  }]
}

function resolveActiveAgentModel(
  adminState: Record<string, unknown>,
  runtimeState?: Record<string, unknown>,
): Record<string, unknown> {
  const explicit = objectValue(adminState.active_agent_model)
  if (Object.keys(explicit).length) return explicit
  const agentRuntime = objectValue(adminState.agent_runtime)
  const agents = Object.keys(objectValue(adminState.agent_profiles)).length
    ? objectValue(adminState.agent_profiles)
    : objectValue(agentRuntime.agents)
  const activeMode = stringValue(runtimeState?.active_mode) || stringValue(adminState.active_mode)
  return objectValue(objectValue(agents[activeMode]).model)
}

function modelSelectionId(value: unknown): string {
  const payload = objectValue(value)
  const providerId =
    stringValue(payload.active_model_provider) ||
    stringValue(payload.provider_id) ||
    stringValue(payload.providerId) ||
    stringValue(payload.provider)
  const modelId =
    stringValue(payload.active_model) ||
    stringValue(payload.model_id) ||
    stringValue(payload.modelId) ||
    stringValue(payload.model)
  return providerId && modelId ? modelOptionId(providerId, modelId) : ""
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function executorEngineLabel(engine?: string): string {
  if (engine === "claude") return "Claude"
  if (engine === "codex") return "Codex"
  if (engine === "gemini") return "Gemini"
  if (engine === "astrbot") return "AstrBot"
  return "Labrastro"
}

function builtinModeLabel(id: string): string {
  if (id === "coder") return "Coder"
  if (id === "planner") return "Planner"
  if (id === "debugger") return "Debugger"
  if (id === "taskflow") return "Taskflow"
  return id
}

function modelDisplayLabel(provider: string, model: string): string {
  if (provider && model) return `${provider}：${model}`
  return model || provider
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}
