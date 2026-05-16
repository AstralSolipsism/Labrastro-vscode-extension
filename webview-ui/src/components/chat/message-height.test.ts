import { beforeEach, describe, expect, it } from "vitest"
import {
  clearTurnHeightCache,
  estimateTurnHeight,
  getTurnHeightCacheStats,
  turnHeightCacheKey,
} from "./message-height"
import type { MockTurn } from "./mock-data"

function turn(text: string, assistantText = "reply"): MockTurn {
  return {
    userMessage: {
      id: "user-1",
      role: "user",
      text,
      parts: [],
      timestamp: 0,
    },
    assistantMessages: [
      {
        id: "assistant-1",
        role: "assistant",
        text: "",
        parts: [
          {
            id: "part-1",
            type: "text",
            text: assistantText,
            textFormat: "markdown",
          },
        ],
        timestamp: 0,
      },
    ],
  }
}

describe("message height estimation", () => {
  beforeEach(() => {
    clearTurnHeightCache()
  })

  it("reuses cached estimates for equivalent turn content and width bucket", () => {
    const sample = turn("hello")

    const first = estimateTurnHeight(sample, 360)
    const second = estimateTurnHeight(sample, 363)

    expect(second).toBe(first)
    expect(getTurnHeightCacheStats()).toMatchObject({
      entries: 1,
      hits: 1,
      misses: 1,
    })
  })

  it("invalidates the height cache when text content changes", () => {
    estimateTurnHeight(turn("hello"), 360)
    estimateTurnHeight(turn("hello changed"), 360)

    expect(getTurnHeightCacheStats()).toMatchObject({
      entries: 2,
      hits: 0,
      misses: 2,
    })
  })

  it("invalidates the height cache when the width bucket changes", () => {
    const sample = turn("hello")

    estimateTurnHeight(sample, 360)
    estimateTurnHeight(sample, 420)

    expect(getTurnHeightCacheStats()).toMatchObject({
      entries: 2,
      hits: 0,
      misses: 2,
    })
  })

  it("uses stable keys that include turn id, content digest, and width bucket", () => {
    const key = turnHeightCacheKey(turn("hello"), 360)

    expect(key).toContain("user-1")
    expect(key).toContain("fnv1a-")
  })

  it("estimates long markdown higher than short markdown", () => {
    const short = estimateTurnHeight(turn("short", "A short **answer**."), 420)
    const long = estimateTurnHeight(
      turn("short", "## Heading\n\n- one\n- two\n- three\n\n```ts\nconst a = 1\nconst b = 2\n```"),
      420,
    )

    expect(long).toBeGreaterThan(short)
  })

  it("invalidates the height cache when reasoning content changes", () => {
    const sample = turn("hello", "answer")
    sample.assistantMessages[0].parts.unshift({
      id: "reasoning-1",
      type: "reasoning",
      reasoningText: "short plan",
      reasoningFormat: "markdown",
    })
    const changed = turn("hello", "answer")
    changed.assistantMessages[0].parts.unshift({
      id: "reasoning-1",
      type: "reasoning",
      reasoningText: "short plan\n\nwith more detail",
      reasoningFormat: "markdown",
    })

    estimateTurnHeight(sample, 420)
    estimateTurnHeight(changed, 420)

    expect(getTurnHeightCacheStats()).toMatchObject({
      entries: 2,
      hits: 0,
      misses: 2,
    })
  })

  it("invalidates the height cache when memory context payload changes", () => {
    const sample = turn("hello", "answer")
    sample.assistantMessages[0].parts.unshift({
      id: "memory-1",
      type: "memory_context",
      memoryTitle: "注入记忆",
      memoryPayload: {
        schema: "memory_context.v1",
        provided_items: 1,
        rendered_context: "## Private Agent Memory\n- [project] short",
      },
    })
    const changed = turn("hello", "answer")
    changed.assistantMessages[0].parts.unshift({
      id: "memory-1",
      type: "memory_context",
      memoryTitle: "注入记忆",
      memoryPayload: {
        schema: "memory_context.v1",
        provided_items: 2,
        rendered_context: "## Private Agent Memory\n- [project] short\n- [preference] more detail",
      },
    })

    estimateTurnHeight(sample, 420)
    estimateTurnHeight(changed, 420)

    expect(getTurnHeightCacheStats()).toMatchObject({
      entries: 2,
      hits: 0,
      misses: 2,
    })
  })

  it("accounts for expanded tool cards in the turn height estimate", () => {
    const plain = turn("short", "done")
    const withTool: MockTurn = {
      userMessage: {
        id: "user-tool",
        role: "user",
        text: "run tool",
        parts: [],
        timestamp: 0,
      },
      assistantMessages: [
        {
          id: "assistant-tool",
          role: "assistant",
          text: "",
          timestamp: 0,
          parts: [
            {
              id: "tool-1",
              type: "tool",
              tool: "mcp",
              status: "running",
              toolInput: { server: "context7", tool: "resolve-library-id" },
              toolOutput: "tool output",
            },
          ],
        },
      ],
    }

    expect(estimateTurnHeight(withTool, 420)).toBeGreaterThan(estimateTurnHeight(plain, 420))
  })
})
