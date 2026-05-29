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

  it("routes main agent queue waits into AgentRun state", () => {
    expect(resolveRuntimeStatusUiAction({
      phase: "agent_queue",
      status: "queued",
      agent_type: "chat",
    })).toEqual({
      kind: "agent_run_status",
      state: {
        phase: "queued",
        kind: "chat",
        updatedAt: expect.any(Number),
      },
    })
  })

  it("routes Delegated AgentRun queue waits into AgentRun state", () => {
    expect(resolveRuntimeStatusUiAction({
      phase: "agent_queue",
      status: "queued",
      agent_type: "delegated_run:review",
    })).toEqual({
      kind: "agent_run_status",
      state: {
        phase: "queued",
        kind: "delegated_run",
        updatedAt: expect.any(Number),
      },
    })
  })

  it("routes agent running slot-acquired notifications into AgentRun state", () => {
    expect(resolveRuntimeStatusUiAction({
      phase: "agent_queue",
      status: "running",
      agent_type: "chat",
    })).toEqual({
      kind: "agent_run_status",
      state: {
        phase: "running",
        kind: "chat",
        updatedAt: expect.any(Number),
      },
    })
  })

  it("ignores shell queue runtime status when it cannot be mapped safely", () => {
    expect(resolveRuntimeStatusUiAction({
      phase: "shell_queue",
      status: "queued",
    })).toEqual({ kind: "ignore" })
  })

  it("ignores unknown runtime phases instead of creating transcript cards", () => {
    expect(resolveRuntimeStatusUiAction({
      phase: "mystery_queue",
      status: "queued",
    })).toEqual({ kind: "ignore" })
  })
})
