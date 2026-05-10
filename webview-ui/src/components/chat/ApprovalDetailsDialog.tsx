import { Component, For, Show, createEffect, createMemo, createSignal } from "solid-js"
import {
  buildCommandRuleCandidates,
  type CommandRuleCandidate,
  type CommandRuleLevel,
} from "../../utils/command-auto-approval"
import { DialogSurface } from "../common/interaction"
import {
  approvalFilePath,
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
  onAlwaysAllow?: () => void
  onRememberDecision?: (decision: ApprovalDecision, rules: string[]) => void
}

export const ApprovalDetailsDialog: Component<ApprovalDetailsDialogProps> = (props) => {
  const summary = createMemo(() => approvalSummary(props.approval))
  const command = createMemo(() => extractApprovalCommand(props.approval))
  const commandRuleCandidates = createMemo(() =>
    props.autoApprovalCandidates || buildCommandRuleCandidates(command())
  )
  const [selectedRuleLevel, setSelectedRuleLevel] = createSignal<CommandRuleLevel>("exact")
  const selectedRuleCandidate = createMemo(() =>
    commandRuleCandidates().find((candidate) => candidate.level === selectedRuleLevel()) ||
    commandRuleCandidates()[0]
  )
  const canRememberCommand = createMemo(() =>
    summary().category === "execute" &&
    Boolean(props.onRememberDecision) &&
    commandRuleCandidates().length > 0
  )
  const canAlwaysAllowCategory = createMemo(() =>
    summary().category === "mcp" &&
    Boolean(props.onAlwaysAllow)
  )

  createEffect(() => {
    const candidates = commandRuleCandidates()
    if (!candidates.length) return
    if (!candidates.some((candidate) => candidate.level === selectedRuleLevel())) {
      setSelectedRuleLevel(candidates[0]!.level)
    }
  })

  const rememberDecision = (decision: ApprovalDecision) => {
    const candidate = selectedRuleCandidate()
    if (!candidate || props.autoApprovalPending) return
    props.onRememberDecision?.(decision, candidate.rules)
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
              <h2>{summary().title}</h2>
              <span>{props.approval.toolName}</span>
            </div>
          </div>
          <button class="approval-dialog__close" type="button" onClick={() => props.onClose()} aria-label="关闭">
            <span class="codicon codicon-close" aria-hidden="true" />
          </button>
        </header>
        <ApprovalDetailsBody approval={props.approval} />
        <Show when={canRememberCommand()}>
          <ApprovalRulePanel
            candidates={commandRuleCandidates()}
            selectedLevel={selectedRuleCandidate()?.level}
            pending={props.autoApprovalPending}
            onSelect={setSelectedRuleLevel}
          />
        </Show>
        <footer class="approval-dialog__footer">
          <button class="approval-dialog__button approval-dialog__button--secondary" type="button" onClick={() => props.onClose()}>
            关闭
          </button>
          <button
            class="approval-dialog__button approval-dialog__button--secondary"
            type="button"
            disabled={props.autoApprovalPending}
            onClick={() => props.onDecision("deny_once")}
          >
            拒绝
          </button>
          <Show when={canRememberCommand()}>
            <button
              class="approval-dialog__button approval-dialog__button--danger"
              type="button"
              disabled={props.autoApprovalPending}
              onClick={() => rememberDecision("deny_once")}
            >
              {props.autoApprovalPending ? "写入中..." : "拒绝并记住"}
            </button>
            <button
              class="approval-dialog__button approval-dialog__button--primary"
              type="button"
              disabled={props.autoApprovalPending}
              onClick={() => rememberDecision("allow_once")}
            >
              {props.autoApprovalPending ? "写入中..." : "批准并始终运行"}
            </button>
          </Show>
          <Show when={canAlwaysAllowCategory()}>
            <button
              class="approval-dialog__button approval-dialog__button--primary"
              type="button"
              disabled={props.autoApprovalPending}
              onClick={() => props.onAlwaysAllow?.()}
            >
              {props.autoApprovalPending ? "写入中..." : "批准并始终允许 MCP"}
            </button>
          </Show>
          <button
            class={`approval-dialog__button ${canRememberCommand() || canAlwaysAllowCategory() ? "approval-dialog__button--secondary" : "approval-dialog__button--primary"}`}
            type="button"
            disabled={props.autoApprovalPending}
            onClick={() => props.onDecision("allow_once")}
          >
            批准一次
          </button>
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
    props.candidates.find((candidate) => candidate.level === props.selectedLevel) || props.candidates[0]
  )
  const activeLevel = createMemo(() => selectedCandidate()?.level)

  return (
    <section class="approval-remember">
      <div class="approval-remember__header">
        <span class="codicon codicon-shield" aria-hidden="true" />
        <div>
          <strong>自动批准规则</strong>
          <small>选择这条命令以后自动处理的匹配范围。</small>
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

export const ApprovalDetailsBody: Component<{ approval: ApprovalDetails; compact?: boolean }> = (props) => {
  const summary = createMemo(() => approvalSummary(props.approval))
  const command = createMemo(() => extractApprovalCommand(props.approval))
  const filePath = createMemo(() => approvalFilePath(props.approval))
  const visibleSections = createMemo(() => props.approval.sections.filter((section) => section.kind !== "json" || section.id !== "args"))

  return (
    <div class="approval-detail-body">
      <section class="approval-detail-summary">
        <div>
          <span>{summary().title}</span>
          <strong>{summary().primary}</strong>
          <Show when={summary().secondary}>
            <small>{summary().secondary}</small>
          </Show>
        </div>
      </section>

      <Show when={command()}>
        <ApprovalField title="命令">
          <pre class="approval-command">{command()}</pre>
        </ApprovalField>
      </Show>

      <Show when={filePath()}>
        <ApprovalField title="目标路径">
          <code class="approval-inline-code">{filePath()}</code>
        </ApprovalField>
      </Show>

      <Show when={Object.keys(props.approval.toolArgs).length > 0}>
        <ApprovalField title="关键参数">
          <KeyValueTable value={props.approval.toolArgs} />
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

      <Show when={props.approval.rawPayload}>
        <details class="approval-raw">
          <summary>原始数据</summary>
          <pre>{formatJson(props.approval.rawPayload)}</pre>
        </details>
      </Show>
    </div>
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
