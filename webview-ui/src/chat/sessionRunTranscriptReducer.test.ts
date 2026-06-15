import { describe, expect, it } from "vitest"
import type { MockSessionBundle } from "../components/chat/mock-data"
import type { ToolActivityItem } from "../components/chat/transcript-model"
import {
  applySessionRunTranscriptEvent,
  applySessionRunTranscriptEvents,
  isSessionRunTranscriptEventType,
} from "./sessionRunTranscriptReducer"
import {
  applyPatchArgumentDeltaPreparingEvents,
  applyPatchPreviewReadyEvents,
  applyPatchPreviewFailedEvents,
  invalidApplyPatchNoFileChangeEvents,
  recoverableDraftInterruptionEvents,
} from "./tool-contract-events.fixture"

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

  it("stores stream observability metrics in stats without rendering transcript parts", () => {
    let current = bundle()
    current = reduce(current, "session_run_start", { prompt: "hi" }, 1)

    current = reduce(current, "stream_observability", {
      schema: "stream_observability.v1",
      provider_output_count: 2,
      provider_reasoning_count: 1,
      provider_tool_delta_count: 1,
      last_body_chunk_at: 1.25,
      server_enqueued_at: 0.5,
      server_enqueue_latency_ms: 25,
      patch_syntax_error_count: 1,
      patch_syntax_error_codes: { preflight_failed: 1 },
    }, 2)

    expect(current.turns[0].assistantMessages).toHaveLength(0)
    expect(current.stats.observability).toMatchObject({
      schema: "stream_observability.v1",
      provider_output_count: 2,
      provider_reasoning_count: 1,
      provider_tool_delta_count: 1,
      last_body_chunk_at: 1.25,
      server_enqueue_latency_ms: 25,
      extension_apply_latency_ms: 502,
      patch_syntax_error_count: 1,
      patch_syntax_error_codes: { preflight_failed: 1 },
    })
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

  it("projects file change events into one stable transcript item", () => {
    let current = bundle()
    current = reduce(current, "session_run_start", { prompt: "patch file" }, 1)
    current = reduce(current, "file_change_started", {
      item_id: "file-change-1",
      tool_call_id: "tool-1",
      changes: [],
    }, 2)
    current = reduce(current, "file_change_patch_updated", {
      item_id: "file-change-1",
      tool_call_id: "tool-1",
      patch_preview: "*** Update File: src/a.ts\n@@\n-old\n+new",
      changes: [{
        path: "src/a.ts",
        kind: "update",
        diff: "--- a/src/a.ts\n+++ b/src/a.ts\n-old\n+new",
      }],
    }, 3)
    current = reduce(current, "file_change_approval_requested", {
      item_id: "file-change-1",
      tool_call_id: "tool-1",
      approval_id: "approval-1",
      reason: "需要修改文件",
    }, 4)
    current = reduce(current, "file_change_approval_resolved", {
      item_id: "file-change-1",
      tool_call_id: "tool-1",
      approval_id: "approval-1",
      decision: "allow_once",
    }, 5)
    current = reduce(current, "file_change_completed", {
      item_id: "file-change-1",
      tool_call_id: "tool-1",
      status: "completed",
      changes: [{
        path: "src/a.ts",
        kind: "update",
        diff: "--- a/src/a.ts\n+++ b/src/a.ts\n-old\n+new",
      }],
    }, 6)

    const parts = current.turns[0].assistantMessages[0].parts
    expect(parts).toHaveLength(1)
    expect(parts[0]).toMatchObject({
      id: "file-change-1",
      type: "file_change",
      itemId: "file-change-1",
      toolCallId: "tool-1",
      status: "completed",
      path: "src/a.ts",
      addedLines: 1,
      removedLines: 1,
      patchPreview: "*** Update File: src/a.ts\n@@\n-old\n+new",
      approvalId: "approval-1",
      approvalDecision: "allow_once",
    })
  })

  it("keeps invalid apply_patch protocol failures out of file change cards", () => {
    const context = {
      activeSessionRunId: "run-1",
      currentSessionId: "session-1",
      isWorking: true,
      now: 1000,
      labels: { thinking: "正在思考" },
    }

    const result = applySessionRunTranscriptEvents(
      bundle(),
      invalidApplyPatchNoFileChangeEvents as unknown as Record<string, unknown>[],
      context,
    )
    const parts = result.bundle.turns.flatMap((turn) =>
      turn.assistantMessages.flatMap((message) => message.parts)
    )

    expect(parts.some((part) => part.type === "file_change")).toBe(false)
    expect(parts.some((part) =>
      part.type === "tool" &&
      part.tool === "apply_patch" &&
      part.status === "protocol_error" &&
      String(part.output || "").includes("*** File: src/app.py")
    )).toBe(true)
  })

  it("keeps apply_patch argument deltas in tool preparing state", () => {
    const context = {
      activeSessionRunId: "run-1",
      currentSessionId: "session-1",
      isWorking: true,
      now: 1000,
      labels: { thinking: "正在思考" },
    }

    const result = applySessionRunTranscriptEvents(
      bundle(),
      applyPatchArgumentDeltaPreparingEvents as unknown as Record<string, unknown>[],
      context,
    )
    const parts = result.bundle.turns.flatMap((turn) =>
      turn.assistantMessages.flatMap((message) => message.parts)
    )

    expect(parts.some((part) => part.type === "file_change")).toBe(false)
    expect(parts).toContainEqual(expect.objectContaining({
      type: "tool",
      tool: "apply_patch",
      toolCallId: "tool-1",
      status: "preparing",
    }))
  })

  it("creates apply_patch file cards from mutation preview ready state", () => {
    const context = {
      activeSessionRunId: "run-1",
      currentSessionId: "session-1",
      isWorking: true,
      now: 1000,
      labels: { thinking: "正在思考" },
    }

    const result = applySessionRunTranscriptEvents(
      bundle(),
      applyPatchPreviewReadyEvents as unknown as Record<string, unknown>[],
      context,
    )
    const parts = result.bundle.turns.flatMap((turn) =>
      turn.assistantMessages.flatMap((message) => message.parts)
    )

    expect(parts).toContainEqual(expect.objectContaining({
      type: "tool",
      tool: "apply_patch",
      toolCallId: "tool-1",
      status: "preparing",
      resultMeta: expect.objectContaining({
        argument_status: "valid",
        preview_status: "previewing",
      }),
    }))
    expect(parts).toContainEqual(expect.objectContaining({
      type: "file_change",
      itemId: "file-change:tool-1",
      toolCallId: "tool-1",
      status: "in_progress",
      path: "src/app.py",
      addedLines: 1,
    }))
  })

  it("updates only the tool card while a mutation preview is running", () => {
    let current = bundle()
    current = reduce(current, "session_run_start", { prompt: "patch file" }, 1)
    current = reduce(current, "tool_arguments_valid", {
      index: 0,
      tool_call_id: "tool-1",
      tool_name: "apply_patch",
      status: "valid",
    }, 2)
    current = reduce(current, "mutation_previewing", {
      index: 0,
      item_id: "file-change:tool-1",
      tool_call_id: "tool-1",
      tool_name: "apply_patch",
      status: "previewing",
    }, 3)

    const parts = current.turns.flatMap((turn) =>
      turn.assistantMessages.flatMap((message) => message.parts)
    )

    expect(parts.some((part) => part.type === "file_change")).toBe(false)
    expect(parts).toContainEqual(expect.objectContaining({
      type: "tool",
      tool: "apply_patch",
      toolCallId: "tool-1",
      status: "preparing",
      resultMeta: expect.objectContaining({
        argument_status: "valid",
        preview_status: "previewing",
      }),
    }))
  })

  it("keeps semantic preview failures out of file change cards", () => {
    const context = {
      activeSessionRunId: "run-1",
      currentSessionId: "session-1",
      isWorking: true,
      now: 1000,
      labels: { thinking: "正在思考" },
    }

    const result = applySessionRunTranscriptEvents(
      bundle(),
      applyPatchPreviewFailedEvents as unknown as Record<string, unknown>[],
      context,
    )
    const parts = result.bundle.turns.flatMap((turn) =>
      turn.assistantMessages.flatMap((message) => message.parts)
    )

    expect(parts.some((part) => part.type === "file_change")).toBe(false)
    expect(parts).toContainEqual(expect.objectContaining({
      type: "tool",
      tool: "apply_patch",
      toolCallId: "tool-1",
      status: "protocol_error",
      output: expect.stringContaining("file does not exist: missing.py"),
      resultMeta: expect.objectContaining({
        argument_status: "valid",
        preview_status: "failed",
      }),
    }))
  })

  it("does not let late tool_call_end overwrite mutation preview failure details", () => {
    const context = {
      activeSessionRunId: "run-1",
      currentSessionId: "session-1",
      isWorking: true,
      now: 1000,
      labels: { thinking: "正在思考" },
    }
    const events = [
      ...applyPatchPreviewFailedEvents,
      {
        type: "tool_call_end",
        session_run_id: "run-1",
        seq: 6,
        session_event_seq: 6,
        payload: {
          index: 0,
          tool_call_id: "tool-1",
          tool_name: "apply_patch",
          status: "completed",
          tool_result: "Applied patch",
        },
      },
    ]

    const result = applySessionRunTranscriptEvents(
      bundle(),
      events as unknown as Record<string, unknown>[],
      context,
    )
    const parts = result.bundle.turns.flatMap((turn) =>
      turn.assistantMessages.flatMap((message) => message.parts)
    )
    const tool = parts.find((part) =>
      part.type === "tool" && part.tool === "apply_patch"
    )

    expect(tool).toMatchObject({
      type: "tool",
      status: "protocol_error",
      output: expect.stringContaining("file does not exist: missing.py"),
      resultMeta: expect.objectContaining({
        preview_status: "failed",
        failure_code: "semantic_preview_failed",
      }),
    })
  })

  it("keeps interrupted document drafts recoverable", () => {
    const context = {
      activeSessionRunId: "run-1",
      currentSessionId: "session-1",
      isWorking: true,
      now: 1000,
      labels: { thinking: "正在思考" },
    }

    const result = applySessionRunTranscriptEvents(
      bundle(),
      recoverableDraftInterruptionEvents as unknown as Record<string, unknown>[],
      context,
    )
    const parts = result.bundle.turns.flatMap((turn) =>
      turn.assistantMessages.flatMap((message) => message.parts)
    )

    expect(parts).toContainEqual(expect.objectContaining({
      type: "document_draft",
      draftId: "draft-1",
      targetPath: "docs/a.md",
      status: "recoverable",
      contentLength: 12,
      contentSha256: "abc",
      lastChunkSeq: 2,
      reason: "provider stream interrupted",
    }))
  })

  it("projects document draft lifecycle events into one stable transcript item", () => {
    let current = bundle()
    current = reduce(current, "session_run_start", { prompt: "write docs" }, 1)
    current = reduce(current, "document_draft_started", {
      draft_id: "draft-1",
      target_path: "docs/a.md",
      title: "ADR",
      format: "markdown",
    }, 2)
    current = reduce(current, "document_draft_commit_requested", {
      draft_id: "draft-1",
      target_path: "docs/a.md",
      item_id: "file-change-1",
      approval_id: "approval-1",
    }, 3)
    current = reduce(current, "document_draft_committed", {
      draft_id: "draft-1",
      target_path: "docs/a.md",
      item_id: "file-change-1",
    }, 4)

    const parts = current.turns[0].assistantMessages[0].parts
    expect(parts).toHaveLength(1)
    expect(parts[0]).toMatchObject({
      id: "draft-1",
      type: "document_draft",
      draftId: "draft-1",
      targetPath: "docs/a.md",
      title: "ADR",
      format: "markdown",
      itemId: "file-change-1",
      approvalId: "approval-1",
      status: "committed",
    })
  })

  it("projects document draft progress and snapshot metadata without assistant text", () => {
    let current = bundle()
    current = reduce(current, "session_run_start", { prompt: "write docs" }, 1)
    current = reduce(current, "document_draft_started", {
      draft_id: "draft-1",
      target_path: "docs/a.md",
      title: "ADR",
      format: "markdown",
    }, 2)
    current = reduce(current, "document_draft_preview_chunk", {
      draft_id: "draft-1",
      target_path: "docs/a.md",
      chunk_seq: 1,
      start_offset: 0,
      end_offset: "# ADR\n".length,
      content: "# ADR\n",
    }, 3)
    current = reduce(current, "document_draft_progress", {
      draft_id: "draft-1",
      target_path: "docs/a.md",
      content_length: "# ADR\n".length,
      content_sha256: "progress-sha",
      last_chunk_seq: 1,
    }, 4)
    current = reduce(current, "document_draft_snapshot", {
      draft_id: "draft-1",
      target_path: "docs/a.md",
      content: "# ADR\n\nBody\n",
      content_length: "# ADR\n\nBody\n".length,
      content_sha256: "snapshot-sha",
      snapshot_kind: "final",
      final: true,
      last_chunk_seq: 2,
    }, 5)

    const message = current.turns[0].assistantMessages[0]
    expect(message.text).toBe("")
    expect(message.parts).toHaveLength(1)
    expect(message.parts[0]).toMatchObject({
      type: "document_draft",
      draftId: "draft-1",
      contentLength: "# ADR\n\nBody\n".length,
      contentSha256: "snapshot-sha",
      lastChunkSeq: 2,
      snapshotKind: "final",
      snapshotFinal: true,
    })
    expect(JSON.stringify(message.parts[0])).not.toContain("# ADR")
    expect(JSON.stringify(message.parts[0])).not.toContain("Body")
  })

  it("renders lifecycle hook audit events with product titles and folded raw details", () => {
    let current = bundle()
    current = reduce(current, "session_run_start", { prompt: "hi" }, 1)

    current = reduce(current, "lifecycle_hook", {
      title: "PreToolUse hook denied",
      event_name: "PreToolUse",
      hook_id: "guard/pretool",
      decision: "deny",
      continue_flow: false,
      reason: "shell command blocked by lifecycle",
      user_message: "This command needs review.",
      diagnostics: [{ code: "lifecycle_output_field_ignored", message: "updated_input is audited elsewhere." }],
      artifacts: [{ kind: "review", id: "artifact-1" }],
      raw_event_refs: [{ agent_run_id: "agent-run-1", seq: 42, type: "lifecycle_hook" }],
    }, 2)

    expect(isSessionRunTranscriptEventType("lifecycle_hook")).toBe(true)
    const parts = current.turns[0].assistantMessages[0].parts
    expect(parts).toHaveLength(1)
    expect(parts[0]).toMatchObject({
      type: "context_event",
      title: "工具调用已被策略拦截",
      payload: {
        event_name: "PreToolUse",
        hook_id: "guard/pretool",
        decision: "deny",
        continue_flow: false,
        reason: "shell command blocked by lifecycle",
        user_message: "This command needs review.",
        diagnostics: [{ code: "lifecycle_output_field_ignored", message: "updated_input is audited elsewhere." }],
        artifacts: [{ kind: "review", id: "artifact-1" }],
      },
      rawEventRefs: [{ agent_run_id: "agent-run-1", seq: 42, type: "lifecycle_hook" }],
    })
    expect(String((parts[0] as { title?: string }).title || "")).not.toContain("PreToolUse")
    expect(parts[0]).not.toHaveProperty("markdown")
  })

  it("renders StopFailure lifecycle recovery with product title instead of raw hook title", () => {
    let current = bundle()
    current = reduce(current, "session_run_start", { prompt: "hi" }, 1)

    current = reduce(current, "lifecycle_hook", {
      title: "StopFailure hook recorded recovery guidance",
      event_name: "StopFailure",
      hook_id: "guard/stop-failure",
      message: "Lifecycle recovery: retry after reconnecting.",
      artifacts: [{ kind: "failure_report", id: "failure-1" }],
      diagnostics: [{ code: "failure_review", message: "Failure review recorded." }],
      raw_event_refs: [{ agent_run_id: "agent-run-1", seq: 44, type: "lifecycle_hook" }],
    }, 2)

    const parts = current.turns[0].assistantMessages[0].parts
    expect(parts).toHaveLength(1)
    expect(parts[0]).toMatchObject({
      type: "context_event",
      title: "运行恢复信息",
      payload: {
        event_name: "StopFailure",
        hook_id: "guard/stop-failure",
        message: "Lifecycle recovery: retry after reconnecting.",
        artifacts: [{ kind: "failure_report", id: "failure-1" }],
        diagnostics: [{ code: "failure_review", message: "Failure review recorded." }],
      },
      rawEventRefs: [{ agent_run_id: "agent-run-1", seq: 44, type: "lifecycle_hook" }],
    })
    expect(String((parts[0] as { title?: string }).title || "")).not.toContain("StopFailure")
    expect(parts[0]).not.toHaveProperty("markdown")
  })

  it("renders MCP elicitation lifecycle request and result with product titles", () => {
    let current = bundle()
    current = reduce(current, "session_run_start", { prompt: "use docs mcp" }, 1)
    current = reduce(current, "lifecycle_hook", {
      title: "Elicitation",
      event_name: "Elicitation",
      phase: "request",
      tool_name: "search",
      tool_call_id: "call-mcp-1",
      mcp_server: "docs",
      message: "Choose repository",
      raw_event_refs: [{ agent_run_id: "agent-run-1", seq: 45, type: "lifecycle_hook" }],
    }, 2)
    current = reduce(current, "lifecycle_hook", {
      title: "ElicitationResult",
      event_name: "ElicitationResult",
      phase: "result",
      tool_name: "search",
      tool_call_id: "call-mcp-1",
      mcp_server: "docs",
      result_action: "accept",
      message: "MCP elicitation accepted.",
      raw_event_refs: [{ agent_run_id: "agent-run-1", seq: 46, type: "lifecycle_hook" }],
    }, 3)

    const parts = current.turns[0].assistantMessages[0].parts
    expect(parts).toHaveLength(2)
    expect(parts[0]).toMatchObject({
      type: "context_event",
      title: "MCP 交互请求",
      payload: {
        event_name: "Elicitation",
        phase: "request",
        tool_name: "search",
        tool_call_id: "call-mcp-1",
        mcp_server: "docs",
      },
    })
    expect(parts[1]).toMatchObject({
      type: "context_event",
      title: "MCP 交互结果",
      payload: {
        event_name: "ElicitationResult",
        phase: "result",
        result_action: "accept",
      },
    })
    expect(parts.map((part) => String((part as { title?: string }).title || "")).join(" ")).not.toContain("Elicitation")
    expect(parts.some((part) => "markdown" in part)).toBe(false)
  })

  it("sanitizes lifecycle_hook.v1 context_event titles before they reach the main transcript", () => {
    let current = bundle()
    current = reduce(current, "session_run_start", { prompt: "hi" }, 1)

    current = reduce(current, "context_event", {
      schema: "lifecycle_hook.v1",
      title: "PostToolUse raw lifecycle event",
      message: "PostToolUse raw lifecycle event",
      event_name: "PostToolUse",
      hook_id: "guard/posttool",
      raw_event_refs: [{ agent_run_id: "agent-run-1", seq: 47, type: "lifecycle_hook" }],
    }, 2)

    const parts = current.turns[0].assistantMessages[0].parts
    expect(parts).toHaveLength(1)
    expect(parts[0]).toMatchObject({
      type: "context_event",
      title: "工具结果已记录",
      rawEventRefs: [{ agent_run_id: "agent-run-1", seq: 47, type: "lifecycle_hook" }],
    })
    expect(String((parts[0] as { title?: string }).title || "")).not.toContain("PostToolUse")
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
      toolId: "builtin:shell",
      risk: "command_execution",
      exposure: "direct",
      capabilityName: "terminal",
      arguments_preview: "{\"command\":\"npm test\"}",
    }, 2)
    current = reduce(current, "tool_call_start", {
      index: 0,
      tool_call_id: "tool-1",
      tool_name: "shell",
      tool_id: "builtin:shell",
      risk: "command_execution",
      exposure: "direct",
      tool_args: { command: "npm test" },
    }, 3)
    current = reduce(current, "tool_call_stream", {
      tool_call_id: "tool-1",
      tool_name: "shell",
      tool_id: "builtin:shell",
      risk: "command_execution",
      exposure: "direct",
      stream: "stdout",
      content: "ok",
    }, 4)
    current = reduce(current, "approval_request", {
      approval_id: "approval-1",
      tool_call_id: "tool-1",
      tool_name: "shell",
      tool_id: "builtin:shell",
      risk: "command_execution",
      exposure: "direct",
      reason: "需要执行",
      tool_args: { command: "npm test" },
    }, 5)
    current = reduce(current, "approval_resolved", {
      approval_id: "approval-1",
      tool_call_id: "tool-1",
      tool_id: "builtin:shell",
      risk: "command_execution",
      exposure: "direct",
      decision: "allow_once",
    }, 6)
    current = reduce(current, "tool_call_end", {
      tool_call_id: "tool-1",
      tool_name: "shell",
      tool_id: "builtin:shell",
      risk: "command_execution",
      exposure: "direct",
      tool_result: "ok\n",
      meta: {
        executeTrace: {
          tool_id: "builtin:shell",
          target_exposure: "direct",
        },
      },
    }, 7)

    const parts = current.turns[0].assistantMessages[0].parts
    expect(parts).toHaveLength(1)
    expect(parts[0]).toMatchObject({
      id: "tool-preparing:run-1:0",
      type: "tool",
      tool: "shell",
      toolCallId: "tool-1",
      toolId: "builtin:shell",
      risk: "command_execution",
      exposure: "direct",
      capabilityName: "terminal",
      status: "returned",
      output: "ok",
      outputChunks: [{ stream: "stdout", content: "ok" }],
      finalOutput: "ok\n",
      executeTrace: {
        tool_id: "builtin:shell",
        target_exposure: "direct",
      },
      approvalDecision: "allow_once",
    })
  })

  it("projects canonical tool spec metadata and gateway traces onto tool cards", () => {
    let current = bundle()
    current = reduce(current, "session_run_start", { prompt: "hi" }, 1)
    current = reduce(current, "tool_call_start", {
      tool_call_id: "search-1",
      tool_name: "tool_search",
      tool_id: "builtin:tool_search",
      risk: "read_only",
      exposure: "direct",
      tool_args: { query: "docs" },
    }, 2)
    current = reduce(current, "tool_call_end", {
      tool_call_id: "search-1",
      tool_name: "tool_search",
      tool_id: "builtin:tool_search",
      risk: "read_only",
      exposure: "direct",
      tool_result: "{\"results\":[]}",
      meta: {
        search_trace: {
          query: "docs",
          result_count: 1,
          tool_ids: ["capability:docs:lookup"],
        },
      },
    }, 3)

    const parts = current.turns[0].assistantMessages[0].parts
    expect(parts).toHaveLength(1)
    const tool = parts[0] as ToolActivityItem
    expect(tool).toMatchObject({
      type: "tool",
      tool: "tool_search",
      toolId: "builtin:tool_search",
      risk: "read_only",
      exposure: "direct",
      searchTrace: {
        query: "docs",
        result_count: 1,
        tool_ids: ["capability:docs:lookup"],
      },
      resultMeta: {
        search_trace: {
          query: "docs",
          result_count: 1,
          tool_ids: ["capability:docs:lookup"],
        },
      },
    })
  })

  it("preserves raw AgentRun event references on merged tool cards", () => {
    let current = bundle()
    current = reduce(current, "session_run_start", { prompt: "hi" }, 1)
    current = reduce(current, "tool_call_start", {
      tool_call_id: "tool-1",
      tool_name: "fetch_capabilities",
      tool_args: { repo: "repo" },
      raw_event_refs: [{ agent_run_id: "agent-run-1", seq: 10, type: "tool_use" }],
    }, 2)
    current = reduce(current, "tool_call_end", {
      tool_call_id: "tool-1",
      tool_name: "fetch_capabilities",
      tool_result: "ok",
      raw_event_refs: [{ agent_run_id: "agent-run-1", seq: 11, type: "tool_result" }],
    }, 3)

    const parts = current.turns[0].assistantMessages[0].parts
    expect(parts).toHaveLength(1)
    expect(parts[0]).toMatchObject({
      type: "tool",
      toolCallId: "tool-1",
      rawEventRefs: [
        { agent_run_id: "agent-run-1", seq: 10, type: "tool_use" },
        { agent_run_id: "agent-run-1", seq: 11, type: "tool_result" },
      ],
    })
  })

  it("promotes target tool identity for capability target events", () => {
    const capabilityTarget = {
      gateway_tool_name: "capability_execute",
      parent_tool_call_id: "exec-target",
      target_tool_call_id: "exec-target:capability:docs:lookup",
      target_tool_id: "capability:docs:lookup",
      target_tool_name: "docs_lookup",
      target_arguments: { query: "cache" },
      target_exposure: "deferred",
      target_risk: "read_only",
      target_permission_policy: "read_only",
    }
    let current = bundle()
    current = reduce(current, "session_run_start", { prompt: "hi" }, 1)
    current = reduce(current, "tool_call_start", {
      tool_call_id: "exec-target:capability:docs:lookup",
      tool_name: "capability_execute",
      tool_args: { query: "cache" },
      tool_id: "builtin:capability_execute",
      risk: "capability",
      exposure: "direct",
      capability_target: capabilityTarget,
    }, 2)
    current = reduce(current, "tool_call_end", {
      tool_call_id: "exec-target:capability:docs:lookup",
      tool_name: "capability_execute",
      tool_result: "docs_lookup:cache",
      tool_id: "builtin:capability_execute",
      risk: "capability",
      exposure: "direct",
      capability_target: capabilityTarget,
      meta: { capability_target: capabilityTarget },
    }, 3)

    const part = current.turns[0].assistantMessages[0].parts[0] as ToolActivityItem
    expect(part).toMatchObject({
      type: "tool",
      tool: "docs_lookup",
      toolCallId: "exec-target:capability:docs:lookup",
      toolId: "capability:docs:lookup",
      risk: "read_only",
      exposure: "deferred",
      capabilityRole: "target",
      capabilityTarget: {
        gatewayToolName: "capability_execute",
        parentToolCallId: "exec-target",
        targetToolCallId: "exec-target:capability:docs:lookup",
        targetToolId: "capability:docs:lookup",
        targetToolName: "docs_lookup",
        targetArguments: { query: "cache" },
        targetExposure: "deferred",
        targetRisk: "read_only",
        targetPermissionPolicy: "read_only",
      },
      output: "docs_lookup:cache",
    })
  })

  it("shows target tool name on deferred target approval requests", () => {
    const capabilityTarget = {
      gateway_tool_name: "capability_execute",
      parent_tool_call_id: "exec-target",
      target_tool_call_id: "exec-target:capability:docs:workspace_patch",
      target_tool_id: "capability:docs:workspace_patch",
      target_tool_name: "apply_patch",
      target_arguments: { patch: "*** Begin Patch\n*** End Patch" },
      target_exposure: "deferred",
      target_risk: "file_mutation",
      target_permission_policy: "workspace_write",
    }
    let current = bundle()
    current = reduce(current, "session_run_start", { prompt: "hi" }, 1)
    current = reduce(current, "approval_request", {
      approval_id: "approval-1",
      tool_call_id: "exec-target:capability:docs:workspace_patch",
      tool_name: "capability_execute",
      tool_args: { patch: "*** Begin Patch\n*** End Patch" },
      reason: "review target patch",
      capability_target: capabilityTarget,
    }, 2)

    const part = current.turns[0].assistantMessages[0].parts[0] as ToolActivityItem
    expect(part.tool).toBe("apply_patch")
    expect(part.capabilityRole).toBe("target")
    expect(part.capabilityTarget?.targetToolName).toBe("apply_patch")
    expect(part.toolId).toBe("capability:docs:workspace_patch")
    expect(part.risk).toBe("file_mutation")
    expect(part.exposure).toBe("deferred")
    expect(part.approvalReason).toBe("review target patch")
  })

  it("projects final PermissionRequest decisions onto tool card status and audit metadata", () => {
    let current = bundle()
    current = reduce(current, "session_run_start", { prompt: "hi" }, 1)
    current = reduce(current, "tool_call_start", {
      tool_call_id: "tool-1",
      tool_name: "shell",
      tool_args: { command: "npm test" },
    }, 2)
    current = reduce(current, "tool_call_end", {
      tool_call_id: "tool-1",
      tool_name: "shell",
      tool_result: "Permission denied",
      meta: {
        permission: {
          action: "deny",
          authorized: false,
          policy_matched: "lifecycle_hook:deny",
          reason: "PermissionRequest lifecycle denied shell.",
          lifecycle_event: "PermissionRequest",
          lifecycle_hooks: [{
            hook_id: "hook:admin:shell-permission:PermissionRequest:0",
            display_name: "Shell permission guard",
            decision: "deny",
            reason: "Blocks shell in this workspace.",
          }],
        },
      },
    }, 3)

    const part = current.turns[0].assistantMessages[0].parts[0]
    expect(part).toMatchObject({
      type: "tool",
      status: "denied",
      resultMeta: {
        permission: {
          action: "deny",
          authorized: false,
          policy_matched: "lifecycle_hook:deny",
          reason: "PermissionRequest lifecycle denied shell.",
          lifecycle_event: "PermissionRequest",
          lifecycle_hooks: [{
            hook_id: "hook:admin:shell-permission:PermissionRequest:0",
            display_name: "Shell permission guard",
            decision: "deny",
            reason: "Blocks shell in this workspace.",
          }],
        },
      },
    })
    expect(JSON.stringify(part)).not.toContain("PreToolUse")
    expect(JSON.stringify(part)).not.toContain("private-data")
  })

  it("renders background PermissionRequest blocked reviews as workflow decisions", () => {
    let current = bundle()
    current = reduce(current, "session_run_start", { prompt: "hi" }, 1)
    current = reduce(current, "workflow_decision", {
      workflow: "agent_run_permission",
      decision_type: "permission_review",
      status: "pending",
      title: "Permission review required",
      summary: "PermissionRequest lifecycle asked for shell review.",
      approval_id: "approval-1",
      tool_name: "shell",
      review: {
        tool_name: "shell",
        reason: "PermissionRequest lifecycle asked for shell review.",
        permission: {
          action: "blocked_review",
          authorized: false,
          reason: "PermissionRequest lifecycle asked for shell review.",
        },
      },
      raw_event_refs: [{
        agent_run_id: "agent-run-1",
        seq: 12,
        type: "permission.blocked_review",
      }],
    }, 2)

    const part = current.turns[0].assistantMessages[0].parts[0]
    expect(part).toMatchObject({
      type: "workflow_decision",
      workflow: "agent_run_permission",
      decisionType: "permission_review",
      status: "pending",
      title: "Permission review required",
      summary: "PermissionRequest lifecycle asked for shell review.",
      approvalId: "approval-1",
      review: {
        tool_name: "shell",
        permission: {
          action: "blocked_review",
          authorized: false,
        },
      },
      rawEventRefs: [{
        agent_run_id: "agent-run-1",
        seq: 12,
        type: "permission.blocked_review",
      }],
    })
  })

  it("preserves PermissionRequest ask metadata on approval tool cards", () => {
    let current = bundle()
    current = reduce(current, "session_run_start", { prompt: "hi" }, 1)
    current = reduce(current, "approval_request", {
      approval_id: "approval-1",
      tool_call_id: "tool-1",
      tool_name: "shell",
      reason: "PermissionRequest lifecycle asked for shell review.",
      intent: "Review shell command",
      tool_args: { command: "npm test" },
      permission: {
        action: "require_approval",
        authorized: true,
        policy_matched: "lifecycle_hook:ask",
        reason: "PermissionRequest lifecycle asked for shell review.",
      },
    }, 2)

    const part = current.turns[0].assistantMessages[0].parts[0]
    expect(part).toMatchObject({
      type: "tool",
      status: "awaiting_approval",
      approvalId: "approval-1",
      approvalReason: "PermissionRequest lifecycle asked for shell review.",
      approvalIntent: "Review shell command",
      resultMeta: {
        permission: {
          action: "require_approval",
          authorized: true,
          policy_matched: "lifecycle_hook:ask",
          reason: "PermissionRequest lifecycle asked for shell review.",
        },
      },
    })
  })

  it("preserves lifecycle hook identity on approval tool cards", () => {
    let current = bundle()
    current = reduce(current, "session_run_start", { prompt: "hi" }, 1)
    current = reduce(current, "approval_request", {
      approval_id: "approval-1",
      tool_call_id: "tool-1",
      tool_name: "lifecycle:UserPromptSubmit",
      tool_source: "lifecycle_hook",
      reason: "Review prompt before continuing.",
      tool_args: { user_input: "install linked skill" },
      lifecycle_event: "UserPromptSubmit",
      lifecycle_hooks: [{
        hook_id: "hook:admin:prompt-review:UserPromptSubmit:0",
        display_name: "Prompt review",
        handler_type: "prompt",
        reason: "Review prompt before continuing.",
      }],
    }, 2)

    const part = current.turns[0].assistantMessages[0].parts[0]
    expect(part).toMatchObject({
      type: "tool",
      status: "awaiting_approval",
      source: "lifecycle_hook",
      resultMeta: {
        lifecycle_event: "UserPromptSubmit",
        lifecycle_hooks: [{
          hook_id: "hook:admin:prompt-review:UserPromptSubmit:0",
          display_name: "Prompt review",
          handler_type: "prompt",
          reason: "Review prompt before continuing.",
        }],
      },
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

  it("settles active thinking and streams when run end includes a final response", () => {
    let current = bundle()
    current = reduce(current, "session_run_start", { prompt: "hi" }, 1)
    current = reduce(current, "reasoning_delta", { content: "plan" }, 2)
    current = reduce(current, "assistant_delta", { content: "draft" }, 3)
    current = reduce(current, "session_run_end", { response: "done", response_rendered: false }, 4)

    const parts = current.turns[0].assistantMessages[0].parts
    expect(parts[0]).toMatchObject({
      type: "thinking",
      active: false,
      traceNodeStatus: "success",
    })
    expect(parts[1]).toMatchObject({
      type: "assistant_text",
      markdown: "done",
      streaming: false,
      streamKey: "assistant-message",
      traceNodeStatus: "success",
    })
    expect(current.stats.runStatus).toBe("done")
    expect(current.session.state).toBe("success")
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

  it("falls back to labels for provider stream interruption message keys", () => {
    let current = bundle()
    current = reduce(current, "session_run_start", { prompt: "hi" }, 1)
    current = applySessionRunTranscriptEvent(current, {
      type: "provider_stream_interrupted",
      payload: { message_key: "provider_stream_interrupted.recovering" },
      session_run_id: "run-1",
      seq: 2,
    }, {
      labels: { providerStreamInterrupted: "stream recovering" },
    }).bundle

    const parts = current.turns[0].assistantMessages[0].parts
    expect(parts[0]).toMatchObject({
      type: "notice",
      level: "warning",
      text: "stream recovering",
    })
  })

  it("renders failed provider recovery as interrupted and continueable", () => {
    let current = bundle()
    current = reduce(current, "session_run_start", { prompt: "hi" }, 1)
    current = applySessionRunTranscriptEvent(current, {
      type: "provider_stream_interrupted",
      payload: {
        message_key: "provider_stream.interrupted_can_continue",
        recovery: { attempted: true, failed: true },
      },
      session_run_id: "run-1",
      seq: 2,
    }, {
      labels: {
        providerStreamInterrupted: "stream recovering",
        streamInterruptedCanContinue: "stream interrupted, continue",
      },
    }).bundle

    const parts = current.turns[0].assistantMessages[0].parts
    expect(parts[0]).toMatchObject({
      type: "notice",
      level: "warning",
      text: "stream interrupted, continue",
    })
  })

  it("falls back to labels for capability package failure message keys", () => {
    let current = bundle()
    current = reduce(current, "session_run_start", { prompt: "hi" }, 1)
    current = applySessionRunTranscriptEvent(current, {
      type: "session_run_failed",
      payload: {
        code: "capability_package_session_failed",
        message_key: "capability_package.session_failed",
      },
      session_run_id: "run-1",
      seq: 2,
    }, {
      labels: { capabilityPackageSessionFailed: "package failed" },
    }).bundle

    const parts = current.turns[0].assistantMessages[0].parts
    expect(parts[0]).toMatchObject({
      type: "notice",
      level: "error",
      text: "错误：package failed",
    })
  })

  it("stores capability install candidates as workflow artifacts", () => {
    let current = bundle()
    current = reduce(current, "session_run_start", { prompt: "package" }, 1)
    current = reduce(current, "workflow_artifact", {
      workflow: "capability_package_ingest",
      artifact_type: "capability_install_candidate",
      title: "能力安装候选 review 已生成",
      artifact: {
        package_id: "review",
        description: "Review package",
        components: [{
          id: "skill:code-review",
          kind: "skill",
          name: "code-review",
          has_skill_content: true,
          skill_content_chars: 120,
        }],
        validation: { ok: true },
      },
      raw_event_refs: [{ agent_run_id: "agent-run-1", seq: 20, type: "result" }],
    }, 2)

    const parts = current.turns[0].assistantMessages[0].parts
    expect(parts[0]).toMatchObject({
      type: "workflow_artifact",
      lane: "primary",
      workflow: "capability_package_ingest",
      artifactType: "capability_install_candidate",
      title: "能力安装候选 review 已生成",
      artifact: {
        package_id: "review",
      },
      rawEventRefs: [{ agent_run_id: "agent-run-1", seq: 20, type: "result" }],
    })
    expect(JSON.stringify(parts[0])).not.toContain('"skill_content":')
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

  it("settles active thinking, assistant streams, and running tools when the run fails", () => {
    let current = bundle()
    current = reduce(current, "session_run_start", { prompt: "hi" }, 1)
    current = reduce(current, "reasoning_delta", { content: "plan" }, 2)
    current = reduce(current, "assistant_delta", { content: "draft" }, 3)
    current = reduce(current, "tool_call_start", {
      tool_call_id: "tool-1",
      tool_name: "shell",
      tool_args: { command: "npm test" },
    }, 4)
    current = reduce(current, "session_run_failed", { message: "boom" }, 5)

    const parts = current.turns[0].assistantMessages[0].parts
    expect(parts[0]).toMatchObject({
      type: "thinking",
      active: false,
      traceNodeStatus: "error",
    })
    expect(parts[1]).toMatchObject({
      type: "assistant_text",
      streaming: false,
      streamKey: "assistant-message",
      traceNodeStatus: "error",
    })
    expect(parts[2]).toMatchObject({
      type: "tool",
      status: "error",
      traceNodeStatus: "error",
    })
    expect(current.stats.runStatus).toBe("error")
    expect(current.session.state).toBe("error")
  })

  it("settles active thinking, assistant streams, and running tools when the run is interrupted", () => {
    let current = bundle()
    current = reduce(current, "session_run_start", { prompt: "hi" }, 1)
    current = reduce(current, "reasoning_delta", { content: "plan" }, 2)
    current = reduce(current, "assistant_delta", { content: "draft" }, 3)
    current = reduce(current, "tool_call_start", {
      tool_call_id: "tool-1",
      tool_name: "shell",
      tool_args: { command: "npm test" },
    }, 4)
    current = reduce(current, "session_run_interrupted", {
      message_key: "provider_stream.interrupted_can_continue",
    }, 5)

    const parts = current.turns[0].assistantMessages[0].parts
    expect(parts[0]).toMatchObject({
      type: "thinking",
      active: false,
      traceNodeStatus: "success",
    })
    expect(parts[1]).toMatchObject({
      type: "assistant_text",
      streaming: false,
      streamKey: "assistant-message",
      traceNodeStatus: "success",
    })
    expect(parts[2]).toMatchObject({
      type: "tool",
      status: "cancelled",
      traceNodeStatus: "success",
    })
    expect(current.stats.runStatus).toBe("interrupted")
    expect(current.session.state).toBe("active")
  })
})
