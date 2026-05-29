import { describe, expect, it } from "vitest"
import type { MockSessionBundle } from "../components/chat/mock-data"
import { applySessionRunTranscriptEvent } from "./sessionRunTranscriptReducer"

function bundle(): MockSessionBundle {
  return {
    session: {
      id: "session-1",
      title: "新会话",
      updatedAt: "2026-05-29T00:00:00.000Z",
      kind: "main",
      state: "active",
    },
    stats: {
      taskText: "",
      tokensIn: 0,
      tokensOut: 0,
      cacheReads: null,
      cacheWrites: null,
      totalCost: null,
      contextTokens: 0,
      contextWindow: 0,
      maxOutputTokens: 0,
      runStatus: "idle",
    },
    turns: [],
    traceNodes: [],
    traceEdges: [],
    traceUI: {
      activeNodeId: null,
      selectedNodeId: null,
      focusedBranchId: "main",
      showInspector: false,
      showMiniMap: false,
      viewMode: "compact",
    },
  }
}

function reduce(
  current: MockSessionBundle,
  type: string,
  payload: Record<string, unknown>,
  seq: number,
  runId = "run-1",
): MockSessionBundle {
  return applySessionRunTranscriptEvent(
    current,
    {
      type,
      session_run_id: runId,
      seq,
      session_event_seq: seq,
      payload,
    },
    {
      activeSessionRunId: runId,
      currentSessionId: "session-1",
      isWorking: true,
      now: 1000 + seq,
      labels: { thinking: "正在思考" },
    },
  ).bundle
}

