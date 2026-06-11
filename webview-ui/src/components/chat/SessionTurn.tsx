import { Component, For, Index, Match, Show, Switch, createEffect, createMemo, createSignal, type Accessor, type JSX, type Setter } from "solid-js"
import { t } from "../../i18n"
import type { MockTaskStats, MockTurn, MockMessage } from "./mock-data"
import type {
  AssistantTextItem,
  NoticeItem,
  RawEventRef,
  ReasoningItem,
  ThinkingItem,
  ToolActivityItem,
  TranscriptItem,
  WorkflowArtifactItem,
  WorkflowDecisionItem,
  WorkflowResultItem,
  WorkflowStepItem,
} from "./transcript-model"
import {
  groupCapabilityPackageComponents,
  manualStepUserActionLabel,
  runtimeFootprintLabel,
  type CapabilityComponentView,
} from "../../settings/capabilityPackageView"
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
import { rawAuditEventKey, type RawAuditEventSnapshot } from "../../chat/raw-audit"
import {
  extractShellCommand,
  isShellToolName,
  shellChunksFromText,
  shouldShowShellFinalOutput,
  type ShellOutputChunk,
  type ShellOutputStream,
} from "../../utils/shell-tool-output"
import {
  buildTranscriptPresentation,
  getToolActionLabel,
  processTimelineItemKey,
  transcriptPresentationItemKey,
  type ProcessGroup,
  type ProcessSummary,
  type ProcessState,
  type ProcessTimelineItem,
  type ReasoningPanel,
  type TranscriptPresentationItem,
} from "./transcript-presentation"
import { RoseFourLoader } from "./RoseFourLoader"

