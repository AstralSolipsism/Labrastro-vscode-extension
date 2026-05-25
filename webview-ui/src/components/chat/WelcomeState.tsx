import { Component, For, Show } from "solid-js"
import { t } from "../../i18n"
import type { MockSession } from "./mock-data"
import type { SessionListState } from "../../context/trace"

interface WelcomeStateProps {
  recentSessions: MockSession[]
  sessionListState: SessionListState
  onSelectSession?: (id: string) => void
}

function formatRelativeDate(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const hours = Math.floor(diff / 3600000)
  if (hours < 1) return t("chat.relativeTime.justNow")
  if (hours < 24) return t("chat.relativeTime.hoursAgo", { n: String(hours) })
  const days = Math.floor(hours / 24)
  if (days === 1) return t("chat.relativeTime.yesterday")
  if (days < 7) return t("chat.relativeTime.daysAgo", { n: String(days) })
  return `${Math.floor(days / 7)}周前`
}

export const WelcomeState: Component<WelcomeStateProps> = (props) => {
  const historyNotice = () => {
    if (props.recentSessions.length > 0) return ""
    if (props.sessionListState.status === "idle" || props.sessionListState.status === "empty") return ""
    return props.sessionListState.message
  }

  return (
    <div class="welcome-state">
      <div class="welcome-state__mark">
        <span class="codicon codicon-remote-explorer" aria-hidden="true" />
        <span>Labrastro</span>
      </div>
      <p class="welcome-state__copy">{t("chat.welcome")}</p>

      <Show when={props.recentSessions.length > 0}>
        <div class="recent-sessions">
          <div class="recent-sessions__label">{t("chat.recentSessions")}</div>
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
      <Show when={historyNotice()}>
        <p class="welcome-state__history-note">{historyNotice()}</p>
      </Show>
    </div>
  )
}
