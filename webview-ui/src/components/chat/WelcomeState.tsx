import { Component, For, Show } from "solid-js"
import type { MockSession } from "./mock-data"

interface WelcomeStateProps {
  recentSessions: MockSession[]
  onSelectSession?: (id: string) => void
}

function formatRelativeDate(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const hours = Math.floor(diff / 3600000)
  if (hours < 1) return "刚刚"
  if (hours < 24) return `${hours}小时前`
  const days = Math.floor(hours / 24)
  if (days === 1) return "昨天"
  if (days < 7) return `${days}天前`
  return `${Math.floor(days / 7)}周前`
}

export const WelcomeState: Component<WelcomeStateProps> = (props) => {
  return (
    <div class="welcome-state">
      <div class="welcome-state__mark">
        <span class="codicon codicon-remote-explorer" aria-hidden="true" />
        <span>EZCode</span>
      </div>
      <p class="welcome-state__copy">连接中心化 host 后，在这里发起 agent 任务。</p>

      <Show when={props.recentSessions.length > 0}>
        <div class="recent-sessions">
          <div class="recent-sessions__label">最近会话</div>
          <For each={props.recentSessions}>
            {(session) => (
              <button
                type="button"
                class="recent-session-item"
                onClick={() => props.onSelectSession?.(session.id)}
              >
                <span class="recent-session-title">{session.title}</span>
                <span class="recent-session-date">{formatRelativeDate(session.updatedAt)}</span>
              </button>
            )}
          </For>
        </div>
      </Show>
    </div>
  )
}
