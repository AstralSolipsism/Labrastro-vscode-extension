export type ToolchainSection =
  | "dashboard"
  | "components"
  | "packages"
  | "userActions"
  | "agentTools"
  | "logs"

export const TOOLCHAIN_SECTIONS: Array<{ id: ToolchainSection; label: string; icon: string }> = [
  { id: "dashboard", label: "环境看板", icon: "dashboard" },
  { id: "components", label: "组件清单", icon: "symbol-method" },
  { id: "packages", label: "能力包", icon: "package" },
  { id: "userActions", label: "用户指令", icon: "terminal" },
  { id: "agentTools", label: "Agent Tools", icon: "tools" },
  { id: "logs", label: "运行日志", icon: "output" },
]
