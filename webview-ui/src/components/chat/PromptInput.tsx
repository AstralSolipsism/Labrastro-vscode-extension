import { Component, For, Show, createEffect, createMemo, createSignal } from "solid-js"
import { IconButton } from "../common/IconButton"
import { DropdownMenu } from "../common/interaction"
import { t } from "../../i18n"
import type { ChatModeOption, ChatModelOption } from "../../chat/chatState"
import {
  buildMentionOptions,
  commandTextForSelection,
  activeMentionBindings,
  filterChatCommandOptions,
  filterMentionOptions,
  nextPopupIndex,
  normalizeChatCommandOptions,
  popupDismissedForToken,
  type ChatCommandOption,
  type MentionOption,
  type PromptCommandSelection,
  type PromptSubmission,
} from "./promptInputCatalog"

interface PromptInputProps {
  disabled?: boolean
  draftText?: string
  draftNonce?: string | number
  modeOptions?: ChatModeOption[]
  selectedMode?: string
  modeLabel?: string
  onModeChange?: (mode: string) => void
  modelOptions?: ChatModelOption[]
  selectedModel?: string
  modelLabel?: string
  modelDescription?: string
  modelPendingLabel?: string
  modelSwitching?: boolean
  modelError?: string
  modelRequired?: boolean
  chatCommands?: unknown[]
  mentionProviders?: unknown[]
  agentTools?: unknown[]
  workspaceFiles?: unknown[]
  onMentionQuery?: (query: string) => void
  onMentionInsert?: (mention: MentionOption) => void
  onCommandSelect?: (selection: PromptCommandSelection) => boolean | void
  onModelChange?: (modelId: string) => void
  onModelUnavailable?: () => void
  onSubmit?: (submission: PromptSubmission) => boolean | void
}

