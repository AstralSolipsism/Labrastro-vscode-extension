import { Component, Show, createEffect, createMemo, createSignal, onMount } from "solid-js"
import { t } from "../../i18n"
import { RefreshButton } from "../../components/common/RefreshButton"
import { StatusBadge } from "../components/StatusBadge"
import { settingsMessages } from "../settingsMessages"
import type { SettingsController } from "../useSettingsController"

interface TabProps { controller: SettingsController & Record<string, any> }

function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback
}

function boolValue(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback
}

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
    vscode,
  } = props.controller

  const [infraDirty, setInfraDirty] = createSignal(false)
  const [infraSaved, setInfraSaved] = createSignal(false)
  const [sandboxType, setSandboxType] = createSignal("none")
  const [sandboxHostBaseUrl, setSandboxHostBaseUrl] = createSignal("")
  const [sandboxWorkerImage, setSandboxWorkerImage] = createSignal("labrastro-host:test")
  const [sandboxWorkspaceVolumeRoot, setSandboxWorkspaceVolumeRoot] = createSignal("ezcode-workspaces")
  const [sandboxNetwork, setSandboxNetwork] = createSignal("")
  const [sandboxCpuLimit, setSandboxCpuLimit] = createSignal("")
  const [sandboxMemoryLimit, setSandboxMemoryLimit] = createSignal("")
  const [sandboxIdleTtlSeconds, setSandboxIdleTtlSeconds] = createSignal(3600)
  const [persistenceRuntimeEnabled, setPersistenceRuntimeEnabled] = createSignal(true)
  const [persistenceSessionsEnabled, setPersistenceSessionsEnabled] = createSignal(true)
  const [persistenceRetentionDays, setPersistenceRetentionDays] = createSignal(0)
  const [persistenceSnapshotVersions, setPersistenceSnapshotVersions] = createSignal(20)
  const [persistenceCompressThreshold, setPersistenceCompressThreshold] = createSignal(262144)
  const [persistenceMaintenanceInterval, setPersistenceMaintenanceInterval] = createSignal(3600)

  const serverSettings = createMemo(() => {
    const direct = objectValue(server.serverSettingsState()?.settings)
    if (Object.keys(direct).length > 0) return direct
    return objectValue(server.adminState().server_settings)
  })
  const sandboxSettings = createMemo(() => objectValue(serverSettings().sandbox_provider))
  const persistenceSettings = createMemo(() => objectValue(serverSettings().persistence))

  const markInfraDirty = () => {
    setInfraDirty(true)
    setInfraSaved(false)
  }

  createEffect(() => {
    if (infraDirty()) return
    const sandbox = sandboxSettings()
    const persistence = persistenceSettings()
    setSandboxType(stringValue(sandbox.type, "none"))
    setSandboxHostBaseUrl(stringValue(sandbox.host_base_url))
    setSandboxWorkerImage(stringValue(sandbox.worker_image, "labrastro-host:test"))
    setSandboxWorkspaceVolumeRoot(stringValue(sandbox.workspace_volume_root, "ezcode-workspaces"))
    setSandboxNetwork(stringValue(sandbox.network))
    setSandboxCpuLimit(stringValue(sandbox.cpu_limit))
    setSandboxMemoryLimit(stringValue(sandbox.memory_limit))
    setSandboxIdleTtlSeconds(Math.max(1, Math.floor(numberValue(sandbox.idle_ttl_seconds, 3600))))
    setPersistenceRuntimeEnabled(boolValue(persistence.runtime_enabled, true))
    setPersistenceSessionsEnabled(boolValue(persistence.sessions_enabled, true))
    setPersistenceRetentionDays(Math.max(0, Math.floor(numberValue(persistence.retention_days, 0))))
    setPersistenceSnapshotVersions(Math.max(1, Math.floor(numberValue(persistence.snapshot_max_versions_per_session, 20))))
    setPersistenceCompressThreshold(Math.max(1, Math.floor(numberValue(persistence.snapshot_compress_threshold_bytes, 262144))))
    setPersistenceMaintenanceInterval(Math.max(1, Math.floor(numberValue(persistence.maintenance_interval_sec, 3600))))
  })

  onMount(() => settingsMessages.readServerSettings(vscode))

  const saveInfrastructureSettings = () => {
    settingsMessages.updateServerSettings(vscode, {
      settings: {
        sandbox_provider: {
          type: sandboxType(),
          host_base_url: sandboxHostBaseUrl().trim(),
          worker_image: sandboxWorkerImage().trim() || "labrastro-host:test",
          workspace_volume_root: sandboxWorkspaceVolumeRoot().trim() || "ezcode-workspaces",
          network: sandboxNetwork().trim(),
          cpu_limit: sandboxCpuLimit().trim(),
          memory_limit: sandboxMemoryLimit().trim(),
          idle_ttl_seconds: Math.max(1, Math.floor(sandboxIdleTtlSeconds())),
        },
        persistence: {
          runtime_enabled: persistenceRuntimeEnabled(),
          sessions_enabled: persistenceSessionsEnabled(),
          retention_days: Math.max(0, Math.floor(persistenceRetentionDays())),
          snapshot_max_versions_per_session: Math.max(1, Math.floor(persistenceSnapshotVersions())),
          snapshot_compress_threshold_bytes: Math.max(1, Math.floor(persistenceCompressThreshold())),
          maintenance_interval_sec: Math.max(1, Math.floor(persistenceMaintenanceInterval())),
        },
      },
    })
    setInfraDirty(false)
    setInfraSaved(true)
  }

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
        <Show when={infraSaved() && !infraDirty()}>
          <div class="settings-success">服务端运行环境设置已保存并重载。</div>
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

        <section class="settings-section settings-section--flat">
          <div class="settings-section-heading">
            <span>Sandbox 执行环境</span>
            <StatusBadge tone={sandboxType() === "none" ? "muted" : "success"}>{sandboxType()}</StatusBadge>
          </div>
          <div class="settings-form-grid settings-form-grid--two">
            <label class="field-label"><span>类型</span>
              <select value={sandboxType()} onChange={(event) => { setSandboxType(event.currentTarget.value); markInfraDirty() }}>
                <option value="none">none</option>
                <option value="docker">docker</option>
                <option value="external">external</option>
                <option value="k8s">k8s</option>
              </select>
            </label>
            <label class="field-label"><span>Host Base URL</span>
              <input value={sandboxHostBaseUrl()} onInput={(event) => { setSandboxHostBaseUrl(event.currentTarget.value); markInfraDirty() }} />
            </label>
            <label class="field-label"><span>Worker Image</span>
              <input value={sandboxWorkerImage()} onInput={(event) => { setSandboxWorkerImage(event.currentTarget.value); markInfraDirty() }} />
            </label>
            <label class="field-label"><span>Workspace Volume Root</span>
              <input value={sandboxWorkspaceVolumeRoot()} onInput={(event) => { setSandboxWorkspaceVolumeRoot(event.currentTarget.value); markInfraDirty() }} />
            </label>
            <label class="field-label"><span>Network</span>
              <input value={sandboxNetwork()} placeholder="留空使用默认网络" onInput={(event) => { setSandboxNetwork(event.currentTarget.value); markInfraDirty() }} />
            </label>
            <label class="field-label"><span>Idle TTL 秒</span>
              <input type="number" min="1" value={sandboxIdleTtlSeconds()} onInput={(event) => { setSandboxIdleTtlSeconds(Number(event.currentTarget.value) || 1); markInfraDirty() }} />
            </label>
            <label class="field-label"><span>CPU Limit</span>
              <input value={sandboxCpuLimit()} placeholder="例如 2" onInput={(event) => { setSandboxCpuLimit(event.currentTarget.value); markInfraDirty() }} />
            </label>
            <label class="field-label"><span>Memory Limit</span>
              <input value={sandboxMemoryLimit()} placeholder="例如 4g" onInput={(event) => { setSandboxMemoryLimit(event.currentTarget.value); markInfraDirty() }} />
            </label>
          </div>
        </section>

        <section class="settings-section settings-section--flat">
          <div class="settings-section-heading">
            <span>持久化策略</span>
            <StatusBadge tone="muted">{stringValue(persistenceSettings().backend, "auto")}</StatusBadge>
          </div>
          <div class="toolchain-detail-grid">
            <div class="toolchain-detail-block">
              <span>Backend</span>
              <strong>{stringValue(persistenceSettings().backend, "auto")}</strong>
            </div>
            <div class="toolchain-detail-block">
              <span>Database URL</span>
              <strong>{stringValue(persistenceSettings().database_url) ? "已配置" : "未配置"}</strong>
            </div>
            <div class="toolchain-detail-block">
              <span>Auto Migrate</span>
              <strong>{boolValue(persistenceSettings().auto_migrate, true) ? "true" : "false"}</strong>
            </div>
          </div>
          <div class="settings-form-grid settings-form-grid--two">
            <label class="field-label field-label--checkbox">
              <input type="checkbox" checked={persistenceRuntimeEnabled()} onChange={(event) => { setPersistenceRuntimeEnabled(event.currentTarget.checked); markInfraDirty() }} />
              <span>保存运行态</span>
            </label>
            <label class="field-label field-label--checkbox">
              <input type="checkbox" checked={persistenceSessionsEnabled()} onChange={(event) => { setPersistenceSessionsEnabled(event.currentTarget.checked); markInfraDirty() }} />
              <span>保存会话</span>
            </label>
            <label class="field-label"><span>保留天数</span>
              <input type="number" min="0" value={persistenceRetentionDays()} onInput={(event) => { setPersistenceRetentionDays(Number(event.currentTarget.value) || 0); markInfraDirty() }} />
            </label>
            <label class="field-label"><span>每会话快照版本数</span>
              <input type="number" min="1" value={persistenceSnapshotVersions()} onInput={(event) => { setPersistenceSnapshotVersions(Number(event.currentTarget.value) || 1); markInfraDirty() }} />
            </label>
            <label class="field-label"><span>快照压缩阈值 bytes</span>
              <input type="number" min="1" value={persistenceCompressThreshold()} onInput={(event) => { setPersistenceCompressThreshold(Number(event.currentTarget.value) || 1); markInfraDirty() }} />
            </label>
            <label class="field-label"><span>维护周期秒</span>
              <input type="number" min="1" value={persistenceMaintenanceInterval()} onInput={(event) => { setPersistenceMaintenanceInterval(Number(event.currentTarget.value) || 1); markInfraDirty() }} />
            </label>
          </div>
          <div class="settings-actions settings-actions--right">
            <button class="btn btn-primary" type="button" disabled={!infraDirty()} onClick={saveInfrastructureSettings}>
              <span class="codicon codicon-save" aria-hidden="true" />
              保存运行环境
            </button>
          </div>
        </section>
      </div>
    )
}
