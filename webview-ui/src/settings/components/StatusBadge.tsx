import { Component, JSX } from "solid-js"

export const StatusBadge: Component<{ tone?: "success" | "warning" | "muted" | "error"; children: JSX.Element }> = (props) => {
  return <span class={`settings-badge settings-badge--${props.tone || "muted"}`}>{props.children}</span>
}
