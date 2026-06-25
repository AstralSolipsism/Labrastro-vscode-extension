import { Component, Show } from "solid-js"
import { t } from "../../i18n"
import type { AgentRunState, RunPeerState, ServerEventStreamState } from "../../chat/runtimeState"

interface RunStatusBarProps {
  serverEventStream: ServerEventStreamState
  runPeer: RunPeerState
  agentRun: AgentRunState
}

export const RunStatusBar: Component<RunStatusBarProps> = (props) => {
  const hasServerEventStreamStatus = () => props.serverEventStream.status !== "idle"
  const hasRunPeerStatus = () => props.runPeer.status !== "idle"
  const hasAgentRunStatus = () => props.agentRun.phase !== "idle"
  const visible = () => hasServerEventStreamStatus() || hasRunPeerStatus() || hasAgentRunStatus()

  return (
    <Show when={visible()}>
      <section class="run-status-bar" aria-label={t("runtimeStatus.label")}>
        <Show when={hasServerEventStreamStatus()}>
          <div
            class={`run-status-chip run-status-chip--${serverEventStreamTone(props.serverEventStream.status)}`}
            title={serverEventStreamTitle(props.serverEventStream)}
          >
            <span class="run-status-chip__dot" aria-hidden="true" />
            <span class="codicon codicon-radio-tower" aria-hidden="true" />
            <span class="run-status-chip__text">{serverEventStreamLabel(props.serverEventStream)}</span>
          </div>
        </Show>
        <Show when={hasRunPeerStatus()}>
          <div
            class={`run-status-chip run-status-chip--${runPeerTone(props.runPeer.status)}`}
            title={runPeerTitle(props.runPeer)}
          >
            <span class="run-status-chip__dot" aria-hidden="true" />
            <span class="codicon codicon-remote-explorer" aria-hidden="true" />
            <span class="run-status-chip__text">{runPeerLabel(props.runPeer)}</span>
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

function serverEventStreamLabel(state: ServerEventStreamState): string {
  const status = state.status === "connecting"
    ? t("runtimeStatus.serverEventStream.connecting")
    : state.status === "reconnecting"
      ? t("runtimeStatus.serverEventStream.reconnecting")
      : state.status === "error"
        ? t("runtimeStatus.serverEventStream.error")
        : t("runtimeStatus.serverEventStream.idle")
  return `${t("runtimeStatus.serverEventStream.label")} · ${status}`
}

function runPeerLabel(state: RunPeerState): string {
  const base = state.status === "connected"
    ? t("runtimeStatus.runPeer.connected")
    : state.status === "connecting"
      ? t("runtimeStatus.runPeer.connecting")
      : state.status === "error"
        ? t("runtimeStatus.runPeer.error")
        : t("runtimeStatus.runPeer.idle")
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

export function serverEventStreamTitle(state: ServerEventStreamState): string {
  return [
    serverEventStreamLabel(state),
    state.sessionRunId ? `SessionRun: ${state.sessionRunId}` : "",
    state.branchBindingId ? `${t("runtimeStatus.detail.branch")}: ${state.branchBindingId}` : "",
    state.attempts !== undefined ? `${t("runtimeStatus.detail.attempts")}: ${state.attempts}` : "",
    state.nextRetryAt !== undefined ? `${t("runtimeStatus.detail.nextRetry")}: ${new Date(state.nextRetryAt).toLocaleTimeString()}` : "",
    state.errorMessage ? `${t("runtimeStatus.detail.error")}: ${state.errorMessage}` : "",
  ].filter(Boolean).join("\n")
}

export function runPeerTitle(state: RunPeerState): string {
  return [
    runPeerLabel(state),
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

function serverEventStreamTone(status: ServerEventStreamState["status"]): "muted" | "success" | "warning" | "error" {
  if (status === "connecting" || status === "reconnecting") return "warning"
  if (status === "error") return "error"
  return "muted"
}

function runPeerTone(status: RunPeerState["status"]): "muted" | "success" | "warning" | "error" {
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
