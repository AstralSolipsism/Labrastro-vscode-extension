export interface ProviderModelEntry {
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

const PROVIDER_MODEL_CACHE_EMPTY_MESSAGE = "尚未同步模型目录，可刷新模型列表或手动添加模型。"

function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback
}

function numberValue(value: unknown): number | undefined {
  const numeric = typeof value === "number" ? value : Number(value)
  return Number.isFinite(numeric) && numeric > 0 ? numeric : undefined
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

export function normalizeProviderModelEntries(value: unknown): ProviderModelEntry[] {
  if (!Array.isArray(value)) return []
  const entries: ProviderModelEntry[] = []
  for (const item of value) {
    const model = typeof item === "string" ? { id: item } : objectValue(item)
    const id = stringValue(model.id) || stringValue(model.model_id) || stringValue(model.model)
    if (!id) continue
    entries.push({
      id,
      owned_by: stringValue(model.owned_by) || undefined,
      created: numberValue(model.created),
      max_tokens: numberValue(model.max_tokens),
      max_context_tokens: numberValue(model.max_context_tokens),
      capability_source: stringValue(model.capability_source) || undefined,
      capability: objectValue(model.capability),
      supports_tools: model.supports_tools === true,
      supports_structured_outputs: model.supports_structured_outputs === true,
      supports_json_output: model.supports_json_output === true,
      supports_reasoning: model.supports_reasoning === true,
      supports_vision: model.supports_vision === true,
      supports_parallel_tool_calls: model.supports_parallel_tool_calls === true,
    })
  }
  return entries
}

export function prioritizeProviderModelEntries(
  models: ProviderModelEntry[],
  savedModelIds: ReadonlySet<string>,
): ProviderModelEntry[] {
  return [...models].sort((left, right) => {
    const leftSaved = savedModelIds.has(left.id)
    const rightSaved = savedModelIds.has(right.id)
    if (leftSaved !== rightSaved) return leftSaved ? -1 : 1
    const leftCustom = left.owned_by === "custom"
    const rightCustom = right.owned_by === "custom"
    if (leftCustom !== rightCustom) return leftCustom ? -1 : 1
    return 0
  })
}

export function providerModelCacheMessage(models: ProviderModelEntry[]): string {
  return models.length > 0
    ? `已加载缓存模型目录：${models.length} 个模型。`
    : PROVIDER_MODEL_CACHE_EMPTY_MESSAGE
}

export function providerModelRefreshMessage(models: ProviderModelEntry[]): string {
  return models.length > 0
    ? `已获取 ${models.length} 个模型。`
    : "当前服务商未返回模型列表，请使用“自定义模型名”。"
}
