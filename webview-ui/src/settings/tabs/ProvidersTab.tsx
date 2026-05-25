import { Component, For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js"
import { t } from "../../i18n"
import { DialogSurface } from "../../components/common/interaction"
import { RefreshButton } from "../../components/common/RefreshButton"
import { StatusBadge } from "../components/StatusBadge"
import { prioritizeProviderModelEntries } from "../providerModels"
import type { SettingsController } from "../useSettingsController"
import {
  PROVIDER_COMPAT_OPTIONS,
  PROVIDER_KIND_REGISTRY,
  PROVIDER_TYPE_OPTIONS,
  inferProviderKind,
  modelOwnerDisplay,
  resolveProviderProtocol,
  type ProviderCompat,
  type ProviderKind,
  type ProviderType,
} from "../utils"

interface TabProps { controller: SettingsController & Record<string, any> }

function providerTypeLabel(value: ProviderType): string {
  if (value === "anthropic_messages") return "Anthropic Messages"
  if (value === "openai_responses") return "OpenAI Responses"
  return "OpenAI Chat"
}

function providerCompatLabel(value: ProviderCompat): string {
  if (value === "generic") return "Generic"
  if (value === "deepseek") return "DeepSeek"
  if (value === "kimi") return "Kimi"
  if (value === "glm") return "GLM"
  if (value === "qwen") return "Qwen"
  return "ZenMux"
}

function normalizeProviderType(value: unknown): ProviderType {
  return PROVIDER_TYPE_OPTIONS.includes(value as ProviderType) ? value as ProviderType : "openai_chat"
}

function normalizeProviderCompat(value: unknown): ProviderCompat {
  return PROVIDER_COMPAT_OPTIONS.includes(value as ProviderCompat) ? value as ProviderCompat : "generic"
}

export const ProvidersTab: Component<TabProps> = (props) => {
  const {
    operations,
    pageRefreshing,
    refreshPage,
    serverSettingsSaveBusy,
    providerWriteBusy,
    providerModelRefreshBusy,
    server,
    resetProviderForm,
    providerErrorMessage,
    connectionStatus,
    connectionMessage,
    isDefaultLocalHost,
    actionFeedback,
    providers,
    providerId,
    selectProvider,
    stringValue,
    objectValue,
    numberValue,
    formatTimestamp,
    providerBaseUrl,
    providerEnabled,
    selectedProvider,
    adminUsable,
    providerListEmptyMessage,
    profiles,
    toggleProviderEnabled,
    saveProvider,
    providerType,
    setProviderType,
    providerCompat,
    setProviderCompat,
    setProviderId,
    setProviderBaseUrl,
    providerApiKey,
    setProviderApiKey,
    requestProviderModels,
    modelSearch,
    setModelSearch,
    modelFetchMessage,
    filteredFetchedModels,
    emptyModelListMessage,
    showCustomModelFallback,
    providerCopyId,
    setProviderCopyId,
    copyProvider,
    deleteProvider,
    customModelDraft,
    setCustomModelDraft,
    setFetchedModels,
    testProvider,
    modelDetailOpen,
    closeModelDetail,
    openModelDetail,
    profileProvider,
    profileId,
    profileModel,
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
    modelCapabilitiesStatus,
    refreshModelCapabilities,
    saveCapabilitySyncSettings,
    modelCapabilityRecommendation,
    applyModelCapabilityRecommendation,
    saveModelPreset,
    deleteModelPreset,
    deleteModelPresetByModel,
  } = props.controller
  const providerActionBusy = () => providerWriteBusy()

  const [draftProviderActive, setDraftProviderActive] = createSignal(false)
  const [providerKind, setProviderKind] = createSignal<ProviderKind>("openai-compatible")
  const [kindMenuOpen, setKindMenuOpen] = createSignal(false)
  const [kindSearch, setKindSearch] = createSignal("")
  const [customModelInlineOpen, setCustomModelInlineOpen] = createSignal(false)
  const [copiedModelId, setCopiedModelId] = createSignal("")
  const [apiKeyDisplay, setApiKeyDisplay] = createSignal("")
  const [apiKeyDisplaySource, setApiKeyDisplaySource] = createSignal("")
  const [capabilitySyncDirty, setCapabilitySyncDirty] = createSignal(false)
  const [capabilitySyncEnabled, setCapabilitySyncEnabled] = createSignal(true)
  const [capabilitySyncIntervalSec, setCapabilitySyncIntervalSec] = createSignal(86400)
  let kindSelectorRef: HTMLDivElement | undefined
  let kindSearchRef: HTMLInputElement | undefined
  let customModelInputRef: HTMLInputElement | undefined
  let copyResetTimer: number | undefined

  const savedProviderIds = createMemo(() => new Set(providers().map((provider: Record<string, unknown>) => stringValue(provider.id))))
  const savedModelIds = createMemo(() => {
    const currentProvider = providerId()
    const ids = new Set<string>()
    if (!currentProvider) return ids
    for (const profile of profiles()) {
      const profileProvider =
        stringValue(profile.provider) ||
        stringValue(profile.provider_id) ||
        stringValue(profile.providerId)
      const profileModel =
        stringValue(profile.model) ||
        stringValue(profile.model_id) ||
        stringValue(profile.modelId)
      if (profileProvider === currentProvider && profileModel) ids.add(profileModel)
    }
    return ids
  })
  const modelHasSavedProfile = (modelId: string) => savedModelIds().has(modelId)
  const visibleProviderModels = createMemo(() => prioritizeProviderModelEntries(filteredFetchedModels(), savedModelIds()))
  const draftProviderVisible = createMemo(() => draftProviderActive() && (!providerId() || !savedProviderIds().has(providerId())))
  const providerListCount = createMemo(() => providers().length + (draftProviderVisible() ? 1 : 0))
  const selectedProviderKind = createMemo(() => PROVIDER_KIND_REGISTRY.find((item) => item.id === providerKind()))
  const savedApiKeyHint = createMemo(() => {
    const provider = selectedProvider()
    if (!provider) return ""
    return stringValue(provider.api_key_hint) || stringValue(provider.apiKeyHint)
  })
  const selectedProviderKey = createMemo(() => {
    const provider = selectedProvider()
    return provider ? `${stringValue(provider.id)}\n${savedApiKeyHint()}` : ""
  })
  const modelRefreshing = () => providerModelRefreshBusy(providerId())
  const filteredProviderKinds = createMemo(() => {
    const query = kindSearch().trim().toLowerCase()
    if (!query) return PROVIDER_KIND_REGISTRY
    return PROVIDER_KIND_REGISTRY.filter((kind) => {
      const haystack = [
        kind.label,
        kind.description,
        kind.type,
        kind.compat,
        kind.defaultBaseUrl || "",
        ...kind.aliases,
      ].join(" ").toLowerCase()
      return haystack.includes(query)
    })
  })
  const modelEmptyTitle = createMemo(() => selectedProvider() ? emptyModelListMessage() : "保存服务商后可刷新模型目录。")
  const modelCopyMessage = createMemo(() => {
    const id = copiedModelId()
    if (!id) return ""
    if (id === "__error__") return "当前环境不能直接访问剪贴板。"
    return `已复制 ${id}`
  })
  const capabilityStatus = createMemo(() => modelCapabilitiesStatus ? modelCapabilitiesStatus() : {})
  const serverSettings = createMemo(() => {
    const direct = objectValue(server.serverSettingsState()?.settings)
    if (Object.keys(direct).length > 0) return direct
    return {}
  })
  const capabilitySettings = createMemo(() => objectValue(serverSettings().model_capabilities))
  const capabilityUpdatedAt = createMemo(() => stringValue(capabilityStatus().updated_at))
  const capabilitySources = createMemo(() => {
    const raw = capabilityStatus().sources
    if (!Array.isArray(raw)) return []
    return raw
      .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
      .map((item) => stringValue(item.source))
      .filter(Boolean)
  })
  const capabilityError = createMemo(() => stringValue(server.modelCapabilitiesError?.()))
  const recommendation = createMemo(() => modelCapabilityRecommendation ? modelCapabilityRecommendation() : {})
  const recommendationAvailable = createMemo(() => Object.keys(recommendation()).length > 0)
  const capabilitySyncIntervalPreset = createMemo(() => {
    const interval = capabilitySyncIntervalSec()
    if (interval === 86400 || interval === 43200 || interval === 3600) return String(interval)
    return "custom"
  })
  const capabilitySyncIntervalLabel = createMemo(() => {
    const preset = capabilitySyncIntervalPreset()
    if (preset === "86400") return "每日"
    if (preset === "43200") return "每 12 小时"
    if (preset === "3600") return "每小时"
    return `${capabilitySyncIntervalSec()} 秒`
  })

  createEffect(() => {
    if (capabilitySyncDirty()) return
    const settings = capabilitySettings()
    setCapabilitySyncEnabled(settings.enabled !== false)
    setCapabilitySyncIntervalSec(Math.max(60, Math.floor(numberValue(settings.interval_sec, 86400))))
  })

  const updateCapabilitySync = (patch: { enabled?: boolean; intervalSec?: number }) => {
    if (patch.enabled !== undefined) setCapabilitySyncEnabled(patch.enabled)
    if (patch.intervalSec !== undefined) setCapabilitySyncIntervalSec(Math.max(60, Math.floor(patch.intervalSec)))
    setCapabilitySyncDirty(true)
  }

  const saveCapabilitySync = () => {
    saveCapabilitySyncSettings({
      settings: {
        model_capabilities: {
          enabled: capabilitySyncEnabled(),
          interval_sec: Math.max(60, Math.floor(capabilitySyncIntervalSec())),
        },
      },
    })
    setCapabilitySyncDirty(false)
  }
  const modelCapabilityFlags = (model: {
    supports_tools?: unknown
    supports_reasoning?: unknown
    supports_structured_outputs?: unknown
    supports_json_output?: unknown
    supports_vision?: unknown
    supports_parallel_tool_calls?: unknown
  }) => [
    model.supports_tools === true ? "Tools" : "",
    model.supports_reasoning === true ? "Reasoning" : "",
    model.supports_structured_outputs === true ? "Structured" : "",
    model.supports_json_output === true ? "JSON" : "",
    model.supports_vision === true ? "Vision" : "",
    model.supports_parallel_tool_calls === true ? "Parallel tools" : "",
  ].filter(Boolean)
  const updatePositiveInteger = (value: string, setter: (next: number) => void) => {
    const parsed = Number(value)
    setter(Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 1)
  }
  const updateNumber = (value: string, setter: (next: number) => void) => {
    const parsed = Number(value)
    setter(Number.isFinite(parsed) ? parsed : 0)
  }
  const saveModelParameters = () => {
    saveModelPreset()
    closeModelDetail()
  }

  const applyProviderKind = (kindId: ProviderKind) => {
    const kind = PROVIDER_KIND_REGISTRY.find((item) => item.id === kindId)
    const protocol = resolveProviderProtocol(kindId)
    setProviderKind(kindId)
    setProviderType(protocol.type)
    setProviderCompat(protocol.compat)
    if (draftProviderActive() && !providerBaseUrl().trim() && kind?.defaultBaseUrl) {
      setProviderBaseUrl(kind.defaultBaseUrl)
    }
    setKindMenuOpen(false)
    setKindSearch("")
  }

  const startNewProvider = () => {
    resetProviderForm()
    setDraftProviderActive(true)
    applyProviderKind("openai-compatible")
  }

  const selectSavedProvider = (provider: Record<string, unknown>) => {
    const id = stringValue(provider.id)
    const type = normalizeProviderType(provider.type)
    const compat = normalizeProviderCompat(provider.compat)
    setDraftProviderActive(false)
    setProviderKind(inferProviderKind({
      providerId: id,
      baseUrl: stringValue(provider.base_url),
      type,
      compat,
    }))
    selectProvider(provider)
  }

  const updateProviderId = (value: string) => {
    setProviderId(value)
    if (draftProviderActive() && providerKind() === "openai-compatible") {
      const inferred = inferProviderKind({ providerId: value, baseUrl: providerBaseUrl() })
      if (inferred !== "openai-compatible") applyProviderKind(inferred)
    }
  }

  const updateProviderBaseUrl = (value: string) => {
    setProviderBaseUrl(value)
    if (draftProviderActive() && providerKind() === "openai-compatible") {
      const inferred = inferProviderKind({ providerId: providerId(), baseUrl: value })
      if (inferred !== "openai-compatible") applyProviderKind(inferred)
    }
  }

  const setManualProviderType = (value: ProviderType) => {
    setProviderKind("custom")
    setProviderType(value)
  }

  const setManualProviderCompat = (value: ProviderCompat) => {
    setProviderKind("custom")
    setProviderCompat(value)
  }

  const addCustomModel = () => {
    const modelId = customModelDraft().trim()
    if (!modelId) return
    setFetchedModels((current: Array<{ id: string; owned_by?: string; created?: number }>) => {
      if (current.some((model) => model.id === modelId)) return current
      return [{ id: modelId, owned_by: "custom" }, ...current]
    })
    setModelSearch("")
    setCustomModelDraft("")
    setCustomModelInlineOpen(false)
  }

  const removeCustomModel = (modelId: string) => {
    setFetchedModels((current: Array<{ id: string; owned_by?: string; created?: number }>) =>
      current.filter((model) => model.id !== modelId)
    )
  }

  const copyModelId = async (modelId: string) => {
    try {
      if (!navigator.clipboard) throw new Error("clipboard unavailable")
      await navigator.clipboard.writeText(modelId)
      setCopiedModelId(modelId)
    } catch {
      setCopiedModelId("__error__")
    }
    if (copyResetTimer) window.clearTimeout(copyResetTimer)
    copyResetTimer = window.setTimeout(() => setCopiedModelId(""), 1800)
  }

  const setApiKeyDraft = (value: string) => {
    setApiKeyDisplay(value)
    setProviderApiKey(value === savedApiKeyHint() ? "" : value)
  }

  const shouldReplaceSavedApiKeyHint = () =>
    Boolean(savedApiKeyHint() && apiKeyDisplay() === savedApiKeyHint() && !providerApiKey())

  const handleDocumentPointerDown = (event: MouseEvent) => {
    if (!kindMenuOpen() || !kindSelectorRef) return
    if (!kindSelectorRef.contains(event.target as Node)) setKindMenuOpen(false)
  }

  const handleDocumentKeyDown = (event: KeyboardEvent) => {
    if (!kindMenuOpen()) return
    if (event.key === "Escape") {
      event.preventDefault()
      setKindMenuOpen(false)
    }
  }

  createEffect(() => {
    if (draftProviderActive() && providerId() && savedProviderIds().has(providerId())) {
      setDraftProviderActive(false)
    }
  })

  createEffect(() => {
    const source = selectedProviderKey()
    if (source !== apiKeyDisplaySource()) {
      setApiKeyDisplaySource(source)
      setApiKeyDisplay(savedApiKeyHint())
      setProviderApiKey("")
    }
  })

  createEffect(() => {
    if (kindMenuOpen()) window.setTimeout(() => kindSearchRef?.focus(), 0)
  })

  createEffect(() => {
    if (customModelInlineOpen()) window.setTimeout(() => customModelInputRef?.focus(), 0)
  })

  createEffect(() => {
    if (customModelInlineOpen() && !selectedProvider()) {
      setCustomModelDraft("")
      setCustomModelInlineOpen(false)
    }
  })

  onMount(() => {
    document.addEventListener("mousedown", handleDocumentPointerDown)
    document.addEventListener("keydown", handleDocumentKeyDown)
  })

  onCleanup(() => {
    document.removeEventListener("mousedown", handleDocumentPointerDown)
    document.removeEventListener("keydown", handleDocumentKeyDown)
    if (copyResetTimer) window.clearTimeout(copyResetTimer)
  })

  return (
    <div class="settings-page settings-page--wide">
      <div class="settings-page-header">
        <div>
          <h2>{t("provider.title")}</h2>
          <p class="setting-description">
            实际请求 Host：{stringValue(server.connectionState().hostUrl, "未配置")} · Admin：
            {adminUsable() ? "可用" : t("executor.status.unavailable")} · 最近刷新：{server.providersUpdatedAt() || "尚未刷新"}
          </p>
        </div>
        <div class="settings-actions settings-actions--right">
          <button class="btn btn-secondary" type="button" onClick={startNewProvider}>
            <span class="codicon codicon-add" aria-hidden="true" />
            新增服务商
          </button>
          <RefreshButton class="btn-secondary" loading={pageRefreshing("providers")} onClick={() => refreshPage("providers")}>
            刷新
          </RefreshButton>
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
            <StatusBadge>{String(providerListCount())}</StatusBadge>
          </div>
          <div class="provider-list">
            <Show when={providerListCount()} fallback={<p class="settings-empty-note">{providerListEmptyMessage()}</p>}>
              <Show when={draftProviderVisible()}>
                <button
                  type="button"
                  class="provider-list-item provider-list-item--active provider-list-item--draft"
                  aria-current="true"
                  aria-pressed="true"
                  onClick={() => setDraftProviderActive(true)}
                >
                  <span class="provider-list-item__icon codicon codicon-edit" aria-hidden="true" />
                  <span class="provider-list-item__body">
                    <strong>{providerId() || "未命名服务商"}</strong>
                    <small>{providerBaseUrl() || "填写 Base URL 后保存"}</small>
                  </span>
                  <span class="provider-list-item__meta">
                    {selectedProviderKind()?.label || "自定义"}
                    <StatusBadge tone="warning">未保存</StatusBadge>
                  </span>
                </button>
              </Show>
              <For each={providers()}>
                {(provider: Record<string, unknown>) => {
                  const id = stringValue(provider.id)
                  const selected = !draftProviderVisible() && id === providerId()
                  const enabled = provider.enabled !== false
                  return (
                    <button
                      type="button"
                      class={`provider-list-item ${selected ? "provider-list-item--active" : ""}`}
                      aria-pressed={selected}
                      onClick={() => selectSavedProvider(provider)}
                    >
                      <span class="provider-list-item__icon codicon codicon-server-process" aria-hidden="true" />
                      <span class="provider-list-item__body">
                        <strong>{id}</strong>
                        <small>{stringValue(provider.base_url, "未配置 Base URL")}</small>
                      </span>
                      <span class="provider-list-item__meta">
                        {providerCompatLabel(normalizeProviderCompat(provider.compat))}
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
            </div>
            <div class="settings-actions settings-actions--right">
              <Show when={selectedProvider()} fallback={<StatusBadge tone="success">保存后默认启用</StatusBadge>}>
                <button class="btn btn-secondary" type="button" onClick={() => toggleProviderEnabled(!providerEnabled())} disabled={!adminUsable() || providerActionBusy()}>
                  <span class={`codicon codicon-${providerEnabled() ? "circle-slash" : "pass"}`} aria-hidden="true" />
                  {providerEnabled() ? "停用" : "启用"}
                </button>
              </Show>
              <button class="btn btn-primary" type="button" onClick={saveProvider} disabled={!providerId().trim() || !adminUsable() || providerActionBusy()}>
                <span class="codicon codicon-save" aria-hidden="true" />
                保存服务商
              </button>
            </div>
          </div>

          <div class="settings-section settings-section--flat">
            <div class="settings-section-heading">服务商类型</div>
            <div class="provider-kind-selector" ref={kindSelectorRef}>
              <button
                type="button"
                class="provider-kind-trigger"
                aria-haspopup="listbox"
                aria-expanded={kindMenuOpen()}
                onClick={() => setKindMenuOpen(!kindMenuOpen())}
              >
                <span class="provider-kind-trigger__label">当前类型</span>
                <strong>{selectedProviderKind()?.label || "自定义"}</strong>
                <small>{selectedProviderKind()?.description || "手动指定协议类型与兼容模式。"}</small>
                <span class="codicon codicon-chevron-down" aria-hidden="true" />
              </button>
              <div class="provider-kind-summary">
                <span>调用协议</span>
                <strong>{providerTypeLabel(providerType())} · {providerCompatLabel(providerCompat())}</strong>
                <small>{selectedProviderKind()?.defaultBaseUrl ? `默认地址：${selectedProviderKind()?.defaultBaseUrl}` : "可填写任意兼容网关地址"}</small>
              </div>
              <Show when={kindMenuOpen()}>
                <div class="provider-kind-popover" role="region" aria-label="选择服务商类型">
                  <input
                    ref={kindSearchRef}
                    class="setting-input"
                    value={kindSearch()}
                    placeholder="搜索类型、厂商或网关"
                    onInput={(event) => setKindSearch(event.currentTarget.value)}
                  />
                  <div class="provider-kind-list" role="listbox" aria-label="服务商类型">
                    <Show when={filteredProviderKinds().length} fallback={<p class="settings-empty-note">没有匹配类型，可选择“自定义”。</p>}>
                      <For each={filteredProviderKinds()}>
                        {(kind) => {
                          const selected = kind.id === providerKind()
                          return (
                            <button
                              type="button"
                              class={`provider-kind-option ${selected ? "provider-kind-option--active" : ""}`}
                              role="option"
                              aria-selected={selected}
                              onClick={() => applyProviderKind(kind.id)}
                            >
                              <span>
                                <strong>{kind.label}</strong>
                                <small>{kind.description}</small>
                              </span>
                              <span class="provider-kind-option__meta">
                                {providerTypeLabel(kind.type)} · {providerCompatLabel(kind.compat)}
                              </span>
                            </button>
                          )
                        }}
                      </For>
                    </Show>
                  </div>
                </div>
              </Show>
            </div>
          </div>

          <div class="settings-section settings-section--flat">
            <div class="settings-section-heading">连接信息</div>
            <div class="settings-form-grid settings-form-grid--two settings-form-grid--bounded">
              <label class="field-label">
                <span>服务商名称</span>
                <input class="setting-input" value={providerId()} placeholder="deepseek" onInput={(event) => updateProviderId(event.currentTarget.value)} />
              </label>
              <label class="field-label">
                <span>API Base URL</span>
                <input class="setting-input" value={providerBaseUrl()} placeholder="https://api.example.com/v1" onInput={(event) => updateProviderBaseUrl(event.currentTarget.value)} />
              </label>
              <label class="field-label">
                <span>API Key</span>
                <input
                  class="setting-input"
                  value={apiKeyDisplay()}
                  type="text"
                  autocomplete="off"
                  spellcheck={false}
                  placeholder="API Key"
                  onFocus={(event) => {
                    if (savedApiKeyHint() && apiKeyDisplay() === savedApiKeyHint()) {
                      setTimeout(() => event.currentTarget.select(), 0)
                    }
                  }}
                  onKeyDown={(event) => {
                    if (!shouldReplaceSavedApiKeyHint()) return
                    if (event.metaKey || event.ctrlKey || event.altKey) return
                    if (event.key === "Backspace" || event.key === "Delete") {
                      event.preventDefault()
                      setApiKeyDraft("")
                      return
                    }
                    if (event.key.length === 1) {
                      event.preventDefault()
                      setApiKeyDraft(event.key)
                    }
                  }}
                  onPaste={(event) => {
                    if (!shouldReplaceSavedApiKeyHint()) return
                    const text = event.clipboardData?.getData("text") || ""
                    event.preventDefault()
                    setApiKeyDraft(text)
                  }}
                  onInput={(event) => {
                    setApiKeyDraft(event.currentTarget.value)
                  }}
                />
              </label>
            </div>
            <details class="settings-details provider-advanced-protocol">
              <summary>
                <span class="codicon codicon-settings-gear" aria-hidden="true" />
                高级连接参数
                <small>{providerTypeLabel(providerType())} · {providerCompatLabel(providerCompat())}</small>
              </summary>
              <div class="provider-protocol-grid">
                <div>
                  <strong>协议类型</strong>
                  <div class="provider-segmented-list" role="group" aria-label="协议类型">
                    <For each={PROVIDER_TYPE_OPTIONS}>
                      {(item) => (
                        <button
                          type="button"
                          class={`provider-segmented-choice ${providerType() === item ? "provider-segmented-choice--active" : ""}`}
                          aria-pressed={providerType() === item}
                          onClick={() => setManualProviderType(item)}
                        >
                          {providerTypeLabel(item)}
                        </button>
                      )}
                    </For>
                  </div>
                </div>
                <div>
                  <strong>{t("provider.compat")}</strong>
                  <div class="provider-segmented-list" role="group" aria-label={t("provider.compat")}>
                    <For each={PROVIDER_COMPAT_OPTIONS}>
                      {(item) => (
                        <button
                          type="button"
                          class={`provider-segmented-choice ${providerCompat() === item ? "provider-segmented-choice--active" : ""}`}
                          aria-pressed={providerCompat() === item}
                          onClick={() => setManualProviderCompat(item)}
                        >
                          {providerCompatLabel(item)}
                        </button>
                      )}
                    </For>
                  </div>
                </div>
              </div>
            </details>
          </div>

          <div class="settings-section settings-section--flat">
            <div class="settings-section-heading">
              <span>模型目录</span>
              <div class="settings-actions settings-actions--right">
                <button
                  class="btn btn-secondary"
                  type="button"
                  aria-expanded={customModelInlineOpen()}
                  aria-controls="provider-custom-model-form"
                  onClick={() => setCustomModelInlineOpen(!customModelInlineOpen())}
                  disabled={!selectedProvider() || !adminUsable() || providerActionBusy()}
                >
                  <span class="codicon codicon-add" aria-hidden="true" />
                  添加自定义模型
                </button>
                <RefreshButton
                  class="btn-secondary"
                  icon="cloud-download"
                  onClick={() => {
                    requestProviderModels()
                  }}
                  disabled={!selectedProvider() || !adminUsable() || modelRefreshing()}
                  loading={modelRefreshing()}
                >
                  刷新模型列表
                </RefreshButton>
              </div>
            </div>
            <div class="model-capability-sync">
              <div class="model-capability-sync__meta">
                <span>模型能力同步</span>
                <small>
                  {numberValue(capabilityStatus().model_count, 0)} 个模型 · 最近同步 {formatTimestamp(capabilityUpdatedAt())}
                </small>
                <small>
                  后台同步：{capabilitySyncEnabled() ? "开启" : "关闭"} · 周期 {capabilitySyncIntervalLabel()}
                </small>
                <Show when={capabilitySources().length}>
                  <small>来源：{capabilitySources().join(" / ")}</small>
                </Show>
              </div>
              <label class="field-label field-label--checkbox">
                <input
                  type="checkbox"
                  checked={capabilitySyncEnabled()}
                  onChange={(event) => updateCapabilitySync({ enabled: event.currentTarget.checked })}
                />
                <span>每日后台同步</span>
              </label>
              <label class="field-label model-capability-sync__interval">
                <span>同步周期</span>
                <select
                  value={capabilitySyncIntervalPreset()}
                  onChange={(event) => {
                    const value = event.currentTarget.value
                    if (value !== "custom") updateCapabilitySync({ intervalSec: Number(value) })
                  }}
                >
                  <option value="86400">每日</option>
                  <option value="43200">每 12 小时</option>
                  <option value="3600">每小时</option>
                  <option value="custom">自定义</option>
                </select>
                <Show when={capabilitySyncIntervalPreset() === "custom"}>
                  <input
                    type="number"
                    min="60"
                    value={capabilitySyncIntervalSec()}
                    onInput={(event) => updateCapabilitySync({ intervalSec: Number(event.currentTarget.value) || 60 })}
                  />
                </Show>
              </label>
              <button class="btn btn-secondary" type="button" disabled={!capabilitySyncDirty() || serverSettingsSaveBusy() || providerActionBusy()} onClick={saveCapabilitySync}>
                <span class="codicon codicon-save" aria-hidden="true" />
                保存同步设置
              </button>
              <RefreshButton
                class="btn-secondary"
                icon="sync"
                onClick={() => refreshModelCapabilities()}
                disabled={!adminUsable() || providerActionBusy()}
                loading={operations.isBusy("modelCapabilities")}
              >
                同步能力表
              </RefreshButton>
            </div>
            <Show when={capabilityError()}>
              <p class="settings-empty-note settings-empty-note--error">{capabilityError()}</p>
            </Show>
            <Show when={customModelInlineOpen()}>
              <div id="provider-custom-model-form" class="settings-inline-form provider-custom-model-inline">
                <input
                  ref={customModelInputRef}
                  class="setting-input"
                  value={customModelDraft()}
                  placeholder="手动添加模型名，例如 deepseek-chat"
                  onInput={(event) => setCustomModelDraft(event.currentTarget.value)}
                  disabled={!selectedProvider() || !adminUsable()}
                />
                <button class="btn btn-primary" type="button" onClick={addCustomModel} disabled={!customModelDraft().trim() || !selectedProvider() || !adminUsable()}>
                  <span class="codicon codicon-check" aria-hidden="true" />
                  确认添加
                </button>
                <button
                  class="btn btn-secondary"
                  type="button"
                  onClick={() => {
                    setCustomModelDraft("")
                    setCustomModelInlineOpen(false)
                  }}
                >
                  取消
                </button>
              </div>
            </Show>
            <Show when={!selectedProvider()}>
              <p class="settings-empty-note">保存服务商后可刷新模型目录</p>
            </Show>
            <div class="settings-inline-form">
              <input class="setting-input" value={modelSearch()} placeholder="搜索模型" onInput={(event) => setModelSearch(event.currentTarget.value)} />
            </div>
            <Show when={modelFetchMessage()}>
              <p class="settings-empty-note">{modelFetchMessage()}</p>
            </Show>
            <Show when={modelCopyMessage()}>
              <p class={`settings-empty-note ${copiedModelId() === "__error__" ? "settings-empty-note--error" : ""}`}>{modelCopyMessage()}</p>
            </Show>
            <Show when={visibleProviderModels().length} fallback={
              <div class="settings-empty-state">
                <span class="codicon codicon-symbol-string" aria-hidden="true" />
                <strong>{modelEmptyTitle()}</strong>
                <small>
                  {selectedProvider() && showCustomModelFallback()
                    ? "可手动添加模型名"
                    : "无匹配模型"}
                </small>
                <div class="settings-actions">
                  <Show when={modelSearch().trim()}>
                    <button class="btn btn-secondary" type="button" onClick={() => setModelSearch("")}>
                      清空搜索
                    </button>
                  </Show>
                </div>
              </div>
            }>
              <div class="provider-model-list">
                <For each={visibleProviderModels()}>
                  {(model) => {
                    const custom = model.owned_by === "custom"
                    const flags = modelCapabilityFlags(model)
                    const owner = modelOwnerDisplay(model.owned_by, providerId())
                    const added = () => modelHasSavedProfile(model.id)
                    return (
                      <div class={`provider-model-row ${custom ? "provider-model-row--custom" : ""}`}>
                        <span class="provider-model-row__body">
                          <strong>{model.id}</strong>
                          <Show when={custom || owner}>
                            <small>{custom ? "自定义模型名" : owner}</small>
                          </Show>
                          <Show when={model.max_tokens || model.max_context_tokens}>
                            <small>上下文 {model.max_context_tokens || "-"} · 输出 {model.max_tokens || "-"}</small>
                          </Show>
                          <Show when={stringValue(model.capability_source)}>
                            <small>来源 {stringValue(model.capability_source)}</small>
                          </Show>
                          <Show when={flags.length}>
                            <span class="settings-badge-group provider-model-row__flags">
                              <For each={flags}>{(flag) => <StatusBadge tone="muted">{flag}</StatusBadge>}</For>
                              <Show when={added()}>
                                <StatusBadge tone="success">已添加</StatusBadge>
                              </Show>
                            </span>
                          </Show>
                          <Show when={added() && !flags.length}>
                            <span class="settings-badge-group provider-model-row__flags">
                              <StatusBadge tone="success">已添加</StatusBadge>
                            </span>
                          </Show>
                        </span>
                        <span class="provider-model-row__actions">
                          <button
                            class={`btn ${added() ? "btn-secondary" : "btn-primary"} btn--compact`}
                            type="button"
                            onClick={() => openModelDetail(model.id, custom ? "custom" : "fetched")}
                            disabled={!selectedProvider() || !adminUsable() || providerActionBusy()}
                          >
                            <span class={`codicon codicon-${added() ? "settings-gear" : "add"}`} aria-hidden="true" />
                            {added() ? "配置" : "添加"}
                          </button>
                          <button class="btn btn-secondary btn--compact" type="button" onClick={() => testProvider(model.id)} disabled={!selectedProvider() || !adminUsable() || providerActionBusy()}>
                            <span class="codicon codicon-beaker" aria-hidden="true" />
                            测试
                          </button>
                          <button class="ez-icon-button" type="button" title="复制模型名" onClick={() => void copyModelId(model.id)}>
                            <span class="codicon codicon-copy" aria-hidden="true" />
                          </button>
                          <Show when={added()}>
                            <button
                              class="ez-icon-button"
                              type="button"
                              title="移除预设"
                              onClick={() => deleteModelPresetByModel(model.id)}
                              disabled={!selectedProvider() || !adminUsable() || providerActionBusy()}
                            >
                              <span class="codicon codicon-trash" aria-hidden="true" />
                            </button>
                          </Show>
                          <Show when={custom}>
                            <button class="ez-icon-button" type="button" title="移除自定义模型" onClick={() => removeCustomModel(model.id)}>
                              <span class="codicon codicon-trash" aria-hidden="true" />
                            </button>
                          </Show>
                        </span>
                      </div>
                    )
                  }}
                </For>
              </div>
            </Show>
          </div>

          <details class="settings-details">
            <summary>
              <span class="codicon codicon-copy" aria-hidden="true" />
              高级操作
            </summary>
            <div class="settings-inline-form">
              <input class="setting-input" value={providerCopyId()} placeholder="复制后的服务商 ID" onInput={(event) => setProviderCopyId(event.currentTarget.value)} />
              <button class="btn btn-secondary" type="button" onClick={copyProvider} disabled={!selectedProvider() || !adminUsable() || providerActionBusy()}>
                <span class="codicon codicon-copy" aria-hidden="true" />
                复制服务商
              </button>
            </div>
          </details>

          <div class="settings-section settings-section--flat danger-zone">
            <div class="settings-section-heading">危险区</div>
            <button class="btn btn-danger" type="button" onClick={deleteProvider} disabled={!selectedProvider() || !adminUsable() || providerActionBusy()}>
              <span class="codicon codicon-trash" aria-hidden="true" />
              删除服务商
            </button>
          </div>
        </section>
      </div>
      <Show when={modelDetailOpen()}>
        <DialogSurface
          ariaLabel="模型参数配置"
          backdropClass="settings-overlay settings-overlay--center"
          surfaceClass="settings-modal model-profile-modal"
          initialFocusSelector=".model-profile-modal input"
          onClose={closeModelDetail}
        >
          <div class="settings-modal__header">
            <div>
              <h3>模型参数配置</h3>
              <p>{profileProvider() || providerId()} · {profileModel()}</p>
            </div>
            <button class="ez-icon-button" type="button" title="关闭" onClick={closeModelDetail}>
              <span class="codicon codicon-close" aria-hidden="true" />
            </button>
          </div>
          <div class="model-profile-form">
            <label class="field-label">
              <span>模型</span>
              <input class="setting-input" value={profileModel()} readOnly />
            </label>
            <label class="field-label">
              <span>最大上下文 tokens</span>
              <input
                class="setting-input"
                type="number"
                min="1"
                step="1"
                value={maxContextTokens() || ""}
                onInput={(event) => updatePositiveInteger(event.currentTarget.value, setMaxContextTokens)}
              />
              <small>1M 上下文填写 1000000。</small>
            </label>
            <label class="field-label">
              <span>最大输出 tokens</span>
              <input
                class="setting-input"
                type="number"
                min="1"
                step="1"
                value={maxTokens() || ""}
                onInput={(event) => updatePositiveInteger(event.currentTarget.value, setMaxTokens)}
              />
            </label>
            <label class="field-label">
              <span>Temperature</span>
              <input
                class="setting-input"
                type="number"
                min="0"
                step="0.1"
                value={temperature()}
                onInput={(event) => updateNumber(event.currentTarget.value, setTemperature)}
              />
            </label>
            <label class="field-label">
              <span>Reasoning effort</span>
              <input
                class="setting-input"
                value={reasoningEffort()}
                placeholder="low / medium / high / max"
                onInput={(event) => setReasoningEffort(event.currentTarget.value)}
              />
            </label>
            <label class="model-profile-toggle">
              <input
                type="checkbox"
                checked={thinkingEnabled()}
                onChange={(event) => setThinkingEnabled(event.currentTarget.checked)}
              />
              <span>启用 thinking</span>
            </label>
          </div>
          <Show when={recommendationAvailable()}>
            <div class="model-capability-recommendation">
              <div>
                <strong>能力目录推荐值</strong>
                <small>{stringValue(recommendation().source, "catalog")}</small>
              </div>
              <div class="model-capability-recommendation__grid">
                <span>当前上下文 {numberValue(recommendation().current_max_context_tokens, maxContextTokens())}</span>
                <span>推荐上下文 {numberValue(recommendation().max_context_tokens, maxContextTokens())}</span>
                <span>当前输出 {numberValue(recommendation().current_max_tokens, maxTokens())}</span>
                <span>推荐输出 {numberValue(recommendation().max_tokens, maxTokens())}</span>
              </div>
              <button class="btn btn-secondary" type="button" onClick={() => applyModelCapabilityRecommendation(profileId())} disabled={!profileId() || !adminUsable() || providerActionBusy()}>
                <span class="codicon codicon-check" aria-hidden="true" />
                一键应用推荐值
              </button>
            </div>
          </Show>
          <div class="settings-actions settings-actions--right">
            <Show when={modelHasSavedProfile(profileModel())}>
              <button class="btn btn-danger" type="button" onClick={() => deleteModelPreset(profileId())} disabled={!profileId() || !adminUsable() || providerActionBusy()}>
                <span class="codicon codicon-trash" aria-hidden="true" />
                移除预设
              </button>
            </Show>
            <button class="btn btn-secondary" type="button" onClick={closeModelDetail}>
              取消
            </button>
            <button class="btn btn-primary" type="button" onClick={saveModelParameters} disabled={!profileModel().trim() || !adminUsable() || providerActionBusy()}>
              <span class="codicon codicon-save" aria-hidden="true" />
              保存参数
            </button>
          </div>
        </DialogSurface>
      </Show>
    </div>
  )
}
