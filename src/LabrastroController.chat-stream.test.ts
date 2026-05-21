import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const source = readFileSync(join(__dirname, "LabrastroController.ts"), "utf8")

describe("LabrastroController chat stream batching", () => {
  it("splits live stream deltas from replayable chat events", () => {
    expect(source).toContain("LIVE_CHAT_EVENT_TYPES")
    expect(source).toContain('"assistant_delta"')
    expect(source).toContain('"reasoning_delta"')
    expect(source).toContain('"tool_call_stream"')
    expect(source).toContain("splitChatEventBatches(events)")
    expect(source).toContain('type: batch.live ? "chat.stream" : "chat.events"')
  })

  it("uses SSE chat events as the only chat transport", () => {
    expect(source).toContain("streamChatEvents(")
    expect(source).toContain("consumeChatEventStream(")
    expect(source).not.toContain("consumeChatStream(")
    expect(source).toContain("AbortController")
    expect(source).not.toContain("pollChatStream")
    expect(source).not.toContain("canFallbackToLongPoll")
    expect(source).not.toContain("streamChat(")
    expect(source).not.toContain("LIVE_CHAT_STREAM_EVENT_TYPES")
  })

  it("prefers the live chat.send locale over saved workspace locale", () => {
    expect(source).toContain("normalizeChatLocale")
    expect(source).toContain("currentChatLocale(requestLocale?: string)")
    expect(source).toContain("locale: this.currentChatLocale(options.locale)")
  })
})
