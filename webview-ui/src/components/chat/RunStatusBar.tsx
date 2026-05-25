import { Component, Show } from "solid-js"
import { t } from "../../i18n"
import type { AgentRunState, RemotePeerState } from "../../chat/runtimeState"

interface RunStatusBarProps {
  remotePeer: RemotePeerState
  agentRun: AgentRunState
}

export const RunStatusBar: Component<RunStatusBarProps> = (props) => {
  const hasRemoteStatus = () => props.remotePeer.status !== "idle"
  const hasAgentRunStatus = () => props.agentRun.phase !== "idle"
  const visible = () => hasRemoteStatus() || hasAgentRunStatus()

  return (
    <Show when={visible()}>
      <section class="run-status-bar" aria-label={t("runtimeStatus.label")}>
        <Show when={hasRemoteStatus()}>
          <div
            class={`run-status-chip run-status-chip--${remoteTone(props.remotePeer.status)}`}
            title={remoteTitle(props.remotePeer)}
          >
            <span class="run-status-chip__dot" aria-hidden="true" />
            <span class="codicon codicon-remote-explorer" aria-hidden="true" />
            <span class="run-status-chip__text">{remoteLabel(props.remotePeer)}</span>
          </div>
        </Show>
        <Show when={hasAgentRunStatus()}>
          <div
            class={`run-status-chip run-status-chip--${agentTone(props.agentRun.phase)}`}
            title={agentTitle(props.agentRun)}
          >
            <span class="run-status-chip__dot" aria-hidden="true" />
            <span
              class="codicon codicon-server-process"
              classList={{ "run-status-chip__spin": props.agentRun.phase === "queued" }}
              aria-hidden="true"
            />
            <span class="run-status-chip__text">{agentLabel(props.agentRun)}</span>
          </div>
        </Show>
      </section>
    </Show>
  )
}

function remoteLabel(state: RemotePeerState): string {
  const base = state.status === "connected"
    ? t("runtimeStatus.remote.connected")
    : state.status === "connecting"
      ? t("runtimeStatus.remote.connecting")
      : state.status === "error"
        ? t("runtimeStatus.remote.error")
        : t("runtimeStatus.remote.idle")
  return [base, state.status === "connected" ? state.model : undefined].filter(Boolean).join(" · ")
}

function agentLabel(state: AgentRunState): string {
  const phase = state.phase === "queued"
    ? t("runtimeStatus.agentRun.queued")
    : state.phase === "running"
      ? t("runtimeStatus.agentRun.running")
      : state.phase === "completed"
        ? t("runtimeStatus.agentRun.completed")
        : state.phase === "error"
          ? t("runtimeStatus.agentRun.error")
          : t("runtimeStatus.agentRun.idle")
  return `${t("runtimeStatus.agentRun.label")} · ${phase}`
}

function remoteTitle(state: RemotePeerState): string {
  return [
    remoteLabel(state),
    state.mode ? `${t("runtimeStatus.detail.mode")}: ${state.mode}` : "",
    state.sessionId ? `${t("runtimeStatus.detail.session")}: ${state.sessionId}` : "",
    state.peerId ? `${t("runtimeStatus.detail.peer")}: ${state.peerId}` : "",
    state.mainAgentId ? `Main Agent: ${state.mainAgentId}` : "",
    state.agentConfigId ? `Agent Config: ${state.agentConfigId}` : "",
    state.fingerprint ? `${t("runtimeStatus.detail.fingerprint")}: ${state.fingerprint}` : "",
    state.workspaceRoot ? `${t("runtimeStatus.detail.workspace")}: ${state.workspaceRoot}` : "",
    state.errorMessage ? `${t("runtimeStatus.detail.error")}: ${state.errorMessage}` : "",
  ].filter(Boolean).join("\n")
}

function agentTitle(state: AgentRunState): string {
  return [
    agentLabel(state),
    state.kind ? `${t("runtimeStatus.detail.kind")}: ${state.kind}` : "",
    state.message ? `${t("runtimeStatus.detail.message")}: ${state.message}` : "",
  ].filter(Boolean).join("\n")
}

function remoteTone(status: RemotePeerState["status"]): "muted" | "success" | "warning" | "error" {
  if (status === "connected") return "success"
  if (status === "connecting") return "warning"
  if (status === "error") return "error"
  return "muted"
}

function agentTone(phase: AgentRunState["phase"]): "muted" | "success" | "warning" | "error" {
  if (phase === "running") return "success"
  if (phase === "queued") return "warning"
  if (phase === "error") return "error"
  return "muted"
}
