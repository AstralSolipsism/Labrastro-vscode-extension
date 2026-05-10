import { type CommandDecision } from "../../utils/command-auto-approval"

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
    command: stringValue(payload.command) || extractApprovalCommandFromArgs(toolArgs) || fallback.command,
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
  const mcpTarget =
    stringValue(approval.toolArgs.server) ||
    stringValue(approval.toolArgs.serverName) ||
    stringValue(approval.toolArgs.server_name) ||
    stringValue(approval.toolArgs.mcp_server)
  const mcpTool =
    stringValue(approval.toolArgs.tool) ||
    stringValue(approval.toolArgs.toolName) ||
    stringValue(approval.toolArgs.tool_name) ||
    approval.toolName
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
      primary: [mcpTarget, mcpTool].filter(Boolean).join(" · ") || approval.toolName,
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
  if (source.includes("mcp") || tool === "mcp" || tool.startsWith("mcp_") || tool.includes("mcp")) return "mcp"
  if (/(delete|remove|unlink|rmdir|rm_file|trash)/.test(tool)) return "delete"
  if (/(write|edit|patch|create|append|replace|move|rename)/.test(tool)) return "write"
  if (/(shell|execute|command|terminal|run)/.test(tool)) return "execute"
  if (/(read|list|search|grep|glob|find|cat|ls|stat|inspect|view)/.test(tool)) return "readOnly"
  return "unknown"
}

export function shouldAutoApprove(
  approval: ApprovalDetails,
  options: Record<string, boolean>,
  executeDecision?: CommandDecision,
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

export function approvalFilePath(approval: ApprovalDetails): string {
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

export function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

export function stringValue(value: unknown): string {
  return typeof value === "string" ? value : value == null ? "" : String(value)
}

export function formatInlineValue(value: unknown): string {
  if (typeof value === "string") return value
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  if (value == null) return ""
  return JSON.stringify(value, null, 2)
}

export function formatJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function extractApprovalCommandFromArgs(args: Record<string, unknown>): string {
  return (
    commandValue(args.command) ||
    commandValue(args.cmd) ||
    commandValue(args.shell) ||
    commandValue(args.args) ||
    commandValue(args.argv) ||
    commandValue(args.command_line) ||
    commandValue(args.commandLine) ||
    ""
  )
}

function commandValue(value: unknown): string {
  if (typeof value === "string") return value
  if (Array.isArray(value)) {
    return value.map((item) => stringValue(item)).filter(Boolean).join(" ")
  }
  return ""
}
