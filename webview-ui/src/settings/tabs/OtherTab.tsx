import { Component, For, Show, createMemo, onMount } from "solid-js"
import { t, locale, setLocale, LOCALES, type Locale } from "../../i18n"
import { RefreshButton } from "../../components/common/RefreshButton"
import type { SettingsController } from "../useSettingsController"
import { settingsMessages } from "../settingsMessages"

interface TabProps { controller: SettingsController & Record<string, any> }

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {}
}

function arrayOfRecords(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
    : []
}

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : ""
}

export const OtherTab: Component<TabProps> = (props) => {
  const {
    refreshAdmin,
    vscode,
    server,
  } = props.controller
  const serverSettings = createMemo(() => {
    const direct = objectValue(server.serverSettingsState()?.settings)
    if (Object.keys(direct).length > 0) return direct
    return objectValue(server.adminState().server_settings)
  })
  const diagnosticsSettings = createMemo(() =>
    objectValue(objectValue(serverSettings().diagnostics).tool_argument_validation)
  )
  const toolArgumentTelemetryEnabled = createMemo(() =>
    diagnosticsSettings().enabled !== false
  )
  const toolArgumentStats = createMemo(() =>
    objectValue(objectValue(server.diagnosticsState()).tool_argument_validation)
  )
  const totals = createMemo(() => objectValue(toolArgumentStats().totals))
  const modelRows = createMemo(() => arrayOfRecords(toolArgumentStats().by_model).slice(0, 8))
  const issueRows = createMemo(() => arrayOfRecords(toolArgumentStats().issues).slice(0, 8))
  const repairRows = createMemo(() => arrayOfRecords(toolArgumentStats().repairs).slice(0, 8))
  const reasoningDefaultOpen = createMemo(() => server.reasoningDisplayState().defaultOpen === true)

  const refreshDiagnostics = () => settingsMessages.readToolArgumentDiagnosticsStats(vscode)
  const updateReasoningDefaultOpen = (defaultOpen: boolean) => {
    settingsMessages.saveReasoningDisplay(vscode, defaultOpen)
  }
  const updateToolArgumentTelemetry = (enabled: boolean) => {
    settingsMessages.updateServerSettings(vscode, {
      settings: {
        diagnostics: {
          tool_argument_validation: {
            enabled,
            record_clean: false,
          },
        },
      },
    })
  }

  onMount(() => {
    settingsMessages.readServerSettings(vscode)
    settingsMessages.getReasoningDisplay(vscode)
  })

  return (
    <div class="settings-page settings-page--narrow">
      <div class="settings-page-header">
        <div>
          <h2>{t("other.title")}</h2>
        </div>
        <RefreshButton class="btn-secondary" onClick={refreshAdmin}>
          刷新
        </RefreshButton>
      </div>

      <section class="settings-section settings-section--flat language-section">
        <div class="settings-section-heading">
          <span class="codicon codicon-globe" aria-hidden="true" />
          <span>{t("other.language")}</span>
        </div>
        <div class="language-picker">
          <For each={LOCALES as unknown as { id: string; label: string; nativeLabel: string }[]}>
            {(loc) => (
              <button
                type="button"
                class={`language-option ${locale() === loc.id ? "language-option--active" : ""}`}
                onClick={() => setLocale(loc.id as Locale, vscode.postMessage)}
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

      <section class="settings-section settings-section--flat reasoning-display-section">
        <div class="settings-section-heading">
          <span class="codicon codicon-comment-discussion" aria-hidden="true" />
          <span>{t("other.reasoning.title")}</span>
        </div>
        <label class="field-label field-label--checkbox">
          <input
            type="checkbox"
            checked={reasoningDefaultOpen()}
            onChange={(event) => updateReasoningDefaultOpen(event.currentTarget.checked)}
          />
          <span>{t("other.reasoning.defaultOpen")}</span>
        </label>
        <p class="settings-empty-note">{t("other.reasoning.desc")}</p>
      </section>

      <section class="settings-section settings-section--flat diagnostics-section">
        <div class="settings-section-heading">
          <span>
            <span class="codicon codicon-pulse" aria-hidden="true" />
            <span>{t("other.toolArgs.title")}</span>
          </span>
          <span class="settings-badge">{t("other.toolArgs.serverSide")}</span>
        </div>
        <label class="field-label field-label--checkbox">
          <input
            type="checkbox"
            checked={toolArgumentTelemetryEnabled()}
            onChange={(event) => updateToolArgumentTelemetry(event.currentTarget.checked)}
          />
          <span>{t("other.toolArgs.enabled")}</span>
        </label>
        <p class="settings-empty-note">{t("other.toolArgs.desc")}</p>
        <details
          class="settings-details diagnostics-stats-card"
          onToggle={(event) => {
            if (event.currentTarget.open) refreshDiagnostics()
          }}
        >
          <summary>
            <span class="codicon codicon-graph" aria-hidden="true" />
            {t("other.toolArgs.stats")}
          </summary>
          <div class="settings-actions settings-actions--right">
            <RefreshButton class="btn-secondary" onClick={refreshDiagnostics}>
              {t("other.toolArgs.refreshStats")}
            </RefreshButton>
          </div>
          <Show when={server.diagnosticsError()}>
            <div class="settings-error">{server.diagnosticsError()}</div>
          </Show>
          <div class="diagnostics-stat-grid">
            <div class="diagnostics-stat">
              <span>{t("other.toolArgs.totalEvents")}</span>
              <strong>{numberValue(totals().events)}</strong>
            </div>
            <div class="diagnostics-stat">
              <span>{t("other.toolArgs.invalidEvents")}</span>
              <strong>{numberValue(totals().invalid)}</strong>
            </div>
            <div class="diagnostics-stat">
              <span>{t("other.toolArgs.repairedEvents")}</span>
              <strong>{numberValue(totals().repaired)}</strong>
            </div>
          </div>
          <Show when={modelRows().length} fallback={<p class="settings-empty-note">{t("other.toolArgs.empty")}</p>}>
            <div class="diagnostics-table">
              <div class="diagnostics-table__title">{t("other.toolArgs.byModel")}</div>
              <For each={modelRows()}>
                {(row) => (
                  <div class="diagnostics-table__row">
                    <span>{stringValue(row.name)}</span>
                    <span>{numberValue(row.events)} / {numberValue(row.invalid)} / {numberValue(row.repaired)}</span>
                  </div>
                )}
              </For>
            </div>
          </Show>
          <Show when={issueRows().length}>
            <div class="diagnostics-table">
              <div class="diagnostics-table__title">{t("other.toolArgs.topIssues")}</div>
              <For each={issueRows()}>
                {(row) => (
                  <div class="diagnostics-table__row diagnostics-table__row--stacked">
                    <span>{stringValue(row.model)} · {stringValue(row.tool)} · {stringValue(row.code)}</span>
                    <small>{stringValue(row.path)} · {stringValue(row.expected)} → {stringValue(row.actual)} · {numberValue(row.count)}</small>
                  </div>
                )}
              </For>
            </div>
          </Show>
          <Show when={repairRows().length}>
            <div class="diagnostics-table">
              <div class="diagnostics-table__title">{t("other.toolArgs.repairs")}</div>
              <For each={repairRows()}>
                {(row) => (
                  <div class="diagnostics-table__row">
                    <span>{stringValue(row.model)} · {stringValue(row.tool)} · {stringValue(row.action)}</span>
                    <span>{numberValue(row.count)}</span>
                  </div>
                )}
              </For>
            </div>
          </Show>
          <details class="settings-details settings-details--embedded">
            <summary>
              <span class="codicon codicon-json" aria-hidden="true" />
              {t("other.toolArgs.raw")}
            </summary>
            <pre class="settings-result">{JSON.stringify(toolArgumentStats(), null, 2)}</pre>
          </details>
        </details>
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
}
