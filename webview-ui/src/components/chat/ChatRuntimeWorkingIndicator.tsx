import { Component, Show } from "solid-js"
import { t } from "../../i18n"
import { RoseFourLoader } from "./RoseFourLoader"

interface ChatRuntimeWorkingIndicatorProps {
  isWorking: boolean
  text?: string
  elapsed?: string
}

export const ChatRuntimeWorkingIndicator: Component<ChatRuntimeWorkingIndicatorProps> = (props) => (
  <Show when={props.isWorking}>
    <div class="chat-runtime-working" role="status" aria-live="polite">
      <RoseFourLoader class="chat-runtime-working__loader" />
      <span class="chat-runtime-working__text">{props.text || t("chat.thinking")}</span>
      <Show when={props.elapsed}>
        <span class="chat-runtime-working__elapsed">{props.elapsed}</span>
      </Show>
    </div>
  </Show>
)
