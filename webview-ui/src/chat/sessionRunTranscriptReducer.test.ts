import { describe, expect, it } from "vitest"
import type { MockSessionBundle } from "../components/chat/mock-data"
import {
  applySessionRunTranscriptEvent,
  applySessionRunTranscriptEvents,
} from "./sessionRunTranscriptReducer"

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
    sessionRunEvent(type, payload, seq, runId),
    {
      activeSessionRunId: runId,
      currentSessionId: "session-1",
      isWorking: true,
      now: 1000 + seq,
      labels: { thinking: "正在思考" },
    },
  ).bundle
}

function sessionRunEvent(
  type: string,
  payload: Record<string, unknown>,
  seq: number,
  runId = "run-1",
): Record<string, unknown> {
  return {
    type,
    session_run_id: runId,
    seq,
    session_event_seq: seq,
    payload,
  }
}

describe("sessionRunTranscriptReducer", () => {
  it("batch-reduces live deltas to the same transcript while returning every event key", () => {
    const events = [
      sessionRunEvent("session_run_start", { prompt: "hi" }, 1),
      sessionRunEvent("assistant_delta", { content: "hel" }, 2),
      sessionRunEvent("assistant_delta", { content: "lo" }, 3),
      sessionRunEvent("reasoning_delta", { content: "plan " }, 4),
      sessionRunEvent("reasoning_delta", { content: "more" }, 5),
      sessionRunEvent("tool_call_stream", {
        tool_call_id: "tool-1",
        tool_name: "shell",
        stream: "stdout",
        content: "ok",
      }, 6),
    ]
    const context = {
      activeSessionRunId: "run-1",
      currentSessionId: "session-1",
      isWorking: true,
      now: 1000,
      labels: { thinking: "正在思考" },
    }
    const batch = applySessionRunTranscriptEvents(bundle(), events, context)
    const sequential = events.reduce(
      (current, event) => applySessionRunTranscriptEvent(current, event, context).bundle,
      bundle(),
    )

    expect(batch.bundle).toEqual(sequential)
    expect(batch.eventKeys).toEqual([
      "session:session-1:1",
      "session:session-1:2",
      "session:session-1:3",
      "session:session-1:4",
      "session:session-1:5",
      "session:session-1:6",
    ])
    expect(batch.changed).toBe(true)
  })

  it("does not replay batch events whose event keys are already in the transcript", () => {
    const events = [
      sessionRunEvent("session_run_start", { prompt: "hi" }, 1),
      sessionRunEvent("assistant_delta", { content: "hello" }, 2),
    ]
    const context = {
      activeSessionRunId: "run-1",
      currentSessionId: "session-1",
      isWorking: true,
      now: 1000,
      labels: { thinking: "正在思考" },
    }
    const first = applySessionRunTranscriptEvents(bundle(), events, context)
    const replay = applySessionRunTranscriptEvents(first.bundle, events, context)

    expect(replay.changed).toBe(false)
    expect(replay.bundle).toBe(first.bundle)
    expect(replay.eventKeys).toEqual(first.eventKeys)
    expect(first.bundle.turns[0].assistantMessages[0].parts).toHaveLength(1)
  })

  it("preserves output notice level for source fetch warnings", () => {
    let current = bundle()
    current = reduce(current, "session_run_start", { prompt: "package repo" }, 1)
    current = reduce(
      current,
      "output",
      {
        content: "资料抓取问题：The read operation timed out",
        format: "plain",
        level: "warning",
      },
      2,
    )

    expect(current.turns[0].assistantMessages[0].parts[0]).toMatchObject({
      type: "notice",
      level: "warning",
      text: "资料抓取问题：The read operation timed out",
      format: "plain",
    })
  })

  it("finalizes a contiguous streamed assistant text block in place", () => {
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
    expect(parts[0].id).toBe("assistant-stream-2-0")
    expect(parts[0]).toMatchObject({
      type: "assistant_text",
      markdown: "hello",
      streaming: false,
      streamKey: "assistant-message",
    })
  })

  it("finalizes a contiguous streamed reasoning block in place", () => {
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
    expect(parts[0].id).toBe("thinking-2-0")
    expect(parts[0]).toMatchObject({
      type: "reasoning",
      raw: "plan more",
      format: "markdown",
    })
  })

  it("does not merge assistant deltas across an intervening tool card", () => {
    let current = bundle()
    current = reduce(current, "session_run_start", { prompt: "hi" }, 1)
    current = reduce(current, "assistant_delta", { content: "A" }, 2)
    current = reduce(current, "tool_call_start", {
      tool_call_id: "tool-1",
      tool_name: "shell",
      tool_args: { command: "npm test" },
    }, 3)
    current = reduce(current, "assistant_delta", { content: "B" }, 4)

    const parts = current.turns[0].assistantMessages[0].parts
    expect(parts).toHaveLength(3)
    expect(parts[0]).toMatchObject({
      type: "assistant_text",
      markdown: "A",
      streaming: false,
      streamKey: "assistant-message",
    })
    expect(parts[1]).toMatchObject({
      type: "tool",
      toolCallId: "tool-1",
    })
    expect(parts[2]).toMatchObject({
      type: "assistant_text",
      markdown: "B",
      streaming: true,
      streamKey: "assistant-stream",
    })
  })

  it("does not merge assistant deltas across intervening view and context cards", () => {
    let current = bundle()
    current = reduce(current, "session_run_start", { prompt: "hi" }, 1)
    current = reduce(current, "assistant_delta", { content: "A" }, 2)
    current = reduce(current, "view", { title: "结构化视图", payload: { value: 1 } }, 3)
    current = reduce(current, "assistant_delta", { content: "B" }, 4)
    current = reduce(current, "context_event", { message: "上下文事件", value: 2 }, 5)
    current = reduce(current, "assistant_delta", { content: "C" }, 6)

    const parts = current.turns[0].assistantMessages[0].parts
    expect(parts.map((part) => part.type)).toEqual([
      "assistant_text",
      "view",
      "assistant_text",
      "context_event",
      "assistant_text",
    ])
    expect(parts[0]).toMatchObject({ markdown: "A", streamKey: "assistant-message" })
    expect(parts[2]).toMatchObject({ markdown: "B", streamKey: "assistant-message" })
    expect(parts[4]).toMatchObject({ markdown: "C", streamKey: "assistant-stream" })
  })

  it("continues the same reasoning stream across tool, view, and context cards", () => {
    let current = bundle()
    current = reduce(current, "session_run_start", { prompt: "hi" }, 1)
    current = reduce(current, "reasoning_delta", { content: "A" }, 2)
    current = reduce(current, "view", { title: "结构化视图", payload: { value: 1 } }, 3)
    current = reduce(current, "context_event", { message: "上下文事件", value: 2 }, 4)
    current = reduce(current, "tool_call_delta", {
      index: 0,
      tool_name: "shell",
      content: "{\"command\":\"npm test\"}",
    }, 5)
    current = reduce(current, "reasoning_delta", { content: "B" }, 6)

    const parts = current.turns[0].assistantMessages[0].parts
    expect(parts).toHaveLength(4)
    expect(parts.filter((part) => part.type === "thinking")).toHaveLength(1)
    expect(parts[0]).toMatchObject({
      type: "thinking",
      raw: "AB",
      active: true,
    })
    expect(parts[1]).toMatchObject({
      type: "view",
    })
    expect(parts[2]).toMatchObject({
      type: "context_event",
    })
    expect(parts[3]).toMatchObject({
      type: "tool",
      toolCallId: "preparing:run-1:0",
      status: "preparing",
    })
  })

  it("finalizes reasoning in place across intervening process cards", () => {
    let current = bundle()
    current = reduce(current, "session_run_start", { prompt: "hi" }, 1)
    current = reduce(current, "reasoning_delta", { content: "plan" }, 2)
    current = reduce(current, "tool_call_start", {
      tool_call_id: "tool-1",
      tool_name: "shell",
      tool_args: { command: "npm test" },
    }, 3)
    current = reduce(current, "reasoning_message", { content: "plan final", format: "markdown" }, 4)

    const parts = current.turns[0].assistantMessages[0].parts
    expect(parts).toHaveLength(2)
    expect(parts[0]).toMatchObject({
      type: "reasoning",
      id: "thinking-2-0",
      raw: "plan final",
      format: "markdown",
    })
    expect(parts[1]).toMatchObject({
      type: "tool",
      toolCallId: "tool-1",
    })
  })

  it("only finalizes the trailing assistant stream on session run end", () => {
    let current = bundle()
    current = reduce(current, "session_run_start", { prompt: "hi" }, 1)
    current = reduce(current, "assistant_delta", { content: "A" }, 2)
    current = reduce(current, "tool_call_start", {
      tool_call_id: "tool-1",
      tool_name: "shell",
      tool_args: { command: "npm test" },
    }, 3)
    current = reduce(current, "assistant_delta", { content: "B" }, 4)
    current = reduce(current, "session_run_end", { response: "B final", response_rendered: false }, 5)

    const parts = current.turns[0].assistantMessages[0].parts
    expect(parts).toHaveLength(3)
    expect(parts[0]).toMatchObject({
      type: "assistant_text",
      markdown: "A",
      streamKey: "assistant-message",
    })
    expect(parts[1]).toMatchObject({
      type: "tool",
      toolCallId: "tool-1",
    })
    expect(parts[2]).toMatchObject({
      type: "assistant_text",
      markdown: "B final",
      streaming: false,
      streamKey: "assistant-message",
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
      id: "assistant-stream-2-0",
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
