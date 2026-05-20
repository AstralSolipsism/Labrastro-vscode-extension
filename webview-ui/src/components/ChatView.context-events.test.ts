import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const source = readFileSync(new URL("./ChatView.tsx", import.meta.url), "utf8")

describe("ChatView context events", () => {
  it("routes remote context_event payloads into context event parts", () => {
    expect(source).toContain('type: "context_event"')
    expect(source).toContain('} else if (type === "context_event") {')
    expect(source).toContain("appendContextEventPart(payload, eventMeta)")
  })

  it("routes memory context events into dedicated memory parts", () => {
    expect(source).toContain("const appendMemoryContextPart =")
    expect(source).toContain('type: "memory_context"')
    expect(source).toContain('} else if (type === "memory_context") {')
    expect(source).toContain("isMemoryContextPayload(payload)")
  })

  it("keeps usage_update wired to context progress stats", () => {
    expect(source).toContain("contextTokens: numberValue(payload.context_tokens)")
    expect(source).toContain("contextWindow: numberValue(payload.context_window)")
    expect(source).toContain('} else if (type === "usage_update" || type === "run_stats") {')
  })

  it("routes live deltas into active stream draft state", () => {
    expect(source).toContain('msg.type === "chat.stream"')
    expect(source).toContain("const handleLiveStreamEvent =")
    expect(source).toContain("appendActiveReasoningStream")
    expect(source).toContain("appendActiveTextStream")
    expect(source).toContain("appendActiveToolStream")
    expect(source).toContain("const visibleTurns =")
  })

  it("routes final reasoning messages into a persisted reasoning part before assistant text", () => {
    expect(source).toContain("const appendReasoningPart =")
    expect(source).toContain('} else if (type === "reasoning_message") {')
    expect(source).toContain('type: "reasoning"')
    expect(source).toContain('part.type === "text" &&')
    expect(source).toContain('["assistant-stream", "assistant-message", "final"].includes')
    expect(source).toContain("merge: true")
  })
})
