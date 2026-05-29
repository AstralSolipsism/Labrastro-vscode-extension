import { Component, For, Show, createEffect, createMemo, createSignal } from "solid-js"
import {
  buildCommandRuleCandidates,
  type CommandRuleCandidate,
  type CommandRuleLevel,
} from "../../utils/command-auto-approval"
import { DialogSurface } from "../common/interaction"
import {
  approvalFilePath,
  approvalIntentText,
  approvalSummary,
  extractApprovalCommand,
  formatInlineValue,
  formatJson,
  objectValue,
  stringValue,
  type ApprovalDecision,
  type ApprovalDetails,
  type ApprovalSection,
} from "./approval-details"

export {
  DEFAULT_AUTO_APPROVE_OPTIONS,
  approvalFromPayload,
  approvalIntentText,
  approvalSummary,
  classifyApproval,
  extractApprovalCommand,
  shouldAutoApprove,
  type ApprovalDecision,
  type ApprovalDetails,
  type ApprovalSection,
  type AutoApprovalCategory,
} from "./approval-details"

interface ApprovalDetailsDialogProps {
  approval: ApprovalDetails
  autoApprovalCandidates?: CommandRuleCandidate[]
  autoApprovalPending?: boolean
  onClose: () => void
  onDecision: (decision: ApprovalDecision) => void
  onApproveSession?: (rules?: string[]) => void
  onApproveAlways?: () => void
  onAlwaysAllow?: () => void
  onRememberDecision?: (decision: ApprovalDecision, rules: string[]) => void
}

interface ApprovalDecisionButtonsProps {
  disabled?: boolean
  pendingLabel?: string
  canApproveSession?: boolean
  canApproveAlways?: boolean
  onDecision: (decision: ApprovalDecision) => void
  onApproveSession?: () => void
  onApproveAlways?: () => void
}

interface ApprovalQuickPromptProps extends ApprovalDecisionButtonsProps {
  approval: ApprovalDetails
  onDetails: () => void
}

export const ApprovalQuickPrompt: Component<ApprovalQuickPromptProps> = (props) => (
  <article class="approval-quick">
    <ApprovalIntentHeadline approval={props.approval} />
    <div class="approval-quick__actions">
      <ApprovalDecisionButtons
        disabled={props.disabled}
        pendingLabel={props.pendingLabel}
        canApproveSession={props.canApproveSession}
        canApproveAlways={props.canApproveAlways}
        onDecision={props.onDecision}
        onApproveSession={props.onApproveSession}
        onApproveAlways={props.onApproveAlways}
      />
      <button type="button" disabled={props.disabled} onClick={props.onDetails}>
        查看详情
      </button>
    </div>
  </article>
)

export const ApprovalDetailsDialog: Component<ApprovalDetailsDialogProps> = (props) => {
  const summary = createMemo(() => approvalSummary(props.approval))
  const command = createMemo(() => extractApprovalCommand(props.approval))
  const commandRuleCandidates = createMemo(() =>
    props.autoApprovalCandidates || buildCommandRuleCandidates(command())
  )
  const [selectedRuleLevel, setSelectedRuleLevel] = createSignal<CommandRuleLevel | undefined>()
  const defaultRuleCandidate = createMemo(() => preferredCommandRuleCandidate(commandRuleCandidates()))
  const selectedRuleCandidate = createMemo(() =>
    commandRuleCandidates().find((candidate) => candidate.level === selectedRuleLevel()) ||
    defaultRuleCandidate()
  )
  const canRememberCommand = createMemo(() =>
    summary().category === "execute" &&
    Boolean(props.onRememberDecision) &&
    Boolean(selectedRuleCandidate()?.rules.length)
  )
  const canApproveSession = createMemo(() =>
    summary().category === "execute" &&
    Boolean(props.onApproveSession) &&
    Boolean(selectedRuleCandidate()?.rules.length)
  )
  const canApproveAlways = createMemo(() =>
    summary().category === "execute"
      ? canRememberCommand()
      : Boolean(props.onApproveAlways || props.onAlwaysAllow)
  )
  createEffect(() => {
    const candidates = commandRuleCandidates()
    const selected = selectedRuleLevel()
    if (selected && candidates.some((candidate) => candidate.level === selected)) return
    setSelectedRuleLevel(defaultRuleCandidate()?.level)
  })

  const approveSession = () => {
    if (props.autoApprovalPending) return
    props.onApproveSession?.(selectedRuleCandidate()?.rules)
  }
  const approveAlways = () => {
    if (props.autoApprovalPending) return
    const candidate = selectedRuleCandidate()
    if (summary().category === "execute" && props.onRememberDecision && candidate?.rules.length) {
      props.onRememberDecision("allow_once", candidate.rules)
      return
    }
    if (props.onApproveAlways) {
      props.onApproveAlways()
      return
    }
    if (props.onAlwaysAllow) {
      props.onAlwaysAllow()
      return
    }
  }

  return (
    <DialogSurface
      ariaLabel="审批详情"
      backdropClass="approval-dialog-backdrop"
      surfaceClass="approval-dialog"
      as="section"
      onClose={props.onClose}
      initialFocusSelector=".approval-dialog__close"
    >
        <header class="approval-dialog__header">
          <div class="approval-dialog__title">
            <span class={`codicon codicon-${summary().icon}`} aria-hidden="true" />
            <div>
              <h2>操作审批</h2>
              <span>{props.approval.toolName}</span>
            </div>
          </div>
          <button class="approval-dialog__close" type="button" onClick={() => props.onClose()} aria-label="关闭">
            <span class="codicon codicon-close" aria-hidden="true" />
          </button>
        </header>
        <ApprovalDetailsBody approval={props.approval} />
        <Show when={canRememberCommand() || canApproveSession()}>
          <ApprovalRulePanel
            candidates={commandRuleCandidates()}
            selectedLevel={selectedRuleCandidate()?.level}
            pending={props.autoApprovalPending}
            onSelect={setSelectedRuleLevel}
          />
        </Show>
        <footer class="approval-dialog__footer">
          <ApprovalDecisionButtons
            disabled={props.autoApprovalPending}
            pendingLabel={props.autoApprovalPending ? "提交中..." : ""}
            canApproveSession={canApproveSession()}
            canApproveAlways={canApproveAlways()}
            onDecision={props.onDecision}
            onApproveSession={approveSession}
            onApproveAlways={approveAlways}
          />
        </footer>
    </DialogSurface>
  )
}

