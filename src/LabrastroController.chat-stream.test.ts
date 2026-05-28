import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const source = readFileSync(join(__dirname, "LabrastroController.ts"), "utf8")

function sourceSection(start: string, end: string): string {
  const startIndex = source.indexOf(start)
  const endIndex = source.indexOf(end, startIndex)
  expect(startIndex).toBeGreaterThanOrEqual(0)
  expect(endIndex).toBeGreaterThan(startIndex)
  return source.slice(startIndex, endIndex)
}

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

  it("refreshes active run status before chat.resume and forwards pending approvals", () => {
    expect(source).toContain("activeRunPayloadWithServerStatus")
    expect(source).toContain("const status = await this.client.chatStatus(chatId")
    expect(source).toContain("approvals: Array.isArray(status.approvals) ? status.approvals : []")
  })

  it("does not advance the active run cursor from chat status", () => {
    const resumeStatusFunction = sourceSection(
      "private async activeRunPayloadWithServerStatus",
      "private async refreshInitialStateInBackground",
    )

    expect(resumeStatusFunction).not.toContain("status.next_cursor")
    expect(resumeStatusFunction).not.toContain("patchActiveRun({\n          cursor")
    expect(resumeStatusFunction).toContain("const payloadCursor = Number(payload.cursor")
    expect(resumeStatusFunction).toContain("const cursor = Number.isFinite(payloadCursor) ? payloadCursor : 0")
  })

  it("prefers the live chat.send locale over saved workspace locale", () => {
    expect(source).toContain("normalizeChatLocale")
    expect(source).toContain("currentChatLocale(requestLocale?: string)")
    expect(source).toContain("locale: this.currentChatLocale(options.locale)")
  })

  it("serves workspace file mention searches from the extension host", () => {
    expect(source).toContain('message.type === "workspace.files.search"')
    expect(source).toContain("vscode.workspace.findFiles")
    expect(source).toContain("getWorkspaceFileIndex")
    expect(source).toContain("fuzzySubsequenceScore")
    expect(source).toContain('type: "workspace.files"')
    expect(source).not.toContain("findFiles(\r\n        \"**/*\",\r\n        WORKSPACE_FILE_EXCLUDE_GLOB,\r\n        500")
  })
})
