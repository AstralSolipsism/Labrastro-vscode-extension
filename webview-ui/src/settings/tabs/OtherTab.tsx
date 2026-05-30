import { Component, Show, createEffect, createMemo, createSignal } from "solid-js"
import { t } from "../../i18n"
import { RefreshButton } from "../../components/common/RefreshButton"
import { StatusBadge } from "../components/StatusBadge"
import { SettingsActionRail, SettingsFlatSection, SettingsPage, SettingsPageHeader, SettingsSectionHeading } from "../components/SettingsLayout"
import type { SettingsController } from "../useSettingsController"

interface TabProps { controller: SettingsController & Record<string, any> }

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function stringValue(value: unknown, fallback = ""): string {
  if (value === undefined || value === null) return fallback
  return String(value)
}

function numberValue(value: unknown, fallback = 0): number {
  const num = Number(value)
  return Number.isFinite(num) ? num : fallback
}

export const OtherTab: Component<TabProps> = (props) => {
  const {
    operations,
    pageRefreshing,
    refreshPage,
    serverSettingsSaveBusy,
    server,
    modelCapabilitiesStatus,
    refreshModelCapabilities,
    saveCapabilitySyncSettings,
    formatTimestamp,
    adminUsable,
  } = props.controller
  const [capabilitySyncDirty, setCapabilitySyncDirty] = createSignal(false)
  const [capabilitySyncEnabled, setCapabilitySyncEnabled] = createSignal(true)
  const [capabilitySyncIntervalSec, setCapabilitySyncIntervalSec] = createSignal(86400)

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

  return (
    <SettingsPage narrow>
      <SettingsPageHeader>
        <div>
          <h2>{t("other.title")}</h2>
          <p class="setting-description">{t("other.desc")}</p>
        </div>
        <SettingsActionRail align="right">
          <RefreshButton
            class="btn-secondary"
            loading={pageRefreshing("other")}
            onClick={() => refreshPage("other")}
          >
            刷新
          </RefreshButton>
        </SettingsActionRail>
      </SettingsPageHeader>

      <SettingsFlatSection>
        <SettingsSectionHeading>
          <span>模型能力表维护</span>
          <StatusBadge>{String(numberValue(capabilityStatus().model_count, 0))} 个模型</StatusBadge>
        </SettingsSectionHeading>
        <div class="model-capability-sync">
          <div class="model-capability-sync__meta">
            <span>模型能力表</span>
            <small>最近同步 {formatTimestamp(capabilityUpdatedAt())}</small>
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
            <span>后台同步</span>
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
          <button class="btn btn-secondary" type="button" disabled={!capabilitySyncDirty() || serverSettingsSaveBusy()} onClick={saveCapabilitySync}>
            <span class="codicon codicon-save" aria-hidden="true" />
            保存同步设置
          </button>
          <RefreshButton
            class="btn-secondary"
            icon="sync"
            onClick={() => refreshModelCapabilities()}
            disabled={!adminUsable()}
            loading={operations.isBusy("modelCapabilities")}
          >
            手动同步能力表
          </RefreshButton>
        </div>
        <Show when={capabilityError()}>
          <p class="settings-empty-note settings-empty-note--error">{capabilityError()}</p>
        </Show>
      </SettingsFlatSection>
    </SettingsPage>
  )
}