describe("sessionRunTranscriptReducer", () => {
  it("keeps streamed assistant text and final assistant text in the same block", () => {
    let current = bundle()
    current = reduce(current, "session_run_start", { prompt: "hi" }, 1)
    current = reduce(current, "assistant_delta", { content: "hel" }, 2)
    current = reduce(current, "assistant_delta", { content: "lo" }, 3)

    const streamingPart = current.turns[0].assistantMessages[0].parts[0]
    expect(streamingPart).toMatchObject({
      type: "assistant_text",
      markdown: "hello",
      streaming: true,
      streamKey: "assistant-stream",
    })

    current = reduce(current, "assistant_message", { content: "hello" }, 4)
    const parts = current.turns[0].assistantMessages[0].parts

    expect(parts).toHaveLength(1)
    expect(parts[0].id).toBe(streamingPart.id)
    expect(parts[0].id).toBe("assistant-stream-run-1")
    expect(parts[0]).toMatchObject({
      type: "assistant_text",
      markdown: "hello",
      streaming: false,
      streamKey: "assistant-message",
    })
  })

  it("keeps streamed reasoning and final reasoning in the same block", () => {
    let current = bundle()
    current = reduce(current, "session_run_start", { prompt: "hi" }, 1)
    current = reduce(current, "reasoning_delta", { content: "plan " }, 2)
    current = reduce(current, "reasoning_delta", { content: "more" }, 3)

    const thinkingPart = current.turns[0].assistantMessages[0].parts[0]
    expect(thinkingPart).toMatchObject({
      type: "thinking",
      raw: "plan more",
      active: true,
    })

    current = reduce(current, "reasoning_message", { content: "plan more", format: "markdown" }, 4)
    const parts = current.turns[0].assistantMessages[0].parts

    expect(parts).toHaveLength(1)
    expect(parts[0].id).toBe(thinkingPart.id)
    expect(parts[0].id).toBe("thinking-run-1")
    expect(parts[0]).toMatchObject({
      type: "reasoning",
      raw: "plan more",
      format: "markdown",
    })
  })

  it("keeps tool preparation, stream, approval, and final result in one tool block", () => {
    let current = bundle()
    current = reduce(current, "session_run_start", { prompt: "hi" }, 1)
    current = reduce(current, "tool_call_delta", {
      index: 0,
      tool_name: "shell",
      arguments_preview: "{\"command\":\"npm test\"}",
    }, 2)
    current = reduce(current, "tool_call_start", {
      index: 0,
      tool_call_id: "tool-1",
      tool_name: "shell",
      tool_args: { command: "npm test" },
    }, 3)
    current = reduce(current, "tool_call_stream", {
      tool_call_id: "tool-1",
      tool_name: "shell",
      stream: "stdout",
      content: "ok",
    }, 4)
    current = reduce(current, "approval_request", {
      approval_id: "approval-1",
      tool_call_id: "tool-1",
      tool_name: "shell",
      reason: "需要执行",
      tool_args: { command: "npm test" },
    }, 5)
    current = reduce(current, "approval_resolved", {
      approval_id: "approval-1",
      tool_call_id: "tool-1",
      decision: "allow_once",
    }, 6)
    current = reduce(current, "tool_call_end", {
      tool_call_id: "tool-1",
      tool_name: "shell",
      tool_result: "ok\n",
    }, 7)

    const parts = current.turns[0].assistantMessages[0].parts
    expect(parts).toHaveLength(1)
    expect(parts[0]).toMatchObject({
      id: "tool-preparing:run-1:0",
      type: "tool",
      tool: "shell",
      toolCallId: "tool-1",
      status: "returned",
      output: "ok",
      outputChunks: [{ stream: "stdout", content: "ok" }],
      finalOutput: "ok\n",
      approvalDecision: "allow_once",
    })
  })

  it("turns run end into metadata-only completion when the response was already rendered", () => {
    let current = bundle()
    current = reduce(current, "session_run_start", { prompt: "hi" }, 1)
    current = reduce(current, "assistant_delta", { content: "done" }, 2)
    current = reduce(current, "session_run_end", { response: "done", response_rendered: true }, 3)

    const parts = current.turns[0].assistantMessages[0].parts
    expect(parts).toHaveLength(1)
    expect(parts[0]).toMatchObject({
      type: "assistant_text",
      markdown: "done",
      streaming: false,
      streamKey: "assistant-message",
    })
    expect(current.stats.runStatus).toBe("done")
    expect(current.session.state).toBe("success")
  })

  it("uses session run end final response to complete the active assistant stream without duplicating it", () => {
    let current = bundle()
    current = reduce(current, "session_run_start", { prompt: "hi" }, 1)
    current = reduce(current, "assistant_delta", { content: "hel" }, 2)
    current = reduce(current, "session_run_end", { response: "hello", response_rendered: false }, 3)

    const parts = current.turns[0].assistantMessages[0].parts
    expect(parts).toHaveLength(1)
    expect(parts[0]).toMatchObject({
      id: "assistant-stream-run-1",
      type: "assistant_text",
      markdown: "hello",
      streaming: false,
      streamKey: "assistant-message",
    })
  })

  it("renders provider stream interruption as a replayable warning notice", () => {
    let current = bundle()
    current = reduce(current, "session_run_start", { prompt: "hi" }, 1)
    current = reduce(current, "provider_stream_interrupted", { message: "stream lost" }, 2)

    const parts = current.turns[0].assistantMessages[0].parts
    expect(parts).toHaveLength(1)
    expect(parts[0]).toMatchObject({
      id: "stream-recovery-2-0",
      type: "notice",
      level: "warning",
      text: "stream lost",
      format: "plain",
    })
  })

  it("settles running tool cards and appends a notice when the run is cancelled", () => {
    let current = bundle()
    current = reduce(current, "session_run_start", { prompt: "hi" }, 1)
    current = reduce(current, "tool_call_start", {
      tool_call_id: "tool-1",
      tool_name: "shell",
      tool_args: { command: "npm test" },
    }, 2)
    current = reduce(current, "session_run_cancelled", { reason: "user_cancelled" }, 3)

    const parts = current.turns[0].assistantMessages[0].parts
    expect(parts[0]).toMatchObject({
      type: "tool",
      status: "cancelled",
      traceNodeStatus: "cancelled",
    })
    expect(parts[1]).toMatchObject({
      type: "notice",
      level: "info",
      text: "已取消当前请求。",
    })
    expect(current.stats.runStatus).toBe("cancelled")
    expect(current.session.state).toBe("cancelled")
  })

  it("does not duplicate the terminal error notice when failed follows error", () => {
    let current = bundle()
    current = reduce(current, "session_run_start", { prompt: "hi" }, 1)
    current = reduce(current, "error", { message: "boom" }, 2)
    current = reduce(current, "session_run_failed", { message: "boom" }, 3)

    const notices = current.turns[0].assistantMessages[0].parts.filter((part) => part.type === "notice")
    expect(notices).toHaveLength(1)
    expect(notices[0]).toMatchObject({
      level: "error",
      text: "错误：boom",
    })
    expect(current.stats.runStatus).toBe("error")
    expect(current.session.state).toBe("error")

    current = reduce(current, "session_run_start", { prompt: "again" }, 4, "run-2")
    current = reduce(current, "session_run_failed", { message: "again failed" }, 5, "run-2")

    const allNotices = current.turns.flatMap((turn) =>
      turn.assistantMessages.flatMap((message) => message.parts.filter((part) => part.type === "notice"))
    )
    expect(allNotices).toHaveLength(2)
    expect(allNotices[1]).toMatchObject({
      level: "error",
      text: "错误：again failed",
    })
  })
})
