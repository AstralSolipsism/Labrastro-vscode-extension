import { Component, For, Show, createEffect, createMemo, createSignal } from "solid-js"
import { RefreshButton } from "../../components/common/RefreshButton"
import { t } from "../../i18n"
import { StatusBadge } from "../components/StatusBadge"
import {
  SettingsActionRail,
  SettingsFlatSection,
  SettingsPage,
  SettingsPageHeader,
  SettingsSectionHeading,
} from "../components/SettingsLayout"
import {
  agentSectionTone,
  enabledPolicyCount,
  memoryStatusActionKey,
  memoryStatusLabelKey,
  memoryStatusReasonKey,
  memoryStatusTone,
  sourceSectionTone,
} from "../memoryPresentation"
import type { SettingsController } from "../useSettingsController"

interface TabProps { controller: SettingsController & Record<string, any> }

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function numberValue(value: unknown, fallback = 0): number {
  const parsed = typeof value === "number" ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function boolValue(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback
}

function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback
}

function listValue(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item).trim()).filter(Boolean) : []
}

function recordListValue(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
    : []
}

function formatJsonObject(value: unknown): string {
  return JSON.stringify(objectValue(value), null, 2)
}

function parseJsonObject(text: string, label: string): Record<string, unknown> {
  const trimmed = text.trim()
  if (!trimmed) return {}
  const parsed = JSON.parse(trimmed)
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(t("memorySettings.jsonObjectRequired", { label }))
  }
  return parsed as Record<string, unknown>
}

function parseCsvList(value: string): string[] {
  return value.split(",").map((item) => item.trim()).filter(Boolean)
}

function preserveMemoryToolPolicy(memoryTools: Record<string, unknown>): Record<string, unknown> {
  const reserved = new Set(["enabled", "provider", "allowed_agents"])
  const preserved: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(memoryTools)) {
    if (!reserved.has(key)) preserved[key] = value
  }
  return preserved
}

function boolLabel(value: unknown): string {
  return boolValue(value) ? t("memorySettings.boolean.enabled") : t("memorySettings.boolean.disabled")
}

function commaList(value: unknown): string {
  const items = listValue(value)
  return items.length > 0 ? items.join(", ") : t("memorySettings.unspecified")
}

