import { Component, For, Show } from "solid-js"
import { t } from "../../i18n"
import { StatusBadge } from "../components/StatusBadge"
import type { SettingsController } from "../useSettingsController"

type ProviderType = "openai_chat" | "anthropic_messages" | "openai_responses"
type ProviderCompat = "generic" | "deepseek" | "kimi" | "glm" | "qwen" | "zenmux"

interface TabProps { controller: SettingsController & Record<string, any> }

export const ProvidersTab: Component<TabProps> = (props) => {
  const {
    activeMain,
    activeSub,
    refreshAdmin,
    server,
    resetProviderForm,
    providerErrorMessage,
    connectionStatus,
    connectionMessage,
    isDefaultLocalHost,
    actionFeedback,
    providers,
    providerId,
    selectProvider,
    stringValue,
    providerBaseUrl,
    providerEnabled,
    selectedProvider,
    adminUsable,
    toggleProviderEnabled,
    saveProvider,
    activeMainProfile,
    activeSubProfile,
    selectedProviderProfiles,
    providerType,
    setProviderType,
    providerTypes,
    providerCompat,
    setProviderCompat,
    compats,
    setProviderId,
    setProviderBaseUrl,
    providerApiKey,
    setProviderApiKey,
    setProviderEnabled,
    openCustomModelDialog,
    requestProviderModels,
    modelSearch,
    setModelSearch,
    modelFetchMessage,
    filteredFetchedModels,
    emptyModelListMessage,
    showCustomModelFallback,
    modelProfilesFor,
    profileModel,
    modelDetailOpen,
    openModelDetail,
    openSavedPreset,
    providerCopyId,
    setProviderCopyId,
    copyProvider,
    deleteProvider,
    customModelDialogOpen,
    closeCustomModelDialog,
    customModelDraft,
    setCustomModelDraft,
    confirmCustomModelDialog,
    closeModelDetail,
    modelDetailMode,
    currentDetailHasSavedPreset,
    currentDetailIsMain,
    currentDetailIsSub,
    profileProvider,
    providerModel,
    setProviderModel,
    setProfileModel,
    testProvider,
    activateModelPreset,
    profileId,
    setProfileId,
    maxTokens,
    setMaxTokens,
    maxContextTokens,
    setMaxContextTokens,
    temperature,
    setTemperature,
    reasoningEffort,
    setReasoningEffort,
    thinkingEnabled,
    setThinkingEnabled,
    saveModelPreset,
    setProfileProvider,
  } = props.controller

  const profileBadges = (profileIdValue: string) => (
    <>
      <Show when={profileIdValue === activeMain()}>
        <StatusBadge tone="success">主</StatusBadge>
      </Show>
      <Show when={profileIdValue === activeSub()}>
        <StatusBadge tone="warning">副</StatusBadge>
      </Show>
    </>
  )

  const renderActiveModelCard = (
    title: string,
    profile: Record<string, unknown> | undefined,
    tone: "success" | "warning",
  ) => (
    <div class="active-model-card">
      <div>
        <StatusBadge tone={tone}>{title}</StatusBadge>
      </div>
      <strong>{profile ? stringValue(profile.model, "未配置模型") : "未配置"}</strong>
      <small>{profile ? `${stringValue(profile.provider, "-")} · ${stringValue(profile.id, "-")}` : "从模型列表选择后可一键设置"}</small>
    </div>
  )

  const renderCustomModelDialog = () => (
    <Show when={customModelDialogOpen()}>
      <div class="settings-overlay settings-overlay--center" onClick={closeCustomModelDialog}>
        <div class="settings-modal" role="dialog" aria-modal="true" aria-label="自定义模型名" onClick={(event) => event.stopPropagation()}>
              <div class="settings-modal__header">
            <div>
              <h3>自定义模型名</h3>
              <p>用于补充模型列表里没有返回的模型，或直接按自定义名称创建模型入口。</p>
            </div>
            <button class="ez-icon-button" type="button" title="关闭" onClick={closeCustomModelDialog}>
              <span class="codicon codicon-close" aria-hidden="true" />
            </button>
          </div>
          <label class="field-label">
            <span>模型名</span>
            <input
              class="setting-input"
              value={customModelDraft()}
              placeholder="例如 deepseek-chat"
              onInput={(event) => setCustomModelDraft(event.currentTarget.value)}
            />
          </label>
          <div class="settings-actions settings-actions--right">
            <button class="btn btn-secondary" type="button" onClick={closeCustomModelDialog}>
              取消
            </button>
            <button class="btn btn-primary" type="button" onClick={confirmCustomModelDialog} disabled={!customModelDraft().trim()}>
              继续
            </button>
          </div>
        </div>
      </div>
    </Show>
  )

  const renderModelDetailDrawer = () => (
    <Show when={modelDetailOpen()}>
      <div class="settings-overlay" onClick={closeModelDetail}>
        <aside class="model-detail-drawer" role="dialog" aria-modal="true" aria-label="模型详情" onClick={(event) => event.stopPropagation()}>
          <div class="model-detail-drawer__header">
            <div>
              <div class="settings-badge-group">
                <StatusBadge>{modelDetailMode() === "custom" ? "自定义模型名" : "模型详情"}</StatusBadge>
                <Show when={false}>
                  <StatusBadge>{t("model.savedPresets")}</StatusBadge>
                </Show>
                <Show when={false}>
                  <StatusBadge tone="success">当前主模型</StatusBadge>
                </Show>
                <Show when={false}>
                  <StatusBadge tone="warning">当前副模型</StatusBadge>
                </Show>
              </div>
              <h3>{profileModel() || "模型详情"}</h3>
              <p>{profileProvider() || providerId()} · {modelDetailMode() === "custom" ? "手动指定模型名" : "来自当前服务商模型列表"}</p>
            </div>
            <button class="ez-icon-button" type="button" title="关闭" onClick={closeModelDetail}>
              <span class="codicon codicon-close" aria-hidden="true" />
            </button>
          </div>

          <div class="model-detail-drawer__content">
            <div class="model-detail-meta">
              <div class="model-detail-meta__item">
                <span>服务商</span>
                <strong>{profileProvider() || providerId() || "未选择"}</strong>
              </div>
              <div class="model-detail-meta__item">
                <span>预设名称</span>
                <strong>{profileId() || "自动生成"}</strong>
              </div>
            </div>

            <Show when={modelDetailMode() === "custom"}>
              <label class="field-label">
                <span>模型名</span>
                <input
                  class="setting-input"
                  value={profileModel()}
                  placeholder="例如 deepseek-chat"
                  onInput={(event) => {
                    setProfileModel(event.currentTarget.value)
                    setProviderModel(event.currentTarget.value)
                  }}
                />
                <small>用于补充列表里没有返回的模型，或直接按已知模型名创建入口。</small>
              </label>
            </Show>

            <div class="settings-actions model-detail-actions">
              <button class="btn btn-secondary" type="button" onClick={() => testProvider(profileModel())} disabled={!profileModel().trim() || !adminUsable()}>
                <span class="codicon codicon-beaker" aria-hidden="true" />
                测试连接
              </button>
              <button class="btn btn-primary" type="button" onClick={() => activateModelPreset("main")} disabled={!profileModel().trim() || !adminUsable()} hidden>
                设为主模型
              </button>
              <button class="btn btn-secondary" type="button" onClick={() => activateModelPreset("sub")} disabled={!profileModel().trim() || !adminUsable()} hidden>
                设为副模型
              </button>
              <button class="btn btn-secondary" type="button" onClick={() => activateModelPreset("both")} disabled={!profileModel().trim() || !adminUsable()} hidden>
                设为主+副
              </button>
            </div>

            <details class="settings-details model-detail-advanced" hidden>
              <summary>
                <span class="codicon codicon-settings-gear" aria-hidden="true" />
                高级参数
              </summary>
              <div class="settings-form-grid settings-form-grid--two">
                <label class="field-label">
                  <span>预设名称（可选）</span>
                  <input class="setting-input" value={profileId()} placeholder="deepseek-main" onInput={(event) => setProfileId(event.currentTarget.value)} />
                  <small>留空时按服务商和模型自动生成。</small>
                </label>
                <label class="field-label">
                  <span>Max tokens</span>
                  <input class="setting-input" type="number" value={maxTokens()} onInput={(event) => setMaxTokens(Number(event.currentTarget.value))} />
                </label>
                <label class="field-label">
                  <span>Max context tokens</span>
                  <input class="setting-input" type="number" value={maxContextTokens()} onInput={(event) => setMaxContextTokens(Number(event.currentTarget.value))} />
                </label>
                <label class="field-label">
                  <span>Temperature</span>
                  <input class="setting-input" type="number" step="0.1" value={temperature()} onInput={(event) => setTemperature(Number(event.currentTarget.value))} />
                </label>
                <label class="field-label">
                  <span>Reasoning effort</span>
                  <input class="setting-input" value={reasoningEffort()} placeholder="high，可空" onInput={(event) => setReasoningEffort(event.currentTarget.value)} />
                </label>
                <label class="field-label field-label--checkbox">
                  <input type="checkbox" checked={thinkingEnabled()} onChange={(event) => setThinkingEnabled(event.currentTarget.checked)} />
                  <span>启用 thinking</span>
                </label>
              </div>
              <div class="settings-actions">
                <button class="btn btn-primary" type="button" onClick={saveModelPreset} disabled={!profileModel().trim() || !profileProvider() || !adminUsable()}>
                  <span class="codicon codicon-save" aria-hidden="true" />
                  保存预设
                </button>
              </div>
            </details>
          </div>
        </aside>
      </div>
    </Show>
  )

  return (
    <div class="settings-page settings-page--wide">
      <div class="settings-page-header">
        <div>
          <h2>{t("provider.title")}</h2>
          <p>服务商只负责连接、凭据和模型目录；Agent 默认模型在 Agent 配置页选择。</p>
          <p class="setting-description">
            实际请求 Host：{stringValue(server.connectionState().hostUrl, "未配置")} · Admin：
            {adminUsable() ? "可用" : t("executor.status.unavailable")} · 最近刷新：{server.adminStateUpdatedAt() || "尚未刷新"}
          </p>
        </div>
        <div class="settings-actions settings-actions--right">
          <button class="btn btn-secondary" onClick={resetProviderForm}>
            <span class="codicon codicon-add" aria-hidden="true" />
            新增服务商
          </button>
          <button class="btn btn-secondary" onClick={refreshAdmin}>
            <span class="codicon codicon-refresh" aria-hidden="true" />
            刷新
          </button>
        </div>
      </div>

      <Show when={providerErrorMessage()}>
        <div class="settings-error">{providerErrorMessage()}</div>
      </Show>
      <Show when={connectionStatus() === "error" && connectionMessage()}>
        <div class="settings-error">{connectionMessage()}</div>
      </Show>
      <Show when={isDefaultLocalHost()}>
        <div class="settings-action-result">
          <div>
            <strong>服务商管理请求会发送到当前执行器</strong>
            <small>当前仍是默认本机地址；中心化 host 在服务器时需要先到“执行器管理”页保存服务器 Host URL。</small>
          </div>
        </div>
      </Show>
      <Show when={actionFeedback()}>
        <div class="settings-action-result">
          <div>
            <strong>{actionFeedback()}</strong>
          </div>
        </div>
      </Show>

      <div class="provider-workbench">
        <aside class="provider-list-panel">
          <div class="settings-panel-title">
            <span>服务商</span>
            <StatusBadge>{String(providers().length)}</StatusBadge>
          </div>
          <div class="provider-list">
            <Show when={providers().length} fallback={<p class="settings-empty-note">暂无服务商，使用右侧表单新增。</p>}>
              <For each={providers()}>
                {(provider) => {
                  const id = stringValue(provider.id)
                  const selected = id === providerId()
                  const enabled = provider.enabled !== false
                  return (
                    <button
                      type="button"
                      class={`provider-list-item ${selected ? "provider-list-item--active" : ""}`}
                      onClick={() => selectProvider(provider)}
                    >
                      <span class="provider-list-item__icon codicon codicon-server-process" aria-hidden="true" />
                      <span class="provider-list-item__body">
                        <strong>{id}</strong>
                        <small>{stringValue(provider.base_url, "未配置 base URL")}</small>
                      </span>
                      <span class="provider-list-item__meta">
                        {stringValue(provider.compat, "generic")}
                        <StatusBadge tone={enabled ? "success" : "warning"}>
                          {enabled ? "启用" : "停用"}
                        </StatusBadge>
                      </span>
                    </button>
                  )
                }}
              </For>
            </Show>
          </div>
        </aside>

        <section class="provider-editor-panel">
          <div class="settings-editor-header">
            <div>
              <h3>{providerId() || "新服务商"}</h3>
              <p>{providerBaseUrl() || "填写协议、兼容模式和 API Base URL 后保存。"}</p>
            </div>
            <div class="settings-actions settings-actions--right">
              <button class="btn btn-secondary" onClick={() => toggleProviderEnabled(!providerEnabled())} disabled={!selectedProvider() || !adminUsable()}>
                <span class={`codicon codicon-${providerEnabled() ? "circle-slash" : "pass"}`} aria-hidden="true" />
                {providerEnabled() ? "停用" : "启用"}
              </button>
              <button class="btn btn-primary" onClick={saveProvider} disabled={!providerId() || !adminUsable()}>
                <span class="codicon codicon-save" aria-hidden="true" />
                保存服务商
              </button>
            </div>
          </div>

          <div class="settings-summary-grid" hidden>
            {renderActiveModelCard("主模型", activeMainProfile(), "success")}
            {renderActiveModelCard("副模型", activeSubProfile(), "warning")}
          </div>

          <div class="settings-section settings-section--flat">
            <div class="settings-section-heading">服务商设置</div>
            <div class="settings-form-grid settings-form-grid--two settings-form-grid--bounded">
              <label class="field-label">
                <span>服务商名称</span>
                <input class="setting-input" value={providerId()} placeholder="deepseek" onInput={(event) => setProviderId(event.currentTarget.value)} />
                <small>用于区分不同服务商，建议使用英文或拼音。</small>
              </label>
              <label class="field-label">
                <span>协议类型</span>
                <select class="setting-select" value={providerType()} onChange={(event) => setProviderType(event.currentTarget.value as ProviderType)}>
                  <For each={providerTypes}>{(item) => <option value={item}>{item}</option>}</For>
                </select>
              </label>
              <label class="field-label">
                <span>{t("provider.compat")}</span>
                <select class="setting-select" value={providerCompat()} onChange={(event) => setProviderCompat(event.currentTarget.value as ProviderCompat)}>
                  <For each={compats}>{(item) => <option value={item}>{item}</option>}</For>
                </select>
              </label>
              <label class="field-label">
                <span>API Base URL</span>
                <input class="setting-input" value={providerBaseUrl()} placeholder="https://api.deepseek.com" onInput={(event) => setProviderBaseUrl(event.currentTarget.value)} />
              </label>
              <label class="field-label">
                <span>API Key</span>
                <input class="setting-input" value={providerApiKey()} type="password" placeholder="留空保留旧值" onInput={(event) => setProviderApiKey(event.currentTarget.value)} />
                <small>保存到 host 配置；保存成功后会清空输入框。</small>
              </label>
              <label class="field-label field-label--checkbox">
                <input type="checkbox" checked={providerEnabled()} onChange={(event) => setProviderEnabled(event.currentTarget.checked)} />
                <span>启用服务商</span>
              </label>
            </div>
          </div>

          <div class="settings-section settings-section--flat">
            <div class="settings-section-heading">
              <span>模型列表</span>
              <div class="settings-actions settings-actions--right">
                <button class="btn btn-secondary" type="button" onClick={openCustomModelDialog} disabled={!selectedProvider() || !adminUsable()}>
                  <span class="codicon codicon-edit" aria-hidden="true" />
                  自定义模型名
                </button>
                <button class="btn btn-secondary" onClick={() => requestProviderModels()} disabled={!selectedProvider() || !adminUsable()}>
                  <span class="codicon codicon-cloud-download" aria-hidden="true" />
                  刷新模型列表
                </button>
              </div>
            </div>
            <div class="settings-inline-form">
              <input class="setting-input" value={modelSearch()} placeholder="搜索模型" onInput={(event) => setModelSearch(event.currentTarget.value)} />
            </div>
            <Show when={modelFetchMessage()}>
              <p class="settings-empty-note">{modelFetchMessage()}</p>
            </Show>
            <Show when={filteredFetchedModels().length} fallback={
              <div class="settings-empty-state">
                <span class="codicon codicon-symbol-string" aria-hidden="true" />
                <strong>{emptyModelListMessage()}</strong>
                <small>
                  {showCustomModelFallback()
                    ? "当前服务商无法给出模型清单时，可手动指定模型名。"
                    : "换个关键词搜索，或清空搜索后重试。"}
                </small>
                <div class="settings-actions">
                  <button class="btn btn-secondary" type="button" onClick={openCustomModelDialog} disabled={!selectedProvider() || !adminUsable()}>
                    <span class="codicon codicon-edit" aria-hidden="true" />
                    自定义模型名
                  </button>
                  <Show when={!showCustomModelFallback() && modelSearch().trim()}>
                    <button class="btn btn-secondary" type="button" onClick={() => setModelSearch("")}>
                      清空搜索
                    </button>
                  </Show>
                </div>
              </div>
            }>
              <div class="provider-model-list">
                <For each={filteredFetchedModels()}>
                  {(model) => {
                    const relatedProfiles = modelProfilesFor(model.id)
                    const presetCount = relatedProfiles.length
                    const firstPresetId = presetCount > 0 ? stringValue(relatedProfiles[0].id) : ""
                    const isMain = relatedProfiles.some((profile) => stringValue(profile.id) === activeMain())
                    const isSub = relatedProfiles.some((profile) => stringValue(profile.id) === activeSub())
                    return (
                      <button
                        type="button"
                        class={`provider-model-row ${profileModel() === model.id && modelDetailOpen() ? "provider-model-row--selected" : ""}`}
                        onClick={() => openModelDetail(model.id, "fetched")}
                      >
                        <span class="provider-model-row__body">
                          <strong>{model.id}</strong>
                          <small>
                            {false
                              ? `已保存预设 ${firstPresetId}${presetCount > 1 ? ` +${presetCount - 1}` : ""}`
                              : model.owned_by || "provider model"}
                          </small>
                        </span>
                        <span class="settings-badge-group provider-model-row__meta">
                          <Show when={false}>
                            <StatusBadge>{t("model.savedPresets")}</StatusBadge>
                          </Show>
                          <Show when={false}>
                            <StatusBadge tone="success">主</StatusBadge>
                          </Show>
                          <Show when={false}>
                            <StatusBadge tone="warning">副</StatusBadge>
                          </Show>
                        </span>
                      </button>
                    )
                  }}
                </For>
              </div>
            </Show>
          </div>

          <details class="settings-details" hidden>
            <summary>
              <span class="codicon codicon-list-tree" aria-hidden="true" />
              已保存预设
            </summary>
            <Show when={selectedProviderProfiles().length} fallback={<p class="settings-empty-note">当前服务商还没有保存预设。</p>}>
              <div class="compact-list">
                <For each={selectedProviderProfiles()}>
                  {(profile) => {
                    const id = stringValue(profile.id)
                    return (
                      <button type="button" class="compact-row" onClick={() => openSavedPreset(profile)}>
                        <span>
                          <strong>{id}</strong>
                          <small>{stringValue(profile.model)}</small>
                        </span>
                        <span class="settings-badge-group">{profileBadges(id)}</span>
                      </button>
                    )
                  }}
                </For>
              </div>
            </Show>
          </details>

          <details class="settings-details">
            <summary>
              <span class="codicon codicon-copy" aria-hidden="true" />
              高级操作
            </summary>
            <div class="settings-inline-form">
              <input class="setting-input" value={providerCopyId()} placeholder="复制后的服务商 ID" onInput={(event) => setProviderCopyId(event.currentTarget.value)} />
              <button class="btn btn-secondary" onClick={copyProvider} disabled={!selectedProvider() || !adminUsable()}>
                <span class="codicon codicon-copy" aria-hidden="true" />
                复制服务商
              </button>
            </div>
            <p class="settings-empty-note">复制用于基于当前服务商配置创建另一个 provider id；不会修改任何 Agent 默认模型。</p>
          </details>

          <div class="settings-section settings-section--flat danger-zone">
            <div class="settings-section-heading">危险区</div>
            <p class="settings-empty-note">删除服务商前，后端会检查是否仍被 Agent 默认模型引用。</p>
            <button class="btn btn-danger" onClick={deleteProvider} disabled={!selectedProvider() || !adminUsable()}>
              <span class="codicon codicon-trash" aria-hidden="true" />
              删除服务商
            </button>
          </div>
        </section>
      </div>

      {renderCustomModelDialog()}
      {renderModelDetailDrawer()}
    </div>
  )


}
