import { Component, For, Show, createEffect, createMemo, createSignal } from "solid-js"
import { t, locale, LOCALES, type Locale } from "../../i18n"
import { RefreshButton } from "../../components/common/RefreshButton"
import { ChoiceMultiSelect } from "../components/ChoiceMultiSelect"
import { StatusBadge } from "../components/StatusBadge"
import type { SettingsController } from "../useSettingsController"

interface TabProps { controller: SettingsController & Record<string, any> }

interface ModeDraft {
  description: string
  toolsText: string
  promptAppend: string
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {}
}

function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => String(item).trim()).filter(Boolean)
    : []
}

function parseListText(value: string): string[] {
  return value
    .split(/[\n,]+/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function makeModeId(existing: string[]): string {
  let index = 1
  while (existing.includes(`custom_mode_${index}`)) index += 1
  return `custom_mode_${index}`
}

export const ConversationTab: Component<TabProps> = (props) => {
  const {
    operations,
    pageRefreshing,
    refreshPage,
    saveConversationSettings: saveConversationSettingsRequest,
    saveReasoningDisplay,
    updateChatSendDuringRunMode,
    setConversationLocale,
    registeredToolOptions,
    server,
  } = props.controller

  const [dirty, setDirty] = createSignal(false)
  const [saved, setSaved] = createSignal(false)
  const [activeMode, setActiveMode] = createSignal("")
  const [selectedMode, setSelectedMode] = createSignal("")
  const [modeDrafts, setModeDrafts] = createSignal<Record<string, ModeDraft>>({})
  const [globalSystemAppend, setGlobalSystemAppend] = createSignal("")

  const serverSettings = createMemo(() => {
    const direct = objectValue(server.serverSettingsState()?.settings)
    if (Object.keys(direct).length > 0) return direct
    return objectValue(server.adminState().server_settings)
  })
  const modeIds = createMemo(() => Object.keys(modeDrafts()).sort())
  const currentMode = createMemo(() => {
    const id = selectedMode()
    return id ? modeDrafts()[id] : undefined
  })
  const reasoningDefaultOpen = createMemo(() => server.reasoningDisplayState().defaultOpen === true)
  const sendDuringRunMode = createMemo(() =>
    stringValue(server.chatSendDuringRunModeState().mode) === "queue" ? "queue" : "guide"
  )

  const markDirty = () => {
    setDirty(true)
    setSaved(false)
  }

  const syncFromSettings = () => {
    const settings = serverSettings()
    const modes = objectValue(settings.modes)
    const prompt = objectValue(settings.prompt)
    const profiles = objectValue(modes.profiles)
    const nextModes: Record<string, ModeDraft> = {}
    for (const [id, item] of Object.entries(profiles)) {
      const mode = objectValue(item)
      nextModes[id] = {
        description: stringValue(mode.description),
        toolsText: stringArray(mode.tools).join("\n"),
        promptAppend: stringValue(mode.prompt_append),
      }
    }
    setActiveMode(stringValue(modes.active))
    setModeDrafts(nextModes)
    setSelectedMode((current) => current && nextModes[current] ? current : Object.keys(nextModes).sort()[0] || "")
    setGlobalSystemAppend(stringValue(prompt.system_append))
  }

  createEffect(() => {
    if (dirty()) return
    syncFromSettings()
  })

  createEffect(() => {
    const ids = modeIds()
    if (!selectedMode() && ids.length) setSelectedMode(ids[0])
    if (selectedMode() && !ids.includes(selectedMode())) setSelectedMode(ids[0] || "")
  })

  const updateReasoningDefaultOpen = (defaultOpen: boolean) => {
    saveReasoningDisplay(defaultOpen)
  }

  const updateSendDuringRunMode = (mode: "guide" | "queue") => {
    updateChatSendDuringRunMode(mode)
  }

  const updateMode = (patch: Partial<ModeDraft>) => {
    const id = selectedMode()
    if (!id) return
    setModeDrafts((current) => ({
      ...current,
      [id]: { ...current[id], ...patch },
    }))
    markDirty()
  }

  const renameMode = (nextId: string) => {
    const oldId = selectedMode()
    const id = nextId.trim()
    if (!oldId || !id || id === oldId || modeDrafts()[id]) return
    setModeDrafts((current) => {
      const next = { ...current, [id]: current[oldId] }
      delete next[oldId]
      return next
    })
    if (activeMode() === oldId) setActiveMode(id)
    setSelectedMode(id)
    markDirty()
  }

  const addMode = () => {
    const id = makeModeId(modeIds())
    setModeDrafts((current) => ({
      ...current,
      [id]: { description: "", toolsText: "", promptAppend: "" },
    }))
    setSelectedMode(id)
    if (!activeMode()) setActiveMode(id)
    markDirty()
  }

  const deleteMode = (id: string) => {
    const ids = modeIds()
    if (ids.length <= 1) return
    setModeDrafts((current) => {
      const next = { ...current }
      delete next[id]
      return next
    })
    if (activeMode() === id) setActiveMode(ids.find((item) => item !== id) || "")
    if (selectedMode() === id) setSelectedMode(ids.find((item) => item !== id) || "")
    markDirty()
  }

  const saveConversationSettings = () => {
    const profiles: Record<string, unknown> = {}
    for (const [id, draft] of Object.entries(modeDrafts())) {
      profiles[id] = {
        description: draft.description,
        tools: parseListText(draft.toolsText),
        prompt_append: draft.promptAppend,
      }
    }
    const active = activeMode() && profiles[activeMode()]
      ? activeMode()
      : Object.keys(profiles)[0]
    saveConversationSettingsRequest({
      settings: {
        modes: { active, profiles },
        prompt: { system_append: globalSystemAppend() },
      },
    })
    setDirty(false)
    setSaved(true)
  }

  return (
    <div class="settings-page settings-page--wide">
      <div class="settings-page-header">
        <div>
          <h2>{t("conversation.title")}</h2>
          <p class="setting-description">{t("conversation.desc")}</p>
        </div>
        <div class="settings-actions settings-actions--right">
          <RefreshButton
            class="btn-secondary"
            loading={pageRefreshing("conversation")}
            onClick={() => refreshPage("conversation")}
          >
            {t("common.refresh")}
          </RefreshButton>
          <button class="btn btn-primary" type="button" disabled={!dirty() || props.controller.serverSettingsSaveBusy()} onClick={saveConversationSettings}>
            <span class="codicon codicon-save" aria-hidden="true" />
            {t("common.save")}
          </button>
        </div>
      </div>

      <Show when={operations.error("conversationSave") || operations.error("serverSettings")}>
        <div class="settings-error">{operations.error("conversationSave") || operations.error("serverSettings")}</div>
      </Show>
      <Show when={operations.state("conversationSave").status === "success" && !dirty()}>
        <div class="settings-success">{t("conversation.saved")}</div>
      </Show>

      <section class="settings-section settings-section--plain language-section">
        <div class="settings-section-heading">
          <span class="codicon codicon-globe" aria-hidden="true" />
          <span>{t("conversation.language")}</span>
        </div>
        <div class="language-picker">
          <For each={LOCALES as unknown as { id: string; label: string; nativeLabel: string }[]}>
            {(loc) => (
              <button
                type="button"
                class={`language-option ${locale() === loc.id ? "language-option--active" : ""}`}
                onClick={() => setConversationLocale(loc.id as Locale)}
              >
                <span class="language-option__native">{loc.nativeLabel}</span>
                <span class="language-option__label">{loc.label}</span>
                <Show when={locale() === loc.id}>
                  <span class="codicon codicon-check" aria-hidden="true" />
                </Show>
              </button>
            )}
          </For>
        </div>
        <p class="settings-empty-note">{t("conversation.languageDesc")}</p>
      </section>

      <section class="settings-section settings-section--plain send-during-run-section">
        <div class="settings-section-heading">
          <span class="codicon codicon-comment-discussion" aria-hidden="true" />
          <span>{t("conversation.sendDuringRun.title")}</span>
        </div>
        <div class="provider-segmented-list" role="group" aria-label={t("conversation.sendDuringRun.title")}>
          <button
            type="button"
            class={`provider-segmented-choice ${sendDuringRunMode() === "guide" ? "provider-segmented-choice--active" : ""}`}
            onClick={() => updateSendDuringRunMode("guide")}
          >
            {t("conversation.sendDuringRun.guide")}
          </button>
          <button
            type="button"
            class={`provider-segmented-choice ${sendDuringRunMode() === "queue" ? "provider-segmented-choice--active" : ""}`}
            onClick={() => updateSendDuringRunMode("queue")}
          >
            {t("conversation.sendDuringRun.queue")}
          </button>
        </div>
        <p class="settings-empty-note">{t("conversation.sendDuringRun.desc")}</p>
      </section>

      <section class="settings-section settings-section--plain reasoning-display-section">
        <div class="settings-section-heading">
          <span class="codicon codicon-comment-discussion" aria-hidden="true" />
          <span>{t("conversation.reasoning.title")}</span>
        </div>
        <label class="field-label field-label--checkbox">
          <input
            type="checkbox"
            checked={reasoningDefaultOpen()}
            onChange={(event) => updateReasoningDefaultOpen(event.currentTarget.checked)}
          />
          <span>{t("conversation.reasoning.defaultOpen")}</span>
        </label>
        <p class="settings-empty-note">{t("conversation.reasoning.desc")}</p>
      </section>

      <section class="settings-section settings-section--flat">
        <div class="settings-section-heading">
          <span>{t("conversation.modes.title")}</span>
          <button class="btn btn-secondary" type="button" onClick={addMode}>
            <span class="codicon codicon-add" aria-hidden="true" />
            {t("conversation.modes.add")}
          </button>
        </div>
        <div class="settings-two-column">
          <div class="settings-list">
            <For each={modeIds()}>
              {(id) => (
                <button type="button" class={`settings-list-item ${selectedMode() === id ? "settings-list-item--active" : ""}`} onClick={() => setSelectedMode(id)}>
                  <span>{id}</span>
                  <Show when={activeMode() === id}><StatusBadge>{t("conversation.modes.active")}</StatusBadge></Show>
                </button>
              )}
            </For>
          </div>
          <Show when={currentMode()} fallback={<p class="settings-empty-note">{t("conversation.modes.empty")}</p>}>
            {(mode) => (
              <div class="settings-form-grid">
                <label class="field-label"><span>{t("conversation.modes.id")}</span>
                  <input value={selectedMode()} onChange={(event) => renameMode(event.currentTarget.value)} />
                </label>
                <label class="field-label field-label--checkbox">
                  <input type="checkbox" checked={activeMode() === selectedMode()} onChange={(event) => { if (event.currentTarget.checked) { setActiveMode(selectedMode()); markDirty() } }} />
                  <span>{t("conversation.modes.setActive")}</span>
                </label>
                <label class="field-label field-label--full"><span>{t("conversation.modes.description")}</span>
                  <input value={mode().description} onInput={(event) => updateMode({ description: event.currentTarget.value })} />
                </label>
                <div class="field-label field-label--full">
                  <span>{t("conversation.modes.tools")}</span>
                  <ChoiceMultiSelect
                    ariaLabel={t("conversation.modes.tools")}
                    options={registeredToolOptions()}
                    valueText={mode().toolsText}
                    onChangeText={(next) => updateMode({ toolsText: next })}
                    emptyMessage={t("conversation.modes.toolsEmpty")}
                    searchPlaceholder={t("conversation.modes.toolsSearch")}
                    unknownLabel={t("conversation.modes.customTools")}
                  />
                </div>
                <label class="field-label field-label--full"><span>{t("conversation.modes.promptAppend")}</span>
                  <textarea rows={5} value={mode().promptAppend} onInput={(event) => updateMode({ promptAppend: event.currentTarget.value })} />
                </label>
                <button class="btn btn-secondary" type="button" disabled={modeIds().length <= 1} onClick={() => deleteMode(selectedMode())}>
                  <span class="codicon codicon-trash" aria-hidden="true" />
                  {t("conversation.modes.delete")}
                </button>
              </div>
            )}
          </Show>
        </div>
      </section>

      <section class="settings-section settings-section--plain">
        <details class="settings-details settings-details--embedded" open={Boolean(globalSystemAppend().trim())}>
          <summary>
            <span class="codicon codicon-settings-gear" aria-hidden="true" />
            {t("conversation.globalPrompt.title")}
          </summary>
          <label class="field-label field-label--full">
            <textarea rows={7} value={globalSystemAppend()} onInput={(event) => { setGlobalSystemAppend(event.currentTarget.value); markDirty() }} />
          </label>
        </details>
      </section>
    </div>
  )
}
