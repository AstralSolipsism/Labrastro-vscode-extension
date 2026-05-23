import { describe, expect, it } from "vitest"
import { normalizeRemoteSessionPayload, normalizeSessionBundle } from "./trace"

describe("trace session normalization", () => {
  it("normalizes persisted session-document parts into transcript items", () => {
    const bundle = normalizeSessionBundle({
      session: {
        id: "session-1",
        title: "历史会话",
        updatedAt: "2026-05-23T00:00:00.000Z",
      },
      turns: [
        {
          userMessage: {
            id: "user-1",
            role: "user",
            text: "问题",
            parts: [],
            timestamp: 1,
          },
          assistantMessages: [
            {
              id: "assistant-1",
              role: "assistant",
              text: "",
              timestamp: 2,
              parts: [
                { id: "text-1", type: "text", text: "正文" },
                { id: "reasoning-1", type: "reasoning", reasoningText: "思考" },
                { id: "tool-1", type: "tool", toolName: "list_file", toolOutput: "a.ts" },
                { id: "terminal-1", type: "terminal", terminalContent: "done" },
                { id: "session-part-1", type: "session", sessionId: "child-1", sessionKind: "fork" },
              ],
            },
          ],
        },
      ],
    })

    expect(bundle?.turns[0].assistantMessages[0].parts).toEqual([
      expect.objectContaining({ type: "assistant_text", markdown: "正文" }),
      expect.objectContaining({ type: "reasoning", raw: "思考" }),
      expect.objectContaining({ type: "tool", tool: "list_file", output: "a.ts" }),
      expect.objectContaining({ type: "terminal", content: "done" }),
      expect.objectContaining({ type: "session", sessionId: "child-1", kind: "fork" }),
    ])
  })

  it("drops empty persisted structured view parts", () => {
    const bundle = normalizeSessionBundle({
      session: {
        id: "session-1",
        title: "历史会话",
        updatedAt: "2026-05-23T00:00:00.000Z",
      },
      turns: [
        {
          userMessage: {
            id: "user-1",
            role: "user",
            text: "问题",
            parts: [],
            timestamp: 1,
          },
          assistantMessages: [
            {
              id: "assistant-1",
              role: "assistant",
              text: "",
              timestamp: 2,
              parts: [
                { id: "view-1", type: "view", viewPayload: { message: " " } },
              ],
            },
          ],
        },
      ],
    })

    expect(bundle?.turns[0].assistantMessages[0].parts).toEqual([])
  })

  it("normalizes text-only assistant history into assistant text parts", () => {
    const bundle = normalizeSessionBundle({
      session: {
        id: "session-1",
        title: "历史会话",
        updatedAt: "2026-05-23T00:00:00.000Z",
      },
      turns: [
        {
          userMessage: {
            id: "user-1",
            role: "user",
            text: "问题",
            parts: [],
            timestamp: 1,
          },
          assistantMessages: [
            {
              id: "assistant-1",
              role: "assistant",
              text: "最终答案",
              parts: [],
              timestamp: 2,
            },
          ],
        },
      ],
    })

    expect(bundle?.turns[0].assistantMessages[0].parts).toEqual([
      expect.objectContaining({
        type: "assistant_text",
        markdown: "最终答案",
        format: "markdown",
      }),
    ])
  })

  it("drops empty structured event cards from persisted history", () => {
    const bundle = normalizeSessionBundle({
      session: {
        id: "session-1",
        title: "历史会话",
        updatedAt: "2026-05-23T00:00:00.000Z",
      },
      turns: [
        {
          userMessage: {
            id: "user-1",
            role: "user",
            text: "问题",
            parts: [],
            timestamp: 1,
          },
          assistantMessages: [
            {
              id: "assistant-1",
              role: "assistant",
              text: "",
              timestamp: 2,
              parts: [
                { id: "context-1", type: "context_event", contextPayload: { phase: " " } },
                { id: "memory-1", type: "memory_context", memoryPayload: { items: [] } },
                { id: "ui-1", type: "ui_event", uiEventPayload: { summary: "" } },
              ],
            },
          ],
        },
      ],
    })

    expect(bundle?.turns[0].assistantMessages[0].parts).toEqual([])
  })

  it("keeps structured event cards with later non-empty text fields", () => {
    const bundle = normalizeSessionBundle({
      session: {
        id: "session-1",
        title: "历史会话",
        updatedAt: "2026-05-23T00:00:00.000Z",
      },
      turns: [
        {
          userMessage: {
            id: "user-1",
            role: "user",
            text: "问题",
            parts: [],
            timestamp: 1,
          },
          assistantMessages: [
            {
              id: "assistant-1",
              role: "assistant",
              text: "",
              timestamp: 2,
              parts: [
                { id: "context-1", type: "context_event", title: "", message: "有效内容" },
              ],
            },
          ],
        },
      ],
    })

    expect(bundle?.turns[0].assistantMessages[0].parts).toEqual([
      expect.objectContaining({ type: "context_event", title: undefined }),
    ])
  })

  it("prefers normalized bundles over raw documents in session messages", () => {
    const bundle = normalizeRemoteSessionPayload({
      bundle: {
        session: {
          id: "session-1",
          title: "bundle",
          updatedAt: "2026-05-23T00:00:00.000Z",
        },
        turns: [
          {
            userMessage: { id: "user-1", role: "user", text: "bundle-user", parts: [] },
            assistantMessages: [],
          },
        ],
      },
      document: {
        session: {
          id: "session-1",
          title: "document",
          updatedAt: "2026-05-23T00:00:00.000Z",
        },
        turns: [
          {
            userMessage: { id: "user-1", role: "user", text: "document-user", parts: [] },
            assistantMessages: [],
          },
        ],
      },
    })

    expect(bundle?.session.title).toBe("bundle")
    expect(bundle?.turns[0].userMessage.text).toBe("bundle-user")
  })
})
