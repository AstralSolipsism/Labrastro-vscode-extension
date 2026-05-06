import { Component, For, Show, createMemo } from "solid-js"
import { DialogSurface } from "../common/interaction"

export type ApprovalDecision = "allow_once" | "deny_once"
export type AutoApprovalCategory = "readOnly" | "write" | "delete" | "execute" | "mcp" | "unknown"

export interface ApprovalSection {
  id?: string
  title?: string
  kind?: string
  content?: unknown
  path?: string
  resolved_path?: string
  original_text?: string
  modified_text?: string
}

export interface ApprovalDetails {
  approvalId: string
  toolCallId?: string
  toolName: string
  toolSource?: string
  reason?: string
  content?: string
  command?: string
  autoApprovalReason?: string
  toolArgs: Record<string, unknown>
  sections: ApprovalSection[]
  previewUnavailable?: boolean
  previewError?: string
  rawPayload?: Record<string, unknown>
}

interface ApprovalDetailsDialogProps {
  approval: ApprovalDetails
  onClose: () => void
  onDecision: (decision: ApprovalDecision) => void
}

export const DEFAULT_AUTO_APPROVE_OPTIONS: Record<AutoApprovalCategory, boolean> = {
  readOnly: false,
  write: false,
  delete: false,
  execute: false,
  mcp: false,
  unknown: false,
}

export function approvalFromPayload(
  payload: Record<string, unknown>,
  fallback: Partial<ApprovalDetails> = {},
): ApprovalDetails {
  const toolArgs = objectValue(payload.tool_args)
  const sections = Array.isArray(payload.sections)
    ? payload.sections.filter((item): item is ApprovalSection => Boolean(item && typeof item === "object")) as ApprovalSection[]
    : fallback.sections || []
  return {
    approvalId: stringValue(payload.approval_id) || fallback.approvalId || "",
    toolCallId: stringValue(payload.tool_call_id) || fallback.toolCallId,
    toolName: stringValue(payload.tool_name) || fallback.toolName || "tool",
    toolSource: stringValue(payload.tool_source) || fallback.toolSource,
    reason: stringValue(payload.reason) || fallback.reason,
    content: stringValue(payload.content) || fallback.content,
    command: extractApprovalCommandFromArgs(toolArgs) || fallback.command,
    autoApprovalReason: fallback.autoApprovalReason,
    toolArgs: Object.keys(toolArgs).length ? toolArgs : fallback.toolArgs || {},
    sections,
    previewUnavailable: payload.preview_unavailable === true || fallback.previewUnavailable,
    previewError: stringValue(payload.preview_error) || fallback.previewError,
    rawPayload: Object.keys(payload).length ? payload : fallback.rawPayload,
  }
}

export function approvalSummary(approval: ApprovalDetails): {
  title: string
  primary: string
  secondary: string
  icon: string
  category: AutoApprovalCategory
} {
  const category = classifyApproval(approval)
  const filePath = approvalFilePath(approval)
  const mcpTarget = stringValue(approval.toolArgs.server) || stringValue(approval.toolArgs.mcp_server)
  const command = approval.command || extractApprovalCommandFromArgs(approval.toolArgs)
  if (category === "execute") {
    return {
      title: "执行命令",
      primary: command || approval.toolName,
      secondary: approval.autoApprovalReason || approval.reason || "此命令需要批准后执行。",
      icon: "terminal",
      category,
    }
  }
  if (category === "write") {
    return {
      title: approval.toolName === "edit_file" || approval.toolName === "apply_patch" ? "修改文件" : "写入文件",
      primary: filePath || approval.toolName,
      secondary: approval.reason || "此文件变更需要批准。",
      icon: "diff-modified",
      category,
    }
  }
  if (category === "delete") {
    return {
      title: "删除内容",
      primary: filePath || command || approval.toolName,
      secondary: approval.reason || "此删除操作需要批准。",
      icon: "trash",
      category,
    }
  }
  if (category === "mcp") {
    return {
      title: "调用 MCP",
      primary: [mcpTarget, approval.toolName].filter(Boolean).join(" · ") || approval.toolName,
      secondary: approval.reason || "此 MCP 工具调用需要批准。",
      icon: "extensions",
      category,
    }
  }
  if (category === "readOnly") {
    return {
      title: "读取信息",
      primary: filePath || command || approval.toolName,
      secondary: approval.reason || "此读取操作需要批准。",
      icon: "eye",
      category,
    }
  }
  return {
    title: "工具调用",
    primary: filePath || command || approval.toolName,
    secondary: approval.reason || "此工具调用需要批准。",
    icon: "tools",
    category,
  }
}

