import { Component, For, Show } from "solid-js"
import { t } from "../../i18n"
import { SelectableList } from "../../components/common/interaction"
import { StatusBadge } from "../components/StatusBadge"
import type { SettingsController } from "../useSettingsController"

interface TabProps { controller: SettingsController & Record<string, any> }

export const AgentConfigTab: Component<TabProps> = (props) => {
  const {
    refreshServerSettings,
    saveAgentConfig,
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
    selectedProfileExecutorCapability,
    renameProfile,
    updateProfileField,
    setProfileExecutorSelect,
    PROFILE_EXECUTOR_OPTIONS,
    PROFILE_EXECUTION_LOCATION_OPTIONS,
    PROFILE_HOME_POLICY_OPTIONS,
    PROFILE_APPROVAL_MODE_OPTIONS,
    PROFILE_CONFIG_ISOLATION_OPTIONS,
    runtimeModelOptions,
    renderRuntimeChoiceList,
    registeredMcpServers,
    profileMcpValidationWarnings,
    renderStringChoiceList,
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
    AGENT_CAPABILITY_OPTIONS,
    agentMcpValidationWarnings,
    skillNameOptions,
    formatAgentConfigList,
    parseAgentConfigListText,
    runtimePolling,
    runtimeTerminal,
    runtimeTaskCanResume,
    selectedRuntimeTaskId,
    runtimePrompt,
    setRuntimePrompt,
    submitRuntimeAgentTask,
    runtimeSubmitting,
    cancelRuntimeAgentTask,
    retryRuntimeAgentTask,
    runtimeError,
    runtimeTask,
    runtimeEvents,
    numberValue,
    stringValue,
    objectValue,
    runtimeOptionDescription,
  } = props.controller

  const profileIds = () => Object.keys(profileDrafts())
  const agentIds = () => Object.keys(agentDrafts())

  return (
    <div class="settings-page">
      <div class="settings-page-header">
        <div>
          <h2>{t("agentConfig.title")}</h2>
          <p>{t("agentConfig.desc")}</p>
        </div>
        <div class="settings-actions settings-actions--right">
          <button class="btn btn-secondary" onClick={refreshServerSettings}>
            <span class="codicon codicon-refresh" aria-hidden="true" />
            刷新
          </button>
          <button class="btn btn-primary" onClick={saveAgentConfig} disabled={!agentConfigDirty() || agentConfigSavePending()}>
            <span class="codicon codicon-save" aria-hidden="true" />
            {agentConfigSavePending() ? t("agentConfig.saving") : t("agentConfig.save")}
          </button>
        </div>
      </div>

      <Show when={server.serverSettingsError()}>
        <div class="settings-error">{server.serverSettingsError()}</div>
      </Show>
      <Show when={agentConfigError()}>
        <div class="settings-error">{agentConfigError()}</div>
      </Show>
      <Show when={agentConfigSaved()}>
        <div class="settings-success">{t("agentConfig.saved")}</div>
      </Show>

      {/* ── Runtime Profiles Section ── */}
      <section class="settings-section settings-section--flat">
        <div class="settings-section-heading">
          <span>{t("agentConfig.profiles")}</span>
          <StatusBadge tone="muted">{String(Object.keys(profileDrafts()).length)}</StatusBadge>
        </div>
        <p class="settings-empty-note">{t("agentConfig.profiles.desc")}</p>
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
                <Show when={selectedProfileExecutorCapability()}>
                  <div class="executor-capability-panel field-label--full">
                    <div class="executor-capability-panel__header">
                      <strong>{t("agentConfig.profile.executorCapability")}</strong>
                      <span>{currentProfileDraft()!.executor}</span>
                    </div>
                    <div class="settings-badge-group">
                      <StatusBadge tone={selectedProfileExecutorCapability()!.installed ? "success" : "error"}>
                        {selectedProfileExecutorCapability()!.installed ? t("agentConfig.profile.capability.installed") : t("agentConfig.profile.capability.missing")}
                      </StatusBadge>
                      <Show when={selectedProfileExecutorCapability()!.version}>
                        <StatusBadge>{selectedProfileExecutorCapability()!.version}</StatusBadge>
                      </Show>
                      <StatusBadge tone={selectedProfileExecutorCapability()!.streamJson ? "success" : "muted"}>{t("agentConfig.profile.capability.streamJson")}</StatusBadge>
                      <StatusBadge tone={selectedProfileExecutorCapability()!.sessionDiscovery ? "success" : "muted"}>{t("agentConfig.profile.capability.sessionDiscovery")}</StatusBadge>
                      <StatusBadge tone={selectedProfileExecutorCapability()!.resumeById ? "success" : "muted"}>{t("agentConfig.profile.capability.resume")}</StatusBadge>
                      <StatusBadge tone={selectedProfileExecutorCapability()!.mcpConfig ? "success" : "muted"}>{t("agentConfig.profile.capability.mcp")}</StatusBadge>
                      <Show when={selectedProfileExecutorCapability()!.runtimeHomeIsolation}>
                        <StatusBadge>{selectedProfileExecutorCapability()!.runtimeHomeIsolation}</StatusBadge>
                      </Show>
                    </div>
                    <Show when={selectedProfileExecutorCapability()!.limitations.length > 0}>
                      <small>{t("agentConfig.profile.capability.limitations")}: {selectedProfileExecutorCapability()!.limitations.join("; ")}</small>
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
                  {renderStringChoiceList(
                    registeredMcpServers(),
                    currentProfileDraft()!.mcpServersText,
                    (next) => updateProfileField("mcpServersText", next),
                    t("agentConfig.profile.mcpServers.empty"),
                  )}
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

      {/* ── Agents Section ── */}
      <section class="settings-section settings-section--flat">
        <div class="settings-section-heading">
          <span>{t("agentConfig.agents")}</span>
          <StatusBadge tone="muted">{String(Object.keys(agentDrafts()).length)}</StatusBadge>
        </div>
        <p class="settings-empty-note">{t("agentConfig.agents.desc")}</p>
        <div class="settings-master-detail">
          <div class="settings-master-list">
            <div class="settings-master-actions">
              <button class="btn btn-secondary" onClick={addAgent}>
                <span class="codicon codicon-add" aria-hidden="true" />
                {t("agentConfig.agent.add")}
              </button>
            </div>
            <Show when={Object.keys(agentDrafts()).length === 0}>
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
                <label class="field-label field-label--full"><span>{t("agentConfig.agent.capabilities")}</span>
                  {renderRuntimeChoiceList(
                    AGENT_CAPABILITY_OPTIONS,
                    currentAgentDraft()!.capabilitiesText,
                    (next) => updateAgentField("capabilitiesText", next),
                    ", ",
                  )}
                  <small class="field-help">{t("agentConfig.agent.capabilitiesDesc")}</small>
                </label>
                <label class="field-label field-label--full"><span>{t("agentConfig.agent.systemAppend")}</span>
                  <textarea rows={4} value={currentAgentDraft()!.systemAppend} onInput={(e) => updateAgentField("systemAppend", e.currentTarget.value)} />
                  <small class="field-help">{t("agentConfig.agent.systemAppendDesc")}</small>
                </label>
                <label class="field-label field-label--full"><span>{t("agentConfig.agent.mcpServers")}</span>
                  {renderStringChoiceList(
                    registeredMcpServers(),
                    currentAgentDraft()!.mcpServersText,
                    (next) => updateAgentField("mcpServersText", next),
                    t("agentConfig.profile.mcpServers.empty"),
                  )}
                  <small class="field-help">{t("agentConfig.agent.mcpServersDesc")}</small>
                </label>
                <Show when={agentMcpValidationWarnings().length > 0}>
                  <div class="settings-warning">
                    <span class="codicon codicon-warning" aria-hidden="true" />
                    <span>{t("agentConfig.profile.mcpNotRegistered")}: {agentMcpValidationWarnings().join(", ")}</span>
                  </div>
                </Show>
                <label class="field-label field-label--full"><span>{t("agentConfig.agent.skills")}</span>
                  {renderStringChoiceList(
                    skillNameOptions(),
                    currentAgentDraft()!.skillsText,
                    (next) => updateAgentField("skillsText", formatAgentConfigList(parseAgentConfigListText(next), ", ")),
                    t("agentConfig.agent.skills.empty"),
                    ", ",
                  )}
                  <small class="field-help">{t("agentConfig.agent.skillsDesc")}</small>
                </label>
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
                  </div>
                </details>
              </div>
            </Show>
          </div>
        </div>
      </section>

      <section class="settings-section settings-section--flat">
        <div class="settings-section-heading">
          <span>{t("agentConfig.runtimeTest.title")}</span>
          <StatusBadge tone={runtimePolling() ? "warning" : runtimeTerminal() ? "success" : "muted"}>
            {selectedRuntimeTaskId() || t("agentConfig.runtimeTest.idle")}
          </StatusBadge>
        </div>
        <p class="settings-empty-note">{t("agentConfig.runtimeTest.desc")}</p>
        <div class="settings-form-grid">
          <label class="field-label field-label--full"><span>{t("agentConfig.runtimeTest.prompt")}</span>
            <textarea rows={4} value={runtimePrompt()} onInput={(e) => setRuntimePrompt(e.currentTarget.value)} />
          </label>
          <div class="settings-actions settings-actions--left field-label--full">
            <button class="btn btn-primary" onClick={submitRuntimeAgentTask} disabled={runtimeSubmitting() || !selectedAgentId()}>
              <span class="codicon codicon-play" aria-hidden="true" />
              {runtimeSubmitting() ? t("agentConfig.runtimeTest.submitting") : t("agentConfig.runtimeTest.submit")}
            </button>
            <button class="btn btn-secondary" onClick={cancelRuntimeAgentTask} disabled={!selectedRuntimeTaskId() || runtimeTerminal()}>
              <span class="codicon codicon-debug-stop" aria-hidden="true" />
              {t("agentConfig.runtimeTest.cancel")}
            </button>
            <button class="btn btn-secondary" onClick={() => retryRuntimeAgentTask(false)} disabled={!selectedRuntimeTaskId() || runtimeSubmitting()}>
              <span class="codicon codicon-refresh" aria-hidden="true" />
              {t("agentConfig.runtimeTest.retryFresh")}
            </button>
            <Show when={runtimeTaskCanResume()} fallback={
              <Show when={selectedRuntimeTaskId()}>
                <StatusBadge tone="muted">{t("agentConfig.runtimeTest.freshOnly")}</StatusBadge>
              </Show>
            }>
              <button class="btn btn-secondary" onClick={() => retryRuntimeAgentTask(true)} disabled={runtimeSubmitting()}>
                <span class="codicon codicon-history" aria-hidden="true" />
                {t("agentConfig.runtimeTest.retryResume")}
              </button>
            </Show>
          </div>
        </div>
        <Show when={runtimeError()}>
          <div class="settings-error">{runtimeError()}</div>
        </Show>
        <Show when={runtimeTask()}>
          <pre class="settings-result">{JSON.stringify(runtimeTask(), null, 2)}</pre>
        </Show>
        <div class="runtime-event-list">
          <Show when={runtimeEvents().length > 0} fallback={<p class="settings-empty-note">{t("agentConfig.runtimeTest.noEvents")}</p>}>
            <For each={runtimeEvents()}>
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