const ApprovalRulePanel: Component<{
  candidates: CommandRuleCandidate[]
  selectedLevel?: CommandRuleLevel
  pending?: boolean
  onSelect: (level: CommandRuleLevel) => void
}> = (props) => {
  const selectedCandidate = createMemo(() =>
    props.candidates.find((candidate) => candidate.level === props.selectedLevel) ||
    preferredCommandRuleCandidate(props.candidates)
  )
  const activeLevel = createMemo(() => selectedCandidate()?.level)

  return (
    <section class="approval-remember">
      <div class="approval-remember__header">
        <span class="codicon codicon-shield" aria-hidden="true" />
        <div>
          <strong>自动批准规则</strong>
          <small>选择以后自动放行这类命令的范围。</small>
        </div>
      </div>
      <div class="approval-rule-levels" role="radiogroup" aria-label="自动批准规则等级">
        <For each={props.candidates}>
          {(candidate) => (
            <button
              type="button"
              role="radio"
              aria-checked={candidate.level === activeLevel()}
              class="approval-rule-level"
              classList={{ "approval-rule-level--active": candidate.level === activeLevel() }}
              disabled={props.pending}
              onClick={() => props.onSelect(candidate.level)}
            >
              <strong>{candidate.label}</strong>
              <span>{candidate.description}</span>
            </button>
          )}
        </For>
      </div>
      <Show when={selectedCandidate()}>
        {(candidate) => (
          <div class="approval-rule-preview">
            <span>将写入规则</span>
            <div>
              <For each={candidate().rules}>
                {(rule) => <code>{rule}</code>}
              </For>
            </div>
          </div>
        )}
      </Show>
    </section>
  )
}

function preferredCommandRuleCandidate(candidates: CommandRuleCandidate[]): CommandRuleCandidate | undefined {
  return (
    candidates.find((candidate) => candidate.level === "firstArg") ||
    candidates.find((candidate) => candidate.level === "exact") ||
    candidates.find((candidate) => candidate.level === "base") ||
    candidates[0]
  )
}

const ApprovalDecisionButtons: Component<ApprovalDecisionButtonsProps> = (props) => {
  const pending = () => props.pendingLabel || ""
  return (
    <>
      <button class="approval-dialog__button approval-dialog__button--secondary" type="button" disabled={props.disabled} onClick={() => props.onDecision("deny_once")}>
        {pending() || "拒绝"}
      </button>
      <button class="approval-dialog__button approval-dialog__button--primary" type="button" disabled={props.disabled} onClick={() => props.onDecision("allow_once")}>
        {pending() || "批准一次"}
      </button>
      <button class="approval-dialog__button approval-dialog__button--secondary" type="button" disabled={props.disabled || !props.canApproveSession} onClick={() => props.onApproveSession?.()}>
        {pending() || "本会话批准"}
      </button>
      <button class="approval-dialog__button approval-dialog__button--secondary" type="button" disabled={props.disabled || !props.canApproveAlways} onClick={() => props.onApproveAlways?.()}>
        {pending() || "总是批准"}
      </button>
    </>
  )
}

export const ApprovalDetailsBody: Component<{ approval: ApprovalDetails; compact?: boolean }> = (props) => {
  return (
    <div class="approval-detail-body">
      <ApprovalIntentHeadline approval={props.approval} />
      <ApprovalTechnicalDetails approval={props.approval} compact={props.compact} />
    </div>
  )
}