export function classifyApproval(approval: ApprovalDetails): AutoApprovalCategory {
  const source = (approval.toolSource || "").toLowerCase()
  const tool = approval.toolName.toLowerCase()
  if (source.includes("mcp") || tool === "mcp" || tool.startsWith("mcp_")) return "mcp"
  if (/(delete|remove|unlink|rmdir|rm_file|trash)/.test(tool)) return "delete"
  if (/(write|edit|patch|create|append|replace|move|rename)/.test(tool)) return "write"
  if (/(shell|execute|command|terminal|run)/.test(tool)) return "execute"
  if (/(read|list|search|grep|glob|find|cat|ls|stat|inspect|view)/.test(tool)) return "readOnly"
  return "unknown"
}

export function shouldAutoApprove(
  approval: ApprovalDetails,
  options: Record<string, boolean>,
  executeDecision?: "auto_approve" | "auto_deny" | "ask_user",
): boolean {
  const category = classifyApproval(approval)
  if (category === "unknown") return false
  if (category === "execute") {
    return options.execute === true && executeDecision === "auto_approve"
  }
  return options[category] === true
}

export function extractApprovalCommand(approval: ApprovalDetails): string {
  return approval.command || extractApprovalCommandFromArgs(approval.toolArgs)
}

export const ApprovalDetailsDialog: Component<ApprovalDetailsDialogProps> = (props) => {
  const summary = createMemo(() => approvalSummary(props.approval))

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
        <footer class="approval-dialog__footer">
          <button class="approval-dialog__button approval-dialog__button--secondary" type="button" onClick={() => props.onClose()}>
            关闭
          </button>
          <button class="approval-dialog__button approval-dialog__button--secondary" type="button" onClick={() => props.onDecision("deny_once")}>
            拒绝
          </button>
          <button class="approval-dialog__button approval-dialog__button--primary" type="button" onClick={() => props.onDecision("allow_once")}>
            批准一次
          </button>
        </footer>
    </DialogSurface>
  )
}

export const ApprovalDetailsBody: Component<{ approval: ApprovalDetails; compact?: boolean }> = (props) => {
  const summary = createMemo(() => approvalSummary(props.approval))
  const command = createMemo(() => props.approval.command || extractApprovalCommandFromArgs(props.approval.toolArgs))
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

function approvalFilePath(approval: ApprovalDetails): string {
  const sectionPath = approval.sections
    .map((section) => stringValue(section.resolved_path) || stringValue(section.path))
    .find(Boolean)
  return (
    sectionPath ||
    stringValue(approval.toolArgs.file_path) ||
    stringValue(approval.toolArgs.path) ||
    stringValue(approval.toolArgs.target_path) ||
    ""
  )
}

function extractApprovalCommandFromArgs(args: Record<string, unknown>): string {
  return stringValue(args.command) || stringValue(args.cmd) || stringValue(args.shell) || ""
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

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : value == null ? "" : String(value)
}

function formatInlineValue(value: unknown): string {
  if (typeof value === "string") return value
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  if (value == null) return ""
  return JSON.stringify(value, null, 2)
}

function formatJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}
