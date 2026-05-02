import { Component, For, Show } from "solid-js"
import { useTrace } from "../context/trace"
import { t } from "../i18n"
import type { TraceNavigationIntent } from "../types/trace"

interface AgentManagerViewProps {
  branchId?: string
  nodeId?: string
  sessionId?: string
  intent?: TraceNavigationIntent
}

const AgentManagerView: Component<AgentManagerViewProps> = () => {
  const trace = useTrace()

  return (
    <div class="agent-manager-placeholder">
      <header class="agent-manager-placeholder__header">
        <span class="codicon codicon-list-tree" aria-hidden="true" />
        <div>
          <h2>Trace Preview</h2>
          <p>{t("agentManager.desc")}</p>
        </div>
      </header>

      <Show
        when={trace.allSessions().length > 0}
        fallback={<p class="agent-manager-placeholder__empty">{t("agentManager.noSessions")}</p>}
      >
        <div class="agent-manager-session-list">
          <For each={trace.allSessions()}>
            {(session) => (
              <button
                type="button"
                class="agent-manager-session"
                classList={{ "agent-manager-session--active": session.id === trace.currentSessionId() }}
                onClick={() => trace.loadSession(session.id)}
              >
                <span class="codicon codicon-comment-discussion" aria-hidden="true" />
                <span>{session.title}</span>
              </button>
            )}
          </For>
        </div>
      </Show>
    </div>
  )
}

export default AgentManagerView
