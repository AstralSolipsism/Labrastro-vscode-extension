import { Component, For, Show } from "solid-js"
import { t } from "../../i18n"
import { DialogSurface } from "../../components/common/interaction"
import { StatusBadge } from "../components/StatusBadge"
import type { SettingsController } from "../useSettingsController"

interface TabProps { controller: SettingsController & Record<string, any> }

export const ExecutorsTab: Component<TabProps> = (props) => {
  const {
    refreshLoading,
    refreshAdmin,
    executorLocation,
    executorEngineOption,
    connectionStatus,
    openExecutorPicker,
    executorPickerOpen,
    closeExecutorPicker,
    pickerLocation,
    setPickerLocation,
    pickerEngine,
    setPickerEngine,
    confirmExecutorPicker,
    executorEngine,
    hostUrlConfigured,
    hostUrlSource,
    connectionMessage,
    connectionSecurityWarnings,
    connectionSaveMessage,
    hostUrlError,
    hostUrlDraftDiffers,
    isDefaultLocalHost,
    currentHostUrl,
    hostUrl,
    setHostUrl,
    setHostUrlDirty,
    setPendingHostSave,
    setHostUrlError,
    setHostUrlSyncLock,
    connectionSaveResultKey,
    server,
    setDismissedConnectionSaveResultKey,
    loginUsername,
    setLoginUsername,
    loginPassword,
    setLoginPassword,
    saveLoading,
    saveSuccess,
    saveConnection,
    logoutConnection,
    EXECUTOR_ENGINES,
    executorLocationLabel,
    stringValue,
  } = props.controller

  return (
    <div class="settings-page settings-page--narrow">
      <div class="settings-page-header">
        <div>
          <h2>{t("executor.title")}</h2>
          <p>{t("executor.description")}</p>
        </div>
        <button
          class={`btn btn-secondary ${refreshLoading() ? "btn--loading" : ""}`}
          onClick={refreshAdmin}
          disabled={refreshLoading()}
        >
          <span class={`codicon codicon-${refreshLoading() ? "loading" : "refresh"}`} aria-hidden="true" />
          {refreshLoading() ? "刷新中…" : "刷新状态"}
        </button>
      </div>

      {/* ── ① 状态总览 ── */}
      <section class="executor-status-bar">
        <div class="executor-status-card">
          <div class="executor-status-card__icon">
            <span class={`codicon codicon-${executorLocation() === "local" ? "device-desktop" : "cloud"}`} aria-hidden="true" />
          </div>
          <div class="executor-status-card__body">
            <small>{t("executor.location.label")}</small>
            <strong>{executorLocationLabel(executorLocation())}</strong>
          </div>
        </div>
        <div class="executor-status-card">
          <div class="executor-status-card__icon">
            <span class={`codicon codicon-${executorEngineOption().icon}`} aria-hidden="true" />
          </div>
          <div class="executor-status-card__body">
            <small>{t("executor.engine.label")}</small>
            <strong>{executorEngineOption().label}</strong>
          </div>
        </div>
        <div class="executor-status-card">
          <div class="executor-status-card__icon">
            <span
              class={`codicon codicon-${connectionStatus() === "ready" ? "pass-filled" : connectionStatus() === "error" ? "error" : "circle-large-outline"}`}
              aria-hidden="true"
              style={connectionStatus() === "ready" ? "color:var(--ez-success)" : connectionStatus() === "error" ? "color:var(--ez-error)" : "color:var(--ez-muted)"}
            />
          </div>
          <div class="executor-status-card__body">
            <small>{t("executor.status.connectionStatus")}</small>
            <strong>{connectionStatus() === "ready" ? t("executor.status.connected") : connectionStatus() === "error" ? t("executor.status.unavailable") : t("executor.status.disconnected")}</strong>
          </div>
        </div>
      </section>

      <div class="settings-actions" style="margin:12px 0">
        <button class="btn btn-primary" onClick={openExecutorPicker}>
          <span class="codicon codicon-settings-gear" aria-hidden="true" />
          切换主执行器
        </button>
        <button
          class={`btn btn-secondary ${refreshLoading() ? "btn--loading" : ""}`}
          onClick={refreshAdmin}
          disabled={refreshLoading()}
        >
          <span class={`codicon codicon-${refreshLoading() ? "loading" : "refresh"}`} aria-hidden="true" />
          {refreshLoading() ? "刷新中…" : "刷新"}
        </button>
      </div>

      {/* ── ② 弹出式两步选择卡片 ── */}
      <Show when={executorPickerOpen()}>
        <DialogSurface
          ariaLabel="选择主执行器"
          backdropClass="settings-overlay settings-overlay--center"
          surfaceClass="executor-picker-modal"
          onClose={closeExecutorPicker}
          initialFocusSelector=".executor-picker-modal button"
        >
            <div class="settings-modal__header">
              <div>
                <h3>{t("executor.picker.title")}</h3>
                <p>{t("executor.picker.subtitle")}</p>
              </div>
              <button class="ez-icon-button" type="button" title="关闭" onClick={closeExecutorPicker}>
                <span class="codicon codicon-close" aria-hidden="true" />
              </button>
            </div>

            {/* 第 1 步：位置 */}
            <div class="executor-picker-step">
              <div class="executor-picker-step__title">
                <StatusBadge>1</StatusBadge>
                <span>{t("executor.location.label")}</span>
              </div>
              <div class="executor-location-grid">
                <button
                  type="button"
                  class={`executor-location-card ${pickerLocation() === "local" ? "executor-location-card--active" : ""}`}
                  onClick={() => setPickerLocation("local")}
                >
                  <span class="codicon codicon-device-desktop" aria-hidden="true" />
                  <div>
                    <strong>本地</strong>
                    <small>在本机运行执行器</small>
                  </div>
                </button>
                <button
                  type="button"
                  class={`executor-location-card ${pickerLocation() === "remote" ? "executor-location-card--active" : ""}`}
                  onClick={() => setPickerLocation("remote")}
                >
                  <span class="codicon codicon-cloud" aria-hidden="true" />
                  <div>
                    <strong>远端</strong>
                    <small>连接远程服务</small>
                  </div>
                </button>
              </div>
            </div>

            {/* 第 2 步：引擎 */}
            <div class="executor-picker-step">
              <div class="executor-picker-step__title">
                <StatusBadge>2</StatusBadge>
                <span>{t("executor.engine.label")}</span>
              </div>
              <div class="executor-engine-grid">
                <For each={EXECUTOR_ENGINES}>
                  {(engine) => (
                    <button
                      type="button"
                      class={[
                        "executor-engine-card",
                        pickerEngine() === engine.id ? "executor-engine-card--active" : "",
                        !engine.ready ? "executor-engine-card--disabled" : "",
                      ].filter(Boolean).join(" ")}
                      disabled={!engine.ready}
                      onClick={() => { if (engine.ready) setPickerEngine(engine.id) }}
                    >
                      <span class={`codicon codicon-${engine.icon}`} aria-hidden="true" />
                      <div>
                        <strong>{engine.label}</strong>
                        <small>{engine.description}</small>
                      </div>
                      <Show when={!engine.ready}>
                        <span class="executor-engine-card__badge">{t("executor.comingSoon")}</span>
                      </Show>
                    </button>
                  )}
                </For>
              </div>
            </div>

            <div class="settings-actions settings-actions--right">
              <button class="btn btn-secondary" type="button" onClick={closeExecutorPicker}>
                取消
              </button>
              <button
                class="btn btn-primary"
                type="button"
                onClick={confirmExecutorPicker}
                disabled={!EXECUTOR_ENGINES.find((e) => e.id === pickerEngine())?.ready}
              >
                <span class="codicon codicon-check" aria-hidden="true" />
                确认选择
              </button>
            </div>
        </DialogSurface>
      </Show>

      {/* ── ③ 按组合分发的配置面板 ── */}
      <Show
        when={executorEngineOption().ready}
        fallback={
          <section class="executor-coming-soon">
            <span class="codicon codicon-tools" aria-hidden="true" />
            <div>
              <strong>{executorEngineOption().label} 执行器正在建设中</strong>
              <p>该执行器引擎尚未实现，敬请期待。当前可使用 Labrastro 执行器。</p>
            </div>
          </section>
        }
      >
        {/* Labrastro 远端配置 */}
        <Show when={executorEngine() === "labrastro" && executorLocation() === "remote"}>
          <section class="executor-config-panel">
            <div class="executor-config-panel__header">
              <span class="codicon codicon-radio-tower" aria-hidden="true" />
              <div>
                <strong>{t("executor.remote.title")}</strong>
                <small>{t("executor.remote.desc")}</small>
              </div>
            </div>

            {/* 连接详情卡片 */}
            <div class="executor-config-detail">
              <div class="executor-config-detail__row">
                <span class="executor-config-detail__label">{t("executor.remote.requestUrl")}</span>
                <span class="executor-config-detail__value">{stringValue(server.connectionState().hostUrl, "未配置")}</span>
              </div>
              <div class="executor-config-detail__row">
                <span class="executor-config-detail__label">{t("executor.remote.hostSource")}</span>
                <StatusBadge tone={hostUrlConfigured() ? "success" : "warning"}>{hostUrlSource()}</StatusBadge>
              </div>
              <div class="executor-config-detail__row">
                <span class="executor-config-detail__label">登录状态</span>
                <StatusBadge tone={server.connectionState().authenticated ? "success" : "warning"}>
                  {server.connectionState().authenticated ? "已登录" : "未登录"}
                </StatusBadge>
              </div>
              <Show when={server.connectionState().authenticated}>
                <div class="executor-config-detail__row">
                  <span class="executor-config-detail__label">当前账号</span>
                  <span class="executor-config-detail__value">
                    {stringValue(server.connectionState().username, "未知")} / {stringValue(server.connectionState().role, "user")}
                  </span>
                </div>
              </Show>
            </div>

            {/* 提示信息区 */}
            <Show when={hostUrlError()}>
              <div class="executor-config-notice executor-config-notice--error">
                <span class="codicon codicon-error" aria-hidden="true" />
                <span>{hostUrlError()}</span>
              </div>
            </Show>
            <Show when={connectionMessage()}>
              <div class="executor-config-notice executor-config-notice--error">
                <span class="codicon codicon-warning" aria-hidden="true" />
                <span>{connectionMessage()}</span>
              </div>
            </Show>
            <Show when={connectionSecurityWarnings().length}>
              <div class="executor-config-notice executor-config-notice--warning">
                <span class="codicon codicon-warning" aria-hidden="true" />
                <span>{connectionSecurityWarnings().join(" ")}</span>
              </div>
            </Show>
            <Show when={connectionSaveMessage()}>
              <div class="executor-config-notice executor-config-notice--success">
                <span class="codicon codicon-check" aria-hidden="true" />
                <div>
                  <strong>{t("executor.remote.saveResult")}</strong>
                  <span>{connectionSaveMessage()}</span>
                </div>
              </div>
            </Show>
            <Show when={hostUrlDraftDiffers()}>
              <div class="executor-config-notice executor-config-notice--warning">
                <span class="codicon codicon-warning" aria-hidden="true" />
                <span>输入框内容尚未生效，实际请求仍使用 {currentHostUrl()}。</span>
              </div>
            </Show>
            <Show when={isDefaultLocalHost()}>
              <div class="executor-config-notice executor-config-notice--info">
                <span class="codicon codicon-info" aria-hidden="true" />
                <span>当前为本机默认地址。如需连接远程服务器，请修改为对应地址，如 http://192.168.50.149:8765。</span>
              </div>
            </Show>

            {/* 表单 */}
            <div class="executor-config-form">
              <label class="executor-config-field">
                <span class="executor-config-field__label">
                  <span class="codicon codicon-globe" aria-hidden="true" />
                  Host URL
                </span>
                <input class="executor-config-field__input" value={hostUrl()} placeholder="http://192.168.50.149:8765" onInput={(event) => {
                  setHostUrlDirty(true)
                  setHostUrl(event.currentTarget.value)
                  setPendingHostSave(undefined)
                  setHostUrlError(undefined)
                  setHostUrlSyncLock(undefined)
                  const key = connectionSaveResultKey(server.connectionSaveResult())
                  if (key) setDismissedConnectionSaveResultKey(key)
                }} />
              </label>
              <Show when={!server.connectionState().authenticated}>
              <div class="executor-config-form__secrets">
                <label class="executor-config-field">
                  <span class="executor-config-field__label">
                    <span class="codicon codicon-account" aria-hidden="true" />
                    用户名
                  </span>
                  <input class="executor-config-field__input" value={loginUsername()} placeholder="admin" onInput={(event) => setLoginUsername(event.currentTarget.value)} />
                </label>
                <label class="executor-config-field">
                  <span class="executor-config-field__label">
                    <span class="codicon codicon-key" aria-hidden="true" />
                    密码
                  </span>
                  <input class="executor-config-field__input" value={loginPassword()} type="password" placeholder={t("provider.apiKeyPlaceholder")} onInput={(event) => setLoginPassword(event.currentTarget.value)} />
                </label>
              </div>
              </Show>
            </div>

            <div class="executor-config-panel__footer">
              <Show
                when={!server.connectionState().authenticated}
                fallback={
                  <button class="btn btn-secondary" onClick={logoutConnection}>
                    <span class="codicon codicon-sign-out" aria-hidden="true" />
                    退出登录
                  </button>
                }
              >
              <button
                class={`btn btn-primary ${saveLoading() ? "btn--loading" : ""} ${saveSuccess() ? "btn--success" : ""}`}
                onClick={saveConnection}
                disabled={saveLoading()}
              >
                <span class={`codicon codicon-${saveLoading() ? "loading" : saveSuccess() ? "check" : "sign-in"}`} aria-hidden="true" />
                {saveLoading() ? "登录中…" : saveSuccess() ? "已登录" : "登录"}
              </button>
              </Show>
              <button
                class={`btn btn-secondary ${refreshLoading() ? "btn--loading" : ""}`}
                onClick={refreshAdmin}
                disabled={refreshLoading()}
              >
                <span class={`codicon codicon-${refreshLoading() ? "loading" : "refresh"}`} aria-hidden="true" />
                {refreshLoading() ? "刷新中…" : "测试连接"}
              </button>
            </div>
          </section>
        </Show>

        {/* Labrastro 本地配置 */}
        <Show when={executorEngine() === "labrastro" && executorLocation() === "local"}>
          <section class="executor-coming-soon">
            <span class="codicon codicon-device-desktop" aria-hidden="true" />
            <div>
              <strong>{t("executor.local.title")}</strong>
              <p>{t("executor.local.desc")}</p>
            </div>
          </section>
        </Show>
      </Show>
    </div>
  )


}
