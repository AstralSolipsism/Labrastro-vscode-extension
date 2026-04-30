import { Component, JSX, Show } from "solid-js"

interface IconButtonProps {
  icon: string
  title: string
  class?: string
  disabled?: boolean
  type?: "button" | "submit" | "reset"
  children?: JSX.Element
  onClick?: (event: MouseEvent) => void
}

export const IconButton: Component<IconButtonProps> = (props) => {
  return (
    <button
      type={props.type || "button"}
      class={`ez-icon-button ${props.class || ""}`}
      disabled={props.disabled}
      title={props.title}
      aria-label={props.title}
      onClick={props.onClick}
    >
      <span class={`codicon codicon-${props.icon}`} aria-hidden="true" />
      <Show when={props.children}>
        <span class="ez-icon-button__label">{props.children}</span>
      </Show>
    </button>
  )
}
