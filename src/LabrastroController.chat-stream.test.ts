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
    expect(source).toContain('"document_draft_preview_chunk"')
    expect(source).not.toContain('"document_draft_delta"')
    expect(source).toContain('"reasoning_delta"')
    expect(source).toContain('"tool_call_stream"')
    expect(source).toContain("chatSessionRunEvents(events)")
    expect(source).toContain("splitSessionRunEventBatches(chatEvents)")
    expect(source).toContain('type: batch.live ? "sessionRun.stream" : "sessionRun.events"')
  })

  it("routes draft preview and resolved approvals through editor providers", () => {
    const batchFunction = sourceSection(
      "private async applySessionRunEventsBatch",
      "private async recoverSessionRun",
    )

    expect(source).toContain("DraftDocumentProvider")
    expect(batchFunction).toContain("this.draftDocuments.applySessionRunEvents")
    expect(batchFunction).toContain("chatSessionRunEvents(events)")
    expect(batchFunction).toContain("this.approvalDocuments.close")
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

  it("tracks session run event reconnect state per stream branch", () => {
    const retryFunction = sourceSection(
      "private async retrySessionRunEventsAfterError",
      "private async applySessionRunEventsBatch",
    )
    const connectedFunction = sourceSection(
      "private markSessionRunEventsConnected",
      "private async retrySessionRunEventsAfterError",
    )

    expect(source).toContain("private readonly sessionRunEventReconnects = new Map<string, SessionRunEventReconnectState>()")
    expect(retryFunction).toContain("const streamKey = sessionRunEventStreamKey(sessionRunId, branchBindingId)")
    expect(retryFunction).toContain("this.sessionRunEventReconnects.get(streamKey)")
    expect(retryFunction).toContain("this.sessionRunEventReconnects.set(streamKey")
    expect(retryFunction).not.toContain("!canRetrySessionRunEvents(activeRun)")
    expect(connectedFunction).toContain("activeRun?.sessionRunId === sessionRunId")
    expect(connectedFunction).toContain("(activeRun.branchBindingId || \"main\") === branchBindingId")
  })

  it("scopes visible event batches by session run and branch", () => {
    const batchFunction = sourceSection(
      "private async applySessionRunEventsBatch",
      "private async recoverSessionRun",
    )

    expect(batchFunction).toContain("const activeRun = this.sessionRunCoordinator.activeRun")
    expect(batchFunction).toContain("activeRun?.sessionRunId === sessionRunId")
    expect(batchFunction).toContain("(activeRun.branchBindingId || \"main\") === streamBranchBindingId")
  })

  it("keeps pending next turns owned until continue succeeds", () => {
    const continueFunction = sourceSection(
      "private async continueSessionRun",
      "private async steerAgentRun",
    )
    const batchFunction = sourceSection(
      "private async applySessionRunEventsBatch",
      "private async recoverSessionRun",
    )
    const continuedIndex = continueFunction.indexOf('type: "sessionRun.continued"')
    const requestIndex = continueFunction.indexOf("await this.client.continueSessionRun")

    expect(batchFunction).toContain("pendingNextTurnForBranch(")
    expect(batchFunction).not.toContain("shiftPendingNextTurnForBranch(")
    expect(continueFunction).not.toContain("clearPendingNextTurnForBranch(")
    expect(continuedIndex).toBeGreaterThan(requestIndex)
  })

  it("posts the target branch pending snapshot after branch selection", () => {
    const selectFunction = sourceSection(
      "private async selectSessionRunBranch",
      "private async recoverSessionRun",
    )

    expect(selectFunction).toContain("postPendingNextTurnsSnapshot")
    expect(selectFunction).toContain("sessionRunId")
    expect(selectFunction).toContain("branchBindingId")
  })

  it("echoes the approval candidate save branch in the webview result", () => {
    const saveFunction = sourceSection(
      "private async approveCandidateDocumentSave",
      "private async refreshInitialStateInBackground",
    )

    expect(saveFunction).toContain("branch_binding_id: branchBindingId")
    expect(saveFunction).toContain("branchBindingId,")
    expect(saveFunction).toContain("branch_binding_id: branchBindingId,")
  })

  it("echoes branch identity on scoped session run errors", () => {
    const continueFunction = sourceSection(
      "private async continueSessionRun",
      "private async steerAgentRun",
    )
    const recoverFunction = sourceSection(
      "private async recoverSessionRun",
      "private async resolveConfiguredDefaultChatModel",
    )
    const cancelFunction = sourceSection(
      "private async cancelSessionRun",
      "private async runAdminAction",
    )
    const streamFunction = sourceSection(
      "private ensureSessionRunEventStream(",
      "private ensureSessionRunEventStreamSoon",
    )

    for (const section of [continueFunction, recoverFunction, cancelFunction, streamFunction]) {
      expect(section).toContain('type: "sessionRun.error"')
      expect(section).toContain("sessionRunId")
      expect(section).toContain("branchBindingId")
      expect(section).toContain("branch_binding_id")
    }
  })

  it("refreshes active run status before sessionRun.resume and forwards pending approvals", () => {
    expect(source).toContain("activeRunPayloadWithServerStatus")
    expect(source).toContain("const status = await this.client.sessionRunStatus(sessionRunId")
    expect(source).toContain("const runtimeState = objectValue(status.runtime_state || status.runtimeState)")
    expect(source).toContain("runtime_state: runtimeState")
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