export const MemoryTab: Component<TabProps> = (props) => {
  const { operations, pageRefreshing, refreshPage, saveMemorySettings, server, serverSettingsSaveBusy } = props.controller
  const [dirty, setDirty] = createSignal(false)
  const [memoryEnabled, setMemoryEnabled] = createSignal(false)
  const [memoryInjectDefault, setMemoryInjectDefault] = createSignal(true)
  const [memoryCaptureDefault, setMemoryCaptureDefault] = createSignal(true)
  const [memoryDefaultProvider, setMemoryDefaultProvider] = createSignal("")
  const [memoryProvidersJson, setMemoryProvidersJson] = createSignal("{}")
  const [memorySourcesJson, setMemorySourcesJson] = createSignal("{}")
  const [memoryAgentId, setMemoryAgentId] = createSignal("core")
  const [memoryNamespace, setMemoryNamespace] = createSignal("")
  const [memoryTokenBudget, setMemoryTokenBudget] = createSignal(800)
  const [memoryFailMode, setMemoryFailMode] = createSignal("open")
  const [memoryTraceEnabled, setMemoryTraceEnabled] = createSignal(true)
  const [memoryTrustPolicy, setMemoryTrustPolicy] = createSignal("wrap_external")
  const [memoryToolsEnabled, setMemoryToolsEnabled] = createSignal(false)
  const [memoryToolsProvider, setMemoryToolsProvider] = createSignal("")
  const [memoryToolsAllowedAgents, setMemoryToolsAllowedAgents] = createSignal("")
  const [memoryToolsPolicy, setMemoryToolsPolicy] = createSignal<Record<string, unknown>>({})
  const [memoryConfigError, setMemoryConfigError] = createSignal("")

  const serverSettings = createMemo(() => objectValue(server.serverSettingsState()?.settings))
  const memoryStatus = createMemo(() => objectValue(serverSettings().memory_status))
  const memoryProviderStatuses = createMemo(() => recordListValue(memoryStatus().providers))
  const memoryAgentPolicies = createMemo(() => recordListValue(memoryStatus().agent_policies))
  const memorySourceStatuses = createMemo(() => recordListValue(memoryStatus().sources))
  const memoryToolsStatus = createMemo(() => objectValue(memoryStatus().tools))

  const markDirty = () => {
    setDirty(true)
    setMemoryConfigError("")
  }

  const syncFromSettings = () => {
    const memory = objectValue(serverSettings().memory)
    const memoryRuntime = objectValue(memory.runtime)
    const memoryTools = objectValue(memory.tools)
    setMemoryEnabled(boolValue(memory.enabled, false))
    setMemoryInjectDefault(boolValue(memoryRuntime.inject_default, true))
    setMemoryCaptureDefault(boolValue(memoryRuntime.capture_default, true))
    setMemoryDefaultProvider(stringValue(memory.default_provider))
    setMemoryProvidersJson(formatJsonObject(memory.providers))
    setMemorySourcesJson(formatJsonObject(memory.sources))
    setMemoryAgentId(stringValue(memory.default_agent_id, "core"))
    setMemoryNamespace(stringValue(memory.default_namespace))
    setMemoryTokenBudget(Math.max(1, Math.floor(numberValue(memoryRuntime.token_budget_default, 800))))
    setMemoryFailMode(stringValue(memoryRuntime.fail_mode, "open"))
    setMemoryTraceEnabled(boolValue(memoryRuntime.trace_enabled, true))
    setMemoryTrustPolicy(stringValue(memoryRuntime.trust_policy, "wrap_external"))
    setMemoryToolsEnabled(boolValue(memoryTools.enabled, false))
    setMemoryToolsProvider(stringValue(memoryTools.provider))
    setMemoryToolsAllowedAgents(listValue(memoryTools.allowed_agents).join(", "))
    setMemoryToolsPolicy(preserveMemoryToolPolicy(memoryTools))
    setMemoryConfigError("")
  }

  createEffect(() => {
    if (dirty()) return
    syncFromSettings()
  })

  const save = () => {
    let providers: Record<string, unknown>
    let sources: Record<string, unknown>
    try {
      providers = parseJsonObject(memoryProvidersJson(), t("memorySettings.providerConfigLabel"))
      sources = parseJsonObject(memorySourcesJson(), t("memorySettings.sourceConfigLabel"))
    } catch (error) {
      setMemoryConfigError(error instanceof Error ? error.message : String(error))
      return
    }
    saveMemorySettings({
      settings: {
        memory: {
          enabled: memoryEnabled(),
          default_provider: memoryDefaultProvider().trim(),
          default_agent_id: memoryAgentId().trim() || "core",
          default_namespace: memoryNamespace().trim(),
          runtime: {
            inject_default: memoryInjectDefault(),
            capture_default: memoryCaptureDefault(),
            token_budget_default: Math.max(1, Math.floor(memoryTokenBudget())),
            fail_mode: memoryFailMode(),
            trace_enabled: memoryTraceEnabled(),
            trust_policy: memoryTrustPolicy().trim() || "wrap_external",
          },
          providers,
          sources,
          tools: {
            ...memoryToolsPolicy(),
            enabled: memoryToolsEnabled(),
            provider: memoryToolsProvider().trim(),
            allowed_agents: parseCsvList(memoryToolsAllowedAgents()),
          },
        },
      },
    })
    setDirty(false)
  }

  const defaultProviderStatus = createMemo(() =>
    memoryEnabled() ? stringValue(memoryStatus().default_provider_status, "not_configured") : "disabled"
  )
  const defaultProviderName = createMemo(() =>
    stringValue(memoryStatus().default_provider) || memoryDefaultProvider() || t("memorySettings.unspecified")
  )
  const agentTone = createMemo(() => agentSectionTone(memoryEnabled(), memoryAgentPolicies()))
  const enabledAgents = createMemo(() => enabledPolicyCount(memoryAgentPolicies()))
  const sourceTone = createMemo(() => sourceSectionTone(memorySourceStatuses()))
  const statusLabel = (status: unknown) => t(memoryStatusLabelKey(status))
  const statusReason = (status: unknown) => t(memoryStatusReasonKey(status))
  const statusAction = (status: unknown) => t(memoryStatusActionKey(status))
  const statusNextStep = (status: unknown) =>
    t("memorySettings.status.nextStepLine", { reason: statusReason(status), action: statusAction(status) })
  const itemCount = (count: number) => t("memorySettings.count.items", { count })
  const sourceCount = (count: number) => t("memorySettings.count.sources", { count })

  return (
    <SettingsPage wide>
      <SettingsPageHeader>
        <div>
          <h2>{t("memorySettings.title")}</h2>
          <p class="setting-description">{t("memorySettings.desc")}</p>
        </div>
        <SettingsActionRail align="right">
          <RefreshButton class="btn-secondary" loading={pageRefreshing("memory")} onClick={() => refreshPage("memory")}>
            {t("common.refresh")}
          </RefreshButton>
          <button class="btn btn-primary" type="button" disabled={!dirty() || serverSettingsSaveBusy()} onClick={save}>
            <span class="codicon codicon-save" aria-hidden="true" />
            {t("common.save")}
          </button>
        </SettingsActionRail>
      </SettingsPageHeader>

      <Show when={operations.error("memorySave") || operations.error("serverSettings")}>
        <div class="settings-error">{operations.error("memorySave") || operations.error("serverSettings")}</div>
      </Show>
      <Show when={memoryConfigError()}>
        <div class="settings-error">{memoryConfigError()}</div>
      </Show>
      <Show when={operations.state("memorySave").status === "success" && !dirty()}>
        <div class="settings-success">{t("memorySettings.saved")}</div>
      </Show>

      <div class="settings-summary-strip memory-console-summary">
        <div class="settings-summary-card settings-summary-card--static">
          <span>{t("memorySettings.summary.runtime")}</span>
          <strong>{memoryEnabled() ? t("memorySettings.runtime.enabled") : t("memorySettings.runtime.disabled")}</strong>
          <small>{memoryEnabled() ? t("memorySettings.summary.runtimeEnabled") : t("memorySettings.summary.runtimeDisabled")}</small>
        </div>
        <div class="settings-summary-card settings-summary-card--static">
          <span>{t("memorySettings.summary.defaultProvider")}</span>
          <strong>{defaultProviderName()}</strong>
          <small>{statusLabel(defaultProviderStatus())}</small>
        </div>
        <div class="settings-summary-card settings-summary-card--static">
          <span>{t("memorySettings.summary.sources")}</span>
          <strong>{memorySourceStatuses().length ? itemCount(memorySourceStatuses().length) : t("memorySettings.notConfigured")}</strong>
          <small>{sourceTone() === "error" ? t("memorySettings.summary.sourcesNeedWork") : t("memorySettings.summary.sourcesOk")}</small>
        </div>
        <div class="settings-summary-card settings-summary-card--static">
          <span>{t("memorySettings.summary.agentUsage")}</span>
          <strong>{enabledAgents()} / {memoryAgentPolicies().length}</strong>
          <small>{agentTone() === "error" ? t("memorySettings.summary.agentNeedWork") : t("memorySettings.summary.agentOk")}</small>
        </div>
      </div>

      <SettingsFlatSection>
        <SettingsSectionHeading>
          <span>{t("memorySettings.providerSection.title")}</span>
          <StatusBadge tone={memoryStatusTone(defaultProviderStatus())}>
            {memoryEnabled() ? statusLabel(defaultProviderStatus()) : t("memorySettings.runtime.disabled")}
          </StatusBadge>
        </SettingsSectionHeading>
        <p class="settings-empty-note">{t("memorySettings.providerSection.desc")}</p>
        <div class="settings-detail-grid">
          <div class="settings-detail-block">
            <span>{t("memorySettings.defaultProvider")}</span>
            <strong>{defaultProviderName()}</strong>
            <small>{statusNextStep(defaultProviderStatus())}</small>
          </div>
          <div class="settings-detail-block">
            <span>{t("memorySettings.providerCount")}</span>
            <strong>{numberValue(memoryStatus().available_provider_count)} / {numberValue(memoryStatus().provider_count)}</strong>
            <small>{t("memorySettings.providerCount.help")}</small>
          </div>
        </div>
        <Show when={memoryProviderStatuses().length > 0} fallback={<p class="settings-empty-note">{t("memorySettings.providerSection.empty")}</p>}>
          <div class="settings-list">
            <For each={memoryProviderStatuses()}>{(provider) => (
              <div class="settings-list-item settings-list-item--static memory-status-row">
                <div class="memory-status-row__body">
                  <strong>{stringValue(provider.id, stringValue(provider.provider, t("memorySettings.unnamedProvider")))}</strong>
                  <small>{t("memorySettings.adapterLine", { adapter: stringValue(provider.adapter, t("memorySettings.unspecified")) })}</small>
                  <small>{statusNextStep(provider.status)}</small>
                </div>
                <StatusBadge tone={memoryStatusTone(provider.status)}>{statusLabel(provider.status)}</StatusBadge>
              </div>
            )}</For>
          </div>
        </Show>
      </SettingsFlatSection>

      <SettingsFlatSection>
        <SettingsSectionHeading>
          <span>{t("memorySettings.sourceSection.title")}</span>
          <StatusBadge tone={sourceTone()}>
            {memorySourceStatuses().length > 0 ? sourceCount(memorySourceStatuses().length) : t("memorySettings.notConfigured")}
          </StatusBadge>
        </SettingsSectionHeading>
        <p class="settings-empty-note">{t("memorySettings.sourceSection.desc")}</p>
        <Show when={memorySourceStatuses().length > 0} fallback={<p class="settings-empty-note">{t("memorySettings.sourceSection.empty")}</p>}>
          <div class="settings-list">
            <For each={memorySourceStatuses()}>{(source) => (
              <div class="settings-list-item settings-list-item--static memory-status-row">
                <div class="memory-status-row__body">
                  <strong>{stringValue(source.id, t("memorySettings.source.fallbackName"))}</strong>
                  <small>{t("memorySettings.source.metaLine", {
                    adapter: stringValue(source.adapter, t("memorySettings.unspecified")),
                    target: stringValue(source.target_provider, t("memorySettings.unspecified")),
                    sync: stringValue(source.sync_mode, "manual"),
                  })}</small>
                  <small>{statusNextStep(source.status)}</small>
                </div>
                <StatusBadge tone={memoryStatusTone(source.status)}>{statusLabel(source.status)}</StatusBadge>
              </div>
            )}</For>
          </div>
        </Show>
      </SettingsFlatSection>

      <SettingsFlatSection>
        <SettingsSectionHeading>
          <span>{t("memorySettings.agentSection.title")}</span>
          <StatusBadge tone={agentTone()}>{memoryEnabled() ? t("memorySettings.count.enabledAgents", { count: enabledAgents() }) : t("memorySettings.runtime.disabled")}</StatusBadge>
        </SettingsSectionHeading>
        <p class="settings-empty-note">{t("memorySettings.agentSection.desc")}</p>
        <Show when={memoryAgentPolicies().length > 0} fallback={<p class="settings-empty-note">{t("memorySettings.agentSection.empty")}</p>}>
          <div class="settings-list">
            <For each={memoryAgentPolicies()}>{(policy) => {
              const policyStatus = () => boolValue(policy.enabled) ? policy.provider_status : "disabled"
              return (
                <div class="settings-list-item settings-list-item--static memory-status-row">
                  <div class="memory-status-row__body">
                    <strong>{stringValue(policy.agent_name, stringValue(policy.agent_id, t("memorySettings.agent.fallbackName")))}</strong>
                    <small>
                      {t("memorySettings.agent.metaLine", {
                        source: stringValue(policy.policy_source) === "overridden" ? t("memorySettings.agent.policy.overridden") : t("memorySettings.agent.policy.inherited"),
                        provider: stringValue(policy.primary_provider, t("memorySettings.unspecified")),
                        inject: boolLabel(policy.inject),
                        capture: boolLabel(policy.capture),
                      })}
                    </small>
                    <small>{statusNextStep(policyStatus())}</small>
                  </div>
                  <StatusBadge tone={memoryStatusTone(policyStatus())}>
                    {boolValue(policy.enabled) ? statusLabel(policy.provider_status) : t("memorySettings.boolean.disabled")}
                  </StatusBadge>
                </div>
              )
            }}</For>
          </div>
        </Show>
      </SettingsFlatSection>

      <SettingsFlatSection>
        <details class="settings-advanced-panel">
          <summary class="settings-section-heading">
            <span>{t("memorySettings.advanced.title")}</span>
            <StatusBadge tone={memoryTraceEnabled() ? "success" : "muted"}>
              {memoryTraceEnabled() ? t("memorySettings.trace.enabled") : t("memorySettings.trace.disabled")}
            </StatusBadge>
          </summary>
          <p class="settings-empty-note">{t("memorySettings.advanced.desc")}</p>
          <div class="settings-form-grid settings-form-grid--two">
          <label class="field-label field-label--checkbox">
            <input type="checkbox" checked={memoryEnabled()} onChange={(event) => { setMemoryEnabled(event.currentTarget.checked); markDirty() }} />
            <span>{t("memorySettings.form.enableRuntime")}</span>
          </label>
          <label class="field-label field-label--checkbox">
            <input type="checkbox" checked={memoryInjectDefault()} onChange={(event) => { setMemoryInjectDefault(event.currentTarget.checked); markDirty() }} />
            <span>{t("memorySettings.form.injectDefault")}</span>
          </label>
          <label class="field-label field-label--checkbox">
            <input type="checkbox" checked={memoryCaptureDefault()} onChange={(event) => { setMemoryCaptureDefault(event.currentTarget.checked); markDirty() }} />
            <span>{t("memorySettings.form.captureDefault")}</span>
          </label>
          <label class="field-label field-label--checkbox">
            <input type="checkbox" checked={memoryTraceEnabled()} onChange={(event) => { setMemoryTraceEnabled(event.currentTarget.checked); markDirty() }} />
            <span>{t("memorySettings.form.traceEnabled")}</span>
          </label>
          <label class="field-label"><span>{t("memorySettings.form.defaultProviderId")}</span>
            <input value={memoryDefaultProvider()} placeholder="agentmemory" onInput={(event) => { setMemoryDefaultProvider(event.currentTarget.value); markDirty() }} />
          </label>
          <label class="field-label"><span>{t("memorySettings.form.failMode")}</span>
            <select value={memoryFailMode()} onChange={(event) => { setMemoryFailMode(event.currentTarget.value); markDirty() }}>
              <option value="open">open</option>
              <option value="closed">closed</option>
            </select>
          </label>
          <label class="field-label"><span>{t("memorySettings.form.defaultAgentId")}</span>
            <input value={memoryAgentId()} onInput={(event) => { setMemoryAgentId(event.currentTarget.value); markDirty() }} />
          </label>
          <label class="field-label"><span>{t("memorySettings.form.defaultNamespace")}</span>
            <input value={memoryNamespace()} onInput={(event) => { setMemoryNamespace(event.currentTarget.value); markDirty() }} />
          </label>
          <label class="field-label"><span>{t("memorySettings.form.tokenBudget")}</span>
            <input type="number" min="1" value={memoryTokenBudget()} onInput={(event) => { setMemoryTokenBudget(Number(event.currentTarget.value) || 1); markDirty() }} />
          </label>
          <label class="field-label"><span>{t("memorySettings.form.trustPolicy")}</span>
            <input value={memoryTrustPolicy()} onInput={(event) => { setMemoryTrustPolicy(event.currentTarget.value); markDirty() }} />
          </label>
          <label class="field-label field-label--full"><span>{t("memorySettings.form.providerAdaptersJson")}</span>
            <textarea rows={6} value={memoryProvidersJson()} placeholder={'{"agentmemory":{"adapter":"agentmemory_rest","base_url":"http://127.0.0.1:3111"}}'} onInput={(event) => { setMemoryProvidersJson(event.currentTarget.value); markDirty() }} />
          </label>
          <label class="field-label field-label--full"><span>{t("memorySettings.form.sourceConnectorsJson")}</span>
            <textarea rows={4} value={memorySourcesJson()} placeholder={'{"github_project":{"adapter":"github","target_provider":"agentmemory"}}'} onInput={(event) => { setMemorySourcesJson(event.currentTarget.value); markDirty() }} />
          </label>
          <div class="settings-detail-section field-label--full">
            <span>{t("memorySettings.toolsPolicy.title")}</span>
            <small>{stringValue(memoryToolsStatus().message, t("memorySettings.toolsPolicy.desc"))}</small>
          </div>
          <label class="field-label field-label--checkbox">
            <input type="checkbox" checked={memoryToolsEnabled()} onChange={(event) => { setMemoryToolsEnabled(event.currentTarget.checked); markDirty() }} />
            <span>{t("memorySettings.toolsPolicy.keep")}</span>
          </label>
          <label class="field-label"><span>{t("memorySettings.toolsPolicy.providerId")}</span>
            <input value={memoryToolsProvider()} placeholder="agentmemory" onInput={(event) => { setMemoryToolsProvider(event.currentTarget.value); markDirty() }} />
          </label>
          <label class="field-label"><span>{t("memorySettings.toolsPolicy.allowedAgents")}</span>
            <input value={memoryToolsAllowedAgents()} placeholder="researcher, reviewer" onInput={(event) => { setMemoryToolsAllowedAgents(event.currentTarget.value); markDirty() }} />
            <small class="field-help">{t("memorySettings.toolsPolicy.currentValue", { value: commaList(memoryToolsStatus().allowed_agents) })}</small>
          </label>
          </div>
        </details>
      </SettingsFlatSection>
    </SettingsPage>
  )
}
