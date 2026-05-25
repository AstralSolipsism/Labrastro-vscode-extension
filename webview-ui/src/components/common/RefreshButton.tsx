import { Component, JSX, createSignal, onCleanup } from "solid-js"

interface RefreshButtonProps {
  children: JSX.Element
  class?: string
  disabled?: boolean
  icon?: string
  loading?: boolean
  loadingLabel?: JSX.Element
  minDurationMs?: number
  title?: string
  type?: "button" | "submit" | "reset"
  onClick?: (event: MouseEvent) => void | Promise<unknown>
}

const DEFAULT_FEEDBACK_MS = 900

export const RefreshButton: Component<RefreshButtonProps> = (props) => {
  const [localLoading, setLocalLoading] = createSignal(false)
  let resetTimer: number | undefined

  onCleanup(() => {
    if (resetTimer) window.clearTimeout(resetTimer)
  })

  const loading = () => props.loading === true || (props.loading === undefined && localLoading())
  const disabled = () => props.disabled === true || loading()

  const scheduleReset = () => {
    if (resetTimer) window.clearTimeout(resetTimer)
    resetTimer = window.setTimeout(() => setLocalLoading(false), props.minDurationMs ?? DEFAULT_FEEDBACK_MS)
  }

  const handleClick = (event: MouseEvent) => {
    if (disabled()) {
      event.preventDefault()
      return
    }
    if (props.loading === undefined) setLocalLoading(true)
    try {
      const result = props.onClick?.(event)
      if (result && typeof (result as Promise<unknown>).then === "function") {
        void (result as Promise<unknown>)
          .catch((error) => console.error("RefreshButton click error:", error))
          .finally(scheduleReset)
        return
      }
    } catch (error) {
      console.error("RefreshButton click error:", error)
    }
    scheduleReset()
  }

  return (
    <button
      class={`btn ${props.class || ""} ${loading() ? "btn--loading" : ""}`}
      type={props.type || "button"}
      title={props.title}
      aria-busy={loading() ? "true" : "false"}
      data-refreshing={loading() ? "true" : "false"}
      disabled={disabled()}
      onClick={handleClick}
    >
      <span class={`codicon codicon-${loading() ? "loading" : props.icon || "refresh"}`} aria-hidden="true" />
      <span>{loading() ? props.loadingLabel || "刷新中…" : props.children}</span>
    </button>
  )
}