const ApprovalIntentHeadline: Component<{ approval: ApprovalDetails }> = (props) => (
  <section class="approval-intent">
    <span>助手想要</span>
    <strong>{approvalIntentText(props.approval)}</strong>
  </section>
)

const ApprovalTechnicalDetails: Component<{ approval: ApprovalDetails; compact?: boolean }> = (props) => {
  const command = createMemo(() => extractApprovalCommand(props.approval))
  const filePath = createMemo(() => approvalFilePath(props.approval))
  const technicalArgs = createMemo(() => compactObject(stripCommandFields(props.approval.toolArgs)))
  const technicalPayload = createMemo(() => props.approval.rawPayload ? compactObject(stripCommandFields(props.approval.rawPayload)) : {})
  const visibleSections = createMemo(() => props.approval.sections.filter((section) => section.kind !== "json" || section.id !== "args"))

  return (
    <section class="approval-technical">
      <h3>技术详情</h3>

      <Show when={command()}>
        <ApprovalField title="将执行的命令">
          <pre class="approval-command">{command()}</pre>
        </ApprovalField>
      </Show>

      <Show when={filePath()}>
        <ApprovalField title="目标路径">
          <code class="approval-inline-code">{filePath()}</code>
        </ApprovalField>
      </Show>

      <Show when={Object.keys(technicalArgs()).length > 0}>
        <ApprovalField title="参数">
          <KeyValueTable value={technicalArgs()} />
        </ApprovalField>
      </Show>

      <For each={visibleSections()}>
        {(section) => <ApprovalSectionView section={section} />}
      </For>

      <Show when={props.approval.previewUnavailable || props.approval.previewError}>
        <div class="approval-preview-warning">
          <span class="codicon codicon-warning" aria-hidden="true" />
          <span>{props.approval.previewError || "无法生成预览。"}</span>
        </div>
      </Show>

      <Show when={Object.keys(technicalPayload()).length > 0 && !props.compact}>
        <details class="approval-raw">
          <summary>原始数据</summary>
          <pre>{formatJson(technicalPayload())}</pre>
        </details>
      </Show>
    </section>
  )
}

const ApprovalField: Component<{ title: string; children: import("solid-js").JSX.Element }> = (props) => (
  <section class="approval-field">
    <div class="approval-field__title">{props.title}</div>
    {props.children}
  </section>
)

const ApprovalSectionView: Component<{ section: ApprovalSection }> = (props) => {
  const title = () => props.section.title || props.section.id || "详情"
  const kind = () => props.section.kind || "text"
  const jsonContent = () => objectValue(props.section.content)
  return (
    <ApprovalField title={title()}>
      <Show
        when={kind() === "diff"}
        fallback={
          <Show
            when={kind() === "json"}
            fallback={<pre class="approval-section-text">{String(props.section.content ?? "")}</pre>}
          >
            <Show
              when={Object.keys(jsonContent()).length > 0}
              fallback={<pre class="approval-section-text">{formatInlineValue(props.section.content)}</pre>}
            >
              <KeyValueTable value={jsonContent()} />
            </Show>
          </Show>
        }
      >
        <pre class="approval-diff">{String(props.section.content || buildTextDiffFallback(props.section))}</pre>
      </Show>
    </ApprovalField>
  )
}

const KeyValueTable: Component<{ value: Record<string, unknown> }> = (props) => (
  <div class="approval-kv">
    <For each={Object.entries(props.value)}>
      {([key, value]) => (
        <div class="approval-kv__row">
          <span>{key}</span>
          <code>{formatInlineValue(value)}</code>
        </div>
      )}
    </For>
  </div>
)

const COMMAND_FIELD_KEYS = new Set(["command", "cmd", "shell", "args", "argv", "command_line", "commandLine", "intent"])

function stripCommandFields(value: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value || {})) {
    if (COMMAND_FIELD_KEYS.has(key)) continue
    if (key === "tool_args" && item && typeof item === "object" && !Array.isArray(item)) {
      result[key] = stripCommandFields(item as Record<string, unknown>)
      continue
    }
    result[key] = item
  }
  return result
}

function compactObject(value: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value || {})) {
    if (item && typeof item === "object" && !Array.isArray(item)) {
      const nested = compactObject(item as Record<string, unknown>)
      if (Object.keys(nested).length) result[key] = nested
      continue
    }
    if (item !== undefined && item !== "") result[key] = item
  }
  return result
}

function buildTextDiffFallback(section: ApprovalSection): string {
  const original = stringValue(section.original_text)
  const modified = stringValue(section.modified_text)
  if (!original && !modified) return ""
  return [
    "--- original",
    "+++ modified",
    ...original.split(/\r?\n/).map((line) => `- ${line}`),
    ...modified.split(/\r?\n/).map((line) => `+ ${line}`),
  ].join("\n")
}
