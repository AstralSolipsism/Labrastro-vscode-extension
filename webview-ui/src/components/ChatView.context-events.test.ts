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
    expect(source).toContain("const pendingLiveEventKeys = new Set<string>()")
    expect(source).toContain("scheduleLiveTranscriptFlush()")
    expect(source).toContain("trace.applySessionRunTranscriptEventsToSession(")
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
    expect(liveHandlerSource).toContain("const liveEvent = createLiveTranscriptEvent(event, payload, eventMeta)")
    expect(liveHandlerSource).toContain("markPendingLiveEvent(eventMeta)")
    expect(liveHandlerSource).toContain("liveTranscriptEvents.push(liveEvent)")
    const bufferedBranch = liveHandlerSource.slice(
      liveHandlerSource.indexOf("if (liveEvent) {"),
      liveHandlerSource.indexOf("if (applyTranscriptReducer(event, type))")
    )
    expect(bufferedBranch).not.toContain("markRenderedEvent(eventMeta)")
    expect(liveHandlerSource.indexOf("upsertAssistantStream(String(payload.content || \"\"), eventMeta)")).toBeLessThan(
      liveHandlerSource.indexOf("const liveEvent = createLiveTranscriptEvent(event, payload, eventMeta)")
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
    const sendCancelStart = source.indexOf("const sendCancel =", remoteHandlerStart)
    const remoteHandlerSource = source.slice(remoteHandlerStart, sendCancelStart)

    expect(reducerSource).toContain("if (!isSessionRunTranscriptEventType(type)) return false")
    expect(reducerSource).toContain("trace.applySessionRunTranscriptEvent(event")
    expect(remoteHandlerSource).toContain("const canonicalTranscriptEvent = isSessionRunTranscriptEventType(type)")
    expect(remoteHandlerSource).toContain("applyTranscriptReducer(event, type, {")
    expect(remoteHandlerSource).toContain("if (!canonicalTranscriptEvent && shouldArchiveActiveStreamBeforeEvent")
    expect(remoteHandlerSource).toContain("if (!canonicalTranscriptEvent && prompt")
    expect(remoteHandlerSource).toContain("if (!canonicalTranscriptEvent && payload.response")
  })

  it("commits streaming overlay before structural session-run events", () => {
    const remoteHandlerStart = source.indexOf("const handleRemoteEvent =")
    const sendCancelStart = source.indexOf("const sendCancel =", remoteHandlerStart)
    const remoteHandlerSource = source.slice(remoteHandlerStart, sendCancelStart)

    expect(source).toContain("const flushLiveTranscriptEvents =")
    expect(source).toContain('if (msg.type !== "sessionRun.stream")')
    expect(source).toContain("flushLiveTranscriptEvents()")
    expect(source).toContain("archiveActiveTranscriptItems()")
    expect(remoteHandlerSource).toContain("handleLiveStreamEvent(event)")
    expect(remoteHandlerSource).toContain("flushLiveTranscriptEvents()")
    expect(remoteHandlerSource.indexOf("archiveActiveTranscriptItems()")).toBeLessThan(
      remoteHandlerSource.indexOf("const pendingApprovalForEvent")
    )
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
    const runtimeControllerStart = source.indexOf("const sendCancel =", remoteHandlerStart)
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
    expect(source).toContain('if (!canonicalTranscriptEvent && payload.response && payload.response_rendered !== true)')
    expect(source).toContain('streaming: false')
    expect(source).toContain('streamKey: "assistant-message"')
    expect(source).toContain("active: false")
    expect(source).toContain("traceStatusForRunEnd")
  })

  it("keeps session_run_end final payload from duplicating an active assistant stream", () => {
    const branchIndex = source.indexOf('} else if (type === "session_run_end") {')
    const clearIndex = source.indexOf('clearActiveTranscriptItems((part) => part.type === "assistant_text" && part.streamKey === "assistant-stream")', branchIndex)
    const appendIndex = source.indexOf('appendAssistantTextItem(String(payload.response), "final"', branchIndex)
    const finishIndex = source.indexOf("finishSessionRun(doneStatusFromCurrentRun())", branchIndex)
    const guardIndex = source.indexOf("if (!canonicalTranscriptEvent && payload.response", branchIndex)

    expect(guardIndex).toBeGreaterThan(branchIndex)
    expect(clearIndex).toBeGreaterThan(branchIndex)
    expect(clearIndex).toBeLessThan(appendIndex)
    expect(appendIndex).toBeLessThan(finishIndex)
  })

  it("handles only session_run lifecycle event names for recovery and cancellation", () => {
    expect(source).toContain('} else if (type === "session_run_recovery_start") {')
    expect(source).toContain('} else if (type === "session_run_cancel_requested") {')
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

  it("shows reply failure notices only for the selected branch", () => {
    const approvalErrorSource = sourceSection(
      'if (msg.type === "approval.reply.error") {',
      'if (msg.type === "sessionRun.userInput.reply.ok")',
    )
    const userInputErrorSource = sourceSection(
      'if (msg.type === "sessionRun.userInput.reply.error") {',
      'if (msg.type === "environment.run.error" && isWorking())',
    )

    expect(approvalErrorSource).toContain("const visibleBranch = messageTargetsCurrentRun(sessionRunId, branchBindingId)")
    expect(approvalErrorSource).toContain("if (visibleBranch) appendNotice(")
    expect(userInputErrorSource).toContain("const visibleBranch = messageTargetsCurrentRun(sessionRunId, branchBindingId)")
    expect(userInputErrorSource).toContain("if (visibleBranch) appendNotice(")
  })

  it("scopes session run event batches and approval resolution to the selected branch", () => {
    expect(source).toContain('if (msg.type === "sessionRun.events" && Array.isArray(msg.events))')
    expect(source).toContain('if (msg.type === "sessionRun.stream" && Array.isArray(msg.events))')
    expect(source).toContain("if (!messageTargetsCurrentRun(sessionRunId, branchBindingId)) return")
    expect(source).toContain("pendingApprovalMatches(item, { approvalId, sessionRunId, branchBindingId })")
  })

  it("guards branch-scoped webview messages by session run and branch", () => {
    const pendingSource = sourceSection(
      'if (msg.type === "sessionRun.pendingNextTurn") {',
      'if (msg.type === "sessionRun.pendingNextTurns") {',
    )
    const continuedSource = sourceSection(
      'if (msg.type === "sessionRun.continued") {',
      'if (msg.type === "sessionRun.reconnecting")',
    )
    const doneSource = sourceSection(
      'if (msg.type === "sessionRun.done") {',
      'if (msg.type === "environment.run.completed" && isWorking())',
    )

    expect(source).toContain("const messageTargetsCurrentRun =")
    expect(pendingSource).toContain("if (!messageTargetsCurrentRun(sessionRunId, branchBindingId)) return")
    expect(continuedSource).toContain("if (!messageTargetsCurrentRun(sessionRunId, branchBindingId)) return")
    expect(doneSource).toContain("if (!messageTargetsCurrentRun(sessionRunId, branchBindingId)) return")
  })

  it("ignores scoped session run errors for non-selected branches", () => {
    const errorSource = sourceSection(
      'if (msg.type === "sessionRun.error") {',
      "    })",
    )

    expect(errorSource).toContain("const sessionRunId = stringValue(msg.sessionRunId) || stringValue(msg.session_run_id)")
    expect(errorSource).toContain("const branchBindingId = stringValue(msg.branchBindingId) || stringValue(msg.branch_binding_id)")
    expect(errorSource).toContain("if (sessionRunId && activeSessionRunId() && sessionRunId !== activeSessionRunId()) return")
    expect(errorSource).toContain("if (branchBindingId && branchBindingId !== selectedBranchBindingId()) return")
    expect(errorSource.indexOf("if (branchBindingId && branchBindingId !== selectedBranchBindingId()) return")).toBeLessThan(
      errorSource.indexOf('finishSessionRun("error")')
    )
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
    expect(reconnectingSource).toContain("if (!messageTargetsCurrentRun(sessionRunId, branchBindingId)) return")
    expect(reconnectingSource.indexOf("if (!messageTargetsCurrentRun(sessionRunId, branchBindingId)) return")).toBeLessThan(
      reconnectingSource.indexOf("setIsWorking(true)")
    )
    expect(reconnectedSource).toContain("const branchBindingId = stringValue(msg.branchBindingId) || stringValue(msg.branch_binding_id)")
    expect(reconnectedSource).toContain("if (!messageTargetsCurrentRun(sessionRunId, branchBindingId)) return")
    expect(reconnectedSource.indexOf("if (!messageTargetsCurrentRun(sessionRunId, branchBindingId)) return")).toBeLessThan(
      reconnectedSource.indexOf("setIsWorking(true)")
    )
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
    expect(sendApprovalSource).not.toContain("approvedSaveCandidate")
    expect(sendApprovalSource).not.toContain("approved_save_candidate")
  })

  it("routes auto approval through the same recoverable pending approval path", () => {
    expect(source).toContain("setPendingApprovals((items) => upsertPendingApproval(items, pendingApproval))")
    expect(source).toContain('replyApproval(pendingApproval, "allow_once", autoDecision.replyReason)')
    expect(source).toContain('replyApproval(pendingApproval, "deny_once", autoDecision.replyReason)')
  })

  it("routes MCP user input requests through a structured reply path", () => {
    expect(source).toContain('type === "user_input_request"')
    expect(source).toContain("setPendingUserInputs((items) => upsertPendingUserInput(items, userInput))")
    expect(source).toContain('type: "sessionRun.userInput.reply"')
    expect(source).toContain("buildUserInputContent(input, pendingUserInputContent(input))")
    expect(source).toContain("content: contentResult.content")
    expect(source).toContain('type === "user_input_resolved"')
    expect(source).toContain("pendingUserInputMatches(item, { inputId, sessionRunId, branchBindingId })")
    expect(source).toContain('msg.type === "sessionRun.userInput.reply.error"')
  })

  it("restores pending MCP user inputs from session run resume status", () => {
    expect(source).toContain("const statusUserInputs = Array.isArray(payload.user_inputs) ? payload.user_inputs : []")
    expect(source).toContain("if (sessionRunId) {")
    expect(source).toContain("reconcileStatusUserInputs(items, statusUserInputs, sessionRunId, branchBindingId)")
    expect(source).toContain("reconcileStatusUserInputValues(current, statusUserInputs, sessionRunId, branchBindingId)")
  })

  it("scopes pending MCP user input cards to the active session run and clears terminal state", () => {
    expect(source).toContain("visiblePendingUserInputsForRun(pendingUserInputs(), activeSessionRunId(), selectedBranchBindingId())")
    expect(source).toContain("const clearPendingBranchInteractions =")
    expect(source).toContain('String(event.session_run_id || "") || activeSessionRunId()')
  })

  it("clears only the finished session run branch pending state", () => {
    const finishSource = sourceSection(
      "const finishSessionRun =",
      "const resetSessionRunTerminalState =",
    )

    expect(finishSource).toContain("const finishedSessionRunId = activeSessionRunId()")
    expect(finishSource).toContain("const finishedBranchBindingId = selectedBranchBindingId()")
    expect(finishSource).toContain("clearPendingBranchInteractions(finishedSessionRunId, finishedBranchBindingId)")
    expect(finishSource).not.toContain("setPendingApprovals([])")
    expect(finishSource).not.toContain("clearPendingUserInputs()")
  })

  it("does not globally clear branch pending state before terminal event cleanup", () => {
    const cancelledSource = sourceSection(
      '} else if (type === "session_run_cancelled") {',
      '} else if (type === "error") {',
    )
    const bindingMismatchSource = sourceSection(
      'appendNotice("error", `会话绑定异常：远端返回 ${remoteSessionId}，当前会话是 ${currentSessionId}`',
      "markRenderedEvent(eventMeta)",
    )

    expect(cancelledSource).toContain('finishSessionRun("cancelled")')
    expect(cancelledSource).not.toContain("setPendingApprovals([])")
    expect(cancelledSource).not.toContain("clearPendingUserInputs()")
    expect(bindingMismatchSource).toContain("clearPendingBranchInteractions(activeSessionRunId(), selectedBranchBindingId())")
    expect(bindingMismatchSource).not.toContain("setPendingApprovals([])")
    expect(bindingMismatchSource).not.toContain("clearPendingUserInputs()")
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

  it("queues running-session input for the next turn without using follow-up", () => {
    const handleSendStart = source.indexOf("const handleSend =")
    const handleSubmitStart = source.indexOf("const canSubmitComposerAction =", handleSendStart)
    const handleSendSource = source.slice(handleSendStart, handleSubmitStart)

    expect(handleSendSource).toContain("if (isWorking())")
    expect(handleSendSource).toContain("sendRunningChatText(rawText, submission.mentions)")
    expect(source).toContain("branchBindingId: selectedBranchBindingId()")
    const runningSendIndex = handleSendSource.indexOf("sendRunningChatText(rawText")
    const chatSendIndex = handleSendSource.indexOf("sendChatText(rawText")
    expect(chatSendIndex).toBeGreaterThan(runningSendIndex)
    expect(handleSendSource.slice(runningSendIndex, chatSendIndex)).toContain("return")
    expect(source).not.toContain("resolvePromptQueueAfterChat")
    expect(source).not.toContain("chatMessages.followUp(vscode")
  })

  it("keeps existing remote session sends on the selected branch instead of falling back to main", () => {
    const sendChatStart = source.indexOf("const sendChatText =")
    const sendRunningStart = source.indexOf("const sendRunningChatText =", sendChatStart)
    const sendChatSource = source.slice(sendChatStart, sendRunningStart)

    expect(sendChatSource).toContain('const targetBranchBindingId = remoteSessionId ? selectedBranchBindingId() || "main" : "main"')
    expect(sendChatSource).not.toContain("const targetBranchBindingId = activeSessionRunId() ? selectedBranchBindingId() : \"main\"")
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
    expect(startBranchSource).toContain("trace.replaceCurrentTurns([...prefixTurns, createUserTurn(prompt)]")
    expect(startBranchSource).toContain("chatMessages.branch(vscode")
    expect(startBranchSource).toContain("baseSessionItemId: compose.baseSessionItemId")
    expect(startBranchSource).not.toContain("session.fork")
  })

  it("switches selected AgentRun branch through branch binding projection", () => {
    const selectBranchStart = source.indexOf("const selectBranch =")
    const sendChatStart = source.indexOf("const sendChatText =", selectBranchStart)
    const selectBranchSource = source.slice(selectBranchStart, sendChatStart)
    const selectedHandlerStart = source.indexOf('if (msg.type === "sessionRun.branch.selected")')
    const adoptedHandlerStart = source.indexOf('if (msg.type === "session.adopted"', selectedHandlerStart)
    const selectedHandlerSource = source.slice(selectedHandlerStart, adoptedHandlerStart)

    expect(selectBranchSource).toContain("chatMessages.selectBranch(vscode")
    expect(selectedHandlerSource).toContain("normalizeBranchSummaries")
    expect(selectedHandlerSource).toContain("trace.replaceCurrentTurns([], { runStatus: nextStatus })")
    expect(selectedHandlerSource).toContain("setBranchSummaries(branches)")
    expect(selectedHandlerSource).toContain("setQueuedPrompts(clearPromptQueue())")
    expect(selectedHandlerSource).not.toContain("clearQueuedPrompts()")
    expect(source).toContain('if (msg.type === "sessionRun.branches")')
    expect(source).toContain("branchSummaries={branchSummaries()}")
    expect(source).toContain("onSelectBranch={selectBranch}")
  })

  it("restores capability package runtime state from resumed session runs", () => {
    const resumeStart = source.indexOf('if (msg.type === "sessionRun.resume"')
    const sessionStart = source.indexOf('if (msg.type === "sessionRun.session"', resumeStart)
    const resumeSource = source.slice(resumeStart, sessionStart)

    expect(resumeSource).toContain("sessionRuntimeStateFromMessage(msg as Record<string, unknown>, payload)")
    expect(resumeSource).toContain("setSessionRuntimeState(runtime)")
    expect(resumeSource).toContain("setBranchSummaries(normalizeBranchSummaries(payload.branches))")
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

  it("creates a local draft session before the first send", () => {
    expect(source).toContain("const shouldCreateLocalDraft = !sessionId")
    expect(source).toContain("draftSessionId = trace.startDraftTask(text, createUserTurn(text))")
    expect(source).toContain("sessionId = draftSessionId")
    expect(source).toContain("setActiveRunSessionId(sessionId || \"\")")
    expect(source).toContain("draftSessionId,")
    expect(source).toContain("function createUserTurn")
    expect(source).toContain("isLocalDraftSessionId(activeRunSessionId())")
    expect(source).toContain("setActiveRunSessionId(msg.sessionId)")
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

  it("routes run peer readiness into the run status bar instead of transcript cards", () => {
    const branchIndex = source.indexOf('} else if (type === "remote_peer_ready") {')

    expect(source).toContain("setRunPeerState(runPeerStateFromReady(payload))")
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
