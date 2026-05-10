import { describe, expect, it, beforeEach } from "vitest"
import {
  clearMarkdownRenderCache,
  getMarkdownRenderCacheStats,
  renderMarkdown,
  renderStreamingMarkdown,
} from "./markdown-render"

describe("markdown renderer", () => {
  beforeEach(() => {
    clearMarkdownRenderCache()
  })

  it("renders ordinary markdown as sanitized html", () => {
    const html = renderMarkdown("Hello **world**")

    expect(html).toContain("<strong>world</strong>")
  })

  it("renders closed code fences with highlight markup", () => {
    const html = renderMarkdown("```ts\nconst answer = 42\n```")

    expect(html).toContain("markdown-code-block")
    expect(html).toContain("language-typescript")
    expect(html).toContain("hljs")
  })

  it("keeps completed markdown rendered while exposing an open code fence as plain code", () => {
    const parts = renderStreamingMarkdown("Before **code**\n\n```ts\nconst answer = 42")

    expect(parts).toHaveLength(2)
    expect(parts[0]).toMatchObject({ type: "html" })
    expect(parts[0].type === "html" ? parts[0].html : "").toContain("<strong>code</strong>")
    expect(parts[1]).toMatchObject({
      type: "open-code",
      language: "typescript",
      code: "const answer = 42",
    })
  })

  it("does not run code highlighting for an open code fence", () => {
    const parts = renderStreamingMarkdown("```ts\nconst answer = 42")

    expect(parts).toHaveLength(1)
    expect(parts[0]).toMatchObject({ type: "open-code" })
    expect(JSON.stringify(parts)).not.toContain("hljs")
  })

  it("removes unsafe html, inline style, and unsafe link protocols", () => {
    const html = renderMarkdown('<script>alert(1)</script><a href="javascript:alert(1)" style="color:red">bad</a><strong>ok</strong>')

    expect(html).not.toContain("<script")
    expect(html).not.toContain("javascript:")
    expect(html).not.toContain("style=")
    expect(html).toContain("<strong>ok</strong>")
  })

  it("caches equivalent render inputs and misses changed inputs", () => {
    renderMarkdown("Hello **world**", "message")
    renderMarkdown("Hello **world**", "message")
    renderMarkdown("Hello **changed**", "message")

    expect(getMarkdownRenderCacheStats()).toMatchObject({
      entries: 2,
      hits: 1,
      misses: 2,
    })
  })
})
