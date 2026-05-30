import { Component, For, Show, createSignal } from "solid-js"
import { t } from "../../i18n"
import { RefreshButton } from "../../components/common/RefreshButton"
import { SelectableList } from "../../components/common/interaction"
import { StatusBadge } from "../components/StatusBadge"
import { ChoiceMultiSelect } from "../components/ChoiceMultiSelect"
import {
  SettingsActionRail,
  SettingsPage,
  SettingsPageHeader,
  SettingsSubTabButton,
  SettingsSubTabs,
} from "../components/SettingsLayout"
import type { SettingsController } from "../useSettingsController"

interface TabProps { controller: SettingsController & Record<string, any> }

type AgentConfigSection = "profiles" | "agents" | "runtimeTest"

const AGENT_CONFIG_SECTIONS: Array<{ id: AgentConfigSection; labelKey: string; icon: string }> = [
  { id: "profiles", labelKey: "agentConfig.profiles", icon: "server-environment" },
  { id: "agents", labelKey: "agentConfig.agents", icon: "hubot" },
  { id: "runtimeTest", labelKey: "agentConfig.runtimeTest.title", icon: "play" },
]

export const AgentConfigTab: Component<TabProps> = (props) => {
  const {
    refreshServerSettings,
    saveAgentConfig,
    serverSettingsSaveBusy,
    agentConfigDirty,
    agentConfigSavePending,
    server,
    agentConfigError,
    agentConfigSaved,
    profileDrafts,
    addProfile,
    selectedProfileId,
    setSelectedProfileId,
    deleteProfile,
    currentProfileDraft,
    currentProfileIdLocked,
    selectedProfileExecutorFeature,
    renameProfile,
    updateProfileField,
    setProfileExecutorSelect,
    PROFILE_EXECUTOR_OPTIONS,
    PROFILE_EXECUTION_LOCATION_OPTIONS,
    PROFILE_WORKER_KIND_OPTIONS,
    PROFILE_MODEL_REQUEST_ORIGIN_OPTIONS,
    PROFILE_HOME_POLICY_OPTIONS,
    PROFILE_APPROVAL_MODE_OPTIONS,
    PROFILE_CONFIG_ISOLATION_OPTIONS,
    runtimeModelOptions,
    registeredMcpServers,
    profileMcpValidationWarnings,
    agentDrafts,
    addAgent,
    selectedAgentId,
    setSelectedAgentId,
    deleteAgent,
    currentAgentDraft,
    currentAgentIdLocked,
    renameAgent,
    setAgentNameInput,
    profileIdList,
    updateAgentField,
    capabilityPackageOptions,
    selectedAgentCapabilityPackages,
    capabilityPackageComponentGroups,
    formatAgentConfigList,
    parseAgentConfigListText,
    agentRunPolling,
    agentRunTerminal,
    agentRunCanResume,
    selectedAgentRunId,
    agentRunPrompt,
    setAgentRunPrompt,
    submitAgentRunTest,
    agentRunSubmitting,
    cancelAgentRunTest,
    retryAgentRunTest,
    agentRunError,
    agentRun,
    agentRunEvents,
    numberValue,
    stringValue,
    objectValue,
    runtimeOptionDescription,
  } = props.controller

  const [section, setSection] = createSignal<AgentConfigSection>("profiles")
  const profileIds = () => Object.keys(profileDrafts())
  const agentIds = () => Object.keys(agentDrafts())
  const currentAgentReadOnly = () => Boolean(currentAgentDraft() && currentAgentDraft()!.visibility !== "user")
  const mcpChoiceOptions = () => registeredMcpServers().map((id: string) => ({ id, label: id, kind: "MCP" }))
  const capabilityChoiceOptions = () => capabilityPackageOptions().map((id: string) => ({ id, label: id, kind: "能力包" }))
  const readonlyValue = (value: unknown) => {
    const text = String(value ?? "").trim()
    return text || "—"
  }
  const readonlyBooleanValue = (value: unknown) => value ? "是" : "否"
  const readonlyRoleLabel = (role: unknown) => {
    switch (String(role || "")) {
      case "coordinator":
        return t("agentConfig.agent.role.coordinator")
      case "worker":
        return t("agentConfig.agent.role.worker")
      case "reviewer":
        return t("agentConfig.agent.role.reviewer")
      case "environment":
        return t("agentConfig.agent.role.environment")
      default:
        return readonlyValue(role)
    }
  }
  const ReadonlyField: Component<{
    label: string
    value: () => unknown
    help?: string
    full?: boolean
    multiline?: boolean
  }> = (field) => (
    <div
      classList={{
        "field-label": true,
        "field-label--full": field.full === true,
      }}
      data-agent-config-readonly="true"
    >
      <span>{field.label}</span>
      <Show
        when={field.multiline === true}
        fallback={<div class="settings-result settings-result--inline">{readonlyValue(field.value())}</div>}
      >
        <pre class="settings-result">{readonlyValue(field.value())}</pre>
      </Show>
      <Show when={field.help}>
        <small class="field-help">{field.help}</small>
      </Show>
    </div>
  )
  const ReadonlyBooleanField: Component<{
    label: string
    value: () => unknown
    help?: string
  }> = (field) => (
    <ReadonlyField label={field.label} value={() => readonlyBooleanValue(field.value())} help={field.help} />
  )
  const renderCapabilityGroup = (label: string, items: any[], empty: string) => (
    <div class="settings-detail-section">
      <span>{label}</span>
      <Show when={items.length} fallback={<small>{empty}</small>}>
        <div class="settings-badge-group">
          <For each={items}>
            {(item) => <StatusBadge>{item.summary || item.name || item.id}</StatusBadge>}
          </For>
        </div>
      </Show>
    </div>
  )

  return (
    <SettingsPage>
      <SettingsPageHeader>
        <div>
          <h2>{t("agentConfig.title")}</h2>
        </div>
        <SettingsActionRail align="right">
          <RefreshButton class="btn-secondary" loading={props.controller.pageRefreshing("agentConfig")} onClick={refreshServerSettings}>
            刷新
          </RefreshButton>
          <button class="btn btn-primary" onClick={saveAgentConfig} disabled={!agentConfigDirty() || serverSettingsSaveBusy()}>
            <span class="codicon codicon-save" aria-hidden="true" />
            {agentConfigSavePending() ? t("agentConfig.saving") : t("agentConfig.save")}
          </button>
        </SettingsActionRail>
      </SettingsPageHeader>

      <Show when={props.controller.operations.error("agentConfigSave") || props.controller.operations.error("serverSettings")}>
        <div class="settings-error">{props.controller.operations.error("agentConfigSave") || props.controller.operations.error("serverSettings")}</div>
      </Show>
      <Show when={agentConfigError()}>
        <div class="settings-error">{agentConfigError()}</div>
      </Show>
      <Show when={agentConfigSaved()}>
        <div class="settings-success">{t("agentConfig.saved")}</div>
      </Show>

      {/* ── Runtime Profiles Section ── */}
      <SettingsSubTabs ariaLabel={t("agentConfig.title")}>
        <For each={AGENT_CONFIG_SECTIONS}>
          {(item) => (
            <SettingsSubTabButton
              active={section() === item.id}
              icon={item.icon}
              onClick={() => setSection(item.id)}
            >
              {t(item.labelKey)}
            </SettingsSubTabButton>
          )}
        </For>
      </SettingsSubTabs>

      <Show when={section() === "profiles"}>
      <section class="settings-section settings-section--flat" classList={{ "settings-section--hidden": section() !== "profiles" }}>
        <div class="settings-section-heading">
          <span>{t("agentConfig.profiles")}</span>
          <StatusBadge tone="muted">{String(Object.keys(profileDrafts()).length)}</StatusBadge>
        </div>
        <div class="settings-master-detail">
          <div class="settings-master-list">
            <div class="settings-master-actions">
              <button class="btn btn-secondary" onClick={addProfile}>
                <span class="codicon codicon-add" aria-hidden="true" />
                {t("agentConfig.profile.add")}
              </button>
            </div>
            <Show when={Object.keys(profileDrafts()).length === 0}>
              <p class="settings-empty-note">{t("agentConfig.profile.empty")}</p>
            </Show>
            <SelectableList
              ariaLabel={t("agentConfig.profiles")}
              items={profileIds()}
              selectedId={selectedProfileId()}
              onSelect={setSelectedProfileId}
              renderItem={(pid) => (
                <div class="settings-master-item__info">
                  <strong>{pid}</strong>
                  <small>{profileDrafts()[pid]?.executor} · {profileDrafts()[pid]?.execution_location}</small>
                </div>
              )}
              renderAction={(pid) => (
                <button class="btn-icon" type="button" onClick={() => deleteProfile(pid)} title={t("agentConfig.profile.delete")} aria-label={t("agentConfig.profile.delete")}>
                  <span class="codicon codicon-trash" aria-hidden="true" />
                </button>
              )}
            />
          </div>
          <div class="settings-detail-panel">
            <Show when={currentProfileDraft()} fallback={<p class="settings-empty-note">{t("agentConfig.profile.noSelection")}</p>}>
              <div class="settings-form-grid">
                <label class="field-label field-label--full"><span>{t("agentConfig.profile.id")}</span>
                  <input
                    value={currentProfileDraft()!.id}
                    disabled={currentProfileIdLocked()}
                    onChange={(e) => renameProfile(e.currentTarget.value, e.currentTarget)}
                  />
                  <small class="field-help">
                    {currentProfileIdLocked() ? t("agentConfig.profile.idLocked") : t("agentConfig.profile.idHelp")}
                  </small>
                </label>
                <label class="field-label"><span>{t("agentConfig.profile.executor")}</span>
                  <select ref={setProfileExecutorSelect} value={currentProfileDraft()!.executor} onChange={(e) => updateProfileField("executor", e.currentTarget.value)}>
                    <For each={PROFILE_EXECUTOR_OPTIONS}>{(option) => <option value={option.value}>{t(option.labelKey)}</option>}</For>
                  </select>
                  <small class="field-help">{runtimeOptionDescription(PROFILE_EXECUTOR_OPTIONS, currentProfileDraft()!.executor)}</small>
                </label>
                <Show when={selectedProfileExecutorFeature()}>
                  <div class="executor-capability-panel field-label--full">
                    <div class="executor-capability-panel__header">
                      <strong>{t("agentConfig.profile.executorFeature")}</strong>
                      <span>{currentProfileDraft()!.executor}</span>
                    </div>
                    <div class="settings-badge-group">
                      <StatusBadge tone={selectedProfileExecutorFeature()!.installed ? "success" : "error"}>
                        {selectedProfileExecutorFeature()!.installed ? t("agentConfig.profile.feature.installed") : t("agentConfig.profile.feature.missing")}
                      </StatusBadge>
                      <Show when={selectedProfileExecutorFeature()!.version}>
                        <StatusBadge>{selectedProfileExecutorFeature()!.version}</StatusBadge>
                      </Show>
                      <StatusBadge tone={selectedProfileExecutorFeature()!.streamJson ? "success" : "muted"}>{t("agentConfig.profile.feature.streamJson")}</StatusBadge>
                      <StatusBadge tone={selectedProfileExecutorFeature()!.sessionDiscovery ? "success" : "muted"}>{t("agentConfig.profile.feature.sessionDiscovery")}</StatusBadge>
                      <StatusBadge tone={selectedProfileExecutorFeature()!.resumeById ? "success" : "muted"}>{t("agentConfig.profile.feature.resume")}</StatusBadge>
                      <StatusBadge tone={selectedProfileExecutorFeature()!.mcpConfig ? "success" : "muted"}>{t("agentConfig.profile.feature.mcp")}</StatusBadge>
                      <Show when={selectedProfileExecutorFeature()!.runtimeHomeIsolation}>
                        <StatusBadge>{selectedProfileExecutorFeature()!.runtimeHomeIsolation}</StatusBadge>
                      </Show>
                    </div>
                    <Show when={selectedProfileExecutorFeature()!.limitations.length > 0}>
                      <small>{t("agentConfig.profile.feature.limitations")}: {selectedProfileExecutorFeature()!.limitations.join("; ")}</small>
                    </Show>
                  </div>
                </Show>
                <label class="field-label"><span>{t("agentConfig.profile.executionLocation")}</span>
                  <select value={currentProfileDraft()!.execution_location} onChange={(e) => updateProfileField("execution_location", e.currentTarget.value)}>
                    <For each={PROFILE_EXECUTION_LOCATION_OPTIONS}>{(option) => <option value={option.value}>{t(option.labelKey)}</option>}</For>
                  </select>
                  <small class="field-help">{runtimeOptionDescription(PROFILE_EXECUTION_LOCATION_OPTIONS, currentProfileDraft()!.execution_location)}</small>
                </label>
                <label class="field-label"><span>{t("agentConfig.profile.runtimeHomePolicy")}</span>
                  <select value={currentProfileDraft()!.runtime_home_policy} onChange={(e) => updateProfileField("runtime_home_policy", e.currentTarget.value)}>
                    <For each={PROFILE_HOME_POLICY_OPTIONS}>{(option) => <option value={option.value}>{t(option.labelKey)}</option>}</For>
                  </select>
                  <small class="field-help">{runtimeOptionDescription(PROFILE_HOME_POLICY_OPTIONS, currentProfileDraft()!.runtime_home_policy)}</small>
                </label>
                <label class="field-label"><span>{t("agentConfig.profile.approvalMode")}</span>
                  <select value={currentProfileDraft()!.approval_mode} onChange={(e) => updateProfileField("approval_mode", e.currentTarget.value)}>
                    <For each={PROFILE_APPROVAL_MODE_OPTIONS}>{(option) => <option value={option.value}>{t(option.labelKey)}</option>}</For>
                  </select>
                  <small class="field-help">{runtimeOptionDescription(PROFILE_APPROVAL_MODE_OPTIONS, currentProfileDraft()!.approval_mode)}</small>
                </label>
                <label class="field-label field-label--full"><span>{t("agentConfig.profile.mcpServers")}</span>
                  <ChoiceMultiSelect
                    ariaLabel={t("agentConfig.profile.mcpServers")}
                    options={mcpChoiceOptions()}
                    valueText={currentProfileDraft()!.mcpServersText}
                    onChangeText={(next) => updateProfileField("mcpServersText", next)}
                    emptyMessage={t("agentConfig.profile.mcpServers.empty")}
                    searchPlaceholder="搜索 MCP"
                    unknownLabel={t("agentConfig.choice.custom")}
                  />
                  <small class="field-help">{t("agentConfig.profile.mcpServersDesc")}</small>
                </label>
                <Show when={profileMcpValidationWarnings().length > 0}>
                  <div class="settings-warning">
                    <span class="codicon codicon-warning" aria-hidden="true" />
                    <span>{t("agentConfig.profile.mcpNotRegistered")}: {profileMcpValidationWarnings().join(", ")}</span>
                  </div>
                </Show>
                <details class="settings-details settings-details--embedded field-label--full">
                  <summary>
                    <span class="codicon codicon-settings-gear" aria-hidden="true" />
                    {t("agentConfig.advanced")}
                  </summary>
                  <div class="settings-form-grid">
                    <label class="field-label"><span>{t("agentConfig.profile.workerKind")}</span>
                      <select value={currentProfileDraft()!.worker_kind} onChange={(e) => updateProfileField("worker_kind", e.currentTarget.value)}>
                        <For each={PROFILE_WORKER_KIND_OPTIONS}>{(option) => <option value={option.value}>{t(option.labelKey)}</option>}</For>
                      </select>
                      <small class="field-help">{runtimeOptionDescription(PROFILE_WORKER_KIND_OPTIONS, currentProfileDraft()!.worker_kind)}</small>
                    </label>
                    <label class="field-label"><span>{t("agentConfig.profile.modelRequestOrigin")}</span>
                      <select value={currentProfileDraft()!.model_request_origin} onChange={(e) => updateProfileField("model_request_origin", e.currentTarget.value)}>
                        <For each={PROFILE_MODEL_REQUEST_ORIGIN_OPTIONS}>{(option) => <option value={option.value}>{t(option.labelKey)}</option>}</For>
                      </select>
                      <small class="field-help">{runtimeOptionDescription(PROFILE_MODEL_REQUEST_ORIGIN_OPTIONS, currentProfileDraft()!.model_request_origin)}</small>
                    </label>
                    <label class="field-label"><span>{t("agentConfig.profile.command")}</span>
                      <input value={currentProfileDraft()!.command} onInput={(e) => updateProfileField("command", e.currentTarget.value)} placeholder={currentProfileDraft()!.executor} />
                      <small class="field-help">{t("agentConfig.profile.commandDesc")}</small>
                    </label>
                    <label class="field-label"><span>{t("agentConfig.profile.configIsolation")}</span>
                      <select value={currentProfileDraft()!.config_isolation} onChange={(e) => updateProfileField("config_isolation", e.currentTarget.value)}>
                        <For each={PROFILE_CONFIG_ISOLATION_OPTIONS}>{(option) => <option value={option.value}>{t(option.labelKey)}</option>}</For>
                      </select>
                      <small class="field-help">{runtimeOptionDescription(PROFILE_CONFIG_ISOLATION_OPTIONS, currentProfileDraft()!.config_isolation)}</small>
                    </label>
                    <label class="field-label"><span>{t("agentConfig.profile.args")}</span>
                      <textarea rows={3} value={currentProfileDraft()!.argsText} onInput={(e) => updateProfileField("argsText", e.currentTarget.value)} placeholder={'["--flag"]'} />
                      <small class="field-help">{t("agentConfig.profile.argsDesc")}</small>
                    </label>
                    <label class="field-label"><span>{t("agentConfig.profile.env")}</span>
                      <textarea rows={3} value={currentProfileDraft()!.envText} onInput={(e) => updateProfileField("envText", e.currentTarget.value)} placeholder={'{"KEY":"value"}'} />
                      <small class="field-help">{t("agentConfig.profile.envDesc")}</small>
                    </label>
                    <label class="field-label field-label--full"><span>{t("agentConfig.profile.credentialRefs")}</span>
                      <textarea rows={3} value={currentProfileDraft()!.credentialRefsText} onInput={(e) => updateProfileField("credentialRefsText", e.currentTarget.value)} placeholder={t("agentConfig.profile.credentialRefsDesc")} />
                      <small class="field-help">{t("agentConfig.profile.credentialRefsHelp")}</small>
                    </label>
                  </div>
                </details>
              </div>
            </Show>
          </div>
        </div>
      </section>
      </Show>

      {/* ── Agents Section ── */}
      <section class="settings-section settings-section--flat" classList={{ "settings-section--hidden": section() !== "agents" }}>
        <div class="settings-section-heading">
          <span>{t("agentConfig.agents")}</span>
          <StatusBadge tone="muted">{String(agentIds().length)}</StatusBadge>
        </div>
        <div class="settings-master-detail">
          <div class="settings-master-list">
            <div class="settings-master-actions">
              <button class="btn btn-secondary" onClick={addAgent}>
                <span class="codicon codicon-add" aria-hidden="true" />
                {t("agentConfig.agent.add")}
              </button>
            </div>
            <Show when={agentIds().length === 0}>
              <p class="settings-empty-note">{t("agentConfig.agent.empty")}</p>
            </Show>
            <SelectableList
              ariaLabel={t("agentConfig.agents")}
              items={agentIds()}
              selectedId={selectedAgentId()}
              onSelect={setSelectedAgentId}
              renderItem={(aid) => (
                <div class="settings-master-item__info">
                  <strong>{agentDrafts()[aid]?.name || aid}</strong>
                  <small>{agentDrafts()[aid]?.visibility} · {agentDrafts()[aid]?.runtime_profile || "—"}</small>
                </div>
              )}
              renderAction={(aid) => (
                <Show when={agentDrafts()[aid]?.visibility === "user"}>
                  <button class="btn-icon" type="button" onClick={() => deleteAgent(aid)} title={t("agentConfig.agent.delete")} aria-label={t("agentConfig.agent.delete")}>
                    <span class="codicon codicon-trash" aria-hidden="true" />
                  </button>
                </Show>
              )}
            />
          </div>
          <div class="settings-detail-panel">
            <Show when={currentAgentDraft()} fallback={<p class="settings-empty-note">{t("agentConfig.agent.noSelection")}</p>}>
              <div class="settings-form-grid">
                <Show
                  when={currentAgentReadOnly()}
                  fallback={
                    <label class="field-label field-label--full"><span>{t("agentConfig.agent.id")}</span>
                      <input
                        value={currentAgentDraft()!.id}
                        disabled={currentAgentIdLocked()}
                        onChange={(e) => renameAgent(e.currentTarget.value, e.currentTarget)}
                      />
                      <small class="field-help">
                        {currentAgentIdLocked() ? t("agentConfig.agent.idLocked") : t("agentConfig.agent.idHelp")}
                      </small>
                    </label>
                  }
                >
                  <ReadonlyField label={t("agentConfig.agent.id")} value={() => currentAgentDraft()!.id} help={t("agentConfig.agent.idLocked")} full />
                </Show>
                <Show
                  when={currentAgentReadOnly()}
                  fallback={
                    <label class="field-label"><span>{t("agentConfig.agent.name")}</span>
                      <input ref={setAgentNameInput} value={currentAgentDraft()!.name} onInput={(e) => updateAgentField("name", e.currentTarget.value)} />
                    </label>
                  }
                >
                  <ReadonlyField label={t("agentConfig.agent.name")} value={() => currentAgentDraft()!.name} />
                </Show>
                <Show
                  when={currentAgentReadOnly()}
                  fallback={
                    <label class="field-label"><span>{t("agentConfig.agent.description")}</span>
                      <input value={currentAgentDraft()!.description} onInput={(e) => updateAgentField("description", e.currentTarget.value)} />
                    </label>
                  }
                >
                  <ReadonlyField label={t("agentConfig.agent.description")} value={() => currentAgentDraft()!.description} />
                </Show>

                <Show
                  when={currentAgentReadOnly()}
                  fallback={
                    <label class="field-label"><span>{t("agentConfig.agent.role")}</span>
                      <select value={currentAgentDraft()!.role} onChange={(e) => updateAgentField("role", e.currentTarget.value)}>
                        <option value="coordinator">{t("agentConfig.agent.role.coordinator")}</option>
                        <option value="worker">{t("agentConfig.agent.role.worker")}</option>
                        <option value="reviewer">{t("agentConfig.agent.role.reviewer")}</option>
                        <option value="environment">{t("agentConfig.agent.role.environment")}</option>
                      </select>
                      <small class="field-help">{t("agentConfig.agent.roleDesc")}</small>
                    </label>
                  }
                >
                  <ReadonlyField label={t("agentConfig.agent.role")} value={() => readonlyRoleLabel(currentAgentDraft()!.role)} help={t("agentConfig.agent.roleDesc")} />
                </Show>
                <Show
                  when={currentAgentReadOnly()}
                  fallback={
                    <label class="field-label agent-config-toggle">
                      <input
                        type="checkbox"
                        checked={currentAgentDraft()!.chat_entrypoint}
                        onChange={(e) => updateAgentField("chat_entrypoint", e.currentTarget.checked)}
                      />
                      <span>{t("agentConfig.agent.entrypoint")}</span>
                      <small class="field-help">{t("agentConfig.agent.entrypointDesc")}</small>
                    </label>
                  }
                >
                  <ReadonlyBooleanField label={t("agentConfig.agent.entrypoint")} value={() => currentAgentDraft()!.chat_entrypoint} help={t("agentConfig.agent.entrypointDesc")} />
                </Show>
                <Show
                  when={currentAgentReadOnly()}
                  fallback={
                    <label class="field-label agent-config-toggle">
                      <input
                        type="checkbox"
                        checked={currentAgentDraft()!.delegable}
                        onChange={(e) => updateAgentField("delegable", e.currentTarget.checked)}
                      />
                      <span>{t("agentConfig.agent.delegable")}</span>
                      <small class="field-help">{t("agentConfig.agent.delegableDesc")}</small>
                    </label>
                  }
                >
                  <ReadonlyBooleanField label={t("agentConfig.agent.delegable")} value={() => currentAgentDraft()!.delegable} help={t("agentConfig.agent.delegableDesc")} />
                </Show>
                <Show
                  when={currentAgentReadOnly()}
                  fallback={
                    <label class="field-label agent-config-toggle">
                      <input
                        type="checkbox"
                        checked={currentAgentDraft()!.taskflow_eligible}
                        onChange={(e) => updateAgentField("taskflow_eligible", e.currentTarget.checked)}
                      />
                      <span>{t("agentConfig.agent.taskflowEligible")}</span>
                      <small class="field-help">{t("agentConfig.agent.taskflowEligibleDesc")}</small>
                    </label>
                  }
                >
                  <ReadonlyBooleanField label={t("agentConfig.agent.taskflowEligible")} value={() => currentAgentDraft()!.taskflow_eligible} help={t("agentConfig.agent.taskflowEligibleDesc")} />
                </Show>

                <Show
                  when={currentAgentReadOnly()}
                  fallback={
                    <label class="field-label"><span>{t("agentConfig.agent.runtimeProfile")}</span>
                      <select value={currentAgentDraft()!.runtime_profile} onChange={(e) => updateAgentField("runtime_profile", e.currentTarget.value)}>
                        <Show when={profileIdList().length === 0 || !currentAgentDraft()!.runtime_profile}>
                          <option value="" disabled>{t("agentConfig.agent.runtimeProfile.required")}</option>
                        </Show>
                        <For each={profileIdList()}>{(pid) => <option value={pid}>{pid}</option>}</For>
                      </select>
                      <small class="field-help">{t("agentConfig.agent.runtimeProfileDesc")}</small>
                    </label>
                  }
                >
                  <ReadonlyField label={t("agentConfig.agent.runtimeProfile")} value={() => currentAgentDraft()!.runtime_profile} help={t("agentConfig.agent.runtimeProfileDesc")} />
                </Show>
                <label class="field-label"><span>{selectedAgentId() === "capability_packager" ? "能力包生成使用的模型" : t("agentConfig.agent.model")}</span>
                  <select value={currentAgentDraft()!.modelKey} onChange={(e) => updateAgentField("modelKey", e.currentTarget.value)}>
                    <option value="">{t("agentConfig.agent.model.none")}</option>
                    <For each={runtimeModelOptions()}>{(option) => (
                      <option value={option.value}>{option.label} · {option.detail}</option>
                    )}</For>
                  </select>
                  <small class="field-help">
                    {runtimeModelOptions().length > 0 ? t("agentConfig.agent.model.help") : t("agentConfig.agent.model.empty")}
                  </small>
                </label>
                <Show
                  when={currentAgentReadOnly()}
                  fallback={
                    <label class="field-label"><span>{t("agentConfig.agent.maxConcurrentTasks")}</span>
                      <input type="number" min="1" step="1" value={currentAgentDraft()!.max_concurrent_tasks} onInput={(e) => updateAgentField("max_concurrent_tasks", Math.max(1, Math.floor(Number(e.currentTarget.value) || 1)))} />
                      <small class="field-help">{t("agentConfig.agent.maxConcurrentTasksDesc")}</small>
                    </label>
                  }
                >
                  <ReadonlyField label={t("agentConfig.agent.maxConcurrentTasks")} value={() => currentAgentDraft()!.max_concurrent_tasks} help={t("agentConfig.agent.maxConcurrentTasksDesc")} />
                </Show>
                <Show
                  when={currentAgentReadOnly()}
                  fallback={
                    <label class="field-label field-label--full"><span>{t("agentConfig.agent.dispatchProfile")}</span>
                      <textarea rows={5} value={currentAgentDraft()!.dispatchProfileText} onInput={(e) => updateAgentField("dispatchProfileText", e.currentTarget.value)} />
                      <small class="field-help">{t("agentConfig.agent.dispatchProfileDesc")}</small>
                    </label>
                  }
                >
                  <ReadonlyField label={t("agentConfig.agent.dispatchProfile")} value={() => currentAgentDraft()!.dispatchProfileText} help={t("agentConfig.agent.dispatchProfileDesc")} full multiline />
                </Show>
                <Show
                  when={currentAgentReadOnly()}
                  fallback={
                    <label class="field-label field-label--full"><span>{t("agentConfig.agent.dispatchExamples")}</span>
                      <textarea rows={4} value={currentAgentDraft()!.dispatchExamplesText} onInput={(e) => updateAgentField("dispatchExamplesText", e.currentTarget.value)} />
                      <small class="field-help">{t("agentConfig.agent.dispatchExamplesDesc")}</small>
                    </label>
                  }
                >
                  <ReadonlyField label={t("agentConfig.agent.dispatchExamples")} value={() => currentAgentDraft()!.dispatchExamplesText} help={t("agentConfig.agent.dispatchExamplesDesc")} full multiline />
                </Show>
                <Show
                  when={currentAgentReadOnly()}
                  fallback={
                    <label class="field-label field-label--full"><span>{t("agentConfig.agent.dispatchAvoid")}</span>
                      <textarea rows={3} value={currentAgentDraft()!.dispatchAvoidText} onInput={(e) => updateAgentField("dispatchAvoidText", e.currentTarget.value)} />
                      <small class="field-help">{t("agentConfig.agent.dispatchAvoidDesc")}</small>
                    </label>
                  }
                >
                  <ReadonlyField label={t("agentConfig.agent.dispatchAvoid")} value={() => currentAgentDraft()!.dispatchAvoidText} help={t("agentConfig.agent.dispatchAvoidDesc")} full multiline />
                </Show>
                <Show
                  when={currentAgentReadOnly()}
                  fallback={
                    <label class="field-label field-label--full"><span>{t("agentConfig.agent.systemAppend")}</span>
                      <textarea rows={4} value={currentAgentDraft()!.systemAppend} onInput={(e) => updateAgentField("systemAppend", e.currentTarget.value)} />
                      <small class="field-help">{t("agentConfig.agent.systemAppendDesc")}</small>
                    </label>
                  }
                >
                  <ReadonlyField label={t("agentConfig.agent.systemAppend")} value={() => currentAgentDraft()!.systemAppend} help={t("agentConfig.agent.systemAppendDesc")} full multiline />
                </Show>
                <Show
                  when={currentAgentReadOnly()}
                  fallback={
                    <label class="field-label field-label--full"><span>{t("agentConfig.agent.capabilityRefs")}</span>
                      <ChoiceMultiSelect
                        ariaLabel={t("agentConfig.agent.capabilityRefs")}
                        options={capabilityChoiceOptions()}
                        valueText={currentAgentDraft()!.capabilityRefsText}
                        delimiter=", "
                        onChangeText={(next) => updateAgentField("capabilityRefsText", formatAgentConfigList(parseAgentConfigListText(next), ", "))}
                        emptyMessage={t("agentConfig.agent.capabilityRefs.empty")}
                        searchPlaceholder="搜索能力包"
                        unknownLabel={t("agentConfig.choice.custom")}
                      />
                      <small class="field-help">{t("agentConfig.agent.capabilityRefsDesc")}</small>
                    </label>
                  }
                >
                  <ReadonlyField label={t("agentConfig.agent.capabilityRefs")} value={() => currentAgentDraft()!.capabilityRefsText} help={t("agentConfig.agent.capabilityRefsDesc")} full />
                </Show>
                <Show when={selectedAgentCapabilityPackages().length > 0}>
                  <div class="settings-detail-section field-label--full">
                    <span>{t("agentConfig.agent.capabilityPackagesPreview")}</span>
                    <For each={selectedAgentCapabilityPackages()}>{(pkg) => (
                      <div class="settings-detail-block">
                        <strong>{pkg.name || pkg.id}</strong>
                        <small>{pkg.description || pkg.id}</small>
                        {renderCapabilityGroup("提供的能力", capabilityPackageComponentGroups(pkg.components).capabilities, "未声明 MCP Server 或 Skill。")}
                        {renderCapabilityGroup("所需能力依赖", capabilityPackageComponentGroups(pkg.components).dependencies, "未声明能力依赖。")}
                      </div>
                    )}</For>
                  </div>
                </Show>
                <details class="settings-details settings-details--embedded field-label--full">
                  <summary>
                    <span class="codicon codicon-settings-gear" aria-hidden="true" />
                    {t("agentConfig.advanced")}
                  </summary>
                  <div class="settings-form-grid">
                    <Show
                      when={currentAgentReadOnly()}
                      fallback={
                        <label class="field-label field-label--full"><span>{t("agentConfig.agent.credentialRefs")}</span>
                          <textarea rows={3} value={currentAgentDraft()!.credentialRefsText} onInput={(e) => updateAgentField("credentialRefsText", e.currentTarget.value)} placeholder={t("agentConfig.agent.credentialRefsPlaceholder")} />
                          <small class="field-help">{t("agentConfig.agent.credentialRefsDesc")}</small>
                        </label>
                      }
                    >
                      <ReadonlyField label={t("agentConfig.agent.credentialRefs")} value={() => currentAgentDraft()!.credentialRefsText} help={t("agentConfig.agent.credentialRefsDesc")} full multiline />
                    </Show>
                    <Show
                      when={currentAgentReadOnly()}
                      fallback={
                        <label class="field-label field-label--full"><span>{t("agentConfig.agent.systemFlowOnly")}</span>
                          <textarea rows={3} value={currentAgentDraft()!.systemFlowOnlyText} onInput={(e) => updateAgentField("systemFlowOnlyText", e.currentTarget.value)} />
                          <small class="field-help">{t("agentConfig.agent.systemFlowOnlyDesc")}</small>
                        </label>
                      }
                    >
                      <ReadonlyField label={t("agentConfig.agent.systemFlowOnly")} value={() => currentAgentDraft()!.systemFlowOnlyText} help={t("agentConfig.agent.systemFlowOnlyDesc")} full multiline />
                    </Show>
                  </div>
                </details>
              </div>
            </Show>
          </div>
        </div>
      </section>

      <section class="settings-section settings-section--flat" classList={{ "settings-section--hidden": section() !== "runtimeTest" }}>
        <div class="settings-section-heading">
          <span>{t("agentConfig.runtimeTest.title")}</span>
          <StatusBadge tone={agentRunPolling() ? "warning" : agentRunTerminal() ? "success" : "muted"}>
            {selectedAgentRunId() || t("agentConfig.runtimeTest.idle")}
          </StatusBadge>
        </div>
        <div class="settings-form-grid">
          <label class="field-label field-label--full"><span>{t("agentConfig.runtimeTest.prompt")}</span>
            <textarea rows={4} value={agentRunPrompt()} onInput={(e) => setAgentRunPrompt(e.currentTarget.value)} />
          </label>
          <div class="settings-actions settings-actions--left field-label--full">
            <button class="btn btn-primary" onClick={submitAgentRunTest} disabled={agentRunSubmitting() || !selectedAgentId()}>
              <span class="codicon codicon-play" aria-hidden="true" />
              {agentRunSubmitting() ? t("agentConfig.runtimeTest.submitting") : t("agentConfig.runtimeTest.submit")}
            </button>
            <button class="btn btn-secondary" onClick={cancelAgentRunTest} disabled={!selectedAgentRunId() || agentRunTerminal() || agentRunSubmitting()}>
              <span class="codicon codicon-debug-stop" aria-hidden="true" />
              {t("agentConfig.runtimeTest.cancel")}
            </button>
            <RefreshButton
              class="btn-secondary"
              onClick={() => retryAgentRunTest(false)}
              disabled={!selectedAgentRunId() || agentRunSubmitting()}
              loading={agentRunSubmitting()}
              loadingLabel={t("agentConfig.runtimeTest.submitting")}
            >
              {t("agentConfig.runtimeTest.retryFresh")}
            </RefreshButton>
            <Show when={agentRunCanResume()} fallback={
              <Show when={selectedAgentRunId()}>
                <StatusBadge tone="muted">{t("agentConfig.runtimeTest.freshOnly")}</StatusBadge>
              </Show>
            }>
              <button class="btn btn-secondary" onClick={() => retryAgentRunTest(true)} disabled={agentRunSubmitting()}>
                <span class="codicon codicon-history" aria-hidden="true" />
                {t("agentConfig.runtimeTest.retryResume")}
              </button>
            </Show>
          </div>
        </div>
        <Show when={agentRunError()}>
          <div class="settings-error">{agentRunError()}</div>
        </Show>
        <Show when={agentRun()}>
          <pre class="settings-result">{JSON.stringify(agentRun(), null, 2)}</pre>
        </Show>
        <div class="runtime-event-list">
          <Show when={agentRunEvents().length > 0} fallback={<p class="settings-empty-note">{t("agentConfig.runtimeTest.noEvents")}</p>}>
            <For each={agentRunEvents()}>
              {(event) => (
                <div class="runtime-event">
                  <span class="runtime-event__seq">#{String(numberValue(event.seq, 0))}</span>
                  <strong>{stringValue(event.type)}</strong>
                  <code>{JSON.stringify(objectValue(event.payload))}</code>
                </div>
              )}
            </For>
          </Show>
        </div>
      </section>
    </SettingsPage>
  )


}
