import { Component, For, createEffect, createMemo, createSignal, onCleanup } from "solid-js"
import { t } from "../../i18n"
import { useVSCode } from "../../context/vscode"
import { renderStreamingMarkdown, type MarkdownRenderPart } from "./markdown-render"

interface MarkdownBlockProps {
  text?: string
  class?: string
}

const UNSAFE_PROTOCOL = /^(?:javascript|command|data|vbscript):/i
const DRIVE_LINE_TARGET = /^([A-Za-z]:[\\/].*?)(?::(\d+))(?::(\d+))?$/
const PATH_LINE_TARGET = /^(.+?)(?::(\d+))(?::(\d+))?$/

export const MarkdownBlock: Component<MarkdownBlockProps> = (props) => {
  const vscode = useVSCode()
  const text = () => props.text || ""
  const className = () => ["assistant-text-part", "assistant-markdown", props.class].filter(Boolean).join(" ")
  const [renderText, setRenderText] = createSignal(text())
  const parts = createMemo(() => renderStreamingMarkdown(renderText(), props.class || "default"))
  let renderedValue = text()
  let pendingValue = renderedValue
  let frameId: number | undefined
  let timeoutId: number | undefined

  const cancelPendingRender = () => {
    if (frameId !== undefined) {
      cancelAnimationFrame(frameId)
      frameId = undefined
    }
    if (timeoutId !== undefined) {
      window.clearTimeout(timeoutId)
      timeoutId = undefined
    }
  }

  createEffect(() => {
    const next = text()
    if (next === renderedValue) {
      pendingValue = renderedValue
      cancelPendingRender()
      return
    }
    if (next === pendingValue && (frameId !== undefined || timeoutId !== undefined)) return
    pendingValue = next
    cancelPendingRender()
    const apply = () => {
      frameId = undefined
      timeoutId = undefined
      renderedValue = next
      setRenderText(next)
    }
    if (typeof requestAnimationFrame === "function") {
      frameId = requestAnimationFrame(apply)
      return
    }
    timeoutId = window.setTimeout(apply, 16)
  })

  onCleanup(cancelPendingRender)

  const handleClick = async (event: MouseEvent) => {
    const target = event.target as HTMLElement | null
    if (!target) return

    const copyButton = target.closest("[data-copy-code]")
    if (copyButton) {
      event.preventDefault()
      const block = copyButton.closest("[data-code-block]")
      const code = block?.querySelector("code")?.textContent || ""
      if (code) {
        try {
          await navigator.clipboard?.writeText(code)
        } catch {
          vscode.postMessage({ type: "showInfo", text: t("markdown.copyFailed") })
        }
      }
      return
    }

    const anchor = target.closest("a[href]") as HTMLAnchorElement | null
    if (!anchor) return
    const href = anchor.getAttribute("href") || ""
    if (!href || UNSAFE_PROTOCOL.test(href.trim())) {
      event.preventDefault()
      return
    }

    event.preventDefault()
    if (/^https?:\/\//i.test(href)) {
      vscode.postMessage({ type: "openExternal", url: href })
      return
    }

    const targetFile = parseFileTarget(href)
    if (targetFile) {
      vscode.postMessage({ type: "openFile", ...targetFile })
    }
  }

  return (
    <div class={className()} onClick={handleClick}>
      <For each={parts()}>
        {(part) => (
          part.type === "html"
            ? <div innerHTML={part.html} />
            : <OpenCodeBlock part={part} />
        )}
      </For>
    </div>
  )
}

const OpenCodeBlock: Component<{ part: Extract<MarkdownRenderPart, { type: "open-code" }> }> = (props) => (
  <div class="markdown-code-block markdown-code-block--streaming">
    <div class="markdown-code-block__header">
      <span class="markdown-code-block__language">{props.part.language || "text"}</span>
      <span class="markdown-code-block__language">{t("tool.section.liveOutput")}</span>
    </div>
    <pre class="markdown-code"><code>{props.part.code}</code></pre>
  </div>
)

function parseFileTarget(rawHref: string): { path: string; line?: number; column?: number } | undefined {
  let value = decodeSafe(rawHref).trim()
  if (!value) return undefined
  if (/^file:\/\//i.test(value)) {
    try {
      value = new URL(value).pathname
      if (/^\/[A-Za-z]:\//.test(value)) value = value.slice(1)
      value = value.replace(/\//g, "\\")
    } catch {
      value = value.replace(/^file:\/\//i, "")
    }
  }
  value = value.split("#")[0].split("?")[0]
  if (!value || /^https?:\/\//i.test(value) || UNSAFE_PROTOCOL.test(value)) return undefined

  const driveMatch = value.match(DRIVE_LINE_TARGET)
  if (driveMatch) return fileTarget(driveMatch[1], driveMatch[2], driveMatch[3])

  const pathMatch = value.match(PATH_LINE_TARGET)
  if (pathMatch && pathMatch[2] && looksLikePath(pathMatch[1])) {
    return fileTarget(pathMatch[1], pathMatch[2], pathMatch[3])
  }
  if (looksLikePath(value)) return { path: value }
  return undefined
}

function fileTarget(path: string, line?: string, column?: string) {
  return {
    path,
    line: line ? Number(line) : undefined,
    column: column ? Number(column) : undefined,
  }
}

function looksLikePath(value: string): boolean {
  return (
    /^[A-Za-z]:[\\/]/.test(value) ||
    value.startsWith("/") ||
    value.startsWith("./") ||
    value.startsWith("../") ||
    /\.[A-Za-z0-9]{1,12}$/.test(value) ||
    value.includes("/") ||
    value.includes("\\")
  )
}

function decodeSafe(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}
