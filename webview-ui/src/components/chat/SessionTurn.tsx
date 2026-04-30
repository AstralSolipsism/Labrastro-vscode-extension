import { Component, For, Match, Show, Suspense, Switch, createSignal, lazy } from "solid-js"
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
import { ApprovalDetailsBody, approvalFromPayload } from "./ApprovalDetailsDialog"

const MarkdownBlock = lazy(async () => ({
  default: (await import("../common/MarkdownBlock")).MarkdownBlock,
}))

const TOOL_LABELS: Record<string, string> = {
  read_file: "读取文件",
  write_file: "写入文件",
  edit_file: "编辑文件",
  shell: "执行命令",
  grep: "搜索文本",
  glob: "匹配文件",
  mcp: "MCP 工具",
  agent: "子代理",
  spawn_agent: "启动子代理",
  send_input: "发送给子代理",
  wait_agent: "等待子代理",
  write_to_file: "写入文件",
  execute_command: "执行命令",
  list_directory: "列出目录",
  search_files: "搜索文件",
  apply_patch: "修改文件",
}

const TOOL_ICONS: Record<string, string> = {
  read_file: "file",
  write_file: "edit",
  edit_file: "diff-modified",
  shell: "terminal",
  grep: "search",
  glob: "symbol-file",
  mcp: "server-process",
  agent: "hubot",
  spawn_agent: "hubot",
  send_input: "send",
  wait_agent: "watch",
  write_to_file: "edit",
  execute_command: "terminal",
  list_directory: "list-tree",
  search_files: "search",
  apply_patch: "diff-modified",
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
  onTraceNodeSelect?: (nodeId: string) => void
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
  onTraceNodeSelect?: (nodeId: string) => void
}

const ToolPart: Component<PartProps> = (props) => {
  const [open, setOpen] = createSignal(
    ["running", "awaiting_approval", "denied", "error", "cancelled"].includes(props.part.status || "")
  )
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
    if (!props.part.toolStartedAt || !props.part.toolEndedAt) return ""
    const seconds = Math.max(0, props.part.toolEndedAt - props.part.toolStartedAt)
    if (seconds < 1) return `${Math.round(seconds * 1000)}ms`
    return `${seconds.toFixed(1)}s`
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
        "tool-card--awaiting": props.part.status === "awaiting_approval",
        "tool-card--error": props.part.status === "error",
        "tool-card--cancelled": props.part.status === "cancelled" || props.part.status === "denied",
      }}
      data-trace-node-id={props.part.traceNodeId}
    >
      <button
        type="button"
        class="tool-card__header"
        onClick={() => {
          if (props.part.traceNodeId) props.onTraceNodeSelect?.(props.part.traceNodeId)
          setOpen((value) => !value)
        }}
      >
        <span class="tool-card__icon">
          <span class={`codicon codicon-${TOOL_ICONS[toolName()] || "tools"}`} aria-hidden="true" />
        </span>
        <span class="tool-card__body">
          <span class="tool-card__title">{TOOL_LABELS[toolName()] || toolName()}</span>
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
            <ToolSection title="参数">
              <pre class="tool-card__code">{formatJson(props.part.toolInput)}</pre>
            </ToolSection>
          </Show>
          <Show when={props.part.approvalId}>
            <ToolSection title="审批">
              <div class="tool-card__approval">
                <span>{props.part.approvalReason || "该工具调用需要批准。"}</span>
                <Show when={props.part.approvalDecision}>
                  <strong>
                    {props.part.approvalDecision === "deny_once"
                      ? "已拒绝"
                      : props.part.approvalDecision === "auto_denied"
                        ? "自动拒绝"
                        : props.part.approvalDecision === "auto_approved"
                          ? "自动批准"
                          : "已批准"}
                  </strong>
                </Show>
              </div>
              <ApprovalDetailsBody approval={approvalDetails()} compact />
            </ToolSection>
          </Show>
          <Show when={props.part.toolOutput}>
            <ToolSection title={props.part.status === "running" ? "实时输出" : "结果"}>
              <ToolOutput part={props.part} />
            </ToolSection>
          </Show>
          <Show when={props.part.toolResultMeta && Object.keys(props.part.toolResultMeta).length > 0}>
            <ToolSection title="元数据">
              <pre class="tool-card__code">{formatJson(props.part.toolResultMeta)}</pre>
            </ToolSection>
          </Show>
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
      <Suspense fallback={<pre class="tool-card__output">{props.part.toolOutput}</pre>}>
        <MarkdownBlock text={props.part.toolOutput} class="tool-card__markdown" />
      </Suspense>
    </Match>
    <Match when={props.part.toolOutputFormat === "json"}>
      <pre class="tool-card__output">{formatJson(parseJsonOrRaw(props.part.toolOutput || ""))}</pre>
    </Match>
  </Switch>
)

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
      onClick={() => props.part.traceNodeId && props.onTraceNodeSelect?.(props.part.traceNodeId)}
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
  const kind = () => props.part.traceNodeKind || (props.part.sessionKind === "subagent" ? "subagent_spawn" : "fork")
  const status = () => props.part.traceNodeStatus || "success"

  return (
    <button
      type="button"
      class="session-card"
      data-trace-node-id={props.part.traceNodeId}
      onClick={() => props.part.traceNodeId && props.onTraceNodeSelect?.(props.part.traceNodeId)}
    >
      <span class={markerClass(kind(), status())} aria-hidden="true" />
      <span class="session-card__body">
        <span class="session-card__title">{props.part.sessionTitle || props.part.sessionId || "会话"}</span>
        <Show when={props.part.sessionSummary}>
          <span class="session-card__summary">{props.part.sessionSummary}</span>
        </Show>
      </span>
    </button>
  )
}

