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

  const [memoryEnabled, setMemoryEnabled] = createSignal(true)
  const [memoryCaptureEnabled, setMemoryCaptureEnabled] = createSignal(true)
  const [memoryBackend, setMemoryBackend] = createSignal("sqlite")
  const [memoryStorePath, setMemoryStorePath] = createSignal(".rcoder/memory.sqlite3")
  const [memoryAgentId, setMemoryAgentId] = createSignal("core")
  const [memoryNamespace, setMemoryNamespace] = createSignal("")
  const [memoryTokenBudget, setMemoryTokenBudget] = createSignal(800)

  const serverSettings = createMemo(() => {
    const direct = objectValue(server.serverSettingsState()?.settings)
    if (Object.keys(direct).length > 0) return direct
    return objectValue(server.adminState().server_settings)
  })

  const markDirty = () => {
    setDirty(true)
    setSaved(false)
  }

  const syncFromSettings = () => {
    const settings = serverSettings()
    const toolOutput = objectValue(settings.tool_output)
    const context = objectValue(settings.context)
    const memory = objectValue(settings.memory)

    setToolMaxChars(Math.max(1, Math.floor(numberValue(toolOutput.max_chars, 12000))))
    setToolMaxLines(Math.max(1, Math.floor(numberValue(toolOutput.max_lines, 120))))
    setToolStoreFull(boolValue(toolOutput.store_full_output, true))
    setToolStoreDir(stringValue(toolOutput.store_dir))
    setSnipKeepRecentTools(Math.max(0, Math.floor(numberValue(context.snip_keep_recent_tools, 2))))
    setSnipThresholdChars(Math.max(1, Math.floor(numberValue(context.snip_threshold_chars, 1500))))
    setSnipMinLines(Math.max(1, Math.floor(numberValue(context.snip_min_lines, 6))))
    setSummarizeKeepRecentTurns(Math.max(0, Math.floor(numberValue(context.summarize_keep_recent_turns, 5))))
    setTokenFudgeFactor(Math.max(0.1, numberValue(context.token_fudge_factor, 1.1)))
    setMemoryEnabled(boolValue(memory.enabled, true))
    setMemoryCaptureEnabled(boolValue(memory.capture_enabled, true))
    setMemoryBackend(stringValue(memory.backend, "sqlite"))
    setMemoryStorePath(stringValue(memory.store_path, ".rcoder/memory.sqlite3"))
    setMemoryAgentId(stringValue(memory.default_agent_id, "core"))
    setMemoryNamespace(stringValue(memory.default_namespace))
    setMemoryTokenBudget(Math.max(1, Math.floor(numberValue(memory.token_budget, 800))))
  }

  createEffect(() => {
    if (dirty()) return
    syncFromSettings()
  })

  const save = () => {
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
          capture_enabled: memoryCaptureEnabled(),
          backend: memoryBackend(),
          store_path: memoryStorePath().trim() || ".rcoder/memory.sqlite3",
          default_agent_id: memoryAgentId().trim() || "core",
          default_namespace: memoryNamespace().trim(),
          token_budget: Math.max(1, Math.floor(memoryTokenBudget())),
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
          <StatusBadge tone={memoryEnabled() ? "success" : "muted"}>{memoryEnabled() ? "启用" : "关闭"}</StatusBadge>
        </div>
        <div class="settings-form-grid settings-form-grid--two">
          <label class="field-label field-label--checkbox">
            <input type="checkbox" checked={memoryEnabled()} onChange={(event) => { setMemoryEnabled(event.currentTarget.checked); markDirty() }} />
            <span>启用记忆注入</span>
          </label>
          <label class="field-label field-label--checkbox">
            <input type="checkbox" checked={memoryCaptureEnabled()} onChange={(event) => { setMemoryCaptureEnabled(event.currentTarget.checked); markDirty() }} />
            <span>捕获会话/工具记录</span>
          </label>
          <label class="field-label"><span>后端</span>
            <select value={memoryBackend()} onChange={(event) => { setMemoryBackend(event.currentTarget.value); markDirty() }}>
              <option value="sqlite">sqlite</option>
              <option value="postgres">postgres</option>
              <option value="memory">memory</option>
            </select>
          </label>
          <label class="field-label"><span>存储路径</span>
            <input value={memoryStorePath()} onInput={(event) => { setMemoryStorePath(event.currentTarget.value); markDirty() }} />
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
        </div>
      </section>

    </div>
  )
}
