import { Component, For, Show, createSignal } from "solid-js"
import { t } from "../../i18n"
import { RefreshButton } from "../../components/common/RefreshButton"
import { SelectableList } from "../../components/common/interaction"
import { StatusBadge } from "../components/StatusBadge"
import { ChoiceMultiSelect } from "../components/ChoiceMultiSelect"
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
  const agentIds = () => Object.keys(agentDrafts()).filter((id) => agentDrafts()[id]?.visibility === "user")
  const systemAgentIds = () => Object.keys(agentDrafts()).filter((id) => agentDrafts()[id]?.visibility !== "user")
  const mcpChoiceOptions = () => registeredMcpServers().map((id: string) => ({ id, label: id, kind: "MCP" }))
  const capabilityChoiceOptions = () => capabilityPackageOptions().map((id: string) => ({ id, label: id, kind: "能力包" }))
  const renderCapabilityGroup = (label: string, items: any[], empty: string) => (
    <div class="toolchain-detail-section">
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
    <div class="settings-page">
      <div class="settings-page-header">
        <div>
          <h2>{t("agentConfig.title")}</h2>
        </div>
        <div class="settings-actions settings-actions--right">
          <RefreshButton class="btn-secondary" loading={props.controller.pageRefreshing("agentConfig")} onClick={refreshServerSettings}>
            刷新
          </RefreshButton>
          <button class="btn btn-primary" onClick={saveAgentConfig} disabled={!agentConfigDirty() || serverSettingsSaveBusy()}>
            <span class="codicon codicon-save" aria-hidden="true" />
            {agentConfigSavePending() ? t("agentConfig.saving") : t("agentConfig.save")}
          </button>
        </div>
      </div>

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
      <nav class="settings-subtabs" aria-label={t("agentConfig.title")}>
        <For each={AGENT_CONFIG_SECTIONS}>
          {(item) => (
            <button
              type="button"
              class={`settings-subtab-button ${section() === item.id ? "settings-subtab-button--active" : ""}`}
              aria-pressed={section() === item.id}
              onClick={() => setSection(item.id)}
            >
              <span class={`codicon codicon-${item.icon}`} aria-hidden="true" />
              {t(item.labelKey)}
            </button>
          )}
        </For>
      </nav>

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
                  <small>{agentDrafts()[aid]?.runtime_profile || "—"}</small>
                </div>
              )}
              renderAction={(aid) => (
                <button class="btn-icon" type="button" onClick={() => deleteAgent(aid)} title={t("agentConfig.agent.delete")} aria-label={t("agentConfig.agent.delete")}>
                  <span class="codicon codicon-trash" aria-hidden="true" />
                </button>
              )}
            />
            <Show when={systemAgentIds().length > 0}>
              <div class="settings-system-agent-list">
                <small>{t("agentConfig.agent.systemAgents")}</small>
                <For each={systemAgentIds()}>
                  {(aid) => (
                    <div class="settings-system-agent">
                      <strong>{agentDrafts()[aid]?.name || aid}</strong>
                      <span>{agentDrafts()[aid]?.visibility}</span>
                    </div>
                  )}
                </For>
              </div>
            </Show>
          </div>
          <div class="settings-detail-panel">
            <Show when={currentAgentDraft()} fallback={<p class="settings-empty-note">{t("agentConfig.agent.noSelection")}</p>}>
              <div class="settings-form-grid">
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
                <label class="field-label"><span>{t("agentConfig.agent.name")}</span>
                  <input ref={setAgentNameInput} value={currentAgentDraft()!.name} onInput={(e) => updateAgentField("name", e.currentTarget.value)} />
                </label>
                <label class="field-label"><span>{t("agentConfig.agent.description")}</span>
                  <input value={currentAgentDraft()!.description} onInput={(e) => updateAgentField("description", e.currentTarget.value)} />
                </label>
                <label class="field-label"><span>{t("agentConfig.agent.role")}</span>
                  <select value={currentAgentDraft()!.role} onChange={(e) => updateAgentField("role", e.currentTarget.value)}>
                    <option value="coordinator">{t("agentConfig.agent.role.coordinator")}</option>
                    <option value="worker">{t("agentConfig.agent.role.worker")}</option>
                    <option value="reviewer">{t("agentConfig.agent.role.reviewer")}</option>
                    <option value="environment">{t("agentConfig.agent.role.environment")}</option>
                  </select>
                  <small class="field-help">{t("agentConfig.agent.roleDesc")}</small>
                </label>
                <label class="field-label agent-config-toggle">
                  <input
                    type="checkbox"
                    checked={currentAgentDraft()!.chat_entrypoint}
                    onChange={(e) => updateAgentField("chat_entrypoint", e.currentTarget.checked)}
                  />
                  <span>{t("agentConfig.agent.entrypoint")}</span>
                  <small class="field-help">{t("agentConfig.agent.entrypointDesc")}</small>
                </label>
                <label class="field-label agent-config-toggle">
                  <input
                    type="checkbox"
                    checked={currentAgentDraft()!.delegable}
                    onChange={(e) => updateAgentField("delegable", e.currentTarget.checked)}
                  />
                  <span>{t("agentConfig.agent.delegable")}</span>
                  <small class="field-help">{t("agentConfig.agent.delegableDesc")}</small>
                </label>
                <label class="field-label agent-config-toggle">
                  <input
                    type="checkbox"
                    checked={currentAgentDraft()!.taskflow_eligible}
                    onChange={(e) => updateAgentField("taskflow_eligible", e.currentTarget.checked)}
                  />
                  <span>{t("agentConfig.agent.taskflowEligible")}</span>
                  <small class="field-help">{t("agentConfig.agent.taskflowEligibleDesc")}</small>
                </label>

                <label class="field-label"><span>{t("agentConfig.agent.runtimeProfile")}</span>
                  <select value={currentAgentDraft()!.runtime_profile} onChange={(e) => updateAgentField("runtime_profile", e.currentTarget.value)}>
                    <option value="">{t("agentConfig.agent.runtimeProfile.none")}</option>
                    <For each={profileIdList()}>{(pid) => <option value={pid}>{pid}</option>}</For>
                  </select>
                  <small class="field-help">{t("agentConfig.agent.runtimeProfileDesc")}</small>
                </label>
                <label class="field-label"><span>{t("agentConfig.agent.model")}</span>
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
                <label class="field-label"><span>{t("agentConfig.agent.maxConcurrentTasks")}</span>
                  <input type="number" min="1" step="1" value={currentAgentDraft()!.max_concurrent_tasks} onInput={(e) => updateAgentField("max_concurrent_tasks", Math.max(1, Math.floor(Number(e.currentTarget.value) || 1)))} />
                  <small class="field-help">{t("agentConfig.agent.maxConcurrentTasksDesc")}</small>
                </label>
                <label class="field-label field-label--full"><span>{t("agentConfig.agent.dispatchProfile")}</span>
                  <textarea rows={5} value={currentAgentDraft()!.dispatchProfileText} onInput={(e) => updateAgentField("dispatchProfileText", e.currentTarget.value)} />
                  <small class="field-help">{t("agentConfig.agent.dispatchProfileDesc")}</small>
                </label>
                <label class="field-label field-label--full"><span>{t("agentConfig.agent.dispatchExamples")}</span>
                  <textarea rows={4} value={currentAgentDraft()!.dispatchExamplesText} onInput={(e) => updateAgentField("dispatchExamplesText", e.currentTarget.value)} />
                  <small class="field-help">{t("agentConfig.agent.dispatchExamplesDesc")}</small>
                </label>
                <label class="field-label field-label--full"><span>{t("agentConfig.agent.dispatchAvoid")}</span>
                  <textarea rows={3} value={currentAgentDraft()!.dispatchAvoidText} onInput={(e) => updateAgentField("dispatchAvoidText", e.currentTarget.value)} />
                  <small class="field-help">{t("agentConfig.agent.dispatchAvoidDesc")}</small>
                </label>
                <label class="field-label field-label--full"><span>{t("agentConfig.agent.systemAppend")}</span>
                  <textarea rows={4} value={currentAgentDraft()!.systemAppend} onInput={(e) => updateAgentField("systemAppend", e.currentTarget.value)} />
                  <small class="field-help">{t("agentConfig.agent.systemAppendDesc")}</small>
                </label>
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
                <Show when={selectedAgentCapabilityPackages().length > 0}>
                  <div class="toolchain-detail-section field-label--full">
                    <span>{t("agentConfig.agent.capabilityPackagesPreview")}</span>
                    <For each={selectedAgentCapabilityPackages()}>{(pkg) => (
                      <div class="toolchain-detail-block">
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
                    <label class="field-label field-label--full"><span>{t("agentConfig.agent.credentialRefs")}</span>
                      <textarea rows={3} value={currentAgentDraft()!.credentialRefsText} onInput={(e) => updateAgentField("credentialRefsText", e.currentTarget.value)} placeholder={t("agentConfig.agent.credentialRefsPlaceholder")} />
                      <small class="field-help">{t("agentConfig.agent.credentialRefsDesc")}</small>
                    </label>
                    <label class="field-label field-label--full"><span>{t("agentConfig.agent.systemFlowOnly")}</span>
                      <textarea rows={3} value={currentAgentDraft()!.systemFlowOnlyText} onInput={(e) => updateAgentField("systemFlowOnlyText", e.currentTarget.value)} />
                      <small class="field-help">{t("agentConfig.agent.systemFlowOnlyDesc")}</small>
                    </label>
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
    </div>
  )


}