const TOOL_ICONS: Record<string, string> = {
  read_file: "file",
  read_files: "file",
  write_file: "edit",
  edit_file: "diff-modified",
  shell: "terminal",
  grep: "search",
  glob: "symbol-file",
  mcp: "server-process",
  delegate_agent: "hubot",
  write_to_file: "edit",
  execute_command: "terminal",
  list_file: "list-tree",
  list_files: "list-tree",
  list_directory: "list-tree",
  search_file: "search",
  search_files: "search",
  apply_patch: "diff-modified",
  install_capability_package: "package",
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

function createCardOpenState(
  partId: string,
  fallback: boolean,
  forceOpen?: Accessor<boolean>,
): [Accessor<boolean>, Setter<boolean>] {
  const [open, setOpen] = createSignal(initialCardOpenState(partId, fallback))
  createEffect(() => {
    if (forceOpen?.()) {
      setOpen(true)
      CARD_OPEN_STATE.set(partId, true)
    }
  })
  createEffect(() => {
    CARD_OPEN_STATE.set(partId, open())
  })
  return [open, setOpen]
}

interface KeyedRecord<T> {
  key: string
  item: Accessor<T>
  setItem: Setter<T>
  index: Accessor<number>
  setIndex: Setter<number>
}

const KeyedFor = <T,>(props: {
  each: readonly T[]
  key: (item: T, index: number) => string
  children: (item: Accessor<T>, index: Accessor<number>) => JSX.Element
}) => {
  const records = new Map<string, KeyedRecord<T>>()
  const syncRecords = () => {
    const activeKeys = new Set<string>()
    const next = props.each.map((item, index) => {
      const baseKey = props.key(item, index) || String(index)
      let key = baseKey
      let duplicateIndex = 1
      while (activeKeys.has(key)) {
        duplicateIndex += 1
        key = `${baseKey}:${duplicateIndex}`
      }
      activeKeys.add(key)

      let record = records.get(key)
      if (!record) {
        const [itemSignal, setItem] = createSignal<T>(item, { equals: false })
        const [indexSignal, setIndex] = createSignal(index)
        record = { key, item: itemSignal, setItem, index: indexSignal, setIndex }
        records.set(key, record)
      } else {
        record.setItem(() => item)
        record.setIndex(index)
      }
      return record
    })

    for (const key of Array.from(records.keys())) {
      if (!activeKeys.has(key)) records.delete(key)
    }
    return next
  }
  const [ordered, setOrdered] = createSignal<KeyedRecord<T>[]>(syncRecords())

  createEffect(() => {
    setOrdered(() => syncRecords())
  })

  return (
    <For each={ordered()}>
      {(record) => props.children(record.item, record.index)}
    </For>
  )
}

function traceKindForPart(part: TranscriptItem): TraceNodeKind {
  return part.traceNodeKind || inferTraceNodeKindFromToolName(part.type === "tool" ? part.tool : undefined)
}

function traceStatusForPart(part: TranscriptItem) {
  if (part.traceNodeStatus) return part.traceNodeStatus
  if (part.type === "tool") return TOOL_STATUS_TO_TRACE_STATUS[part.status || "pending"]
  if (part.type === "session") return part.state === "error" ? "error" : "success"
  return "success"
}

function toolDurationLabel(part: ToolActivityItem): string {
  if (!part.startedAt || !part.endedAt) return ""
  const seconds = Math.max(0, part.endedAt - part.startedAt)
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

function processStateLabel(state: ProcessState): string {
  if (state === "running") return t("process.state.running")
  if (state === "error") return t("process.state.error")
  return t("process.state.completed")
}

function processCountLabel(count: number): string {
  return t("process.itemCount", { n: String(count) })
}

function processFailureLabel(count: number): string {
  return t("process.failedCount", { n: String(count) })
}

function formatLargeNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}m`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

function defaultProcessGroupOpen(group: ProcessGroup): boolean {
  return group.isWorkflow === true || group.state === "running" || group.state === "error"
}

function defaultProcessSummaryOpen(summary: ProcessSummary): boolean {
  return summary.isWorkflow === true || summary.state === "running" || summary.state === "error"
}

function processMetaLabel(
  state: ProcessState,
  count: number,
  failureCount: number,
  currentLabel?: string,
): string {
  if (state === "running") {
    return [
      processStateLabel(state),
      currentLabel ? t("process.current", { value: currentLabel }) : "",
      processCountLabel(count),
    ].filter(Boolean).join(" · ")
  }
  if (state === "error") {
    return [
      processStateLabel(state),
      currentLabel ? t("process.current", { value: currentLabel }) : "",
      failureCount ? processFailureLabel(failureCount) : "",
      processCountLabel(count),
    ].filter(Boolean).join(" · ")
  }
  return [
    currentLabel ? t("process.current", { value: currentLabel }) : "",
    failureCount ? processFailureLabel(failureCount) : "",
    processCountLabel(count),
  ].filter(Boolean).join(" · ")
}

function shouldOpenApprovalCard(part: ToolActivityItem): boolean {
  return Boolean(part.approvalId && part.status === "awaiting_approval")
}

function approvalPrimaryText(part: ToolActivityItem, fallback: string): string {
  return part.approvalIntent || part.approvalReason || fallback
}

function approvalSecondaryText(part: ToolActivityItem): string {
  const primary = (part.approvalIntent || "").trim()
  const reason = (part.approvalReason || "").trim()
  if (!reason || reason === primary) return ""
  return reason
}

export type WorkflowUsageSnapshot = Pick<
  MockTaskStats,
  "tokensIn" | "tokensOut" | "cacheReads" | "cacheWrites" | "contextTokens" | "contextWindow" | "maxOutputTokens"
>

function workflowUsageMetricLabels(
  usage: WorkflowUsageSnapshot | undefined,
  state: ProcessState,
): string[] {
  const labels: string[] = []
  if (usage?.contextWindow && usage.contextWindow > 0) {
    labels.push(t("task.contextUsed", {
      used: formatLargeNumber(Math.max(0, usage.contextTokens || 0)),
      total: formatLargeNumber(usage.contextWindow),
    }))
  }
  if (usage && (usage.tokensIn > 0 || usage.tokensOut > 0)) {
    labels.push(t("process.metrics.tokens", {
      input: formatLargeNumber(Math.max(0, usage.tokensIn || 0)),
      output: formatLargeNumber(Math.max(0, usage.tokensOut || 0)),
    }))
  }
  const cacheReads = typeof usage?.cacheReads === "number" ? Math.max(0, usage.cacheReads) : null
  const cacheWrites = typeof usage?.cacheWrites === "number" ? Math.max(0, usage.cacheWrites) : null
  if ((cacheReads !== null && cacheReads > 0) || (cacheWrites !== null && cacheWrites > 0)) {
    labels.push(t("task.cacheHitSlash", {
      hit: formatLargeNumber(cacheReads || 0),
      write: formatLargeNumber(cacheWrites || 0),
    }))
  }
  if (!labels.length && state === "running") labels.push(t("process.metrics.waiting"))
  return labels
}

interface SessionTurnProps {
  turn: MockTurn
  selectedTraceNodeId?: string | null
  onSelectSession?: (sessionId: string) => void
  onTraceNodeSelect?: (nodeId: string) => void
  onCopyMessage?: (message: MockMessage) => Promise<void> | void
  onEditForkMessage?: (message: MockMessage) => void
  onForkMessage?: (message: MockMessage) => void
  onCopyToolCommand?: (part: ToolActivityItem) => Promise<void> | void
  onCopyToolOutput?: (part: ToolActivityItem) => Promise<void> | void
  onForkPart?: (part: TranscriptItem) => void
  onLoadRawAuditEvents?: (refs: RawEventRef[]) => void
  rawAuditEvents?: Record<string, RawAuditEventSnapshot>
  defaultReasoningOpen?: boolean
  runningProcessLabel?: string
  usageSnapshot?: WorkflowUsageSnapshot
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
  part: TranscriptItem
  selectedTraceNodeId?: string | null
  onSelectSession?: (sessionId: string) => void
  onTraceNodeSelect?: (nodeId: string) => void
  onCopyToolCommand?: (part: ToolActivityItem) => Promise<void> | void
  onCopyToolOutput?: (part: ToolActivityItem) => Promise<void> | void
  onForkPart?: (part: TranscriptItem) => void
  onLoadRawAuditEvents?: (refs: RawEventRef[]) => void
  rawAuditEvents?: Record<string, RawAuditEventSnapshot>
  defaultReasoningOpen?: boolean
}

type ItemProps<T extends TranscriptItem> = Omit<PartProps, "part"> & { part: T }

const ToolPart: Component<ItemProps<ToolActivityItem>> = (props) => {
  const openKey = `tool:${props.part.id}`
  const detailsKey = `tool:${props.part.id}:details`
  const [open, setOpen] = createCardOpenState(
    openKey,
    shouldOpenApprovalCard(props.part),
    () => shouldOpenApprovalCard(props.part),
  )
  const [detailsOpen, setDetailsOpen] = createSignal(initialCardDetailsOpenState(detailsKey, false))
  createEffect(() => {
    CARD_DETAILS_OPEN_STATE.set(detailsKey, detailsOpen())
  })
  const kind = () => traceKindForPart(props.part)
  const status = () => traceStatusForPart(props.part)
  const selected = () => Boolean(props.part.traceNodeId && props.part.traceNodeId === props.selectedTraceNodeId)
  const toolName = () => props.part.tool || "tool"
  const duration = () => {
    return toolDurationLabel(props.part)
  }
  const approvalDetails = () => approvalFromPayload({}, {
    approvalId: props.part.approvalId,
    toolCallId: props.part.toolCallId,
    toolName: toolName(),
    toolSource: props.part.source,
    reason: props.part.approvalReason,
    intent: props.part.approvalIntent,
    content: props.part.approvalContent,
    toolArgs: props.part.input || {},
    sections: props.part.approvalSections || [],
  })
  const hasInput = () => Boolean(props.part.input && Object.keys(props.part.input).length > 0)
  const hasOutput = () => Boolean(props.part.output)
  const hasMetadata = () => Boolean(props.part.resultMeta && Object.keys(props.part.resultMeta).length > 0)
  const hasRawAudit = () => rawAuditRefsForPart(props.part).length > 0
  const hasDetails = () => hasInput() || hasOutput() || Boolean(props.part.approvalId) || hasMetadata() || hasRawAudit()

  return (
    <div
      class="tool-card"
      classList={{
        "tool-card--selected": selected(),
        "tool-card--awaiting": props.part.status === "preparing" || props.part.status === "pending" || props.part.status === "awaiting_approval",
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
            CARD_OPEN_STATE.set(openKey, next)
            return next
          })
        }}
      >
        <span class="tool-card__icon">
          <span class={`codicon codicon-${TOOL_ICONS[toolName()] || "tools"}`} aria-hidden="true" />
        </span>
        <span class="tool-card__body">
          <span class="tool-card__title">{getToolActionLabel(toolName())}</span>
        </span>
        <span class={markerClass(kind(), status(), selected())} title={getTraceStatusLabel(status())} />
        <span class="tool-card__status">{props.part.status ? getToolExecutionStatusLabel(props.part.status) : getTraceStatusLabel(status())}</span>
        <Show when={duration()}>
          <span class="tool-card__duration">{duration()}</span>
        </Show>
        <span class={`codicon codicon-chevron-${open() ? "down" : "right"}`} aria-hidden="true" />
      </button>
      <Show when={open()}>
        <div class="tool-card__preview">
          <Show when={hasInput()}>
            <ToolSection title={t("tool.section.params")}>
              <pre class="tool-card__code tool-card__preview-block">{formatJson(props.part.input)}</pre>
            </ToolSection>
          </Show>
          <Show when={hasOutput()}>
            <ToolSection title={props.part.status === "running" ? t("tool.section.liveOutput") : t("tool.section.result")}>
              <ToolOutput part={props.part} preview />
            </ToolSection>
          </Show>
          <Show when={props.part.approvalId}>
            <ToolSection title={t("tool.section.approval")}>
              <div class="tool-card__approval">
                <div class="tool-card__approval-main">
                  <span>{approvalPrimaryText(props.part, t("tool.approval.needsApproval"))}</span>
                  <strong>{approvalDecisionLabel(props.part.approvalDecision, props.part.status)}</strong>
                </div>
                <Show when={approvalSecondaryText(props.part)}>
                  <div class="tool-card__approval-result">{approvalSecondaryText(props.part)}</div>
                </Show>
                <Show when={approvalResultReasonForPart(props.part)}>
                  <div class="tool-card__approval-result">{approvalResultReasonForPart(props.part)}</div>
                </Show>
              </div>
            </ToolSection>
          </Show>
          <Show when={hasDetails()}>
            <button
              type="button"
              class="shell-card__details-toggle"
              onClick={(event) => {
                event.stopPropagation()
                setDetailsOpen((value) => {
                  const next = !value
                  CARD_DETAILS_OPEN_STATE.set(detailsKey, next)
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
          <div class="tool-card__details">
            <Show when={hasInput()}>
              <ToolSection title={t("tool.section.params")}>
                <pre class="tool-card__code">{formatJson(props.part.input)}</pre>
              </ToolSection>
            </Show>
            <Show when={props.part.approvalId}>
              <ToolSection title={t("tool.section.approval")}>
                <div class="tool-card__approval">
                  <div class="tool-card__approval-main">
                    <span>{approvalPrimaryText(props.part, t("tool.approval.needsApproval"))}</span>
                    <Show when={props.part.approvalDecision}>
                      <strong>{approvalDecisionLabel(props.part.approvalDecision, props.part.status)}</strong>
                    </Show>
                  </div>
                  <Show when={approvalSecondaryText(props.part)}>
                    <div class="tool-card__approval-result">{approvalSecondaryText(props.part)}</div>
                  </Show>
                  <Show when={approvalResultReasonForPart(props.part)}>
                    <div class="tool-card__approval-result">{approvalResultReasonForPart(props.part)}</div>
                  </Show>
                </div>
                <ApprovalDetailsBody approval={approvalDetails()} compact />
              </ToolSection>
            </Show>
            <Show when={hasOutput()}>
              <ToolSection title={props.part.status === "running" ? t("tool.section.liveOutput") : t("tool.section.result")}>
                <ToolOutput part={props.part} />
              </ToolSection>
            </Show>
            <Show when={hasMetadata()}>
              <ToolSection title={t("tool.section.metadata")}>
                <pre class="tool-card__code">{formatJson(props.part.resultMeta)}</pre>
              </ToolSection>
            </Show>
            <RawAuditRefs
              part={props.part}
              rawAuditEvents={props.rawAuditEvents}
              onLoadRawAuditEvents={props.onLoadRawAuditEvents}
            />
          </div>
        </Show>
        <div class="tool-card__footer">
          <div class="message-action-row tool-card__actions">
            <Show when={props.part.output}>
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

const RawAuditRefs: Component<{
  part: TranscriptItem
  rawAuditEvents?: Record<string, RawAuditEventSnapshot>
  onLoadRawAuditEvents?: (refs: RawEventRef[]) => void
}> = (props) => {
  const refs = () => rawAuditRefsForPart(props.part)
  const key = () => rawAuditEventKey(refs())
  const details = () => props.rawAuditEvents?.[key()]
  return (
    <Show when={refs().length > 0}>
      <ToolSection title={t("tool.section.rawAudit")}>
        <Show when={props.onLoadRawAuditEvents}>
          <button
            type="button"
            class="shell-card__details-toggle"
            onClick={(event) => {
              event.stopPropagation()
              props.onLoadRawAuditEvents?.(refs())
            }}
          >
            <span class="codicon codicon-list-tree" aria-hidden="true" />
            <span>{details()?.loading ? t("tool.rawAudit.loading") : t("tool.rawAudit.load")}</span>
          </button>
        </Show>
        <pre class="tool-card__code">{formatJson({ raw_event_refs: refs() })}</pre>
        <Show when={details()?.error}>
          <div class="shell-card__truncation-note">{details()?.error}</div>
        </Show>
        <Show when={details()?.events?.length}>
          <pre class="tool-card__code">{formatJson({ events: details()?.events })}</pre>
        </Show>
      </ToolSection>
    </Show>
  )
}

const ToolOutput: Component<{ part: ToolActivityItem; preview?: boolean }> = (props) => (
  <Switch fallback={<pre classList={{ "tool-card__output": true, "tool-card__preview-block": props.preview === true }}>{props.part.output}</pre>}>
    <Match when={props.part.outputFormat === "markdown"}>
      <MarkdownBlock
        text={props.part.output}
        class={`tool-card__markdown${props.preview ? " tool-card__preview-block" : ""}`}
      />
    </Match>
    <Match when={props.part.outputFormat === "json"}>
      <pre classList={{ "tool-card__output": true, "tool-card__preview-block": props.preview === true }}>
        {formatJson(parseJsonOrRaw(props.part.output || ""))}
      </pre>
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

function approvalResultReasonForPart(part: ToolActivityItem): string | undefined {
  const resultReason = (part.approvalResultReason || "").trim()
  if (!resultReason) return undefined
  if (resultReason === (part.approvalReason || "").trim()) return undefined
  return resultReason
}

function shellEmptyText(status?: string): string {
  if (status === "preparing") return t("tool.preparingGeneric")
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

const ShellToolPart: Component<ItemProps<ToolActivityItem>> = (props) => {
  const openKey = `tool:${props.part.id}`
  const detailsKey = `tool:${props.part.id}:details`
  const [open, setOpen] = createCardOpenState(
    openKey,
    shouldOpenApprovalCard(props.part),
    () => shouldOpenApprovalCard(props.part),
  )
  const [detailsOpen, setDetailsOpen] = createSignal(initialCardDetailsOpenState(detailsKey, false))
  createEffect(() => {
    CARD_DETAILS_OPEN_STATE.set(detailsKey, detailsOpen())
  })
  const kind = () => traceKindForPart(props.part)
  const status = () => traceStatusForPart(props.part)
  const selected = () => Boolean(props.part.traceNodeId && props.part.traceNodeId === props.selectedTraceNodeId)
  const toolName = () => props.part.tool || "shell"
  const command = createMemo(() => extractShellCommand(props.part.input) || t("tool.shell.commandUnavailable"))
  const duration = () => toolDurationLabel(props.part)
  const detailInput = createMemo(() => omitShellCommandFields(props.part.input))
  const outputChunks = createMemo<ShellOutputChunk[]>(() => {
    if (props.part.outputChunks?.length) return props.part.outputChunks
    return shellChunksFromText(props.part.output || props.part.finalOutput || "")
  })
  const hasDetails = () =>
    Boolean(
      Object.keys(detailInput()).length > 0 ||
      props.part.approvalId ||
      props.part.resultMeta && Object.keys(props.part.resultMeta).length > 0 ||
      shouldShowShellFinalOutput(props.part.output, props.part.finalOutput) ||
      rawAuditRefsForPart(props.part).length > 0,
    )

  let outputRef: HTMLDivElement | undefined
  createEffect(() => {
    outputChunks().length
    props.part.output
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
        "tool-card--awaiting": props.part.status === "preparing" || props.part.status === "pending" || props.part.status === "awaiting_approval",
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
            CARD_OPEN_STATE.set(openKey, next)
            return next
          })
        }}
      >
        <span class="tool-card__icon">
          <span class="codicon codicon-terminal" aria-hidden="true" />
        </span>
        <span class="tool-card__body">
          <span class="tool-card__title">{getToolActionLabel(toolName()) || t("tool.executeCommand")}</span>
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
              <span>{approvalPrimaryText(props.part, t("tool.shell.needsApproval"))}</span>
              <Show when={approvalSecondaryText(props.part)}>
                <span class="shell-card__approval-result">{approvalSecondaryText(props.part)}</span>
              </Show>
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
                  CARD_DETAILS_OPEN_STATE.set(detailsKey, next)
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
                    <span>{approvalPrimaryText(props.part, t("tool.shell.needsApproval"))}</span>
                    <Show when={approvalSecondaryText(props.part)}>
                      <span class="shell-card__approval-result">{approvalSecondaryText(props.part)}</span>
                    </Show>
                    <Show when={approvalResultReasonForPart(props.part)}>
                      <span class="shell-card__approval-result">{approvalResultReasonForPart(props.part)}</span>
                    </Show>
                  </div>
                  <strong>{approvalDecisionLabel(props.part.approvalDecision, props.part.status)}</strong>
                </div>
              </ToolSection>
            </Show>
            <Show when={shouldShowShellFinalOutput(props.part.output, props.part.finalOutput)}>
              <ToolSection title={t("tool.section.finalResult")}>
                <pre class="tool-card__output">{props.part.finalOutput}</pre>
              </ToolSection>
            </Show>
            <Show when={props.part.resultMeta && Object.keys(props.part.resultMeta).length > 0}>
              <ToolSection title={t("tool.section.metadata")}>
                <pre class="tool-card__code">{formatJson(props.part.resultMeta)}</pre>
              </ToolSection>
            </Show>
            <RawAuditRefs
              part={props.part}
              rawAuditEvents={props.rawAuditEvents}
              onLoadRawAuditEvents={props.onLoadRawAuditEvents}
            />
            <Show when={props.part.outputTruncated}>
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
          <Show when={props.part.output || props.part.finalOutput || props.part.outputChunks?.length}>
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

const TracePart: Component<ItemProps<Extract<TranscriptItem, { type: "trace" }>>> = (props) => {
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
        <Show when={props.part.title}>
          <span class="trace-event__title">{props.part.title}</span>
        </Show>
        <Show when={props.part.text}>
          <span class="trace-event__text">{props.part.text}</span>
        </Show>
      </span>
    </button>
  )
}

const SessionPart: Component<ItemProps<Extract<TranscriptItem, { type: "session" }>>> = (props) => {
  const kind = () => props.part.traceNodeKind || (props.part.kind === "delegated_run" ? "delegated_run_spawn" : "fork")
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
        <span class="session-card__title">{props.part.title || props.part.sessionId || t("tool.session.default")}</span>
        <Show when={props.part.summary}>
          <span class="session-card__summary">{props.part.summary}</span>
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

const ReasoningTextBlock: Component<{ text: string }> = (props) => (
  <pre class="reasoning-card__plain">{props.text}</pre>
)

const ThinkingPart: Component<ItemProps<ThinkingItem>> = (props) => {
  const detail = () => props.part.detail || props.part.raw || ""
  return (
    <div class="thinking-row" onClick={(event) => event.stopPropagation()}>
      <span class="codicon codicon-loading codicon-modifier-spin" aria-hidden="true" />
      <span class="thinking-row__title">{props.part.title}</span>
      <Show when={detail()}>
        <span class="thinking-row__detail">{detail()}</span>
      </Show>
    </div>
  )
}

const ReasoningPart: Component<ItemProps<ReasoningItem>> = (props) => {
  const [open, setOpen] = createSignal(initialCardOpenState(props.part.id, false))
  createEffect(() => {
    CARD_OPEN_STATE.set(props.part.id, open())
  })
  const detailsText = () => props.part.raw || props.part.summary || ""

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
          <Show when={props.part.summary}>
            <span class="reasoning-card__meta">{props.part.summary}</span>
          </Show>
        </span>
        <span class={`codicon codicon-chevron-${open() ? "down" : "right"}`} aria-hidden="true" />
      </button>
      <Show when={open()}>
        <div class="reasoning-card__content">
          <ReasoningTextBlock text={detailsText()} />
        </div>
      </Show>
    </div>
  )
}

interface ReasoningPanelPartProps {
  panel: ReasoningPanel
  defaultReasoningOpen?: boolean
}

const ReasoningPanelPart: Component<ReasoningPanelPartProps> = (props) => {
  const [open, setOpen] = createSignal(initialCardOpenState(props.panel.id, props.defaultReasoningOpen === true))
  let contentRef: HTMLDivElement | undefined
  createEffect(() => {
    CARD_OPEN_STATE.set(props.panel.id, open())
  })
  createEffect(() => {
    props.panel.raw
    props.panel.state
    if (!open() || props.panel.state !== "running" || !contentRef) return
    queueMicrotask(() => {
      if (contentRef) contentRef.scrollTop = contentRef.scrollHeight
    })
  })
  const title = () => props.panel.state === "running" ? t("process.group.reasoning.running") : t("process.group.reasoning")
  const detailsText = () => props.panel.raw || props.panel.summary || ""

  return (
    <div
      class="reasoning-card"
      classList={{ "reasoning-card--running": props.panel.state === "running" }}
      onClick={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        class="reasoning-card__header"
        onClick={(event) => {
          event.stopPropagation()
          setOpen((value) => {
            const next = !value
            CARD_OPEN_STATE.set(props.panel.id, next)
            return next
          })
        }}
      >
        {props.panel.state === "running" ? (
          <RoseFourLoader class="process-card__loader" />
        ) : (
          <span class="codicon codicon-comment-discussion" aria-hidden="true" />
        )}
        <span class="reasoning-card__body">
          <span class="reasoning-card__title">{title()}</span>
          <Show when={props.panel.summary}>
            <span class="reasoning-card__meta">{props.panel.summary}</span>
          </Show>
        </span>
        <span class={`codicon codicon-chevron-${open() ? "down" : "right"}`} aria-hidden="true" />
      </button>
      <Show when={open()}>
        <div class="reasoning-card__content" ref={contentRef}>
          <ReasoningTextBlock text={detailsText()} />
        </div>
      </Show>
    </div>
  )
}

const NoticePart: Component<ItemProps<NoticeItem>> = (props) => (
  <div class="notice-row" classList={{ [`notice-row--${props.part.level}`]: true }} onClick={(event) => event.stopPropagation()}>
    <span class={`codicon codicon-${props.part.level === "error" ? "error" : props.part.level === "warning" ? "warning" : "info"}`} aria-hidden="true" />
    <Show when={props.part.format === "markdown"} fallback={<span>{props.part.text}</span>}>
      <MarkdownBlock text={props.part.text} class="notice-row__markdown" />
    </Show>
  </div>
)

const TerminalPart: Component<ItemProps<Extract<TranscriptItem, { type: "terminal" }>>> = (props) => {
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
        <span>{props.part.title || t("tool.terminal.default")}</span>
        <span class={`codicon codicon-chevron-${open() ? "down" : "right"}`} aria-hidden="true" />
      </button>
      <Show when={open()}>
        <pre class="terminal-card__content">{props.part.content}</pre>
      </Show>
    </div>
  )
}

const ViewPart: Component<ItemProps<Extract<TranscriptItem, { type: "view" }>>> = (props) => {
  const [open, setOpen] = createSignal(initialCardOpenState(props.part.id, false))
  createEffect(() => {
    CARD_OPEN_STATE.set(props.part.id, open())
  })
  const summary = () => markdownSummary(props.part.payload || {})
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
          <span class="view-card__title">{props.part.title || t("tool.view.default")}</span>
          <span class="view-card__meta">{props.part.viewType || "view"}</span>
        </span>
        <span class={`codicon codicon-chevron-${open() ? "down" : "right"}`} aria-hidden="true" />
      </button>
      <Show when={open()}>
        <div class="view-card__content">
          <Show when={summary()}>
            <MarkdownBlock text={summary()} class="structured-card__markdown" />
          </Show>
          <pre class="structured-card__json">{formatJson(props.part.payload || {})}</pre>
          <RawAuditRefs
            part={props.part}
            rawAuditEvents={props.rawAuditEvents}
            onLoadRawAuditEvents={props.onLoadRawAuditEvents}
          />
        </div>
      </Show>
    </div>
  )
}

const ContextEventPart: Component<ItemProps<Extract<TranscriptItem, { type: "context_event" }>>> = (props) => {
  const [open, setOpen] = createSignal(initialCardOpenState(props.part.id, false))
  createEffect(() => {
    CARD_OPEN_STATE.set(props.part.id, open())
  })
  const summary = () => markdownSummary(props.part.payload || {})
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
          <span class="context-event-card__title">{props.part.title || t("tool.context.default")}</span>
          <span class="context-event-card__meta">{String(props.part.payload?.phase || props.part.payload?.strategy || "")}</span>
        </span>
        <span class={`codicon codicon-chevron-${open() ? "down" : "right"}`} aria-hidden="true" />
      </button>
      <Show when={open()}>
        <div class="context-event-card__content">
          <Show when={summary()}>
            <MarkdownBlock text={summary()} class="structured-card__markdown" />
          </Show>
          <pre class="structured-card__json">{formatJson(props.part.payload || {})}</pre>
          <RawAuditRefs
            part={props.part}
            rawAuditEvents={props.rawAuditEvents}
            onLoadRawAuditEvents={props.onLoadRawAuditEvents}
          />
        </div>
      </Show>
    </div>
  )
}

const WorkflowStepPart: Component<ItemProps<WorkflowStepItem>> = (props) => {
  const [open, setOpen] = createSignal(initialCardOpenState(props.part.id, false))
  createEffect(() => {
    CARD_OPEN_STATE.set(props.part.id, open())
  })
  const meta = () => [
    workflowStageLabel(props.part.stage),
    workflowStatusLabel(props.part.status),
  ].filter(Boolean).join(" · ")
  const hasDetails = () => Boolean(
    props.part.summary ||
    Object.keys(props.part.details || {}).length ||
    rawAuditRefsForPart(props.part).length,
  )
  return (
    <div
      class="context-event-card"
      classList={{ "view-card--warning": props.part.status === "warning" || props.part.status === "error" }}
      onClick={(event) => event.stopPropagation()}
    >
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
        <span class="codicon codicon-list-tree" aria-hidden="true" />
        <span class="context-event-card__body">
          <span class="context-event-card__title">{props.part.title || workflowStageLabel(props.part.stage)}</span>
          <span class="context-event-card__meta">{meta()}</span>
        </span>
        <span class={`codicon codicon-chevron-${open() ? "down" : "right"}`} aria-hidden="true" />
      </button>
      <Show when={open() && hasDetails()}>
        <div class="context-event-card__content">
          <Show when={props.part.summary}>
            <MarkdownBlock text={props.part.summary || ""} class="structured-card__markdown" />
          </Show>
          <Show when={Object.keys(props.part.details || {}).length}>
            <pre class="structured-card__json">{formatJson(props.part.details || {})}</pre>
          </Show>
          <RawAuditRefs
            part={props.part}
            rawAuditEvents={props.rawAuditEvents}
            onLoadRawAuditEvents={props.onLoadRawAuditEvents}
          />
        </div>
      </Show>
    </div>
  )
}

const WorkflowArtifactPart: Component<ItemProps<WorkflowArtifactItem>> = (props) => (
  <Switch fallback={<WorkflowGenericPrimaryPart {...props} part={props.part} icon="package" />}>
    <Match when={props.part.artifactType === "capability_package_draft"}>
      <CapabilityPackageDraftReviewPart {...props} part={props.part} />
    </Match>
  </Switch>
)

const CapabilityPackageDraftReviewPart: Component<ItemProps<WorkflowArtifactItem>> = (props) => {
  const [open, setOpen] = createSignal(initialCardOpenState(props.part.id, true))
  const [detailsOpen, setDetailsOpen] = createSignal(initialCardDetailsOpenState(`${props.part.id}:details`, false))
  createEffect(() => {
    CARD_OPEN_STATE.set(props.part.id, open())
  })
  createEffect(() => {
    CARD_DETAILS_OPEN_STATE.set(`${props.part.id}:details`, detailsOpen())
  })
  const artifact = () => props.part.artifact || {}
  const packageId = () => stringPayload(artifact().package_id) || stringPayload(artifact().id)
  const components = () => arrayRecordPayload(artifact().components)
  const groups = () => groupCapabilityPackageComponents(components())
  const capabilities = () => reviewItems(artifact().capabilities, groups().capabilities)
  const dependencies = () => reviewItems(artifact().dependencies, groups().dependencies)
  const installPlan = () => stringArrayPayload(artifact().install_plan)
  const usage = () => stringArrayPayload(artifact().usage)
  const evidence = () => arrayRecordPayload(artifact().evidence)
  const credentials = () => stringArrayPayload(artifact().credentials)
  const risks = () => stringArrayPayload(artifact().risks)
  const validation = () => recordPayload(artifact().validation)
  const validationOk = () => validation().ok !== false
  const meta = () => [
    packageId(),
    components().length ? `${components().length} ${t("chat.capabilityPackage.components")}` : "",
    validationOk() ? "" : t("chat.capabilityPackage.validationFailed"),
    runtimeFootprintLabel(artifact().runtime_footprint),
  ].filter(Boolean).join(" · ")
  return (
    <div
      class="view-card capability-package-draft-card"
      classList={{ "view-card--warning": !validationOk() }}
      onClick={(event) => event.stopPropagation()}
    >
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
        <span class="codicon codicon-package" aria-hidden="true" />
        <span class="view-card__body">
          <span class="view-card__title">{props.part.title || stringPayload(artifact().name) || t("chat.capabilityPackage.draft")}</span>
          <span class="view-card__meta">{meta()}</span>
        </span>
        <span class={`codicon codicon-chevron-${open() ? "down" : "right"}`} aria-hidden="true" />
      </button>
      <Show when={open()}>
        <div class="view-card__content">
          <div class="structured-card__markdown">
            <Show when={artifact().description}>
              <p>{String(artifact().description)}</p>
            </Show>
            <CapabilityReviewSection title={t("chat.capabilityPackage.capabilities")} empty={t("chat.capabilityPackage.none")}>
              <CapabilityReviewList items={capabilities()} />
            </CapabilityReviewSection>
            <CapabilityReviewSection title={t("chat.capabilityPackage.dependencies")} empty={t("chat.capabilityPackage.none")}>
              <CapabilityReviewList items={dependencies()} />
            </CapabilityReviewSection>
            <CapabilityReviewSection title={t("chat.capabilityPackage.runtime")} empty={runtimeFootprintLabel(artifact().runtime_footprint)}>
              <p>{runtimeFootprintLabel(artifact().runtime_footprint)}</p>
              <Show when={stringPayload(recordPayload(artifact().runtime_footprint).user_message)}>
                <p>{stringPayload(recordPayload(artifact().runtime_footprint).user_message)}</p>
              </Show>
            </CapabilityReviewSection>
            <CapabilityTextList title={t("chat.capabilityPackage.installPlan")} items={installPlan()} />
            <CapabilityTextList title={t("chat.capabilityPackage.usage")} items={usage()} />
            <CapabilityEvidenceList items={evidence()} />
            <CapabilityTextList title={t("chat.capabilityPackage.credentials")} items={credentials()} />
            <CapabilityTextList title={t("chat.capabilityPackage.risks")} items={risks()} />
            <Show when={Object.keys(validation()).length && !validationOk()}>
              <CapabilityReviewSection title={t("chat.capabilityPackage.validation")} empty="">
                <pre class="structured-card__json">{formatJson(validation())}</pre>
              </CapabilityReviewSection>
            </Show>
          </div>
          <button
            type="button"
            class="shell-card__details-toggle"
            onClick={(event) => {
              event.stopPropagation()
              setDetailsOpen((value) => {
                const next = !value
                CARD_DETAILS_OPEN_STATE.set(`${props.part.id}:details`, next)
                return next
              })
            }}
          >
            <span class={`codicon codicon-chevron-${detailsOpen() ? "down" : "right"}`} aria-hidden="true" />
            <span>{t("tool.section.details")}</span>
          </button>
          <Show when={detailsOpen()}>
            <div class="tool-card__details">
              <ToolSection title={t("tool.section.metadata")}>
                <pre class="structured-card__json">{formatJson(props.part.payload || props.part.artifact || {})}</pre>
              </ToolSection>
            </div>
          </Show>
          <RawAuditRefs
            part={props.part}
            rawAuditEvents={props.rawAuditEvents}
            onLoadRawAuditEvents={props.onLoadRawAuditEvents}
          />
        </div>
      </Show>
    </div>
  )
}

const WorkflowDecisionPart: Component<ItemProps<WorkflowDecisionItem>> = (props) => (
  <Switch fallback={<WorkflowGenericPrimaryPart {...props} part={props.part} icon="shield" />}>
    <Match when={props.part.decisionType === "capability_package_install"}>
      <CapabilityPackageInstallDecisionPart {...props} part={props.part} />
    </Match>
  </Switch>
)

const CapabilityPackageInstallDecisionPart: Component<ItemProps<WorkflowDecisionItem>> = (props) => {
  const [open, setOpen] = createSignal(initialCardOpenState(props.part.id, true))
  const [detailsOpen, setDetailsOpen] = createSignal(initialCardDetailsOpenState(`${props.part.id}:details`, false))
  createEffect(() => {
    CARD_OPEN_STATE.set(props.part.id, open())
  })
  createEffect(() => {
    CARD_DETAILS_OPEN_STATE.set(`${props.part.id}:details`, detailsOpen())
  })
  const review = () => props.part.review || {}
  const packageId = () => stringPayload(review().package_id) || stringPayload(review().id)
  const reviewHooks = () => [
    ...arrayRecordPayload(review().hooks),
    ...arrayRecordPayload(review().hook_views),
  ]
  const manualSteps = () => arrayRecordPayload(review().manual_steps || review().manualSteps)
  const installCheckItems = () => [
    reviewHooks().length
      ? `包含 hooks：${reviewHooks().length} 个，启用能力后随能力默认启用`
      : "",
    ...manualSteps().map((item) =>
      manualStepUserActionLabel(stringPayload(item.category) || stringPayload(item.type))
    ),
    "完成后重新检查",
  ].filter(Boolean)
  const meta = () => [
    packageId(),
    workflowStatusLabel(props.part.status),
    runtimeFootprintLabel(review().runtime_footprint),
  ].filter(Boolean).join(" · ")
  return (
    <div
      class="view-card capability-package-draft-card"
      classList={{ "view-card--warning": props.part.status === "denied" || props.part.status === "error" }}
      onClick={(event) => event.stopPropagation()}
    >
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
        <span class="codicon codicon-shield" aria-hidden="true" />
        <span class="view-card__body">
          <span class="view-card__title">{props.part.title || t("chat.capabilityPackage.installDecision")}</span>
          <span class="view-card__meta">{meta()}</span>
        </span>
        <span class={`codicon codicon-chevron-${open() ? "down" : "right"}`} aria-hidden="true" />
      </button>
      <Show when={open()}>
        <div class="view-card__content">
          <div class="structured-card__markdown">
            <Show when={props.part.summary}>
              <p>{props.part.summary}</p>
            </Show>
            <CapabilityTextList title={t("chat.capabilityPackage.installPlan")} items={stringArrayPayload(review().install_plan)} />
            <CapabilityTextList title={t("chat.capabilityPackage.risks")} items={stringArrayPayload(review().risks)} />
            <CapabilityTextList title={t("chat.capabilityPackage.credentials")} items={stringArrayPayload(review().credentials)} />
            <CapabilityTextList title={t("chat.capabilityPackage.installChecks")} items={installCheckItems()} />
            <CapabilityReviewSection title={t("chat.capabilityPackage.runtime")} empty={runtimeFootprintLabel(review().runtime_footprint)}>
              <p>{runtimeFootprintLabel(review().runtime_footprint)}</p>
            </CapabilityReviewSection>
          </div>
          <button
            type="button"
            class="shell-card__details-toggle"
            onClick={(event) => {
              event.stopPropagation()
              setDetailsOpen((value) => {
                const next = !value
                CARD_DETAILS_OPEN_STATE.set(`${props.part.id}:details`, next)
                return next
              })
            }}
          >
            <span class={`codicon codicon-chevron-${detailsOpen() ? "down" : "right"}`} aria-hidden="true" />
            <span>{t("tool.section.details")}</span>
          </button>
          <Show when={detailsOpen()}>
            <div class="tool-card__details">
              <ToolSection title={t("tool.section.approval")}>
                <pre class="structured-card__json">{formatJson(props.part.payload || props.part.review || {})}</pre>
              </ToolSection>
            </div>
          </Show>
          <RawAuditRefs
            part={props.part}
            rawAuditEvents={props.rawAuditEvents}
            onLoadRawAuditEvents={props.onLoadRawAuditEvents}
          />
        </div>
      </Show>
    </div>
  )
}

const WorkflowResultPart: Component<ItemProps<WorkflowResultItem>> = (props) => (
  <WorkflowGenericPrimaryPart {...props} part={props.part} icon={props.part.status === "error" ? "warning" : "check"} />
)

const WorkflowGenericPrimaryPart: Component<ItemProps<WorkflowArtifactItem | WorkflowDecisionItem | WorkflowResultItem> & { icon: string }> = (props) => {
  const [open, setOpen] = createSignal(initialCardOpenState(props.part.id, true))
  const [detailsOpen, setDetailsOpen] = createSignal(initialCardDetailsOpenState(`${props.part.id}:details`, false))
  createEffect(() => {
    CARD_OPEN_STATE.set(props.part.id, open())
  })
  createEffect(() => {
    CARD_DETAILS_OPEN_STATE.set(`${props.part.id}:details`, detailsOpen())
  })
  const payload = () => props.part.payload || {}
  const status = () => "status" in props.part ? String(props.part.status || "") : ""
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
        <span class={`codicon codicon-${props.icon}`} aria-hidden="true" />
        <span class="view-card__body">
          <span class="view-card__title">{props.part.title || props.part.workflow}</span>
          <span class="view-card__meta">{status()}</span>
        </span>
        <span class={`codicon codicon-chevron-${open() ? "down" : "right"}`} aria-hidden="true" />
      </button>
      <Show when={open()}>
        <div class="view-card__content">
          <Show when={props.part.summary}>
            <MarkdownBlock text={props.part.summary || ""} class="structured-card__markdown" />
          </Show>
          <button
            type="button"
            class="shell-card__details-toggle"
            onClick={(event) => {
              event.stopPropagation()
              setDetailsOpen((value) => {
                const next = !value
                CARD_DETAILS_OPEN_STATE.set(`${props.part.id}:details`, next)
                return next
              })
            }}
          >
            <span class={`codicon codicon-chevron-${detailsOpen() ? "down" : "right"}`} aria-hidden="true" />
            <span>{t("tool.section.details")}</span>
          </button>
          <Show when={detailsOpen()}>
            <div class="tool-card__details">
              <ToolSection title={t("tool.section.metadata")}>
                <pre class="structured-card__json">{formatJson(payload())}</pre>
              </ToolSection>
            </div>
          </Show>
          <RawAuditRefs
            part={props.part}
            rawAuditEvents={props.rawAuditEvents}
            onLoadRawAuditEvents={props.onLoadRawAuditEvents}
          />
        </div>
      </Show>
    </div>
  )
}

const CapabilityReviewSection: Component<{ title: string; empty: string; children: JSX.Element }> = (props) => (
  <section>
    <strong>{props.title}</strong>
    <Show when={props.children} fallback={<p>{props.empty}</p>}>
      {props.children}
    </Show>
  </section>
)

const CapabilityReviewList: Component<{ items: CapabilityComponentView[] }> = (props) => (
  <Show when={props.items.length} fallback={<p>{t("chat.capabilityPackage.none")}</p>}>
    <ul>
      <For each={props.items}>
        {(component) => (
          <li>
            <strong>{component.displayName || component.name || component.id}</strong>
            <span> · {component.summary || component.label}</span>
          </li>
        )}
      </For>
    </ul>
  </Show>
)

const CapabilityTextList: Component<{ title: string; items: string[] }> = (props) => (
  <Show when={props.items.length}>
    <CapabilityReviewSection title={props.title} empty="">
      <ul>
        <For each={props.items}>
          {(item) => <li>{item}</li>}
        </For>
      </ul>
    </CapabilityReviewSection>
  </Show>
)

const CapabilityEvidenceList: Component<{ items: Record<string, unknown>[] }> = (props) => (
  <Show when={props.items.length}>
    <CapabilityReviewSection title={t("chat.capabilityPackage.evidence")} empty="">
      <ul>
        <For each={props.items}>
          {(item) => (
            <li>
              <strong>{stringPayload(item.title) || stringPayload(item.source) || t("chat.capabilityPackage.evidence")}</strong>
              <Show when={stringPayload(item.excerpt) || stringPayload(item.summary)}>
                <span> · {stringPayload(item.excerpt) || stringPayload(item.summary)}</span>
              </Show>
            </li>
          )}
        </For>
      </ul>
    </CapabilityReviewSection>
  </Show>
)

const MemoryContextPart: Component<ItemProps<Extract<TranscriptItem, { type: "memory_context" }>>> = (props) => {
  const [open, setOpen] = createSignal(initialCardOpenState(props.part.id, false))
  createEffect(() => {
    CARD_OPEN_STATE.set(props.part.id, open())
  })
  const payload = () => props.part.payload || {}
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
          <span class="memory-context-card__title">{props.part.title || t("memoryContext.title")}</span>
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
          <RawAuditRefs
            part={props.part}
            rawAuditEvents={props.rawAuditEvents}
            onLoadRawAuditEvents={props.onLoadRawAuditEvents}
          />
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

const UiEventPart: Component<ItemProps<Extract<TranscriptItem, { type: "ui_event" }>>> = (props) => {
  const [open, setOpen] = createSignal(initialCardOpenState(props.part.id, false))
  createEffect(() => {
    CARD_OPEN_STATE.set(props.part.id, open())
  })
  const kind = () => props.part.kind || "system"
  const label = () => getUiEventLabel(kind()) || kind()
  const icon = () => UI_EVENT_ICONS[kind()] || "output"
  const level = () => props.part.level || "info"
  const summary = () => markdownSummary(props.part.payload || {})

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
          <span class="ui-event-card__title">{props.part.title || label()}</span>
          <span class="ui-event-card__meta">{label()} · {level()}</span>
        </span>
        <span class={`codicon codicon-chevron-${open() ? "down" : "right"}`} aria-hidden="true" />
      </button>
      <Show when={open()}>
        <div class="ui-event-card__content">
          <Show when={summary()}>
            <MarkdownBlock text={summary()} class="structured-card__markdown" />
          </Show>
          <pre class="structured-card__json">{formatJson(props.part.payload || {})}</pre>
          <RawAuditRefs
            part={props.part}
            rawAuditEvents={props.rawAuditEvents}
            onLoadRawAuditEvents={props.onLoadRawAuditEvents}
          />
        </div>
      </Show>
    </div>
  )
}

interface TimelineTextPartProps {
  part: AssistantTextItem
}

const TimelineTextPart: Component<TimelineTextPartProps> = (props) => (
  <MarkdownText
    text={props.part.markdown}
    format={props.part.format}
    streaming={props.part.streaming}
  />
)

interface FinalAnswerPartProps {
  parts: AssistantTextItem[]
}

const FinalAnswerPart: Component<FinalAnswerPartProps> = (props) => (
  <For each={props.parts}>
    {(part) => (
      <MarkdownText
        text={part.markdown}
        format={part.format}
        streaming={part.streaming}
      />
    )}
  </For>
)

interface TimelineProcessGroupPartProps extends Omit<PartProps, "part"> {
  group: ProcessGroup
  usageSnapshot?: WorkflowUsageSnapshot
  showUsageMetrics?: boolean
}

const PROCESS_GROUP_ICONS: Record<ProcessGroup["kind"], string> = {
  explore: "search",
  modify: "diff-modified",
  run: "terminal",
  mcp: "server-process",
  skill: "symbol-method",
  context: "file-submodule",
  other: "list-tree",
}

const TimelineProcessGroupPart: Component<TimelineProcessGroupPartProps> = (props) => {
  const [open, setOpen] = createSignal(initialCardOpenState(props.group.id, defaultProcessGroupOpen(props.group)))
  createEffect(() => {
    CARD_OPEN_STATE.set(props.group.id, open())
  })
  const icon = () => PROCESS_GROUP_ICONS[props.group.kind] || "list-tree"
  const meta = () => processMetaLabel(props.group.state, props.group.count, props.group.failureCount, props.group.currentLabel)
  const usageMetrics = () =>
    props.group.isWorkflow && props.showUsageMetrics !== false
      ? workflowUsageMetricLabels(props.usageSnapshot, props.group.state)
      : []

  return (
    <div
      class="process-group-card"
      classList={{
        "process-group-card--running": props.group.state === "running",
        "process-group-card--error": props.group.state === "error",
      }}
      onClick={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        class="process-group-card__header"
        onClick={(event) => {
          event.stopPropagation()
          setOpen((value) => {
            const next = !value
            CARD_OPEN_STATE.set(props.group.id, next)
            return next
          })
        }}
      >
        {props.group.state === "running" ? (
          <RoseFourLoader class="process-card__loader" />
        ) : (
          <span class={`codicon codicon-${icon()}`} aria-hidden="true" />
        )}
        <span class="process-card__body">
          <span class="process-card__title">{props.group.label}</span>
          <span class="process-card__meta">{meta()}</span>
        </span>
        <span class={`codicon codicon-chevron-${open() ? "down" : "right"}`} aria-hidden="true" />
      </button>
      <Show when={open()}>
        <div class="process-group-card__content">
          <Show when={usageMetrics().length > 0}>
            <div class="process-summary-card__metrics">
              <For each={usageMetrics()}>
                {(label) => <span class="process-summary-card__metric">{label}</span>}
              </For>
            </div>
          </Show>
          <For each={props.group.items}>
            {(item) => (
              <TranscriptItemView
                part={item}
                selectedTraceNodeId={props.selectedTraceNodeId}
                onSelectSession={props.onSelectSession}
                onTraceNodeSelect={props.onTraceNodeSelect}
                onCopyToolCommand={props.onCopyToolCommand}
                onCopyToolOutput={props.onCopyToolOutput}
                onForkPart={props.onForkPart}
                onLoadRawAuditEvents={props.onLoadRawAuditEvents}
                rawAuditEvents={props.rawAuditEvents}
                defaultReasoningOpen={props.defaultReasoningOpen}
              />
            )}
          </For>
        </div>
      </Show>
    </div>
  )
}

interface ProcessSummaryPartProps extends Omit<PartProps, "part"> {
  summary: ProcessSummary
  usageSnapshot?: WorkflowUsageSnapshot
}

const ProcessSummaryPart: Component<ProcessSummaryPartProps> = (props) => {
  const [open, setOpen] = createSignal(initialCardOpenState(props.summary.id, defaultProcessSummaryOpen(props.summary)))
  createEffect(() => {
    CARD_OPEN_STATE.set(props.summary.id, open())
  })
  const icon = () => props.summary.state === "error" ? "warning" : "list-tree"
  const meta = () => processMetaLabel(props.summary.state, props.summary.count, props.summary.failureCount, props.summary.currentLabel)
  const usageMetrics = () =>
    props.summary.isWorkflow
      ? workflowUsageMetricLabels(props.usageSnapshot, props.summary.state)
      : []

  return (
    <div
      class="process-summary-card"
      classList={{
        "process-summary-card--running": props.summary.state === "running",
        "process-summary-card--error": props.summary.state === "error",
      }}
      onClick={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        class="process-summary-card__header"
        onClick={(event) => {
          event.stopPropagation()
          setOpen((value) => {
            const next = !value
            CARD_OPEN_STATE.set(props.summary.id, next)
            return next
          })
        }}
      >
        {props.summary.state === "running" ? (
          <RoseFourLoader class="process-card__loader" />
        ) : (
          <span class={`codicon codicon-${icon()}`} aria-hidden="true" />
        )}
        <span class="process-card__body">
          <span class="process-card__title">{props.summary.isWorkflow ? workflowGroupLabel(props.summary.workflow) : t("process.summary")}</span>
          <span class="process-card__meta">{meta()}</span>
        </span>
        <span class={`codicon codicon-chevron-${open() ? "down" : "right"}`} aria-hidden="true" />
      </button>
      <Show when={open()}>
        <div class="process-summary-card__content">
          <Show when={usageMetrics().length > 0}>
            <div class="process-summary-card__metrics">
              <For each={usageMetrics()}>
                {(label) => <span class="process-summary-card__metric">{label}</span>}
              </For>
            </div>
          </Show>
          <ProcessTimeline
            items={props.summary.items}
            selectedTraceNodeId={props.selectedTraceNodeId}
            onSelectSession={props.onSelectSession}
            onTraceNodeSelect={props.onTraceNodeSelect}
            onCopyToolCommand={props.onCopyToolCommand}
            onCopyToolOutput={props.onCopyToolOutput}
            onForkPart={props.onForkPart}
            onLoadRawAuditEvents={props.onLoadRawAuditEvents}
            rawAuditEvents={props.rawAuditEvents}
            defaultReasoningOpen={props.defaultReasoningOpen}
            usageSnapshot={props.usageSnapshot}
            showGroupUsageMetrics={false}
          />
        </div>
      </Show>
    </div>
  )
}

interface ProcessTimelineProps extends Omit<PartProps, "part"> {
  items: ProcessTimelineItem[]
  usageSnapshot?: WorkflowUsageSnapshot
  showGroupUsageMetrics?: boolean
}

const ProcessTimeline: Component<ProcessTimelineProps> = (props) => (
  <KeyedFor each={props.items} key={processTimelineItemKey}>
    {(item) => (
      <Switch>
        <Match when={item().type === "timeline_text"}>
          <TimelineTextPart part={(item() as Extract<ProcessTimelineItem, { type: "timeline_text" }>).part} />
        </Match>
        <Match when={item().type === "timeline_process_group"}>
          <TimelineProcessGroupPart
            group={(item() as Extract<ProcessTimelineItem, { type: "timeline_process_group" }>).group}
            selectedTraceNodeId={props.selectedTraceNodeId}
            onSelectSession={props.onSelectSession}
            onTraceNodeSelect={props.onTraceNodeSelect}
            onCopyToolCommand={props.onCopyToolCommand}
            onCopyToolOutput={props.onCopyToolOutput}
            onForkPart={props.onForkPart}
            onLoadRawAuditEvents={props.onLoadRawAuditEvents}
            rawAuditEvents={props.rawAuditEvents}
            defaultReasoningOpen={props.defaultReasoningOpen}
            usageSnapshot={props.usageSnapshot}
            showUsageMetrics={props.showGroupUsageMetrics}
          />
        </Match>
        <Match when={item().type === "timeline_notice"}>
          <NoticePart part={(item() as Extract<ProcessTimelineItem, { type: "timeline_notice" }>).part} />
        </Match>
        <Match when={item().type === "timeline_part"}>
          <TranscriptItemView
            part={(item() as Extract<ProcessTimelineItem, { type: "timeline_part" }>).part}
            selectedTraceNodeId={props.selectedTraceNodeId}
            onSelectSession={props.onSelectSession}
            onTraceNodeSelect={props.onTraceNodeSelect}
            onCopyToolCommand={props.onCopyToolCommand}
            onCopyToolOutput={props.onCopyToolOutput}
            onForkPart={props.onForkPart}
            onLoadRawAuditEvents={props.onLoadRawAuditEvents}
            rawAuditEvents={props.rawAuditEvents}
            defaultReasoningOpen={props.defaultReasoningOpen}
          />
        </Match>
      </Switch>
    )}
  </KeyedFor>
)

const TranscriptItemView: Component<PartProps> = (props) => {
  return (
    <Switch
      fallback={
        <div class="parallel-card" onClick={(event) => event.stopPropagation()}>
          <div class="parallel-card__title">{props.part.type === "parallel_tools" || props.part.type === "parallel_sessions" ? props.part.title || t("tool.parallel.default") : t("tool.parallel.default")}</div>
          <For each={props.part.type === "parallel_tools" || props.part.type === "parallel_sessions" ? props.part.items || [] : []}>
            {(item) => (
              <TranscriptItemView
                part={item}
                selectedTraceNodeId={props.selectedTraceNodeId}
                onSelectSession={props.onSelectSession}
                onTraceNodeSelect={props.onTraceNodeSelect}
                onCopyToolCommand={props.onCopyToolCommand}
                onCopyToolOutput={props.onCopyToolOutput}
                onForkPart={props.onForkPart}
                onLoadRawAuditEvents={props.onLoadRawAuditEvents}
                rawAuditEvents={props.rawAuditEvents}
                defaultReasoningOpen={props.defaultReasoningOpen}
              />
            )}
          </For>
        </div>
      }
    >
      <Match when={props.part.type === "assistant_text"}>
        <MarkdownText
          text={(props.part as AssistantTextItem).markdown}
          format={(props.part as AssistantTextItem).format}
          streaming={(props.part as AssistantTextItem).streaming}
        />
      </Match>
      <Match when={props.part.type === "thinking"}>
        <ThinkingPart {...props} part={props.part as ThinkingItem} />
      </Match>
      <Match when={props.part.type === "reasoning"}>
        <ReasoningPart {...props} part={props.part as ReasoningItem} />
      </Match>
      <Match when={props.part.type === "tool" && isShellToolName((props.part as ToolActivityItem).tool, (props.part as ToolActivityItem).source)}>
        <ShellToolPart {...props} part={props.part as ToolActivityItem} />
      </Match>
      <Match when={props.part.type === "tool" && !isShellToolName((props.part as ToolActivityItem).tool, (props.part as ToolActivityItem).source)}>
        <ToolPart {...props} part={props.part as ToolActivityItem} />
      </Match>
      <Match when={props.part.type === "notice"}>
        <NoticePart {...props} part={props.part as NoticeItem} />
      </Match>
      <Match when={props.part.type === "trace"}>
        <TracePart {...props} part={props.part as Extract<TranscriptItem, { type: "trace" }>} />
      </Match>
      <Match when={props.part.type === "session"}>
        <SessionPart {...props} part={props.part as Extract<TranscriptItem, { type: "session" }>} />
      </Match>
      <Match when={props.part.type === "terminal"}>
        <TerminalPart {...props} part={props.part as Extract<TranscriptItem, { type: "terminal" }>} />
      </Match>
      <Match when={props.part.type === "view"}>
        <ViewPart {...props} part={props.part as Extract<TranscriptItem, { type: "view" }>} />
      </Match>
      <Match when={props.part.type === "context_event"}>
        <ContextEventPart {...props} part={props.part as Extract<TranscriptItem, { type: "context_event" }>} />
      </Match>
      <Match when={props.part.type === "workflow_step"}>
        <WorkflowStepPart {...props} part={props.part as WorkflowStepItem} />
      </Match>
      <Match when={props.part.type === "workflow_artifact"}>
        <WorkflowArtifactPart {...props} part={props.part as WorkflowArtifactItem} />
      </Match>
      <Match when={props.part.type === "workflow_decision"}>
        <WorkflowDecisionPart {...props} part={props.part as WorkflowDecisionItem} />
      </Match>
      <Match when={props.part.type === "workflow_result"}>
        <WorkflowResultPart {...props} part={props.part as WorkflowResultItem} />
      </Match>
      <Match when={props.part.type === "memory_context"}>
        <MemoryContextPart {...props} part={props.part as Extract<TranscriptItem, { type: "memory_context" }>} />
      </Match>
      <Match when={props.part.type === "ui_event"}>
        <UiEventPart {...props} part={props.part as Extract<TranscriptItem, { type: "ui_event" }>} />
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

      <Index each={props.turn.assistantMessages}>
        {(message) => {
          const selected = () => Boolean(message().traceNodeId && message().traceNodeId === props.selectedTraceNodeId)
          // Render the presentation projection exactly as produced here; do
          // not reorder canonical transcript parts inside SessionTurn.
          const presentation = createMemo(() => buildTranscriptPresentation(message().parts, message(), {
            runningProcessLabel: props.runningProcessLabel,
          }))

          return (
            <div
              class="assistant-message"
              classList={{ "message--selected": selected() }}
              data-trace-node-id={message().traceNodeId}
              onClick={() => {
                const traceNodeId = message().traceNodeId
                if (traceNodeId) props.onTraceNodeSelect?.(traceNodeId)
              }}
            >
              <MessageMarker message={message()} selected={selected()} />
              <div class="assistant-message__body">
                <KeyedFor each={presentation()} key={transcriptPresentationItemKey}>
                  {(item) => (
                    <Switch>
                      <Match when={item().type === "timeline_text"}>
                        <TimelineTextPart
                          part={(item() as Extract<TranscriptPresentationItem, { type: "timeline_text" }>).part}
                        />
                      </Match>
                      <Match when={item().type === "timeline_process_group"}>
                        <TimelineProcessGroupPart
                          group={(item() as Extract<TranscriptPresentationItem, { type: "timeline_process_group" }>).group}
                          selectedTraceNodeId={props.selectedTraceNodeId}
                          onSelectSession={props.onSelectSession}
                          onTraceNodeSelect={props.onTraceNodeSelect}
                          onCopyToolCommand={props.onCopyToolCommand}
                          onCopyToolOutput={props.onCopyToolOutput}
                          onForkPart={props.onForkPart}
                          onLoadRawAuditEvents={props.onLoadRawAuditEvents}
                          rawAuditEvents={props.rawAuditEvents}
                          defaultReasoningOpen={props.defaultReasoningOpen}
                          usageSnapshot={props.usageSnapshot}
                        />
                      </Match>
                      <Match when={item().type === "timeline_notice"}>
                        <NoticePart
                          part={(item() as Extract<TranscriptPresentationItem, { type: "timeline_notice" }>).part}
                        />
                      </Match>
                      <Match when={item().type === "process_summary"}>
                        <ProcessSummaryPart
                          summary={(item() as Extract<TranscriptPresentationItem, { type: "process_summary" }>).summary}
                          selectedTraceNodeId={props.selectedTraceNodeId}
                          onSelectSession={props.onSelectSession}
                          onTraceNodeSelect={props.onTraceNodeSelect}
                          onCopyToolCommand={props.onCopyToolCommand}
                          onCopyToolOutput={props.onCopyToolOutput}
                          onForkPart={props.onForkPart}
                          onLoadRawAuditEvents={props.onLoadRawAuditEvents}
                          rawAuditEvents={props.rawAuditEvents}
                          defaultReasoningOpen={props.defaultReasoningOpen}
                          usageSnapshot={props.usageSnapshot}
                        />
                      </Match>
                      <Match when={item().type === "reasoning_panel"}>
                        <ReasoningPanelPart
                          panel={(item() as Extract<TranscriptPresentationItem, { type: "reasoning_panel" }>).panel}
                          defaultReasoningOpen={props.defaultReasoningOpen}
                        />
                      </Match>
                      <Match when={item().type === "final_answer"}>
                        <FinalAnswerPart
                          parts={(item() as Extract<TranscriptPresentationItem, { type: "final_answer" }>).parts}
                        />
                      </Match>
                      <Match when={item().type === "primary_part"}>
                        <TranscriptItemView
                          part={(item() as Extract<TranscriptPresentationItem, { type: "primary_part" }>).part}
                          selectedTraceNodeId={props.selectedTraceNodeId}
                          onSelectSession={props.onSelectSession}
                          onTraceNodeSelect={props.onTraceNodeSelect}
                          onCopyToolCommand={props.onCopyToolCommand}
                          onCopyToolOutput={props.onCopyToolOutput}
                          onForkPart={props.onForkPart}
                          onLoadRawAuditEvents={props.onLoadRawAuditEvents}
                          rawAuditEvents={props.rawAuditEvents}
                          defaultReasoningOpen={props.defaultReasoningOpen}
                        />
                      </Match>
                      <Match when={item().type === "timeline_part"}>
                        <TranscriptItemView
                          part={(item() as Extract<TranscriptPresentationItem, { type: "timeline_part" }>).part}
                          selectedTraceNodeId={props.selectedTraceNodeId}
                          onSelectSession={props.onSelectSession}
                          onTraceNodeSelect={props.onTraceNodeSelect}
                          onCopyToolCommand={props.onCopyToolCommand}
                          onCopyToolOutput={props.onCopyToolOutput}
                          onForkPart={props.onForkPart}
                          onLoadRawAuditEvents={props.onLoadRawAuditEvents}
                          rawAuditEvents={props.rawAuditEvents}
                          defaultReasoningOpen={props.defaultReasoningOpen}
                        />
                      </Match>
                    </Switch>
                  )}
                </KeyedFor>
                <div class="message-action-row">
                  <Show when={props.onCopyMessage}>
                    <IconButton
                      icon="copy"
                      title={t("chat.copyMessage")}
                      onClick={(event) => {
                        event.stopPropagation()
                        return props.onCopyMessage?.(message())
                      }}
                    />
                  </Show>
                  <Show when={canForkMessage(message())}>
                    <IconButton
                      icon="git-branch"
                      title={t("chat.forkFromHere")}
                      onClick={(event) => {
                        event.stopPropagation()
                        props.onForkMessage?.(message())
                      }}
                    />
                  </Show>
                  <Show when={message().traceNodeId}>
                    <IconButton icon="inspect" title={t("tool.locateTraceNode")} onClick={() => props.onTraceNodeSelect?.(message().traceNodeId as string)} />
                  </Show>
                </div>
              </div>
            </div>
          )
        }}
      </Index>
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

function stringArrayPayload(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map((item) => String(item || "").trim()).filter(Boolean)
}

function reviewItems(value: unknown, fallback: CapabilityComponentView[]): CapabilityComponentView[] {
  const records = arrayRecordPayload(value)
  if (!records.length) return fallback
  return records.map((item, index) => ({
    id: stringPayload(item.id) || stringPayload(item.name) || `item-${index}`,
    kind: stringPayload(item.kind) || stringPayload(item.type) || "capability",
    role: "capability",
    name: stringPayload(item.name) || stringPayload(item.id) || `item-${index}`,
    displayName: stringPayload(item.display_name) || stringPayload(item.displayName) || stringPayload(item.name) || stringPayload(item.id) || `item-${index}`,
    label: stringPayload(item.label) || stringPayload(item.kind) || stringPayload(item.type) || "capability",
    summary: stringPayload(item.summary) || stringPayload(item.description),
    packageIds: [],
    pathHint: "",
    sourcePath: "",
    runtimeFootprint: {
      runsOn: "agent_only",
      installRequiredOn: [],
      configRequiredOn: [],
      userMessage: "",
    },
    hooks: [],
    raw: item,
  }))
}

function workflowStageLabel(stage?: string): string {
  const labels: Record<string, string> = {
    prepare: t("workflow.stage.prepare"),
    read_source: t("workflow.stage.readSource"),
    extract_evidence: t("workflow.stage.extractEvidence"),
    compose_draft: t("workflow.stage.composeDraft"),
    await_approval: t("workflow.stage.awaitApproval"),
    install: t("workflow.stage.install"),
    done: t("workflow.stage.done"),
  }
  const key = String(stage || "").trim()
  return labels[key] || key || t("workflow.stage.step")
}

function workflowGroupLabel(workflow?: string): string {
  const key = String(workflow || "").trim()
  if (key === "capability_package_ingest") return t("workflow.capabilityPackageIngest")
  return key || t("workflow.generic")
}

function workflowStatusLabel(status?: string): string {
  const value = String(status || "").trim()
  if (value === "running" || value === "pending") return t("process.state.running")
  if (value === "error" || value === "denied") return t("process.state.error")
  if (value === "warning") return t("process.state.warning")
  if (value === "cancelled") return t("process.state.cancelled")
  if (value === "approved") return t("tool.approval.approved")
  return t("process.state.completed")
}

function rawAuditRefsForPart(part: TranscriptItem): RawEventRef[] {
  const refs: RawEventRef[] = []
  refs.push(...normalizeRawEventRefs(part.rawEventRefs))
  if ("payload" in part) {
    const payload = recordPayload(part.payload)
    refs.push(...normalizeRawEventRefs(payload.raw_event_refs ?? payload.rawEventRefs))
  }
  if (part.type === "tool") {
    const meta = recordPayload(part.resultMeta)
    refs.push(...normalizeRawEventRefs(meta.raw_event_refs ?? meta.rawEventRefs))
  }
  return dedupeRawEventRefs(refs)
}

function normalizeRawEventRefs(value: unknown): RawEventRef[] {
  if (!Array.isArray(value)) return []
  return value
    .map(recordPayload)
    .filter((item) => Object.keys(item).length > 0) as RawEventRef[]
}

function dedupeRawEventRefs(refs: RawEventRef[]): RawEventRef[] {
  const deduped: RawEventRef[] = []
  const seen = new Set<string>()
  for (const ref of refs) {
    const key = [
      String(ref.agent_run_id || ""),
      String(ref.seq ?? ""),
      String(ref.type || ""),
      String(ref.id || ""),
    ].join(":")
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push(ref)
  }
  return deduped
}

function stringPayload(value: unknown): string {
  return typeof value === "string" ? value : ""
}
