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
    expect(source).toContain("appendToolCallDeltaToToolPart")
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

  it("keeps approval reply failures recoverable in the approval UI", () => {
    expect(source).toContain('msg.type === "approval.reply.error"')
    expect(source).toContain("markApprovalSubmitFailed(items, approvalId, message)")
    expect(source).toContain("mergeStatusApprovals(items, statusApprovals, chatId)")
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
})
