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
