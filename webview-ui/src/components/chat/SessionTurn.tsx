import { Component, For, Match, Show, Switch, createEffect, createMemo, createSignal } from "solid-js"
import { t } from "../../i18n"
import type { MockTurn, MockPart, MockMessage } from "./mock-data"
import {
  TOOL_STATUS_TO_TRACE_STATUS,
  getToolExecutionStatusLabel,
  getTraceNodeCategory,
  getTraceNodeClassName,
  getTraceNodeKindLabel,
  getTraceStatusLabel,
  inferTraceNodeKindFromToolName,
  type TraceNodeKind,
} from "../../types/trace"
import { IconButton } from "../common/IconButton"
import { MarkdownBlock } from "../common/MarkdownBlock"
import { ApprovalDetailsBody, approvalFromPayload } from "./ApprovalDetailsDialog"
import { canEditForkMessage, canForkMessage, canForkPart } from "../../chat/conversationInteractions"
import {
  extractShellCommand,
  isShellToolName,
  shellChunksFromText,
  shouldShowShellFinalOutput,
  type ShellOutputChunk,
  type ShellOutputStream,
} from "../../utils/shell-tool-output"

function getToolLabel(name: string): string {
  const labels: Record<string, string> = {
    read_file: t("tool.readFile"),
    write_file: t("tool.writeFile"),
    edit_file: t("tool.editFile"),
    shell: t("tool.shell"),
    grep: t("tool.grep"),
    glob: t("tool.glob"),
    mcp: t("tool.mcp"),
    delegate_agent: t("tool.delegateAgent"),
    write_to_file: t("tool.writeToFile"),
    execute_command: t("tool.executeCommand"),
    list_directory: t("tool.listDirectory"),
    search_files: t("tool.searchFiles"),
    apply_patch: t("tool.applyPatch"),
  }
  return labels[name] || name
}

const TOOL_ICONS: Record<string, string> = {
  read_file: "file",
  write_file: "edit",
  edit_file: "diff-modified",
  shell: "terminal",
  grep: "search",
  glob: "symbol-file",
  mcp: "server-process",
  delegate_agent: "hubot",
  write_to_file: "edit",
  execute_command: "terminal",
  list_directory: "list-tree",
  search_files: "search",
  apply_patch: "diff-modified",
}

const CARD_OPEN_STATE = new Map<string, boolean>()
const CARD_DETAILS_OPEN_STATE = new Map<string, boolean>()

function initialCardOpenState(partId: string, fallback: boolean): boolean {
  const saved = CARD_OPEN_STATE.get(partId)
  return saved ?? fallback
}

function initialCardDetailsOpenState(partId: string, fallback: boolean): boolean {
  const saved = CARD_DETAILS_OPEN_STATE.get(partId)
  return saved ?? fallback
}

function traceKindForPart(part: MockPart): TraceNodeKind {
  return part.traceNodeKind || inferTraceNodeKindFromToolName(part.tool)
}

function traceStatusForPart(part: MockPart) {
  if (part.traceNodeStatus) return part.traceNodeStatus
  if (part.type === "tool") return TOOL_STATUS_TO_TRACE_STATUS[part.status || "pending"]
  if (part.type === "session") return part.sessionState === "error" ? "error" : "success"
  return "success"
}

function toolDurationLabel(part: MockPart): string {
  if (!part.toolStartedAt || !part.toolEndedAt) return ""
  const seconds = Math.max(0, part.toolEndedAt - part.toolStartedAt)
  if (seconds < 1) return `${Math.round(seconds * 1000)}ms`
  return `${seconds.toFixed(1)}s`
}

function markerClass(kind: TraceNodeKind, status = "success" as ReturnType<typeof traceStatusForPart>, selected = false) {
  return getTraceNodeClassName(
    {
      category: getTraceNodeCategory(kind),
      kind,
      status,
    },
    { selected }
  )
}

interface SessionTurnProps {
  turn: MockTurn
  selectedTraceNodeId?: string | null
  onSelectSession?: (sessionId: string) => void
  onTraceNodeSelect?: (nodeId: string) => void
  onCopyMessage?: (message: MockMessage) => Promise<void> | void
  onEditForkMessage?: (message: MockMessage) => void
  onForkMessage?: (message: MockMessage) => void
  onCopyToolCommand?: (part: MockPart) => Promise<void> | void
  onCopyToolOutput?: (part: MockPart) => Promise<void> | void
  onForkPart?: (part: MockPart) => void
  defaultReasoningOpen?: boolean
}

interface MessageMarkerProps {
  message: MockMessage
  selected?: boolean
}

const MessageMarker: Component<MessageMarkerProps> = (props) => {
  const kind = () => props.message.traceNodeKind || (props.message.role === "user" ? "user_message" : "assistant_message")
  const status = () => props.message.traceNodeStatus || "success"

  return (
    <span class="message-marker" aria-hidden="true">
      <span class={markerClass(kind(), status(), props.selected)} title={getTraceStatusLabel(status())} />
    </span>
  )
}

interface PartProps {
  part: MockPart
  selectedTraceNodeId?: string | null
  onSelectSession?: (sessionId: string) => void
  onTraceNodeSelect?: (nodeId: string) => void
  onCopyToolCommand?: (part: MockPart) => Promise<void> | void
  onCopyToolOutput?: (part: MockPart) => Promise<void> | void
  onForkPart?: (part: MockPart) => void
  defaultReasoningOpen?: boolean
}

