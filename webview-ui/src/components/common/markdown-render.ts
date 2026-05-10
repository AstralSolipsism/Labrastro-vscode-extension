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
import { locale, t } from "../../i18n"

export type MarkdownRenderPart =
  | { type: "html"; html: string }
  | { type: "open-code"; code: string; language: string }

interface OpenCodeFence {
  code: string
  language: string
}

interface MarkdownSplit {
  closedMarkdown: string
  openCode?: OpenCodeFence
}

const LOCAL_LINK_URI = /^(?:(?:https?|file):|[A-Za-z]:[\\/]|\/|\.{1,2}[\\/]|#|[^:\s]+[\\/][^\s]*|[^:\s]+\.[A-Za-z0-9]{1,12}(?::\d+)?(?::\d+)?|[^:\s]+(?:[/?#].*)?$)/i
const UNSAFE_PROTOCOL = /^(?:javascript|command|data|vbscript):/i
const MAX_RENDER_CACHE_ENTRIES = 200

let highlightersRegistered = false
let domPurifyHooksRegistered = false
let cacheHits = 0
let cacheMisses = 0
const renderCache = new Map<string, string>()

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
  const purify = DOMPurify as unknown as {
    addHook?: (hook: "afterSanitizeAttributes", callback: (node: Element) => void) => void
  }
  if (typeof purify.addHook !== "function") return
  domPurifyHooksRegistered = true
  purify.addHook("afterSanitizeAttributes", (node) => {
    const element = node as Element
    if (typeof element.getAttribute !== "function") return
    const tagName = element.tagName.toLowerCase()
    if (tagName === "a") {
      const href = element.getAttribute("href") || ""
      if (!href || UNSAFE_PROTOCOL.test(href.trim())) {
        element.removeAttribute("href")
        return
      }
      element.setAttribute("rel", "noopener noreferrer")
      element.setAttribute("data-ez-link", "true")
    }
    if (tagName === "button") {
      element.setAttribute("type", "button")
    }
    if (tagName === "input") {
      element.setAttribute("disabled", "true")
    }
    element.removeAttribute("style")
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

export function renderMarkdown(value: string, context = "default"): string {
  const cacheKey = `${locale()}\u0000${context}\u0000${value}`
  const cached = renderCache.get(cacheKey)
  if (cached !== undefined) {
    cacheHits += 1
    renderCache.delete(cacheKey)
    renderCache.set(cacheKey, cached)
    return cached
  }

  cacheMisses += 1
  ensureHighlighters()
  const raw = marked.parse(value, { async: false }) as string
  const html = sanitizeHtml(raw)
  renderCache.set(cacheKey, html)
  trimRenderCache()
  return html
}

export function renderStreamingMarkdown(value: string, context = "default"): MarkdownRenderPart[] {
  const split = splitOpenCodeFence(value)
  if (!split.openCode) return [{ type: "html", html: renderMarkdown(value, context) }]

  const parts: MarkdownRenderPart[] = []
  if (split.closedMarkdown.trim()) {
    parts.push({
      type: "html",
      html: renderMarkdown(split.closedMarkdown, `${context}:closed`),
    })
  }
  parts.push({
    type: "open-code",
    code: split.openCode.code,
    language: split.openCode.language,
  })
  return parts
}

export function clearMarkdownRenderCache(): void {
  renderCache.clear()
  cacheHits = 0
  cacheMisses = 0
}

export function getMarkdownRenderCacheStats(): { entries: number; hits: number; misses: number } {
  return {
    entries: renderCache.size,
    hits: cacheHits,
    misses: cacheMisses,
  }
}

function splitOpenCodeFence(value: string): MarkdownSplit {
  let openFence: {
    contentStart: number
    language: string
    markerChar: string
    markerLength: number
    start: number
  } | undefined

  let index = 0
  while (index <= value.length) {
    const lineStart = index
    const newlineIndex = value.indexOf("\n", lineStart)
    const lineEnd = newlineIndex === -1 ? value.length : newlineIndex
    const rawLine = value.slice(lineStart, lineEnd)
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine
    const fenceMatch = line.match(/^[ \t]{0,3}(`{3,}|~{3,})(.*)$/)

    if (fenceMatch) {
      const marker = fenceMatch[1]
      const tail = fenceMatch[2].trim()
      if (!openFence) {
        openFence = {
          contentStart: newlineIndex === -1 ? value.length : newlineIndex + 1,
          language: normalizeLanguage(tail.split(/\s+/)[0]),
          markerChar: marker[0],
          markerLength: marker.length,
          start: lineStart,
        }
      } else if (
        marker[0] === openFence.markerChar &&
        marker.length >= openFence.markerLength &&
        tail === ""
      ) {
        openFence = undefined
      }
    }

    if (newlineIndex === -1) break
    index = newlineIndex + 1
  }

  if (!openFence) return { closedMarkdown: value }
  return {
    closedMarkdown: value.slice(0, openFence.start),
    openCode: {
      code: value.slice(openFence.contentStart),
      language: openFence.language,
    },
  }
}

function trimRenderCache(): void {
  while (renderCache.size > MAX_RENDER_CACHE_ENTRIES) {
    const oldest = renderCache.keys().next().value
    if (oldest === undefined) return
    renderCache.delete(oldest)
  }
}

function sanitizeHtml(raw: string): string {
  ensureSanitizerHooks()
  const purify = DOMPurify as unknown as {
    sanitize?: (dirty: string, config: Record<string, unknown>) => string
  }
  if (typeof purify.sanitize === "function") {
    return purify.sanitize(raw, {
      ALLOWED_URI_REGEXP: LOCAL_LINK_URI,
      FORBID_TAGS: ["script", "style", "iframe", "object", "embed", "form", "meta", "link"],
      FORBID_ATTR: ["style"],
      ADD_TAGS: ["button", "input"],
      ADD_ATTR: ["target", "rel", "type", "checked", "disabled", "data-ez-link", "data-copy-code", "data-code-block"],
    })
  }
  return fallbackSanitizeHtml(raw)
}

function fallbackSanitizeHtml(raw: string): string {
  return raw
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<\/?(?:iframe|object|embed|form|meta|link)\b[^>]*>/gi, "")
    .replace(/\sstyle\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/\shref\s*=\s*(["'])(.*?)\1/gi, (_match, quote: string, href: string) =>
      UNSAFE_PROTOCOL.test(href.trim()) ? "" : ` href=${quote}${href}${quote} rel="noopener noreferrer" data-ez-link="true"`
    )
    .replace(/\shref\s*=\s*([^\s>]+)/gi, (_match, href: string) =>
      UNSAFE_PROTOCOL.test(href.trim()) ? "" : ` href="${escapeAttribute(href)}" rel="noopener noreferrer" data-ez-link="true"`
    )
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