export const PromptInput: Component<PromptInputProps> = (props) => {
  const [text, setText] = createSignal("")
  const [mentionBindings, setMentionBindings] = createSignal<MentionOption[]>([])
  const [modeMenuOpen, setModeMenuOpen] = createSignal(false)
  const [modelMenuOpen, setModelMenuOpen] = createSignal(false)
  const [selectedPopupIndex, setSelectedPopupIndex] = createSignal(0)
  const [dismissedPopupToken, setDismissedPopupToken] = createSignal("")
  const [lastWorkspaceMentionQuery, setLastWorkspaceMentionQuery] = createSignal("")
  const [modelSearch, setModelSearch] = createSignal("")
  let textareaRef: HTMLTextAreaElement | undefined

  createEffect(() => {
    props.draftNonce
    const draft = props.draftText
    if (draft === undefined) return
    setText(draft)
    setMentionBindings([])
    queueMicrotask(() => {
      if (!textareaRef) return
      textareaRef.value = draft
      adjustHeight()
      textareaRef.focus()
      textareaRef.setSelectionRange(draft.length, draft.length)
    })
  })

  const adjustHeight = () => {
    if (!textareaRef) return
    textareaRef.style.height = "auto"
    textareaRef.style.height = `${Math.min(textareaRef.scrollHeight, 180)}px`
  }

  const clearInput = () => {
    setText("")
    setMentionBindings([])
    if (textareaRef) {
      textareaRef.value = ""
      textareaRef.style.height = "auto"
    }
  }

  const handleSubmit = () => {
    const draft = text()
    if (!draft.trim()) return
    const accepted = props.onSubmit?.({ text: draft, mentions: activeMentionBindings(draft, mentionBindings()) })
    if (accepted === false) return
    clearInput()
  }

  const chatCommandOptions = createMemo(() => normalizeChatCommandOptions(props.chatCommands || []))
  const mentionOptions = createMemo(() => buildMentionOptions(
    props.mentionProviders || [],
    props.agentTools || [],
    props.workspaceFiles || [],
  ))
  const hasWorkspaceMentionProvider = createMemo(() =>
    Array.isArray(props.mentionProviders) &&
    props.mentionProviders.some((item) =>
      Boolean(
        item &&
        typeof item === "object" &&
        !Array.isArray(item) &&
        String((item as Record<string, unknown>).id || "") === "workspace_files"
      )
    )
  )
  const slashToken = () => {
    const value = text()
    const firstLine = value.split(/\r?\n/, 1)[0] || ""
    if (!firstLine.startsWith("/") || firstLine.includes(" ")) return ""
    return firstLine
  }
  const mentionToken = () => {
    const value = text()
    const match = value.match(/(^|\s)(@[^\s]*)$/)
    return match ? match[2] : ""
  }
  const activePopup = createMemo<"commands" | "mentions" | undefined>(() => {
    if (slashToken() && !popupDismissedForToken(dismissedPopupToken(), slashToken())) return "commands"
    if (mentionToken() && !popupDismissedForToken(dismissedPopupToken(), mentionToken())) return "mentions"
    return undefined
  })
  const popupItems = createMemo<Array<ChatCommandOption | MentionOption>>(() => {
    const popup = activePopup()
    if (popup === "commands") return filterChatCommandOptions(chatCommandOptions(), slashToken())
    if (popup === "mentions") return filterMentionOptions(mentionOptions(), mentionToken())
    return []
  })
  const selectedPopupItem = () => popupItems()[selectedPopupIndex()]

  createEffect(() => {
    activePopup()
    text()
    const token = slashToken() || mentionToken()
    if (dismissedPopupToken() && dismissedPopupToken() !== token) {
      setDismissedPopupToken("")
    }
    setSelectedPopupIndex(0)
  })

  createEffect(() => {
    const token = mentionToken()
    if (!token || !hasWorkspaceMentionProvider()) {
      if (lastWorkspaceMentionQuery()) setLastWorkspaceMentionQuery("")
      return
    }
    const query = token.replace(/^@/, "").trim()
    if (query === lastWorkspaceMentionQuery()) return
    setLastWorkspaceMentionQuery(query)
    props.onMentionQuery?.(query)
  })

  const applyMentionSelection = (mention: MentionOption) => {
    const next = text().replace(/(^|\s)(@[^\s]*)$/, (_match, prefix: string) => `${prefix}${mention.insertText} `)
    setText(next)
    setMentionBindings((current) => [...current.filter((item) => item.id !== mention.id), mention])
    props.onMentionInsert?.(mention)
    if (textareaRef) {
      textareaRef.value = next
      queueMicrotask(() => {
        adjustHeight()
        textareaRef?.focus()
        textareaRef?.setSelectionRange(next.length, next.length)
      })
    }
  }

  const applyCommandSelection = (command: ChatCommandOption) => {
    const selection = commandTextForSelection(command)
    if (selection.action === "dispatch") {
      const accepted = props.onCommandSelect?.({ command, text: selection.text })
      if (accepted === false) return
      clearInput()
      return
    }
    setText(selection.text)
    if (textareaRef) {
      textareaRef.value = selection.text
      queueMicrotask(() => {
        adjustHeight()
        textareaRef?.focus()
        textareaRef?.setSelectionRange(selection.text.length, selection.text.length)
      })
    }
  }

  const applyPopupSelection = () => {
    const item = selectedPopupItem()
    const popup = activePopup()
    if (!item || !popup) return false
    if (popup === "commands") {
      applyCommandSelection(item as ChatCommandOption)
      return true
    }
    applyMentionSelection(item as MentionOption)
    return true
  }

  const modeSelectorLabel = () => props.modeLabel || props.selectedMode || "Coder"
  const modelSelectorLabel = () => props.modelLabel || props.selectedModel || "Model"
  const hasModelOptions = () => Boolean(props.modelOptions?.length)
  const selectedModelAvailable = () =>
    Boolean(props.selectedModel && props.modelOptions?.some((option) => option.id === props.selectedModel))
  const modelBlocked = () =>
    props.modelRequired === true && (!hasModelOptions() || !selectedModelAvailable())
  const sendButtonTitle = () => {
    if (props.modelError) return props.modelError
    if (modelBlocked()) return "请选择会话模型后再发送。"
    return t("chat.send")
  }
  const canOpenModelSelector = () => !props.modelSwitching
  const canShowModelMenu = () => canOpenModelSelector() && hasModelOptions()
  const filteredModelOptions = createMemo(() => {
    const query = modelSearch().trim().toLowerCase()
    const options = props.modelOptions || []
    if (!query) return options
    return options.filter((option) => [
      option.label,
      option.provider,
      option.model,
      option.providerId,
      option.modelId,
      option.description,
    ].join(" ").toLowerCase().includes(query))
  })
  const modelSelectorTitle = () => {
    if (props.modelError) return props.modelError
    if (props.modelPendingLabel) return props.modelPendingLabel
    if (!hasModelOptions()) return "没有可用模型"
    return props.modelDescription || modelSelectorLabel()
  }

  createEffect(() => {
    if (!modelMenuOpen()) setModelSearch("")
  })

  return (
    <div class="prompt-input-shell">
      <textarea
        ref={textareaRef}
        class="prompt-input"
        classList={{ "prompt-input--disabled": props.disabled }}
        placeholder={t("chat.promptPlaceholder")}
        value={text()}
        rows={1}
        disabled={props.disabled || props.modelSwitching}
        onInput={(event) => {
          setText(event.currentTarget.value)
          adjustHeight()
        }}
        onKeyDown={(event) => {
          const items = popupItems()
          if (items.length) {
            if (event.key === "ArrowDown") {
              event.preventDefault()
              setSelectedPopupIndex((index) => nextPopupIndex(index, "down", items.length))
              return
            }
            if (event.key === "ArrowUp") {
              event.preventDefault()
              setSelectedPopupIndex((index) => nextPopupIndex(index, "up", items.length))
              return
            }
            if (event.key === "Escape") {
              event.preventDefault()
              setDismissedPopupToken(slashToken() || mentionToken())
              setSelectedPopupIndex(0)
              return
            }
            if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
              event.preventDefault()
              if (applyPopupSelection()) return
            }
          }
          if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
            event.preventDefault()
            handleSubmit()
          }
        }}
      />
      <Show when={popupItems().length}>
        <div class="prompt-input-popup" role="listbox">
          <For each={popupItems()}>
            {(item, index) => (
              <button
                type="button"
                class="prompt-input-popup__item"
                classList={{ "prompt-input-popup__item--selected": index() === selectedPopupIndex() }}
                onMouseDown={(event) => {
                  event.preventDefault()
                  setSelectedPopupIndex(index())
                  applyPopupSelection()
                }}
              >
                <strong>{activePopup() === "commands" ? (item as ChatCommandOption).trigger : (item as MentionOption).insertText}</strong>
                <span>{item.label}</span>
                <Show when={item.description}>
                  <small>{item.description}</small>
                </Show>
              </button>
            )}
          </For>
        </div>
      </Show>
      <div class="prompt-input-toolbar">
        <div class="prompt-input-selectors">
          <DropdownMenu
            ariaLabel="会话模式"
            title="会话模式"
            open={modeMenuOpen()}
            disabled={props.disabled}
            triggerClass="prompt-selector"
            menuClass="prompt-menu"
            onOpenChange={(open) => {
              if (open) setModelMenuOpen(false)
              setModeMenuOpen(open)
            }}
            triggerContent={
              <>
                <span class="codicon codicon-code" aria-hidden="true" />
                <span class="prompt-selector__label">{modeSelectorLabel()}</span>
                <span class="codicon codicon-chevron-down prompt-selector__chevron" aria-hidden="true" />
              </>
            }
          >
            <div class="prompt-menu__section-label">会话模式</div>
            <For each={props.modeOptions || []}>
              {(option) => (
                <button
                  type="button"
                  class="prompt-menu__item"
                  classList={{ "prompt-menu__item--selected": option.id === props.selectedMode }}
                  role="menuitemradio"
                  aria-checked={option.id === props.selectedMode}
                  onClick={() => {
                    props.onModeChange?.(option.id)
                    setModeMenuOpen(false)
                  }}
                >
                  <strong>{option.label}</strong>
                  <Show when={option.description}>
                    <small>{option.description}</small>
                  </Show>
                </button>
              )}
            </For>
          </DropdownMenu>
          <DropdownMenu
            ariaLabel="会话模型"
            title={modelSelectorTitle()}
            open={modelMenuOpen() && canShowModelMenu()}
            disabled={!canOpenModelSelector()}
            triggerClass="prompt-selector prompt-selector--model"
            triggerClassList={{
              "prompt-selector--switching": props.modelSwitching,
              "prompt-selector--pending": Boolean(props.modelPendingLabel),
              "prompt-selector--error": Boolean(props.modelError),
              "prompt-selector--empty": !hasModelOptions(),
            }}
            menuClass="prompt-menu prompt-menu--model"
            onOpenChange={(open) => {
              if (open) {
                setModeMenuOpen(false)
                if (!hasModelOptions()) {
                  props.onModelUnavailable?.()
                  setModelMenuOpen(false)
                  return
                }
              }
              setModelMenuOpen(open)
            }}
            triggerContent={
              <>
                <span
                  class={`codicon codicon-${props.modelSwitching ? "sync prompt-selector__spin" : "symbol-class"}`}
                  aria-hidden="true"
                />
                <span class="prompt-selector__label">{modelSelectorLabel()}</span>
                <Show when={props.modelDescription || props.modelPendingLabel}>
                  <span class="prompt-selector__detail">{props.modelPendingLabel || props.modelDescription}</span>
                </Show>
                <span class="codicon codicon-chevron-down prompt-selector__chevron" aria-hidden="true" />
              </>
            }
          >
            <div class="prompt-menu__section-label">会话模型</div>
            <label class="prompt-menu__search">
              <span class="codicon codicon-search" aria-hidden="true" />
              <input
                value={modelSearch()}
                placeholder="搜索模型"
                aria-label="搜索模型"
                onInput={(event) => setModelSearch(event.currentTarget.value)}
                onKeyDown={(event) => event.stopPropagation()}
              />
            </label>
            <div class="prompt-menu__scroll">
              <Show when={filteredModelOptions().length} fallback={
                <div class="prompt-menu__empty">无匹配模型</div>
              }>
                <For each={filteredModelOptions()}>
                  {(option) => (
                    <button
                      type="button"
                      class="prompt-menu__item"
                      classList={{ "prompt-menu__item--selected": option.id === props.selectedModel }}
                      role="menuitemradio"
                      aria-checked={option.id === props.selectedModel}
                      onClick={() => {
                        props.onModelChange?.(option.id)
                        setModelMenuOpen(false)
                      }}
                    >
                      <strong>{option.label}</strong>
                      <Show when={option.description}>
                        <small>{option.description}</small>
                      </Show>
                    </button>
                  )}
                </For>
              </Show>
            </div>
          </DropdownMenu>
        </div>
        <div class="prompt-input-actions">
          <IconButton
            icon="arrow-up"
            title={sendButtonTitle()}
            disabled={!text().trim() || props.disabled || props.modelSwitching || modelBlocked()}
            onClick={handleSubmit}
          />
        </div>
      </div>
    </div>
  )
}
