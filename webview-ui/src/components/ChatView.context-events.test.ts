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
    expect(source).toContain("updateThinkingFromReasoning")
    expect(source).toContain("const REASONING_STREAM_KEY")
    expect(source).toContain("upsertAssistantStream")
    expect(source).toContain("appendToolStreamToToolPart")
    expect(source).toContain("archiveActiveTranscriptItems")
    expect(source).toContain("const visibleTurns =")
    expect(source).toContain('format: "markdown"')
    expect(source).toContain('type: "thinking"')
  })

  it("archives active reasoning/text before persistent tool and message events", () => {
    expect(source).toContain("const shouldArchiveActiveStreamBeforeEvent =")
    expect(source).toContain("const isArchivableActiveTranscriptItem =")
    expect(source).toContain("isReasoningThinkingItem(item)")
    expect(source).toContain('if (type === "chat_end") return false')
    expect(source).toContain('"tool_call_start"')
    expect(source).toContain('"tool_call_end"')
    expect(source).toContain('"assistant_message"')
    expect(source).toContain('"reasoning_message"')
    expect(source).toContain("appendToolStreamToToolPart(payload, eventMeta)")
  })

  it("routes final reasoning messages by replacing the latest thinking anchor before clearing active thinking", () => {
    expect(source).toContain("const finalizeReasoningMessage =")
    expect(source).toContain('} else if (type === "reasoning_message") {')
    expect(source).toContain('type: "reasoning"')
    expect(source).toContain("findLastItemIndex(parts, isReasoningThinkingItem)")
    expect(source).toContain("updated[thinkingIndex] = createReasoning(updated[thinkingIndex].id)")
    expect(source).toContain("summary: summary || undefined")
    expect(source).toContain("raw: raw || summary")

    const branchIndex = source.indexOf('} else if (type === "reasoning_message") {')
    const finalizeIndex = source.indexOf("finalizeReasoningMessage(payload", branchIndex)
    const clearIndex = source.indexOf("clearActiveTranscriptItems(isReasoningThinkingItem)", branchIndex)

    expect(finalizeIndex).toBeGreaterThan(branchIndex)
    expect(finalizeIndex).toBeLessThan(clearIndex)
  })

  it("updates an archived reasoning thinking anchor instead of creating another row", () => {
    expect(source).toContain("const updateThinkingFromReasoning =")
    expect(source).toContain("const updateThinkingItem = (part: ThinkingItem): ThinkingItem =>")
    expect(source).toContain("const currentAssistant = currentAssistantMessages()[0]")
    expect(source).toContain("currentAssistant?.parts.some(isReasoningThinkingItem)")
    expect(source).toContain("const index = findLastItemIndex(parts, isReasoningThinkingItem)")
    expect(source).toContain("streamKey: REASONING_STREAM_KEY")
    expect(source).toContain('id: `thinking-${activeChatId() || "pending"}`')
  })

  it("only shows the footer working indicator before the running turn has transcript content", () => {
    expect(source).toContain("const hasVisibleRunTranscriptItems = createMemo")
    expect(source).toContain("currentAssistantMessages().some((message) => message.parts.length > 0)")
    expect(source).toContain("showWorkingIndicator={visibleIsWorking() && !hasVisibleRunTranscriptItems()}")
  })

  it("settles active assistant stream and thinking state when a run ends", () => {
    expect(source).toContain("const settleAssistantMessageForRunEnd =")
    expect(source).toContain("settleAssistantMessageForRunEnd(nextStatus)")
    expect(source).toContain("normalizeTranscriptItemForRunEnd")
    expect(source).toContain('streaming: false')
    expect(source).toContain('streamKey: "assistant-message"')
    expect(source).toContain("active: false")
    expect(source).toContain("traceStatusForRunEnd")
  })

  it("keeps chat_end final payload from duplicating an active assistant stream", () => {
    const branchIndex = source.indexOf('} else if (type === "chat_end") {')
    const clearIndex = source.indexOf('clearActiveTranscriptItems((part) => part.type === "assistant_text" && part.streamKey === "assistant-stream")', branchIndex)
    const appendIndex = source.indexOf('appendAssistantTextItem(String(payload.response), "final"', branchIndex)
    const finishIndex = source.indexOf("finishChatRun(doneStatusFromCurrentRun())", branchIndex)

    expect(clearIndex).toBeGreaterThan(branchIndex)
    expect(clearIndex).toBeLessThan(appendIndex)
    expect(appendIndex).toBeLessThan(finishIndex)
  })

  it("sends the current frontend locale with chat.send", () => {
    expect(source).toContain('locale: locale()')
  })

  it("creates a local draft session before the first send", () => {
    expect(source).toContain("const shouldCreateLocalDraft = !sessionId")
    expect(source).toContain("trace.startDraftTask(text)")
    expect(source).toContain("trace.appendTurn({")
    expect(source).toContain("setActiveRunSessionId(sessionId || \"\")")
  })

  it("does not append empty structured view cards", () => {
    expect(source).toContain("function hasMeaningfulPayload")
    expect(source).toContain("if (!hasMeaningfulPayload(viewPayload)) return")
  })
})
