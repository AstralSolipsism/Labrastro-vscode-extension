import { Component, Show, createEffect, createMemo, createSignal } from "solid-js"
import { t } from "../../i18n"
import { RefreshButton } from "../../components/common/RefreshButton"
import { StatusBadge } from "../components/StatusBadge"
import type { SettingsController } from "../useSettingsController"

interface TabProps { controller: SettingsController & Record<string, any> }

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {}
}

function numberValue(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback
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

function formatJsonObject(value: unknown): string {
  return JSON.stringify(objectValue(value), null, 2)
}

function parseJsonObject(text: string, label: string): Record<string, unknown> {
  const trimmed = text.trim()
  if (!trimmed) return {}
  const parsed = JSON.parse(trimmed)
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${label} 必须是 JSON object`)
  }
  return parsed as Record<string, unknown>
}

function parseCsvList(value: string): string[] {
  return value.split(",").map((item) => item.trim()).filter(Boolean)
}

export const SessionPolicyTab: Component<TabProps> = (props) => {
  const { operations, pageRefreshing, refreshPage, saveSessionPolicySettings, server, serverSettingsSaveBusy } = props.controller
  const [dirty, setDirty] = createSignal(false)
  const [saved, setSaved] = createSignal(false)

  const [toolMaxChars, setToolMaxChars] = createSignal(12000)
  const [toolMaxLines, setToolMaxLines] = createSignal(120)
  const [toolStoreFull, setToolStoreFull] = createSignal(true)
  const [toolStoreDir, setToolStoreDir] = createSignal("")

  const [snipKeepRecentTools, setSnipKeepRecentTools] = createSignal(2)
  const [snipThresholdChars, setSnipThresholdChars] = createSignal(1500)
  const [snipMinLines, setSnipMinLines] = createSignal(6)
  const [summarizeKeepRecentTurns, setSummarizeKeepRecentTurns] = createSignal(5)
  const [tokenFudgeFactor, setTokenFudgeFactor] = createSignal(1.1)

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
  const [memoryToolsRecall, setMemoryToolsRecall] = createSignal(false)
  const [memoryToolsRemember, setMemoryToolsRemember] = createSignal(false)
  const [memoryToolsForget, setMemoryToolsForget] = createSignal(false)
  const [memoryToolsList, setMemoryToolsList] = createSignal(false)
  const [memoryConfigError, setMemoryConfigError] = createSignal("")

  const serverSettings = createMemo(() => {
    const direct = objectValue(server.serverSettingsState()?.settings)
    if (Object.keys(direct).length > 0) return direct
    return {}
  })

  const markDirty = () => {
    setDirty(true)
    setSaved(false)
    setMemoryConfigError("")
  }

  const syncFromSettings = () => {
    const settings = serverSettings()
    const toolOutput = objectValue(settings.tool_output)
    const context = objectValue(settings.context)
    const memory = objectValue(settings.memory)
    const memoryRuntime = objectValue(memory.runtime)
    const memoryTools = objectValue(memory.tools)

    setToolMaxChars(Math.max(1, Math.floor(numberValue(toolOutput.max_chars, 12000))))
    setToolMaxLines(Math.max(1, Math.floor(numberValue(toolOutput.max_lines, 120))))
    setToolStoreFull(boolValue(toolOutput.store_full_output, true))
    setToolStoreDir(stringValue(toolOutput.store_dir))
    setSnipKeepRecentTools(Math.max(0, Math.floor(numberValue(context.snip_keep_recent_tools, 2))))
    setSnipThresholdChars(Math.max(1, Math.floor(numberValue(context.snip_threshold_chars, 1500))))
    setSnipMinLines(Math.max(1, Math.floor(numberValue(context.snip_min_lines, 6))))
    setSummarizeKeepRecentTurns(Math.max(0, Math.floor(numberValue(context.summarize_keep_recent_turns, 5))))
    setTokenFudgeFactor(Math.max(0.1, numberValue(context.token_fudge_factor, 1.1)))
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
    setMemoryToolsRecall(boolValue(memoryTools.recall, false))
    setMemoryToolsRemember(boolValue(memoryTools.remember, false))
    setMemoryToolsForget(boolValue(memoryTools.forget, false))
    setMemoryToolsList(boolValue(memoryTools.list, false))
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
      providers = parseJsonObject(memoryProvidersJson(), "Provider 配置")
      sources = parseJsonObject(memorySourcesJson(), "Source 配置")
    } catch (error) {
      setMemoryConfigError(error instanceof Error ? error.message : String(error))
      return
    }
    saveSessionPolicySettings({
      settings: {
        tool_output: {
          max_chars: Math.max(1, Math.floor(toolMaxChars())),
          max_lines: Math.max(1, Math.floor(toolMaxLines())),
          store_full_output: toolStoreFull(),
          store_dir: toolStoreDir().trim() || null,
        },
        context: {
          snip_keep_recent_tools: Math.max(0, Math.floor(snipKeepRecentTools())),
          snip_threshold_chars: Math.max(1, Math.floor(snipThresholdChars())),
          snip_min_lines: Math.max(1, Math.floor(snipMinLines())),
          summarize_keep_recent_turns: Math.max(0, Math.floor(summarizeKeepRecentTurns())),
          token_fudge_factor: Math.max(0.1, tokenFudgeFactor()),
        },
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
            enabled: memoryToolsEnabled(),
            provider: memoryToolsProvider().trim(),
            allowed_agents: parseCsvList(memoryToolsAllowedAgents()),
            recall: memoryToolsRecall(),
            remember: memoryToolsRemember(),
            forget: memoryToolsForget(),
            list: memoryToolsList(),
          },
        },
      },
    })
    setDirty(false)
    setSaved(true)
  }

  return (
    <div class="settings-page settings-page--wide">
      <div class="settings-page-header">
        <div>
          <h2>{t("sessionPolicy.title")}</h2>
          <p class="setting-description">{t("sessionPolicy.desc")}</p>
        </div>
        <div class="settings-actions settings-actions--right">
          <RefreshButton class="btn-secondary" loading={pageRefreshing("sessionPolicy")} onClick={() => refreshPage("sessionPolicy")}>
            {t("common.refresh")}
          </RefreshButton>
          <button class="btn btn-primary" type="button" disabled={!dirty() || serverSettingsSaveBusy()} onClick={save}>
            <span class="codicon codicon-save" aria-hidden="true" />
            {t("common.save")}
          </button>
        </div>
      </div>

      <Show when={operations.error("sessionPolicySave") || operations.error("serverSettings")}>
        <div class="settings-error">{operations.error("sessionPolicySave") || operations.error("serverSettings")}</div>
      </Show>
      <Show when={memoryConfigError()}>
        <div class="settings-error">{memoryConfigError()}</div>
      </Show>
      <Show when={operations.state("sessionPolicySave").status === "success" && !dirty()}>
        <div class="settings-success">{t("sessionPolicy.saved")}</div>
      </Show>

      <section class="settings-section settings-section--plain">
        <div class="settings-section-heading">
          <span>工具输出</span>
          <StatusBadge tone={toolStoreFull() ? "success" : "muted"}>{toolStoreFull() ? "保存完整输出" : "只保留截断输出"}</StatusBadge>
        </div>
        <div class="settings-form-grid settings-form-grid--two">
          <label class="field-label"><span>最大字符数</span>
            <input type="number" min="1" value={toolMaxChars()} onInput={(event) => { setToolMaxChars(Number(event.currentTarget.value) || 1); markDirty() }} />
          </label>
          <label class="field-label"><span>最大行数</span>
            <input type="number" min="1" value={toolMaxLines()} onInput={(event) => { setToolMaxLines(Number(event.currentTarget.value) || 1); markDirty() }} />
          </label>
          <label class="field-label field-label--checkbox">
            <input type="checkbox" checked={toolStoreFull()} onChange={(event) => { setToolStoreFull(event.currentTarget.checked); markDirty() }} />
            <span>保存完整工具输出</span>
          </label>
          <label class="field-label"><span>完整输出目录</span>
            <input value={toolStoreDir()} placeholder="留空使用 .rcoder/tool-outputs" onInput={(event) => { setToolStoreDir(event.currentTarget.value); markDirty() }} />
          </label>
        </div>
      </section>

      <section class="settings-section settings-section--plain">
        <div class="settings-section-heading"><span>上下文压缩</span></div>
        <div class="settings-form-grid settings-form-grid--two">
          <label class="field-label"><span>保留最近工具轮数</span>
            <input type="number" min="0" value={snipKeepRecentTools()} onInput={(event) => { setSnipKeepRecentTools(Number(event.currentTarget.value) || 0); markDirty() }} />
          </label>
          <label class="field-label"><span>裁剪触发字符数</span>
            <input type="number" min="1" value={snipThresholdChars()} onInput={(event) => { setSnipThresholdChars(Number(event.currentTarget.value) || 1); markDirty() }} />
          </label>
          <label class="field-label"><span>裁剪最小行数</span>
            <input type="number" min="1" value={snipMinLines()} onInput={(event) => { setSnipMinLines(Number(event.currentTarget.value) || 1); markDirty() }} />
          </label>
          <label class="field-label"><span>摘要保留最近用户轮数</span>
            <input type="number" min="0" value={summarizeKeepRecentTurns()} onInput={(event) => { setSummarizeKeepRecentTurns(Number(event.currentTarget.value) || 0); markDirty() }} />
          </label>
          <label class="field-label"><span>Token 估算系数</span>
            <input type="number" min="0.1" step="0.1" value={tokenFudgeFactor()} onInput={(event) => { setTokenFudgeFactor(Number(event.currentTarget.value) || 1.1); markDirty() }} />
          </label>
        </div>
      </section>

      <section class="settings-section settings-section--plain">
        <div class="settings-section-heading">
          <span>记忆</span>
          <StatusBadge tone={memoryEnabled() ? "success" : "muted"}>{memoryEnabled() ? "Provider runtime" : "关闭"}</StatusBadge>
        </div>
        <div class="settings-form-grid settings-form-grid--two">
          <label class="field-label field-label--checkbox">
            <input type="checkbox" checked={memoryEnabled()} onChange={(event) => { setMemoryEnabled(event.currentTarget.checked); markDirty() }} />
            <span>启用记忆 runtime</span>
          </label>
          <label class="field-label field-label--checkbox">
            <input type="checkbox" checked={memoryInjectDefault()} onChange={(event) => { setMemoryInjectDefault(event.currentTarget.checked); markDirty() }} />
            <span>默认自动注入</span>
          </label>
          <label class="field-label field-label--checkbox">
            <input type="checkbox" checked={memoryCaptureDefault()} onChange={(event) => { setMemoryCaptureDefault(event.currentTarget.checked); markDirty() }} />
            <span>默认捕获会话/工具事件</span>
          </label>
          <label class="field-label field-label--checkbox">
            <input type="checkbox" checked={memoryTraceEnabled()} onChange={(event) => { setMemoryTraceEnabled(event.currentTarget.checked); markDirty() }} />
            <span>记录记忆诊断 trace</span>
          </label>
          <label class="field-label"><span>默认 Provider ID</span>
            <input value={memoryDefaultProvider()} placeholder="agentmemory" onInput={(event) => { setMemoryDefaultProvider(event.currentTarget.value); markDirty() }} />
          </label>
          <label class="field-label"><span>Fail mode</span>
            <select value={memoryFailMode()} onChange={(event) => { setMemoryFailMode(event.currentTarget.value); markDirty() }}>
              <option value="open">open</option>
              <option value="closed">closed</option>
            </select>
          </label>
          <label class="field-label"><span>默认 Agent ID</span>
            <input value={memoryAgentId()} onInput={(event) => { setMemoryAgentId(event.currentTarget.value); markDirty() }} />
          </label>
          <label class="field-label"><span>默认命名空间</span>
            <input value={memoryNamespace()} onInput={(event) => { setMemoryNamespace(event.currentTarget.value); markDirty() }} />
          </label>
          <label class="field-label"><span>Token 预算</span>
            <input type="number" min="1" value={memoryTokenBudget()} onInput={(event) => { setMemoryTokenBudget(Number(event.currentTarget.value) || 1); markDirty() }} />
          </label>
          <label class="field-label"><span>Trust policy</span>
            <input value={memoryTrustPolicy()} onInput={(event) => { setMemoryTrustPolicy(event.currentTarget.value); markDirty() }} />
          </label>
          <label class="field-label field-label--full"><span>Provider adapters JSON</span>
            <textarea rows={6} value={memoryProvidersJson()} placeholder={'{"agentmemory":{"adapter":"agentmemory_rest","base_url":"http://127.0.0.1:3111"}}'} onInput={(event) => { setMemoryProvidersJson(event.currentTarget.value); markDirty() }} />
          </label>
          <label class="field-label field-label--full"><span>Source connectors JSON</span>
            <textarea rows={4} value={memorySourcesJson()} placeholder={'{"github_project":{"adapter":"github","target_provider":"agentmemory"}}'} onInput={(event) => { setMemorySourcesJson(event.currentTarget.value); markDirty() }} />
          </label>
        </div>
      </section>

      <section class="settings-section settings-section--plain">
        <div class="settings-section-heading">
          <span>记忆工具面</span>
          <StatusBadge tone={memoryToolsEnabled() ? "success" : "muted"}>{memoryToolsEnabled() ? "显式暴露" : "默认关闭"}</StatusBadge>
        </div>
        <div class="settings-form-grid settings-form-grid--two">
          <label class="field-label field-label--checkbox">
            <input type="checkbox" checked={memoryToolsEnabled()} onChange={(event) => { setMemoryToolsEnabled(event.currentTarget.checked); markDirty() }} />
            <span>允许 Agent 可见记忆工具</span>
          </label>
          <label class="field-label"><span>工具 Provider ID</span>
            <input value={memoryToolsProvider()} placeholder="agentmemory" onInput={(event) => { setMemoryToolsProvider(event.currentTarget.value); markDirty() }} />
          </label>
          <label class="field-label"><span>允许 Agent</span>
            <input value={memoryToolsAllowedAgents()} placeholder="researcher, reviewer" onInput={(event) => { setMemoryToolsAllowedAgents(event.currentTarget.value); markDirty() }} />
          </label>
          <label class="field-label field-label--checkbox">
            <input type="checkbox" checked={memoryToolsRecall()} onChange={(event) => { setMemoryToolsRecall(event.currentTarget.checked); markDirty() }} />
            <span>recall</span>
          </label>
          <label class="field-label field-label--checkbox">
            <input type="checkbox" checked={memoryToolsRemember()} onChange={(event) => { setMemoryToolsRemember(event.currentTarget.checked); markDirty() }} />
            <span>remember</span>
          </label>
          <label class="field-label field-label--checkbox">
            <input type="checkbox" checked={memoryToolsForget()} onChange={(event) => { setMemoryToolsForget(event.currentTarget.checked); markDirty() }} />
            <span>forget</span>
          </label>
          <label class="field-label field-label--checkbox">
            <input type="checkbox" checked={memoryToolsList()} onChange={(event) => { setMemoryToolsList(event.currentTarget.checked); markDirty() }} />
            <span>list</span>
          </label>
        </div>
      </section>

    </div>
  )
}
