import { Component, For, Show } from "solid-js"
import { t, locale, setLocale, LOCALES, type Locale } from "../../i18n"
import { RefreshButton } from "../../components/common/RefreshButton"
import type { SettingsController } from "../useSettingsController"

interface TabProps { controller: SettingsController & Record<string, any> }

export const OtherTab: Component<TabProps> = (props) => {
  const {
    refreshAdmin,
    vscode,
    server,
  } = props.controller

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
