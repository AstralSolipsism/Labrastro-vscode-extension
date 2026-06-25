import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const source = readFileSync(new URL("./ChatView.tsx", import.meta.url), "utf8")

function sourceSection(start: string, end: string): string {
  const startIndex = source.indexOf(start)
  const endIndex = source.indexOf(end, startIndex)
  expect(startIndex).toBeGreaterThanOrEqual(0)
  expect(endIndex).toBeGreaterThan(startIndex)
  return source.slice(startIndex, endIndex)
}

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

  it("routes live deltas into the streaming overlay before canonical transcript commits", () => {
    expect(source).toContain('msg.type === "sessionRun.stream"')
    expect(source).toContain("const handleLiveStreamEvent =")
    expect(source).toContain("const mergeStreamingTextOverlayParts =")
    expect(source).toContain("STREAMING_TEXT_OVERLAY_COMMIT_DELAY_MS = 100")
    expect(source).toContain("const scheduleStreamingTextOverlayCommit =")
    expect(source).toContain("const isBufferableLiveTranscriptEvent =")
    expect(source).toContain("LIVE_TRANSCRIPT_EVENT_TYPES.has(type) && isSessionRunTranscriptEventType(type)")
    expect(source).toContain("let liveTranscriptEvents")
    expect(source).toContain("targetBranchBindingId: string")
    expect(source).toContain("const pendingLiveEventKeys = new Set<string>()")
    expect(source).toContain("scheduleLiveTranscriptFlush()")
    expect(source).toContain("trace.applySessionRunTranscriptEventsToSession(")
    expect(source).toContain("events[index].targetBranchBindingId === first.targetBranchBindingId")
    expect(source).toContain("scopedSessionRunId: first.targetSessionRunId")
    expect(source).toContain("scopedBranchBindingId: first.targetBranchBindingId")
    expect(source).not.toContain("first.targetSessionRunId || activeSessionRunId()")
    const targetSessionIdSource = sourceSection("const targetSessionIdForLiveEvent =", "const targetSessionRunIdForLiveEvent =")
    expect(targetSessionIdSource).toContain("scopeProof ? `${scopeProof.sessionRunId}:${scopeProof.branchBindingId}` : \"\"")
    expect(targetSessionIdSource).not.toContain("currentRunSessionId()")
    expect(targetSessionIdSource).not.toContain("trace.currentSessionId()")
    const eventMetaSource = sourceSection("const eventRenderMeta =", "const bundleHasEventKey =")
    expect(eventMetaSource).toContain("session-run:${sessionRunId}:${branchBindingId}")
    expect(eventMetaSource).toContain('sourceScope === "session-run-visible"')
    expect(eventMetaSource).toContain("!isSessionRunScopedEvent && eventSessionId && sessionEventSeq !== undefined")
    expect(eventMetaSource).not.toContain("currentRunSessionId()")
    expect(eventMetaSource).not.toContain("trace.currentSessionId()")
    expect(source).toContain("LIVE_TRANSCRIPT_FLUSH_MAX_DELAY_MS = 32")
    const liveHandlerStart = source.indexOf("const handleLiveStreamEvent =")
    const remoteHandlerStart = source.indexOf("const handleRemoteEvent =", liveHandlerStart)
    const liveHandlerSource = source.slice(liveHandlerStart, remoteHandlerStart)
    expect(liveHandlerSource).toContain('if (type === "assistant_delta")')
    expect(liveHandlerSource).toContain("upsertAssistantStream(String(payload.content || \"\"), eventMeta)")
    expect(liveHandlerSource).toContain('if (type === "reasoning_delta")')
    expect(liveHandlerSource).toContain("updateThinkingFromReasoning(String(payload.content || \"\"), eventMeta)")
    expect(liveHandlerSource).toContain('if (type === "tool_call_delta")')
    expect(liveHandlerSource).toContain("appendToolCallDeltaToToolPart(payload, eventMeta)")
    expect(liveHandlerSource).toContain('if (type === "tool_call_stream")')
    expect(liveHandlerSource).toContain("appendToolStreamToToolPart(payload, eventMeta)")
    expect(liveHandlerSource).toContain("const liveEvent = createLiveTranscriptEvent(event, payload, eventMeta, sourceScope)")
    expect(liveHandlerSource).toContain("markPendingLiveEvent(eventMeta)")
    expect(liveHandlerSource).toContain("liveTranscriptEvents.push(liveEvent)")
    const bufferedBranch = liveHandlerSource.slice(
      liveHandlerSource.indexOf("if (liveEvent) {"),
      liveHandlerSource.indexOf("if (applyTranscriptReducer(event, type, { sourceScope }))")
    )
    expect(bufferedBranch).not.toContain("markRenderedEvent(eventMeta)")
    expect(liveHandlerSource.indexOf("upsertAssistantStream(String(payload.content || \"\"), eventMeta)")).toBeLessThan(
      liveHandlerSource.indexOf("const liveEvent = createLiveTranscriptEvent(event, payload, eventMeta, sourceScope)")
    )
    expect(source).toContain("const visibleTurns =")
    expect(source).toContain('format: "markdown"')
    expect(source).toContain('type: "thinking"')
  })

  it("keeps a 1200-delta stream off the full transcript reducer hot path", () => {
    const deltaFixture = Array.from({ length: 1200 }, (_item, index) => ({
      type: "assistant_delta",
      payload: { content: `${index % 10}` },
    }))
    const finalText = deltaFixture.map((event) => event.payload.content).join("")
    const liveHandlerStart = source.indexOf("const handleLiveStreamEvent =")
    const remoteHandlerStart = source.indexOf("const handleRemoteEvent =", liveHandlerStart)
    const liveHandlerSource = source.slice(liveHandlerStart, remoteHandlerStart)
    const assistantBranch = liveHandlerSource.slice(
      liveHandlerSource.indexOf('if (type === "assistant_delta")'),
      liveHandlerSource.indexOf('if (type === "reasoning_delta")'),
    )

    expect(deltaFixture).toHaveLength(1200)
    expect(finalText).toHaveLength(1200)
    expect(assistantBranch).toContain("upsertAssistantStream(String(payload.content || \"\"), eventMeta)")
    expect(assistantBranch).toContain("markRenderedEvent(eventMeta)")
    expect(assistantBranch).not.toContain("trace.applySessionRunTranscriptEventsToSession")
    expect(assistantBranch).not.toContain("liveTranscriptEvents.push")
    expect(assistantBranch).not.toContain("applyTranscriptReducer")
  })

  it("keeps session-run transcript events on the canonical reducer path", () => {
    const reducerStart = source.indexOf("const applyTranscriptReducer =")
    const appendAssistantStart = source.indexOf("const appendAssistantTextItem =", reducerStart)
    const reducerSource = source.slice(reducerStart, appendAssistantStart)
    const remoteHandlerStart = source.indexOf("const handleRemoteEvent =")
    const sendStopStart = source.indexOf("const sendStop =", remoteHandlerStart)
    const remoteHandlerSource = source.slice(remoteHandlerStart, sendStopStart)

    expect(reducerSource).toContain("if (!isSessionRunTranscriptEventType(type)) return false")
    expect(reducerSource).toContain("const scopeProof = remoteEventScopeProof(event, payload, sourceScope)")
    expect(reducerSource).toContain('if (sourceScope === "session-run-visible" && !scopeProof) return false')
    expect(reducerSource).toContain("trace.applySessionRunTranscriptEvent(event")
    expect(reducerSource).toContain("scopedSessionRunId: scopeProof?.sessionRunId")
    expect(reducerSource).not.toContain("activeSessionRunId()")
    expect(remoteHandlerSource).toContain("const canonicalTranscriptEvent = isSessionRunTranscriptEventType(type)")
    expect(remoteHandlerSource).toContain("applyTranscriptReducer(event, type, {")
    expect(remoteHandlerSource).toContain("if (!canonicalTranscriptEvent && shouldArchiveActiveStreamBeforeEvent")
    expect(remoteHandlerSource).toContain("if (!canonicalTranscriptEvent && prompt")
    expect(remoteHandlerSource).toContain("if (terminalAccepted && !canonicalTranscriptEvent && payload.response")
  })

  it("commits streaming overlay before structural session-run events", () => {
    const remoteHandlerStart = source.indexOf("const handleRemoteEvent =")
    const sendStopStart = source.indexOf("const sendStop =", remoteHandlerStart)
    const remoteHandlerSource = source.slice(remoteHandlerStart, sendStopStart)

    expect(source).toContain("const flushLiveTranscriptEvents =")
    expect(source).toContain('if (msg.type !== "sessionRun.stream")')
    expect(source).toContain("flushLiveTranscriptEvents()")
    expect(source).toContain("archiveActiveTranscriptItems()")
    expect(remoteHandlerSource).toContain("handleLiveStreamEvent(event, sourceScope)")
    expect(remoteHandlerSource).toContain("flushLiveTranscriptEvents()")
    expect(remoteHandlerSource.indexOf("archiveActiveTranscriptItems()")).toBeLessThan(
      remoteHandlerSource.indexOf("const pendingApprovalForEvent")
    )
  })

  it("persists scoped remote runtime reductions before applying view effects", () => {
    const applyRemoteSource = sourceSection(
      "const applyRemoteSessionRuntimeMessageResult =",
      "const isSessionRunVisibleSource =",
    )

    expect(applyRemoteSource).toContain("const result = reduceRemoteSessionRuntimeMessage")
    expect(applyRemoteSource).toContain("setSessionRuntimeModel(result.model)")
    expect(applyRemoteSource.indexOf("setSessionRuntimeModel(result.model)")).toBeLessThan(
      applyRemoteSource.indexOf("applySessionRuntimeEffectsToView(result.effects)")
    )
  })

  it("persists session_run_end runtime reductions before terminal view effects", () => {
    const runEndSource = sourceSection(
      '} else if (type === "session_run_end" && applySessionRunLifecycle) {',
      "    markRenderedEvent(eventMeta)",
    )

    expect(runEndSource).toContain('reduceRemoteSessionRuntimeMessage("sessionRun.done"')
    expect(runEndSource).toContain('status: "done"')
    expect(runEndSource).toContain('viewEffect: { kind: "terminal", status: "done" }')
    expect(runEndSource).toContain("setSessionRuntimeModel(terminalResult.model)")
    expect(runEndSource.indexOf("setSessionRuntimeModel(terminalResult.model)")).toBeGreaterThan(
      runEndSource.indexOf("if (sessionRuntimeMessageRejected(terminalResult.effects)) return")
    )
    expect(runEndSource.indexOf("setSessionRuntimeModel(terminalResult.model)")).toBeLessThan(
      runEndSource.indexOf("applySessionRuntimeEffectsToView(terminalResult.effects)")
    )
  })

  it("does not infer done terminal status from current visible UI state", () => {
    const runEndSource = sourceSection(
      '} else if (type === "session_run_end" && applySessionRunLifecycle) {',
      "    markRenderedEvent(eventMeta)",
    )
    const doneSource = sourceSection(
      'if (msg.type === "sessionRun.done") {',
      'if (msg.type === "environment.run.completed")',
    )

    expect(source).not.toContain("const doneStatusFromCurrentRun =")
    expect(source).not.toContain("sessionRunSawError")
    expect(source).not.toContain("sessionRunSawTerminal")
    expect(runEndSource).not.toContain("doneStatusFromCurrentRun")
    expect(doneSource).not.toContain("doneStatusFromCurrentRun")
    expect(doneSource).toContain('type: "sessionRun.done"')
    expect(doneSource).toContain('status: "done"')
    expect(doneSource).toContain('viewEffect: { kind: "terminal", status: "done", startNextEnvironment: true }')
  })

  it("loads raw AgentRun audit events from transcript card references", () => {
    expect(source).toContain("rawAuditAgentRunQuery(refs)")
    expect(source).toContain("rawAuditEventKey(refs)")
    expect(source).toContain('type: "agentRun.events"')
    expect(source).toContain("requestId: key")
    expect(source).toContain('msg.type === "agentRun.events"')
    expect(source).toContain("filterRawAuditEvents(events, refs)")
    expect(source).toContain("onLoadRawAuditEvents={loadRawAuditEvents}")
    expect(source).toContain("rawAuditEvents={rawAuditEvents()}")
  })

  it("keeps active draft archiving outside canonical session-run transcript events", () => {
    expect(source).toContain("const shouldArchiveActiveStreamBeforeEvent =")
    expect(source).toContain("const isArchivableActiveTranscriptItem =")
    expect(source).toContain("isReasoningThinkingItem(item)")
    expect(source).toContain('if (type === "session_run_end") return false')
    expect(source).toContain("if (!canonicalTranscriptEvent && shouldArchiveActiveStreamBeforeEvent")
    expect(source).toContain('"tool_call_start"')
    expect(source).toContain('"tool_call_end"')
    expect(source).toContain('"assistant_message"')
    expect(source).toContain('"reasoning_message"')
    const remoteHandlerStart = source.indexOf("const handleRemoteEvent =")
    const runtimeControllerStart = source.indexOf("const sendStop =", remoteHandlerStart)
    const remoteHandlerSource = source.slice(remoteHandlerStart, runtimeControllerStart)
    expect(remoteHandlerSource).not.toContain("appendToolStreamToToolPart(payload, eventMeta)")
    expect(source).toContain('type === "tool_call_delta"')
  })

  it("shows streamed tool-call drafts as preparing tool cards before execution starts", () => {
    expect(source).toContain("const appendToolCallDeltaToToolPart =")
    expect(source).toContain("preparingToolCallId(payload)")
    expect(source).toContain('status: "preparing"')
    expect(source).toContain("arguments_preview")
    expect(source).toContain("preparingIndex")
    expect(source).toContain('"tool_call_delta"')
  })

  it("prevents stale tool-call deltas from downgrading real tool cards", () => {
    expect(source).toContain("const shouldIgnoreToolCallDelta =")
    expect(source).toContain('part.status !== "preparing"')
    expect(source).toContain("if (shouldIgnoreToolCallDelta(realToolCallId, preparingIndex)) return")
    expect(source).toContain("part.preparingIndex === preparingIndex")
    expect(source).toContain("preparingIndex: numberValue(payload.index)")
    expect(source).not.toContain("resultMeta: { preparingIndex")
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

  it("keeps reasoning deltas in the streaming overlay until commit boundaries", () => {
    expect(source).toContain("const updateThinkingFromReasoning =")
    expect(source).toContain("const updateThinkingItem = (part: ThinkingItem): ThinkingItem =>")
    expect(source).toContain("streamKey: REASONING_STREAM_KEY")
    expect(source).toContain('id: `thinking-${activeSessionRunId() || "pending"}`')
    const updateThinkingStart = source.indexOf("const updateThinkingFromReasoning =")
    const appendToolStart = source.indexOf("const appendToolStreamToToolPart =", updateThinkingStart)
    const updateThinkingSource = source.slice(updateThinkingStart, appendToolStart)
    expect(updateThinkingSource).toContain("upsertActiveTranscriptItem(")
    expect(updateThinkingSource).toContain("scheduleStreamingTextOverlayCommit()")
    expect(updateThinkingSource).not.toContain("updateAssistantItems((parts)")
  })

  it("only shows the footer working indicator before the running turn has transcript content", () => {
    expect(source).toContain("const hasVisibleRunTranscriptItems = createMemo")
    expect(source).toContain("currentAssistantMessages().some((message) => message.parts.length > 0)")
    expect(source).toContain("showWorkingIndicator={visibleIsWorking() && !hasVisibleRunTranscriptItems()}")
  })

  it("settles active assistant stream and thinking state when a run ends without bypassing canonical transcript", () => {
    expect(source).toContain("const settleAssistantMessageForRunEnd =")
    expect(source).toContain("settleAssistantMessageForRunEnd(nextStatus)")
    expect(source).toContain("normalizeTranscriptItemForRunEnd")
    expect(source).toContain('if (terminalAccepted && !canonicalTranscriptEvent && payload.response && payload.response_rendered !== true)')
    expect(source).toContain('streaming: false')
    expect(source).toContain('streamKey: "assistant-message"')
    expect(source).toContain("active: false")
    expect(source).toContain("traceStatusForRunEnd")
  })

  it("keeps session_run_end final payload from duplicating an active assistant stream", () => {
    const branchIndex = source.indexOf('} else if (type === "session_run_end" && applySessionRunLifecycle) {')
    const clearIndex = source.indexOf('clearActiveTranscriptItems((part) => part.type === "assistant_text" && part.streamKey === "assistant-stream")', branchIndex)
    const appendIndex = source.indexOf('appendAssistantTextItem(String(payload.response), "final"', branchIndex)
    const finishIndex = source.indexOf("applySessionRuntimeEffectsToView(terminalResult.effects)", branchIndex)
    const guardIndex = source.indexOf("if (terminalAccepted && !canonicalTranscriptEvent && payload.response", branchIndex)

    expect(guardIndex).toBeGreaterThan(branchIndex)
    expect(clearIndex).toBeGreaterThan(branchIndex)
    expect(clearIndex).toBeLessThan(appendIndex)
    expect(appendIndex).toBeLessThan(finishIndex)
  })

  it("handles only session_run lifecycle event names for recovery and cancellation", () => {
    expect(source).toContain('} else if (type === "session_run_recovery_start" && applySessionRunLifecycle) {')
    expect(source).toContain('} else if (type === "session_run_cancel_requested" && applySessionRunLifecycle) {')
    expect(source).not.toContain('type === "chat_recovery_start"')
    expect(source).not.toContain('type === "chat_cancel_requested"')
  })

  it("sends the current frontend locale with chat.send", () => {
    expect(source).toContain('locale: locale()')
  })

  it("keeps approval reply failures recoverable in the approval UI", () => {
    expect(source).toContain('msg.type === "approval.reply.error"')
    expect(source).toContain("markApprovalSubmitFailed(items, approvalId, message, sessionRunId, branchBindingId)")
    expect(source).toContain("mergeStatusApprovals(items, statusApprovals, sessionRunId, branchBindingId)")
  })

  it("routes reply failure notices through scoped runtime effects", () => {
    const approvalErrorSource = sourceSection(
      'if (msg.type === "approval.reply.error") {',
      'if (msg.type === "sessionRun.userInput.reply.ok")',
    )
    const userInputErrorSource = sourceSection(
      'if (msg.type === "sessionRun.userInput.reply.error") {',
      'if (msg.type === "environment.run.error")',
    )

    expect(approvalErrorSource).toContain('if (!applySessionRuntimeMessage({')
    expect(approvalErrorSource).toContain('type: "approval.reply.error"')
    expect(approvalErrorSource).not.toContain("acceptBranchInteractionRuntimeMessage(")
    expect(approvalErrorSource).not.toContain("|| activeSessionRunId()")
    expect(approvalErrorSource.indexOf('if (!applySessionRuntimeMessage({')).toBeLessThan(
      approvalErrorSource.indexOf("setPendingApprovals(")
    )
    expect(approvalErrorSource).toContain('message: `审批提交失败：${message}`')
    expect(approvalErrorSource).not.toContain("appendNotice(")
    expect(userInputErrorSource).toContain('if (!applySessionRuntimeMessage({')
    expect(userInputErrorSource).toContain('type: "sessionRun.userInput.reply.error"')
    expect(userInputErrorSource).not.toContain("acceptBranchInteractionRuntimeMessage(")
    expect(userInputErrorSource).not.toContain("|| activeSessionRunId()")
    expect(userInputErrorSource.indexOf('if (!applySessionRuntimeMessage({')).toBeLessThan(
      userInputErrorSource.indexOf("setPendingUserInputs(")
    )
    expect(userInputErrorSource).toContain('message: `输入提交失败：${message}`')
    expect(userInputErrorSource).not.toContain("appendNotice(")
  })

  it("gates approval and user-input reply state mutations to the selected branch", () => {
    const approvalOkSource = sourceSection(
      'if (msg.type === "approval.reply.ok") {',
      'if (msg.type === "approval.reply.error")',
    )
    const approvalErrorSource = sourceSection(
      'if (msg.type === "approval.reply.error") {',
      'if (msg.type === "sessionRun.userInput.reply.ok")',
    )
    const userInputOkSource = sourceSection(
      'if (msg.type === "sessionRun.userInput.reply.ok") {',
      'if (msg.type === "sessionRun.userInput.reply.error")',
    )
    const userInputErrorSource = sourceSection(
      'if (msg.type === "sessionRun.userInput.reply.error") {',
      'if (msg.type === "environment.run.error")',
    )

    for (const replySource of [approvalOkSource, approvalErrorSource, userInputOkSource, userInputErrorSource]) {
      expect(replySource).toContain('if (!applySessionRuntimeMessage({')
      expect(replySource).not.toContain("acceptBranchInteractionRuntimeMessage(")
      expect(replySource).not.toContain("|| activeSessionRunId()")
      expect(replySource).not.toContain("|| selectedBranchBindingId()")
      expect(replySource.indexOf('if (!applySessionRuntimeMessage({')).toBeLessThan(
        Math.max(
          replySource.indexOf("setPendingApprovals("),
          replySource.indexOf("setPendingUserInputs("),
        ),
      )
    }
  })

  it("scopes session run event batches and approval resolution to the selected branch", () => {
    const eventsSource = sourceSection(
      'if (msg.type === "sessionRun.events" && Array.isArray(msg.events))',
      'if (msg.type === "sessionRun.stream" && Array.isArray(msg.events))',
    )
    const streamSource = sourceSection(
      'if (msg.type === "sessionRun.stream" && Array.isArray(msg.events))',
      'if (msg.type === "agentRun.events" && typeof msg.payload === "object" && msg.payload)',
    )
    const transcriptBundleSource = sourceSection(
      "const sessionRuntimeTranscriptBundle =",
      "const applySessionRuntimeScopedTranscriptEvents =",
    )
    const scopedTranscriptSource = sourceSection(
      "const applySessionRuntimeScopedTranscriptEvents =",
      "const applyRemoteSessionRuntimeMessage =",
    )

    expect(source).toContain('if (msg.type === "sessionRun.events" && Array.isArray(msg.events))')
    expect(source).toContain('if (msg.type === "sessionRun.stream" && Array.isArray(msg.events))')
    expect(eventsSource).toContain("const rawBranchBindingId = stringValue(msg.branchBindingId) || stringValue(msg.branch_binding_id)")
    expect(eventsSource).toContain("const runtimeResult = applySessionRuntimeScopedTranscriptEvents(")
    expect(eventsSource).toContain('"sessionRun.events"')
    expect(eventsSource).toContain('if (!sessionRuntimeVisibleEventsAccepted(runtimeResult, "sessionRun.events")) return')
    expect(eventsSource).not.toContain("if (!acceptVisibleSessionRuntimeMessage(sessionRunId, rawBranchBindingId)) return")
    expect(streamSource).toContain("const rawBranchBindingId = stringValue(msg.branchBindingId) || stringValue(msg.branch_binding_id)")
    expect(streamSource).toContain("const runtimeResult = applySessionRuntimeScopedTranscriptEvents(")
    expect(streamSource).toContain('"sessionRun.stream"')
    expect(streamSource).toContain('if (!sessionRuntimeVisibleEventsAccepted(runtimeResult, "sessionRun.stream")) return')
    expect(streamSource).not.toContain("if (!acceptVisibleSessionRuntimeMessage(sessionRunId, rawBranchBindingId)) return")
    expect(transcriptBundleSource).not.toContain("trace.currentSessionId()")
    expect(transcriptBundleSource).not.toContain("trace.stats()")
    expect(transcriptBundleSource).not.toContain("existing?.stats")
    expect(transcriptBundleSource).toContain("emptySessionRuntimeStatsForStatus(scope.status)")
    expect(scopedTranscriptSource).toContain("currentSessionId: stringValue(sessionId) || `${sessionRunId}:${branchBindingId}`")
    expect(scopedTranscriptSource).not.toContain("currentSessionId: stringValue(sessionId) || trace.currentSessionId()")
    expect(source).toContain("pendingApprovalMatches(item, { approvalId, sessionRunId, branchBindingId })")
  })

  it("guards visible branch-scoped webview messages through the SessionRuntime reducer", () => {
    const branchStartedSource = sourceSection(
      'if (msg.type === "sessionRun.branch.started") {',
      'if (msg.type === "sessionRun.branches")',
    )
    const branchesSource = sourceSection(
      'if (msg.type === "sessionRun.branches") {',
      'if (msg.type === "sessionRun.branch.selected")',
    )
    const applySummariesSource = sourceSection(
      "const applySessionRuntimeBranchSummaries =",
      "const applySessionRuntimeScopeSelection =",
    )
    const branchSelectedSource = sourceSection(
      'if (msg.type === "sessionRun.branch.selected") {',
      'if (msg.type === "session.adopted"',
    )
    const sessionSource = sourceSection(
      'if (msg.type === "sessionRun.session" && typeof msg.sessionRunId === "string") {',
      'if (msg.type === "sessionRun.pendingNextTurn")',
    )
    const pendingSource = sourceSection(
      'if (msg.type === "sessionRun.pendingNextTurn") {',
      'if (msg.type === "sessionRun.pendingNextTurns") {',
    )
    const continuedSource = sourceSection(
      'if (msg.type === "sessionRun.continued") {',
      'if (msg.type === "sessionRun.reconnecting")',
    )
    const reconnectingSource = sourceSection(
      'if (msg.type === "sessionRun.reconnecting") {',
      'if (msg.type === "sessionRun.reconnected")',
    )
    const doneSource = sourceSection(
      'if (msg.type === "sessionRun.done") {',
      'if (msg.type === "environment.run.completed")',
    )

    expect(source).toContain("from \"../chat/sessionRuntimeReducer\"")
    expect(source).toContain("const sessionRuntimeModelSnapshot =")
    expect(source).toContain("const acceptSessionRuntimeMessage =")
    expect(source).toContain("reduceSessionRuntimeHostMessage(sessionRuntimeModelSnapshot(), message)")
    expect(source).toContain("applySessionRuntimeOperationResult(")
    expect(source).not.toContain("sessionRuntimeOperationAccepted(\"sessionRun.operation.success\", operation)")
    expect(source).not.toContain("shouldApplyOperationResult(")
    expect(source).not.toContain("shouldApplyOperationError(")
    expect(source).not.toContain("shouldApplyBranchSummaryMessage(")
    expect(source).not.toContain("shouldApplySessionRunBranchInteractionMessage(")
    expect(branchStartedSource).toContain("if (!applySessionRuntimeOperationResult(\"sessionRun.operation.success\", operation)) return")
    expect(branchStartedSource).toContain("const branchBindingId = sessionRunOperationResultTargetBranchBindingId(operation)")
    expect(branchStartedSource).toContain('if (!applySessionRuntimeScopeSelection(sessionRunId, branchBindingId, "running")) return')
    expect(branchStartedSource).not.toContain("applyVisibleBranchBinding(")
    expect(branchStartedSource).not.toContain("clearSessionRunOperationView(")
    expect(branchStartedSource).not.toContain("|| selectedBranchBindingId()")
    expect(branchStartedSource).not.toContain("setActiveSessionRunId(")
    expect(branchStartedSource.indexOf("if (!applySessionRuntimeOperationResult(\"sessionRun.operation.success\", operation)) return")).toBeLessThan(
      branchStartedSource.indexOf('if (!applySessionRuntimeScopeSelection(sessionRunId, branchBindingId, "running")) return')
    )
    expect(branchesSource).toContain("if (!applySessionRuntimeBranchSummaries(sessionRunId, branches)) return")
    expect(branchesSource).not.toContain("setBranchSummaries(")
    expect(applySummariesSource).toContain("if (branch.selected || model.visible.selectedScopeId === scopeId) continue")
    expect(applySummariesSource).toContain("sessionRuntimeScopeForUpsert(model, sessionRunId, branch.branchBindingId")
    expect(branchSelectedSource).toContain("if (!applySessionRuntimeOperationResult(\"sessionRun.operation.success\", operation)) return")
    expect(branchSelectedSource).toContain("const branchBindingId = sessionRunOperationResultTargetBranchBindingId(operation)")
    expect(branchSelectedSource).toContain("if (!applySessionRuntimeScopeSelection(sessionRunId, branchBindingId, nextStatus, {")
    expect(branchSelectedSource).toContain("clearPendingNextTurns: true")
    expect(branchSelectedSource).toContain("...(sessionId ? { sessionId } : {})")
    expect(branchSelectedSource).not.toContain("applyVisibleBranchProjection(")
    expect(branchSelectedSource).not.toContain("clearSessionRunOperationView(")
    expect(branchSelectedSource).not.toContain("|| selectedBranchBindingId()")
    expect(branchSelectedSource).not.toContain("setActiveSessionRunId(")
    expect(branchSelectedSource).not.toContain("setCurrentRunSessionId(")
    expect(branchSelectedSource).not.toContain("setIsWorking(")
    expect(branchSelectedSource).not.toContain("setWorkingText(")
    expect(branchSelectedSource.indexOf("if (!applySessionRuntimeOperationResult(\"sessionRun.operation.success\", operation)) return")).toBeLessThan(
      branchSelectedSource.indexOf("if (!applySessionRuntimeScopeSelection(sessionRunId, branchBindingId, nextStatus, {")
    )
    expect(sessionSource).toContain("if (!applySessionRuntimeOperationResult(\"sessionRun.operation.success\", operation)) return")
    expect(sessionSource).toContain('if (!applySessionRuntimeScopeSelection(msg.sessionRunId, branchBindingId, "running", {')
    expect(sessionSource).toContain("...(sessionId ? { sessionId } : {})")
    expect(sessionSource).not.toContain("applyVisibleBranchBinding(")
    expect(sessionSource).not.toContain("clearSessionRunOperationView(")
    expect(sessionSource).not.toContain("setActiveSessionRunId(")
    expect(sessionSource).not.toContain("setCurrentRunSessionId(")
    expect(sessionSource.indexOf("if (!applySessionRuntimeOperationResult(\"sessionRun.operation.success\", operation)) return")).toBeLessThan(
      sessionSource.indexOf('if (!applySessionRuntimeScopeSelection(msg.sessionRunId, branchBindingId, "running", {')
    )
    expect(pendingSource).toContain("const rawBranchBindingId = stringValue(msg.branchBindingId) || stringValue(msg.branch_binding_id)")
    expect(pendingSource).toContain("if (!applySessionRuntimeMessage({")
    expect(pendingSource).toContain('type: "sessionRun.pendingNextTurn"')
    expect(pendingSource).toContain("pendingNextTurn: pending")
    expect(pendingSource).not.toContain("setQueuedPrompts(")
    expect(pendingSource).not.toContain("acceptVisibleSessionRuntimeMessage(")
    expect(pendingSource).not.toContain("selectedBranchBindingId()")
    expect(continuedSource).toContain("const hasOperationResult = Boolean(operation.operationId || operation.operationKind)")
    expect(continuedSource).toContain("if (hasOperationResult && !applySessionRuntimeOperationResult(\"sessionRun.operation.success\", operation)) return")
    expect(continuedSource).not.toContain("sessionRunContinuedViewEffect")
    expect(continuedSource).not.toContain("clearSessionRunOperationView(")
    expect(continuedSource).not.toContain("setActiveSessionRunId(")
    expect(reconnectingSource).toContain("const sessionId =")
    expect(reconnectingSource).toContain("...(sessionId ? { sessionId } : {})")
    expect(reconnectingSource).not.toContain("currentRunSessionId()")
    expect(reconnectingSource).not.toContain("setActiveSessionRunId(")
    expect(reconnectingSource).not.toContain("setCurrentRunSessionId(")
    expect(doneSource).toContain("const rawBranchBindingId = stringValue(msg.branchBindingId) || stringValue(msg.branch_binding_id)")
    expect(doneSource).toContain("if (!applySessionRuntimeMessage({")
    expect(doneSource).toContain('type: "sessionRun.done"')
    expect(doneSource).toContain('status: "done"')
    expect(doneSource).toContain('viewEffect: { kind: "terminal", status: "done", startNextEnvironment: true }')
  })

  it("ignores scoped session run errors for non-selected branches", () => {
    const errorSource = sourceSection(
      'if (msg.type === "sessionRun.error") {',
      "    onCleanup(() => {",
    )

    expect(errorSource).toContain("const sessionRunId = stringValue(msg.sessionRunId) || stringValue(msg.session_run_id)")
    expect(errorSource).toContain("const branchBindingId = stringValue(msg.branchBindingId) || stringValue(msg.branch_binding_id)")
    expect(errorSource).toContain("const runtimeResult = applySessionRuntimeMessageResult({")
    expect(errorSource).toContain("if (!runtimeResult) return")
    expect(errorSource).toContain('viewEffect: { kind: "terminal", status: "error" }')
    expect(errorSource).toContain('if (sessionRuntimeVisibleTerminalAccepted(runtimeResult, "error")) {')
    expect(errorSource).toContain('message: `连接错误：${typeof msg.message === "string" ? msg.message : "unknown error"}`')
    expect(errorSource).not.toContain("if (sessionRunId && activeSessionRunId() && sessionRunId !== activeSessionRunId()) return")
    expect(errorSource).not.toContain("appendNotice(")
  })

  it("keeps operation errors out of selected-run terminal cleanup", () => {
    const operationErrorSource = sourceSection(
      'if (msg.type === "sessionRun.operation.error") {',
      'if (msg.type === "sessionRun.pendingNextTurn")',
    )

    expect(operationErrorSource).toContain("applySessionRuntimeOperationResult(")
    expect(operationErrorSource).not.toContain("appendNotice(")
    expect(operationErrorSource).not.toContain("clearSessionRunOperationView(")
    expect(operationErrorSource).not.toContain('setSessionRunStatus("error")')
    expect(operationErrorSource).not.toContain('trace.patchStats({ runStatus: "error" })')
    expect(operationErrorSource).not.toContain("finishSessionRun(")
  })

  it("does not mark the event stream as failed for info-level operation errors", () => {
    const operationErrorSource = sourceSection(
      'if (msg.type === "sessionRun.operation.error") {',
      'if (msg.type === "sessionRun.pendingNextTurn")',
    )

    expect(operationErrorSource).toContain('const level = stringValue(msg.level) === "info" ? "info" : "error"')
    expect(operationErrorSource).toContain('if (level === "info") return')
    expect(operationErrorSource.indexOf('if (level === "info") return')).toBeLessThan(
      operationErrorSource.indexOf("setServerEventStreamState(serverEventStreamErrorState({"),
    )
  })

  it("routes operation error rollback through the scoped runtime effect", () => {
    const operationErrorSource = sourceSection(
      'if (msg.type === "sessionRun.operation.error") {',
      'if (msg.type === "sessionRun.pendingNextTurn")',
    )

    expect(operationErrorSource).toContain("applySessionRuntimeOperationResult(")
    expect(operationErrorSource).not.toContain("sessionRunOperationErrorViewEffect")
    expect(operationErrorSource).not.toContain("if (effect.rollback)")
    expect(operationErrorSource).not.toContain("applyVisibleBranchProjection(")
    expect(operationErrorSource).not.toContain('operationKind === "branch.create"')
    expect(operationErrorSource).not.toContain('operation.kind === "branch.create"')
  })

  it("does not use the visible pending operation as operation result ownership proof", () => {
    const scopeFactorySource = sourceSection(
      "const sessionRuntimeScope =",
      "const cloneSessionRuntimeScope =",
    )
    const snapshotSource = sourceSection(
      "const sessionRuntimeModelSnapshot =",
      "const reduceCurrentSessionRuntimeMessage =",
    )
    const operationTargetSource = sourceSection(
      "const sessionRuntimeOperationTarget =",
      "const reduceSessionRuntimeOperationResult =",
    )
    const operationResultSource = sourceSection(
      "const reduceSessionRuntimeOperationResult =",
      "const createSessionRunOperationId =",
    )

    expect(scopeFactorySource).not.toContain("selectedBranchBindingId()")
    expect(scopeFactorySource).not.toContain("trace.turns()")
    expect(scopeFactorySource).not.toContain("trace.stats()")
    expect(scopeFactorySource).toContain("emptySessionRuntimeStatsForStatus(status)")
    expect(scopeFactorySource).toContain("projection?.turns")
    expect(scopeFactorySource).toContain("projection?.stats")
    expect(scopeFactorySource).toContain("const sessionRuntimeScopeForUpsert =")
    expect(scopeFactorySource).toContain("const base = model.scopes[scopeId] || sessionRuntimeScope(")
    expect(scopeFactorySource).toContain("stats: sessionRuntimeStatsWithStatus(base.stats, status)")
    expect(snapshotSource).not.toContain("pendingSessionRunOperation()")
    expect(snapshotSource).not.toContain("sessionRuntimeOperationFromPending(pending")
    expect(snapshotSource).not.toContain("activeSessionRunId()")
    expect(snapshotSource).not.toContain("selectedBranchBindingId()")
    expect(snapshotSource).not.toContain("trace.turns()")
    expect(operationTargetSource).toContain("sessionRuntimeOperationResultTarget(sessionRuntimeModelSnapshot(), operation, messageType)")
    expect(operationTargetSource).not.toContain("const runId = operation.sessionRunId")
    expect(operationTargetSource).not.toContain("const existing = sessionRuntimeExistingOperation(sessionRuntimeModelSnapshot(), operation)")
    expect(operationTargetSource).not.toContain("sessionRunId: existing.scope.sessionRunId")
    expect(operationTargetSource).not.toContain("branchBindingId: existing.scope.branchBindingId")
    expect(operationTargetSource).not.toContain("pendingSessionRunOperation()")
    expect(operationTargetSource).not.toContain("pending?.")
    expect(operationResultSource).not.toContain("pendingSessionRunOperation()")
    expect(operationResultSource).not.toContain("modelWithOperationResponseScope")
    expect(operationResultSource).not.toContain("pending.")
    expect(operationResultSource).toContain("const operationResultModel = sessionRuntimeModelForOperationResult({")
    expect(operationResultSource).toContain("model: sessionRuntimeModelSnapshot()")
    expect(operationResultSource).toContain("createScope: sessionRuntimeScopeForUpsert")
    expect(operationResultSource).toContain("if (!operationResultModel) return undefined")
    expect(operationResultSource).not.toContain('type: "sessionRun.scope.delete"')
    expect(operationResultSource).not.toContain("target.branchBindingId === selectedBranchBindingId()")
    expect(operationResultSource).not.toContain("sessionRunStatus()")
    expect(source).not.toContain("const sessionRuntimeModelForOperationResult =")
  })

  it("routes operation pending acknowledgements through the scoped operation begin path", () => {
    const beginSource = sourceSection(
      "const beginSessionRunOperationView =",
      "const sessionRuntimeViewTarget =",
    )
    const pendingSource = sourceSection(
      'if (msg.type === "sessionRun.operation.pending") {',
      'if (msg.type === "sessionRun.session" && typeof msg.sessionRunId === "string")',
    )

    expect(source).not.toContain("const [pendingSessionRunOperation")
    expect(source).not.toContain("setPendingSessionRunOperation")
    expect(source).not.toContain("clearSessionRunOperationView")
    expect(source).not.toContain("const sessionRuntimeOperationPendingAccepted =")
    expect(source).not.toContain("pendingSessionRunOperationViewFromRuntimeScope")
    expect(beginSource).toContain("const current = sessionRuntimeOperationViewFromScope(")
    expect(beginSource).not.toContain("pendingSessionRunOperation()")
    expect(beginSource).not.toContain("pending.sessionRunId || activeSessionRunId()")
    expect(beginSource).not.toContain("selectedBranchBindingId() || \"main\"")
    expect(pendingSource).toContain("if (!beginSessionRunOperationView({")
    expect(pendingSource).toContain("targetBranchBindingId: sessionRunOperationPendingTargetBranchBindingId(operation)")
    expect(pendingSource).not.toContain("setPendingSessionRunOperation((current)")
  })

  it("keeps branch select begin as a scoped operation without optimistic visible selection", () => {
    const beginSource = sourceSection(
      "const beginSessionRunOperationView =",
      "const sessionRuntimeViewTarget =",
    )
    const selectBranchSource = sourceSection(
      "const selectBranch =",
      "const sendChatText =",
    )

    expect(beginSource).toContain("sessionRuntimeOperationBeginPlacement(pending)")
    expect(beginSource).toContain("const beginModel = sessionRuntimeModelSnapshot()")
    expect(beginSource).toContain("const existingScope = beginModel.scopes[scopeId]")
    expect(beginSource).toContain("sessionRuntimeScopeForUpsert(")
    expect(beginSource).toContain("beginModel,")
    expect(beginSource).toContain('placement.status || existingScope?.status || "running"')
    expect(beginSource).toContain("...(placement.select ? { select: true } : {})")
    expect(beginSource).toContain("if (sessionRuntimeMessageRejected(scoped.effects)) return false")
    expect(beginSource).not.toContain("scope: sessionRuntimeScope(placement.sessionRunId, placement.branchBindingId")
    expect(beginSource).not.toContain("const pendingBranch = pending.targetBranchBindingId || pending.sourceBranchBindingId")
    expect(beginSource).not.toContain("select: true,\n    }).model\n    const result = reduceSessionRuntimeHostMessage(scopedModel")
    expect(beginSource).not.toContain("placement.status || sessionRunStatus()")
    expect(selectBranchSource).toContain('kind: "branch.select"')
    expect(selectBranchSource).toContain("const sourceBranchBindingId = selectedBranchBindingId()")
    expect(selectBranchSource).toContain("sourceBranchBindingId")
    expect(selectBranchSource).toContain("targetBranchBindingId: normalized")
  })

  it("settles failed branch select operations in the begin scope instead of the target projection", () => {
    const operationTargetSource = sourceSection(
      "const sessionRuntimeOperationTarget =",
      "const reduceSessionRuntimeOperationResult =",
    )
    const operationResultSource = sourceSection(
      "const reduceSessionRuntimeOperationResult =",
      "const applySessionRuntimeOperationResult =",
    )

    expect(operationTargetSource).toContain("messageType:")
    expect(operationTargetSource).toContain("sessionRuntimeOperationResultTarget(sessionRuntimeModelSnapshot(), operation, messageType)")
    expect(operationTargetSource).not.toContain('messageType === "sessionRun.operation.error"')
    expect(operationTargetSource).not.toContain("existing.operation.targetBranchBindingId !== resultBranchBindingId")
    expect(operationTargetSource).not.toContain("scopeId: existing.scope.scopeId")
    expect(operationTargetSource).not.toContain('operation.operationKind === "start" ? sessionRunStartTargetBranchBindingId() : ""')
    expect(operationResultSource).toContain("sessionRuntimeOperationTarget(operation, messageType)")
    expect(operationResultSource).toContain("const resultBranchBindingId = sessionRunOperationResultTargetBranchBindingId(operation)")
    expect(operationResultSource).toContain("resultBranchBindingId && resultBranchBindingId === target.branchBindingId")
  })

  it("keeps projection recovery errors out of selected-run terminal cleanup", () => {
    const projectionErrorSource = sourceSection(
      'if (msg.type === "sessionRun.projection.error") {',
      'if (msg.type === "sessionRun.interrupted")',
    )

    expect(projectionErrorSource).toContain('if (!applySessionRuntimeMessage({')
    expect(projectionErrorSource).toContain('type: "sessionRun.projection.error"')
    expect(projectionErrorSource).not.toContain("acceptVisibleSessionRuntimeMessage(")
    expect(projectionErrorSource).toContain('message: `投影恢复失败：${typeof msg.message === "string" ? msg.message : "unknown error"}`')
    expect(projectionErrorSource).toContain("stopWorking: msg.stopWorking === true")
    expect(projectionErrorSource).not.toContain("appendNotice(")
    expect(projectionErrorSource).not.toContain('setSessionRunStatus("error")')
    expect(projectionErrorSource).not.toContain('trace.patchStats({ runStatus: "error" })')
    expect(projectionErrorSource).not.toContain("finishSessionRun(")
  })

  it("keeps interrupted runtime terminals out of runtime error handling", () => {
    const interruptedSource = sourceSection(
      'if (msg.type === "sessionRun.interrupted") {',
      'if (msg.type === "sessionRun.error")',
    )

    expect(interruptedSource).toContain('type: "sessionRun.interrupted"')
    expect(interruptedSource).toContain('status: "interrupted"')
    expect(interruptedSource).toContain('viewEffect: { kind: "terminal", status: "interrupted" }')
    expect(interruptedSource).not.toContain('type: "sessionRun.error"')
    expect(interruptedSource).not.toContain('status: "error"')
    expect(interruptedSource).not.toContain("setEnvironmentRunQueue([])")
  })

  it("ignores reconnect state messages for non-selected branches", () => {
    const reconnectingSource = sourceSection(
      'if (msg.type === "sessionRun.reconnecting") {',
      'if (msg.type === "sessionRun.reconnected") {',
    )
    const reconnectedSource = sourceSection(
      'if (msg.type === "sessionRun.reconnected") {',
      'if (msg.type === "sessionRun.events" && Array.isArray(msg.events))',
    )

    expect(reconnectingSource).toContain("const branchBindingId = stringValue(msg.branchBindingId) || stringValue(msg.branch_binding_id)")
    expect(reconnectingSource).toContain("if (!applySessionRuntimeMessage({")
    expect(reconnectingSource).toContain("...(sessionId ? { sessionId } : {})")
    expect(reconnectingSource).toContain('viewEffect: { kind: "running", text: t("chat.streamRecovery.reconnecting") }')
    expect(reconnectingSource).not.toContain("currentRunSessionId()")
    expect(reconnectingSource).not.toContain("setCurrentRunSessionId(")
    expect(reconnectingSource).not.toContain("setActiveSessionRunId(")
    expect(reconnectedSource).toContain("const branchBindingId = stringValue(msg.branchBindingId) || stringValue(msg.branch_binding_id)")
    expect(reconnectedSource).toContain("if (!applySessionRuntimeMessage({")
    expect(reconnectedSource).toContain("...(sessionId ? { sessionId } : {})")
    expect(reconnectedSource).toContain('viewEffect: { kind: "running", text: t("chat.streamRecovery.continuing") }')
  })

  it("clears pending approvals when approval reply succeeds", () => {
    expect(source).toContain('msg.type === "approval.reply.ok"')
    expect(source).toContain("markApprovalSubmitSucceeded(items, approvalId, sessionRunId, branchBindingId)")
    expect(source).toContain("setSelectedApproval(undefined)")
  })

  it("does not send stale approval candidates from the webview approval reply", () => {
    const sendApprovalStart = source.indexOf("const sendApprovalDecision =")
    const pendingUserInputStart = source.indexOf("const pendingUserInputContent =", sendApprovalStart)
    const sendApprovalSource = source.slice(sendApprovalStart, pendingUserInputStart)

    expect(sendApprovalSource).toContain('type: "approval.reply"')
    expect(sendApprovalSource).toContain("const proof = pendingInteractionProof(approval)")
    expect(sendApprovalSource).toContain("if (!proof) return")
    expect(sendApprovalSource).toContain("sessionRunId: proof.sessionRunId")
    expect(sendApprovalSource).toContain("branchBindingId: proof.branchBindingId")
    expect(sendApprovalSource).toContain("branch_binding_id: proof.branchBindingId")
    expect(sendApprovalSource).not.toContain("approval.sessionRunId || activeSessionRunId()")
    expect(sendApprovalSource).not.toContain("approval.branchBindingId || selectedBranchBindingId()")
    expect(sendApprovalSource).not.toContain("approvedSaveCandidate")
    expect(sendApprovalSource).not.toContain("approved_save_candidate")
  })

  it("routes auto approval through the same recoverable pending approval path", () => {
    expect(source).toContain("setPendingApprovals((items) => upsertPendingApproval(items, pendingApproval))")
    expect(source).toContain('replyApproval(pendingApproval, "allow_once", autoDecision.replyReason)')
    expect(source).toContain('replyApproval(pendingApproval, "deny_once", autoDecision.replyReason)')
  })

  it("routes MCP user input requests through a structured reply path", () => {
    const userInputReplySource = sourceSection(
      "const replyUserInput =",
      "const renderUserInputControl =",
    )

    expect(source).toContain('type === "user_input_request"')
    expect(source).toContain("setPendingUserInputs((items) => upsertPendingUserInput(items, userInput))")
    expect(source).toContain('type: "sessionRun.userInput.reply"')
    expect(source).toContain("buildUserInputContent(input, pendingUserInputContent(input))")
    expect(source).toContain("content: contentResult.content")
    expect(source).toContain('type === "user_input_resolved"')
    expect(source).toContain("pendingUserInputMatches(item, { inputId, sessionRunId, branchBindingId })")
    expect(source).toContain('msg.type === "sessionRun.userInput.reply.error"')
    expect(userInputReplySource).toContain("const proof = pendingInteractionProof(input)")
    expect(userInputReplySource).toContain("if (!proof) return")
    expect(userInputReplySource).toContain("sessionRunId: proof.sessionRunId")
    expect(userInputReplySource).toContain("branchBindingId: proof.branchBindingId")
    expect(userInputReplySource).toContain("branch_binding_id: proof.branchBindingId")
    expect(userInputReplySource).not.toContain("input.sessionRunId || activeSessionRunId()")
    expect(userInputReplySource).not.toContain("input.branchBindingId || selectedBranchBindingId()")
  })

  it("restores pending MCP user inputs from session run resume status", () => {
    expect(source).toContain("const statusUserInputs = Array.isArray(payload.user_inputs) ? payload.user_inputs : []")
    expect(source).toContain("if (sessionRunId) {")
    expect(source).toContain("reconcileStatusUserInputs(items, statusUserInputs, sessionRunId, branchBindingId)")
    expect(source).toContain("reconcileStatusUserInputValues(current, statusUserInputs, sessionRunId, branchBindingId)")
  })

  it("scopes pending MCP user input cards to the active session run and clears terminal state", () => {
    expect(source).toContain("visiblePendingUserInputsForRun(pendingUserInputs(), activeSessionRunId(), selectedBranchBindingId())")
    expect(source).toContain("item.sessionRunId === activeSessionRunId()")
    expect(source).toContain("item.branchBindingId === selectedBranchBindingId()")
    expect(source).toContain("const clearPendingBranchInteractions =")
    expect(source).toContain("if (!sessionRunId || !branchBindingId) return")
    expect(source).toContain("const targetBranchBindingId = branchBindingId")
    expect(source).not.toContain('const targetBranchBindingId = branchBindingId || "main"')
    expect(source).toContain("scopedSessionRunEvent(event as Record<string, unknown>, sessionRunId, rawBranchBindingId)")
    expect(source).toContain("eventRenderMeta(event, type, payload, sourceScope)")
    expect(source).toContain("const userInput = userInputFromPayload(payload, remoteEventSessionRunId(event, payload, sourceScope))")
    expect(source).not.toContain('String(event.session_run_id || "") || activeSessionRunId()')
  })

  it("uses the Host sessionRun event envelope as identity authority over inner event fields", () => {
    const scopedEventSource = sourceSection(
      "function scopedSessionRunEvent(",
      "function numberValue",
    )

    expect(scopedEventSource).toContain("const scopedSessionRunId = sessionRunId ||")
    expect(scopedEventSource).toContain("const scopedBranchBindingId = branchBindingId ||")
    expect(scopedEventSource).not.toContain("stringValue(event.session_run_id || event.sessionRunId) || sessionRunId")
    expect(scopedEventSource).not.toContain("stringValue(event.branch_binding_id || event.branchBindingId) || branchBindingId")
  })

  it("clears only the finished session run branch pending state", () => {
    const finishSource = sourceSection(
      "const finishSessionRun =",
      "const beginChatCommandRequest =",
    )

    expect(finishSource).toContain("const finishedSessionRunId = activeSessionRunId()")
    expect(finishSource).toContain("const finishedBranchBindingId = selectedBranchBindingId()")
    expect(finishSource).toContain("clearPendingBranchInteractions(finishedSessionRunId, finishedBranchBindingId)")
    expect(finishSource).not.toContain("setPendingApprovals([])")
    expect(finishSource).not.toContain("clearPendingUserInputs()")
  })

  it("does not globally clear branch pending state before terminal event cleanup", () => {
    const cancelledSource = sourceSection(
      '} else if (type === "session_run_cancelled" && applySessionRunLifecycle) {',
      '} else if (type === "error" && applySessionRunLifecycle) {',
    )
    const runtimeErrorSource = sourceSection(
      '} else if (type === "error" && applySessionRunLifecycle) {',
      '} else if (type === "session_run_failed" && applySessionRunLifecycle) {',
    )
    const runtimeFailedSource = sourceSection(
      '} else if (type === "session_run_failed" && applySessionRunLifecycle) {',
      '} else if (type === "session_run_end" && applySessionRunLifecycle) {',
    )
    const bindingMismatchSource = sourceSection(
      '} else if (type === "remote_peer_ready" && applySessionRunLifecycle) {',
      "markRenderedEvent(eventMeta)",
    )

    expect(cancelledSource).toContain("applyRemoteSessionRuntimeMessageResult(")
    expect(cancelledSource).toContain("sessionRuntimeVisibleTerminalAccepted(runtimeResult, \"cancelled\")")
    expect(cancelledSource).not.toContain('applyScopedTerminalState("cancelled")')
    expect(cancelledSource).not.toContain("setPendingApprovals([])")
    expect(cancelledSource).not.toContain("clearPendingUserInputs()")
    expect(runtimeErrorSource).toContain("applyRemoteSessionRuntimeMessage(")
    expect(runtimeErrorSource).toContain('message: `错误：${payload.message || "unknown error"}`')
    expect(runtimeErrorSource).not.toContain("appendNotice(")
    expect(runtimeFailedSource).toContain("applyRemoteSessionRuntimeMessageResult(")
    expect(runtimeFailedSource).toContain('message: `错误：${payload.message || "unknown error"}`')
    expect(runtimeFailedSource).toContain("sessionRuntimeVisibleTerminalAccepted(runtimeResult, \"error\")")
    expect(runtimeFailedSource).not.toContain("appendNotice(")
    expect(bindingMismatchSource).toContain('type: "sessionRun.projection.error"')
    expect(bindingMismatchSource).toContain("stopWorking: true")
    expect(bindingMismatchSource).toContain('sessionRuntimeVisibleScopedErrorAccepted(runtimeResult, "sessionRun.projection.error")')
    expect(bindingMismatchSource).toContain("runtimeResult.model.visible.selectedSessionRunId")
    expect(bindingMismatchSource).toContain("runtimeResult.model.visible.selectedBranchBindingId")
    expect(bindingMismatchSource).not.toContain("appendNotice(")
    expect(bindingMismatchSource).not.toContain("setIsWorking(false)")
    expect(bindingMismatchSource).not.toContain('setCurrentRunSessionId("")')
    expect(bindingMismatchSource).not.toContain("clearPendingBranchInteractions(activeSessionRunId(), selectedBranchBindingId())")
    expect(bindingMismatchSource).not.toContain("setPendingApprovals([])")
    expect(bindingMismatchSource).not.toContain("clearPendingUserInputs()")
  })

  it("keeps chat command inner lifecycle events from mutating SessionRun terminal state", () => {
    const remoteHandlerSource = sourceSection(
      "const handleRemoteEvent =",
      "const handleToggleApproveOption =",
    )

    expect(source).toContain("const isSessionRunVisibleSource =")
    expect(remoteHandlerSource).toContain("const applySessionRunLifecycle = isSessionRunVisibleSource(sourceScope)")
    expect(remoteHandlerSource).toContain('type === "events_lost" && applySessionRunLifecycle')
    expect(remoteHandlerSource).toContain('type === "session_run_start" && applySessionRunLifecycle')
    expect(remoteHandlerSource).toContain('type === "remote_peer_ready" && applySessionRunLifecycle')
    expect(remoteHandlerSource).toContain('type === "provider_stream_interrupted" && applySessionRunLifecycle')
    expect(remoteHandlerSource).toContain('type === "provider_stream_recovering" && applySessionRunLifecycle')
    expect(remoteHandlerSource).toContain('type === "provider_stream_recovered" && applySessionRunLifecycle')
    expect(remoteHandlerSource).toContain('type === "session_run_recovery_start" && applySessionRunLifecycle')
    expect(remoteHandlerSource).toContain('type === "session_run_interrupted" && applySessionRunLifecycle')
    expect(remoteHandlerSource).toContain('type === "session_run_cancel_requested" && applySessionRunLifecycle')
    expect(remoteHandlerSource).toContain('type === "session_run_cancelled" && applySessionRunLifecycle')
    expect(remoteHandlerSource).toContain('type === "error" && applySessionRunLifecycle')
    expect(remoteHandlerSource).toContain('type === "session_run_failed" && applySessionRunLifecycle')
    expect(remoteHandlerSource).toContain('type === "session_run_end" && applySessionRunLifecycle')
    expect(remoteHandlerSource).toContain("applyRemoteSessionRuntimeMessage(")
    expect(remoteHandlerSource).toContain("reduceRemoteSessionRuntimeMessage(")
    expect(remoteHandlerSource).not.toContain("applyScopedRunningState(")
    expect(remoteHandlerSource).not.toContain("applyScopedStoppingState(")
    expect(remoteHandlerSource).not.toContain("applyScopedErrorState(")
    expect(remoteHandlerSource).not.toContain("applyScopedTerminalState(")
    expect(remoteHandlerSource).not.toContain("finishSessionRun(")
    expect(remoteHandlerSource).not.toContain("trace.patchStats({ runStatus")
    expect(remoteHandlerSource).not.toContain("trace.replaceCurrentTurns")
    expect(remoteHandlerSource).not.toContain("setSelectedBranchBindingId(")
  })

  it("renders optional boolean MCP user input as an explicit omit false true control", () => {
    expect(source).toContain("userInputBooleanAllowsOmit(input, field)")
    expect(source).toContain("userInputBooleanSelectedKey(input, field, draft())")
    expect(source).toContain('<option value="">未填写</option>')
    expect(source).toContain('<option value="false">否</option>')
    expect(source).toContain('<option value="true">是</option>')
  })

  it("guards slash command dispatch during active runs with command metadata", () => {
    expect(source).toContain("findChatCommandByText(chatCommandCatalog(), text)")
    expect(source).toContain("isWorking() && !command?.availableDuringRun")
    expect(source).toContain("当前运行中不能执行该指令")
  })

  it("routes slash command results through request-scoped command messages", () => {
    const dispatchSource = sourceSection(
      "const dispatchChatCommand =",
      "const handleSend =",
    )
    const commandEventsSource = sourceSection(
      'if (msg.type === "chat.command.events" && Array.isArray(msg.events)) {',
      'if (msg.type === "chat.command.done")',
    )
    const commandDoneSource = sourceSection(
      'if (msg.type === "chat.command.done")',
      'if (msg.type === "chat.command.error")',
    )
    const commandErrorSource = sourceSection(
      'if (msg.type === "chat.command.error")',
      'if (msg.type === "sessionRun.done")',
    )

    expect(dispatchSource).toContain("beginChatCommandRequest({")
    expect(dispatchSource).toContain("const commandRunsAlongsideSessionRun = isWorking() && command?.availableDuringRun")
    expect(dispatchSource).toContain('mode: commandRunsAlongsideSessionRun ? "alongside-session-run" : "standalone"')
    expect(dispatchSource).not.toContain("setActiveSessionRunId(undefined)")
    expect(commandEventsSource).toContain("if (!shouldApplyChatCommandMessage(requestId)) return")
    expect(commandDoneSource).toContain("if (!shouldApplyChatCommandMessage(requestId)) return")
    expect(commandDoneSource).toContain('completeChatCommandRequest(requestId, "done")')
    expect(commandDoneSource).not.toContain("finishSessionRun(")
    expect(commandErrorSource).toContain("if (!shouldApplyChatCommandMessage(requestId)) return")
    expect(commandErrorSource).toContain('completeChatCommandRequest(requestId, "error")')
    expect(commandErrorSource).toContain('appendNotice("error", `指令失败：${typeof msg.message === "string" ? msg.message : "unknown error"}`, "command-error")')
    expect(commandErrorSource).not.toContain("finishSessionRun(")
    expect(commandErrorSource).not.toContain("setEnvironmentRunQueue([])")
    expect(commandErrorSource).not.toContain('trace.patchStats({ runStatus: "error" })')
  })

  it("keeps chat command events from rebinding SessionRun identity", () => {
    const sessionEventsSource = sourceSection(
      'if (msg.type === "sessionRun.events" && Array.isArray(msg.events)) {',
      'if (msg.type === "sessionRun.stream" && Array.isArray(msg.events))',
    )
    const commandEventsSource = sourceSection(
      'if (msg.type === "chat.command.events" && Array.isArray(msg.events)) {',
      'if (msg.type === "chat.command.done")',
    )

    expect(source).toContain('type RemoteEventSourceScope = "session-run-visible" | "chat-command"')
    expect(source).toContain("const remoteEventSessionRunId =")
    expect(source).toContain('if (sourceScope !== "session-run-visible") return ""')
    expect(source).toContain("const remoteEventScopeProof =")
    expect(source).toContain("if (!sessionRunId || !branchBindingId) return undefined")
    expect(source).toContain("const sessionRunId = remoteEventSessionRunId(event, payload, sourceScope)")
    expect(source).toContain("const branchBindingId = remoteEventBranchBindingId(event, payload, sourceScope)")
    expect(source).not.toContain("remoteEventSessionRunId(event, payload, sourceScope) ||")
    expect(source).not.toContain("sourceScope === \"session-run-visible\" ? activeSessionRunId()")
    expect(source).not.toContain("applyRemoteEventSessionRunIdentity")
    expect(sessionEventsSource).toContain("handleRemoteEvent(")
    expect(sessionEventsSource).toContain('"session-run-visible"')
    expect(commandEventsSource).toContain('handleRemoteEvent(event as Record<string, unknown>, "chat-command")')
    expect(commandEventsSource).not.toContain('handleRemoteEvent(event as Record<string, unknown>)')
  })

  it("routes environment run completion through request-scoped environment lifecycle", () => {
    const startSource = sourceSection(
      "const startEnvironmentQueueItem =",
      "const startNextEnvironmentQueueItem =",
    )
    const completedSource = sourceSection(
      'if (msg.type === "environment.run.completed") {',
      'if (msg.type === "sessionRun.cancelled")',
    )
    const errorSource = sourceSection(
      'if (msg.type === "environment.run.error") {',
      'if (msg.type === "sessionRun.projection.error")',
    )

    expect(source).toContain("const shouldApplyEnvironmentRunMessage =")
    expect(startSource).toContain("beginEnvironmentRunRequest(item.requestId)")
    expect(startSource).toContain("requestId: item.requestId")
    expect(completedSource).toContain("const requestId = stringValue(msg.requestId) || stringValue(msg.request_id)")
    expect(completedSource).toContain("if (!shouldApplyEnvironmentRunMessage(requestId)) return")
    expect(completedSource).toContain('completeEnvironmentRunRequest(requestId, "done", { startNextEnvironment: true })')
    expect(completedSource).not.toContain("finishSessionRun(")
    expect(errorSource).toContain("const requestId = stringValue(msg.requestId) || stringValue(msg.request_id)")
    expect(errorSource).toContain("if (!shouldApplyEnvironmentRunMessage(requestId)) return")
    expect(errorSource).toContain('completeEnvironmentRunRequest(requestId, "error")')
    expect(errorSource).not.toContain("finishSessionRun(")
  })

  it("queues running-session input for the next turn without using follow-up", () => {
    const handleSendStart = source.indexOf("const handleSend =")
    const handleSubmitStart = source.indexOf("const canSubmitComposerAction =", handleSendStart)
    const handleSendSource = source.slice(handleSendStart, handleSubmitStart)

    expect(handleSendSource).toContain("const disposition = currentSubmitDisposition(Boolean(rawText.trim()))")
    expect(handleSendSource).toContain('if (disposition.kind === "queue_next_turn")')
    expect(handleSendSource).toContain("sendRunningChatText(rawText, submission.mentions)")
    expect(handleSendSource).toContain('if (disposition.kind === "blocked")')
    expect(handleSendSource).toContain("setComposerSubmitError(sessionSubmitBlockedMessage(disposition.reason))")
    expect(handleSendSource).not.toContain("chat-busy-without-active-session-run")
    expect(handleSendSource).not.toContain("appendNotice(")
    expect(handleSendSource).toContain('if (disposition.kind === "disabled") return')
    expect(source).toContain('<div class="composer-submit-error" role="alert">{composerSubmitError()}</div>')
    expect(source).toContain("chatMessages.queuePendingNextTurn(vscode")
    expect(source).toContain("const sessionRunId = activeSessionRunId()")
    expect(source).toContain("if (!sessionRunId) return")
    expect(source).toContain("sessionRunId,")
    expect(source).toContain("branchBindingId: selectedBranchBindingId()")
    expect(source).toContain("resolveSessionSubmitDisposition")
    expect(handleSendSource).not.toContain("if (isWorking() && activeSessionRunId())")
    const runningSendIndex = handleSendSource.indexOf("sendRunningChatText(rawText")
    const chatSendIndex = handleSendSource.indexOf("sendChatText(rawText")
    expect(chatSendIndex).toBeGreaterThan(runningSendIndex)
    expect(handleSendSource.slice(runningSendIndex, chatSendIndex)).toContain("return")
    expect(source).not.toContain("resolvePromptQueueAfterChat")
    expect(source).not.toContain("chatMessages.followUp(vscode")
  })

  it("treats first-run creation as a submit-blocking in-flight state", () => {
    const dispositionSource = sourceSection(
      "const visibleIsWorking =",
      "const visiblePendingApprovals =",
    )

    expect(dispositionSource).toContain("const sessionRunStartInFlight = () =>")
    expect(dispositionSource).toContain("isWorking() && !activeSessionRunId() && Boolean(currentRunSessionId())")
    expect(dispositionSource).toContain("startInFlight: sessionRunStartInFlight()")
  })

  it("routes stop through the bottom composer primary action instead of the task header", () => {
    const dispositionSource = sourceSection(
      "const visibleIsWorking =",
      "const visiblePendingApprovals =",
    )
    const taskHeaderSource = sourceSection(
      "<TaskHeader",
      "<RunStatusBar",
    )
    const promptInputSource = sourceSection(
      "<PromptInput",
      "<div class=\"chat-footer-target\">",
    )

    expect(dispositionSource).toContain("const composerStopAvailable = () =>")
    expect(dispositionSource).toContain('currentRunSessionMatches() && (visibleIsWorking() || sessionRunStatus() === "stopping")')
    expect(dispositionSource).toContain("const composerStopDisabled = () => sessionRunStatus() === \"stopping\"")
    expect(promptInputSource).toContain("stopAvailable={composerStopAvailable()}")
    expect(promptInputSource).toContain("stopDisabled={composerStopDisabled()}")
    expect(promptInputSource).toContain("onStop={chatController.runtime.handleStop}")
    expect(taskHeaderSource).toContain("closeDisabled={sessionRunStartInFlight()}")
    expect(taskHeaderSource).toContain("onClose={chatController.runtime.handleCloseMainlineAndStartNewTask}")
    expect(taskHeaderSource).not.toContain("onStop=")
    expect(taskHeaderSource).not.toContain("onClose={chatController.runtime.handleStop}")
    expect(taskHeaderSource).not.toContain("onClose={chatController.runtime.clearCurrentSession}")
  })

  it("routes explicit task close through close-mainline instead of stop-current-activation", () => {
    const closeSource = sourceSection(
      "const handleCloseMainlineAndStartNewTask =",
      "const recoverInterruptedChat =",
    )
    const clearSource = sourceSection(
      "const clearCurrentSession =",
      "createEffect(() => {",
    )

    expect(closeSource).toContain("if (sessionRunStartInFlight()) return")
    expect(closeSource).toContain("createSessionRunOperationId(\"cancel\")")
    expect(closeSource).toContain("kind: \"cancel\"")
    expect(closeSource).toContain("chatMessages.cancel(vscode")
    expect(closeSource).toContain("reason: \"explicit_close\"")
    expect(closeSource).toContain("clearCurrentSession()")
    expect(closeSource).not.toContain("chatMessages.stop")
    expect(clearSource).toContain("setSessionRuntimeModel(emptySessionRuntimeModelView())")
    expect(clearSource).toContain("setActiveSessionRunId(undefined)")
    expect(clearSource).toContain("setCurrentRunSessionId(\"\")")
    expect(clearSource).toContain("setSelectedMainlineFacts(initialSelectedMainlineFacts())")
    expect(clearSource).toContain("setServerEventStreamState(initialServerEventStreamState())")
  })

  it("preserves composer text when submit disposition is blocked or disabled", () => {
    const handleSendSource = sourceSection(
      "const handleSend =",
      "const canSubmitComposerAction =",
    )
    const handlePromptSubmitSource = sourceSection(
      "const handlePromptSubmit =",
      "const handleCommandSelect =",
    )

    expect(handleSendSource).toContain("if (!rawText.trim()) return false")
    expect(handleSendSource).toContain("setComposerSubmitError(sessionSubmitBlockedMessage(disposition.reason))")
    expect(handleSendSource).not.toContain("chat-start-pending")
    expect(handleSendSource).not.toContain("appendNotice(")
    expect(handleSendSource).toContain('if (disposition.kind === "disabled") return false')
    expect(handlePromptSubmitSource).toContain("return handleSend(submission)")
    expect(handlePromptSubmitSource).not.toContain("handleSend(submission)\n    return true")
  })

  it("distinguishes first-run start from selected-branch continue before posting chat.send", () => {
    const sendChatStart = source.indexOf("const sendChatText =")
    const sendRunningStart = source.indexOf("const sendRunningChatText =", sendChatStart)
    const sendChatSource = source.slice(sendChatStart, sendRunningStart)

    expect(sendChatSource).toContain('operationKind?: Extract<SessionRunOperationViewKind, "start" | "continue">')
    expect(sendChatSource).toContain('options.operationKind || (activeSessionRunId() ? "continue" : "start")')
    expect(source).toContain("sendChatText(rawText, { mentions: submission.mentions, operationKind: disposition.kind })")
    expect(sendChatSource).toContain('operationKind === "continue"')
    expect(sendChatSource).toContain("selectedBranchBindingId()")
    expect(sendChatSource).not.toContain("selectedBranchBindingId() || \"main\"")
    expect(sendChatSource).toContain("sessionRunStartTargetBranchBindingId(selectedBranchBindingId())")
    expect(sendChatSource).toContain("kind: operationKind")
    expect(sendChatSource).toContain("sessionRunId: operationKind === \"continue\" ? activeSessionRunId() : undefined")
    expect(sendChatSource).toContain("sourceBranchBindingId: operationKind === \"continue\" ? targetBranchBindingId : undefined")
    expect(sendChatSource).toContain("operationKind,")
    expect(sendChatSource).toContain("resetLocalDraftBranchProjection(targetBranchBindingId)")
    expect(source).not.toContain("applyVisibleBranchBinding(")
    expect(source).not.toContain("applyVisibleBranchBindingToView(sessionRuntimeViewTarget()")
    expect(sendChatSource).not.toContain("const targetBranchBindingId = activeSessionRunId() ? selectedBranchBindingId() : \"main\"")
  })

  it("uses server event-stream connecting state for ordinary server-owned sends", () => {
    const sendChatStart = source.indexOf("const sendChatText =")
    const sendRunningStart = source.indexOf("const sendRunningChatText =", sendChatStart)
    const sendChatSource = source.slice(sendChatStart, sendRunningStart)
    const branchComposeStart = source.indexOf("const startAgentRunBranchFromCompose =")
    const pendingUserInputStart = source.indexOf("const pendingUserInputContent =", branchComposeStart)
    const branchComposeSource = source.slice(branchComposeStart, pendingUserInputStart)

    expect(sendChatSource).toContain("setRunPeerState(initialRunPeerState())")
    expect(sendChatSource).toContain("setServerEventStreamState(remoteSessionId")
    expect(sendChatSource).toContain("serverEventStreamConnectingState({")
    expect(sendChatSource).not.toContain('setRunPeerState(remoteSessionId ? { status: "connecting"')
    expect(branchComposeSource).toContain("setRunPeerState(initialRunPeerState())")
    expect(branchComposeSource).toContain("setServerEventStreamState(serverEventStreamConnectingState({")
    expect(branchComposeSource).not.toContain('setRunPeerState({ status: "connecting"')
  })

  it("does not start server event stream from ordinary session load messages", () => {
    const sessionMessageStart = source.indexOf('msg.type === "session.loaded"')
    const sessionErrorStart = source.indexOf('if (msg.type === "session.error")', sessionMessageStart)
    const sessionMessageSource = source.slice(sessionMessageStart, sessionErrorStart)

    expect(sessionMessageSource).toContain('msg.type === "session.state"')
    expect(sessionMessageSource).not.toContain("serverEventStreamConnectingState")
    expect(sessionMessageSource).not.toContain("setServerEventStreamState(")
  })

  it("routes pending prompt remove and clear actions through the Host queue", () => {
    const removeStart = source.indexOf("const removePendingPrompt =")
    const modelUnavailableStart = source.indexOf("const handleModelUnavailable =", removeStart)
    const pendingActionsSource = source.slice(removeStart, modelUnavailableStart)

    expect(pendingActionsSource).toContain("chatMessages.removePendingNextTurn(vscode")
    expect(pendingActionsSource).toContain("chatMessages.clearPendingNextTurns(vscode")
    expect(source).toContain('msg.type === "sessionRun.pendingNextTurns"')
    expect(source).toContain("promptQueueStateFromPendingNextTurns(")
  })

  it("routes history edit and branch actions through AgentRun branch compose, not Session fork execution", () => {
    const requestBranchStart = source.indexOf("const requestAgentRunBranchCompose =")
    const editStart = source.indexOf("const editMessageAndBranch =", requestBranchStart)
    const branchComposeSource = source.slice(requestBranchStart, editStart)
    const anchorStart = source.indexOf("const sessionItemIdForHistoryIndex =")
    const prefixStart = source.indexOf("const branchPrefixTurns =", anchorStart)
    const anchorSource = source.slice(anchorStart, prefixStart)
    const startBranchStart = source.indexOf("const startAgentRunBranchFromCompose =")
    const pendingInputStart = source.indexOf("const pendingUserInputContent =", startBranchStart)
    const startBranchSource = source.slice(startBranchStart, pendingInputStart)

    expect(anchorSource).toContain("ROOT_BRANCH_BASE_SESSION_ITEM_ID")
    expect(branchComposeSource).toContain("baseSessionItemId")
    expect(branchComposeSource).toContain("setBranchCompose({")
    expect(branchComposeSource).not.toContain("session.fork")
    expect(branchComposeSource).not.toContain("chatMessages.fork")
    expect(startBranchSource).toContain("const branchCreateOptimisticProjection = {")
    expect(startBranchSource).toContain("optimisticProjection: branchCreateOptimisticProjection")
    expect(startBranchSource).not.toContain("applyVisibleBranchProjection(")
    expect(startBranchSource).toContain("chatMessages.branch(vscode")
    expect(startBranchSource).toContain("const sessionRunId = activeSessionRunId()")
    expect(startBranchSource).toContain("if (!sessionRunId) return")
    expect(startBranchSource).toContain("sessionRunId,")
    expect(startBranchSource).toContain("baseSessionItemId: compose.baseSessionItemId")
    expect(startBranchSource).toContain("sourceBranchBindingId")
    expect(startBranchSource).not.toContain("session.fork")
  })

  it("captures branch create optimistic UI rollback before replacing the visible transcript", () => {
    const startBranchStart = source.indexOf("const startAgentRunBranchFromCompose =")
    const pendingInputStart = source.indexOf("const pendingUserInputContent =", startBranchStart)
    const startBranchSource = source.slice(startBranchStart, pendingInputStart)

    expect(startBranchSource).toContain("const sourceBranchBindingId = selectedBranchBindingId()")
    expect(startBranchSource).toContain("const sessionRunId = activeSessionRunId()")
    expect(startBranchSource).toContain("if (!sessionRunId) return")
    expect(startBranchSource).toContain("sessionRunId,")
    expect(startBranchSource).toContain("const branchCreateRollback = {")
    expect(startBranchSource).toContain('kind: "branch.create.optimistic-ui"')
    expect(startBranchSource).toContain("sourceBranchBindingId")
    expect(startBranchSource).toContain("turns: trace.turns()")
    expect(startBranchSource).toContain("stats: trace.stats()")
    expect(startBranchSource).toContain("rollback: branchCreateRollback")
    expect(startBranchSource).toContain("optimisticProjection: branchCreateOptimisticProjection")
    expect(startBranchSource.indexOf("const branchCreateRollback = {")).toBeLessThan(
      startBranchSource.indexOf("beginSessionRunOperationView({")
    )
    expect(startBranchSource.indexOf("const branchCreateOptimisticProjection = {")).toBeLessThan(
      startBranchSource.indexOf("beginSessionRunOperationView({")
    )
  })

  it("switches selected AgentRun branch through branch binding projection", () => {
    const selectBranchStart = source.indexOf("const selectBranch =")
    const sendChatStart = source.indexOf("const sendChatText =", selectBranchStart)
    const selectBranchSource = source.slice(selectBranchStart, sendChatStart)
    const selectedHandlerStart = source.indexOf('if (msg.type === "sessionRun.branch.selected")')
    const adoptedHandlerStart = source.indexOf('if (msg.type === "session.adopted"', selectedHandlerStart)
    const selectedHandlerSource = source.slice(selectedHandlerStart, adoptedHandlerStart)

    expect(selectBranchSource).toContain("chatMessages.selectBranch(vscode")
    expect(selectBranchSource).toContain('const operationId = createSessionRunOperationId("branch.select")')
    expect(selectBranchSource).toContain("const sourceBranchBindingId = selectedBranchBindingId()")
    expect(selectBranchSource).toContain("beginSessionRunOperationView({")
    expect(selectBranchSource).toContain("const sessionRunId = activeSessionRunId()")
    expect(selectBranchSource).toContain("if (!sessionRunId) return")
    expect(selectBranchSource).toContain("sessionRunId,")
    expect(selectBranchSource).toContain("sourceBranchBindingId")
    expect(selectBranchSource).toContain("targetBranchBindingId: normalized")
    expect(selectBranchSource).toContain("chatMessages.selectBranch(vscode")
    expect(selectBranchSource).toContain("sessionRunId,")
    expect(selectBranchSource).toContain("branchBindingId: normalized")
    expect(selectBranchSource).toContain("operationId")
    expect(selectBranchSource.indexOf("beginSessionRunOperationView({")).toBeLessThan(
      selectBranchSource.indexOf("chatMessages.selectBranch(vscode")
    )
    expect(selectedHandlerSource).toContain("normalizeBranchSummaries")
    expect(selectedHandlerSource).toContain("if (!applySessionRuntimeScopeSelection(sessionRunId, branchBindingId, nextStatus, {")
    expect(selectedHandlerSource).toContain("clearPendingNextTurns: true")
    expect(selectedHandlerSource).toContain("...(sessionId ? { sessionId } : {})")
    expect(selectedHandlerSource).not.toContain("applyVisibleBranchProjection(branchBindingId, [], { runStatus: nextStatus })")
    expect(selectedHandlerSource).toContain("applySessionRuntimeBranchSummaries(sessionRunId, branches)")
    expect(selectedHandlerSource).not.toContain("setBranchSummaries(branches)")
    expect(selectedHandlerSource).not.toContain("setQueuedPrompts(clearPromptQueue())")
    expect(selectedHandlerSource).not.toContain("clearQueuedPrompts()")
    expect(source).toContain('if (msg.type === "sessionRun.branches")')
    expect(source).toContain("branchSummaries={branchSummaries()}")
    expect(source).toContain("onSelectBranch={selectBranch}")
  })

  it("gates continued operation results before mutating working state", () => {
    const continuedSource = sourceSection(
      'if (msg.type === "sessionRun.continued") {',
      'if (msg.type === "sessionRun.reconnecting")',
    )

    expect(continuedSource).toContain("const operation = sessionRunOperationMessage(msg as Record<string, unknown>)")
    expect(continuedSource).toContain("const hasOperationResult = Boolean(operation.operationId || operation.operationKind)")
    expect(continuedSource).toContain("if (hasOperationResult && !applySessionRuntimeOperationResult(\"sessionRun.operation.success\", operation)) return")
    expect(continuedSource).not.toContain("sessionRunContinuedViewEffect")
    expect(continuedSource).not.toContain("clearSessionRunOperationView(")
    expect(continuedSource).toContain("if (!applySessionRuntimeMessage({")
    expect(continuedSource.indexOf("if (hasOperationResult && !applySessionRuntimeOperationResult(\"sessionRun.operation.success\", operation)) return")).toBeLessThan(
      continuedSource.indexOf("if (!applySessionRuntimeMessage({")
    )
  })

  it("gates recover resume operation results before mutating visible run state", () => {
    const resumeSource = sourceSection(
      'if (msg.type === "sessionRun.resume" && typeof msg.payload === "object" && msg.payload) {',
      'if (msg.type === "sessionRun.operation.pending")',
    )

    expect(resumeSource).toContain("const operation = sessionRunOperationMessage({ ...payload, ...msg } as Record<string, unknown>)")
    expect(resumeSource).toContain("if (operation.operationId) {")
    expect(resumeSource).toContain("if (!applySessionRuntimeOperationResult(\"sessionRun.operation.success\", operation)) return")
    expect(resumeSource).toContain("branchBindingId = sessionRunOperationResultTargetBranchBindingId(operation)")
    expect(resumeSource).toContain('acceptSessionRuntimeMessage({')
    expect(resumeSource).toContain('type: "sessionRun.events"')
    expect(resumeSource).toContain("const resumeFacts = sessionRunResumeFacts(payload)")
    expect(resumeSource).toContain("const resumeStatus = sessionRunResumeRuntimeStatus(payload)")
    expect(resumeSource).toContain("const resumeCanStartEventStream = sessionRunResumeCanStartEventStream(resumeFacts, resumeStatus)")
    expect(resumeSource).toContain("if (!sessionRunResumePreservesSelectedMainline(resumeFacts))")
    expect(resumeSource).toContain("applyNonRecoverableSessionRunResume()")
    expect(resumeSource).toContain("setSelectedMainlineFacts({")
    expect(resumeSource).toContain("if (!applySessionRuntimeScopeSelection(sessionRunId, branchBindingId, resumeStatus, {")
    expect(resumeSource).toContain("...(sessionId ? { sessionId } : {})")
    expect(resumeSource).not.toContain("acceptVisibleSessionRuntimeMessage(")
    expect(resumeSource).not.toContain("applyVisibleBranchBinding(")
    expect(resumeSource).not.toContain("clearSessionRunOperationView(")
    expect(resumeSource).not.toContain("rawBranchBindingId ||")
    expect(resumeSource.indexOf("if (!applySessionRuntimeOperationResult(\"sessionRun.operation.success\", operation)) return")).toBeLessThan(
      resumeSource.indexOf("if (!applySessionRuntimeScopeSelection(sessionRunId, branchBindingId, resumeStatus, {")
    )
  })

  it("routes bootstrap sessionRun.resume through an explicit restore proof", () => {
    const resumeSource = sourceSection(
      'if (msg.type === "sessionRun.resume" && typeof msg.payload === "object" && msg.payload) {',
      'if (msg.type === "sessionRun.operation.pending")',
    )

    expect(source).not.toContain("shouldApplySessionRunBootstrapRestore")
    expect(resumeSource).toContain("const rawBranchBindingId =")
    expect(resumeSource).toContain("const bootstrapRestore = msg.bootstrapRestore === true || payload.bootstrapRestore === true")
    expect(resumeSource).toContain("Boolean(bootstrapRestore && sessionRunId && rawBranchBindingId)")
    expect(resumeSource).toContain("if (!sessionRunResumePreservesSelectedMainline(resumeFacts))")
    expect(resumeSource).toContain("if (!applySessionRuntimeScopeSelection(sessionRunId, branchBindingId, resumeStatus, {")
    expect(resumeSource).toContain("...(sessionId ? { sessionId } : {})")
    expect(resumeSource).toContain("if (!branchBindingId) return")
    expect(resumeSource).not.toContain("if (sessionRunId) setActiveSessionRunId(sessionRunId)")
    expect(resumeSource).not.toContain("setCurrentRunSessionId(sessionId)")
    expect(resumeSource).not.toContain("if (!context.activeSessionRunId) return true")
  })

  it("uses explicit status protocol facts before accepting sessionRun.resume", () => {
    const factsSource = sourceSection(
      "function sessionRunResumeFacts",
      "function objectValue",
    )

    expect(factsSource).toContain('booleanField(payload, "terminal")')
    expect(factsSource).toContain('stringField(payload, "mainlineState", "mainline_state")')
    expect(factsSource).toContain('stringField(payload, "activationState", "activation_state")')
    expect(factsSource).toContain('stringField(payload, "bindingStatus", "binding_status")')
    expect(factsSource).toContain('booleanField(payload, "working")')
    expect(factsSource).toContain('booleanField(payload, "continuable")')
    expect(factsSource).toContain('booleanField(payload, "recoverable")')
    expect(factsSource).toContain('booleanField(payload, "eventStreamAllowed", "event_stream_allowed")')
    expect(factsSource).toContain('stringField(payload, "projectionState", "projection_state")')
    expect(factsSource).toContain("facts.bindingStatus === \"active\"")
    expect(factsSource).toContain("facts.projectionState === \"live\" || facts.projectionState === \"recovered\"")
    expect(factsSource).toContain("facts.working")
    expect(factsSource).toContain("sessionRunResumeRuntimeStatusIsActive(status)")
  })

  it("keeps selected mainline identity for settled and non-continuable resume states", () => {
    const preserveSource = sourceSection(
      "function sessionRunResumePreservesSelectedMainline",
      "function selectedMainlineFactsFromResumeFacts",
    )

    expect(preserveSource).not.toContain("facts.terminal")
    expect(preserveSource).not.toContain("!facts.recoverable")
    expect(preserveSource).not.toContain('facts.bindingStatus !== "active"')
    expect(preserveSource).toContain('facts.mainlineState === "settled"')
    expect(preserveSource).toContain('facts.mainlineState === "cancelled"')
    expect(preserveSource).toContain('facts.mainlineState === "closed"')
    expect(preserveSource).toContain('facts.mainlineState === "failed"')
    expect(preserveSource).toContain('facts.mainlineState === "unrecoverable"')
  })

  it("uses operation result target proof for sessionRun.session branch identity", () => {
    const sessionSource = sourceSection(
      'if (msg.type === "sessionRun.session" && typeof msg.sessionRunId === "string") {',
      'if (msg.type === "sessionRun.operation.error")',
    )

    expect(sessionSource).toContain("const branchBindingId = sessionRunOperationResultTargetBranchBindingId(operation)")
    expect(sessionSource).toContain('if (!applySessionRuntimeScopeSelection(msg.sessionRunId, branchBindingId, "running", {')
    expect(sessionSource).toContain("...(sessionId ? { sessionId } : {})")
    expect(sessionSource).not.toContain("applyVisibleBranchBinding(")
    expect(sessionSource).not.toContain("selectedBranchBindingId()")
  })

  it("clears matching steer operation results through the SessionRun operation gate", () => {
    const steerSource = sourceSection(
      'if (msg.type === "sessionRun.steer") {',
      'if (msg.type === "sessionRun.continued")',
    )

    expect(steerSource).toContain("const operation = sessionRunOperationMessage(msg as Record<string, unknown>)")
    expect(steerSource).toContain("if (!applySessionRuntimeOperationResult(\"sessionRun.operation.success\", operation)) return")
    expect(steerSource).not.toContain("clearSessionRunOperationView(")
    expect(steerSource).not.toContain('operationKind === "steer"')
  })

  it("starts recover as a tracked SessionRun operation", () => {
    const recoverStart = source.indexOf("const recoverInterruptedChat =")
    const dismissStart = source.indexOf("const dismissInterruptedChat =", recoverStart)
    const recoverSource = source.slice(recoverStart, dismissStart)

    expect(recoverSource).toContain('const operationId = createSessionRunOperationId("recover")')
    expect(recoverSource).toContain("beginSessionRunOperationView({")
    expect(recoverSource).toContain('kind: "recover"')
    expect(recoverSource).toContain("const targetBranchBindingId = selectedBranchBindingId()")
    expect(recoverSource).not.toContain("selectedBranchBindingId() || \"main\"")
    expect(recoverSource).toContain("targetBranchBindingId,")
    expect(recoverSource).toContain("chatMessages.recover(vscode, {")
    expect(recoverSource).toContain("operationId,")
  })

  it("starts stop as a tracked SessionRun operation", () => {
    const sendStopStart = source.indexOf("const sendStop =")
    const recoverStart = source.indexOf("const recoverInterruptedChat =", sendStopStart)
    const cancelSource = source.slice(sendStopStart, recoverStart)

    expect(cancelSource).toContain('const operationId = createSessionRunOperationId("stop")')
    expect(cancelSource).toContain("beginSessionRunOperationView({")
    expect(cancelSource).toContain('kind: "stop"')
    expect(cancelSource).toContain("targetBranchBindingId")
    expect(cancelSource).toContain("chatMessages.stop(vscode, {")
    expect(cancelSource).toContain("operationId,")
  })

  it("does not enter stopping or clear pending stop unless stop operation begins", () => {
    const handleStopSource = sourceSection(
      "const handleStop = () => {",
      "const sendStop =",
    )
    const sendStopSource = sourceSection(
      "const sendStop =",
      "const recoverInterruptedChat =",
    )
    const liveEventSource = sourceSection(
      "const handleLiveStreamEvent =",
      "const handleRemoteEvent =",
    )
    const visibleIdentitySource = sourceSection(
      "const applyVisibleSessionRunIdentity =",
      "const sessionRuntimeViewTarget =",
    )
    const remoteEventSource = sourceSection(
      "const handleRemoteEvent =",
      "const sendChatText =",
    )
    const sessionMessageSource = sourceSection(
      'if (msg.type === "sessionRun.session" && typeof msg.sessionRunId === "string") {',
      'if (msg.type === "sessionRun.operation.error")',
    )

    expect(sendStopSource).toContain("): boolean =>")
    expect(handleStopSource).toContain("const restore = sessionRunOperationRestoreSnapshot()")
    expect(handleStopSource).toContain("const stopStarted = sendStop(sessionRunId, { restore })")
    expect(handleStopSource.indexOf("const stopStarted = sendStop(sessionRunId, { restore })")).toBeLessThan(
      handleStopSource.indexOf("applyScopedStoppingState()"),
    )
    expect(handleStopSource).toContain("if (!stopStarted) return")
    expect(source).not.toContain("const applyRemoteEventSessionRunIdentity =")
    expect(visibleIdentitySource).toContain("if (!sessionRunId || !pendingStop()) return")
    expect(visibleIdentitySource).toContain("if (sendStop(sessionRunId, { restore: pendingStopRestore() })) {")
    expect(liveEventSource).not.toContain("applyRemoteEventSessionRunIdentity(event, payload, sourceScope)")
    expect(remoteEventSource).not.toContain("applyRemoteEventSessionRunIdentity(event, payload, sourceScope)")
    expect(sessionMessageSource).not.toContain("sendStop(msg.sessionRunId")
  })

  it("gates cancelled operation results before terminal cleanup", () => {
    const cancelledSource = sourceSection(
      'if (msg.type === "sessionRun.cancelled") {',
      'if (msg.type === "approval.reply.ok")',
    )

    expect(cancelledSource).toContain("const operation = sessionRunOperationMessage(msg as Record<string, unknown>)")
    expect(cancelledSource).toContain("if (operation.operationId) {")
    expect(cancelledSource).toContain("if (!applySessionRuntimeOperationResult(\"sessionRun.operation.success\", operation)) return")
    expect(cancelledSource).not.toContain("clearSessionRunOperationView(")
    expect(cancelledSource).toContain("if (!applySessionRuntimeMessage({")
    expect(cancelledSource).toContain('viewEffect: { kind: "terminal", status: "cancelled" }')
    expect(cancelledSource.indexOf("if (!applySessionRuntimeOperationResult(\"sessionRun.operation.success\", operation)) return")).toBeLessThan(
      cancelledSource.indexOf("if (!applySessionRuntimeMessage({")
    )
  })

  it("restores running state for stop operation errors through the operation effect", () => {
    const operationErrorSource = sourceSection(
      'if (msg.type === "sessionRun.operation.error") {',
      'if (msg.type === "sessionRun.pendingNextTurn")',
    )

    expect(operationErrorSource).toContain("applySessionRuntimeOperationResult(")
    expect(operationErrorSource).not.toContain("if (effect.restore)")
    expect(operationErrorSource).not.toContain("applySessionRunOperationRestore(")
    expect(operationErrorSource).not.toContain("restoreRunningStatus")
    expect(operationErrorSource).not.toContain("applySessionRuntimeMessage({")
    expect(operationErrorSource).not.toContain('viewEffect: { kind: "running" }')
    expect(operationErrorSource).not.toContain('operationKind === "cancel"')
  })

  it("restores capability package runtime state from resumed session runs", () => {
    const resumeStart = source.indexOf('if (msg.type === "sessionRun.resume"')
    const sessionStart = source.indexOf('if (msg.type === "sessionRun.session"', resumeStart)
    const resumeSource = source.slice(resumeStart, sessionStart)

    expect(resumeSource).toContain("sessionRuntimeStateFromMessage(msg as Record<string, unknown>, payload)")
    expect(resumeSource).toContain("setSessionRuntimeState(runtime)")
    expect(resumeSource).toContain("applySessionRuntimeBranchSummaries(sessionRunId, normalizeBranchSummaries(payload.branches))")
    expect(resumeSource).not.toContain("setBranchSummaries(")
  })

  it("preserves raw non-command text so leading-space slash input stays chat text", () => {
    expect(source).toContain("const rawText = submission.text")
    expect(source).toContain("if (!rawText.trim()) return")
    expect(source).toContain("sendChatText(rawText, { mentions: submission.mentions, operationKind: disposition.kind })")
  })

  it("keeps workspace mention search responses tied to the latest request", () => {
    expect(source).toContain('type: "workspace.files.search"')
    expect(source).toContain("setWorkspaceMentionRequest({ id: requestId, query: normalizedQuery })")
    expect(source).toContain("requestId !== activeRequest.id")
  })

  it("creates a local draft session before the first send", () => {
    expect(source).toContain("const shouldCreateLocalDraft = !sessionId")
    expect(source).toContain("draftSessionId = trace.startDraftTask(text, createUserTurn(text))")
    expect(source).toContain("sessionId = draftSessionId")
    expect(source).toContain("setCurrentRunSessionId(sessionId || \"\")")
    expect(source).toContain("draftSessionId,")
    expect(source).toContain("function createUserTurn")
    expect(source).toContain("isLocalDraftSessionId(currentRunSessionId())")
    expect(source).toContain("setCurrentRunSessionId(msg.sessionId)")
  })

  it("validates the selected model before creating a local draft turn", () => {
    const sendIndex = source.indexOf("const sendChatText = (")
    const modelIndex = source.indexOf("const activeModelResolution = requiredModelSelection()", sendIndex)
    const failureIndex = source.indexOf("if (!activeModelResolution.ok || !activeModelResolution.model)", modelIndex)
    const draftIndex = source.indexOf("draftSessionId = trace.startDraftTask(text, createUserTurn(text))", sendIndex)

    expect(modelIndex).toBeGreaterThan(sendIndex)
    expect(failureIndex).toBeGreaterThan(modelIndex)
    expect(failureIndex).toBeLessThan(draftIndex)
  })

  it("does not append empty structured view cards", () => {
    expect(source).toContain("function hasMeaningfulPayload")
    expect(source).toContain("if (!hasMeaningfulPayload(viewPayload)) return")
  })

  it("routes only explicit local-action peer readiness into the run status bar instead of transcript cards", () => {
    const branchIndex = source.indexOf('} else if (type === "remote_peer_ready" && applySessionRunLifecycle) {')

    expect(source).toContain("const hasLocalActionProof = remotePeerReadyHasLocalActionProof(payload)")
    expect(source).toContain("if (hasLocalActionProof) {")
    expect(source).toContain("setRunPeerState(runPeerStateFromReady(payload))")
    expect(source).toContain("serverEventStreamState")
    expect(source).toContain("<RunStatusBar")
    expect(source).not.toContain("appendRemoteStatusPart")
    expect(source).not.toContain('type: "remote_status"')
    expect(branchIndex).toBeGreaterThan(0)
  })

  it("shows recoverable session load states for loading, auth, not-found, and failed loads", () => {
    expect(source).toContain("const [sessionLoadState, setSessionLoadState]")
    expect(source).toContain("sessionLoadMessage")
    expect(source).toContain("sessionLoadTitle")
    expect(source).toContain("class=\"settings-empty-state session-load-state\"")
    expect(source).toContain('status: "loading", sessionId')
    expect(source).toContain('return "auth-required"')
    expect(source).toContain('return "not-found"')
    expect(source).toContain('return "error"')
    expect(source).toContain('msg.type === "session.error"')
  })

  it("clears failed session-load selection without clearing the active conversation", () => {
    const clearFailedStart = source.indexOf("const clearFailedSessionSelection =")
    const nextEffectStart = source.indexOf("createEffect", clearFailedStart)
    const clearFailedSource = source.slice(clearFailedStart, nextEffectStart)

    expect(clearFailedSource).toContain("clearSessionLoadState()")
    expect(clearFailedSource).toContain('setSessionOperationError("")')
    expect(clearFailedSource).not.toContain("clearCurrentSession()")
    expect(clearFailedSource).not.toContain("trace.clearSession()")
  })

  it("keeps REMOTE PEER READY TUI out of chat transcript and out of status state", () => {
    expect(source).toContain("function isRunPeerReadyTui")
    expect(source).toContain('=== "REMOTE PEER READY"')
    expect(source).toContain("if (isRunPeerReadyTui(clean)) return")
    expect(source).not.toContain("parseTerminalTuiCards")
  })

  it("routes agent queue runtime status into AgentRun state without notice cards", () => {
    expect(source).toContain('action.kind === "agent_run_status"')
    expect(source).toContain("setAgentRunState(action.state)")
    expect(source).not.toContain("runtime-agent-queue-chat")
    expect(source).not.toContain("runtime-agent-queue-delegated-run")
  })

  it("does not append runtime status fallback view cards to the chat transcript", () => {
    const runtimeStatusStart = source.indexOf("const applyRuntimeStatusEvent")
    const usageUpdateStart = source.indexOf("const applyUsageUpdate", runtimeStatusStart)
    const runtimeStatusSource = source.slice(runtimeStatusStart, usageUpdateStart)

    expect(runtimeStatusSource).toContain('action.kind === "ignore"')
    expect(runtimeStatusSource).not.toContain("appendViewPart(payload")
  })
})
