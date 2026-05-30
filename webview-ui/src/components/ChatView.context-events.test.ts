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

  it("routes live deltas into the canonical transcript reducer", () => {
    expect(source).toContain('msg.type === "sessionRun.stream"')
    expect(source).toContain("const handleLiveStreamEvent =")
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
    expect(liveHandlerSource).toContain("const liveEvent = createLiveTranscriptEvent(event, payload, eventMeta)")
    expect(liveHandlerSource).toContain("markPendingLiveEvent(eventMeta)")
    expect(liveHandlerSource).toContain("liveTranscriptEvents.push(liveEvent)")
    const bufferedBranch = liveHandlerSource.slice(
      liveHandlerSource.indexOf("if (liveEvent) {"),
      liveHandlerSource.indexOf("if (applyTranscriptReducer(event, type))")
    )
    expect(bufferedBranch).not.toContain("markRenderedEvent(eventMeta)")
    expect(liveHandlerSource).not.toContain("updateThinkingFromReasoning")
    expect(liveHandlerSource).not.toContain("upsertAssistantStream")
    expect(liveHandlerSource).not.toContain("appendToolCallDeltaToToolPart")
    expect(liveHandlerSource).not.toContain("appendToolStreamToToolPart")
    expect(source).toContain("const visibleTurns =")
    expect(source).toContain('format: "markdown"')
    expect(source).toContain('type: "thinking"')
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

  it("flushes buffered live transcript events before structural session-run events", () => {
    const remoteHandlerStart = source.indexOf("const handleRemoteEvent =")
    const sendCancelStart = source.indexOf("const sendCancel =", remoteHandlerStart)
    const remoteHandlerSource = source.slice(remoteHandlerStart, sendCancelStart)

    expect(source).toContain("const flushLiveTranscriptEvents =")
    expect(source).toContain('if (msg.type !== "sessionRun.stream")')
    expect(source).toContain("flushLiveTranscriptEvents()")
    expect(remoteHandlerSource).toContain("handleLiveStreamEvent(event)")
    expect(remoteHandlerSource).toContain("flushLiveTranscriptEvents()")
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

  it("updates an archived reasoning thinking anchor instead of creating another row", () => {
    expect(source).toContain("const updateThinkingFromReasoning =")
    expect(source).toContain("const updateThinkingItem = (part: ThinkingItem): ThinkingItem =>")
    expect(source).toContain("const currentAssistant = currentAssistantMessages()[0]")
    expect(source).toContain("currentAssistant?.parts.some(isReasoningThinkingItem)")
    expect(source).toContain("const index = findLastItemIndex(parts, isReasoningThinkingItem)")
    expect(source).toContain("streamKey: REASONING_STREAM_KEY")
    expect(source).toContain('id: `thinking-${activeSessionRunId() || "pending"}`')
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
    expect(source).toContain("markApprovalSubmitFailed(items, approvalId, message)")
    expect(source).toContain("mergeStatusApprovals(items, statusApprovals, sessionRunId)")
  })

  it("clears pending approvals when approval reply succeeds", () => {
    expect(source).toContain('msg.type === "approval.reply.ok"')
    expect(source).toContain("markApprovalSubmitSucceeded(items, approvalId)")
    expect(source).toContain("setSelectedApproval(undefined)")
  })

  it("routes auto approval through the same recoverable pending approval path", () => {
    expect(source).toContain("setPendingApprovals((items) => upsertPendingApproval(items, pendingApproval))")
    expect(source).toContain('replyApproval(pendingApproval, "allow_once", autoDecision.replyReason)')
    expect(source).toContain('replyApproval(pendingApproval, "deny_once", autoDecision.replyReason)')
  })

  it("guards slash command dispatch during active runs with command metadata", () => {
    expect(source).toContain("findChatCommandByText(chatCommandCatalog(), text)")
    expect(source).toContain("isWorking() && !command?.availableDuringRun")
    expect(source).toContain("当前运行中不能执行该指令")
  })

  it("routes capability package draft revision text through the main input follow-up path", () => {
    const handleSendStart = source.indexOf("const handleSend =")
    const handleSubmitStart = source.indexOf("const canSubmitComposerAction =", handleSendStart)
    const handleSendSource = source.slice(handleSendStart, handleSubmitStart)

    expect(source).toContain("const shouldRouteCapabilityPackageRevisionInput =")
    expect(source).toContain('approval.toolName === "install_capability_package"')
    expect(source).toContain('mode === "capability_package"')
    expect(source).toContain('workflow === "capability_package_ingest"')
    expect(handleSendSource).toContain("shouldRouteCapabilityPackageRevisionInput()")
    expect(handleSendSource).toContain('? "guide"')
    expect(handleSendSource).toContain("enqueuePrompt(current, rawText, mode")
    const revisionRouteIndex = handleSendSource.indexOf("shouldRouteCapabilityPackageRevisionInput()")
    const chatSendIndex = handleSendSource.indexOf("sendChatText(rawText")
    expect(revisionRouteIndex).toBeGreaterThanOrEqual(0)
    expect(chatSendIndex).toBeGreaterThan(revisionRouteIndex)
    expect(handleSendSource.slice(revisionRouteIndex, chatSendIndex)).toContain("return")
    expect(source).toContain("chatMessages.followUp(vscode")
  })

  it("restores capability package runtime state from resumed session runs", () => {
    const resumeStart = source.indexOf('if (msg.type === "sessionRun.resume"')
    const sessionStart = source.indexOf('if (msg.type === "sessionRun.session"', resumeStart)
    const resumeSource = source.slice(resumeStart, sessionStart)

    expect(resumeSource).toContain("sessionRuntimeStateFromMessage(msg as Record<string, unknown>, payload)")
    expect(resumeSource).toContain("setSessionRuntimeState(runtime)")
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

  it("routes remote peer readiness into the run status bar instead of transcript cards", () => {
    const branchIndex = source.indexOf('} else if (type === "remote_peer_ready") {')

    expect(source).toContain("setRemotePeerState(remotePeerStateFromReady(payload))")
    expect(source).toContain("<RunStatusBar")
    expect(source).not.toContain("appendRemoteStatusPart")
    expect(source).not.toContain('type: "remote_status"')
    expect(branchIndex).toBeGreaterThan(0)
  })

  it("keeps REMOTE PEER READY TUI out of chat transcript and out of status state", () => {
    expect(source).toContain("function isRemotePeerReadyTui")
    expect(source).toContain('=== "REMOTE PEER READY"')
    expect(source).toContain("if (isRemotePeerReadyTui(clean)) return")
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