const MarkdownText: Component<{ text?: string; format?: "plain" | "markdown" }> = (props) => (
  <Show when={props.format === "markdown"} fallback={<div class="assistant-text-part">{props.text}</div>}>
    <Suspense fallback={<div class="assistant-text-part">{props.text}</div>}>
      <MarkdownBlock text={props.text} />
    </Suspense>
  </Show>
)

const RemoteStatusPart: Component<PartProps> = (props) => {
  const [open, setOpen] = createSignal(false)
  const fields = () => [
    ["Peer", props.part.remotePeerId],
    ["Session", props.part.remoteSessionId],
    ["Fingerprint", props.part.remoteFingerprint],
    ["Workspace", props.part.remoteWorkspaceRoot],
  ].filter(([, value]) => value)

  return (
    <div class="remote-status-card">
      <button type="button" class="remote-status-card__header" onClick={() => setOpen((value) => !value)}>
        <span class="codicon codicon-remote-explorer" aria-hidden="true" />
        <span class="remote-status-card__body">
          <span class="remote-status-card__title">远程会话已连接</span>
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
  const [open, setOpen] = createSignal(true)
  return (
    <div class="terminal-card">
      <button type="button" class="terminal-card__header" onClick={() => setOpen((value) => !value)}>
        <span class="codicon codicon-terminal" aria-hidden="true" />
        <span>{props.part.terminalTitle || "终端输出"}</span>
        <span class={`codicon codicon-chevron-${open() ? "down" : "right"}`} aria-hidden="true" />
      </button>
      <Show when={open()}>
        <pre class="terminal-card__content">{props.part.terminalContent}</pre>
      </Show>
    </div>
  )
}

const ViewPart: Component<PartProps> = (props) => {
  const [open, setOpen] = createSignal(false)
  const summary = () => markdownSummary(props.part.viewPayload || {})
  return (
    <div class="view-card">
      <button type="button" class="view-card__header" onClick={() => setOpen((value) => !value)}>
        <span class="codicon codicon-layout" aria-hidden="true" />
        <span class="view-card__body">
          <span class="view-card__title">{props.part.viewTitle || "结构化视图"}</span>
          <span class="view-card__meta">{props.part.viewType || "view"}</span>
        </span>
        <span class={`codicon codicon-chevron-${open() ? "down" : "right"}`} aria-hidden="true" />
      </button>
      <Show when={open()}>
        <div class="view-card__content">
          <Show when={summary()}>
            <Suspense fallback={<div class="structured-card__markdown">{summary()}</div>}>
              <MarkdownBlock text={summary()} class="structured-card__markdown" />
            </Suspense>
          </Show>
          <pre class="structured-card__json">{formatJson(props.part.viewPayload || {})}</pre>
        </div>
      </Show>
    </div>
  )
}

const ContextEventPart: Component<PartProps> = (props) => {
  const [open, setOpen] = createSignal(false)
  const summary = () => markdownSummary(props.part.contextPayload || {})
  return (
    <div class="context-event-card">
      <button type="button" class="context-event-card__header" onClick={() => setOpen((value) => !value)}>
        <span class="codicon codicon-file-submodule" aria-hidden="true" />
        <span class="context-event-card__body">
          <span class="context-event-card__title">{props.part.contextTitle || "上下文事件"}</span>
          <span class="context-event-card__meta">{String(props.part.contextPayload?.phase || props.part.contextPayload?.strategy || "")}</span>
        </span>
        <span class={`codicon codicon-chevron-${open() ? "down" : "right"}`} aria-hidden="true" />
      </button>
      <Show when={open()}>
        <div class="context-event-card__content">
          <Show when={summary()}>
            <Suspense fallback={<div class="structured-card__markdown">{summary()}</div>}>
              <MarkdownBlock text={summary()} class="structured-card__markdown" />
            </Suspense>
          </Show>
          <pre class="structured-card__json">{formatJson(props.part.contextPayload || {})}</pre>
        </div>
      </Show>
    </div>
  )
}

const UI_EVENT_LABELS: Record<string, string> = {
  remote: "远程",
  mcp: "MCP",
  model: "模型",
  session: "会话",
  command: "命令",
  approval: "审批",
  system: "系统",
  agent: "智能体",
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
  const [open, setOpen] = createSignal(false)
  const kind = () => props.part.uiEventKind || "system"
  const label = () => UI_EVENT_LABELS[kind()] || kind()
  const icon = () => UI_EVENT_ICONS[kind()] || "output"
  const level = () => props.part.uiEventLevel || "info"
  const summary = () => markdownSummary(props.part.uiEventPayload || {})

  return (
    <div class="ui-event-card" classList={{ [`ui-event-card--${level()}`]: true }}>
      <button type="button" class="ui-event-card__header" onClick={() => setOpen((value) => !value)}>
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
            <Suspense fallback={<div class="structured-card__markdown">{summary()}</div>}>
              <MarkdownBlock text={summary()} class="structured-card__markdown" />
            </Suspense>
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
        <div class="parallel-card">
          <div class="parallel-card__title">{props.part.parallelTitle || "并发批次"}</div>
          <For each={props.part.parallelItems || []}>
            {(item) => (
              <PartView
                part={item}
                selectedTraceNodeId={props.selectedTraceNodeId}
                onTraceNodeSelect={props.onTraceNodeSelect}
              />
            )}
          </For>
        </div>
      }
    >
      <Match when={props.part.type === "text"}>
        <MarkdownText text={props.part.text} format={props.part.textFormat} />
      </Match>
      <Match when={props.part.type === "tool"}>
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
        <div class="user-message__text">{props.turn.userMessage.text}</div>
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
                <div class="message-action-row">
                  <Show when={message.traceNodeId}>
                    <IconButton icon="inspect" title="定位轨迹节点" onClick={() => props.onTraceNodeSelect?.(message.traceNodeId as string)} />
                  </Show>
                </div>
                <For each={message.parts}>
                  {(part) => (
                    <PartView
                      part={part}
                      selectedTraceNodeId={props.selectedTraceNodeId}
                      onTraceNodeSelect={props.onTraceNodeSelect}
                    />
                  )}
                </For>
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

function stringPayload(value: unknown): string {
  return typeof value === "string" ? value : ""
}
