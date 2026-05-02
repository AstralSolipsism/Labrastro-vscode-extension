/**
 * WorkingIndicator 组件
 *
 * 显示 AI 正在工作的状态：Spinner + 操作文本 + 已用时间
 */

import { Component, Show } from "solid-js"
import { t } from "../../i18n"

interface WorkingIndicatorProps {
  isWorking: boolean
  text?: string
  elapsed?: string
}

export const WorkingIndicator: Component<WorkingIndicatorProps> = (props) => {
  return (
    <Show when={props.isWorking}>
      <div class="working-indicator">
        <span class="working-spinner" />
        <span class="working-text">{props.text || t("chat.thinking")}</span>
        <Show when={props.elapsed}>
          <span class="working-elapsed">{props.elapsed}</span>
        </Show>
      </div>
    </Show>
  )
}
