import { Component, For } from "solid-js"

interface AutoApproveMenuProps {
  enabledOptions: Record<string, boolean>
  allowedCommands?: string[]
  onToggleOption?: (key: string, value: boolean) => void
}

const OPTIONS = [
  { key: "readOnly", label: "读取", icon: "eye" },
  { key: "write", label: "写入", icon: "edit" },
  { key: "delete", label: "删除", icon: "trash" },
  { key: "execute", label: "执行", icon: "terminal" },
  { key: "mcp", label: "MCP", icon: "extensions" },
]

export const AutoApproveMenu: Component<AutoApproveMenuProps> = (props) => {
  const titleFor = (key: string, label: string) => {
    if (key !== "execute") return label
    return props.allowedCommands?.length
      ? "仅自动批准白名单命令"
      : "仅自动批准白名单命令；当前白名单为空"
  }

  return (
    <div class="auto-approve-bar">
      <span class="auto-approve-label">自动批准</span>
      <div class="auto-approve-options">
        <For each={OPTIONS}>
          {(option) => (
            <button
              type="button"
              class="auto-approve-option"
              classList={{
                "auto-approve-option--enabled": props.enabledOptions[option.key],
                "auto-approve-option--warning": option.key === "execute" && props.enabledOptions[option.key] && !props.allowedCommands?.length,
              }}
              title={titleFor(option.key, option.label)}
              aria-pressed={props.enabledOptions[option.key]}
              onClick={() => props.onToggleOption?.(option.key, !props.enabledOptions[option.key])}
            >
              <span class={`codicon codicon-${option.icon}`} aria-hidden="true" />
              <span>{option.label}</span>
            </button>
          )}
        </For>
      </div>
    </div>
  )
}
