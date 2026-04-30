import { describe, expect, it } from "vitest"
import type { MockSessionBundle } from "../components/chat/mock-data"
import { mockTraceUI } from "../components/chat/mock-data"
import { sessionBundleHasContent } from "./session-history"

const bundle = (turns: MockSessionBundle["turns"]): MockSessionBundle => ({
  session: { id: "session-1", title: "", updatedAt: "" },
  stats: {
    taskText: "",
    tokensIn: 0,
    tokensOut: 0,
    cacheReads: null,
    cacheWrites: null,
    totalCost: null,
    contextTokens: 0,
    contextWindow: 0,
    maxOutputTokens: 0,
  },
  turns,
  traceNodes: [],
  traceEdges: [],
  traceUI: { ...mockTraceUI },
})

describe("session history", () => {
  it("does not treat empty bundles as history content", () => {
    expect(sessionBundleHasContent(bundle([]))).toBe(false)
  })

  it("treats user text as history content", () => {
    expect(
      sessionBundleHasContent(
        bundle([
          {
            userMessage: {
              id: "u1",
              role: "user",
              text: "hello",
              parts: [],
              timestamp: 0,
            },
            assistantMessages: [],
          },
        ])
      )
    ).toBe(true)
  })
})
