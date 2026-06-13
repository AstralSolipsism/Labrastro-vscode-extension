export interface LifecycleDisplayLabels {
  defaultTitle: string
  toolCheck: string
  toolBlocked: string
  toolResult: string
  promptReview: string
  recovery: string
  elicitation: string
  elicitationResult: string
}

export const DEFAULT_LIFECYCLE_DISPLAY_LABELS: LifecycleDisplayLabels = {
  defaultTitle: "生命周期事件",
  toolCheck: "工具调用检查",
  toolBlocked: "工具调用已被策略拦截",
  toolResult: "工具结果已记录",
  promptReview: "提交前确认",
  recovery: "运行恢复信息",
  elicitation: "MCP 交互请求",
  elicitationResult: "MCP 交互结果",
}

export function isLifecycleHookPayload(payload?: Record<string, unknown>): boolean {
  if (!payload) return false
  const schema = stringValue(payload.schema).toLowerCase()
  if (schema === "lifecycle_hook.v1") return true
  return Boolean(stringValue(payload.event_name) && stringValue(payload.hook_id))
}

export function lifecycleDisplayTitle(
  payload?: Record<string, unknown>,
  labels: Partial<LifecycleDisplayLabels> = {},
): string {
  const merged = { ...DEFAULT_LIFECYCLE_DISPLAY_LABELS, ...labels }
  if (!payload) return merged.defaultTitle
  const eventName = stringValue(payload.event_name || payload.event_type)
  if (eventName === "PreToolUse") {
    return lifecycleWasBlocked(payload) ? merged.toolBlocked : merged.toolCheck
  }
  if (eventName === "PostToolUse") return merged.toolResult
  if (eventName === "UserPromptSubmit") return merged.promptReview
  if (eventName === "StopFailure") return merged.recovery
  if (eventName === "ElicitationResult") return merged.elicitationResult
  if (eventName === "Elicitation") return merged.elicitation
  return merged.defaultTitle
}

export function lifecycleDisplayMeta(payload?: Record<string, unknown>): string {
  if (!payload) return ""
  const tool = stringValue(payload.tool_name || payload.tool || payload.command)
  const server = stringValue(payload.mcp_server || payload.server || payload.server_name)
  return [server, tool].filter(Boolean).join(" · ")
}

function lifecycleWasBlocked(payload: Record<string, unknown>): boolean {
  const decision = stringValue(payload.decision || payload.action || payload.status).toLowerCase()
  return payload.continue_flow === false ||
    decision === "deny" ||
    decision === "denied" ||
    decision === "block" ||
    decision === "blocked" ||
    decision === "error" ||
    decision === "failed"
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}
