import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const source = readFileSync(join(__dirname, "LabrastroController.ts"), "utf8").replace(/\r\n/g, "\n")

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
    const streamKeyFunction = sourceSection(
      "function sessionRunEventStreamKey",
      "function explicitSessionRunBranchProof",
    )

    expect(source).toContain("private readonly sessionRunEventReconnects = new Map<string, SessionRunEventReconnectState>()")
    expect(retryFunction).toContain("const streamKey = sessionRunEventStreamKey(sessionRunId, branchBindingId)")
    expect(streamKeyFunction).toContain("return `${sessionRunId}:${branchBindingId}`")
    expect(streamKeyFunction).not.toContain('|| "main"')
    expect(retryFunction).toContain("this.sessionRunEventReconnects.get(streamKey)")
    expect(retryFunction).toContain("this.sessionRunEventReconnects.set(streamKey")
    expect(retryFunction).toContain("!this.sessionRunEventStreamMatches(sessionRunId, branchBindingId)")
    expect(retryFunction).not.toContain("!this.activeSessionRunMatches({ sessionRunId, branchBindingId })")
    expect(retryFunction).not.toContain("!canRetrySessionRunEvents(activeRun)")
    expect(connectedFunction).toContain("this.activeSessionRunMatches({ sessionRunId, branchBindingId })")
  })

  it("scopes visible event batches by session run and branch", () => {
    const batchFunction = sourceSection(
      "private async applySessionRunEventsBatch",
      "private async recoverSessionRun",
    )

    expect(batchFunction).toContain("const selectedBranch = this.activeSessionRunMatches({ sessionRunId, branchBindingId: streamBranchBindingId })")
    expect(batchFunction).toContain("const visibleBranch = selectedBranch && options.applyVisibleSideEffects !== false")
    expect(batchFunction).toContain("const emitScopedEvents = visibleBranch || options.emitScopedEvents === true")
    expect(batchFunction).toContain("if (visibleBranch) {\n      this.sessionRunCoordinator.patchActiveRun({")
    expect(batchFunction).toContain("this.sessionRuntimeStore.hasScope({ sessionRunId, branchBindingId: streamBranchBindingId })")
    expect(batchFunction).not.toContain("this.sessionRunCoordinator.patchActiveRun({\n      ...(visibleBranch ?")
  })

  it("reports scoped event stream remote session mismatch as a projection error", () => {
    const mismatchBlock = sourceFrom(
      "if (remoteSessionId && sessionId && remoteSessionId !== sessionId)",
      900,
    )

    expect(mismatchBlock).toContain('type: "sessionRun.projection.error"')
    expect(mismatchBlock).toContain("stopWorking: true")
    expect(mismatchBlock).not.toContain('type: "sessionRun.error"')
    expect(mismatchBlock).not.toContain("this.sessionRuntimeStore.reduce({")
    expect(mismatchBlock).toContain("branchBindingId: streamBranchBindingId")
    expect(mismatchBlock).toContain("return { sessionId, cursor, done: false, active: false }")
    expect(mismatchBlock.indexOf("this.emitChatMessage")).toBeLessThan(
      mismatchBlock.indexOf("if (visibleBranch)")
    )
  })

  it("keeps session run event streams scoped to branch runtime lifecycle", () => {
    const matchFunction = sourceSection(
      "private sessionRunEventStreamMatches",
      "private markSessionRunEventsConnected",
    )

    expect(matchFunction).toContain("return this.sessionRuntimeStore.streamScopeIsOpen({ sessionRunId, branchBindingId })")
    expect(matchFunction).not.toContain("activeSessionRunMatches")
    expect(matchFunction).not.toContain("return Boolean(branchBindingId)")
  })

  it("requires explicit branch identity for event stream lifecycle APIs", () => {
    const streamFunction = sourceSection(
      "private ensureSessionRunEventStream(",
      "private sessionRunEventStreamMatches",
    )

    expect(streamFunction).not.toContain("branchBindingId = this.sessionRunCoordinator.activeRun?.branchBindingId")
    expect(streamFunction).toContain("branchBindingId: string")
    expect(streamFunction).toContain("this.ensureSessionRunStreamScope(sessionRunId, branchBindingId)")
  })

  it("does not create missing stream scopes from active run metadata", () => {
    const ensureScopeFunction = sourceSection(
      "private ensureSessionRunStreamScope",
      "private async consumeSessionRunEventStream",
    )

    expect(ensureScopeFunction).toContain("return this.sessionRuntimeStore.streamScopeIsOpen({ sessionRunId, branchBindingId })")
    expect(ensureScopeFunction).not.toContain("resolveSessionRunSourceIdentity")
    expect(ensureScopeFunction).not.toContain("ensureBranchRuntimeScope")
    expect(ensureScopeFunction).not.toContain("this.sessionRunCoordinator.activeRun")
  })

  it("reads session run event stream cursor from branch runtime scope", () => {
    const streamFunction = sourceSection(
      "private async consumeSessionRunEventStream",
      "private sessionRunEventStreamMatches",
    )

    expect(streamFunction).toContain("let cursor = this.sessionRuntimeStore.streamCursorForScope({ sessionRunId, branchBindingId })")
    expect(streamFunction).not.toContain("selectedBranchBindingId")
    expect(streamFunction).not.toContain("this.sessionRunCoordinator.activeRun?.cursor")
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

  it("passes the stream SessionRun id into branch-local auto-continue", () => {
    const batchFunction = sourceSection(
      "private async applySessionRunEventsBatch",
      "private async recoverSessionRun",
    )
    const branchLocalContinue = sourceFrom('sourceScope: "branch-local"', 500)

    expect(batchFunction).toContain('sourceScope: "branch-local"')
    expect(branchLocalContinue).toContain("sessionRunId: pendingNextTurn.sessionRunId || sessionRunId")
    expect(branchLocalContinue.indexOf("sessionRunId: pendingNextTurn.sessionRunId || sessionRunId")).toBeLessThan(
      branchLocalContinue.indexOf("branchBindingId: streamBranchBindingId")
    )
  })

  it("does not snapshot pending next turns from active run after branch-local source resolution fails", () => {
    const continueFunction = sourceSection(
      "private async continueSessionRun",
      "private async steerAgentRun",
    )

    expect(continueFunction).not.toContain("sourceResolution.sessionRunId || this.sessionRunCoordinator.activeSessionRunId")
    expect(continueFunction).toContain("const snapshotSessionRunId = sourceResolution.sessionRunId")
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

    expect(saveFunction).toContain("const proof = explicitSessionRunBranchProof(request)")
    expect(saveFunction).toContain("if (!proof)")
    expect(saveFunction).not.toContain("request.sessionRunId || this.sessionRunCoordinator.activeSessionRunId")
    expect(saveFunction).not.toContain("request.branchBindingId || this.sessionRunCoordinator.activeRun?.branchBindingId")
    expect(saveFunction).toContain("branch_binding_id: branchBindingId")
    expect(saveFunction).toContain("branchBindingId,")
    expect(saveFunction).toContain("branch_binding_id: branchBindingId,")
  })

  it("echoes branch identity on scoped operation errors and runtime stream errors", () => {
    const continueFunction = sourceSection(
      "private async continueSessionRun",
      "private async steerAgentRun",
    )
    const continueFailureEffect = sourceSection(
      "private async applySessionRunControlFailureEffect",
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

    expect(continueFunction).toContain("this.applySessionRunControlFailureEffect({")
    expect(continueFailureEffect).toContain("this.emitSessionRunOperationError(input.post, {")
    expect(continueFailureEffect).toContain("sessionRunId: input.sessionRunId")
    expect(continueFailureEffect).toContain("branchBindingId: input.branchBindingId")
    expect(continueFailureEffect).not.toContain('type: "sessionRun.error"')
    for (const section of [recoverFunction, cancelFunction]) {
      expect(section).toContain("this.emitSessionRunOperationError(post, {")
      expect(section).toContain("sessionRunId")
      expect(section).toContain("branchBindingId")
      expect(section).not.toContain('type: "sessionRun.error"')
    }
    expect(streamFunction).toContain('type: "sessionRun.error"')
    expect(streamFunction).toContain("sessionRunId")
    expect(streamFunction).toContain("branchBindingId")
    expect(streamFunction).toContain("branch_binding_id")
    expect(streamFunction).toContain("this.sessionRuntimeStore.reduce({")
  })

  it("does not fabricate main branch proof for operation preflight failures", () => {
    const preflightFailureFunction = sourceSection(
      "private reportSessionRunOperationPreflightFailure",
      "private async reportSessionRunProjectionRecoveryError",
    )

    expect(preflightFailureFunction).toContain("branchBindingId: operation.targetBranchBindingId || operation.sourceBranchBindingId")
    expect(preflightFailureFunction).not.toContain('operation.targetBranchBindingId || operation.sourceBranchBindingId || "main"')
  })

  it("does not let cancel lifecycle calls infer destructive identity from the active run", () => {
    const cancelFunction = sourceSection(
      "private async cancelSessionRun",
      "private async runAdminAction",
    )

    expect(cancelFunction).not.toContain("sessionRunId || this.sessionRunCoordinator.activeSessionRunId")
    expect(cancelFunction).not.toContain("branchBindingId || this.sessionRunCoordinator.activeRun?.branchBindingId")
    expect(cancelFunction).toContain("const targetSessionRunId = sessionRunId")
    expect(cancelFunction).toContain("const targetBranchBindingId = branchBindingId")
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
    expect(initialStateFunction).toContain("if (sessionRunId && branchBindingId)")
    expect(initialStateFunction).not.toContain('stringValue(activeRunPayload.branch_binding_id) ||\n          "main"')
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
