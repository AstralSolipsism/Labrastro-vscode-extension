import { Component, Show, createEffect, createMemo, createSignal, onMount } from "solid-js"
import { RefreshButton } from "../../components/common/RefreshButton"
import { StatusBadge } from "../components/StatusBadge"
import { settingsMessages } from "../settingsMessages"
import type { SettingsController } from "../useSettingsController"

interface TabProps { controller: SettingsController & Record<string, any> }

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {}
}

function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback
}

function numberValue(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback
}

function boolValue(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback
}

export const IntegrationsTab: Component<TabProps> = (props) => {
  const { vscode, server, refreshAdmin } = props.controller
  const [dirty, setDirty] = createSignal(false)
  const [saved, setSaved] = createSignal(false)

  const [enabled, setEnabled] = createSignal(false)
  const [appId, setAppId] = createSignal("")
  const [installationId, setInstallationId] = createSignal("")
  const [privateKeyPath, setPrivateKeyPath] = createSignal("")
  const [webhookSecret, setWebhookSecret] = createSignal("")
  const [webhookSecretHint, setWebhookSecretHint] = createSignal("")
  const [apiBaseUrl, setApiBaseUrl] = createSignal("https://api.github.com")
  const [webBaseUrl, setWebBaseUrl] = createSignal("https://github.com")
  const [reconcileIntervalSec, setReconcileIntervalSec] = createSignal(300)

  const serverSettings = createMemo(() => {
    const direct = objectValue(server.serverSettingsState()?.settings)
    if (Object.keys(direct).length > 0) return direct
    return objectValue(server.adminState().server_settings)
  })
  const githubSettings = createMemo(() => objectValue(serverSettings().github))
  const githubStatus = createMemo(() => objectValue(server.adminState().github))
  const githubApiStatus = createMemo(() => objectValue(githubStatus().api))

  const markDirty = () => {
    setDirty(true)
    setSaved(false)
  }

  createEffect(() => {
    if (dirty()) return
    const github = githubSettings()
    setEnabled(boolValue(github.enabled, false))
    setAppId(stringValue(github.app_id))
    setInstallationId(stringValue(github.installation_id))
    setPrivateKeyPath(stringValue(github.private_key_path))
    setWebhookSecret("")
    setWebhookSecretHint(stringValue(github.webhook_secret_hint))
    setApiBaseUrl(stringValue(github.api_base_url, "https://api.github.com"))
    setWebBaseUrl(stringValue(github.web_base_url, "https://github.com"))
    setReconcileIntervalSec(Math.max(1, Math.floor(numberValue(github.reconcile_interval_sec, 300))))
  })

  onMount(() => {
    settingsMessages.readServerSettings(vscode)
    refreshAdmin()
  })

  const save = () => {
    const github: Record<string, unknown> = {
      enabled: enabled(),
      app_id: appId().trim(),
      installation_id: installationId().trim(),
      private_key_path: privateKeyPath().trim(),
      api_base_url: apiBaseUrl().trim() || "https://api.github.com",
      web_base_url: webBaseUrl().trim() || "https://github.com",
      reconcile_interval_sec: Math.max(1, Math.floor(reconcileIntervalSec())),
    }
    if (webhookSecret().trim()) {
      github.webhook_secret = webhookSecret().trim()
    }
    settingsMessages.updateServerSettings(vscode, { settings: { github } })
    setWebhookSecret("")
    setDirty(false)
    setSaved(true)
  }

  return (
    <div class="settings-page settings-page--narrow">
      <div class="settings-page-header">
        <div>
          <h2>集成</h2>
          <p class="setting-description">配置可选的外部服务集成。</p>
        </div>
        <div class="settings-actions settings-actions--right">
          <RefreshButton class="btn-secondary" onClick={() => { settingsMessages.readServerSettings(vscode); refreshAdmin() }}>
            刷新
          </RefreshButton>
          <button class="btn btn-primary" type="button" disabled={!dirty()} onClick={save}>
            <span class="codicon codicon-save" aria-hidden="true" />
            保存
          </button>
        </div>
      </div>

      <Show when={server.serverSettingsError()}>
        <div class="settings-error">{server.serverSettingsError()}</div>
      </Show>
      <Show when={saved() && !dirty()}>
        <div class="settings-success">集成设置已保存并重载。</div>
      </Show>

      <section class="settings-section settings-section--flat">
        <div class="settings-section-heading">
          <span>
            <span class="codicon codicon-github" aria-hidden="true" />
            <span>GitHub App</span>
          </span>
          <div class="settings-badge-group">
            <StatusBadge tone={enabled() ? "success" : "muted"}>{enabled() ? "启用" : "关闭"}</StatusBadge>
            <StatusBadge tone={githubApiStatus().ok === true ? "success" : "muted"}>
              API {githubApiStatus().ok === true ? "正常" : "未连接"}
            </StatusBadge>
          </div>
        </div>

        <label class="field-label field-label--checkbox">
          <input type="checkbox" checked={enabled()} onChange={(event) => { setEnabled(event.currentTarget.checked); markDirty() }} />
          <span>启用 GitHub 集成</span>
        </label>

        <div class="settings-form-grid settings-form-grid--two">
          <label class="field-label"><span>App ID</span>
            <input value={appId()} onInput={(event) => { setAppId(event.currentTarget.value); markDirty() }} />
          </label>
          <label class="field-label"><span>Installation ID</span>
            <input value={installationId()} onInput={(event) => { setInstallationId(event.currentTarget.value); markDirty() }} />
          </label>
          <label class="field-label field-label--full"><span>Private Key Path</span>
            <input value={privateKeyPath()} placeholder="/path/to/github-app.pem" onInput={(event) => { setPrivateKeyPath(event.currentTarget.value); markDirty() }} />
          </label>
          <label class="field-label field-label--full"><span>Webhook Secret</span>
            <input value={webhookSecret()} placeholder={webhookSecretHint() || "留空表示不修改现有 secret"} onInput={(event) => { setWebhookSecret(event.currentTarget.value); markDirty() }} />
            <small class="field-help">只在输入新值时提交；读取时仅显示脱敏 hint。</small>
          </label>
          <label class="field-label"><span>API Base URL</span>
            <input value={apiBaseUrl()} onInput={(event) => { setApiBaseUrl(event.currentTarget.value); markDirty() }} />
          </label>
          <label class="field-label"><span>Web Base URL</span>
            <input value={webBaseUrl()} onInput={(event) => { setWebBaseUrl(event.currentTarget.value); markDirty() }} />
          </label>
          <label class="field-label"><span>Reconcile 周期秒</span>
            <input type="number" min="1" value={reconcileIntervalSec()} onInput={(event) => { setReconcileIntervalSec(Number(event.currentTarget.value) || 1); markDirty() }} />
          </label>
        </div>

        <details class="settings-details">
          <summary>
            <span class="codicon codicon-pulse" aria-hidden="true" />
            当前状态
          </summary>
          <pre class="settings-result">{JSON.stringify(githubStatus(), null, 2)}</pre>
        </details>
      </section>
    </div>
  )
}
