export type CapabilitySection =
  | "capabilities"
  | "mcp"
  | "skills"
  | "dependencies"
  | "behavior"

export const CAPABILITY_SECTIONS: Array<{ id: CapabilitySection; label: string; icon: string }> = [
  { id: "capabilities", label: "能力", icon: "sparkle" },
  { id: "mcp", label: "MCP", icon: "extensions" },
  { id: "skills", label: "Skills", icon: "tools" },
  { id: "dependencies", label: "依赖", icon: "package" },
  { id: "behavior", label: "行为", icon: "symbol-event" },
]
