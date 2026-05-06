import { Component, JSX, Show, createSignal, onCleanup } from "solid-js"

interface IconButtonProps {
  icon: string
  title: string
  class?: string
  disabled?: boolean
  type?: "button" | "submit" | "reset"
  children?: JSX.Element
  onClick?: (event: MouseEvent) => void | Promise<any>
}

export const IconButton: Component<IconButtonProps> = (props) => {
  const [status, setStatus] = createSignal<"idle" | "loading" | "success" | "error">("idle")
  let timeoutId: number | undefined

  onCleanup(() => {
    if (timeoutId) clearTimeout(timeoutId)
  })

  const handleClick = async (e: MouseEvent) => {
    if (status() === "loading" || props.disabled) {
      e.preventDefault()
      return
    }

    if (props.onClick) {
      const result = props.onClick(e)
      if (result instanceof Promise) {
        setStatus("loading")
        try {
          await result
          setStatus("success")
        } catch (err) {
          console.error("IconButton async onClick error:", err)
          setStatus("error")
        } finally {
          timeoutId = window.setTimeout(() => {
            if (status() === "success" || status() === "error") {
              setStatus("idle")
            }
          }, 1500)
        }
      }
    }
  }

  const currentIcon = () => {
    switch (status()) {
      case "loading": return "loading"
      case "success": return "check"
      case "error": return "error"
      default: return props.icon
    }
  }

  return (
    <button
      type={props.type || "button"}
      class={`ez-icon-button ${status() !== "idle" ? `btn--${status()}` : ""} ${props.class || ""}`}
      disabled={props.disabled || status() === "loading"}
      title={props.title}
      aria-label={props.title}
      onClick={handleClick}
    >
      <span class={`codicon codicon-${currentIcon()}`} aria-hidden="true" />
      <Show when={props.children}>
        <span class="ez-icon-button__label">{props.children}</span>
      </Show>
    </button>
  )
}
