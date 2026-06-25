import { Component, For, Show } from "solid-js"
import { queuedPromptCount, type PendingPromptItem, type PromptQueueState } from "../../chat/promptQueue"

interface QueuedNextTurnDockProps {
  queue: PromptQueueState
  onRemove: (item: PendingPromptItem) => void
  onClear: () => void
}

export const QueuedNextTurnDock: Component<QueuedNextTurnDockProps> = (props) => (
  <Show when={props.queue.items.length > 0}>
    <div class="prompt-queue-dock" role="status" aria-live="polite">
      <span class="codicon codicon-history" aria-hidden="true" />
      <div class="prompt-queue-dock__body">
        <strong>
          {props.queue.paused
            ? `${queuedPromptCount(props.queue)} 条输入已暂停`
            : `${queuedPromptCount(props.queue)} 条输入等待当前回复结束后发送`}
        </strong>
        <div class="prompt-queue-list">
          <For each={props.queue.items}>
            {(item) => (
              <div class="prompt-queue-item prompt-queue-item--queue">
                <span class="codicon codicon-history" aria-hidden="true" />
                <span class="prompt-queue-item__text" title={item.text}>{item.text}</span>
                <span class="prompt-queue-item__status">
                  {item.error || (props.queue.paused ? "已暂停" : "等待当前回复结束")}
                </span>
                <div class="prompt-queue-item__actions">
                  <button type="button" onClick={() => props.onRemove(item)}>移除</button>
                </div>
              </div>
            )}
          </For>
        </div>
      </div>
      <div class="prompt-queue-dock__actions">
        <button type="button" onClick={props.onClear}>清空</button>
      </div>
    </div>
  </Show>
)
