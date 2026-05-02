import { Component, createSignal } from "solid-js"
import { IconButton } from "../common/IconButton"

interface PromptInputProps {
  disabled?: boolean
  onSend?: (text: string) => void
}

export const PromptInput: Component<PromptInputProps> = (props) => {
  const [text, setText] = createSignal("")
  let textareaRef: HTMLTextAreaElement | undefined

  const adjustHeight = () => {
    if (!textareaRef) return
    textareaRef.style.height = "auto"
    textareaRef.style.height = `${Math.min(textareaRef.scrollHeight, 180)}px`
  }

  const handleSend = () => {
    const draft = text().trim()
    if (!draft || props.disabled) return

    props.onSend?.(draft)
    setText("")
    if (textareaRef) {
      textareaRef.value = ""
      textareaRef.style.height = "auto"
    }
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
        disabled={props.disabled}
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
          <button type="button" class="prompt-selector">
            <span class="codicon codicon-code" aria-hidden="true" />
            Code
          </button>
          <button type="button" class="prompt-selector">
            <span class="codicon codicon-server" aria-hidden="true" />
            Host
          </button>
        </div>
        <div class="prompt-input-actions">
          <IconButton icon="symbol-misc" title={t("chat.enhancePrompt")} />
          <IconButton
            icon="arrow-up"
            title={t("chat.send")}
            disabled={!text().trim() || props.disabled}
            onClick={handleSend}
          />
        </div>
      </div>
    </div>
  )
}
