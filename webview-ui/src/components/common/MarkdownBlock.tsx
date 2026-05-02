import { Component, createMemo } from "solid-js"
import { t } from "../../i18n"
import { Marked, type Tokens } from "marked"
import DOMPurify from "dompurify"
import hljs from "highlight.js/lib/core"
import bash from "highlight.js/lib/languages/bash"
import css from "highlight.js/lib/languages/css"
import diff from "highlight.js/lib/languages/diff"
import go from "highlight.js/lib/languages/go"
import javascript from "highlight.js/lib/languages/javascript"
import json from "highlight.js/lib/languages/json"
import markdown from "highlight.js/lib/languages/markdown"
import powershell from "highlight.js/lib/languages/powershell"
import python from "highlight.js/lib/languages/python"
import rust from "highlight.js/lib/languages/rust"
import typescript from "highlight.js/lib/languages/typescript"
import xml from "highlight.js/lib/languages/xml"
import yaml from "highlight.js/lib/languages/yaml"
import { useVSCode } from "../../context/vscode"

interface MarkdownBlockProps {
  text?: string
  class?: string
}

const LOCAL_LINK_URI = /^(?:(?:https?|file):|[A-Za-z]:[\\/]|\/|\.{1,2}[\\/]|#|[^:\s]+[\\/][^\s]*|[^:\s]+\.[A-Za-z0-9]{1,12}(?::\d+)?(?::\d+)?|[^:\s]+(?:[/?#].*)?$)/i
const UNSAFE_PROTOCOL = /^(?:javascript|command|data|vbscript):/i
const DRIVE_LINE_TARGET = /^([A-Za-z]:[\\/].*?)(?::(\d+))(?::(\d+))?$/
const PATH_LINE_TARGET = /^(.+?)(?::(\d+))(?::(\d+))?$/

let highlightersRegistered = false
let domPurifyHooksRegistered = false

function ensureHighlighters() {
  if (highlightersRegistered) return
  highlightersRegistered = true
  hljs.registerLanguage("bash", bash)
  hljs.registerLanguage("sh", bash)
  hljs.registerLanguage("shell", bash)
  hljs.registerLanguage("zsh", bash)
  hljs.registerLanguage("css", css)
  hljs.registerLanguage("diff", diff)
  hljs.registerLanguage("go", go)
  hljs.registerLanguage("javascript", javascript)
  hljs.registerLanguage("js", javascript)
  hljs.registerLanguage("typescript", typescript)
  hljs.registerLanguage("ts", typescript)
  hljs.registerLanguage("json", json)
  hljs.registerLanguage("markdown", markdown)
  hljs.registerLanguage("md", markdown)
  hljs.registerLanguage("powershell", powershell)
  hljs.registerLanguage("ps1", powershell)
  hljs.registerLanguage("python", python)
  hljs.registerLanguage("py", python)
  hljs.registerLanguage("rust", rust)
  hljs.registerLanguage("rs", rust)
  hljs.registerLanguage("xml", xml)
  hljs.registerLanguage("html", xml)
  hljs.registerLanguage("yaml", yaml)
  hljs.registerLanguage("yml", yaml)
}

function ensureSanitizerHooks() {
  if (domPurifyHooksRegistered) return
  domPurifyHooksRegistered = true
  DOMPurify.addHook("afterSanitizeAttributes", (node) => {
    if (node instanceof HTMLAnchorElement) {
      const href = node.getAttribute("href") || ""
      if (!href || UNSAFE_PROTOCOL.test(href.trim())) {
        node.removeAttribute("href")
        return
      }
      node.setAttribute("rel", "noopener noreferrer")
      node.setAttribute("data-ez-link", "true")
    }
    if (node instanceof HTMLButtonElement) {
      node.setAttribute("type", "button")
    }
    if (node instanceof HTMLInputElement) {
      node.disabled = true
    }
    node.removeAttribute("style")
  })
}

const renderer = {
  code(token: Tokens.Code) {
    const language = normalizeLanguage(token.lang)
    const code = token.text || ""
    const highlighted = highlightCode(code, language)
    const label = language || "text"
    return [
      `<div class="markdown-code-block" data-code-block="true">`,
      `<div class="markdown-code-block__header">`,
      `<span class="markdown-code-block__language">${escapeHtml(label)}</span>`,
      `<button class="markdown-code-block__copy" data-copy-code="true">${escapeHtml(t("markdown.copy"))}</button>`,
      `</div>`,
      `<pre class="markdown-code"><code class="hljs${language ? ` language-${escapeHtml(language)}` : ""}">${highlighted}</code></pre>`,
      `</div>`,
    ].join("")
  },
  image(token: Tokens.Image) {
    const href = sanitizeHref(token.href)
    const text = token.text || token.title || href
    if (!href) return escapeHtml(text)
    return `<a class="markdown-image-link" href="${escapeAttribute(href)}">${t("markdown.imageLink", { text: escapeHtml(text) })}</a>`
  },
}

const marked = new Marked({
  async: false,
  breaks: false,
  gfm: true,
  renderer,
})

export const MarkdownBlock: Component<MarkdownBlockProps> = (props) => {
  const vscode = useVSCode()
  const text = () => props.text || ""
  const className = () => ["assistant-text-part", "assistant-markdown", props.class].filter(Boolean).join(" ")
  const hasOpenFence = () => hasUnclosedCodeFence(text())
  const html = createMemo(() => renderMarkdown(text()))

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
      {hasOpenFence() ? <div class="markdown-stream-plain">{text()}</div> : <div innerHTML={html()} />}
    </div>
  )
}

function renderMarkdown(value: string): string {
  ensureHighlighters()
  ensureSanitizerHooks()
  const raw = marked.parse(value, { async: false }) as string
  return DOMPurify.sanitize(raw, {
    ALLOWED_URI_REGEXP: LOCAL_LINK_URI,
    FORBID_TAGS: ["script", "style", "iframe", "object", "embed", "form", "meta", "link"],
    FORBID_ATTR: ["style"],
    ADD_TAGS: ["button", "input"],
    ADD_ATTR: ["target", "rel", "type", "checked", "disabled", "data-ez-link", "data-copy-code", "data-code-block"],
  })
}

function normalizeLanguage(language?: string): string {
  const value = (language || "").trim().toLowerCase().split(/\s+/)[0]
  if (!value) return ""
  const aliases: Record<string, string> = {
    js: "javascript",
    jsx: "javascript",
    ts: "typescript",
    tsx: "typescript",
    py: "python",
    ps: "powershell",
    ps1: "powershell",
    shell: "bash",
    sh: "bash",
    yml: "yaml",
    md: "markdown",
    html: "xml",
  }
  return aliases[value] || value
}

function highlightCode(code: string, language: string): string {
  if (language && hljs.getLanguage(language)) {
    return hljs.highlight(code, { language, ignoreIllegals: true }).value
  }
  return escapeHtml(code)
}

function sanitizeHref(href: string): string {
  const value = (href || "").trim()
  if (!value || UNSAFE_PROTOCOL.test(value)) return ""
  return value
}

function hasUnclosedCodeFence(value: string): boolean {
  const matches = value.match(/(^|\n)```/g)
  return Boolean(matches && matches.length % 2 === 1)
}

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

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replace(/`/g, "&#96;")
}
