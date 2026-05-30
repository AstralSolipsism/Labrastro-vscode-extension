export type CapabilitySection =
  | "capabilities"
  | "packages"
  | "dependencies"
  | "behavior"
  | "logs"

export const CAPABILITY_SECTIONS: Array<{ id: CapabilitySection; label: string; icon: string }> = [
  { id: "capabilities", label: "能力", icon: "extensions" },
  { id: "packages", label: "能力包", icon: "package" },
  { id: "behavior", label: "行为管理", icon: "terminal" },
]
