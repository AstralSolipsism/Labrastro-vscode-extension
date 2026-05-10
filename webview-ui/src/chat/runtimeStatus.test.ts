import { describe, expect, it } from "vitest"
import { resolveRuntimeStatusUiAction } from "./runtimeStatus"

describe("resolveRuntimeStatusUiAction", () => {
  it("routes queued shell runtime status into the shell tool card", () => {
    expect(resolveRuntimeStatusUiAction({
      phase: "shell_queue",
      status: "queued",
      tool_call_id: "tool-1",
    })).toEqual({
      kind: "shell_tool_update",
      toolCallId: "tool-1",
      nextStatus: "pending",
      textKey: "tool.shell.queued",
    })
  })

  it("routes running shell runtime status back into the shell tool card without extra text", () => {
    expect(resolveRuntimeStatusUiAction({
      phase: "shell_queue",
      status: "running",
      tool_call_id: "tool-1",
    })).toEqual({
      kind: "shell_tool_update",
      toolCallId: "tool-1",
      nextStatus: "running",
    })
  })

  it("routes main agent queue waits into a lightweight chat message", () => {
    expect(resolveRuntimeStatusUiAction({
      phase: "agent_queue",
      status: "queued",
      agent_type: "chat",
    })).toEqual({
      kind: "append_text",
      prefix: "runtime-agent-queue-chat",
      textKey: "runtime.agentQueue.chatWaiting",
    })
  })

  it("routes sub-agent queue waits into a lightweight subtask message", () => {
    expect(resolveRuntimeStatusUiAction({
      phase: "agent_queue",
      status: "queued",
      agent_type: "subagent:review",
    })).toEqual({
      kind: "append_text",
      prefix: "runtime-agent-queue-subagent",
      textKey: "runtime.agentQueue.subagentWaiting",
    })
  })

  it("ignores agent running slot-acquired notifications", () => {
    expect(resolveRuntimeStatusUiAction({
      phase: "agent_queue",
      status: "running",
      agent_type: "chat",
    })).toEqual({ kind: "ignore" })
  })

  it("falls back to generic view rendering when shell queue events cannot be mapped safely", () => {
    expect(resolveRuntimeStatusUiAction({
      phase: "shell_queue",
      status: "queued",
    })).toEqual({ kind: "fallback_view" })
  })

  it("falls back to generic view rendering for unknown runtime phases", () => {
    expect(resolveRuntimeStatusUiAction({
      phase: "mystery_queue",
      status: "queued",
    })).toEqual({ kind: "fallback_view" })
  })
})
