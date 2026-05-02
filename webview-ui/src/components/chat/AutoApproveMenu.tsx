import { Component, For } from "solid-js"
import { t } from "../../i18n"

interface AutoApproveMenuProps {
  enabledOptions: Record<string, boolean>
  allowedCommands?: string[]
  onToggleOption?: (key: string, value: boolean) => void
}


export const AutoApproveMenu: Component<AutoApproveMenuProps> = (props) => {
  const options = () => [
    { key: "readOnly", label: t("autoApproveMenu.read"), icon: "eye" },
    { key: "write", label: t("autoApproveMenu.write"), icon: "edit" },
    { key: "delete", label: t("autoApproveMenu.delete"), icon: "trash" },
    { key: "execute", label: t("autoApproveMenu.execute"), icon: "terminal" },
    { key: "mcp", label: "MCP", icon: "extensions" },
  ]

  const titleFor = (key: string, label: string) => {
    if (key !== "execute") return label
    return props.allowedCommands?.length
      ? t("autoApproveMenu.onlyWhitelist")
      : t("autoApproveMenu.onlyWhitelistEmpty")
  }

  return (
    <div class="auto-approve-bar">
      <span class="auto-approve-label">{t("autoApproveMenu.label")}</span>
      <div class="auto-approve-options">
        <For each={options()}>
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
