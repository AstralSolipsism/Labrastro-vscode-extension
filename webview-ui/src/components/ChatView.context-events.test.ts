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
    expect(source).toContain("appendToolStreamToToolPart")
    expect(source).toContain("archiveActiveStreamParts")
    expect(source).toContain("const visibleTurns =")
    expect(source).toContain('textFormat: "markdown"')
    expect(source).toContain('reasoningFormat: "plain"')
  })

  it("archives active reasoning/text before persistent tool and message events", () => {
    expect(source).toContain("const shouldArchiveActiveStreamBeforeEvent =")
    expect(source).toContain('"tool_call_start"')
    expect(source).toContain('"tool_call_end"')
    expect(source).toContain('"assistant_message"')
    expect(source).toContain('"reasoning_message"')
    expect(source).toContain("appendToolStreamToToolPart(payload, eventMeta)")
  })

  it("routes final reasoning messages into a persisted reasoning part before assistant text", () => {
    expect(source).toContain("const appendReasoningPart =")
    expect(source).toContain("const finalizeReasoningStreamPart =")
    expect(source).toContain('} else if (type === "reasoning_message") {')
    expect(source).toContain('type: "reasoning"')
    expect(source).toContain('part.type === "text" &&')
    expect(source).toContain('["assistant-stream", "assistant-message", "final"].includes')
    expect(source).toContain('reasoningStreamKey: prefix')
  })

  it("sends the current frontend locale with chat.send", () => {
    expect(source).toContain('locale: locale()')
  })

  it("guards slash command dispatch during active runs with command metadata", () => {
    expect(source).toContain("findChatCommandByText(chatCommandCatalog(), text)")
    expect(source).toContain("isWorking() && !command?.availableDuringRun")
    expect(source).toContain("当前运行中不能执行该指令")
  })

  it("preserves raw non-command text so leading-space slash input stays chat text", () => {
    expect(source).toContain("const rawText = submission.text")
    expect(source).toContain("if (!rawText.trim()) return")
    expect(source).toContain("sendChatText(rawText, { mentions: submission.mentions })")
  })

  it("keeps workspace mention search responses tied to the latest request", () => {
    expect(source).toContain('type: "workspace.files.search"')
    expect(source).toContain("setWorkspaceMentionRequest({ id: requestId, query: normalizedQuery })")
    expect(source).toContain("requestId !== activeRequest.id")
  })
})
