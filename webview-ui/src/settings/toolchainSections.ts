export type ToolchainSection =
  | "capabilities"
  | "packages"
  | "dependencies"
  | "behavior"
  | "logs"

export const TOOLCHAIN_SECTIONS: Array<{ id: ToolchainSection; label: string; icon: string }> = [
  { id: "capabilities", label: "能力", icon: "extensions" },
  { id: "packages", label: "能力包", icon: "package" },
  { id: "dependencies", label: "能力依赖", icon: "symbol-method" },
  { id: "behavior", label: "行为管理", icon: "terminal" },
  { id: "logs", label: "运行日志", icon: "output" },
]
