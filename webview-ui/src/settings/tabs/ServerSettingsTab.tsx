import { Component, Show } from "solid-js"
import { t } from "../../i18n"
import { RefreshButton } from "../../components/common/RefreshButton"
import { StatusBadge } from "../components/StatusBadge"
import type { SettingsController } from "../useSettingsController"

interface TabProps { controller: SettingsController & Record<string, any> }

export const ServerSettingsTab: Component<TabProps> = (props) => {
  const {
    agentRunsState,
    refreshServerSettings,
    saveServerSettings,
    serverSettingsDirty,
    server,
    objectValue,
    serverMaxRunningAgents,
    setServerMaxRunningAgents,
    setServerSettingsDirty,
    serverMaxShellsPerAgent,
    setServerMaxShellsPerAgent,
    numberValue,
  } = props.controller

  const runtime = agentRunsState()
  return (

      <div class="settings-page">
        <div class="settings-page-header">
          <div>
            <h2>{t("serverSettings.title")}</h2>
          </div>
          <div class="settings-actions settings-actions--right">
            <RefreshButton class="btn-secondary" onClick={refreshServerSettings}>
              刷新
            </RefreshButton>
            <button class="btn btn-primary" onClick={saveServerSettings} disabled={!serverSettingsDirty()}>
              <span class="codicon codicon-save" aria-hidden="true" />
              保存
            </button>
          </div>
        </div>

        <Show when={server.serverSettingsError()}>
          <div class="settings-error">{server.serverSettingsError()}</div>
        </Show>
        <Show when={server.actionResult()?.ok === true && Object.keys(objectValue(server.actionResult()?.settings)).length > 0 && !serverSettingsDirty()}>
          <div class="settings-success">服务端设置已保存并重载。</div>
        </Show>

        <section class="settings-section settings-section--flat">
          <div class="settings-section-heading">
            <span>Agent 运行限制</span>
            <StatusBadge tone="muted">全局</StatusBadge>
          </div>
          <div class="settings-form-grid settings-form-grid--two">
            <label class="field-label">
              <span>同时允许运行的 Agent 数</span>
              <input
                type="number"
                min="1"
                step="1"
                value={serverMaxRunningAgents()}
                onInput={(event) => {
                  setServerMaxRunningAgents(Math.max(1, Math.floor(Number(event.currentTarget.value) || 1)))
                  setServerSettingsDirty(true)
                }}
              />
            </label>
            <label class="field-label">
              <span>每个 Agent 同时允许的 shell 执行数</span>
              <input
                type="number"
                min="1"
                step="1"
                value={serverMaxShellsPerAgent()}
                onInput={(event) => {
                  setServerMaxShellsPerAgent(Math.max(1, Math.floor(Number(event.currentTarget.value) || 1)))
                  setServerSettingsDirty(true)
                }}
              />
            </label>
          </div>
        </section>

        <section class="settings-section settings-section--flat">
          <div class="settings-section-heading">
            <span>当前运行态</span>
            <StatusBadge tone={numberValue(runtime.queued_agents, 0) > 0 ? "warning" : "success"}>
              {numberValue(runtime.running_agents, 0)} / {numberValue(runtime.max_running_agents, serverMaxRunningAgents())}
            </StatusBadge>
          </div>
          <div class="toolchain-detail-grid">
            <div class="toolchain-detail-block">
              <span>{t("serverSettings.runningAgents")}</span>
              <strong>{String(numberValue(runtime.running_agents, 0))}</strong>
            </div>
            <div class="toolchain-detail-block">
              <span>排队 Agent</span>
              <strong>{String(numberValue(runtime.queued_agents, 0))}</strong>
            </div>
            <div class="toolchain-detail-block">
              <span>shell 使用</span>
              <strong>{String(Object.keys(objectValue(runtime.shell_usage)).length)}</strong>
            </div>
            <div class="toolchain-detail-block">
              <span>shell 排队</span>
              <strong>{String(Object.values(objectValue(runtime.queued_shells)).reduce<number>((sum, item) => sum + numberValue(item, 0), 0))}</strong>
            </div>
          </div>
        </section>
      </div>
    )
}
