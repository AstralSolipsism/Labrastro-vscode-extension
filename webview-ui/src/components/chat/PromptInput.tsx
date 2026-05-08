import { Component, For, Show, createSignal } from "solid-js"
import { IconButton } from "../common/IconButton"
import { DropdownMenu } from "../common/interaction"
import { t } from "../../i18n"
import type { ChatModeOption, ChatModelOption } from "../../chat/chatState"

interface PromptInputProps {
  disabled?: boolean
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
  onModelChange?: (modelId: string) => void
  onModelUnavailable?: () => void
  onSend?: (text: string) => void
}

export const PromptInput: Component<PromptInputProps> = (props) => {
  const [text, setText] = createSignal("")
  const [modeMenuOpen, setModeMenuOpen] = createSignal(false)
  const [modelMenuOpen, setModelMenuOpen] = createSignal(false)
  let textareaRef: HTMLTextAreaElement | undefined

  const adjustHeight = () => {
    if (!textareaRef) return
    textareaRef.style.height = "auto"
    textareaRef.style.height = `${Math.min(textareaRef.scrollHeight, 180)}px`
  }

  const handleSend = () => {
    const draft = text().trim()
    if (!draft || props.disabled || props.modelSwitching) return

    props.onSend?.(draft)
    setText("")
    if (textareaRef) {
      textareaRef.value = ""
      textareaRef.style.height = "auto"
    }
  }

  const modeSelectorLabel = () => props.modeLabel || props.selectedMode || "Coder"
  const modelSelectorLabel = () => props.modelLabel || props.selectedModel || "Model"
  const hasModelOptions = () => Boolean(props.modelOptions?.length)
  const canOpenModelSelector = () => !props.modelSwitching
  const canShowModelMenu = () => canOpenModelSelector() && hasModelOptions()
  const modelSelectorTitle = () => {
    if (props.modelError) return props.modelError
    if (props.modelPendingLabel) return props.modelPendingLabel
    if (!hasModelOptions()) return "没有可用模型"
    return props.modelDescription || modelSelectorLabel()
  }

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
          if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
            event.preventDefault()
            handleSend()
          }
        }}
      />
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
            ariaLabel="会话主模型"
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
            <div class="prompt-menu__section-label">会话主模型</div>
            <For each={props.modelOptions || []}>
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
          </DropdownMenu>
        </div>
        <div class="prompt-input-actions">
          <IconButton
            icon="arrow-up"
            title={t("chat.send")}
            disabled={!text().trim() || props.disabled || props.modelSwitching}
            onClick={handleSend}
          />
        </div>
      </div>
    </div>
  )
}
