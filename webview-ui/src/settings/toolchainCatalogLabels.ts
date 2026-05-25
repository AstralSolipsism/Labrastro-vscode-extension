export function agentToolExecutionPolicyLabel(value: string): string {
  if (value === "allow") return "自动允许"
  if (value === "warn") return "允许并提示"
  if (value === "deny") return "拒绝执行"
  if (value === "require_approval" || value === "require_user") return "需用户确认"
  if (value === "escalate") return "升级处理"
  if (value === "inherits_component_policy" || value === "inherit") return "继承策略"
  return value || "—"
}

export function agentToolExecutionPolicyTitle(value: string): string {
  if (value === "allow") return "已授权的运行时 tool 调用会直接执行，不打断后台任务。"
  if (value === "warn") return "运行时 tool 调用会执行，同时记录或提示风险。"
  if (value === "deny") return "运行时 tool 调用会被策略拒绝。"
  if (value === "require_approval" || value === "require_user") return "仅交互式 ChatView 场景适合请求用户确认；后台任务应阻断或升级。"
  if (value === "escalate") return "后台任务遇到该能力时应升级给主 agent 或转为待处理状态。"
  if (value === "inherits_component_policy" || value === "inherit") return "能力包本身不是一次 tool 调用；实际执行策略由包内组件或 agent 授权结果决定。"
  return "运行时 tool 调用的执行授权策略。"
}

interface AgentToolPermissionView {
  action?: string
  reason?: string
  warning?: string
  capabilityMatched?: string
  policyMatched?: string
  approvalAction?: string
}

function permissionAction(value: string | AgentToolPermissionView | null | undefined): string {
  if (!value) return ""
  if (typeof value === "string") return value
  return value.action || ""
}

export function agentToolPermissionLabel(value: string | AgentToolPermissionView | null | undefined): string {
  const action = permissionAction(value)
  if (action === "allow") return "已授权"
  if (action === "warn") return "已授权，提示"
  if (action === "require_approval" || action === "require_user") return "交互审批"
  if (action === "blocked_review") return "后台复核"
  if (action === "deny") return "未授权"
  if (action === "escalate") return "升级处理"
  if (action === "inherits_component_policy" || action === "inherit") return "继承策略"
  return action || "—"
}

export function agentToolPermissionTitle(value: string | AgentToolPermissionView | null | undefined): string {
  const action = permissionAction(value)
  const base =
    action === "allow" ? "PermissionGateway 已允许该 tool 在当前 Agent 权限上下文中执行。" :
    action === "warn" ? "PermissionGateway 允许执行，但要求记录或展示风险提示。" :
    action === "require_approval" || action === "require_user" ? "PermissionGateway 要求交互式 ChatView 中由用户确认后执行。" :
    action === "blocked_review" ? "PermissionGateway 判断后台/无人值守场景不能等待审批，已转为待复核。" :
    action === "deny" ? "PermissionGateway 已拒绝该 tool 在当前 Agent 权限上下文中执行。" :
    action === "inherits_component_policy" || action === "inherit" ? "该项继承能力包或组件策略，最终仍以后端 PermissionGateway 裁决为准。" :
    "后端 PermissionGateway 返回的运行时权限裁决。"
  if (!value || typeof value === "string") return base
  const details = [
    value.reason,
    value.warning,
    value.capabilityMatched ? `能力: ${value.capabilityMatched}` : "",
    value.policyMatched ? `策略: ${value.policyMatched}` : "",
    value.approvalAction ? `审批: ${value.approvalAction}` : "",
  ].filter(Boolean)
  return details.length ? `${base} ${details.join("；")}` : base
}
