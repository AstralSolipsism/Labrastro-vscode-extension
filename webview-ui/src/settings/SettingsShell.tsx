import { Component, For, Match, Switch } from "solid-js"
import { t } from "../i18n"
import type { SettingsController } from "./useSettingsController"
import { ExecutorsTab } from "./tabs/ExecutorsTab"
import { AccountsTab } from "./tabs/AccountsTab"
import { ProvidersTab } from "./tabs/ProvidersTab"
import { ToolchainsTab } from "./tabs/ToolchainsTab"
import { ServerSettingsTab } from "./tabs/ServerSettingsTab"
import { AgentConfigTab } from "./tabs/AgentConfigTab"
import { AutoApprovalTab } from "./tabs/AutoApprovalTab"
import { OtherTab } from "./tabs/OtherTab"

interface SettingsShellProps {
  controller: SettingsController
}

export const SettingsShell: Component<SettingsShellProps> = (props) => {
  const controller = props.controller
  return (
    <div class="settings-view">
      <div class="settings-shell-header">
        <div>
          <h1>
            <span class="codicon codicon-settings-gear" aria-hidden="true" />
            {t("settings.title")}
          </h1>
        </div>
        <span class="settings-version">v{controller.server.extensionVersion() || "0.0.0"}</span>
      </div>

      <div class="settings-shell">
        <nav class="settings-tab-list" aria-label="Labrastro settings">
          <For each={controller.settingsTabDefs()}>
            {(tab) => (
              <button
                type="button"
                class={`settings-tab ${controller.activeTab() === tab.id ? "settings-tab--active" : ""}`}
                aria-current={controller.activeTab() === tab.id ? "page" : undefined}
                title={t(tab.labelKey)}
                onClick={() => controller.switchTab(tab.id)}
              >
                <span class={`codicon codicon-${tab.icon}`} aria-hidden="true" />
                <span class="settings-tab__label">{t(tab.labelKey)}</span>
              </button>
            )}
          </For>
        </nav>
        <main class="settings-tab-content">
          <Switch>
            <Match when={controller.activeTab() === "executors"}><ExecutorsTab controller={controller} /></Match>
            <Match when={controller.activeTab() === "accounts"}><AccountsTab controller={controller} /></Match>
            <Match when={controller.activeTab() === "providers"}><ProvidersTab controller={controller} /></Match>
            <Match when={controller.activeTab() === "toolchains"}><ToolchainsTab controller={controller} /></Match>
            <Match when={controller.activeTab() === "serverSettings"}><ServerSettingsTab controller={controller} /></Match>
            <Match when={controller.activeTab() === "agentConfig"}><AgentConfigTab controller={controller} /></Match>
            <Match when={controller.activeTab() === "autoApproval"}><AutoApprovalTab controller={controller} /></Match>
            <Match when={controller.activeTab() === "other"}><OtherTab controller={controller} /></Match>
          </Switch>
        </main>
      </div>
    </div>
  )
}
