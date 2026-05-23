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
            type: "assistant_text",
            markdown: assistantText,
            format: "markdown",
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

  it("keeps interleaved assistant text height tied to markdown content", () => {
    const short = turn("inspect", "first\n\nsecond")
    short.assistantMessages[0].parts = [
      { id: "text-1", type: "assistant_text", markdown: "first", format: "markdown" },
      { id: "tool-1", type: "tool", tool: "list_file", status: "returned", input: { path: "src" } },
      { id: "text-2", type: "assistant_text", markdown: "second", format: "markdown" },
    ]
    const long = turn("inspect", "first\n\nsecond")
    long.assistantMessages[0].parts = [
      { id: "text-1", type: "assistant_text", markdown: "first\n\n- detail\n- detail\n- detail", format: "markdown" },
      { id: "tool-1", type: "tool", tool: "list_file", status: "returned", input: { path: "src" } },
      { id: "text-2", type: "assistant_text", markdown: "second\n\n```ts\nconst value = 1\nconst other = 2\n```", format: "markdown" },
    ]

    expect(estimateTurnHeight(long, 420)).toBeGreaterThan(estimateTurnHeight(short, 420))
  })

  it("invalidates the height cache when reasoning content changes", () => {
    const sample = turn("hello", "answer")
    sample.assistantMessages[0].parts.unshift({
      id: "reasoning-1",
      type: "reasoning",
      raw: "short plan",
      format: "markdown",
    })
    const changed = turn("hello", "answer")
    changed.assistantMessages[0].parts.unshift({
      id: "reasoning-1",
      type: "reasoning",
      raw: "short plan\n\nwith more detail",
      format: "markdown",
    })

    estimateTurnHeight(sample, 420)
    estimateTurnHeight(changed, 420)

    expect(getTurnHeightCacheStats()).toMatchObject({
      entries: 2,
      hits: 0,
      misses: 2,
    })
  })

  it("keeps hidden process payload changes out of the folded height cache key", () => {
    const sample = turn("hello", "answer")
    sample.assistantMessages[0].parts.unshift({
      id: "memory-1",
      type: "memory_context",
      title: "注入记忆",
      payload: {
        schema: "memory_context.v1",
        provided_items: 1,
        rendered_context: "## Private Agent Memory\n- [project] short",
      },
    })
    const changed = turn("hello", "answer")
    changed.assistantMessages[0].parts.unshift({
      id: "memory-1",
      type: "memory_context",
      title: "注入记忆",
      payload: {
        schema: "memory_context.v1",
        provided_items: 2,
        rendered_context: "## Private Agent Memory\n- [project] short\n- [preference] more detail",
      },
    })

    estimateTurnHeight(sample, 420)
    estimateTurnHeight(changed, 420)

    expect(getTurnHeightCacheStats()).toMatchObject({
      entries: 1,
      hits: 1,
      misses: 1,
    })
  })

  it("keeps completed process height close to a single folded summary row", () => {
    const withOneTool: MockTurn = {
      userMessage: {
        id: "user-one-tool",
        role: "user",
        text: "inspect",
        parts: [],
        timestamp: 0,
      },
      assistantMessages: [
        {
          id: "assistant-one-tool",
          role: "assistant",
          text: "",
          timestamp: 0,
          parts: [
            {
              id: "tool-1",
              type: "tool",
              tool: "list_file",
              status: "returned",
              input: { path: "src" },
            },
            {
              id: "text-1",
              type: "assistant_text",
              markdown: "done",
              format: "markdown",
            },
          ],
        },
      ],
    }
    const withManyTools: MockTurn = {
      ...withOneTool,
      userMessage: {
        ...withOneTool.userMessage,
        id: "user-many-tools",
      },
      assistantMessages: [
        {
          ...withOneTool.assistantMessages[0],
          id: "assistant-many-tools",
          parts: [
            ...Array.from({ length: 12 }, (_, index) => ({
              id: `tool-${index}`,
              type: "tool" as const,
              tool: "list_file",
              status: "returned" as const,
              input: { path: `src/${index}` },
            })),
            {
              id: "text-1",
              type: "assistant_text" as const,
              markdown: "done",
              format: "markdown" as const,
            },
          ],
        },
      ],
    }

    const oneToolHeight = estimateTurnHeight(withOneTool, 420)
    const manyToolsHeight = estimateTurnHeight(withManyTools, 420)

    expect(manyToolsHeight - oneToolHeight).toBeLessThan(20)
  })

  it("does not rekey folded process height when hidden tool output changes", () => {
    const sample = turn("inspect", "done")
    sample.assistantMessages[0].parts.unshift({
      id: "tool-1",
      type: "tool",
      tool: "grep",
      status: "returned",
      input: { pattern: "x" },
      output: "short output",
    })
    const changed = turn("inspect", "done")
    changed.assistantMessages[0].parts.unshift({
      id: "tool-1",
      type: "tool",
      tool: "grep",
      status: "returned",
      input: { pattern: "x" },
      output: "very long output\n".repeat(1000),
    })

    estimateTurnHeight(sample, 420)
    estimateTurnHeight(changed, 420)

    expect(getTurnHeightCacheStats()).toMatchObject({
      entries: 1,
      hits: 1,
      misses: 1,
    })
  })

  it("keeps the running process activity row stable even when many tools are folded", () => {
    const oneRunningTool = turn("inspect", "working")
    oneRunningTool.assistantMessages[0].traceNodeStatus = "active"
    oneRunningTool.assistantMessages[0].parts.unshift({
      id: "tool-1",
      type: "tool",
      tool: "list_file",
      status: "running",
      input: { path: "src" },
    })

    const manyRunningTools = turn("inspect", "working")
    manyRunningTools.assistantMessages[0].traceNodeStatus = "active"
    manyRunningTools.assistantMessages[0].parts = [
      ...Array.from({ length: 12 }, (_, index) => ({
        id: `tool-${index}`,
        type: "tool" as const,
        tool: "list_file",
        status: "running" as const,
        input: { path: `src/${index}` },
      })),
      manyRunningTools.assistantMessages[0].parts[0],
    ]

    expect(estimateTurnHeight(manyRunningTools, 420) - estimateTurnHeight(oneRunningTool, 420)).toBeLessThan(20)
  })

  it("invalidates digest when process activity item count changes", () => {
    const sample = turn("inspect", "done")
    sample.assistantMessages[0].parts.unshift({
      id: "tool-1",
      type: "tool",
      tool: "list_file",
      status: "returned",
      input: { path: "src" },
    })
    const changed = turn("inspect", "done")
    changed.assistantMessages[0].parts.unshift(
      {
        id: "tool-1",
        type: "tool",
        tool: "list_file",
        status: "returned",
        input: { path: "src" },
      },
      {
        id: "tool-2",
        type: "tool",
        tool: "read_file",
        status: "returned",
        input: { path: "src/index.ts" },
      },
    )

    estimateTurnHeight(sample, 420)
    estimateTurnHeight(changed, 420)

    expect(getTurnHeightCacheStats()).toMatchObject({
      entries: 2,
      hits: 0,
      misses: 2,
    })
  })
})
