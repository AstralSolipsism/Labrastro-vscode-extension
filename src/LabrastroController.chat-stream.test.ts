import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const source = readFileSync(join(__dirname, "LabrastroController.ts"), "utf8")

describe("LabrastroController chat stream batching", () => {
  it("splits live stream deltas from replayable chat events", () => {
    expect(source).toContain("LIVE_CHAT_STREAM_EVENT_TYPES")
    expect(source).toContain('"assistant_delta"')
    expect(source).toContain('"reasoning_delta"')
    expect(source).toContain('"tool_call_stream"')
    expect(source).toContain("splitChatStreamBatches(events)")
    expect(source).toContain('type: batch.live ? "chat.stream" : "chat.events"')
  })
})
