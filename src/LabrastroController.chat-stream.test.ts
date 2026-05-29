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

function sourceFrom(start: string, length = 800): string {
  const startIndex = source.indexOf(start)
  expect(startIndex).toBeGreaterThanOrEqual(0)
  return source.slice(startIndex, startIndex + length)
}

describe("LabrastroController session run event batching", () => {
  it("splits live stream deltas from replayable session run events", () => {
    expect(source).toContain("LIVE_SESSION_RUN_EVENT_TYPES")
    expect(source).toContain('"assistant_delta"')
    expect(source).toContain('"reasoning_delta"')
    expect(source).toContain('"tool_call_stream"')
    expect(source).toContain("splitSessionRunEventBatches(events)")
    expect(source).toContain('type: batch.live ? "sessionRun.stream" : "sessionRun.events"')
  })

  it("uses SSE session run events as the only run transport", () => {
    expect(source).toContain("streamSessionRunEvents(")
    expect(source).toContain("consumeSessionRunEventStream(")
    expect(source).not.toContain("consumeChatStream(")
    expect(source).toContain("AbortController")
    expect(source).not.toContain("pollChatStream")
    expect(source).not.toContain("canFallbackToLongPoll")
    expect(source).not.toContain("streamChat(")
    expect(source).not.toContain("LIVE_CHAT_STREAM_EVENT_TYPES")
  })

  it("refreshes active run status before sessionRun.resume and forwards pending approvals", () => {
    expect(source).toContain("activeRunPayloadWithServerStatus")
    expect(source).toContain("const status = await this.client.sessionRunStatus(sessionRunId")
    expect(source).toContain("approvals: Array.isArray(status.approvals) ? status.approvals : []")
  })

  it("keeps active run state across extension dispose so Reload Window can recover approvals", () => {
    const disposeFunction = sourceFrom("dispose(): void {")

    expect(disposeFunction).not.toContain("clearActiveRun()")
    expect(disposeFunction).toContain('stopPeer("controller.dispose")')
  })

  it("caches status approvals and reconnects the event stream during session run resume", () => {
    const resumeStatusFunction = sourceSection(
      "private async activeRunPayloadWithServerStatus",
      "private async refreshInitialStateInBackground",
    )
    const initialStateFunction = sourceSection(
      "async postInitialState(",
      "private async activeRunPayloadWithServerStatus",
    )

    expect(resumeStatusFunction).toContain("await this.storeStatusApprovals(status.approvals)")
    expect(resumeStatusFunction).toContain("this.sessionRunCoordinator.clearActiveRun()")
    expect(initialStateFunction).toContain("this.ensureSessionRunEventStream")
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

  it("clears restored active runs when the server no longer knows the session run", () => {
    const resumeStatusFunction = sourceSection(
      "private async activeRunPayloadWithServerStatus",
      "private async refreshInitialStateInBackground",
    )

    expect(resumeStatusFunction).toContain('isRemoteError(error, "session_run_not_found", 404)')
    expect(resumeStatusFunction).toContain("this.sessionRunCoordinator.clearActiveRun()")
    expect(resumeStatusFunction).toContain("return undefined")
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