const ToolPart: Component<PartProps> = (props) => {
  const [open, setOpen] = createSignal(
    initialCardOpenState(props.part.id, false)
  )
  createEffect(() => {
    CARD_OPEN_STATE.set(props.part.id, open())
  })
  const kind = () => traceKindForPart(props.part)
  const status = () => traceStatusForPart(props.part)
  const selected = () => Boolean(props.part.traceNodeId && props.part.traceNodeId === props.selectedTraceNodeId)
  const toolName = () => props.part.tool || "tool"
  const subtitle = () => {
    const input = props.part.toolInput
    if (!input) return ""
    return String(
      input.command ||
      input.file_path ||
      input.path ||
      input.pattern ||
      input.server ||
      input.tool ||
      input.files ||
      props.part.toolCallId ||
      ""
    )
  }
  const duration = () => {
    return toolDurationLabel(props.part)
  }
  const approvalDetails = () => approvalFromPayload({}, {
    approvalId: props.part.approvalId,
    toolCallId: props.part.toolCallId,
    toolName: toolName(),
    toolSource: props.part.toolSource,
    reason: props.part.approvalReason,
    content: props.part.approvalContent,
    toolArgs: props.part.toolInput || {},
    sections: props.part.approvalSections || [],
  })

  return (
    <div
      class="tool-card"
      classList={{
        "tool-card--selected": selected(),
        "tool-card--awaiting": props.part.status === "pending" || props.part.status === "awaiting_approval",
        "tool-card--error": props.part.status === "error" || props.part.status === "protocol_error",
        "tool-card--cancelled": props.part.status === "cancelled" || props.part.status === "denied",
      }}
      data-trace-node-id={props.part.traceNodeId}
      onClick={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        class="tool-card__header"
        onClick={(event) => {
          event.stopPropagation()
          setOpen((value) => {
            const next = !value
            CARD_OPEN_STATE.set(props.part.id, next)
            return next
          })
        }}
      >
        <span class="tool-card__icon">
          <span class={`codicon codicon-${TOOL_ICONS[toolName()] || "tools"}`} aria-hidden="true" />
        </span>
        <span class="tool-card__body">
          <span class="tool-card__title">{getToolLabel(toolName()) || toolName()}</span>
          <Show when={subtitle()}>
            <span class="tool-card__subtitle">{subtitle()}</span>
          </Show>
        </span>
        <span class={markerClass(kind(), status(), selected())} title={getTraceStatusLabel(status())} />
        <span class="tool-card__status">{props.part.status ? getToolExecutionStatusLabel(props.part.status) : getTraceStatusLabel(status())}</span>
        <Show when={duration()}>
          <span class="tool-card__duration">{duration()}</span>
        </Show>
        <span class={`codicon codicon-chevron-${open() ? "down" : "right"}`} aria-hidden="true" />
      </button>
      <Show when={open()}>
        <div class="tool-card__details">
          <Show when={props.part.toolInput && Object.keys(props.part.toolInput).length > 0}>
            <ToolSection title={t("tool.section.params")}>
              <pre class="tool-card__code">{formatJson(props.part.toolInput)}</pre>
            </ToolSection>
          </Show>
          <Show when={props.part.approvalId}>
            <ToolSection title={t("tool.section.approval")}>
              <div class="tool-card__approval">
                <div class="tool-card__approval-main">
                  <span>{props.part.approvalReason || t("tool.approval.needsApproval")}</span>
                  <Show when={props.part.approvalDecision}>
                    <strong>{approvalDecisionLabel(props.part.approvalDecision, props.part.status)}</strong>
                  </Show>
                </div>
                <Show when={approvalResultReasonForPart(props.part)}>
                  <div class="tool-card__approval-result">{approvalResultReasonForPart(props.part)}</div>
                </Show>
              </div>
              <ApprovalDetailsBody approval={approvalDetails()} compact />
            </ToolSection>
          </Show>
          <Show when={props.part.toolOutput}>
            <ToolSection title={props.part.status === "running" ? t("tool.section.liveOutput") : t("tool.section.result")}>
              <ToolOutput part={props.part} />
            </ToolSection>
          </Show>
          <Show when={props.part.toolResultMeta && Object.keys(props.part.toolResultMeta).length > 0}>
            <ToolSection title={t("tool.section.metadata")}>
              <pre class="tool-card__code">{formatJson(props.part.toolResultMeta)}</pre>
            </ToolSection>
          </Show>
          <div class="message-action-row tool-card__actions">
            <Show when={props.part.toolOutput}>
              <IconButton
                icon="copy"
                title={t("chat.copyToolOutput")}
                onClick={(event) => {
                  event.stopPropagation()
                  return props.onCopyToolOutput?.(props.part)
                }}
              />
            </Show>
            <Show when={canForkPart(props.part)}>
              <IconButton
                icon="git-branch"
                title={t("chat.forkFromHere")}
                onClick={(event) => {
                  event.stopPropagation()
                  props.onForkPart?.(props.part)
                }}
              />
            </Show>
          </div>
        </div>
      </Show>
    </div>
  )
}

const ToolSection: Component<{ title: string; children: import("solid-js").JSX.Element }> = (props) => (
  <section class="tool-card__section">
    <div class="tool-card__section-title">{props.title}</div>
    {props.children}
  </section>
)

const ToolOutput: Component<{ part: MockPart }> = (props) => (
  <Switch fallback={<pre class="tool-card__output">{props.part.toolOutput}</pre>}>
    <Match when={props.part.toolOutputFormat === "markdown"}>
      <MarkdownBlock text={props.part.toolOutput} class="tool-card__markdown" />
    </Match>
    <Match when={props.part.toolOutputFormat === "json"}>
      <pre class="tool-card__output">{formatJson(parseJsonOrRaw(props.part.toolOutput || ""))}</pre>
    </Match>
  </Switch>
)

function approvalDecisionLabel(decision?: string, status?: string): string {
  if (decision === "deny_once") return t("tool.approval.denied")
  if (decision === "auto_denied") return t("tool.approval.autoDenied")
  if (decision === "auto_approved") return t("tool.approval.autoApproved")
  if (decision === "allow_once") return t("tool.approval.approved")
  if (status === "approved" || status === "running" || status === "returned") return t("tool.approval.approved")
  if (status === "denied" || status === "cancelled") return t("tool.approval.denied")
  return t("tool.approval.pending")
}

function approvalResultReasonForPart(part: MockPart): string | undefined {
  const resultReason = (part.approvalResultReason || "").trim()
  if (!resultReason) return undefined
  if (resultReason === (part.approvalReason || "").trim()) return undefined
  return resultReason
}

function shellEmptyText(status?: string): string {
  if (status === "pending") return t("tool.shell.queued")
  if (status === "awaiting_approval") return t("tool.shell.awaitingApproval")
  if (status === "approved") return t("tool.shell.approved")
  if (status === "running") return t("tool.shell.running")
  if (status === "protocol_error") return t("tool.shell.protocolError")
  if (status === "error") return t("tool.shell.error")
  return t("tool.shell.noOutput")
}

function shellStreamLabel(stream: ShellOutputStream): string {
  if (stream === "stderr") return "err"
  if (stream === "result") return "out"
  if (stream === "system") return "sys"
  return "out"
}

function omitShellCommandFields(input?: Record<string, unknown>): Record<string, unknown> {
  if (!input) return {}
  const entries = Object.entries(input).filter(([key]) => !["command", "cmd", "args"].includes(key))
  return Object.fromEntries(entries)
}

const ShellToolPart: Component<PartProps> = (props) => {
  const [open, setOpen] = createSignal(
    initialCardOpenState(props.part.id, false)
  )
  const [detailsOpen, setDetailsOpen] = createSignal(initialCardDetailsOpenState(props.part.id, false))
  createEffect(() => {
    CARD_OPEN_STATE.set(props.part.id, open())
  })
  createEffect(() => {
    CARD_DETAILS_OPEN_STATE.set(props.part.id, detailsOpen())
  })
  const kind = () => traceKindForPart(props.part)
  const status = () => traceStatusForPart(props.part)
  const selected = () => Boolean(props.part.traceNodeId && props.part.traceNodeId === props.selectedTraceNodeId)
  const toolName = () => props.part.tool || "shell"
  const command = createMemo(() => extractShellCommand(props.part.toolInput) || t("tool.shell.commandUnavailable"))
  const duration = () => toolDurationLabel(props.part)
  const detailInput = createMemo(() => omitShellCommandFields(props.part.toolInput))
  const outputChunks = createMemo<ShellOutputChunk[]>(() => {
    if (props.part.toolOutputChunks?.length) return props.part.toolOutputChunks
    return shellChunksFromText(props.part.toolOutput || props.part.toolFinalOutput || "")
  })
  const hasDetails = () =>
    Boolean(
      Object.keys(detailInput()).length > 0 ||
      props.part.approvalId ||
      props.part.toolResultMeta && Object.keys(props.part.toolResultMeta).length > 0 ||
      shouldShowShellFinalOutput(props.part.toolOutput, props.part.toolFinalOutput),
    )

  let outputRef: HTMLDivElement | undefined
  createEffect(() => {
    outputChunks().length
    props.part.toolOutput
    props.part.status
    if (!outputRef) return
    queueMicrotask(() => {
      if (outputRef) outputRef.scrollTop = outputRef.scrollHeight
    })
  })

  return (
    <div
      class="tool-card shell-card"
      classList={{
        "tool-card--selected": selected(),
        "tool-card--awaiting": props.part.status === "pending" || props.part.status === "awaiting_approval",
        "tool-card--error": props.part.status === "error" || props.part.status === "protocol_error",
        "tool-card--cancelled": props.part.status === "cancelled" || props.part.status === "denied",
      }}
      data-trace-node-id={props.part.traceNodeId}
      onClick={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        class="tool-card__header shell-card__header"
        onClick={(event) => {
          event.stopPropagation()
          setOpen((value) => {
            const next = !value
            CARD_OPEN_STATE.set(props.part.id, next)
            return next
          })
        }}
      >
        <span class="tool-card__icon">
          <span class="codicon codicon-terminal" aria-hidden="true" />
        </span>
        <span class="tool-card__body">
          <span class="tool-card__title">{getToolLabel(toolName()) || t("tool.executeCommand")}</span>
        </span>
        <span class={markerClass(kind(), status(), selected())} title={getTraceStatusLabel(status())} />
        <span class="tool-card__status">{props.part.status ? getToolExecutionStatusLabel(props.part.status) : getTraceStatusLabel(status())}</span>
        <Show when={duration()}>
          <span class="tool-card__duration">{duration()}</span>
        </Show>
        <span class={`codicon codicon-chevron-${open() ? "down" : "right"}`} aria-hidden="true" />
      </button>

      <Show when={open()}>
        <div class="shell-card__main">
          <div class="shell-card__command" title={command()}>
            <span class="shell-card__prompt">$</span>
            <code>{command()}</code>
          </div>

          <Show when={props.part.approvalId}>
            <div class="shell-card__approval">
              <span class="codicon codicon-shield" aria-hidden="true" />
              <span>{props.part.approvalReason || t("tool.shell.needsApproval")}</span>
              <strong>{approvalDecisionLabel(props.part.approvalDecision, props.part.status)}</strong>
            </div>
          </Show>

          <div class="shell-terminal" ref={outputRef} role="log" aria-label="Shell 输出">
            <Show
              when={outputChunks().length > 0}
              fallback={<div class="shell-terminal__empty">{shellEmptyText(props.part.status)}</div>}
            >
              <For each={outputChunks()}>
                {(chunk) => (
                  <div
                    class="shell-terminal__chunk"
                    classList={{
                      "shell-terminal__chunk--stderr": chunk.stream === "stderr",
                      "shell-terminal__chunk--system": chunk.stream === "system",
                      "shell-terminal__chunk--result": chunk.stream === "result",
                    }}
                  >
                    <span class="shell-terminal__stream">{shellStreamLabel(chunk.stream)}</span>
                    <pre>{chunk.content}</pre>
                  </div>
                )}
              </For>
            </Show>
            <Show when={props.part.status === "running" || props.part.status === "approved"}>
              <div class="shell-terminal__cursor" aria-hidden="true">
                <span>▌</span>
              </div>
            </Show>
          </div>

          <Show when={hasDetails()}>
            <button
              type="button"
              class="shell-card__details-toggle"
              onClick={(event) => {
                event.stopPropagation()
                setDetailsOpen((value) => {
                  const next = !value
                  CARD_DETAILS_OPEN_STATE.set(props.part.id, next)
                  return next
                })
              }}
            >
              <span class={`codicon codicon-chevron-${detailsOpen() ? "down" : "right"}`} aria-hidden="true" />
              <span>{t("tool.section.details")}</span>
            </button>
          </Show>
        </div>

        <Show when={detailsOpen() && hasDetails()}>
          <div class="tool-card__details shell-card__details">
            <Show when={Object.keys(detailInput()).length > 0}>
              <ToolSection title={t("tool.section.params")}>
                <pre class="tool-card__code">{formatJson(detailInput())}</pre>
              </ToolSection>
            </Show>
            <Show when={props.part.approvalId}>
              <ToolSection title={t("tool.section.approval")}>
                <div class="shell-card__approval-detail">
                  <div class="shell-card__approval-detail-text">
                    <span>{props.part.approvalReason || t("tool.shell.needsApproval")}</span>
                    <Show when={approvalResultReasonForPart(props.part)}>
                      <span class="shell-card__approval-result">{approvalResultReasonForPart(props.part)}</span>
                    </Show>
                  </div>
                  <strong>{approvalDecisionLabel(props.part.approvalDecision, props.part.status)}</strong>
                </div>
              </ToolSection>
            </Show>
            <Show when={shouldShowShellFinalOutput(props.part.toolOutput, props.part.toolFinalOutput)}>
              <ToolSection title={t("tool.section.finalResult")}>
                <pre class="tool-card__output">{props.part.toolFinalOutput}</pre>
              </ToolSection>
            </Show>
            <Show when={props.part.toolResultMeta && Object.keys(props.part.toolResultMeta).length > 0}>
              <ToolSection title={t("tool.section.metadata")}>
                <pre class="tool-card__code">{formatJson(props.part.toolResultMeta)}</pre>
              </ToolSection>
            </Show>
            <Show when={props.part.toolOutputTruncated}>
              <div class="shell-card__truncation-note">{t("tool.shell.truncated")}</div>
            </Show>
          </div>
        </Show>
        <div class="message-action-row tool-card__actions shell-card__actions">
          <IconButton
            icon="copy"
            title={t("chat.copyCommand")}
            onClick={(event) => {
              event.stopPropagation()
              return props.onCopyToolCommand?.(props.part)
            }}
          />
          <Show when={props.part.toolOutput || props.part.toolFinalOutput || props.part.toolOutputChunks?.length}>
            <IconButton
              icon="copy"
              title={t("chat.copyToolOutput")}
              onClick={(event) => {
                event.stopPropagation()
                return props.onCopyToolOutput?.(props.part)
              }}
            />
          </Show>
          <Show when={canForkPart(props.part)}>
            <IconButton
              icon="git-branch"
              title={t("chat.forkFromHere")}
              onClick={(event) => {
                event.stopPropagation()
                props.onForkPart?.(props.part)
              }}
            />
          </Show>
        </div>
      </Show>
    </div>
  )
}

const TracePart: Component<PartProps> = (props) => {
  const kind = () => props.part.traceNodeKind || "thought_summary"
  const status = () => props.part.traceNodeStatus || "success"
  const selected = () => Boolean(props.part.traceNodeId && props.part.traceNodeId === props.selectedTraceNodeId)

  return (
    <button
      type="button"
      class="trace-event"
      classList={{ "trace-event--selected": selected() }}
      data-trace-node-id={props.part.traceNodeId}
      onClick={(event) => {
        event.stopPropagation()
        if (props.part.traceNodeId) props.onTraceNodeSelect?.(props.part.traceNodeId)
      }}
    >
      <span class={markerClass(kind(), status(), selected())} aria-hidden="true" />
      <span class="trace-event__body">
        <span class="trace-event__meta">
          {getTraceNodeKindLabel(kind())} · {getTraceStatusLabel(status())}
        </span>
        <Show when={props.part.traceTitle}>
          <span class="trace-event__title">{props.part.traceTitle}</span>
        </Show>
        <Show when={props.part.text}>
          <span class="trace-event__text">{props.part.text}</span>
        </Show>
      </span>
    </button>
  )
}

const SessionPart: Component<PartProps> = (props) => {
  const kind = () => props.part.traceNodeKind || (props.part.sessionKind === "delegated_run" ? "delegated_run_spawn" : "fork")
  const status = () => props.part.traceNodeStatus || "success"

  return (
    <button
      type="button"
      class="session-card"
      data-trace-node-id={props.part.traceNodeId}
      onClick={(event) => {
        event.stopPropagation()
        if (props.part.sessionId) {
          props.onSelectSession?.(props.part.sessionId)
          return
        }
        if (props.part.traceNodeId) props.onTraceNodeSelect?.(props.part.traceNodeId)
      }}
    >
      <span class={markerClass(kind(), status())} aria-hidden="true" />
      <span class="session-card__body">
        <span class="session-card__title">{props.part.sessionTitle || props.part.sessionId || t("tool.session.default")}</span>
        <Show when={props.part.sessionSummary}>
          <span class="session-card__summary">{props.part.sessionSummary}</span>
        </Show>
      </span>
    </button>
  )
}

const MarkdownText: Component<{ text?: string; format?: "plain" | "markdown"; streaming?: boolean }> = (props) => (
  <Show when={props.format === "markdown"} fallback={<div class="assistant-text-part">{props.text}</div>}>
    <MarkdownBlock text={props.text} streaming={props.streaming} />
  </Show>
)

const ReasoningPart: Component<PartProps> = (props) => {
  const [open, setOpen] = createSignal(initialCardOpenState(props.part.id, props.defaultReasoningOpen === true))
  createEffect(() => {
    CARD_OPEN_STATE.set(props.part.id, open())
  })
  const reasoningText = () => props.part.reasoningText || ""
  const countLabel = () => t("chat.reasoningChars", { n: String(reasoningText().length) })

  return (
    <div class="reasoning-card" onClick={(event) => event.stopPropagation()}>
      <button
        type="button"
        class="reasoning-card__header"
        onClick={(event) => {
          event.stopPropagation()
          setOpen((value) => {
            const next = !value
            CARD_OPEN_STATE.set(props.part.id, next)
            return next
          })
        }}
      >
        <span class="codicon codicon-comment-discussion" aria-hidden="true" />
        <span class="reasoning-card__body">
          <span class="reasoning-card__title">{t("chat.reasoning")}</span>
          <span class="reasoning-card__meta">{countLabel()}</span>
        </span>
        <span class={`codicon codicon-chevron-${open() ? "down" : "right"}`} aria-hidden="true" />
      </button>
      <Show when={open()}>
        <div class="reasoning-card__content">
          <Show
            when={props.part.reasoningFormat !== "plain"}
            fallback={<div class="assistant-text-part reasoning-card__plain">{reasoningText()}</div>}
          >
            <MarkdownBlock text={reasoningText()} class="reasoning-card__markdown" />
          </Show>
        </div>
      </Show>
    </div>
  )
}

const RemoteStatusPart: Component<PartProps> = (props) => {
  const [open, setOpen] = createSignal(initialCardOpenState(props.part.id, false))
  createEffect(() => {
    CARD_OPEN_STATE.set(props.part.id, open())
  })
  const fields = () => [
    ["Peer", props.part.remotePeerId],
    ["Main Agent", props.part.remoteMainAgentId],
    ["Agent Config", props.part.remoteAgentConfigId],
    ["Session", props.part.remoteSessionId],
    ["Fingerprint", props.part.remoteFingerprint],
    ["Workspace", props.part.remoteWorkspaceRoot],
  ].filter(([, value]) => value)

  return (
    <div class="remote-status-card" onClick={(event) => event.stopPropagation()}>
      <button
        type="button"
        class="remote-status-card__header"
        onClick={(event) => {
          event.stopPropagation()
          setOpen((value) => {
            const next = !value
            CARD_OPEN_STATE.set(props.part.id, next)
            return next
          })
        }}
      >
        <span class="codicon codicon-remote-explorer" aria-hidden="true" />
        <span class="remote-status-card__body">
          <span class="remote-status-card__title">{t("tool.remote.connected")}</span>
          <span class="remote-status-card__meta">
            {props.part.remoteMode || "-"} · {props.part.remoteModel || "-"}
          </span>
        </span>
        <span class={`codicon codicon-chevron-${open() ? "down" : "right"}`} aria-hidden="true" />
      </button>
      <Show when={open()}>
        <dl class="remote-status-card__details">
          <For each={fields()}>
            {([label, value]) => (
              <>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </>
            )}
          </For>
        </dl>
      </Show>
    </div>
  )
}

const TerminalPart: Component<PartProps> = (props) => {
  const [open, setOpen] = createSignal(initialCardOpenState(props.part.id, true))
  createEffect(() => {
    CARD_OPEN_STATE.set(props.part.id, open())
  })
  return (
    <div class="terminal-card" onClick={(event) => event.stopPropagation()}>
      <button
        type="button"
        class="terminal-card__header"
        onClick={(event) => {
          event.stopPropagation()
          setOpen((value) => {
            const next = !value
            CARD_OPEN_STATE.set(props.part.id, next)
            return next
          })
        }}
      >
        <span class="codicon codicon-terminal" aria-hidden="true" />
        <span>{props.part.terminalTitle || t("tool.terminal.default")}</span>
        <span class={`codicon codicon-chevron-${open() ? "down" : "right"}`} aria-hidden="true" />
      </button>
      <Show when={open()}>
        <pre class="terminal-card__content">{props.part.terminalContent}</pre>
      </Show>
    </div>
  )
}

const ViewPart: Component<PartProps> = (props) => {
  const [open, setOpen] = createSignal(initialCardOpenState(props.part.id, false))
  createEffect(() => {
    CARD_OPEN_STATE.set(props.part.id, open())
  })
  const summary = () => markdownSummary(props.part.viewPayload || {})
  return (
    <div class="view-card" onClick={(event) => event.stopPropagation()}>
      <button
        type="button"
        class="view-card__header"
        onClick={(event) => {
          event.stopPropagation()
          setOpen((value) => {
            const next = !value
            CARD_OPEN_STATE.set(props.part.id, next)
            return next
          })
        }}
      >
        <span class="codicon codicon-layout" aria-hidden="true" />
        <span class="view-card__body">
          <span class="view-card__title">{props.part.viewTitle || t("tool.view.default")}</span>
          <span class="view-card__meta">{props.part.viewType || "view"}</span>
        </span>
        <span class={`codicon codicon-chevron-${open() ? "down" : "right"}`} aria-hidden="true" />
      </button>
      <Show when={open()}>
        <div class="view-card__content">
          <Show when={summary()}>
            <MarkdownBlock text={summary()} class="structured-card__markdown" />
          </Show>
          <pre class="structured-card__json">{formatJson(props.part.viewPayload || {})}</pre>
        </div>
      </Show>
    </div>
  )
}

const ContextEventPart: Component<PartProps> = (props) => {
  const [open, setOpen] = createSignal(initialCardOpenState(props.part.id, false))
  createEffect(() => {
    CARD_OPEN_STATE.set(props.part.id, open())
  })
  const summary = () => markdownSummary(props.part.contextPayload || {})
  return (
    <div class="context-event-card" onClick={(event) => event.stopPropagation()}>
      <button
        type="button"
        class="context-event-card__header"
        onClick={(event) => {
          event.stopPropagation()
          setOpen((value) => {
            const next = !value
            CARD_OPEN_STATE.set(props.part.id, next)
            return next
          })
        }}
      >
        <span class="codicon codicon-file-submodule" aria-hidden="true" />
        <span class="context-event-card__body">
          <span class="context-event-card__title">{props.part.contextTitle || t("tool.context.default")}</span>
          <span class="context-event-card__meta">{String(props.part.contextPayload?.phase || props.part.contextPayload?.strategy || "")}</span>
        </span>
        <span class={`codicon codicon-chevron-${open() ? "down" : "right"}`} aria-hidden="true" />
      </button>
      <Show when={open()}>
        <div class="context-event-card__content">
          <Show when={summary()}>
            <MarkdownBlock text={summary()} class="structured-card__markdown" />
          </Show>
          <pre class="structured-card__json">{formatJson(props.part.contextPayload || {})}</pre>
        </div>
      </Show>
    </div>
  )
}

const MemoryContextPart: Component<PartProps> = (props) => {
  const [open, setOpen] = createSignal(initialCardOpenState(props.part.id, false))
  createEffect(() => {
    CARD_OPEN_STATE.set(props.part.id, open())
  })
  const payload = () => props.part.memoryPayload || {}
  const scope = () => recordPayload(payload().scope)
  const items = () => arrayRecordPayload(payload().items)
  const count = () => Number(payload().provided_items || items().length || 0)
  const renderedContext = () => stringPayload(payload().rendered_context)
  const scopeLabel = () => {
    const owner = stringPayload(scope().owner_agent_id)
    const namespace = stringPayload(scope().memory_namespace)
    if (owner && namespace && owner !== namespace) return `${owner}/${namespace}`
    return namespace || owner || "-"
  }
  const meta = () => {
    const version = payload().scope_version
    const versionLabel = version !== undefined && version !== null ? `v${String(version)}` : ""
    return [t("memoryContext.itemCount", { n: String(count()) }), scopeLabel(), versionLabel]
      .filter(Boolean)
      .join(" · ")
  }

  return (
    <div class="memory-context-card" onClick={(event) => event.stopPropagation()}>
      <button
        type="button"
        class="memory-context-card__header"
        onClick={(event) => {
          event.stopPropagation()
          setOpen((value) => {
            const next = !value
            CARD_OPEN_STATE.set(props.part.id, next)
            return next
          })
        }}
      >
        <span class="codicon codicon-database" aria-hidden="true" />
        <span class="memory-context-card__body">
          <span class="memory-context-card__title">{props.part.memoryTitle || t("memoryContext.title")}</span>
          <span class="memory-context-card__meta">{meta()}</span>
        </span>
        <span class={`codicon codicon-chevron-${open() ? "down" : "right"}`} aria-hidden="true" />
      </button>
      <Show when={open()}>
        <div class="memory-context-card__content">
          <Show when={items().length}>
            <div class="memory-context-card__items">
              <For each={items()}>
                {(item) => (
                  <div class="memory-context-card__item">
                    <div class="memory-context-card__item-head">
                      <span class="memory-context-card__type">{stringPayload(item.type) || "note"}</span>
                      <span class="memory-context-card__abstract">
                        {stringPayload(item.abstract) || stringPayload(item.id) || t("memoryContext.item")}
                      </span>
                    </div>
                    <Show when={stringPayload(item.content)}>
                      <div class="memory-context-card__item-content">{stringPayload(item.content)}</div>
                    </Show>
                  </div>
                )}
              </For>
            </div>
          </Show>
          <Show when={renderedContext()}>
            <div class="memory-context-card__prompt-title">{t("memoryContext.renderedContext")}</div>
            <pre class="structured-card__json">{renderedContext()}</pre>
          </Show>
        </div>
      </Show>
    </div>
  )
}

function getUiEventLabel(kind: string): string {
  const labels: Record<string, string> = {
    remote: t("uiEvent.remote"),
    mcp: "MCP",
    model: t("uiEvent.model"),
    session: t("uiEvent.session"),
    command: t("uiEvent.command"),
    approval: t("uiEvent.approval"),
    system: t("uiEvent.system"),
    agent: t("uiEvent.agent"),
  }
  return labels[kind] || kind
}
const UI_EVENT_ICONS: Record<string, string> = {
  remote: "remote-explorer",
  mcp: "server-process",
  model: "symbol-parameter",
  session: "history",
  command: "terminal",
  approval: "shield",
  system: "info",
  agent: "hubot",
}

const UiEventPart: Component<PartProps> = (props) => {
  const [open, setOpen] = createSignal(initialCardOpenState(props.part.id, false))
  createEffect(() => {
    CARD_OPEN_STATE.set(props.part.id, open())
  })
  const kind = () => props.part.uiEventKind || "system"
  const label = () => getUiEventLabel(kind()) || kind()
  const icon = () => UI_EVENT_ICONS[kind()] || "output"
  const level = () => props.part.uiEventLevel || "info"
  const summary = () => markdownSummary(props.part.uiEventPayload || {})

  return (
    <div class="ui-event-card" classList={{ [`ui-event-card--${level()}`]: true }} onClick={(event) => event.stopPropagation()}>
      <button
        type="button"
        class="ui-event-card__header"
        onClick={(event) => {
          event.stopPropagation()
          setOpen((value) => {
            const next = !value
            CARD_OPEN_STATE.set(props.part.id, next)
            return next
          })
        }}
      >
        <span class={`codicon codicon-${icon()}`} aria-hidden="true" />
        <span class="ui-event-card__body">
          <span class="ui-event-card__title">{props.part.uiEventTitle || label()}</span>
          <span class="ui-event-card__meta">{label()} · {level()}</span>
        </span>
        <span class={`codicon codicon-chevron-${open() ? "down" : "right"}`} aria-hidden="true" />
      </button>
      <Show when={open()}>
        <div class="ui-event-card__content">
          <Show when={summary()}>
            <MarkdownBlock text={summary()} class="structured-card__markdown" />
          </Show>
          <pre class="structured-card__json">{formatJson(props.part.uiEventPayload || {})}</pre>
        </div>
      </Show>
    </div>
  )
}

const PartView: Component<PartProps> = (props) => {
  return (
    <Switch
      fallback={
        <div class="parallel-card" onClick={(event) => event.stopPropagation()}>
          <div class="parallel-card__title">{props.part.parallelTitle || t("tool.parallel.default")}</div>
          <For each={props.part.parallelItems || []}>
            {(item) => (
              <PartView
                part={item}
                selectedTraceNodeId={props.selectedTraceNodeId}
                onSelectSession={props.onSelectSession}
                onTraceNodeSelect={props.onTraceNodeSelect}
                onCopyToolCommand={props.onCopyToolCommand}
                onCopyToolOutput={props.onCopyToolOutput}
                onForkPart={props.onForkPart}
                defaultReasoningOpen={props.defaultReasoningOpen}
              />
            )}
          </For>
        </div>
      }
    >
      <Match when={props.part.type === "text"}>
        <MarkdownText
          text={props.part.text}
          format={props.part.textFormat}
          streaming={props.part.textStreamKey === "assistant-stream"}
        />
      </Match>
      <Match when={props.part.type === "reasoning"}>
        <ReasoningPart {...props} />
      </Match>
      <Match when={props.part.type === "tool" && isShellToolName(props.part.tool, props.part.toolSource)}>
        <ShellToolPart {...props} />
      </Match>
      <Match when={props.part.type === "tool" && !isShellToolName(props.part.tool, props.part.toolSource)}>
        <ToolPart {...props} />
      </Match>
      <Match when={props.part.type === "trace"}>
        <TracePart {...props} />
      </Match>
      <Match when={props.part.type === "session"}>
        <SessionPart {...props} />
      </Match>
      <Match when={props.part.type === "remote_status"}>
        <RemoteStatusPart {...props} />
      </Match>
      <Match when={props.part.type === "terminal"}>
        <TerminalPart {...props} />
      </Match>
      <Match when={props.part.type === "view"}>
        <ViewPart {...props} />
      </Match>
      <Match when={props.part.type === "context_event"}>
        <ContextEventPart {...props} />
      </Match>
      <Match when={props.part.type === "memory_context"}>
        <MemoryContextPart {...props} />
      </Match>
      <Match when={props.part.type === "ui_event"}>
        <UiEventPart {...props} />
      </Match>
    </Switch>
  )
}

export const SessionTurn: Component<SessionTurnProps> = (props) => {
  const userSelected = () =>
    Boolean(props.turn.userMessage.traceNodeId && props.turn.userMessage.traceNodeId === props.selectedTraceNodeId)

  return (
    <article class="session-turn" data-message={props.turn.userMessage.id}>
      <div
        class="user-message"
        classList={{ "message--selected": userSelected() }}
        data-trace-node-id={props.turn.userMessage.traceNodeId}
        onClick={() => props.turn.userMessage.traceNodeId && props.onTraceNodeSelect?.(props.turn.userMessage.traceNodeId)}
      >
        <MessageMarker message={props.turn.userMessage} selected={userSelected()} />
        <div class="assistant-message__body">
          <div class="user-message__text">{props.turn.userMessage.text}</div>
          <div class="message-action-row">
            <Show when={props.onCopyMessage}>
              <IconButton
                icon="copy"
                title={t("chat.copyMessage")}
                onClick={(event) => {
                  event.stopPropagation()
                  return props.onCopyMessage?.(props.turn.userMessage)
                }}
              />
            </Show>
            <Show when={canEditForkMessage(props.turn.userMessage)}>
              <IconButton
                icon="edit"
                title={t("chat.editAndFork")}
                onClick={(event) => {
                  event.stopPropagation()
                  props.onEditForkMessage?.(props.turn.userMessage)
                }}
              />
            </Show>
          </div>
        </div>
      </div>

      <For each={props.turn.assistantMessages}>
        {(message) => {
          const selected = () => Boolean(message.traceNodeId && message.traceNodeId === props.selectedTraceNodeId)

          return (
            <div
              class="assistant-message"
              classList={{ "message--selected": selected() }}
              data-trace-node-id={message.traceNodeId}
              onClick={() => message.traceNodeId && props.onTraceNodeSelect?.(message.traceNodeId)}
            >
              <MessageMarker message={message} selected={selected()} />
              <div class="assistant-message__body">
                <For each={message.parts}>
                  {(part) => (
                    <PartView
                      part={part}
                      selectedTraceNodeId={props.selectedTraceNodeId}
                      onSelectSession={props.onSelectSession}
                      onTraceNodeSelect={props.onTraceNodeSelect}
                      onCopyToolCommand={props.onCopyToolCommand}
                      onCopyToolOutput={props.onCopyToolOutput}
                      onForkPart={props.onForkPart}
                      defaultReasoningOpen={props.defaultReasoningOpen}
                    />
                  )}
                </For>
                <div class="message-action-row">
                  <Show when={props.onCopyMessage}>
                    <IconButton
                      icon="copy"
                      title={t("chat.copyMessage")}
                      onClick={(event) => {
                        event.stopPropagation()
                        return props.onCopyMessage?.(message)
                      }}
                    />
                  </Show>
                  <Show when={canForkMessage(message)}>
                    <IconButton
                      icon="git-branch"
                      title={t("chat.forkFromHere")}
                      onClick={(event) => {
                        event.stopPropagation()
                        props.onForkMessage?.(message)
                      }}
                    />
                  </Show>
                  <Show when={message.traceNodeId}>
                    <IconButton icon="inspect" title={t("tool.locateTraceNode")} onClick={() => props.onTraceNodeSelect?.(message.traceNodeId as string)} />
                  </Show>
                </div>
              </div>
            </div>
          )
        }}
      </For>
    </article>
  )
}

function formatJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function parseJsonOrRaw(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

function markdownSummary(payload: Record<string, unknown>): string {
  const markdown = stringPayload(payload.markdown)
  if (markdown) return markdown
  const content = stringPayload(payload.content)
  if (content) return content
  const message = stringPayload(payload.message)
  return message
}

function recordPayload(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function arrayRecordPayload(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return []
  return value
    .map(recordPayload)
    .filter((item) => Object.keys(item).length > 0)
}

function stringPayload(value: unknown): string {
  return typeof value === "string" ? value : ""
}
